import { GameState, Settings, shuffle } from './state.js';
import { Sound } from './audio.js';
import { $, $$, esc, h, toast, download, copyText, sampleBadge, today, avatarSvg, STYLE_NAMES, STYLE_ICONS } from './ui.js';

const PHASE = { day: ['☀️', '白天'], dusk: ['🌇', '黃昏'], night: ['🌙', '夜晚'] };
const MODE_NAME = { scene: '跟著課文情境', day: '白天', dusk: '黃昏', night: '夜晚', auto: '自動流動', realtime: '同步現在時間' };
const AMBIENCE = { center: 'plaza', 'island-01': 'forest', 'island-02': 'stream', 'island-03': 'garden', 'island-04': 'forest' };
const FX_SOUND = { murmur: 'murmur', beam: 'moon', deer: 'hop', tablet: 'page', stele: 'page', petals: 'petals', stream: 'water', moon: 'moon', spring: 'petals', blocks: 'hop', windmill: 'whoosh', door: 'door', flowers: 'petals', painting: 'moon', scroll: 'page', bamboo: 'wind', home: 'door' };
const NPC_FACE = ['🧑‍🌾', '🏮', '🤓', '🧓'];
const ANIMAL_NAME = { duck: '鴨子', butterfly: '蝴蝶', penguin: '企鵝', turtle: '海龜', dolphin: '海豚', cat: '貓咪', dog: '小狗', rabbit: '兔子' };
const ANIMAL_ICON = { duck: '🦆', butterfly: '🦋', penguin: '🐧', turtle: '🐢', dolphin: '🐬', cat: '🐱', dog: '🐶', rabbit: '🐰' };

const app = {
  content: null, state: null, world: null,
  panelId: null, tab: null, bubbleAgent: null, modalReturn: null,
  isMobile: () => window.matchMedia('(max-width: 760px)').matches || window.matchMedia('(pointer: coarse)').matches,
  reduced: false
};
window.__app = app; // 方便測試

// ============================================================
async function boot() {
  let content;
  try {
    const res = await fetch('data/content.json', { cache: 'no-cache' });
    content = await res.json();
  } catch (e) {
    $('#loading p').textContent = '內容檔讀取失敗，請重新整理頁面。';
    return;
  }
  app.content = content;
  app.state = new GameState(content);
  app.islandList = [{ ...content.center, id: 'center', order: 0 }, ...content.islands];
  app.byId = Object.fromEntries(app.islandList.map(i => [i.id, i]));
  app.sound = new Sound({ music: Settings.get('music'), sfx: Settings.get('sfx'), volume: Settings.get('volume') });
  app.discById = {};
  app.islandList.forEach(isl => (isl.discoveries || []).forEach(d => { app.discById[d.id] = { ...d, island: isl.id }; }));
  app.questionById = {};
  content.islands.forEach(i => i.quiz.forEach(q => { app.questionById[q.id] = { ...q, island: i.id }; }));

  // 文字
  document.title = `${content.site.title}｜${content.site.tagline}`;
  $('#site-title').textContent = content.site.title;
  $('#site-tagline').textContent = `${content.site.tagline}・${content.site.author}`;
  $('#site-footer').textContent = content.site.footer;

  // 設定
  applyTheme(Settings.get('theme') || 'sunset', false);
  const sysReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  app.reduced = Settings.get('reduced') ?? sysReduced;
  document.body.classList.toggle('reduced', app.reduced);

  bindUI();
  app.state.on(onStateEvent);
  renderHUD();

  // 3D
  let ok = false;
  const glOk = (() => { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; } })();
  if (glOk && !new URLSearchParams(location.search).has('nowebgl')) {
    try {
      const { World } = await import('./world/world.js');
      const q = Settings.get('quality');
      const quality = q === 'auto' ? (app.isMobile() ? 'low' : 'high') : q;
      app.world = new World($('#scene'), content, { mobile: app.isMobile(), quality, reduced: app.reduced, theme: Settings.get('theme') || 'sunset' });
      await app.world.init();
      ok = true;
    } catch (e) {
      console.warn('3D 無法啟動，改用文字清單版：', e.message);
      app.world = null;
    }
  }
  if (!ok) document.body.classList.add('no-webgl');
  else wireWorld();

  if (!Settings.get('v2')) { Settings.set('timeMode', 'scene'); Settings.set('v2', true); }
  setTimeMode(Settings.get('timeMode') || 'scene', false);
  if (app.world) app.world.setFoundState(app.state.foundList());
  syncSoundButton();
  buildLabels();
  $('#loading').classList.add('done');
  setTimeout(() => $('#loading').remove(), 600);

  if (!ok) {
    openList(true);
    return;
  }
  const firstTime = !Settings.get('introSeen');
  if (firstTime && !app.reduced) playIntro(afterIntro);
  else afterIntro();
}

function afterIntro() {
  Settings.set('introSeen', true);
  const s = app.state;
  if (s.hasAdventurer) {
    app.world.setPlayer(s.save.style, s.save.at || 'center');
    toast(`歡迎回來，${s.save.name}！`);
  } else if (!Settings.get('browseChosen')) {
    openCreate();
  }
}

// ============================================================
// 3D 世界的事件
function wireWorld() {
  const w = app.world;
  w.on.frame = dt => { updateLabels(); updateBubble(); updateShells(); updateSpots(); updateNear(); stepSounds(dt); };
  w.on.tapAnchor = (island, key) => { const d = findDisc(island, key); if (d) openDiscovery(d.id); };
  w.on.skip = () => skipIntro();
  w.on.tapAgent = agent => openBubble(agent);
  w.on.tapShell = i => pickShell(i);
  w.on.tapIsland = (id, point) => {
    closeBubble();
    if (w.player && app.state.hasAdventurer) {
      if (!w.movePlayerToPoint(point)) toast('那裡走不過去，換個地方試試。');
      else w.setFollow(Settings.get('follow') !== false);
    } else openIsland(id);
  };
  w.on.tapGround = p => { if (w.player) w.movePlayerToPoint(p); };
  w.on.tapEmpty = () => closeBubble();
  w.on.playerEnter = id => {
    app.sound.play('tick');
    const gained = app.state.visit(id);
    if (gained) toast(`第一次登上「${app.byId[id].name}」 +${app.content.rpgRules.firstVisit} EXP`);
    renderHUD();
  };
  w.on.autoLow = () => { toast('畫面有點卡，已自動切換成低畫質。'); };
  setInterval(updateClock, 500);
  updateClock();
}

function playIntro(done) {
  setFocus(null);
  document.body.classList.add('cinema');
  const intro = $('#intro'); intro.hidden = false;
  app.introDone = () => {
    document.body.classList.remove('cinema');
    intro.hidden = true;
    app.introDone = null;
    done && done();
  };
  app.world.playIntro(() => app.introDone && app.introDone());
}
function skipIntro() {
  if (!app.introDone) return;
  app.world.skipIntro();
  app.introDone && app.introDone();
}

// ============================================================
// 主題、時段、設定
function applyTheme(name, save = true) {
  document.documentElement.setAttribute('data-theme', name);
  $$('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeSet === name)));
  if (save) {
    Settings.set('theme', name);
    if (app.world) app.world.setTheme(name);
    if (name === 'dusk') setTimeMode('night');
  }
}
function setTimeMode(mode, save = true) {
  if (save) Settings.set('timeMode', mode);
  if (app.world) app.world.setTimeMode(mode);
  $$('[data-time]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.time === mode)));
  updateClock();
}
function updateClock() {
  const now = new Date();
  const real = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const btn = $('#clock');
  if (!app.world) { btn.innerHTML = `<strong>🕰️ ${real}</strong><small>現在時間</small>`; return; }
  const ti = app.world.timeInfo();
  const [icon, label] = PHASE[ti.phase];
  btn.innerHTML = `<strong>${icon} ${label} ${ti.text}</strong><small>現在 ${real}・${MODE_NAME[ti.mode]}</small>`;
  btn.setAttribute('aria-label', `島上時間 ${label} ${ti.text}，現在時間 ${real}，模式：${MODE_NAME[ti.mode]}。按一下切換時段`);
}
function setReduced(v) {
  app.reduced = v;
  Settings.set('reduced', v);
  document.body.classList.toggle('reduced', v);
  if (app.world) app.world.setReduced(v);
}
function setQuality(q) {
  Settings.set('quality', q);
  if (app.world) app.world.setQuality(q === 'auto' ? (app.isMobile() ? 'low' : 'high') : q);
}

// ============================================================
// 島名標籤（HTML 疊在 3D 上，跟著島移動、不重疊）
function buildLabels() {
  const box = $('#labels');
  box.innerHTML = '';
  app.labels = app.islandList.map(isl => {
    const el = h(`<button type="button" class="island-label ${isl.id === 'center' ? 'center' : ''}" data-island="${isl.id}">
      <span class="num">${isl.id === 'center' ? '★' : isl.order}</span><span class="nm">${esc(isl.name)}</span><span class="state"></span></button>`);
    el.addEventListener('click', () => openIsland(isl.id));
    box.appendChild(el);
    return { id: isl.id, el };
  });
  app.shellBtns = [];
  updateLabelStates();
}
function updateLabelStates() {
  if (!app.labels) return;
  const s = app.state.save, course = app.state.course();
  for (const l of app.labels) {
    const st = l.el.querySelector('.state');
    let text = '', done = false;
    if (l.id === 'center') {
      if (s) { text = app.state.centerUnlocked() ? (s.finalPassed ? '已通過' : '最終挑戰開放') : `島章 ${s.stamps.length}/${app.content.rpgRules.centerUnlockStamps}`; done = s.finalPassed; }
    } else if (s && s.stamps.includes(l.id)) { text = '✓ 島章'; done = true; }
    else if (course.read.includes(l.id)) text = '已讀';
    else text = '新';
    st.textContent = text; st.classList.toggle('done', done);
    l.el.setAttribute('aria-label', `${l.id === 'center' ? '中央島' : '第 ' + app.byId[l.id].order + ' 島'}：${app.byId[l.id].name}，${text}`);
  }
}
function updateLabels() {
  const w = app.world; if (!w || !app.labels) return;
  const rects = [];
  for (const l of app.labels) {
    const isl = w.islandById[l.id];
    const p = w.project(isl.labelPos);
    const vis = p.front && p.x > -60 && p.x < w._w + 60 && p.y > 0 && p.y < w._h + 40;
    l.el.classList.toggle('hidden', !vis);
    if (!vis) continue;
    const r = { id: l.id, x: p.x, y: p.y, w: l.el.offsetWidth || 120, h: l.el.offsetHeight || 44, el: l.el };
    rects.push(r);
  }
  // 由上往下排，重疊時往上推
  rects.sort((a, b) => b.y - a.y);
  for (let i = 0; i < rects.length; i++) for (let j = 0; j < i; j++) {
    const a = rects[i], b = rects[j];
    const ox = (a.w + b.w) / 2 + 6 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 + 4 - Math.abs(a.y - b.y);
    if (ox > 0 && oy > 0) a.y = b.y - (a.h + b.h) / 2 - 4;
  }
  for (const r of rects) r.el.style.transform = `translate(${Math.round(r.x - r.w / 2)}px, ${Math.round(Math.max(r.h + 60, r.y) - r.h)}px)`;
}

// 貝殼的 HTML 按鈕（鍵盤也點得到、觸控範圍大）
function updateShells() {
  const w = app.world; if (!w) return;
  const box = $('#labels');
  w.shells.forEach((sh, i) => {
    let b = app.shellBtns[i];
    if (!b) {
      b = h(`<button type="button" class="shell-pick" aria-label="撿起貝殼（${esc(app.byId[sh.island].name)}）">🐚</button>`);
      b.addEventListener('click', () => pickShell(i));
      box.appendChild(b); app.shellBtns[i] = b;
    }
    const p = w.project(sh.mesh.position, .2);
    const near = w.camera.position.distanceTo(sh.mesh.position) < 70;
    const vis = sh.active && p.front && near && !document.body.classList.contains('cinema');
    b.classList.toggle('hidden', !vis);
    if (vis) b.style.transform = `translate(${Math.round(p.x - 22)}px, ${Math.round(p.y - 22)}px)`;
  });
}
function pickShell(i) {
  if (!app.world.pickShell(i)) return;
  app.state.addItem('shell', 1);
  app.sound.play('shell');
  toast('撿到 🐚 貝殼 +1（20 秒後會再出現）');
  bumpBag();
}

// ============================================================
// HUD
function renderHUD() {
  const s = app.state, hud = $('#hud');
  const bag = s.bag(); const count = Object.values(bag).reduce((a, b) => a + b, 0);
  if (!s.hasAdventurer) {
    hud.innerHTML = `<button type="button" class="browse-btn" id="hud-create">🧭 建立冒險者</button>
      <button type="button" class="mini" id="hud-bag" aria-label="背包，共 ${count} 件">🎒<em>${count}</em></button>`;
  } else {
    const exp = s.exp(), lv = s.levelOf(exp), [a, b] = s.levelRange(lv);
    const pct = Math.round((exp - a) / (b - a) * 100);
    hud.innerHTML = `<div class="avatar" aria-hidden="true">${STYLE_ICONS[s.save.style] || '🧭'}</div>
      <div class="meta"><div class="name">${esc(s.save.name)} <span class="lv">Lv ${lv}</span></div>
      <div class="expbar" role="progressbar" aria-label="經驗值" aria-valuemin="${a}" aria-valuemax="${b}" aria-valuenow="${exp}"><i style="width:${pct}%"></i></div>
      <small>EXP ${exp}・島章 ${s.save.stamps.length}/${app.content.islands.length}</small></div>
      <button type="button" class="mini" id="hud-bag" aria-label="背包，共 ${count} 件">🎒<em>${count}</em></button>`;
  }
  $('#hud-bag').addEventListener('click', openBag);
  const c = $('#hud-create'); if (c) c.addEventListener('click', openCreate);
}
function bumpBag() { renderHUD(); const b = $('#hud-bag'); if (b && !app.reduced) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); } }
function onStateEvent(type, d) {
  if (type === 'levelup') showLevelUp(d.level);
  if (type === 'change' || type === 'profile' || type === 'bag') { renderHUD(); updateLabelStates(); }
  if (type === 'profile' && app.world) {
    const s = app.state.save;
    app.world.setPlayer(s ? s.style : null, s ? (s.at || 'center') : 'center');
    app.world.resetFoundState(); app.world.setFoundState(app.state.foundList());
  }
  if (type === 'change' || type === 'profile') renderBanner();
}
function showLevelUp(lv) {
  app.sound.play('levelup');
  const el = $('#levelup');
  const lines = app.content.rpgRules.levelUpLines;
  el.innerHTML = `<strong>Lv ${lv}</strong>${esc(lines[(lv - 2) % lines.length])}`;
  el.hidden = false;
  el.classList.remove('anim'); void el.offsetWidth;
  if (!app.reduced) el.classList.add('anim');
  clearTimeout(app.lvTimer);
  app.lvTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

// ============================================================
// 打開一座島
function openIsland(id, opts = {}) {
  closeBubble();
  const w = app.world;
  closeModal(true);
  if (!w) { showPanel(id, opts.tab); if (app.state.hasAdventurer) { const g = app.state.visit(id); if (g) toast(`第一次登上「${app.byId[id].name}」 +5 EXP`); } return; }
  closeCard(true);
  if (!$('#panel').hidden && !opts.tab) { $('#panel').hidden = true; app.panelId = null; w.setViewShift(0, 0); w.inputEnabled = true; }
  if (w.player && app.state.hasAdventurer) {
    w.setFollow(false);
    w.walkPlayerTo(id, () => { w.setFollow(Settings.get('follow') !== false); });
  } else if (app.state.hasAdventurer) { const g = app.state.visit(id); if (g) toast(`第一次登上「${app.byId[id].name}」 +5 EXP`); }
  setFocus(id);
  app.sound.play('open');
  w.flyToIsland(id, () => {
    if (opts.tab) showPanel(id, opts.tab);
    else if (!Settings.get('spotHint')) { Settings.set('spotHint', true); toast('找找島上閃閃發亮的 ✨，點一下就能探索！', 4200); }
  });
}
function setFocus(id) {
  app.focus = id;
  if (app.world) app.world.setSceneFocus(id || 'center');
  const isl = id ? app.byId[id] : null;
  app.sound.setAmbience(id ? AMBIENCE[id] || 'sea' : 'sea', isl && Settings.get('timeMode') === 'scene' ? (isl.mood || 'day') : undefined);
  renderBanner();
}
function renderBanner() {
  const b = $('#banner'), id = app.focus;
  if (!id || !app.world) { b.hidden = true; return; }
  const isl = app.byId[id], f = app.state.foundOn(id);
  const stamped = app.state.save && app.state.save.stamps.includes(id);
  const open = id !== 'center' && app.state.challengeOpen(id);
  const mood = { dusk: '黃昏', night: '春天的夜晚', day: '白天' }[isl.mood] || '';
  b.innerHTML = `<span class="t">${esc(isl.name)}</span><span class="m">${esc(mood)}・探索 ${f.done}/${f.total}${stamped ? '・🏅' : ''}</span>
    <button class="btn sm ghost" type="button" data-b="book">📖 手冊</button>
    ${id === 'center' ? '<button class="btn sm" type="button" data-b="final">⚔️ 最終挑戰</button>' : `<button class="btn sm${open ? '' : ' ghost'}" type="button" data-b="boss" ${open ? '' : 'aria-disabled="true"'}>⚔️ 島主挑戰</button>`}`;
  b.hidden = false;
  b.querySelector('[data-b="book"]').addEventListener('click', () => { closeCard(true); showPanel(id, id === 'center' ? 'overview' : 'explore'); });
  const boss = b.querySelector('[data-b="boss"]'); if (boss) boss.addEventListener('click', () => openBoss(id));
  const fin = b.querySelector('[data-b="final"]'); if (fin) fin.addEventListener('click', () => openFinalCard());
}
function showPanel(id, tab) {
  const isl = app.byId[id];
  app.panelId = id;
  const panel = $('#panel');
  panel.hidden = false;
  $('#panel-kicker').textContent = id === 'center' ? '中央島・總複習島' : `第 ${isl.order} 島・課程群島`;
  $('#panel-title').textContent = isl.name;
  const tabs = id === 'center' ? [['overview', '總覽'], ['explore', '探索'], ['review', '總複習'], ['final', '最終挑戰'], ['passport', '護照']] : [['explore', '探索'], ['material', '教材'], ['worksheet', '學習單'], ['challenge', '島主挑戰']];
  const body = $('#panel-body');
  const npc = id === 'center' ? { name: app.content.mascot.name, title: '群島嚮導', sample: true, story: app.content.mascot.centerLines, hint: app.content.mascot.tips } : isl.npc;
  const face = id === 'center' ? '<svg aria-hidden="true"><use href="#mascot"/></svg>' : NPC_FACE[(isl.order - 1) % NPC_FACE.length];
  body.innerHTML = `
    <p class="intro-line">${esc(isl.intro)}</p>
    <div class="npc-box">
      <div class="npc-face" aria-hidden="true">${face}</div>
      <div style="flex:1;min-width:0">
        <h3>${esc(npc.name)} <small class="note">${esc(npc.title)}</small>${sampleBadge(npc.sample)}</h3>
        <p class="say" id="npc-say" aria-live="polite">${esc(npc.story[0])}</p>
        <div class="npc-actions">
          <button class="btn sm ghost" type="button" data-npc="story">📖 聽故事</button>
          <button class="btn sm ghost" type="button" data-npc="hint">💡 給提示</button>
          <button class="btn sm" type="button" data-npc="go">⚔️ ${id === 'center' ? '最終挑戰' : '接受挑戰'}</button>
        </div>
      </div>
    </div>
    <div class="tabs" role="tablist" aria-label="${esc(isl.name)} 分頁">${tabs.map(([k, n]) => `<button class="tab" role="tab" type="button" id="tab-${k}" aria-controls="tabpanel" data-tab="${k}">${n}</button>`).join('')}</div>
    <div id="tabpanel" role="tabpanel"></div>`;
  let si = 0, hi = -1;
  body.querySelector('[data-npc="story"]').addEventListener('click', () => { si = (si + 1) % npc.story.length; $('#npc-say').textContent = npc.story[si]; });
  body.querySelector('[data-npc="hint"]').addEventListener('click', () => { hi = (hi + 1) % npc.hint.length; $('#npc-say').textContent = '提示：' + npc.hint[hi]; });
  body.querySelector('[data-npc="go"]').addEventListener('click', () => selectTab(id === 'center' ? 'final' : 'challenge'));
  app.sound.play('open');
  $$('.tab', body).forEach(b => {
    b.addEventListener('click', () => selectTab(b.dataset.tab));
    b.addEventListener('keydown', e => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const all = $$('.tab', body), i = all.indexOf(b), n = all[(i + (e.key === 'ArrowRight' ? 1 : all.length - 1)) % all.length];
      n.focus(); n.click(); e.preventDefault();
    });
  });
  selectTab(tab || tabs[0][0]);
  $('#panel-title').focus({ preventScroll: true });
  if (app.world) { app.world.inputEnabled = false; applyViewShift(); }
}
function applyViewShift() {
  const w = app.world; if (!w) return;
  if ($('#panel').hidden) { w.setViewShift(0, 0); return; }
  if (window.innerWidth <= 760) w.setViewShift(0, window.innerHeight * .36);
  else w.setViewShift(($('#panel').offsetWidth + 10) / 2, 0);
}
window.addEventListener('resize', () => applyViewShift());
function selectTab(k) {
  app.tab = k;
  $$('#panel-body .tab').forEach(b => { b.setAttribute('aria-selected', String(b.dataset.tab === k)); b.tabIndex = b.dataset.tab === k ? 0 : -1; });
  const tp = $('#tabpanel');
  tp.setAttribute('aria-labelledby', 'tab-' + k);
  const id = app.panelId;
  if (k === 'explore') renderExploreList(tp, app.byId[id]);
  else if (k === 'material') renderMaterial(tp, app.byId[id]);
  else if (k === 'worksheet') renderWorksheet(tp, app.byId[id]);
  else if (k === 'challenge') renderChallengeIntro(tp, app.byId[id]);
  else if (k === 'overview') renderOverview(tp);
  else if (k === 'review') renderReview(tp);
  else if (k === 'final') renderFinal(tp);
  else if (k === 'passport') renderPassport(tp);
}
function closePanel() {
  if ($('#panel').hidden) return;
  $('#panel').hidden = true;
  app.panelId = null;
  if (app.world) { app.world.inputEnabled = true; app.world.setViewShift(0, 0); app.world.flyHome(); }
  const lbl = app.labels && app.labels[0]; if (lbl) lbl.el.focus({ preventScroll: true });
}

// ---------- 教材 ----------
function renderSections(isl) {
  return (isl.sections || []).map(sec => {
    let inner = '';
    if (sec.type === 'poem') inner = `<div class="poem" lang="zh-Hant">${sec.lines.map(esc).join('<br>')}</div>`;
    else if (sec.type === 'glossary') inner = `<dl class="gloss">${sec.items.map(([t, d]) => `<dt>${esc(t)}</dt><dd>${esc(d)}</dd>`).join('')}</dl>`;
    else if (sec.type === 'text') inner = sec.body.map(p => `<p>${esc(p)}</p>`).join('');
    else if (sec.type === 'list') inner = `<ul class="points">${sec.items.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`;
    else if (sec.type === 'table') inner = `<div class="tbl-wrap"><table class="tbl"><thead><tr>${sec.head.map(x => `<th scope="col">${esc(x)}</th>`).join('')}</tr></thead><tbody>${sec.rows.map(r => `<tr>${r.map((c, i) => i ? `<td>${esc(c)}</td>` : `<th scope="row">${esc(c)}</th>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    return `<section class="sec"><h3>${esc(sec.title)}</h3>${inner}</section>`;
  }).join('');
}
function renderMaterial(tp, isl) {
  tp.innerHTML = `
    <section class="sec"><h3>內容重點</h3><ul class="points">${isl.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul></section>
    <section class="sec"><h3>學習目標</h3><p class="goal">${esc(isl.goal)}</p></section>
    ${renderSections(isl)}
    ${isl.link ? `<p><a class="btn alt" href="${esc(isl.link)}" target="_blank" rel="noopener">開啟相關連結 ↗</a></p>` : ''}
    <p class="note">內容依五年級國語第七課教材改寫整理。</p>
    <div class="row"><button class="btn" type="button" id="go-ws">下一步：寫學習單 →</button></div>`;
  $('#go-ws', tp).addEventListener('click', () => selectTab('worksheet'));
  app.state.markRead(isl.id);
}

// ---------- 學習單 ----------
function renderWorksheet(tp, isl) {
  const c = app.state.course();
  const saved = c.wsSaved.includes(isl.id);
  tp.innerHTML = `
    <p class="note">寫下你的想法，會自動存成草稿（只存在這台電腦的瀏覽器裡）。${saved ? '<strong>✓ 已存過學習單</strong>' : ''}</p>
    ${isl.worksheet.map((w, i) => `<div class="ws-item"><label for="${w.id}">${i + 1}. ${esc(w.q)}</label><textarea id="${w.id}" data-ws="${w.id}" placeholder="在這裡寫……">${esc(c.ws[w.id] || '')}</textarea></div>`).join('')}
    <div class="row">
      <button class="btn" type="button" id="ws-save">💾 儲存學習單</button>
      <button class="btn alt" type="button" id="ws-export">⬇️ 匯出 Markdown</button>
      <button class="btn ghost" type="button" id="ws-clear">清空</button>
    </div>
    <p class="note" id="ws-msg" aria-live="polite"></p>`;
  let timer;
  $$('textarea[data-ws]', tp).forEach(ta => ta.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { app.state.updateCourse(cc => { cc.ws[ta.dataset.ws] = ta.value; }); $('#ws-msg', tp).textContent = '草稿已自動儲存。'; }, 400);
  }));
  const collect = () => { app.state.updateCourse(cc => { $$('textarea[data-ws]', tp).forEach(ta => { cc.ws[ta.dataset.ws] = ta.value; }); }); };
  $('#ws-save', tp).addEventListener('click', () => {
    collect();
    const empty = $$('textarea[data-ws]', tp).filter(t => !t.value.trim()).length;
    app.state.updateCourse(cc => { if (!cc.wsSaved.includes(isl.id)) cc.wsSaved.push(isl.id); });
    $('#ws-msg', tp).textContent = empty ? `已儲存（還有 ${empty} 題空白，可以之後再補）。` : '已儲存學習單！';
    toast('學習單已儲存');
  });
  $('#ws-export', tp).addEventListener('click', () => {
    collect();
    const name = app.state.save ? app.state.save.name : '';
    const md = `# ${app.content.site.title}｜${isl.name} 學習單\n\n- 姓名／代號：${name}\n- 日期：${today()}\n\n` + isl.worksheet.map((w, i) => `## ${i + 1}. ${w.q}\n\n${($('#' + w.id, tp).value || '（未作答）').trim()}\n`).join('\n');
    download(`${app.content.site.title}-${isl.name}-學習單.md`, md, 'text/markdown;charset=utf-8');
  });
  $('#ws-clear', tp).addEventListener('click', () => {
    askConfirm('確定要清空這座島的學習單嗎？', '清空').then(ok => { if (!ok) return;
    $$('textarea[data-ws]', tp).forEach(t => { t.value = ''; });
    collect(); $('#ws-msg', tp).textContent = '已清空。'; });
  });
}

// ---------- 挑戰（一次一題、作答後鎖定、看詳解） ----------
function renderChallengeIntro(tp, isl, inCard) {
  const s = app.state, r = app.content.rpgRules;
  if (!s.challengeOpen(isl.id)) {
    const f = s.foundOn(isl.id);
    tp.innerHTML = `<div class="result-box"><p>🔒 島主挑戰還沒開放。</p><p>先完成島上的探索：<strong>${f.done} / ${f.total}</strong>（需要 ${Math.min(r.challengeNeed, f.total)} 個）。</p><p class="note">在島上找找閃閃發亮的 ✨，點一下就能探索。</p></div>`;
    if (!inCard) { tp.insertAdjacentHTML('beforeend', '<button class="btn" type="button" id="go-explore">看看要探索什麼</button>'); $('#go-explore', tp).addEventListener('click', () => selectTab('explore')); }
    return;
  }
  const best = s.save ? (s.save.best[isl.id] ?? null) : (s.course().quiz[isl.id] ?? null);
  const stamped = s.save && s.save.stamps.includes(isl.id);
  tp.innerHTML = `
    <div class="result-box">
      <p><strong>隨堂三題</strong>：從本島題庫隨機抽 ${r.questionsPerChallenge} 題，答對 ${r.passCorrect} 題以上就過關${s.hasAdventurer ? '、得到島章' : ''}。可以重玩。</p>
      <p class="note">最佳成績：${best == null ? '還沒挑戰' : best + ' / ' + r.questionsPerChallenge}　${stamped ? '・✓ 已得到島章' : ''}</p>
      ${s.hasAdventurer ? `<p class="note">EXP：第一次答對 +${r.firstCorrect}、再答對 +${r.repeatCorrect}、第一次過關 +${r.firstClear}</p>` : '<p class="note">現在是「先逛逛」模式：可以作答，但不會記錄 EXP 與島章。</p>'}
      <span class="tag-self">自編練習題（依教材改寫）</span>
    </div>
    <div class="row"><button class="btn" type="button" id="ch-start">⚔️ 開始挑戰</button>
    ${!s.hasAdventurer ? '<button class="btn ghost" type="button" id="ch-create">建立冒險者</button>' : ''}</div>`;
  $('#ch-start', tp).addEventListener('click', () => {
    const qs = shuffle(isl.quiz).slice(0, r.questionsPerChallenge);
    runQuiz(tp, qs, score => {
      app.state.updateCourse(cc => { cc.quiz[isl.id] = Math.max(cc.quiz[isl.id] || 0, score); });
      const res = app.state.finishChallenge(isl.id, score);
      const pass = score >= r.passCorrect;
      if (res && res.stamped) { toast(`🏅 得到「${isl.name}」島章！ +${r.firstClear} EXP`); app.sound.play('stamp'); }
      renderBanner();
      return `<div class="result-box"><p style="font-size:20px"><strong>${score} / ${qs.length}</strong>　${pass ? '🎉 過關！' : '差一點點，再試一次！'}</p>
        ${res && res.stamped ? `<p>🏅 你得到了「${esc(isl.name)}」島章！</p>` : pass && app.state.save ? '<p class="note">這座島的島章已經蓋過了，重玩不會重複蓋章。</p>' : ''}
        ${app.state.centerUnlocked() && res && res.stamped ? '<p>中央島的最終挑戰已經開放了！</p>' : ''}</div>`;
    }, () => renderChallengeIntro(tp, isl, inCard), inCard ? { onBack: closeCard } : {});
  });
  const cc = $('#ch-create', tp); if (cc) cc.addEventListener('click', openCreate);
}
function runQuiz(tp, questions, onFinish, onAgain, opts = {}) {
  let i = 0, score = 0;
  const show = () => {
    const q = questions[i];
    const opts2 = shuffle(q.options);
    tp.innerHTML = `
      <div class="progress-dots" aria-hidden="true">${questions.map((_, k) => `<i class="${k < i ? 'on' : ''}"></i>`).join('')}</div>
      <p class="note">第 ${i + 1} 題 / 共 ${questions.length} 題${opts.label ? '・' + esc(opts.label) : ''}</p>
      <p class="quiz-q" id="qq">${esc(q.q)}</p>
      <div class="opts" role="group" aria-labelledby="qq">${opts2.map((o, k) => `<button type="button" class="opt" data-opt="${o.id}"><span class="k">${'ABCD'[k]}</span><span>${esc(o.text)}</span></button>`).join('')}</div>
      <div id="fb" aria-live="polite"></div>`;
    $$('.opt', tp).forEach(b => b.addEventListener('click', () => answer(q, b.dataset.opt)));
    const first = $('.opt', tp); first && first.focus({ preventScroll: true });
  };
  const answer = (q, chosen) => {
    const correct = chosen === q.answer; // 以選項 ID 判分
    if (correct) score++;
    app.sound.play(correct ? 'correct' : 'wrong');
    $$('.opt', tp).forEach(b => {
      b.disabled = true;
      if (b.dataset.opt === q.answer) b.classList.add('correct');
      if (b.dataset.opt === chosen) { b.setAttribute('aria-checked', 'true'); if (!correct) b.classList.add('wrong'); }
    });
    let gain = 0;
    if (correct && app.state.hasAdventurer) gain = app.state.recordAnswer(q.id, true) || 0;
    const last = i === questions.length - 1;
    $('#fb', tp).innerHTML = `<div class="feedback ${correct ? 'ok' : 'no'}"><strong>${correct ? '✅ 答對了！' : '❌ 再想想看'}</strong>${gain ? `<span class="note">（+${gain} EXP）</span>` : ''}
      <p>${esc(q.explain)}</p><button class="btn" type="button" id="next">${last ? '看結果' : '下一題 →'}</button></div>`;
    $('#next', tp).addEventListener('click', () => { i++; if (i < questions.length) show(); else finish(); });
    $('#next', tp).focus({ preventScroll: true });
  };
  const finish = () => {
    const html = onFinish(score);
    tp.innerHTML = html + `<div class="row"><button class="btn" type="button" id="again">🔁 再玩一次</button><button class="btn ghost" type="button" id="back">${opts.onBack ? '回到島上' : '回到教材'}</button></div>`;
    $('#again', tp).addEventListener('click', onAgain);
    $('#back', tp).addEventListener('click', () => opts.onBack ? opts.onBack() : selectTab(app.panelId === 'center' ? 'overview' : 'material'));
    $('#again', tp).focus({ preventScroll: true });
  };
  show();
}

// ---------- 中央島：總覽、總複習、最終挑戰、護照 ----------
function progressHtml() {
  const s = app.state, c = s.course(), r = app.content.rpgRules;
  return `<ul class="prog-list">${app.content.islands.map(isl => {
    const stamped = s.save && s.save.stamps.includes(isl.id);
    const quiz = s.save ? s.save.best[isl.id] : c.quiz[isl.id];
    return `<li><strong>${isl.order}. ${esc(isl.name)}</strong><span>${c.read.includes(isl.id) ? '✓已讀' : '未讀'}・${c.wsSaved.includes(isl.id) ? '✓學習單' : '學習單未存'}・挑戰 ${quiz == null ? '—' : quiz + '/' + r.questionsPerChallenge}${stamped ? '・🏅' : ''}</span></li>`;
  }).join('')}<li><strong>★ 總複習</strong><span>${c.review ? `最佳 ${c.review.best}/${c.review.total}` : '還沒做'}</span></li></ul>`;
}
function renderOverview(tp) {
  const isl = app.byId.center;
  tp.innerHTML = `
    <section class="sec"><h3>這一課的重點</h3><ul class="points">${isl.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul></section>
    <section class="sec"><h3>學習目標</h3><p class="goal">${esc(isl.goal)}</p></section>
    <section class="sec"><h3>學習進度</h3>${progressHtml()}</section>
    <div class="row"><button class="btn alt" type="button" id="ov-review">做總複習</button><button class="btn ghost" type="button" id="ov-clear">清除學習進度</button></div>`;
  $('#ov-review', tp).addEventListener('click', () => selectTab('review'));
  $('#ov-clear', tp).addEventListener('click', clearProgress);
  app.state.markRead('center');
}
function clearProgress() {
  askConfirm('確定要清除學習進度嗎？已讀、學習單、探索、測驗分數、EXP 與島章都會歸零（冒險者代號和造型會保留）。', '清除').then(ok => {
  if (!ok) return;
  app.state.clearCourse();
  if (app.world) { app.world.resetFoundState(); }
  toast('學習進度已清除');
  renderBanner();
  if (app.panelId) selectTab(app.tab);
  });
}
function pickReview(n) {
  // 從各島題庫輪流抽題
  const banks = app.content.islands.map(i => shuffle(i.quiz));
  const total = banks.reduce((a, b) => a + b.length, 0);
  n = Math.min(n, total);
  const out = [];
  let k = 0;
  while (out.length < n) { const b = banks[k % banks.length]; if (b.length) out.push(b.shift()); k++; }
  return out;
}
function renderReview(tp) {
  const n = app.content.rpgRules.reviewQuestions;
  const qs = pickReview(n);
  tp.innerHTML = `
    <p class="note">從四座島的題庫輪流抽 ${qs.length} 題。全部作答後按「交卷」，會顯示缺答與每題解析。<span class="tag-self">自編練習題</span></p>
    <form id="rv-form">${qs.map((q, i) => `<div class="review-q" data-q="${q.id}"><fieldset><legend>${i + 1}. ${esc(q.q)} <small class="note">（${esc(app.byId[app.questionById[q.id].island].name)}）</small></legend>
      ${shuffle(q.options).map(o => `<label><input type="radio" name="${q.id}" value="${o.id}"> ${esc(o.text)}</label>`).join('')}</fieldset><div class="rv-fb" aria-live="polite"></div></div>`).join('')}
    <p class="err" id="rv-miss" aria-live="assertive"></p>
    <div class="row"><button class="btn" type="submit">📝 交卷</button><button class="btn ghost" type="button" id="rv-new">換一組題目</button></div></form>`;
  let warned = false;
  $('#rv-new', tp).addEventListener('click', () => renderReview(tp));
  $('#rv-form', tp).addEventListener('submit', e => {
    e.preventDefault();
    const missing = qs.filter(q => !tp.querySelector(`input[name="${q.id}"]:checked`));
    $$('.review-q', tp).forEach(el => el.classList.toggle('missing', missing.some(q => q.id === el.dataset.q)));
    if (missing.length && !warned) {
      warned = true;
      $('#rv-miss', tp).textContent = `還有 ${missing.length} 題沒有作答（黃色框）。再按一次「交卷」就會直接計分。`;
      tp.querySelector('.review-q.missing input').focus();
      return;
    }
    let score = 0;
    qs.forEach(q => {
      const el = tp.querySelector(`.review-q[data-q="${q.id}"]`);
      const v = (tp.querySelector(`input[name="${q.id}"]:checked`) || {}).value;
      const ok = v === q.answer;
      if (ok) score++;
      const right = q.options.find(o => o.id === q.answer).text;
      el.querySelector('.rv-fb').innerHTML = `<div class="feedback ${ok ? 'ok' : 'no'}"><strong>${!v ? '⚠️ 缺答' : ok ? '✅ 答對' : '❌ 答錯'}</strong>　正確答案：${esc(right)}<p>${esc(q.explain)}</p></div>`;
      $$('input', el).forEach(i => { i.disabled = true; });
    });
    app.state.updateCourse(cc => { cc.review = { best: Math.max(cc.review ? cc.review.best : 0, score), total: qs.length, last: score }; });
    $('#rv-miss', tp).innerHTML = `<span style="color:var(--accent-ink)">總複習成績：${score} / ${qs.length}${missing.length ? `（缺答 ${missing.length} 題）` : ''}</span>`;
    tp.querySelector('button[type="submit"]').disabled = true;
    $('#rv-miss', tp).scrollIntoView({ block: 'center', behavior: app.reduced ? 'auto' : 'smooth' });
  });
}
function renderFinal(tp, inCard) {
  const s = app.state, r = app.content.rpgRules;
  if (!s.hasAdventurer) {
    tp.innerHTML = `<div class="result-box"><p>最終挑戰需要先建立冒險者，才能記錄島章與證書。</p></div><button class="btn" type="button" id="fn-create">🧭 建立冒險者</button>`;
    $('#fn-create', tp).addEventListener('click', openCreate); return;
  }
  const have = s.save.stamps.length;
  if (!s.centerUnlocked()) {
    tp.innerHTML = `<div class="result-box"><p>🔒 最終挑戰還沒開放。</p><p>需要 <strong>${r.centerUnlockStamps}</strong> 枚島章，你現在有 <strong>${have}</strong> 枚。</p><p class="note">到外圍小島接受「隨堂三題」挑戰，答對 ${r.passCorrect} 題就能得到島章。</p></div>`;
    return;
  }
  const passed = s.save.finalPassed;
  tp.innerHTML = `<div class="result-box"><p><strong>最終挑戰</strong>：從你已過關的島抽 ${r.finalQuestions} 題，答對 ${r.finalPass} 題以上通過，就能領取冒險證書。</p>
    <p class="note">最佳成績：${s.save.finalBest || 0} / ${r.finalQuestions}${passed ? '・✓ 已通過' : ''}</p><span class="tag-self">自編練習題</span></div>
    <div class="row"><button class="btn" type="button" id="fn-start">⚔️ 開始最終挑戰</button>${passed ? '<button class="btn alt" type="button" id="fn-cert">📜 領取證書</button>' : ''}</div>`;
  $('#fn-start', tp).addEventListener('click', () => {
    const pool = app.content.islands.filter(i => s.save.stamps.includes(i.id)).flatMap(i => i.quiz);
    const qs = shuffle(pool).slice(0, r.finalQuestions);
    runQuiz(tp, qs, score => {
      app.state.finishFinal(score);
      const ok = score >= r.finalPass;
      if (ok) app.sound.play('stamp');
      setTimeout(() => { const b = $('#fn-cert2', tp); if (b) b.addEventListener('click', () => openCertificate()); }, 0);
      return `<div class="result-box"><p style="font-size:20px"><strong>${score} / ${qs.length}</strong>　${ok ? '🎉 通過最終挑戰！' : `需要答對 ${r.finalPass} 題，再挑戰一次吧！`}</p>
        ${ok ? '<button class="btn alt" type="button" id="fn-cert2">📜 領取冒險證書</button>' : ''}</div>`;
    }, () => renderFinal(tp, inCard), Object.assign({ label: '最終挑戰' }, inCard ? { onBack: closeCard } : {}));
  });
  const cb = $('#fn-cert', tp); if (cb) cb.addEventListener('click', () => openCertificate());
}
function passportHtml() {
  const s = app.state, r = app.content.rpgRules;
  if (!s.hasAdventurer) return `<p>還沒有冒險者。建立冒險者後，就能收集島章、累積 EXP。</p><button class="btn" type="button" data-act="create">🧭 建立冒險者</button>`;
  const exp = s.exp(), lv = s.levelOf(exp);
  return `
    <div class="row" style="align-items:center"><div style="width:64px;height:76px">${avatarSvg(s.save.style)}</div>
      <div><p style="margin:0;font-size:20px;font-weight:900">${esc(s.save.name)}</p><p class="note" style="margin:0">${STYLE_NAMES[s.save.style]}・Lv ${lv}・EXP ${exp}</p></div></div>
    <h3>島章（${s.save.stamps.length}/${app.content.islands.length}）</h3>
    <div class="stamps">${app.content.islands.map(i => { const got = s.save.stamps.includes(i.id); return `<div class="stamp ${got ? 'got' : ''}" aria-label="${esc(i.name)}島章：${got ? '已得到' : '還沒得到'}"><span><span class="em" aria-hidden="true">${got ? '🏅' : '◌'}</span>${esc(i.name)}</span></div>`; }).join('')}</div>
    <p class="note">集到 ${r.centerUnlockStamps} 枚島章，中央島的最終挑戰就會開放。${s.save.finalPassed ? '你已經通過最終挑戰了！' : ''}</p>
    <div class="row">${s.save.finalPassed ? '<button class="btn alt" type="button" data-act="cert">📜 冒險證書</button>' : ''}<button class="btn" type="button" data-act="code">🔑 接關碼</button><button class="btn ghost" type="button" data-act="switch">切換冒險者</button></div>`;
}
function bindPassport(root) {
  $$('[data-act]', root).forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'create' || a === 'switch') openCreate();
    if (a === 'cert') openCertificate();
    if (a === 'code') openSaveCode();
  }));
}
function renderPassport(tp) { tp.innerHTML = passportHtml() + `<h3>學習進度</h3>${progressHtml()}`; bindPassport(tp); }

// ============================================================
// 對話框（Modal）
function openModal(title, html, onReady) {
  const m = $('#modal');
  if (m.hidden) app.modalReturn = document.activeElement;
  $('#modal-title').textContent = title;
  $('#modal-body').innerHTML = html;
  m.hidden = false;
  if (app.world) app.world.inputEnabled = false;
  onReady && onReady($('#modal-body'));
  $('#modal-title').focus({ preventScroll: true });
}
function closeModal(silent) {
  const m = $('#modal'); if (m.hidden) return false;
  m.hidden = true;
  if (app.world) app.world.inputEnabled = $('#panel').hidden;
  if (!silent && app.modalReturn && document.contains(app.modalReturn)) app.modalReturn.focus({ preventScroll: true });
  return true;
}

function openCreate() {
  const s = app.state, names = s.profileNames();
  let style = 0;
  openModal('建立冒險者', `
    <div class="npc-box"><div class="npc-face"><svg aria-hidden="true"><use href="#mascot"/></svg></div>
      <div><h3>${esc(app.content.mascot.name)} ${sampleBadge(true)}</h3>${app.content.mascot.welcome.map(l => `<p style="margin:2px 0">${esc(l)}</p>`).join('')}</div></div>
    ${names.length ? `<h3>繼續之前的冒險</h3><div class="row">${names.map(n => `<button class="btn ghost" type="button" data-resume="${esc(n)}">${STYLE_ICONS[s.profiles.saves[n].style] || ''} ${esc(n)}</button>`).join('')}</div><hr>` : ''}
    <form id="cr-form">
      <label for="cr-name"><strong>冒險者代號</strong>（2～12 個字，不用寫真實姓名）</label>
      <input type="text" id="cr-name" maxlength="12" autocomplete="off" required placeholder="例如：山林小旅人">
      <p><strong>選一個造型</strong></p>
      <div class="style-picks" role="radiogroup" aria-label="冒險者造型">${[0, 1, 2].map(i => `<button type="button" class="style-pick" role="radio" aria-checked="${i === 0}" data-style="${i}">${avatarSvg(i)}<span>${STYLE_NAMES[i]}</span></button>`).join('')}</div>
      <p class="err" id="cr-err" aria-live="assertive"></p>
      <div class="row"><button class="btn" type="submit">🧭 開始冒險</button><button class="btn ghost" type="button" id="cr-browse">先逛逛，不玩</button></div>
    </form>`, root => {
    $$('[data-resume]', root).forEach(b => b.addEventListener('click', () => { s.switchTo(b.dataset.resume); closeModal(); toast(`歡迎回來，${b.dataset.resume}！`); }));
    const picks = $$('.style-pick', root);
    picks.forEach(p => {
      p.addEventListener('click', () => { style = +p.dataset.style; picks.forEach(q => q.setAttribute('aria-checked', String(q === p))); });
      p.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = picks[(+p.dataset.style + (e.key === 'ArrowRight' ? 1 : 2)) % 3]; n.focus(); n.click(); e.preventDefault(); } });
    });
    $('#cr-form', root).addEventListener('submit', e => {
      e.preventDefault();
      const name = $('#cr-name', root).value.trim();
      if (name.length < 2 || name.length > 12) { $('#cr-err', root).textContent = '代號要 2～12 個字喔。'; $('#cr-name', root).focus(); return; }
      const go = () => {
        s.createAdventurer(name, style);
        Settings.set('browseChosen', true);
        closeModal();
        app.sound.play('levelup');
        toast(`冒險開始！${name}，到島上找找閃閃發亮的 ✨ 吧。`, 3600);
      };
      if (s.profiles.saves[name]) askConfirm(`「${name}」已經有存檔了，要接著玩這個存檔嗎？`, '接著玩').then(ok => ok && go()); else go();
    });
    $('#cr-browse', root).addEventListener('click', () => { Settings.set('browseChosen', true); s.browseOnly(); closeModal(); toast('先逛逛模式：可以讀完全部內容，想玩時按「建立冒險者」。', 3600); });
  });
}

function openList(fallback) {
  const c = app.content, residents = c.residents;
  const groups = [...new Set(c.islands.map(i => i.group).filter(Boolean))];
  openModal('地點清單', `
    ${fallback ? '<div class="fallback-note">這台裝置無法顯示 3D 畫面，已改用文字清單版。所有內容、對話與挑戰都能在這裡完成。</div>' : ''}
    ${groups.length ? `<div class="seg" role="group" aria-label="依海域篩選"><button type="button" aria-pressed="true" data-g="">全部</button>${groups.map(g => `<button type="button" aria-pressed="false" data-g="${esc(g)}">${esc(g)}</button>`).join('')}</div>` : ''}
    ${app.islandList.map(isl => `<article class="list-island" data-group="${esc(isl.group || '')}">
      <h3>${isl.id === 'center' ? '★' : isl.order + '.'} ${esc(isl.name)} <small class="note">${isl.id === 'center' ? '中央島・總複習' : esc(isl.landmark || '')}</small></h3>
      <p style="margin:2px 0 8px">${esc(isl.intro)}</p>
      <div class="row"><button class="btn sm" type="button" data-open="${isl.id}" data-tab="${isl.id === 'center' ? 'overview' : 'material'}">打開${isl.id === 'center' ? '總複習' : '教材'}</button>${isl.id !== 'center' ? `<button class="btn sm ghost" type="button" data-open="${isl.id}" data-tab="explore">探索關卡</button>` : ''}
      ${isl.id !== 'center' ? `<button class="btn sm ghost" type="button" data-open="${isl.id}" data-tab="worksheet">學習單</button><button class="btn sm alt" type="button" data-open="${isl.id}" data-tab="challenge">導師與島主挑戰</button>` : `<button class="btn sm alt" type="button" data-open="center" data-tab="final">最終挑戰</button>`}</div>
      <details><summary>內容重點與居民對話</summary>
        <ul class="points">${isl.points.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        ${isl.npc && isl.npc.story ? `<p><strong>${esc(isl.npc.name)}</strong>（${esc(isl.npc.title)}）${sampleBadge(isl.npc.sample)}：${isl.npc.story.map(esc).join('')}</p>` : ''}
        ${(isl.id === 'center' ? [...c.walkers, c.merchant, ...c.couriers] : residents.filter(r => r.island === isl.id)).map(r => `<p><strong>${esc(r.name)}</strong>・${esc(r.job)}${sampleBadge(r.sample)}：${r.lines.map(esc).join(' ')}</p>`).join('')}
      </details></article>`).join('')}
    <p class="note">${esc(c.site.footer)}</p>`, root => {
    $$('[data-open]', root).forEach(b => b.addEventListener('click', () => { closeModal(true); if (app.world) openIsland(b.dataset.open, { tab: b.dataset.tab }); else showPanel(b.dataset.open, b.dataset.tab); }));
    $$('[data-g]', root).forEach(b => b.addEventListener('click', () => {
      $$('[data-g]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      $$('.list-island', root).forEach(a => { a.hidden = b.dataset.g && a.dataset.group !== b.dataset.g; });
    }));
  });
}

function searchIndex() {
  if (app.index) return app.index;
  const out = [];
  const c = app.content;
  for (const isl of app.islandList) {
    const add = (text, tab) => out.push({ id: isl.id, name: isl.name, text, tab });
    add(isl.name, null); add(isl.intro, null);
    (isl.points || []).forEach(p => add(p, isl.id === 'center' ? 'overview' : 'material'));
    if (isl.goal) add(isl.goal, isl.id === 'center' ? 'overview' : 'material');
    (isl.sections || []).forEach(sec => {
      if (sec.lines) add(sec.lines.join(''), 'material');
      if (sec.items) sec.items.forEach(it => add(Array.isArray(it) ? it.join('：') : it, 'material'));
      if (sec.body) sec.body.forEach(b => add(b, 'material'));
      if (sec.rows) sec.rows.forEach(r => add(r.join('｜'), 'material'));
    });
    (isl.worksheet || []).forEach(w => add(w.q, 'worksheet'));
    if (isl.npc && isl.npc.story) isl.npc.story.forEach(s => add(s, null));
  }
  c.residents.forEach(r => out.push({ id: r.island, name: app.byId[r.island].name, text: `${r.name}：${r.lines.join(' ')}`, tab: null }));
  return (app.index = out);
}
function openSearch() {
  openModal('搜尋', `<label for="q" class="sr-only">搜尋關鍵字</label><input type="search" id="q" placeholder="輸入關鍵字，例如：返景、春天、映襯" autocomplete="off">
    <p class="note" id="q-count" aria-live="polite">可以搜尋島名、詩句、語詞與內容重點。</p><div id="q-res"></div>`, root => {
    const input = $('#q', root);
    const run = () => {
      const q = input.value.trim();
      const res = $('#q-res', root);
      if (!q) { res.innerHTML = ''; $('#q-count', root).textContent = '可以搜尋島名、詩句、語詞與內容重點。'; return; }
      const hits = searchIndex().filter(e => e.text.toLowerCase().includes(q.toLowerCase())).slice(0, 30);
      $('#q-count', root).textContent = hits.length ? `找到 ${hits.length} 筆` : '找不到，換個關鍵字試試。';
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      res.innerHTML = hits.map((e, i) => `<button type="button" class="search-hit" data-i="${i}"><strong>${esc(e.name)}</strong>　${esc(e.text).replace(re, m => `<mark>${m}</mark>`)}</button>`).join('');
      $$('.search-hit', res).forEach(b => b.addEventListener('click', () => { const e = hits[+b.dataset.i]; const tab = e.tab || (e.id === 'center' ? 'overview' : 'material'); closeModal(true); if (app.world) openIsland(e.id, { tab }); else showPanel(e.id, tab); }));
    };
    input.addEventListener('input', run);
    setTimeout(() => input.focus(), 30);
  });
}

function openBag() {
  const s = app.state, items = app.content.items, bag = s.bag();
  const entries = Object.entries(bag).filter(([, n]) => n > 0);
  openModal('🎒 背包', `
    <div class="bag-grid">${entries.length ? entries.map(([k, n]) => `<div class="bag-item"><span class="em" aria-hidden="true">${items[k] ? items[k].icon : '❔'}</span>${esc(items[k] ? items[k].name : k)}<br><strong>× ${n}</strong>${items[k] && items[k].rare ? '<br><span class="badge">稀有</span>' : ''}</div>`).join('') : '<p>背包是空的。到沙灘撿貝殼吧！</p>'}</div>
    <h3>怎麼換東西？</h3>
    <ul class="points"><li>沙灘上每座島都有一顆可以撿的 🐚 貝殼（20 秒後重新出現）。</li><li>點居民，按「🔁 交易」，就能拿東西跟他交換。</li><li>一路換下去，可以換到最稀有的「🖼️ 詩中有畫明信片」！</li></ul>
    <details><summary>交易表</summary><ul class="points">${app.content.trades.map(t => { const who = findPerson(t.resident); return `<li>${esc(who ? who.name : t.resident)}：${fmtItems(t.give)} → ${fmtItems(t.get)}</li>`; }).join('')}</ul></details>
    <p class="note">這只是小遊戲，不是真實貨幣，也不連到任何付款。背包存在這台電腦的瀏覽器裡。</p>
    <button class="btn ghost" type="button" id="bag-clear">清空背包</button>`, root => {
    $('#bag-clear', root).addEventListener('click', () => askConfirm('確定清空背包嗎？會回到 3 個貝殼。', '清空').then(ok => { if (ok) { s.clearBag(); closeModal(); openBag(); } }));
  });
}
function fmtItems(o) { const items = app.content.items; return Object.entries(o).map(([k, n]) => `${items[k] ? items[k].icon + items[k].name : k}×${n}`).join('＋'); }
function findPerson(id) {
  const c = app.content;
  return [...c.residents, ...c.couriers, c.merchant, ...c.walkers].find(r => r.id === id);
}

function openSettings() {
  const q = Settings.get('quality'), tm = Settings.get('timeMode') || 'scene';
  openModal('設定', `<div class="settings-grid">
    <fieldset><legend>底色主題</legend><div class="theme-choices seg" role="group" aria-label="底色主題">
      ${[['sunset', '夕陽', '#fbefe3'], ['beach', '沙灘', '#f6ead2'], ['dusk', '暮色', '#2b1e1a']].map(([k, n, c]) => `<button type="button" data-theme-set="${k}" aria-pressed="${document.documentElement.dataset.theme === k}"><i style="background:${c}"></i>${n}</button>`).join('')}</div></fieldset>
    <fieldset><legend>晝夜光線</legend><div class="seg" role="group" aria-label="晝夜">${Object.entries(MODE_NAME).map(([k, n]) => `<button type="button" data-time="${k}" aria-pressed="${tm === k}">${n}</button>`).join('')}</div>
      <p class="note">「跟著課文情境」：鹿柴是黃昏、鳥鳴澗是春天的夜晚。自動流動約 2.5 分鐘走完一天；同步現在時間會用這台電腦的時鐘。</p></fieldset>
    <fieldset><legend>聲音</legend><div class="seg" role="group" aria-label="聲音">
      <button type="button" id="st-music" aria-pressed="${app.sound.musicOn}">🎵 背景音樂：${app.sound.musicOn ? '開' : '關'}</button>
      <button type="button" id="st-sfx" aria-pressed="${app.sound.sfxOn}">🔔 音效與環境音：${app.sound.sfxOn ? '開' : '關'}</button></div>
      <label for="st-vol" class="note">音量</label><input type="range" id="st-vol" class="vol" min="0" max="1" step=".05" value="${app.sound.volume}">
      <p class="note">音樂與音效都是網頁即時合成的五聲音階古箏聲、山林與溪水聲。</p></fieldset>
    <fieldset><legend>畫質</legend><div class="seg" role="group" aria-label="畫質">${[['auto', '自動'], ['high', '高畫質'], ['low', '低畫質（關陰影、人和動物減半）']].map(([k, n]) => `<button type="button" data-q="${k}" aria-pressed="${q === k}">${n}</button>`).join('')}</div></fieldset>
    <fieldset><legend>減少動態</legend><div class="seg"><button type="button" id="st-reduced" aria-pressed="${app.reduced}">${app.reduced ? '已開啟：動畫暫停' : '關閉中：按這裡暫停動畫'}</button></div>
      <p class="note">容易暈眩的人可以開啟：居民、動物、雲、鳥、海浪都會停下，鏡頭直接切換。</p></fieldset>
    <fieldset><legend>其他</legend><div class="row">
      <button class="btn ghost" type="button" id="st-intro">🎬 重播開場</button>
      <button class="btn ghost" type="button" id="st-create">🧭 建立／切換冒險者</button>
      <button class="btn ghost" type="button" id="st-code">🔑 接關碼</button>
      <button class="btn ghost" type="button" id="st-clear">清除學習進度</button></div></fieldset>
  </div>`, root => {
    $$('[data-theme-set]', root).forEach(b => b.addEventListener('click', () => { applyTheme(b.dataset.themeSet); $$('[data-theme-set]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); syncTimeButtons(root); }));
    $$('[data-time]', root).forEach(b => b.addEventListener('click', () => { setTimeMode(b.dataset.time); syncTimeButtons(root); }));
    $$('[data-q]', root).forEach(b => b.addEventListener('click', () => { setQuality(b.dataset.q); $$('[data-q]', root).forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    $('#st-music', root).addEventListener('click', e => { app.sound.unlock(); app.sound.setMusic(!app.sound.musicOn); Settings.set('music', app.sound.musicOn); e.currentTarget.setAttribute('aria-pressed', String(app.sound.musicOn)); e.currentTarget.textContent = `🎵 背景音樂：${app.sound.musicOn ? '開' : '關'}`; syncSoundButton(); });
    $('#st-sfx', root).addEventListener('click', e => { app.sound.unlock(); app.sound.setSfx(!app.sound.sfxOn); Settings.set('sfx', app.sound.sfxOn); e.currentTarget.setAttribute('aria-pressed', String(app.sound.sfxOn)); e.currentTarget.textContent = `🔔 音效與環境音：${app.sound.sfxOn ? '開' : '關'}`; syncSoundButton(); });
    $('#st-vol', root).addEventListener('input', e => { app.sound.setVolume(+e.target.value); Settings.set('volume', +e.target.value); });
    $('#st-reduced', root).addEventListener('click', e => { setReduced(!app.reduced); e.currentTarget.setAttribute('aria-pressed', String(app.reduced)); e.currentTarget.textContent = app.reduced ? '已開啟：動畫暫停' : '關閉中：按這裡暫停動畫'; });
    $('#st-intro', root).addEventListener('click', () => { closeModal(true); closePanel(); if (app.world && !app.reduced) playIntro(); else toast('「減少動態」開啟時不播放開場運鏡。'); });
    $('#st-create', root).addEventListener('click', openCreate);
    $('#st-code', root).addEventListener('click', openSaveCode);
    $('#st-clear', root).addEventListener('click', clearProgress);
  });
}
function syncTimeButtons(root) { const tm = Settings.get('timeMode'); $$('[data-time]', root).forEach(x => x.setAttribute('aria-pressed', String(x.dataset.time === tm))); }

function openHelp() {
  openModal('怎麼玩', `
    <div class="npc-box"><div class="npc-face"><svg aria-hidden="true"><use href="#mascot"/></svg></div><div><h3>${esc(app.content.mascot.name)}的小提醒 ${sampleBadge(true)}</h3><p>${esc(app.content.mascot.tips[Math.floor(Math.random() * app.content.mascot.tips.length)])}</p></div></div>
    <ul class="points">${app.content.help.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <h3>關於這個網站</h3>
    <p>${esc(app.content.site.footer)}</p>
    <p class="note">標有「示意」的人物與對話是補寫內容；題目為依教材改寫的自編練習題。3D 模型、人物與動物都是用程式畫出的原創造型。</p>`);
}

function openPassport() { openModal('護照與進度', passportHtml() + `<h3>學習進度</h3>${progressHtml()}<div class="row" style="margin-top:10px"><button class="btn ghost" type="button" id="pp-clear">清除學習進度</button></div>`, root => { bindPassport(root); $('#pp-clear', root).addEventListener('click', clearProgress); }); }

function openSaveCode() {
  const s = app.state;
  const code = s.makeCode();
  openModal('🔑 接關碼', `
    <p>換電腦或手機時，把接關碼貼到新裝置的這個視窗，就能接著玩。</p>
    <p class="note">接關碼只是方便換裝置，<strong>不是防作弊</strong>；裡面只有冒險者代號、造型、登島紀錄、答對題目、島章與交易紀錄。清除瀏覽器資料會刪掉本機存檔。</p>
    ${code ? `<h3>你的接關碼</h3><textarea class="code-box" id="sc-code" readonly rows="3">${esc(code)}</textarea>
      <div class="row"><button class="btn" type="button" id="sc-copy">📋 複製</button><button class="btn ghost" type="button" id="sc-json">⬇️ 匯出 JSON 檔</button></div>` : '<p>還沒有冒險者，可以直接在下面貼上接關碼還原。</p>'}
    <h3>貼上接關碼還原</h3>
    <label for="sc-in" class="sr-only">貼上接關碼</label>
    <textarea class="code-box" id="sc-in" rows="3" placeholder="${esc(app.content.site.saveCodePrefix)}.……"></textarea>
    <p class="err" id="sc-err" aria-live="assertive"></p>
    <div class="row"><button class="btn alt" type="button" id="sc-load">還原存檔</button>
    <label class="btn ghost" for="sc-file" style="cursor:pointer">⬆️ 匯入 JSON 檔</label><input type="file" id="sc-file" accept="application/json,.json" class="sr-only"></div>`, root => {
    const ok = msg => { closeModal(); toast(msg); };
    const restore = clean => {
      const go = () => { s.importSave(clean); if (app.world) { app.world.resetFoundState(); app.world.setFoundState(s.foundList()); } ok(`已還原「${clean.name}」的冒險進度！`); };
      if (s.profiles.saves[clean.name]) askConfirm(`這台電腦已經有「${clean.name}」的存檔，要用接關碼的內容覆蓋嗎？`, '覆蓋').then(y => y && go()); else go();
    };
    if (code) {
      $('#sc-copy', root).addEventListener('click', async () => { const r = await copyText(code); toast(r ? '已複製接關碼' : '複製失敗，請手動選取文字複製'); });
      $('#sc-json', root).addEventListener('click', () => download(`${app.content.site.title}-${s.save.name}-存檔.json`, JSON.stringify(s.exportSave(), null, 2), 'application/json'));
    }
    $('#sc-load', root).addEventListener('click', () => {
      try { restore(s.parseCode($('#sc-in', root).value)); }
      catch (e) { $('#sc-err', root).textContent = e.message; }
    });
    $('#sc-file', root).addEventListener('change', async e => {
      const f = e.target.files[0]; if (!f) return;
      try { restore(s.validate(JSON.parse(await f.text()))); }
      catch (err) { $('#sc-err', root).textContent = err instanceof SyntaxError ? '檔案不是正確的 JSON 存檔。' : err.message; }
    });
  });
}

// ---------- 證書 ----------
async function drawCertificate(name) {
  const s = app.state, c = app.content;
  const W = 1600, H = 1130;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const x = cv.getContext('2d');
  try { await document.fonts.load('900 60px "Noto Sans TC"'); } catch (e) {}
  const font = '"Noto Sans TC", "Microsoft JhengHei", "PingFang TC", "Noto Sans CJK TC", sans-serif';
  x.fillStyle = '#fbefe3'; x.fillRect(0, 0, W, H);
  x.strokeStyle = '#c45a2c'; x.lineWidth = 18; x.strokeRect(30, 30, W - 60, H - 60);
  x.strokeStyle = '#2f8f83'; x.lineWidth = 5; x.strokeRect(62, 62, W - 124, H - 124);
  // 織紋帶
  for (let i = 0; i < (W - 140) / 36; i++) {
    const px = 70 + i * 36;
    for (const py of [86, H - 122]) {
      x.fillStyle = '#b8282e'; x.fillRect(px, py, 36, 36);
      x.fillStyle = '#f7efe4'; x.beginPath(); x.moveTo(px + 18, py + 2); x.lineTo(px + 34, py + 18); x.lineTo(px + 18, py + 34); x.lineTo(px + 2, py + 18); x.fill();
      x.fillStyle = '#1f1a17'; x.beginPath(); x.moveTo(px + 18, py + 10); x.lineTo(px + 26, py + 18); x.lineTo(px + 18, py + 26); x.lineTo(px + 10, py + 18); x.fill();
    }
  }
  x.textAlign = 'center'; x.fillStyle = '#c45a2c';
  x.font = `900 92px ${font}`; x.fillText('冒 險 證 書', W / 2, 250);
  x.fillStyle = '#6e4f40'; x.font = `700 36px ${font}`; x.fillText(`${c.site.title}｜${c.site.tagline}・${c.site.subtitle}`, W / 2, 315);
  x.fillStyle = '#3a2318'; x.font = `700 44px ${font}`; x.fillText('茲證明', W / 2, 420);
  x.fillStyle = '#2f8f83'; x.font = `900 96px ${font}`; x.fillText(name, W / 2, 530);
  x.fillStyle = '#3a2318'; x.font = `700 40px ${font}`;
  x.fillText('走遍「詩兩首」群島，讀懂〈鹿柴〉與〈鳥鳴澗〉，', W / 2, 630);
  x.fillText('並通過中央島最終挑戰。', W / 2, 690);
  const exp = s.exp(), lv = s.levelOf(exp);
  x.font = `900 44px ${font}`; x.fillStyle = '#c45a2c';
  x.fillText(`等級 Lv ${lv}　・　島章 ${s.save.stamps.length} / ${c.islands.length} 枚　・　${today()}`, W / 2, 800);
  x.font = `700 32px ${font}`; x.fillStyle = '#6e4f40'; x.fillText(c.site.author, W / 2, 880);
  // 馨馨
  try {
    const img = await mascotImage();
    x.drawImage(img, 120, 760, 170, 192);
  } catch (e) {}
  x.textAlign = 'right'; x.font = `700 26px ${font}`; x.fillStyle = '#6e4f40';
  x.fillText('本證書為學習紀錄，非官方認證', W - 100, H - 150);
  return cv;
}
function mascotImage() {
  const sym = document.getElementById('mascot'), pat = document.getElementById('weave');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 72" width="320" height="360"><defs>${pat.outerHTML}</defs>${sym.innerHTML}</svg>`;
  return new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); });
}
function openCertificate() {
  const s = app.state;
  if (!s.save || !s.save.finalPassed) { toast('通過中央島最終挑戰後才能領取證書。'); return; }
  openModal('📜 冒險證書', `
    <label for="cert-name"><strong>證書上的名字</strong>（預設是冒險者代號，可以改）</label>
    <div class="row"><input type="text" id="cert-name" maxlength="12" value="${esc(s.save.name)}" style="flex:1"><button class="btn ghost" type="button" id="cert-redraw">更新</button></div>
    <p></p><img class="cert-preview" id="cert-img" alt="冒險證書預覽">
    <div class="row" style="margin-top:10px"><button class="btn" type="button" id="cert-dl">⬇️ 下載 PNG</button><button class="btn alt" type="button" id="cert-print">🖨️ 列印</button></div>
    <p class="note">證書右下角固定註明「本證書為學習紀錄，非官方認證」。</p>`, async root => {
    let canvas;
    const draw = async () => { canvas = await drawCertificate($('#cert-name', root).value.trim() || s.save.name); $('#cert-img', root).src = canvas.toDataURL('image/png'); };
    await draw();
    $('#cert-redraw', root).addEventListener('click', draw);
    $('#cert-dl', root).addEventListener('click', async () => { await draw(); canvas.toBlob(b => download(`${app.content.site.title}-冒險證書.png`, b)); });
    $('#cert-print', root).addEventListener('click', async () => {
      await draw();
      const area = $('#print-area'); area.innerHTML = `<img src="${canvas.toDataURL('image/png')}" alt="冒險證書">`;
      setTimeout(() => window.print(), 100);
    });
  });
}

// ============================================================
// 對話泡泡（居民、導師、動物）
function openBubble(agent) {
  closeBubble(true);
  const w = app.world;
  app.bubbleAgent = agent;
  app.bubbleLine = 0;
  agent.talk(w.camera.position);
  app.sound.play(agent.type === 'animal' ? 'hop' : 'open');
  if (agent.type === 'animal' || agent.type === 'npc') agent.hop = .5;
  document.body.classList.add('bubble-open');
  renderBubble();
  const b = $('#bubble'); b.hidden = false;
  updateBubble();
  const f = b.querySelector('button'); f && f.focus({ preventScroll: true });
}
function renderBubble(extra = '') {
  const a = app.bubbleAgent; if (!a) return;
  const b = $('#bubble');
  const info = a.info || {};
  const isl = info.island ? app.byId[info.island] : null;
  if (a.type === 'animal') {
    const lines = app.content.animals[info.animal] || ['……'];
    b.innerHTML = `<h3>${ANIMAL_ICON[info.animal] || ''} ${ANIMAL_NAME[info.animal] || '動物'}</h3><p class="say">${esc(lines[app.bubbleLine % lines.length])}</p>
      <div class="row"><button class="btn sm ghost" type="button" data-b="more">💬 再聊聊</button><button class="btn sm ghost" type="button" data-b="close" aria-label="關閉">✕</button></div>`;
  } else if (a.type === 'npc') {
    const lines = info.mascot ? app.content.mascot.centerLines : info.story;
    b.innerHTML = `<p class="who">${esc(info.title || '')}・${esc(isl ? isl.name : '')}</p><h3>${esc(info.name)}${sampleBadge(true)}</h3>
      <p class="say">${esc(lines[app.bubbleLine % lines.length])}</p>
      <div class="row"><button class="btn sm ghost" type="button" data-b="more">💬 再聊聊</button>
      ${info.mascot ? '<button class="btn sm ghost" type="button" data-b="book">📖 中央島手冊</button><button class="btn sm" type="button" data-b="final">⚔️ 最終挑戰</button>' : `<button class="btn sm${app.state.challengeOpen(info.island) ? '' : ' ghost'}" type="button" data-b="boss">⚔️ 島主挑戰${app.state.challengeOpen(info.island) ? '' : '（' + app.state.foundOn(info.island).done + '/' + Math.min(app.content.rpgRules.challengeNeed, app.state.foundOn(info.island).total) + '）'}</button>`}
      <button class="btn sm ghost" type="button" data-b="close" aria-label="關閉">✕</button></div>`;
  } else {
    const trade = app.content.trades.find(t => t.resident === info.id);
    const islName = isl ? isl.name : (a.type === 'courier' ? '往返各島' : '中央島');
    const afford = trade ? app.state.canAfford(trade.give) : false;
    b.innerHTML = `<p class="who">${esc(info.job || '')}・${esc(islName)}</p><h3>${esc(info.name)}${sampleBadge(info.sample)}</h3>
      <p class="say">${esc(info.lines[app.bubbleLine % info.lines.length])}</p>
      ${extra}
      <div class="row"><button class="btn sm ghost" type="button" data-b="more">💬 再聊聊</button>
      ${trade ? `<button class="btn sm alt" type="button" data-b="trade">🔁 交易</button>` : ''}
      <button class="btn sm ghost" type="button" data-b="close" aria-label="關閉">✕</button></div>`;
    void afford;
  }
  $$('[data-b]', b).forEach(btn => btn.addEventListener('click', e => { e.stopPropagation(); bubbleAction(btn.dataset.b); }));
}
function bubbleAction(act) {
  const a = app.bubbleAgent; if (!a) return;
  const info = a.info || {};
  if (act === 'close') return closeBubble();
  if (act === 'more') { app.bubbleLine++; a.wave(1.4); renderBubble(); return; }
  if (act === 'boss') { closeBubble(); openBoss(info.island); return; }
  if (act === 'final') { closeBubble(); openFinalCard(); return; }
  if (act === 'book') { closeBubble(); showPanel('center', 'overview'); return; }
  if (act === 'trade') {
    const t = app.content.trades.find(x => x.resident === info.id);
    const ok = app.state.canAfford(t.give);
    const where = Object.keys(t.give).map(k => hintWhere(k)).join('；');
    renderBubble(`<div class="trade"><strong>交換：</strong>${fmtItems(t.give)} → ${fmtItems(t.get)}
      <div class="row" style="margin-top:6px"><button class="btn sm" type="button" data-b="dotrade" ${ok ? '' : 'disabled aria-disabled="true"'}>確定交換</button></div>
      ${ok ? '' : `<p class="note" style="margin:4px 0 0">東西不夠喔：${esc(where)}</p>`}</div>`);
    return;
  }
  if (act === 'dotrade') {
    const t = app.content.trades.find(x => x.resident === info.id);
    const firstTime = app.state.save && !(app.state.save.traded || []).includes(info.id);
    if (app.state.trade(t)) {
      a.wave(2); a.hop = .5; app.sound.play('trade');
      bumpBag();
      toast(`交易成功！得到 ${fmtItems(t.get)}${firstTime && app.state.hasAdventurer ? `（+${app.content.rpgRules.firstTrade} EXP）` : ''}`);
      renderBubble(`<div class="trade">😊 ${esc(t.thanks)}</div>`);
    }
  }
}
function hintWhere(item) {
  if (item === 'shell') return '到各島沙灘撿貝殼';
  const t = app.content.trades.find(x => x.get[item]);
  if (!t) return '';
  const p = findPerson(t.resident);
  const isl = p && p.island ? app.byId[p.island].name : '中央島';
  return `${app.content.items[item].name}可以找${isl}的${p ? p.name : ''}換`;
}
function updateBubble() {
  const a = app.bubbleAgent; if (!a || !app.world) return;
  const b = $('#bubble');
  const p = app.world.project(a.pos, a.m.kind === 'person' ? 1.6 * (a.root.scale.x || 1) : .9);
  const pinned = window.innerWidth < 760;
  b.classList.toggle('pinned', pinned);
  if (pinned) { b.style.transform = ''; return; }
  const bw = b.offsetWidth, bh = b.offsetHeight;
  const x = Math.min(window.innerWidth - bw / 2 - 8, Math.max(bw / 2 + 8, p.x));
  const y = Math.min(window.innerHeight - 20, Math.max(bh + 80, p.y - 8));
  b.style.transform = `translate(${Math.round(x - bw / 2)}px, ${Math.round(y - bh)}px)`;
}
function closeBubble(silent) {
  const a = app.bubbleAgent;
  if (!a) return false;
  a.stopTalk();
  app.bubbleAgent = null;
  $('#bubble').hidden = true;
  document.body.classList.remove('bubble-open');
  return true;
}

// ============================================================
function bindUI() {
  $('#btn-search').addEventListener('click', openSearch);
  $('#list-open').addEventListener('click', () => openList(!app.world));
  $('#skip-link').addEventListener('click', e => { e.preventDefault(); openList(!app.world); });
  $('#btn-home').addEventListener('click', () => {
    closeBubble(); closeModal(true);
    if (!$('#panel').hidden) { $('#panel').hidden = true; app.panelId = null; if (app.world) { app.world.inputEnabled = true; app.world.setViewShift(0, 0); } }
    closeCard(true);
    if (app.world) { app.world.setFollow(false); $('#btn-follow').setAttribute('aria-pressed', 'false'); Settings.set('follow', false); app.world.flyHome(); setFocus(null); }
  });
  $('#btn-sound').addEventListener('click', () => {
    app.sound.unlock();
    const on = !(app.sound.musicOn || app.sound.sfxOn);
    app.sound.setMusic(on); app.sound.setSfx(on); Settings.set('music', on); Settings.set('sfx', on);
    syncSoundButton(); toast(on ? '🔊 音樂與音效已開啟' : '🔇 音樂與音效已關閉');
  });
  $('#btn-restart').addEventListener('click', openRestart);
  $('#near').addEventListener('click', () => { if (app.nearDisc) openDiscovery(app.nearDisc); });
  // 第一次點擊或按鍵後才開始播放聲音（瀏覽器規定）
  const unlock = () => { app.sound.unlock(); app.sound.setAmbience(app.focus ? AMBIENCE[app.focus] || 'sea' : 'sea'); };
  document.addEventListener('pointerdown', unlock, { once: true, capture: true });
  document.addEventListener('keydown', unlock, { once: true, capture: true });
  document.addEventListener('click', e => { const b = e.target.closest('.btn, .tool, .opt, .tab, .island-label'); if (b && !b.disabled) app.sound.play('tick'); }, true);
  const fol = $('#btn-follow');
  fol.setAttribute('aria-pressed', String(Settings.get('follow') !== false));
  fol.addEventListener('click', () => {
    const v = fol.getAttribute('aria-pressed') !== 'true';
    fol.setAttribute('aria-pressed', String(v)); Settings.set('follow', v);
    if (app.world) { app.world.setFollow(v); if (v && app.world.player) { app.world.followSnap = true; setTimeout(() => { app.world.followSnap = false; }, 1500); } }
    toast(v ? '鏡頭跟著冒險者' : '鏡頭不跟隨');
  });
  $('#btn-passport').addEventListener('click', openPassport);
  $('#btn-settings').addEventListener('click', openSettings);
  $('#btn-help').addEventListener('click', openHelp);
  $('#panel-close').addEventListener('click', closePanel);
  $('#modal-close').addEventListener('click', () => closeModal());
  $('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
  $$('.themebar [data-theme-set]').forEach(b => b.addEventListener('click', () => applyTheme(b.dataset.themeSet)));
  $$('.timebar [data-time]').forEach(b => b.addEventListener('click', () => setTimeMode(b.dataset.time)));
  $('#clock').addEventListener('click', () => {
    const order = ['scene', 'day', 'dusk', 'night', 'auto', 'realtime'];
    const cur = Settings.get('timeMode') || 'scene';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    setTimeMode(next); toast('時段：' + MODE_NAME[next]);
  });
  $('#intro').addEventListener('click', skipIntro);

  const KEYMAP = { ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
  document.addEventListener('keydown', e => {
    if (app.introDone) { skipIntro(); e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (!$('#confirm').hidden) { app.confirmResolve && app.confirmResolve(false); return; }
      if (closeModal()) return;
      if (closeCard()) return;
      if (closeBubble()) return;
      if (!$('#panel').hidden) { closePanel(); return; }
      return;
    }
    // 對話框內的 Tab 循環
    if (e.key === 'Tab' && !$('#modal').hidden) {
      const f = $$('#modal button, #modal input, #modal textarea, #modal [tabindex="0"], #modal summary, #modal a[href]').filter(x => !x.disabled && x.offsetParent !== null);
      if (f.length) { const first = f[0], last = f[f.length - 1]; if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); } else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); } }
    }
    if (e.code === 'KeyE' && app.nearDisc && !/INPUT|TEXTAREA/.test(document.activeElement.tagName) && $('#modal').hidden && $('#card').hidden) { openDiscovery(app.nearDisc); e.preventDefault(); return; }
    const k = KEYMAP[e.code];
    const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
    const focusOnUI = document.activeElement && document.activeElement !== document.body && document.activeElement.id !== 'scene' && /BUTTON/.test(document.activeElement.tagName) && e.code.startsWith('Arrow');
    if (k && app.world && app.world.player && !typing && !focusOnUI && $('#modal').hidden && $('#panel').hidden && $('#card').hidden) {
      app.world.keys.add(k); e.preventDefault();
      if (Settings.get('follow') !== false) app.world.setFollow(true);
    }
  });
  document.addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k && app.world) app.world.keys.delete(k); });
  window.addEventListener('blur', () => { if (app.world) app.world.keys.clear(); });
  $('#scene').addEventListener('pointerdown', () => { if (app.introDone) skipIntro(); });
}

// ============================================================
// 第 2 版：場景裡的探索關卡
function findDisc(island, key) { return Object.values(app.discById).find(d => d.island === island && d.anchor === key); }
function openDiscovery(id) {
  const d = app.discById[id]; if (!d) return;
  closeBubble(); closeModal(true);
  if (!$('#panel').hidden) { $('#panel').hidden = true; app.panelId = null; if (app.world) { app.world.setViewShift(0, 0); app.world.inputEnabled = true; } }
  const w = app.world;
  if (app.focus !== d.island) setFocus(d.island);
  const a = w && w.anchor(d.island, d.anchor);
  if (a) {
    if (w.player && app.state.hasAdventurer) { w.setFollow(false); w.walkPlayerToAnchor(a); }
    w.focusAnchor(a, () => showCard(d));
    return;
  }
  showCard(d);
}
function cardShell(icon, where, title) {
  const card = $('#card');
  if (card.hidden) app.cardReturn = document.activeElement;
  card.innerHTML = `<div class="card-head"><div class="card-icon" aria-hidden="true">${icon}</div><div style="flex:1;min-width:0"><p class="where">${esc(where)}</p><h2 id="card-title" tabindex="-1">${esc(title)}</h2></div><button class="icon-btn" type="button" data-c="close" aria-label="關閉（Esc）">✕</button></div><div id="card-body"></div>`;
  card.hidden = false;
  document.body.classList.add('card-open');
  card.querySelector('[data-c="close"]').addEventListener('click', () => closeCard());
  card.scrollTop = 0;
  if (app.world) {
    app.world.inputEnabled = false;
    if (window.innerWidth <= 760) app.world.setViewShift(0, window.innerHeight * .3);
    else app.world.setViewShift(-(card.offsetWidth + 14) / 2, 0);
  }
  setTimeout(() => { const t = $('#card-title'); t && t.focus({ preventScroll: true }); }, 30);
  return $('#card-body');
}
function closeCard(silent) {
  const card = $('#card'); if (card.hidden) return false;
  card.hidden = true; app.cardDisc = null;
  document.body.classList.remove('card-open');
  if (app.world) { app.world.inputEnabled = $('#panel').hidden && $('#modal').hidden; app.world.setViewShift(0, 0); }
  if (!silent) app.sound.play('close');
  return true;
}
function playFx(d) {
  if (app.world) app.world.fx(d.fx, d.island, d.anchor);
  app.sound.play(FX_SOUND[d.fx] || 'discover');
  if (d.fx === 'moon') setTimeout(() => app.sound.play('chirp'), 1300);
}
function showCard(d) {
  const isl = app.byId[d.island], found = app.state.isFound(d.id);
  app.cardDisc = d.id;
  const body = cardShell(d.icon, `${isl.name}・探索`, d.title);
  body.innerHTML = `${d.line ? `<p class="line" lang="zh-Hant">${esc(d.line)}</p>` : ''}<p class="txt">${esc(d.text)}</p>
    <div class="row"><button class="btn sm ghost" type="button" data-c="replay">🔁 再看一次</button>${found ? '<span class="done-flag">✅ 已完成，可以再玩一次</span>' : ''}</div>
    <div id="task" style="margin-top:10px"></div>`;
  body.querySelector('[data-c="replay"]').addEventListener('click', () => playFx(d));
  renderTask($('#task', body), d);
  playFx(d);
}
function renderTask(box, d) {
  const t = d.task;
  const done = () => discoverySolved(box, d);
  if (t.type === 'order') {
    let next = 0;
    const pool = shuffle(t.lines.map((l, i) => ({ l, i })));
    box.innerHTML = `<p class="quiz-q">照順序點一點，把詩句排回來：</p><div class="order-picked" aria-live="polite" id="picked"><span class="note">（從下面依序點選）</span></div>
      <div class="order-pool">${pool.map(p => `<button type="button" class="opt" data-i="${p.i}">${esc(p.l)}</button>`).join('')}</div><div id="tfb" aria-live="polite"></div>`;
    $$('.order-pool .opt', box).forEach(b => b.addEventListener('click', () => {
      if (+b.dataset.i === next) {
        const picked = $('#picked', box); if (!next) picked.innerHTML = '';
        picked.insertAdjacentHTML('beforeend', `<span>${esc(t.lines[next])}</span>`);
        b.disabled = true; b.classList.add('correct'); next++;
        app.sound.play('tick');
        if (next === t.lines.length) done();
      } else {
        app.sound.play('wrong'); b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
        $('#tfb', box).innerHTML = `<p class="note">順序不對喔，想想第 ${next + 1} 句是哪一句？</p>`;
      }
    }));
    return;
  }
  box.innerHTML = `<p class="quiz-q" id="tq">${esc(t.q)}</p><div class="opts" role="group" aria-labelledby="tq">${shuffle(t.options).map((o, k) => `<button type="button" class="opt" data-opt="${o.id}"><span class="k">${'ABCD'[k]}</span><span>${esc(o.text)}</span></button>`).join('')}</div><div id="tfb" aria-live="polite"></div>`;
  $$('.opt', box).forEach(b => b.addEventListener('click', () => {
    if (b.dataset.opt === t.answer) { $$('.opt', box).forEach(x => { x.disabled = true; }); b.classList.add('correct'); done(); }
    else {
      b.disabled = true; b.classList.add('wrong'); app.sound.play('wrong');
      b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake');
      $('#tfb', box).innerHTML = '<p class="note">再想想看，換一個答案試試！</p>';
    }
  }));
}
function discoverySolved(box, d) {
  const isl = d.island;
  const wasOpen = app.state.challengeOpen(isl);
  const first = app.state.recordDiscovery(d.id);
  app.sound.play('correct'); setTimeout(() => app.sound.play('discover'), 260);
  if (app.world) app.world.burst(app.world.anchor(isl, d.anchor).focus.clone(), 0x9be06a, 40, { up: 3, dur: 1.8 });
  const nowOpen = isl !== 'center' && app.state.challengeOpen(isl);
  const nextD = (app.byId[isl].discoveries || []).find(x => !app.state.isFound(x.id));
  const gain = first && app.state.hasAdventurer ? ` <span class="note">（+${app.content.rpgRules.discoveryExp} EXP）</span>` : '';
  $('#tfb', box).innerHTML = `<div class="feedback ok"><strong>✅ 探索完成！</strong>${gain}<p>${esc(d.task.explain)}</p>
    <div class="row">${nowOpen ? '<button class="btn" type="button" data-n="boss">⚔️ 島主挑戰</button>' : ''}${nextD ? `<button class="btn ${nowOpen ? 'ghost' : ''}" type="button" data-n="next">下一個探索：${esc(nextD.title)}</button>` : ''}<button class="btn ghost" type="button" data-n="back">回到島上</button></div></div>`;
  const nb = $('[data-n="next"]', box); if (nb) nb.addEventListener('click', () => openDiscovery(nextD.id));
  const bb = $('[data-n="boss"]', box); if (bb) bb.addEventListener('click', () => openBoss(isl));
  $('[data-n="back"]', box).addEventListener('click', () => closeCard());
  if (first && nowOpen && !wasOpen) setTimeout(() => toast(`🔓「${app.byId[isl].name}」的島主挑戰開放了！`, 3600), 600);
  renderBanner(); updateLabelStates();
  $('#tfb', box).scrollIntoView({ block: 'nearest', behavior: app.reduced ? 'auto' : 'smooth' });
}
function openBoss(id) {
  const isl = app.byId[id];
  closeBubble();
  if (!$('#panel').hidden) { $('#panel').hidden = true; app.panelId = null; }
  const body = cardShell('⚔️', `${isl.name}・島主挑戰`, `${isl.npc ? isl.npc.name : ''}的島主挑戰`);
  renderChallengeIntro(body, isl, true);
  app.sound.play('open');
}
function openFinalCard() {
  closeBubble();
  if (!$('#panel').hidden) { $('#panel').hidden = true; app.panelId = null; }
  const body = cardShell('🏆', '中央島・詩兩首', '最終挑戰');
  renderFinal(body, true);
  app.sound.play('open');
}
function renderExploreList(tp, isl) {
  const list = isl.discoveries || [];
  const f = app.state.foundOn(isl.id);
  tp.innerHTML = `<p>在島上找找閃閃發亮的 ✨，點一下物件就會有變化，再完成小關卡。已完成 <strong>${f.done} / ${f.total}</strong>${isl.id !== 'center' ? `，完成 ${Math.min(app.content.rpgRules.challengeNeed, f.total)} 個就能挑戰島主` : ''}。</p>
    <ul class="disc-list">${list.map(d => `<li><span class="ic" aria-hidden="true">${d.icon}</span><div class="grow"><strong>${esc(d.title)}</strong>${app.state.isFound(d.id) ? ' <span class="done-flag">✅</span>' : ''}<br><span class="note">${esc(d.text.slice(0, 34))}…</span></div><button class="btn sm${app.state.isFound(d.id) ? ' ghost' : ''}" type="button" data-d="${d.id}">${app.state.isFound(d.id) ? '再玩' : '去探索'}</button></li>`).join('')}</ul>
    <p class="note">探索關卡依課文內容改寫，屬自編練習。</p>`;
  $$('[data-d]', tp).forEach(b => b.addEventListener('click', () => openDiscovery(b.dataset.d)));
}
function updateSpots() {
  const w = app.world; if (!w || !w.anchors) return;
  const box = $('#labels');
  app.spots ||= {};
  for (const d of Object.values(app.discById)) {
    const a = w.anchor(d.island, d.anchor); if (!a) continue;
    let b = app.spots[d.id];
    if (!b) {
      b = h(`<button type="button" class="spot" data-disc="${d.id}" aria-label="探索：${esc(d.title)}（${esc(app.byId[d.island].name)}）">✨</button>`);
      b.addEventListener('click', () => openDiscovery(d.id));
      box.appendChild(b); app.spots[d.id] = b;
    }
    const found = app.state.isFound(d.id);
    const p = w.project(a.pos);
    const near = w.camera.position.distanceTo(a.focus) < (w.camera.aspect < .8 ? 70 : 58);
    const vis = p.front && near && p.x > 0 && p.x < w._w && p.y > 60 && p.y < w._h;
    b.classList.toggle('hidden', !vis);
    if (found !== b._found) { b._found = found; b.classList.toggle('done', found); b.textContent = found ? '✓' : '✨'; }
    if (vis) { const sz = found ? 19 : 23; b.style.transform = `translate(${Math.round(p.x - sz)}px, ${Math.round(p.y - sz)}px)`; }
  }
}
function updateNear() {
  const w = app.world, btn = $('#near');
  let d = null;
  if (w && w.player && app.state.hasAdventurer && $('#card').hidden && $('#modal').hidden && $('#panel').hidden && !w.player.path.length) {
    const a = w.nearestAnchor(); if (a) d = findDisc(a.island, a.key);
  }
  if ((d && d.id) === app.nearDisc) return;
  app.nearDisc = d ? d.id : null;
  if (!d) { btn.hidden = true; return; }
  btn.textContent = `${window.matchMedia('(pointer: coarse)').matches ? '👆 點這裡' : '⌨️ 按 E'}：探索「${d.title}」${app.state.isFound(d.id) ? '（已完成）' : ''}`;
  btn.hidden = false;
}
function stepSounds(dt) {
  const w = app.world;
  if (!w || !w.playerWalking || app.reduced) { app.stepAcc = 0; return; }
  app.stepAcc = (app.stepAcc || 0) + dt;
  if (app.stepAcc > .34) { app.stepAcc = 0; app.sound.play('step'); }
}
function syncSoundButton() {
  const b = $('#btn-sound'); if (!b) return;
  const on = app.sound.musicOn || app.sound.sfxOn;
  b.setAttribute('aria-pressed', String(on));
  b.setAttribute('aria-label', `音樂與音效：${on ? '開' : '關'}`);
  b.querySelector('span').textContent = on ? '🔊' : '🔇';
}
// 站內確認視窗（取代瀏覽器的 confirm）
function askConfirm(msg, okText = '確定', cancelText = '取消') {
  return new Promise(res => {
    const c = $('#confirm');
    const ret = document.activeElement;
    $('#confirm-body').innerHTML = `<p id="confirm-title" style="font-size:17px;font-weight:700">${esc(msg)}</p><div class="row"><button class="btn" type="button" data-k="ok">${esc(okText)}</button><button class="btn ghost" type="button" data-k="no">${esc(cancelText)}</button></div>`;
    c.hidden = false;
    const done = v => { c.hidden = true; app.confirmResolve = null; if (ret && document.contains(ret)) ret.focus({ preventScroll: true }); res(v); };
    app.confirmResolve = done;
    c.querySelector('[data-k="ok"]').addEventListener('click', () => done(true));
    c.querySelector('[data-k="no"]').addEventListener('click', () => done(false));
    c.onclick = e => { if (e.target === c) done(false); };
    c.querySelector('[data-k="ok"]').focus();
  });
}
function openRestart() {
  const c = $('#confirm'), s = app.state;
  const ret = document.activeElement;
  $('#confirm-body').innerHTML = `<p id="confirm-title" style="font-size:20px;font-weight:900;color:var(--primary-strong);margin:0 0 6px">🔄 要怎麼重新玩？</p>
    <p class="note">重新開始會清除${s.hasAdventurer ? `「${esc(s.save.name)}」的` : ''}EXP、島章、探索、學習單、背包與測驗紀錄，島上的物件也會回到原來的樣子。</p>
    <div class="row" style="flex-direction:column;align-items:stretch">
      ${s.hasAdventurer ? `<button class="btn" type="button" data-k="same">同一位冒險者從頭開始</button>` : ''}
      <button class="btn alt" type="button" data-k="new">換一位新冒險者</button>
      <button class="btn ghost" type="button" data-k="no">取消</button></div>`;
  c.hidden = false;
  const close = () => { c.hidden = true; app.confirmResolve = null; };
  app.confirmResolve = () => { close(); if (ret) ret.focus({ preventScroll: true }); };
  c.onclick = e => { if (e.target === c) app.confirmResolve(); };
  const reset = () => {
    closeCard(true); closeBubble(); closeModal(true);
    if (!$('#panel').hidden) { $('#panel').hidden = true; app.panelId = null; }
    if (s.hasAdventurer) s.resetCurrent(); else { s.clearCourse(); s.clearBag(); }
    if (app.world) { app.world.resetFoundState(); app.world.setViewShift(0, 0); app.world.inputEnabled = true; }
    setFocus(null);
  };
  const same = c.querySelector('[data-k="same"]');
  if (same) same.addEventListener('click', () => {
    close(); reset();
    const go = () => { if (app.world) app.world.setPlayer(s.save.style, 'center'); toast(`重新出發！${s.save.name}，從中央島開始探索吧。`, 3600); };
    if (app.world && !app.reduced) playIntro(go); else { if (app.world) app.world.flyHome(); go(); }
  });
  c.querySelector('[data-k="new"]').addEventListener('click', () => {
    close(); reset(); s.browseOnly();
    if (app.world && !app.reduced) playIntro(openCreate); else { if (app.world) app.world.flyHome(); openCreate(); }
  });
  c.querySelector('[data-k="no"]').addEventListener('click', () => app.confirmResolve());
  (same || c.querySelector('[data-k="new"]')).focus();
}

boot();
