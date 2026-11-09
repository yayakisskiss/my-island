// 學生學習紀錄上傳（第 4 版）
// 紀錄先存在這台裝置（localStorage 的待上傳佇列），有網路時送到老師自己的 Google 試算表（Apps Script 網路應用程式）。
// 網址只放「網路應用程式的位址」，沒有任何密碼或金鑰；教師密碼只存在老師試算表的指令碼屬性裡。
const NS = 'shi2.';
const get = (k, d) => { try { const r = localStorage.getItem(NS + k); return r ? JSON.parse(r) : d; } catch (e) { return d; } };
const set = (k, v) => { try { localStorage.setItem(NS + k, JSON.stringify(v)); } catch (e) {} };

// 只接受 Google Apps Script 的網路應用程式網址，避免學習紀錄被送到其他地方
export function validEndpoint(u) {
  return typeof u === 'string' && /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(u.trim());
}

// 老師的「班級連結」：?class=501#e=<網路應用程式網址>，打開一次就記在這台裝置
export function readClassLink() {
  const out = {};
  try {
    const q = new URLSearchParams(location.search);
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const e = h.get('e') || q.get('e');
    const c = q.get('class') || h.get('class');
    if (e && validEndpoint(e)) out.endpoint = e.trim();
    if (c && /^[A-Za-z0-9-]{1,12}$/.test(c)) out.cls = c;
    if (out.endpoint || out.cls) {
      const cur = get('classroom', {});
      set('classroom', Object.assign(cur, out));
      // 把網址整理乾淨，避免學生把含網址的連結到處轉貼
      history.replaceState(null, '', location.pathname);
    }
  } catch (er) {}
  return out;
}

export class Sync {
  constructor(app) {
    this.app = app;
    const cfg = app.content.classroom || {};
    const saved = get('classroom', {});
    this.endpoint = validEndpoint(saved.endpoint) ? saved.endpoint : (validEndpoint(cfg.endpoint) ? cfg.endpoint : '');
    this.defaultCls = saved.cls || '';
    this.status = 'idle';
    this.lastOk = get('sync.lastOk', null);
    this.timer = null; this.busy = false; this.backoff = 5000;
    this.seq = get('sync.seq', 0);
    this.device = get('device', null) || this.makeDevice();
    this.listeners = new Set();
    // 每分鐘累計「有在操作」的學習時間
    this.lastActive = Date.now();
    ['pointerdown', 'keydown', 'wheel', 'touchstart'].forEach(ev => document.addEventListener(ev, () => { this.lastActive = Date.now(); }, { passive: true, capture: true }));
    setInterval(() => this.tickMinute(), 60000);
    window.addEventListener('online', () => this.flushSoon(500));
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.flush(true); });
    window.addEventListener('pagehide', () => this.flush(true));
    setInterval(() => this.flushSoon(0), 45000);
  }
  makeDevice() { const d = 'd' + Math.random().toString(36).slice(2, 10); set('device', d); return d; }
  get configured() { return !!this.endpoint; }
  get student() { const s = this.app.state.save; return s && s.student ? s.student : null; }
  on(fn) { this.listeners.add(fn); }
  emit() { this.listeners.forEach(fn => fn(this)); }
  outboxKey() { const s = this.app.state.save; return 'outbox.' + (s ? s.name : 'guest'); }
  pending() { return this.student ? get(this.outboxKey(), []).length : 0; }

  setEndpoint(u) {
    if (!validEndpoint(u)) return false;
    this.endpoint = u.trim();
    set('classroom', Object.assign(get('classroom', {}), { endpoint: this.endpoint }));
    this.emit(); return true;
  }

  // 記一筆學習事件（只有登入的學生才記）
  log(ev) {
    if (!this.student) return;
    this.seq++; set('sync.seq', this.seq);
    const e = Object.assign({ eid: `${this.device}-${this.seq}`, t: new Date().toISOString() }, ev);
    for (const k of Object.keys(e)) if (typeof e[k] === 'string') e[k] = e[k].slice(0, k === 'detail' ? 1500 : 200);
    const box = get(this.outboxKey(), []);
    box.push(e);
    if (box.length > 2000) box.splice(0, box.length - 2000); // 太久沒網路時，只保留最近的
    set(this.outboxKey(), box);
    this.emit();
    this.flushSoon(4000);
  }
  tickMinute() {
    const s = this.app.state.save;
    if (!s || !s.student || document.hidden || Date.now() - this.lastActive > 120000) return;
    s.minutes = (s.minutes || 0) + 1;
    this.app.state.persist();
    if (s.minutes % 5 === 0) this.flushSoon(1000);
  }
  summary() {
    const st = this.app.state, s = st.save, c = st.course();
    const islands = this.app.content.islands;
    const discTotal = [this.app.content.center, ...islands].reduce((n, i) => n + (i.discoveries || []).length, 0);
    return {
      level: st.levelOf(st.exp()), exp: st.exp(),
      stamps: s.stamps.length, stampList: s.stamps.join(','), islandsTotal: islands.length,
      found: (s.found || []).length, foundTotal: discTotal,
      best: islands.map(i => (s.best[i.id] ?? '-')).join(' / '),
      finalBest: s.finalBest || 0, finalPassed: !!s.finalPassed,
      correctQ: Object.keys(s.correct).length, read: c.read.length, worksheets: c.wsSaved.length,
      minutes: s.minutes || 0, at: s.at
    };
  }
  flushSoon(ms) {
    if (!this.configured || !this.student) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), ms);
  }
  async flush(beacon) {
    const stu = this.student;
    if (!this.configured || !stu || (this.busy && !beacon)) return;
    const box = get(this.outboxKey(), []);
    const batch = box.slice(0, 150);
    const body = JSON.stringify({ op: 'push', v: 1, cls: stu.cls, seat: stu.seat, name: this.app.state.save.name, device: this.device, summary: this.summary(), events: batch });
    if (beacon) {
      // 關掉分頁時：盡力送出，下次打開還會再送一次（伺服器會用 eid 去掉重複）
      try { if (batch.length && navigator.sendBeacon) navigator.sendBeacon(this.endpoint, new Blob([body], { type: 'text/plain;charset=utf-8' })); } catch (e) {}
      return;
    }
    if (!navigator.onLine) { this.status = 'offline'; this.emit(); return; }
    this.busy = true; this.status = 'sending'; this.emit();
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 20000);
      const res = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, signal: ctl.signal, redirect: 'follow' });
      clearTimeout(to);
      const j = await res.json();
      if (!j.ok) throw Object.assign(new Error(j.error || '上傳失敗'), { server: true, code: j.code });
      const sent = new Set(batch.map(e => e.eid));
      set(this.outboxKey(), get(this.outboxKey(), []).filter(e => !sent.has(e.eid)));
      this.status = 'ok'; this.lastOk = new Date().toISOString(); set('sync.lastOk', this.lastOk);
      this.lastError = ''; this.backoff = 5000;
      if (get(this.outboxKey(), []).length) this.flushSoon(800);
    } catch (e) {
      this.status = 'error';
      this.lastError = e.server ? e.message : '連不上老師的紀錄表，稍後會自動再試。';
      if (e.code === 'BAD_CLASS') this.lastError = '班級代碼不在老師的名單裡，請跟老師確認。';
      this.backoff = Math.min(this.backoff * 2, 300000);
      this.flushSoon(this.backoff);
    } finally { this.busy = false; this.emit(); }
  }
  // 登入時先問一下：班級代碼對不對（連不上也讓學生先玩，紀錄會排隊）
  async checkClass(cls) {
    if (!this.configured) return { ok: true, offline: true };
    try {
      const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 12000);
      const res = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify({ op: 'hello', cls }), signal: ctl.signal });
      clearTimeout(to);
      const j = await res.json();
      return j.ok ? { ok: true } : { ok: false, error: j.code === 'BAD_CLASS' ? '這個班級代碼不在老師的名單裡，請再確認一次。' : (j.error || '老師的紀錄表還沒設定好。') };
    } catch (e) { return { ok: true, offline: true }; }
  }
}
