/**
 * 「詩兩首」學習紀錄表（Google Apps Script）
 * ------------------------------------------------------------
 * 用法（只要做一次）：
 *  1. 建立一份新的 Google 試算表 → 選單「擴充功能 → Apps Script」。
 *  2. 把這整份程式碼貼上，取代原本的內容，按「儲存」。
 *  3. 回到試算表重新整理，選單會出現「🏝️ 島嶼學習紀錄」→「① 設定班級代碼與教師密碼」。
 *  4. Apps Script 右上角「部署 → 新增部署作業 → 網頁應用程式」：
 *     執行身分「我」、存取權「所有人」→ 部署 → 複製網路應用程式網址。
 *  5. 把網址貼到網站的「教師後台」，就能產生學生用的班級連結與 QR Code。
 *
 * 安全說明：
 *  - 教師密碼只以雜湊值存在這份指令碼的「指令碼屬性」，不會寫進試算表或網站。
 *  - 只接受設定過的班級代碼；每次最多收 150 筆，每個欄位都會截短。
 *  - 學生只能「新增自己的紀錄」，看不到別人的資料；只有輸入教師密碼才能讀取全班紀錄。
 */

const SHEET_SUMMARY = '學生總覽';
const SHEET_EVENTS = '作答紀錄';
const SHEET_WS = '學習單';
const SUMMARY_HEAD = ['班級', '座號', '名字', '最後上線', '等級', 'EXP', '島章', '探索', '各島挑戰最佳', '最終挑戰', '答對題數', '已讀教材', '學習單', '學習分鐘', '裝置'];
const EVENT_HEAD = ['時間', '班級', '座號', '名字', '類型', '情境', '島', '項目', '題目／內容', '學生作答', '正確答案', '對錯', '分數', '滿分', '嘗試次數', '紀錄編號'];
const WS_HEAD = ['時間', '班級', '座號', '名字', '島', '完成題數', '內容'];

function onOpen() {
  SpreadsheetApp.getUi().createMenu('🏝️ 島嶼學習紀錄')
    .addItem('① 設定班級代碼與教師密碼', 'setupTeacher')
    .addItem('② 檢查設定', 'showStatus')
    .addToUi();
}

function setupTeacher() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const r1 = ui.prompt('班級代碼', '輸入可以登入的班級代碼，多個用逗號分開（英文或數字，例如：501,502）', ui.ButtonSet.OK_CANCEL);
  if (r1.getSelectedButton() !== ui.Button.OK) return;
  const codes = r1.getResponseText().split(/[,，\s]+/).map(s => s.trim()).filter(s => /^[A-Za-z0-9-]{1,12}$/.test(s));
  if (!codes.length) { ui.alert('沒有有效的班級代碼，請重新設定。'); return; }
  const r2 = ui.prompt('教師密碼', '設定教師後台的密碼（至少 6 個字，請不要用其他網站的密碼）', ui.ButtonSet.OK_CANCEL);
  if (r2.getSelectedButton() !== ui.Button.OK) return;
  const pw = r2.getResponseText();
  if (pw.length < 6) { ui.alert('密碼至少要 6 個字，請重新設定。'); return; }
  const salt = Utilities.getUuid();
  props.setProperties({ CLASS_CODES: codes.join(','), TEACHER_SALT: salt, TEACHER_HASH: hash_(salt + pw) });
  ensureSheets_();
  ui.alert('設定完成！\n\n班級代碼：' + codes.join('、') + '\n\n下一步：右上角「部署 → 新增部署作業 → 網頁應用程式」，執行身分選「我」、存取權選「所有人」，然後把網址貼到網站的教師後台。\n（之後改程式碼，要用「管理部署作業 → 編輯 → 新版本」更新，網址才不會變。）');
}

function showStatus() {
  const p = PropertiesService.getScriptProperties().getProperties();
  SpreadsheetApp.getUi().alert('班級代碼：' + (p.CLASS_CODES || '（還沒設定）') + '\n教師密碼：' + (p.TEACHER_HASH ? '已設定' : '還沒設定'));
}

function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function ensureSheets_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [[SHEET_SUMMARY, SUMMARY_HEAD], [SHEET_EVENTS, EVENT_HEAD], [SHEET_WS, WS_HEAD]].forEach(([name, head]) => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) { sh.appendRow(head); sh.setFrozenRows(1); sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#fde7c9'); }
  });
  const first = ss.getSheetByName('工作表1') || ss.getSheetByName('Sheet1');
  if (first && first.getLastRow() === 0 && ss.getSheets().length > 3) ss.deleteSheet(first);
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
const cut = (v, n) => String(v == null ? '' : v).slice(0, n || 200);
// 防止內容被試算表當成公式執行
const safe = (v, n) => { const s = cut(v, n); return /^[=+\-@]/.test(s) ? "'" + s : s; };

function doGet() {
  return json_({ ok: true, app: 'shi2-records', note: '這是「詩兩首」學習紀錄的接收網址，請在網站的教師後台使用。' });
}

function doPost(e) {
  let body;
  try { body = JSON.parse(e.postData.contents); } catch (err) { return json_({ ok: false, code: 'BAD_JSON', error: '資料格式不正確' }); }
  const props = PropertiesService.getScriptProperties().getProperties();
  if (!props.CLASS_CODES || !props.TEACHER_HASH) return json_({ ok: false, code: 'NOT_SETUP', error: '老師還沒完成紀錄表設定' });
  const classes = props.CLASS_CODES.split(',');
  try {
    if (body.op === 'hello') return json_({ ok: classes.indexOf(String(body.cls)) >= 0, code: classes.indexOf(String(body.cls)) >= 0 ? '' : 'BAD_CLASS' });
    if (body.op === 'push') return push_(body, classes);
    if (body.op === 'report') return report_(body, props, classes);
  } catch (err) {
    return json_({ ok: false, code: 'ERROR', error: '紀錄表發生錯誤：' + err.message });
  }
  return json_({ ok: false, code: 'BAD_OP', error: '不認得的指令' });
}

function push_(b, classes) {
  const cls = String(b.cls || ''), seat = Number(b.seat), name = cut(b.name, 12);
  if (classes.indexOf(cls) < 0) return json_({ ok: false, code: 'BAD_CLASS', error: '班級代碼不在老師的名單裡' });
  if (!(seat >= 1 && seat <= 99 && Math.floor(seat) === seat) || !name) return json_({ ok: false, code: 'BAD_STUDENT', error: '座號或名字不正確' });
  const events = Array.isArray(b.events) ? b.events.slice(0, 150) : [];
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureSheets_();
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    // 用紀錄編號去掉重複（網路斷線重送時）
    const cache = CacheService.getScriptCache();
    const seenKey = 'seen:' + cls + ':' + seat;
    const seen = JSON.parse(cache.get(seenKey) || '[]');
    const seenSet = {}; seen.forEach(id => { seenSet[id] = 1; });
    const rows = [], wsRows = [];
    events.forEach(ev => {
      const eid = cut(ev.eid, 40);
      if (!eid || seenSet[eid]) return;
      seenSet[eid] = 1; seen.push(eid);
      const t = new Date(ev.t); const time = isNaN(t) ? new Date() : t;
      const ok = ev.correct === true ? '✔' : ev.correct === false ? '✘' : '';
      rows.push([time, cls, seat, name, safe(ev.type, 20), safe(ev.ctx, 20), safe(ev.island, 20), safe(ev.item, 40), safe(ev.text, 200), safe(ev.answer, 200), safe(ev.right, 200), ok,
        ev.score == null ? '' : Number(ev.score) || 0, ev.total == null ? '' : Number(ev.total) || 0, ev.tries == null ? '' : Number(ev.tries) || 0, eid]);
      if (ev.type === 'worksheet') wsRows.push([time, cls, seat, name, safe(ev.island, 20), (Number(ev.score) || 0) + '/' + (Number(ev.total) || 0), safe(ev.detail, 1500)]);
    });
    if (rows.length) { const sh = ss.getSheetByName(SHEET_EVENTS); sh.getRange(sh.getLastRow() + 1, 1, rows.length, EVENT_HEAD.length).setValues(rows); }
    if (wsRows.length) { const sh = ss.getSheetByName(SHEET_WS); sh.getRange(sh.getLastRow() + 1, 1, wsRows.length, WS_HEAD.length).setValues(wsRows); }
    cache.put(seenKey, JSON.stringify(seen.slice(-600)), 21600);
    // 更新學生總覽（同班同座號一列）
    const s = b.summary || {};
    const row = [cls, seat, name, new Date(), Number(s.level) || 1, Number(s.exp) || 0, (Number(s.stamps) || 0) + '/' + (Number(s.islandsTotal) || 0),
      (Number(s.found) || 0) + '/' + (Number(s.foundTotal) || 0), safe(s.best, 60), (Number(s.finalBest) || 0) + (s.finalPassed ? ' ✔通過' : ''),
      Number(s.correctQ) || 0, Number(s.read) || 0, Number(s.worksheets) || 0, Number(s.minutes) || 0, safe(b.device, 20)];
    const sum = ss.getSheetByName(SHEET_SUMMARY);
    const n = sum.getLastRow() - 1;
    let found = -1;
    if (n > 0) {
      const keys = sum.getRange(2, 1, n, 2).getValues();
      for (let i = 0; i < keys.length; i++) if (String(keys[i][0]) === cls && Number(keys[i][1]) === seat) { found = i + 2; break; }
    }
    if (found > 0) sum.getRange(found, 1, 1, row.length).setValues([row]);
    else sum.appendRow(row);
    return json_({ ok: true, accepted: rows.length });
  } finally { lock.releaseLock(); }
}

function report_(b, props, classes) {
  const cache = CacheService.getScriptCache();
  const fails = Number(cache.get('fails') || 0);
  if (fails >= 10) return json_({ ok: false, code: 'LOCKED', error: '密碼錯太多次，請 10 分鐘後再試' });
  if (hash_(props.TEACHER_SALT + String(b.password || '')) !== props.TEACHER_HASH) {
    cache.put('fails', String(fails + 1), 600);
    return json_({ ok: false, code: 'BAD_PASSWORD', error: '教師密碼不正確' });
  }
  ensureSheets_();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const read = (name, head) => {
    const sh = ss.getSheetByName(name); const n = sh.getLastRow() - 1;
    if (n <= 0) return [];
    const start = Math.max(2, sh.getLastRow() - 19999); // 最多讀最近兩萬筆
    return sh.getRange(start, 1, sh.getLastRow() - start + 1, head.length).getValues()
      .map(r => r.map(v => v instanceof Date ? v.toISOString() : v));
  };
  const want = b.cls ? String(b.cls) : '';
  const f = rows => want ? rows.filter(r => String(r[1]) === want) : rows;
  const summary = read(SHEET_SUMMARY, SUMMARY_HEAD).filter(r => !want || String(r[0]) === want);
  return json_({ ok: true, classes: classes, summaryHead: SUMMARY_HEAD, summary: summary, eventHead: EVENT_HEAD, events: f(read(SHEET_EVENTS, EVENT_HEAD)), wsHead: WS_HEAD, worksheets: f(read(SHEET_WS, WS_HEAD)), at: new Date().toISOString() });
}
