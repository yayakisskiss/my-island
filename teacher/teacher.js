// 教師後台：讀取老師自己 Google 試算表裡的學生學習紀錄，整理成全班總覽、題目分析、個別學生與學習單。
// 密碼只用來向老師自己的 Apps Script 驗證，不會存進檔案；勾選「記住」時只存在這個分頁（sessionStorage）。
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const EP_RE = /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/;
const store = {
  get(k, d) { try { const v = localStorage.getItem('shi2.teacher.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('shi2.teacher.' + k, JSON.stringify(v)); } catch (e) {} }
};
function toast(msg) {
  const d = document.createElement('div'); d.textContent = msg; $('#toasts').appendChild(d);
  setTimeout(() => d.remove(), 3200);
}
const fmtTime = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleString('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }); };
const pct = (a, b) => b ? Math.round(a / b * 100) : null;
const meter = (p, label) => p == null ? '<span class="note">—</span>' : `<span class="meter" title="${esc(label || '')}"><i style="--w:${p}%"></i><b>${p}%</b></span>`;

const T = { content: null, data: null, demo: false, cls: '', tab: 'overview', sortKey: 'seat', sortDir: 1, studentSeat: null };

// ---------- 讀取 ----------
async function loadContent() {
  const res = await fetch('data/content.json', { cache: 'no-cache' });
  T.content = await res.json();
  T.islands = T.content.islands;
  T.islandName = Object.fromEntries([['center', '中央島'], ...T.islands.map(i => [i.id, i.name])]);
  T.questions = T.islands.flatMap(i => i.quiz.map(q => ({ ...q, island: i.id })));
  T.discs = [T.content.center, ...T.islands].flatMap(i => (i.discoveries || []).map(d => ({ ...d, island: i.id || 'center' })));
  $('#t-sub').textContent = `${T.content.site.title}・學生學習紀錄`;
}
async function request(body) {
  const ep = $('#ep').value.trim();
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 30000);
  try {
    const res = await fetch(ep, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body), signal: ctl.signal });
    return await res.json();
  } finally { clearTimeout(to); }
}
async function login(e) {
  e && e.preventDefault();
  const ep = $('#ep').value.trim(), pw = $('#pw').value;
  const err = m => { $('#login-err').textContent = m; };
  if (!EP_RE.test(ep)) return err('紀錄表網址格式不對：應該是 https://script.google.com/macros/s/……/exec');
  if (!pw) return err('請輸入教師密碼。');
  const btn = $('#login-go'); btn.disabled = true; btn.textContent = '讀取中…'; err('');
  try {
    const j = await request({ op: 'report', password: pw });
    if (!j.ok) return err(j.code === 'NOT_SETUP' ? '試算表還沒設定班級代碼與密碼，請先做設定說明的第 3 步。' : (j.error || '讀取失敗'));
    store.set('ep', ep);
    try { if ($('#remember').checked) sessionStorage.setItem('shi2.teacher.pw', pw); else sessionStorage.removeItem('shi2.teacher.pw'); } catch (er) {}
    T.pw = pw; T.demo = false;
    setData(parseReport(j));
  } catch (er) {
    err('連不上紀錄表。請確認網址正確、部署時「具有存取權的使用者」選了「所有人」，以及網路正常。');
  } finally { btn.disabled = false; btn.textContent = '🔓 讀取紀錄'; }
}
function parseReport(j) {
  const S = j.summary.map(r => ({ cls: String(r[0]), seat: Number(r[1]), name: String(r[2]), last: r[3], level: Number(r[4]) || 1, exp: Number(r[5]) || 0, stamps: String(r[6]), found: String(r[7]), best: String(r[8]), final: String(r[9]), correctQ: Number(r[10]) || 0, read: Number(r[11]) || 0, worksheets: Number(r[12]) || 0, minutes: Number(r[13]) || 0 }));
  const E = j.events.map(r => ({ t: r[0], cls: String(r[1]), seat: Number(r[2]), name: String(r[3]), type: r[4], ctx: r[5], island: r[6], item: r[7], text: r[8], answer: r[9], right: r[10], ok: r[11] === '✔' ? true : r[11] === '✘' ? false : null, score: r[12], total: r[13], tries: r[14] }));
  const W = j.worksheets.map(r => ({ t: r[0], cls: String(r[1]), seat: Number(r[2]), name: String(r[3]), island: r[4], done: r[5], text: r[6] }));
  return { classes: j.classes || [...new Set(S.map(s => s.cls))], summary: S, events: E, worksheets: W, at: j.at };
}
function setData(d) {
  T.data = d;
  const classes = d.classes.length ? d.classes : ['（無）'];
  if (!classes.includes(T.cls)) T.cls = store.get('cls', classes[0]);
  if (!classes.includes(T.cls)) T.cls = classes[0];
  $('#cls-pick').innerHTML = classes.map(c => `<option ${c === T.cls ? 'selected' : ''}>${esc(c)}</option>`).join('');
  $('#login').hidden = true; $('#setup').hidden = true; $('#dash').hidden = false;
  $('#demo-flag').hidden = !T.demo;
  if (T.demo && T.tab === 'link') T.tab = 'overview';
  $('#loaded-at').textContent = `資料時間：${fmtTime(d.at)}${T.demo ? '（示範）' : ''}`;
  syncSize(); render();
}
function syncSize() {
  const sizes = store.get('sizes', {});
  const maxSeat = Math.max(0, ...T.data.summary.filter(s => s.cls === T.cls).map(s => s.seat));
  $('#cls-size').value = sizes[T.cls] || maxSeat || '';
}

// ---------- 計算 ----------
function classData() {
  const d = T.data, cls = T.cls;
  const sum = d.summary.filter(s => s.cls === cls);
  const ev = d.events.filter(e => e.cls === cls).sort((a, b) => String(a.t).localeCompare(String(b.t)));
  const ws = d.worksheets.filter(w => w.cls === cls);
  const bySeat = new Map();
  for (const s of sum) bySeat.set(s.seat, { ...s, answers: 0, right: 0, firstAns: new Map(), discTry1: 0, disc: 0, events: [], ws: [] });
  for (const e of ev) {
    let st = bySeat.get(e.seat);
    if (!st) { st = { cls, seat: e.seat, name: e.name, last: e.t, level: 1, exp: 0, stamps: '0/4', found: '0/0', best: '', final: '0', correctQ: 0, read: 0, worksheets: 0, minutes: 0, answers: 0, right: 0, firstAns: new Map(), discTry1: 0, disc: 0, events: [], ws: [] }; bySeat.set(e.seat, st); }
    st.events.push(e);
    if (e.type === 'answer') { st.answers++; if (e.ok) st.right++; if (!st.firstAns.has(e.item)) st.firstAns.set(e.item, e); }
    if (e.type === 'discovery') { st.disc++; if (e.ok) st.discTry1++; }
  }
  for (const w of ws) { const st = bySeat.get(w.seat); if (st) st.ws.push(w); }
  const size = Number($('#cls-size').value) || 0;
  const now = Date.now();
  const rows = [];
  const seats = new Set([...bySeat.keys(), ...Array.from({ length: size }, (_, i) => i + 1)]);
  for (const seat of [...seats].sort((a, b) => a - b)) {
    const st = bySeat.get(seat);
    if (!st) { rows.push({ seat, absent: true, name: '', flags: [['bad', '⛔', '尚未登入']] }); continue; }
    const acc = pct(st.right, st.answers);
    const [sg] = st.stamps.split('/').map(Number);
    const [fd, ft] = st.found.split('/').map(Number);
    const days = st.last ? (now - new Date(st.last)) / 86400000 : 99;
    const flags = [];
    if (st.answers >= 5 && acc < 60) flags.push(['bad', '❗', '正確率偏低']);
    if (days > 3) flags.push(['warn', '⏰', `${Math.floor(days)} 天沒上線`]);
    if (!sg && st.minutes >= 20) flags.push(['warn', '🧭', '還沒拿到島章']);
    if (/通過/.test(st.final)) flags.push(['good', '🏆', '通過最終挑戰']);
    rows.push({ ...st, acc, stampsN: sg || 0, foundN: fd || 0, foundT: ft || T.discs.length, foundP: pct(fd || 0, ft || T.discs.length), days, flags });
  }
  return { rows, ev, ws, present: rows.filter(r => !r.absent) };
}

// ---------- 畫面 ----------
function render() {
  $$('.tabs [data-tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === T.tab)));
  const v = $('#view');
  const cd = classData();
  ({ overview: renderOverview, items: renderItems, student: renderStudent, ws: renderWS, link: renderLink })[T.tab](v, cd);
}

function renderOverview(v, cd) {
  const P = cd.present;
  if (!P.length) { v.innerHTML = `<div class="empty"><p>「${esc(T.cls)}」班還沒有學生上傳紀錄。</p><p>到「🔗 班級連結」把連結或 QR Code 發給學生，學生登入後就會出現在這裡。</p></div>`; return; }
  const avg = f => Math.round(P.reduce((a, r) => a + (f(r) || 0), 0) / P.length * 10) / 10;
  const answered = P.filter(r => r.answers);
  const accAvg = answered.length ? Math.round(answered.reduce((a, r) => a + r.acc, 0) / answered.length) : null;
  const size = Number($('#cls-size').value) || P.length;
  const cols = [
    ['seat', '座號'], ['name', '名字'], ['level', '等級'], ['foundP', '探索完成'], ['stampsN', '島章'], ['acc', '答題正確率'],
    ['final', '最終挑戰'], ['worksheets', '學習單'], ['minutes', '學習分鐘'], ['last', '最後上線'], ['flags', '需要留意']
  ];
  const rows = [...cd.rows].sort((a, b) => {
    const k = T.sortKey; let x = a[k], y = b[k];
    if (k === 'flags') { x = a.flags.filter(f => f[0] !== 'good').length; y = b.flags.filter(f => f[0] !== 'good').length; }
    if (a.absent !== b.absent && k !== 'seat') return a.absent ? 1 : -1;
    if (x == null) x = -1; if (y == null) y = -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * T.sortDir;
  });
  v.innerHTML = `
    <div class="kpis">
      <div class="kpi"><b>${P.length}<small style="font-size:16px"> / ${size}</small></b><span>已登入人數</span></div>
      <div class="kpi"><b>${avg(r => r.foundP)}%</b><span>平均探索完成度</span></div>
      <div class="kpi"><b>${avg(r => r.stampsN)}</b><span>平均島章數（滿分 ${T.islands.length}）</span></div>
      <div class="kpi"><b>${accAvg == null ? '—' : accAvg + '%'}</b><span>平均答題正確率</span></div>
      <div class="kpi"><b>${P.filter(r => /通過/.test(r.final)).length}</b><span>通過最終挑戰人數</span></div>
      <div class="kpi"><b>${avg(r => r.minutes)}</b><span>平均學習分鐘</span></div>
    </div>
    <h3>各島進度</h3>${islandTable(cd)}
    <h3>全班名單 <small class="note">（點欄位名稱可以排序；點名字看個別學生）</small></h3>
    <div class="table-wrap"><table><thead><tr>${cols.map(([k, l]) => `<th scope="col" aria-sort="${T.sortKey === k ? (T.sortDir > 0 ? 'ascending' : 'descending') : 'none'}"><button type="button" data-sort="${k}">${l}${T.sortKey === k ? (T.sortDir > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('')}</tr></thead>
    <tbody>${rows.map(r => r.absent
      ? `<tr class="absent"><td class="num">${r.seat}</td><td>—</td><td colspan="8">尚未登入或還沒上傳紀錄</td><td>${flagHtml(r.flags)}</td></tr>`
      : `<tr><td class="num">${r.seat}</td><td><a href="#" data-stu="${r.seat}">${esc(r.name)}</a></td><td class="num">Lv ${r.level}</td>
        <td>${meter(r.foundP, `探索 ${r.foundN}/${r.foundT}`)} <span class="note">${r.foundN}/${r.foundT}</span></td>
        <td class="num">${r.stampsN} / ${T.islands.length}</td><td>${r.answers ? meter(r.acc, `${r.right}/${r.answers} 題`) + ` <span class="note">${r.right}/${r.answers}</span>` : '<span class="note">還沒作答</span>'}</td>
        <td>${esc(r.final)}</td><td class="num">${r.worksheets}</td><td class="num">${r.minutes}</td><td>${fmtTime(r.last)}</td><td class="wrap">${flagHtml(r.flags)}</td></tr>`).join('')}</tbody></table></div>
    <p class="note">「答題正確率」包含島主挑戰、最終挑戰與總複習的所有作答；「探索完成度」是場景裡的探索關卡完成比例。「需要留意」是自動提示：答題 5 題以上且正確率低於 60%、超過 3 天沒上線、玩了 20 分鐘以上還沒有島章。</p>`;
  $$('[data-sort]', v).forEach(b => b.addEventListener('click', () => { const k = b.dataset.sort; T.sortDir = T.sortKey === k ? -T.sortDir : 1; T.sortKey = k; render(); }));
  bindStudentLinks(v);
}
function flagHtml(flags) { return flags.map(([c, i, t]) => `<span class="flag ${c}"><span aria-hidden="true">${i}</span>${esc(t)}</span>`).join('') || '<span class="note">—</span>'; }
function islandTable(cd) {
  const P = cd.present.length || 1;
  const rows = T.islands.map(isl => {
    const ids = new Set((isl.discoveries || []).map(d => d.id));
    const per = new Map();
    for (const e of cd.ev) {
      if (e.island !== isl.id) continue;
      const p = per.get(e.seat) || { disc: new Set(), pass: false, best: 0, tried: false };
      if (e.type === 'discovery' && ids.has(e.item)) p.disc.add(e.item);
      if (e.type === 'challenge') { p.tried = true; p.best = Math.max(p.best, Number(e.score) || 0); if (e.ok) p.pass = true; }
      per.set(e.seat, p);
    }
    const vals = [...per.values()];
    const need = Math.min(T.content.rpgRules.challengeNeed, ids.size);
    const explored = vals.filter(p => p.disc.size >= need).length;
    const tried = vals.filter(p => p.tried);
    const pass = vals.filter(p => p.pass).length;
    const avgBest = tried.length ? (tried.reduce((a, p) => a + p.best, 0) / tried.length).toFixed(1) : '—';
    return `<tr><td>${isl.order}. ${esc(isl.name)}</td><td>${meter(pct(explored, P))} <span class="note">${explored} 人</span></td><td class="num">${tried.length} 人</td><td>${meter(pct(pass, P))} <span class="note">${pass} 人</span></td><td class="num">${avgBest} / ${T.content.rpgRules.questionsPerChallenge}</td></tr>`;
  });
  return `<div class="table-wrap"><table><thead><tr><th scope="col">島</th><th scope="col">完成 ${T.content.rpgRules.challengeNeed} 個探索</th><th scope="col">挑戰過的人</th><th scope="col">拿到島章</th><th scope="col">挑戰平均最佳</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
}

function renderItems(v, cd) {
  const isl = T.itemIsland || '';
  const items = [];
  for (const q of T.questions) {
    if (isl && q.island !== isl) continue;
    const first = new Map(), wrong = new Map(); let n = 0;
    for (const e of cd.ev) {
      if (e.type !== 'answer' || e.item !== q.id) continue;
      n++;
      if (!first.has(e.seat)) first.set(e.seat, e);
      if (e.ok === false) wrong.set(e.answer, (wrong.get(e.answer) || 0) + 1);
    }
    const f = [...first.values()];
    const ok1 = f.filter(e => e.ok).length;
    const topWrong = [...wrong.entries()].sort((a, b) => b[1] - a[1])[0];
    items.push({ kind: '題目', id: q.id, island: q.island, text: q.q, right: q.options.find(o => o.id === q.answer).text, n, people: f.length, rate: pct(ok1, f.length), topWrong, missed: f.filter(e => !e.ok).map(e => `${e.seat}號${e.name}`) });
  }
  for (const d of T.discs) {
    if (isl && d.island !== isl) continue;
    const f = cd.ev.filter(e => e.type === 'discovery' && e.item === d.id);
    const per = new Map(); f.forEach(e => { if (!per.has(e.seat)) per.set(e.seat, e); });
    const arr = [...per.values()];
    items.push({ kind: '探索', id: d.id, island: d.island, text: `${d.title}：${d.task.q || '詩句排序'}`, right: d.task.q ? (d.task.options.find(o => o.id === d.task.answer) || {}).text : d.task.lines.join(' / '), n: f.length, people: arr.length, rate: pct(arr.filter(e => e.ok).length, arr.length), avgTries: arr.length ? (arr.reduce((a, e) => a + (Number(e.tries) || 1), 0) / arr.length).toFixed(1) : null, missed: arr.filter(e => !e.ok).map(e => `${e.seat}號${e.name}`) });
  }
  items.sort((a, b) => (a.rate == null) - (b.rate == null) || (a.rate ?? 0) - (b.rate ?? 0));
  v.innerHTML = `
    <div class="row"><label for="it-isl" class="inline">島</label><select id="it-isl"><option value="">全部</option>${T.islands.map(i => `<option value="${i.id}" ${i.id === isl ? 'selected' : ''}>${esc(i.name)}</option>`).concat(`<option value="center" ${isl === 'center' ? 'selected' : ''}>中央島</option>`).join('')}</select>
    <span class="note">依「第一次作答就答對」的比例由低到高排列，最上面的就是全班最需要再教的地方。</span></div>
    <div class="items" style="margin-top:12px">${items.map(it => `
      <div class="item">
        <div><div class="sub">${it.kind}・${esc(T.islandName[it.island])}</div><div class="q">${esc(it.text)}</div>
          <div class="sub">正確答案：${esc(it.right)}${it.topWrong ? `　最常見的錯誤：「${esc(it.topWrong[0])}」（${it.topWrong[1]} 次）` : ''}${it.avgTries ? `　平均嘗試 ${it.avgTries} 次` : ''}</div></div>
        <div>${it.rate == null ? '<span class="note">還沒有人作答</span>' : `<div class="hbar" role="img" aria-label="第一次答對 ${it.rate}%，${it.people} 人作答" title="第一次答對 ${it.rate}%（${it.people} 人作答，共 ${it.n} 次）"><i style="--w:${it.rate}%"></i><span>${it.rate}%</span></div><div class="sub">${it.people} 人作答・共 ${it.n} 次</div>`}</div>
        ${it.missed.length ? `<details><summary>第一次答錯的學生（${it.missed.length} 人）</summary><p>${it.missed.map(esc).join('、')}</p></details>` : ''}
      </div>`).join('')}</div>`;
  $('#it-isl', v).addEventListener('change', e => { T.itemIsland = e.target.value; render(); });
}

function renderStudent(v, cd) {
  const P = cd.present;
  if (!P.length) { v.innerHTML = '<div class="empty">還沒有學生紀錄。</div>'; return; }
  if (!P.some(r => r.seat === T.studentSeat)) T.studentSeat = P[0].seat;
  const r = P.find(x => x.seat === T.studentSeat);
  const tl = [...r.events].reverse().slice(0, 300);
  const label = e => ({ login: '🔑 登入', visit: '🏝️ 登島', discovery: '✨ 探索', answer: '❓ 作答', challenge: '⚔️ 島主挑戰', final: '🏆 最終挑戰', review: '📝 總複習', worksheet: '📄 學習單' }[e.type] || e.type);
  const ctx = { challenge: '島主挑戰', final: '最終挑戰', review: '總複習' };
  v.innerHTML = `
    <div class="row"><label for="stu-pick" class="inline">學生</label><select id="stu-pick">${P.map(x => `<option value="${x.seat}" ${x.seat === r.seat ? 'selected' : ''}>${x.seat} 號 ${esc(x.name)}</option>`).join('')}</select></div>
    <div class="kpis" style="margin-top:12px">
      <div class="kpi"><b>Lv ${r.level}</b><span>EXP ${r.exp}</span></div>
      <div class="kpi"><b>${r.foundN}/${r.foundT}</b><span>探索完成</span></div>
      <div class="kpi"><b>${r.stampsN}/${T.islands.length}</b><span>島章（各島最佳：${esc(r.best)}）</span></div>
      <div class="kpi"><b>${r.acc == null ? '—' : r.acc + '%'}</b><span>答題正確率（${r.right}/${r.answers}）</span></div>
      <div class="kpi"><b>${esc(r.final)}</b><span>最終挑戰最佳</span></div>
      <div class="kpi"><b>${r.minutes}</b><span>學習分鐘</span></div>
    </div>
    <p>${flagHtml(r.flags)}</p>
    <h3>答錯過的題目</h3>
    ${(() => { const wr = r.events.filter(e => e.type === 'answer' && e.ok === false); return wr.length ? `<div class="table-wrap"><table><thead><tr><th>時間</th><th>島</th><th>題目</th><th>學生的答案</th><th>正確答案</th></tr></thead><tbody>${wr.map(e => `<tr><td>${fmtTime(e.t)}</td><td>${esc(T.islandName[e.island] || '')}</td><td class="wrap">${esc(e.text)}</td><td class="wrap">${esc(e.answer)}</td><td class="wrap">${esc(e.right)}</td></tr>`).join('')}</tbody></table></div>` : '<p class="note">沒有答錯的紀錄。</p>'; })()}
    <h3>學習單</h3>
    ${r.ws.length ? r.ws.slice().reverse().map(w => `<div class="ws-card"><strong>${esc(T.islandName[w.island] || w.island)}</strong> <span class="note">${fmtTime(w.t)}・完成 ${esc(w.done)}</span><pre>${esc(w.text)}</pre></div>`).join('') : '<p class="note">還沒有儲存學習單。</p>'}
    <h3>學習歷程（最新在上）</h3>
    <ol class="timeline">${tl.map(e => `<li><time>${fmtTime(e.t)}</time><div><strong>${label(e)}</strong>${e.ctx && ctx[e.ctx] ? `<span class="note">・${ctx[e.ctx]}</span>` : ''}${e.island ? `<span class="note">・${esc(T.islandName[e.island] || e.island)}</span>` : ''}
      ${e.type === 'answer' ? `<div>${esc(e.text)}　→ ${e.ok ? '✅' : '❌'} ${esc(e.answer)}</div>` : ''}
      ${e.type === 'discovery' ? `<div>${esc(e.text)}　→ ${e.ok ? '✅ 一次就答對' : `🔁 試了 ${esc(e.tries)} 次`}</div>` : ''}
      ${['challenge', 'final', 'review'].includes(e.type) ? `<div>${esc(e.score)} / ${esc(e.total)} ${e.ok ? '✅ 過關' : e.ok === false ? '未過關' : ''}</div>` : ''}
    </div></li>`).join('')}</ol>`;
  $('#stu-pick', v).addEventListener('change', e => { T.studentSeat = Number(e.target.value); render(); });
}
function bindStudentLinks(v) { $$('[data-stu]', v).forEach(a => a.addEventListener('click', e => { e.preventDefault(); T.studentSeat = Number(a.dataset.stu); T.tab = 'student'; render(); })); }

function renderWS(v, cd) {
  const isl = T.wsIsland || T.islands[0].id;
  const I = T.islands.find(i => i.id === isl);
  const latest = new Map();
  for (const w of cd.ws.filter(w => w.island === isl)) latest.set(w.seat, w);
  const list = [...latest.values()].sort((a, b) => a.seat - b.seat);
  v.innerHTML = `
    <div class="row"><label for="ws-isl" class="inline">島</label><select id="ws-isl">${T.islands.map(i => `<option value="${i.id}" ${i.id === isl ? 'selected' : ''}>${esc(i.name)}</option>`).join('')}</select>
    <span class="note">每位學生最新一次儲存的學習單（${list.length} 份）</span><button class="btn sm ghost" type="button" id="ws-print">🖨️ 列印</button></div>
    <details style="margin:10px 0"><summary>學習單題目</summary><ol>${I.worksheet.map(w => `<li>${esc(w.q)}</li>`).join('')}</ol></details>
    ${list.length ? list.map(w => `<div class="ws-card"><strong>${w.seat} 號 ${esc(w.name)}</strong> <span class="note">${fmtTime(w.t)}・完成 ${esc(w.done)}</span><pre>${esc(w.text)}</pre></div>`).join('') : '<div class="empty">這座島還沒有學生交學習單。</div>'}`;
  $('#ws-isl', v).addEventListener('change', e => { T.wsIsland = e.target.value; render(); });
  $('#ws-print', v).addEventListener('click', () => window.print());
}

function classLink(cls) {
  const base = new URL('./', location.href).href;
  return `${base}?class=${encodeURIComponent(cls)}#e=${encodeURIComponent($('#ep').value.trim())}`;
}
function renderLink(v) {
  if (T.demo) { v.innerHTML = '<div class="empty">示範模式沒有真的紀錄表。完成設定、用教師密碼讀取後，這裡會產生您班級專用的連結與 QR Code。</div>'; return; }
  const link = classLink(T.cls);
  let img = '';
  try { const q = window.qrcode(0, 'M'); q.addData(link); q.make(); img = q.createDataURL(6, 2); } catch (e) { img = ''; }
  v.innerHTML = `
    <div class="qr-box">
      <div class="qr">${img ? `<img src="${img}" alt="${esc(T.cls)} 班的登入連結 QR Code">` : '<p class="note">QR Code 產生失敗，請改用連結。</p>'}<p style="text-align:center;margin:6px 0 0;font-weight:900">${esc(T.content.site.title)}・${esc(T.cls)} 班</p></div>
      <div>
        <h3 style="margin-top:0">「${esc(T.cls)}」班的學生登入連結</h3>
        <p>學生用這個連結（或掃 QR Code）打開網站，選「👩‍🎓 學生登入」，填<strong>班級代碼 ${esc(T.cls)}</strong>、座號、名字就可以了。同一台裝置打開過一次之後，下次直接開網站也會自動上傳。</p>
        <textarea class="linkbox" rows="3" readonly id="cl-link">${esc(link)}</textarea>
        <div class="row"><button class="btn" type="button" id="cl-copy">📋 複製連結</button><button class="btn ghost" type="button" id="cl-print">🖨️ 列印 QR Code</button></div>
        <p class="note">這個連結含有您的紀錄表網址，請只發給自己班的學生（Google Classroom、聯絡簿或投影），不要公開張貼。學生只能新增自己的紀錄，看不到別人的資料。</p>
      </div>
    </div>`;
  $('#cl-copy', v).addEventListener('click', async () => { try { await navigator.clipboard.writeText(link); toast('已複製連結'); } catch (e) { $('#cl-link', v).select(); toast('請按 Ctrl+C 複製'); } });
  $('#cl-print', v).addEventListener('click', () => window.print());
}

function exportCSV() {
  const cd = classData();
  const head = ['班級', '座號', '名字', '等級', 'EXP', '探索完成', '島章', '各島挑戰最佳', '最終挑戰', '答題數', '答對數', '正確率%', '學習單', '學習分鐘', '最後上線', '需要留意'];
  const lines = [head, ...cd.rows.map(r => r.absent ? [T.cls, r.seat, '', '', '', '', '', '', '', '', '', '', '', '', '', '尚未登入'] :
    [T.cls, r.seat, r.name, r.level, r.exp, `${r.foundN}/${r.foundT}`, `${r.stampsN}/${T.islands.length}`, r.best, r.final, r.answers, r.right, r.acc ?? '', r.worksheets, r.minutes, fmtTime(r.last), r.flags.map(f => f[2]).join('、')])];
  const csv = '﻿' + lines.map(l => l.map(c => { const s = String(c ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `${T.content.site.title}-${T.cls}班-學習紀錄${T.demo ? '-示範' : ''}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- 示範資料（示意，固定亂數，每次都一樣） ----------
function demoData() {
  let seed = 20261109; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const cls = '501', S = [], E = [], W = [];
  const base = Date.now() - 3.2 * 86400000;
  for (let seat = 1; seat <= 26; seat++) {
    if (seat === 7 || seat === 19) continue; // 兩位還沒登入
    const name = `示範學生${String(seat).padStart(2, '0')}`;
    const skill = .35 + rnd() * .6, eager = rnd();
    let t = base + rnd() * 2.6 * 86400000;
    const at = () => new Date(t += 30000 + rnd() * 240000).toISOString();
    const ev = (o) => E.push(Object.assign({ cls, seat, name, t: at(), ctx: '', island: '', item: '', text: '', answer: '', right: '', ok: null, score: '', total: '', tries: '' }, o));
    ev({ type: 'login', island: 'center', text: '登入' });
    let stamps = 0, found = 0, finalBest = 0, finalPassed = false; const best = {}; let wsN = 0, correctQ = new Set();
    const nIsl = eager > .8 ? 4 : eager > .45 ? 3 : eager > .2 ? 2 : 1;
    for (const isl of T.islands.slice(0, nIsl)) {
      ev({ type: 'visit', island: isl.id, text: isl.name });
      for (const d of (isl.discoveries || []).slice(0, eager > .3 ? 4 : 3)) {
        const tries = rnd() < skill ? 1 : 2 + Math.floor(rnd() * 2);
        ev({ type: 'discovery', island: isl.id, item: d.id, text: d.title, tries, ok: tries === 1 }); found++;
      }
      let pass = false;
      for (let attempt = 0; attempt < 2 && !pass; attempt++) {
        const qs = [...isl.quiz].sort(() => rnd() - .5).slice(0, 3); let sc = 0;
        for (const q of qs) {
          const hard = /意思|字/.test(q.q) ? .12 : 0;
          const ok = rnd() < skill - hard + attempt * .1;
          const wrongs = q.options.filter(o => o.id !== q.answer);
          const ans = ok ? q.options.find(o => o.id === q.answer) : (rnd() < .65 ? wrongs[0] : pick(wrongs));
          if (ok) { sc++; correctQ.add(q.id); }
          ev({ type: 'answer', ctx: 'challenge', island: isl.id, item: q.id, text: q.q, answer: ans.text, right: q.options.find(o => o.id === q.answer).text, ok });
        }
        pass = sc >= 2; best[isl.id] = Math.max(best[isl.id] || 0, sc);
        ev({ type: 'challenge', island: isl.id, text: `${isl.name} 島主挑戰`, score: sc, total: 3, ok: pass });
      }
      if (pass) stamps++;
      if (rnd() < .6 + eager * .3) {
        wsN++;
        const txt = isl.worksheet.map((w, i) => `${i + 1}. ${w.q}\n→ （示意）${pick(['我覺得', '我想', '詩裡'])}${pick(['畫面很安靜', '有聲音也有光', '作者很悠閒', '月亮讓鳥醒過來'])}。`).join('\n\n');
        W.push({ cls, seat, name, t: at(), island: isl.id, done: `${isl.worksheet.length}/${isl.worksheet.length}`, text: txt });
        ev({ type: 'worksheet', island: isl.id, text: `${isl.name} 學習單`, score: isl.worksheet.length, total: isl.worksheet.length });
      }
    }
    if (stamps >= 2 && rnd() < .8) { finalBest = Math.min(5, Math.round(skill * 5 + rnd())); finalPassed = finalBest >= 4; ev({ type: 'final', island: 'center', text: '最終挑戰', score: finalBest, total: 5, ok: finalPassed }); }
    const last = seat === 3 || seat === 22 ? base - 2 * 86400000 : t;
    const exp = found * 8 + stamps * 10 + correctQ.size * 10 + nIsl * 5;
    S.push({ cls, seat, name, last: new Date(last).toISOString(), level: exp >= 150 ? 4 : exp >= 80 ? 3 : exp >= 30 ? 2 : 1, exp, stamps: `${stamps}/${T.islands.length}`, found: `${found}/${T.discs.length}`, best: T.islands.map(i => best[i.id] ?? '-').join(' / '), final: finalBest + (finalPassed ? ' ✔通過' : ''), correctQ: correctQ.size, read: nIsl, worksheets: wsN, minutes: Math.round(15 + eager * 60), });
  }
  return { classes: [cls], summary: S, events: E, worksheets: W, at: new Date().toISOString() };
}

// ---------- 啟動 ----------
async function init() {
  await loadContent();
  $('#ep').value = store.get('ep', '');
  try { const pw = sessionStorage.getItem('shi2.teacher.pw'); if (pw) { $('#pw').value = pw; $('#remember').checked = true; } } catch (e) {}
  $('#login-form').addEventListener('submit', login);
  $('#demo').addEventListener('click', () => { T.demo = true; T.tab = 'overview'; store.set('sizes', Object.assign(store.get('sizes', {}), { 501: store.get('sizes', {})[501] || 26 })); setData(demoData()); toast('這是示範資料（示意）'); });
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => $('#' + b.dataset.goto).scrollIntoView({ behavior: 'smooth' })));
  $$('.tabs [data-tab]').forEach(b => b.addEventListener('click', () => { T.tab = b.dataset.tab; render(); }));
  $('#cls-pick').addEventListener('change', e => { T.cls = e.target.value; store.set('cls', T.cls); syncSize(); render(); });
  $('#cls-size').addEventListener('change', e => { const n = Number(e.target.value); const s = store.get('sizes', {}); if (n >= 1 && n <= 99) s[T.cls] = n; else delete s[T.cls]; store.set('sizes', s); render(); });
  $('#reload').addEventListener('click', () => { if (T.demo) { setData(demoData()); return; } if (!T.pw) { $('#login').hidden = false; return; } $('#pw').value = T.pw; login(); });
  $('#export').addEventListener('click', exportCSV);
  $('#logout').addEventListener('click', () => { T.data = null; T.pw = null; $('#pw').value = ''; try { sessionStorage.removeItem('shi2.teacher.pw'); } catch (e) {} $('#dash').hidden = true; $('#login').hidden = false; $('#setup').hidden = false; });
  $('#copy-code').addEventListener('click', async () => { try { await navigator.clipboard.writeText(T.code || ''); toast('已複製程式碼，貼到 Apps Script 編輯器'); } catch (e) { toast('複製失敗，請打開「看程式碼」手動複製'); } });
  fetch('teacher/apps-script.gs').then(r => r.text()).then(t => { T.code = t; $('#code-view').textContent = t; }).catch(() => { $('#code-view').textContent = '程式碼讀取失敗，請按「下載程式碼」。'; });
  if ($('#ep').value && $('#pw').value) login();
}
init();
