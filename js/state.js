// 存檔、進度、EXP 計算、接關碼（純前端，存在 localStorage）
const NS = 'shi2.';

function safeGet(key, fallback) {
  try {
    const raw = localStorage.getItem(NS + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}
function safeSet(key, value) {
  try { localStorage.setItem(NS + key, JSON.stringify(value)); } catch (e) { /* 無痕或空間不足時略過 */ }
}
function safeDel(key) { try { localStorage.removeItem(NS + key); } catch (e) {} }

export const Settings = {
  data: Object.assign({ theme: null, timeMode: 'scene', reduced: null, quality: 'auto', introSeen: false, follow: true }, safeGet('settings', {})),
  get(k) { return this.data[k]; },
  set(k, v) { this.data[k] = v; safeSet('settings', this.data); }
};

function emptySave(name, style) {
  return { v: 2, name, style: style || 0, visited: [], correct: {}, best: {}, stamps: [], at: 'center', traded: [], found: [], finalPassed: false, finalBest: 0 };
}

export class GameState {
  constructor(content) {
    this.content = content;
    this.rules = content.rpgRules;
    this.islandIds = content.islands.map(i => i.id);
    const p = safeGet('profiles', null) || { current: null, saves: {} };
    this.profiles = p;
    this.listeners = new Set();
  }
  on(fn) { this.listeners.add(fn); }
  emit(type, detail) { this.listeners.forEach(fn => fn(type, detail)); }
  persist() { safeSet('profiles', this.profiles); }

  get save() { return this.profiles.current ? this.profiles.saves[this.profiles.current] : null; }
  get hasAdventurer() { return !!this.save; }
  get profileKey() { return this.profiles.current || 'guest'; }

  createAdventurer(name, style) {
    name = (name || '').trim();
    if (!this.profiles.saves[name]) this.profiles.saves[name] = emptySave(name, style);
    else this.profiles.saves[name].style = style;
    this.profiles.current = name;
    this.persist();
    this.emit('profile');
  }
  switchTo(name) { if (this.profiles.saves[name]) { this.profiles.current = name; this.persist(); this.emit('profile'); } }
  browseOnly() { this.profiles.current = null; this.persist(); this.emit('profile'); }
  profileNames() { return Object.keys(this.profiles.saves); }
  deleteProfile(name) {
    delete this.profiles.saves[name];
    safeDel('course.' + name); safeDel('bag.' + name);
    if (this.profiles.current === name) this.profiles.current = null;
    this.persist(); this.emit('profile');
  }

  // ---------- EXP 與等級（一律由紀錄推算） ----------
  exp(save = this.save) {
    if (!save) return 0;
    const r = this.rules;
    let e = save.visited.length * r.firstVisit;
    for (const n of Object.values(save.correct)) e += r.firstCorrect + Math.max(0, n - 1) * r.repeatCorrect;
    e += save.stamps.length * r.firstClear;
    e += (save.traded || []).length * (r.firstTrade || 0);
    e += (save.found || []).length * (r.discoveryExp || 0);
    return e;
  }
  levelOf(exp) {
    const t = this.rules.levels;
    let lv = 1;
    for (let i = 1; i < t.length; i++) if (exp >= t[i]) lv = i + 1;
    if (exp >= t[t.length - 1]) lv = t.length + Math.floor((exp - t[t.length - 1]) / this.rules.levelStepAfter);
    return lv;
  }
  levelRange(lv) {
    const t = this.rules.levels;
    const at = l => (l <= t.length ? t[l - 1] : t[t.length - 1] + (l - t.length) * this.rules.levelStepAfter);
    return [at(lv), at(lv + 1)];
  }
  level() { return this.levelOf(this.exp()); }

  // 包一層：記錄前後等級，升級時通知
  mutate(fn) {
    const s = this.save;
    if (!s) return null;
    const before = this.exp(s), lvBefore = this.levelOf(before);
    const result = fn(s);
    this.persist();
    const after = this.exp(s), lvAfter = this.levelOf(after);
    if (after !== before) this.emit('exp', { gained: after - before, total: after });
    if (lvAfter > lvBefore) this.emit('levelup', { level: lvAfter });
    this.emit('change');
    return result;
  }
  visit(id) {
    if (!this.save) return false;
    return this.mutate(s => {
      s.at = id;
      if (!s.visited.includes(id)) { s.visited.push(id); return true; }
      return false;
    });
  }
  setAt(id) { if (this.save) { this.save.at = id; this.persist(); } }
  recordAnswer(qid, correct) {
    if (!this.save || !correct) return 0;
    return this.mutate(s => {
      const first = !s.correct[qid];
      s.correct[qid] = (s.correct[qid] || 0) + 1;
      return first ? this.rules.firstCorrect : this.rules.repeatCorrect;
    });
  }
  finishChallenge(islandId, score) {
    if (!this.save) return { stamped: false };
    return this.mutate(s => {
      s.best[islandId] = Math.max(s.best[islandId] || 0, score);
      let stamped = false;
      if (score >= this.rules.passCorrect && !s.stamps.includes(islandId)) { s.stamps.push(islandId); stamped = true; }
      return { stamped };
    });
  }
  finishFinal(score) {
    if (!this.save) return;
    this.mutate(s => {
      s.finalBest = Math.max(s.finalBest || 0, score);
      if (score >= this.rules.finalPass) s.finalPassed = true;
    });
  }
  recordTrade(residentId) {
    if (!this.save) return;
    this.mutate(s => { s.traded = s.traded || []; if (!s.traded.includes(residentId)) s.traded.push(residentId); });
  }
  // 探索點（場景裡的關卡）
  foundList() { return this.save ? (this.save.found || []) : (this.course().found || []); }
  isFound(id) { return this.foundList().includes(id); }
  recordDiscovery(id) {
    if (this.isFound(id)) return false;
    if (this.save) { this.mutate(s => { (s.found ||= []).push(id); }); }
    else this.updateCourse(c => { (c.found ||= []).push(id); });
    this.emit('change');
    return true;
  }
  foundOn(islandId) {
    const isl = islandId === 'center' ? this.content.center : this.content.islands.find(i => i.id === islandId);
    const ids = (isl && isl.discoveries || []).map(d => d.id);
    return { done: ids.filter(id => this.isFound(id)).length, total: ids.length };
  }
  challengeOpen(islandId) { return this.foundOn(islandId).done >= Math.min(this.rules.challengeNeed || 0, this.foundOn(islandId).total); }
  resetCurrent() {
    const s = this.save; if (!s) return;
    this.profiles.saves[s.name] = emptySave(s.name, s.style);
    this.persist();
    safeDel('course.' + s.name); safeDel('bag.' + s.name);
    this.emit('profile'); this.emit('change'); this.emit('bag');
  }
  centerUnlocked() { return !!this.save && this.save.stamps.length >= this.rules.centerUnlockStamps; }

  // ---------- 課程進度（已讀、學習單、測驗分數） ----------
  course() {
    const c = safeGet('course.' + this.profileKey, null) || { read: [], ws: {}, wsSaved: [], quiz: {}, review: null };
    return c;
  }
  updateCourse(fn) { const c = this.course(); fn(c); safeSet('course.' + this.profileKey, c); this.emit('change'); }
  markRead(id) { this.updateCourse(c => { if (!c.read.includes(id)) c.read.push(id); }); }
  clearCourse() {
    safeDel('course.' + this.profileKey);
    if (this.save) {
      const s = this.save; const keep = { name: s.name, style: s.style };
      this.profiles.saves[s.name] = emptySave(keep.name, keep.style);
      this.persist();
    }
    this.emit('change'); this.emit('profile');
  }

  // ---------- 背包 ----------
  bag() { return safeGet('bag.' + this.profileKey, null) || { shell: 3 }; }
  setBag(b) { safeSet('bag.' + this.profileKey, b); this.emit('bag'); }
  addItem(item, n = 1) { const b = this.bag(); b[item] = (b[item] || 0) + n; this.setBag(b); }
  canAfford(give) { const b = this.bag(); return Object.entries(give).every(([k, n]) => (b[k] || 0) >= n); }
  trade(t) {
    if (!this.canAfford(t.give)) return false;
    const b = this.bag();
    for (const [k, n] of Object.entries(t.give)) b[k] -= n;
    for (const [k, n] of Object.entries(t.get)) b[k] = (b[k] || 0) + n;
    for (const k of Object.keys(b)) if (b[k] <= 0) delete b[k];
    this.setBag(b);
    this.recordTrade(t.resident);
    return true;
  }
  clearBag() { this.setBag({ shell: 3 }); }

  // ---------- 接關碼 ----------
  exportSave() {
    const s = this.save; if (!s) return null;
    return JSON.parse(JSON.stringify(s));
  }
  makeCode() {
    const s = this.exportSave(); if (!s) return '';
    const body = b64encode(JSON.stringify(s));
    return `${this.content.site.saveCodePrefix}.${body}.${checksum(body)}`;
  }
  parseCode(code) {
    code = (code || '').replace(/\s+/g, '');
    const prefix = this.content.site.saveCodePrefix + '.';
    if (!code) throw new Error('請先貼上接關碼。');
    if (!code.startsWith(prefix)) throw new Error('這不是「詩兩首」的接關碼（開頭應該是 ' + prefix + '）。');
    const parts = code.slice(prefix.length).split('.');
    if (parts.length !== 2) throw new Error('接關碼格式不完整，可能少複製了一段。');
    if (checksum(parts[0]) !== parts[1]) throw new Error('接關碼的校驗碼不符，可能有字被改到或少複製了。');
    let data;
    try { data = JSON.parse(b64decode(parts[0])); } catch (e) { throw new Error('接關碼內容讀不出來，請重新複製一次。'); }
    return this.validate(data);
  }
  validate(data) {
    const ok = data && typeof data === 'object' && typeof data.name === 'string' && data.name.length >= 1 && data.name.length <= 12
      && Array.isArray(data.visited) && data.correct && typeof data.correct === 'object' && Array.isArray(data.stamps);
    if (!ok) throw new Error('存檔內容不正確，無法還原。');
    const valid = new Set([...this.islandIds, 'center']);
    const qids = new Set(this.content.islands.flatMap(i => i.quiz.map(q => q.id)));
    const clean = emptySave(data.name.slice(0, 12), [0, 1, 2].includes(data.style) ? data.style : 0);
    clean.visited = data.visited.filter(id => valid.has(id));
    for (const [k, n] of Object.entries(data.correct)) if (qids.has(k) && Number.isFinite(n) && n > 0) clean.correct[k] = Math.min(999, Math.floor(n));
    clean.stamps = data.stamps.filter(id => this.islandIds.includes(id));
    for (const [k, v] of Object.entries(data.best || {})) if (this.islandIds.includes(k) && Number.isFinite(v)) clean.best[k] = Math.max(0, Math.min(3, v));
    clean.at = valid.has(data.at) ? data.at : 'center';
    const resIds = new Set(this.allResidentIds());
    clean.traded = (data.traded || []).filter(id => resIds.has(id));
    const dIds = new Set([...(this.content.center.discoveries || []), ...this.content.islands.flatMap(i => i.discoveries || [])].map(d => d.id));
    clean.found = (data.found || []).filter(id => dIds.has(id));
    clean.finalPassed = !!data.finalPassed;
    clean.finalBest = Number.isFinite(data.finalBest) ? Math.max(0, Math.min(5, data.finalBest)) : 0;
    return clean;
  }
  allResidentIds() {
    const c = this.content;
    return [...c.residents.map(r => r.id), ...c.couriers.map(r => r.id), c.merchant.id, ...c.walkers.map(r => r.id)];
  }
  importSave(clean) {
    this.profiles.saves[clean.name] = clean;
    this.profiles.current = clean.name;
    this.persist();
    this.emit('profile'); this.emit('change');
  }
}

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
function checksum(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).toUpperCase().padStart(7, '0').slice(-6);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}
