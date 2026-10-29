// 第 3 版：詩情畫意的場景
// 水墨遠山、山嵐、飄落的花瓣與落葉、夜晚的河燈。全部用程式畫出來，沒有外部圖檔。
import * as THREE from 'three';
import { rng, clamp, lerp, glowTexture } from './util.js';

const TAU = Math.PI * 2;

// ---------- 水墨遠山 ----------
// 畫一條可以首尾相接的山稜線，往下漸漸淡進霧裡
function inkRidgeTexture(seed, peaks, roughness) {
  const W = 2048, H = 512;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  const r = rng(seed);
  // 用整數頻率的正弦波疊加，左右兩端剛好接得起來
  const waves = [];
  for (let k = 0; k < 7; k++) waves.push({ f: (k < 2 ? peaks + k : Math.round(peaks * (1.7 + k * 1.3) + r() * 3)), a: (k < 2 ? .32 : .2 / (k * .9)) * (k > 2 ? roughness : 1), p: r() * TAU });
  const ridge = x => {
    const u = x / W * TAU;
    let v = 0;
    for (const w of waves) v += Math.sin(u * w.f + w.p) * w.a;
    // 讓山頭比較圓、山谷比較深，像國畫裡的山
    v = Math.sign(v) * Math.pow(Math.abs(v), .85);
    return H * (.46 - v * .5);
  };
  const path = new Path2D();
  path.moveTo(0, H);
  for (let x = 0; x <= W; x += 4) path.lineTo(x, ridge(x));
  path.lineTo(W, H); path.closePath();
  // 山體：上濃下淡
  const grad = g.createLinearGradient(0, H * .05, 0, H);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(.42, 'rgba(255,255,255,.92)');
  grad.addColorStop(.72, 'rgba(255,255,255,.38)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad; g.fill(path);
  // 山裡的層次：在山體內再刷幾道較淡的稜線（皴法的感覺）
  g.save(); g.clip(path);
  g.globalCompositeOperation = 'destination-out';
  for (let layer = 0; layer < 3; layer++) {
    const off = 40 + layer * 46, ph = r() * TAU;
    const lg = g.createLinearGradient(0, 0, 0, H);
    lg.addColorStop(0, 'rgba(0,0,0,0)'); lg.addColorStop(.5, `rgba(0,0,0,${.16 + layer * .05})`); lg.addColorStop(1, 'rgba(0,0,0,.25)');
    g.fillStyle = lg;
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x <= W; x += 6) g.lineTo(x, ridge(x) + off + Math.sin(x / W * TAU * (peaks * 2 + layer) + ph) * 18);
    g.lineTo(W, H); g.closePath(); g.fill();
  }
  g.restore();
  // 稜線的墨邊
  g.globalCompositeOperation = 'source-over';
  g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 2.2;
  g.beginPath(); for (let x = 0; x <= W; x += 4) { const y = ridge(x); x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  // 零星的松樹剪影
  for (let i = 0; i < 70; i++) {
    const x = r() * W, y = ridge(x) + 2, s = 4 + r() * 7;
    g.fillStyle = 'rgba(255,255,255,1)';
    g.beginPath(); g.moveTo(x, y - s * 1.8); g.lineTo(x - s * .6, y); g.lineTo(x + s * .6, y); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

export function buildInkMountains(w) {
  const layers = [
    { R: 215, H: 125, seed: 11, peaks: 5, rough: 1, rep: 2, rot: .4, amt: .18 },
    { R: 275, H: 170, seed: 23, peaks: 4, rough: .8, rep: 2, rot: 1.9, amt: .38 },
    { R: 345, H: 225, seed: 37, peaks: 3, rough: .6, rep: 2, rot: 3.1, amt: .58 }
  ];
  w.inkLayers = layers.map((L, i) => {
    const tex = inkRidgeTexture(L.seed, L.peaks, L.rough);
    tex.repeat.set(L.rep, 1);
    const m = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide, color: 0x5d7774 });
    m.toneMapped = false;
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(L.R, L.R, L.H, 128, 1, true), m);
    mesh.position.y = L.H / 2 - 7;
    mesh.rotation.y = L.rot;
    mesh.renderOrder = 3 - i; // 在海面之後畫、遠的先畫（海面寫入深度，前面的海會擋住山腳）
    mesh.frustumCulled = false;
    w.scene.add(mesh);
    return { mesh, mat: m, amt: L.amt };
  });
}

// ---------- 柔和的霧氣貼圖 ----------
function mistTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 96;
  const g = c.getContext('2d');
  const r = rng(5);
  for (let i = 0; i < 26; i++) {
    const x = 30 + r() * 196, y = 34 + r() * 30, rad = 18 + r() * 30;
    const gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, 'rgba(255,255,255,.34)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, rad * 1.6, rad * .7, 0, 0, TAU); g.fill();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function buildMist(w) {
  const tex = mistTexture();
  const r = rng(77);
  w.mists = [];
  const add = (x, y, z, sx, sy, base, drift, far) => {
    const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: base, fog: !far, color: 0xffffff });
    const s = new THREE.Sprite(m);
    s.position.set(x, y, z); s.scale.set(sx, sy, 1);
    s.renderOrder = far ? 4 : 6;
    w.scene.add(s);
    w.mists.push({ s, m, base, x, z, y, a: Math.atan2(z, x), R: Math.hypot(x, z), drift, ph: r() * TAU, far });
  };
  // 群島外圍、遠山前面的一圈山嵐（層層疊疊的感覺）
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * TAU + r() * .1, R = 150 + r() * 50;
    add(Math.cos(a) * R, 5 + r() * 9, Math.sin(a) * R, 120 + r() * 60, 18 + r() * 8, .45, .004 * (r() > .5 ? 1 : -1), true);
  }
  // 每座島周圍貼著水面的薄霧
  for (const s of w.islands) {
    const n = s.id === 'center' ? 3 : 5;
    for (let i = 0; i < n; i++) {
      const a = r() * TAU, R = s.R * (1 + r() * .35);
      add(s.x + Math.cos(a) * R, s.top - .6 + r() * 1.6, s.z + Math.sin(a) * R, 16 + r() * 10, 4 + r() * 2, .35, .02 * (r() > .5 ? 1 : -1), false);
    }
  }
  // 鹿柴的山頭（空山）與鳥鳴澗的山谷多一點雲霧
  const hill = w.islandById['island-01'], vale = w.islandById['island-02'];
  if (hill) for (let i = 0; i < 4; i++) { const a = r() * TAU; add(hill.x + Math.cos(a) * 4, hill.top + 4 + r() * 3, hill.z + Math.sin(a) * 4, 14, 3.6, .42, .03, false); }
  if (vale) for (let i = 0; i < 3; i++) { const a = r() * TAU; add(vale.x + Math.cos(a) * 3, vale.top + 2.5 + r() * 2, vale.z + Math.sin(a) * 3, 12, 3, .36, .03, false); }
}

// ---------- 飄落的花瓣與落葉 ----------
function petalTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  g.translate(32, 32); g.rotate(-.5);
  const gr = g.createRadialGradient(0, -4, 2, 0, 0, 26);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,.75)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(0, -24); g.bezierCurveTo(18, -14, 14, 14, 0, 24); g.bezierCurveTo(-14, 14, -18, -14, 0, -24); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const PETAL_COLOR = {
  center: '#f6b9c8',       // 廣場：粉色花瓣
  'island-01': '#e2a54a',  // 鹿柴：夕陽裡的金黃落葉
  'island-02': '#f7dc7a',  // 鳥鳴澗：細碎的桂花
  'island-03': '#fbd3e2',  // 延伸學習：花圃的花瓣
  'island-04': '#a9cc8c'   // 王維：竹葉
};
export function buildPetals(w) {
  const N = w.mobile ? 70 : 140;
  const pos = new Float32Array(N * 3);
  const r = rng(91);
  w.petalData = [];
  for (let i = 0; i < N; i++) {
    const p = { x: (r() - .5) * 36, y: r() * 14, z: (r() - .5) * 36, vy: .35 + r() * .5, ph: r() * TAU, sw: .4 + r() * .8 };
    w.petalData.push(p); pos.set([p.x, p.y, p.z], i * 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const m = new THREE.PointsMaterial({ map: petalTexture(), size: .32, sizeAttenuation: true, transparent: true, depthWrite: false, alphaTest: .05, color: new THREE.Color(PETAL_COLOR.center) });
  w.petals = new THREE.Points(g, m);
  w.petals.frustumCulled = false;
  w.scene.add(w.petals);
  w.petalCenter = new THREE.Vector3();
  w.petalColor = new THREE.Color(PETAL_COLOR.center);
}
export function petalColorFor(id) { return PETAL_COLOR[id] || PETAL_COLOR.center; }

// ---------- 夜晚潟湖上的河燈 ----------
export function buildLanterns(w) {
  const r = rng(303);
  const glow = glowTexture('rgba(255,236,190,1)', 'rgba(255,170,80,0)');
  w.lanterns = [];
  const body = new THREE.MeshBasicMaterial({ color: 0xffc777, transparent: true, opacity: 0 });
  body.toneMapped = false;
  const base = new THREE.MeshBasicMaterial({ color: 0x7a4a2a, transparent: true, opacity: 0 });
  const bodyG = new THREE.CylinderGeometry(.22, .28, .42, 6), baseG = new THREE.CylinderGeometry(.42, .38, .1, 6);
  let tries = 0;
  while (w.lanterns.length < 18 && tries++ < 400) {
    const a = r() * TAU, R = 17 + r() * 34;
    const x = Math.cos(a) * R, z = Math.sin(a) * R;
    if (w.islands.some(s => Math.hypot(x - s.x, z - s.z) < s.R + 3)) continue;
    const g = new THREE.Group();
    const b = new THREE.Mesh(baseG, base); b.position.y = .05;
    const l = new THREE.Mesh(bodyG, body); l.position.y = .3;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffb860, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    sp.scale.setScalar(2.6); sp.position.y = .35;
    g.add(b, l, sp);
    g.position.set(x, 0, z);
    w.scene.add(g);
    w.lanterns.push({ g, sp, a, R, speed: (.004 + r() * .006) * (r() > .5 ? 1 : -1), ph: r() * TAU });
  }
  w.lanternMats = [body, base];
}

// ---------- 依時段調整顏色 ----------
export function tintPoetic(w, p) {
  const night = p.night;
  if (w.inkLayers) {
    const ink = new THREE.Color('#3f5a5c').lerp(new THREE.Color('#1c2433'), clamp(night, 0, 1));
    const hor = p.hor.clone().lerp(p.fog, .5);
    for (const L of w.inkLayers) L.mat.color.copy(ink.clone().lerp(hor, L.amt));
  }
  if (w.mists) {
    const mc = new THREE.Color('#ffffff').lerp(p.hor, .35).multiplyScalar(lerp(1, .55, night));
    for (const m of w.mists) { m.m.color.copy(mc); m.k = 1 + (w.env && w.env.duskBeam > 1 ? .35 : 0) - night * .25; }
  }
  const on = clamp((night - .45) * 2.2, 0, 1);
  if (w.lanterns) {
    w.lanternMats[0].opacity = on; w.lanternMats[1].opacity = on;
    for (const L of w.lanterns) { L.g.visible = on > .01; L.sp.material.opacity = on * .9; }
  }
}

// ---------- 每一格的動畫 ----------
const _v = new THREE.Vector3();
export function updatePoetic(w, dt, t, still) {
  const cam = w.camera.position;
  if (w.mists) for (const m of w.mists) {
    if (!still) {
      if (m.far) { m.a += dt * m.drift; m.s.position.x = Math.cos(m.a) * m.R; m.s.position.z = Math.sin(m.a) * m.R; }
      else { m.s.position.x = m.x + Math.sin(t * m.drift * 6 + m.ph) * 2.2; m.s.position.y = m.y + Math.sin(t * .3 + m.ph) * .25; }
    }
    // 鏡頭靠太近時淡出，不會整片白
    const d = m.s.position.distanceTo(cam);
    const near = clamp((d - m.s.scale.x * .35) / (m.s.scale.x * .5), 0, 1);
    m.m.opacity = m.base * (m.k || 1) * near;
  }
  if (w.petals) {
    // 花瓣跟著鏡頭看的地方（第一人稱就在身邊）
    const fp = w.viewMode === 'fp' && w.player;
    const c = fp ? w.player.pos : w.controls.target;
    w.petalCenter.lerp(c, still ? 1 : Math.min(1, dt * 2));
    const pc = w.petalCenter;
    const half = fp ? 13 : 18, top = fp ? 9 : 14;
    const arr = w.petals.geometry.attributes.position.array;
    const show = (w.env ? w.env.night : 0) < .9;
    w.petals.visible = show && !w.cinema;
    if (show && !still) {
      for (let i = 0; i < w.petalData.length; i++) {
        const p = w.petalData[i];
        p.y -= p.vy * dt;
        p.ph += dt * p.sw;
        let x = p.x + Math.sin(p.ph) * .9 + t * .25, z = p.z + Math.cos(p.ph * .8) * .6;
        if (p.y < 0) { p.y = top; p.x = (Math.random() - .5) * half * 2; p.z = (Math.random() - .5) * half * 2; }
        // 超出範圍就從另一邊繞回來
        x = ((x % (half * 2)) + half * 3) % (half * 2) - half;
        arr[i * 3] = pc.x + x; arr[i * 3 + 1] = pc.y + p.y - 1; arr[i * 3 + 2] = pc.z + z;
      }
      w.petals.geometry.attributes.position.needsUpdate = true;
    } else if (show && still && !w._petalsPlaced) {
      for (let i = 0; i < w.petalData.length; i++) { const p = w.petalData[i]; arr[i * 3] = pc.x + p.x; arr[i * 3 + 1] = pc.y + p.y; arr[i * 3 + 2] = pc.z + p.z; }
      w.petals.geometry.attributes.position.needsUpdate = true; w._petalsPlaced = true;
    }
    if (w.petalColorTarget) w.petals.material.color.lerp(w.petalColorTarget, Math.min(1, dt * 2));
  }
  if (w.lanterns) for (const L of w.lanterns) {
    if (!L.g.visible) continue;
    if (!still) L.a += dt * L.speed;
    const x = Math.cos(L.a) * L.R, z = Math.sin(L.a) * L.R;
    // 不要漂進島裡
    let ok = true; for (const s of w.islands) if (Math.hypot(x - s.x, z - s.z) < s.R + 2) { ok = false; break; }
    if (ok) { L.g.position.x = x; L.g.position.z = z; } else L.speed = -L.speed;
    L.g.position.y = still ? .15 : .15 + Math.sin(t * 1.2 + L.ph) * .08;
    L.g.rotation.z = still ? 0 : Math.sin(t * .9 + L.ph) * .06;
  }
  void _v;
}
