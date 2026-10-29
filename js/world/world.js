import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rng, lerp, clamp, easeInOutCubic, col, jitter, mat, StaticBatch, makeRadiusFn, ringFrustum, blobPatch, mergedMesh, glowTexture, textTexture, CJK } from './util.js';
import * as P from './props.js';
import { makePerson, makeAnimal, Agent, M } from './characters.js';

const TAU = Math.PI * 2;
const OUTER_DIST = 36;
const OUTER_ANG = [-3 * Math.PI / 4, -Math.PI / 4, Math.PI / 4, 3 * Math.PI / 4]; // 島 1~4 的方位（x=cos, z=sin）

// ---------- 晝夜色票 ----------
const NIGHT = { top: '#0b1430', hor: '#22305a', sun: '#9fb2e6', sunI: .55, hs: '#4a5f96', hg: '#1c1a2a', hI: .55, fog: '#1d2748', night: 1, seaS: '#1f6573', seaD: '#0e2747' };
const DAWN = { top: '#7491c6', hor: '#f6b38a', sun: '#ffbe8a', sunI: 1.3, hs: '#d6c3cf', hg: '#6a5040', hI: .7, fog: '#ecc6ad', night: .25, seaS: '#62bdbb', seaD: '#2f6f95' };
const DAY = { top: '#4a9ce0', hor: '#d6eef7', sun: '#fff3dc', sunI: 2.6, hs: '#d3eaff', hg: '#8a7a5a', hI: 1.0, fog: '#d3e9f2', night: 0, seaS: '#3fc2bf', seaD: '#2584b2' };
const DUSK = { top: '#6a6aa8', hor: '#ffa56c', sun: '#ffa060', sunI: 2.3, hs: '#ffd2b8', hg: '#7a5a48', hI: 1.0, fog: '#f5b08e', night: .2, seaS: '#6cc6cc', seaD: '#3a72a4' };
const EVE = { top: '#18204a', hor: '#5a4170', sun: '#c79bd0', sunI: .7, hs: '#6a5f96', hg: '#251c2a', hI: .58, fog: '#3a3058', night: .85, seaS: '#2a6e7a', seaD: '#122d50' };
const KEYS = [[0, NIGHT], [4.8, NIGHT], [6.3, DAWN], [8.5, DAY], [16.2, DAY], [18, DUSK], [19.3, EVE], [20.6, NIGHT], [24, NIGHT]];
const THEME_TINT = { sunset: '#fbefe3', beach: '#f6ead2', dusk: '#2b1e1a' };
const MODE_HOUR = { day: 13, dusk: 18, night: 22 };

function palette(h) {
  h = ((h % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && h > KEYS[i + 1][0]) i++;
  const [h0, a] = KEYS[i], [h1, b] = KEYS[i + 1];
  const t = clamp((h - h0) / (h1 - h0 || 1), 0, 1);
  const out = {};
  for (const k of Object.keys(a)) out[k] = typeof a[k] === 'number' ? lerp(a[k], b[k], t) : new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), t);
  return out;
}
export function phaseOf(h) { h = ((h % 24) + 24) % 24; return h >= 6 && h < 16.5 ? 'day' : h >= 16.5 && h < 19.5 ? 'dusk' : 'night'; }

export class World {
  constructor(canvas, content, opts = {}) {
    this.canvas = canvas;
    this.content = content;
    this.mobile = !!opts.mobile;
    this.quality = opts.quality || (this.mobile ? 'low' : 'high');
    this.reduced = !!opts.reduced;
    this.theme = opts.theme || 'sunset';
    this.on = {};
    this.animated = [];
    this.agents = [];
    this.animals = [];
    this.extraLow = []; // 低畫質時隱藏的東西
    this.hour = MODE_HOUR.day; this.targetHour = this.hour; this.timeMode = 'day';
    this.t = 0;
    this.follow = true;
    this.keys = new Set();
    this.inputEnabled = true;
    this.flight = null;
    this.cinema = false;
    this.fps = { acc: 0, n: 0, low: 0 };
    this.fxs = [];
  }

  // ======================================================
  async init() {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: !this.mobile, powerPreference: 'high-performance' });
    } catch (e) { throw new Error('WebGL 無法啟動'); }
    if (!renderer.getContext()) throw new Error('WebGL 無法啟動');
    this.renderer = renderer;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const scene = this.scene = new THREE.Scene();
    scene.fog = new THREE.Fog(0xd3e9f2, 150, 520);
    this.camera = new THREE.PerspectiveCamera(42, 1, .5, 1400);
    this.controls = new OrbitControls(this.camera, this.canvas);
    Object.assign(this.controls, { enableDamping: true, dampingFactor: .08, minDistance: 14, maxDistance: 175, maxPolarAngle: 1.32, minPolarAngle: .18, enablePan: true, panSpeed: .6, rotateSpeed: .7, zoomSpeed: .9 });
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('start', () => { this.userControlling = true; });
    this.controls.addEventListener('end', () => { this.userControlling = false; });

    this.mat = {
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .88, metalness: 0 }),
      ground: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .95, metalness: 0 }),
      window: new THREE.MeshBasicMaterial({ color: 0x6b7a86 }),
      anim: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .85 })
    };
    this.mat.window.toneMapped = false;

    if (document.fonts && document.fonts.ready) await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1500))]);

    this.buildSky();
    this.buildLights();
    this.buildSea();
    this.layoutIslands();
    this.planIslands();
    const batch = new StaticBatch();
    this.batch = batch;
    this.glows = [];
    this.pointLights = [];
    this.buildAtoll(batch);
    this.islands.forEach(isl => this.buildIsland(batch, isl));
    this.buildBridges(batch);
    this.buildLandmarks(batch);
    this.buildMountains(batch);
    this.staticMeshes = batch.build(this.mat, scene);
    this.buildPeople();
    this.buildAnimals();
    this.buildSkyLife();
    this.buildFireflies();
    this.buildShells();
    this.applyQuality();
    this.resize();
    this.setCamera(this.homeView());
    this.bindInput();
    this.applyTime(true);
    this.clock = new THREE.Clock();
    renderer.setAnimationLoop(() => this.frame());
    return this;
  }

  // ======================================================
  // 天空：漸層穹頂、太陽月亮光暈、星星
  buildSky() {
    const geo = new THREE.SphereGeometry(900, 32, 16);
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color() }, hor: { value: new THREE.Color() }, bot: { value: new THREE.Color() } },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'uniform vec3 top; uniform vec3 hor; uniform vec3 bot; varying vec3 vP; void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(hor, top, pow(clamp(h*1.6,0.0,1.0), 0.75)) : mix(hor, bot, clamp(-h*4.0,0.0,1.0)); gl_FragColor = vec4(c,1.0);\n#include <colorspace_fragment>\n}'
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(255,245,220,1)', 'rgba(255,200,120,0)'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.sunSprite.scale.setScalar(120);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture('rgba(235,240,255,1)', 'rgba(160,180,255,0)'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    this.moonSprite.scale.setScalar(70);
    this.scene.add(this.sunSprite, this.moonSprite);
    const N = 700, pos = new Float32Array(N * 3), r = rng(7);
    for (let i = 0; i < N; i++) {
      const th = r() * TAU, ph = Math.acos(1 - r() * .95);
      pos.set([Math.cos(th) * Math.sin(ph) * 800, Math.cos(ph) * 800 + 20, Math.sin(th) * Math.sin(ph) * 800], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
  }

  buildLights() {
    this.hemi = new THREE.HemisphereLight(0xd3eaff, 0x8a7a5a, 1);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.4);
    this.sun.castShadow = true;
    const s = this.sun.shadow;
    s.camera.left = -78; s.camera.right = 78; s.camera.top = 78; s.camera.bottom = -78; s.camera.near = 10; s.camera.far = 320;
    s.bias = -.0006; s.normalBias = .04;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.amb = new THREE.AmbientLight(0xffffff, .12);
    this.scene.add(this.amb);
  }

  // 海：極座標網格，越靠近中央越密；潟湖淺、外海深
  buildSea() {
    if (this.sea) { this.scene.remove(this.sea); this.sea.geometry.dispose(); }
    const rings = this.quality === 'low' ? 30 : 46, segs = this.quality === 'low' ? 64 : 96;
    const pos = [], amp = [], depth = [];
    const radius = i => 520 * Math.pow(i / rings, 1.75);
    const atollR = th => 56 + 2.4 * Math.sin(3 * th + .7) + 1.4 * Math.sin(5 * th + 2.1);
    const vert = (i, j) => {
      const th = j / segs * TAU, r = radius(i);
      const ar = atollR(th);
      return [Math.cos(th) * r, Math.sin(th) * r, clamp((r - (ar - 5)) / 10, 0, 1)];
    };
    for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {
      const q = [vert(i, j), vert(i, j + 1), vert(i + 1, j + 1), vert(i + 1, j)];
      const tris = i === 0 ? [[0, 2, 3]] : [[0, 1, 2], [0, 2, 3]];
      for (const tri of tris) for (const k of tri) {
        const [x, z, d] = q[k];
        pos.push(x, 0, z); depth.push(d); amp.push(lerp(.07, .45, d) * clamp(1 - Math.hypot(x, z) / 520, .2, 1));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('amp', new THREE.Float32BufferAttribute(amp, 1));
    g.setAttribute('depth', new THREE.Float32BufferAttribute(depth, 1));
    if (!this.seaMat) {
      this.seaUniforms = { uTime: { value: 0 }, uShallow: { value: new THREE.Color('#58d2c6') }, uDeep: { value: new THREE.Color('#2584b2') } };
      const m = new THREE.MeshStandardMaterial({ flatShading: true, roughness: .32, metalness: .05, transparent: true, opacity: .84 });
      m.onBeforeCompile = sh => {
        Object.assign(sh.uniforms, this.seaUniforms);
        sh.vertexShader = 'attribute float amp; attribute float depth; uniform float uTime; varying float vDepth;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          vDepth = depth;
          transformed.y += (sin(position.x*.16 + uTime*1.1) + cos(position.z*.13 + uTime*.8) + sin((position.x+position.z)*.07 + uTime*.6)) * amp * .5;`);
        sh.fragmentShader = 'uniform vec3 uShallow; uniform vec3 uDeep; varying float vDepth;\n' + sh.fragmentShader.replace('vec4 diffuseColor = vec4( diffuse, opacity );', 'vec4 diffuseColor = vec4( mix(uShallow, uDeep, vDepth), mix(0.8, 0.95, vDepth) );');
      };
      this.seaMat = m;
    }
    this.sea = new THREE.Mesh(g, this.seaMat);
    this.sea.receiveShadow = true;
    this.sea.frustumCulled = false;
    this.scene.add(this.sea);
    if (!this.floor) {
      // 潟湖底下的沙與深海底
      const bed = new THREE.Mesh(new THREE.CircleGeometry(64, 48), new THREE.MeshStandardMaterial({ color: 0xead6a4, roughness: 1, flatShading: true }));
      bed.rotation.x = -Math.PI / 2; bed.position.y = -2.4; bed.receiveShadow = true;
      const deep = new THREE.Mesh(new THREE.CircleGeometry(560, 48), new THREE.MeshBasicMaterial({ color: 0x0b2f52 }));
      deep.rotation.x = -Math.PI / 2; deep.position.y = -7;
      this.deepMat = deep.material;
      this.scene.add(bed, deep);
      this.floor = bed;
      // 潟湖底的色塊
      const r = rng(31);
      const parts = [];
      for (let i = 0; i < 40; i++) { const a = r() * TAU, d = 14 + r() * 38; parts.push([blobPatch(1.5 + r() * 3, i + 3), r() > .5 ? '#d9c28e' : '#f2e2b8', mat(Math.cos(a) * d, -2.35, Math.sin(a) * d)]); }
      const m = mergedMesh(parts, this.mat.ground, false); m.receiveShadow = true;
      this.scene.add(m);
    }
  }

  // ======================================================
  layoutIslands() {
    const c = this.content;
    const centerR = 13;
    const isl = [{ id: 'center', name: c.center.name, x: 0, z: 0, R: centerR, top: 2.7, seed: 11, walkR: 7.6 }];
    c.islands.forEach((d, i) => {
      const a = OUTER_ANG[i % 4] + Math.floor(i / 4) * .4;
      const dist = OUTER_DIST + Math.floor(i / 4) * 16;
      isl.push({ id: d.id, name: d.name, order: d.order, x: Math.cos(a) * dist, z: Math.sin(a) * dist, R: 9.6, top: 2.25, seed: 100 + i * 17, walkR: 5.1, ang: a });
    });
    for (const s of isl) {
      s.rf = makeRadiusFn(s.R, s.seed);
      s.pos = new THREE.Vector3(s.x, s.top, s.z);
      s.toCenter = s.id === 'center' ? 0 : Math.atan2(-s.z, -s.x);
      s.obstacles = [];
      s.ring = [];
      const n = s.id === 'center' ? 32 : 24;
      for (let k = 0; k < n; k++) { const a = k / n * TAU; s.ring.push(new THREE.Vector3(s.x + Math.cos(a) * s.walkR, s.top, s.z + Math.sin(a) * s.walkR)); }
      s.entry = s.id === 'center' ? null : new THREE.Vector3(s.x + Math.cos(s.toCenter) * s.walkR, s.top, s.z + Math.sin(s.toCenter) * s.walkR);
      s.labelPos = new THREE.Vector3(s.x, s.top + (s.id === 'center' ? 9.5 : 8), s.z);
    }
    this.islands = isl;
    this.islandById = Object.fromEntries(isl.map(s => [s.id, s]));
    // 拾取用的隱形圓柱
    this.pickables = [];
    for (const s of isl) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(s.R * .95, s.R * 1.05, s.top + 1, 24), new THREE.MeshBasicMaterial({ visible: false }));
      m.position.set(s.x, (s.top + 1) / 2 - .5, s.z);
      m.userData.island = s.id;
      this.scene.add(m);
      this.pickables.push(m);
    }
  }

  // 先規劃每座島的扇區，避免房子、碼頭、地標互相重疊
  planIslands() {
    const ids = this.content.islands.map(i => i.id);
    for (const s of this.islands) {
      const at = (a, d) => [s.x + Math.cos(a) * d, s.z + Math.sin(a) * d];
      s.reserve = []; s.excludeA = [];
      if (s.id === 'center') {
        Object.assign(s, { houseAngles: [Math.PI + .5, Math.PI * 1.5 + .35], dockA: Math.PI / 2 + .5, crateA: Math.PI / 2 + .2, trees: ['palm', 'round', 'palm', 'pine'], treeCount: 8 });
        continue;
      }
      const c = s.toCenter, idx = ids.indexOf(s.id);
      Object.assign(s, { houseAngles: [c + 1.3, c - 1.45, c + 2.5], dockA: c - 2.2, crateA: c - 1.95, trees: ['round', 'palm', 'pine', 'round', 'palm'], treeCount: 9 });
      if (idx === 0) {
        // 鹿柴：空山，不放房子，滿山松林
        Object.assign(s, { houseAngles: [], trees: ['pine', 'pine', 'round', 'pine'], treeCount: 16, ringRange: [c - 1.15, c + 1.15] });
        s.deerPos = at(c + 1.45, s.walkR + 2.0); s.mossPos = at(c - 1.35, s.walkR + 1.7);
        s.reserve.push([...s.deerPos, 2.0], [...s.mossPos, 1.0]);
      }
      if (idx === 1) {
        const out = c + Math.PI + .5; s.streamAngle = out;
        s.excludeA.push(out);
        s.houseAngles = [c + 1.3];
        s.trees = ['pine', 'osmanthus', 'round', 'pine'];
        s.ridges = [at(out - .62, s.walkR + 2.05), at(out + .62, s.walkR + 2.05)];
        s.ridges.forEach(([x, z], i) => { const a = out + (i ? .62 : -.62), tx = -Math.sin(a), tz = Math.cos(a); s.reserve.push([x + tx * 1.15, z + tz * 1.15, 1.45], [x - tx * 1.15, z - tz * 1.15, 1.45]); });
        s.dockA = c - 1.25; s.crateA = c - 1.6;
      }
      if (idx === 2) { s.houseAngles = [c + 1.25, c - 1.45]; s.windmillPos = at(c + 2.05, s.walkR + 2.2); s.reserve.push([...s.windmillPos, 1.5]); s.trees = ['round', 'palm', 'round', 'pine']; }
      if (idx === 3) {
        s.houseAngles = [c + 1.3, c + 3.2];
        s.bambooPos = at(c + 2.3, s.walkR + 2.3); s.fieldPos = at(c - 1.5, s.walkR + 2.2);
        s.reserve.push([...s.bambooPos, 1.7], [...s.fieldPos, 2.1]);
        s.trees = ['round', 'pine', 'round', 'palm'];
      }
    }
  }

  // 環礁：外圈白色沙洲（兩個水道缺口）
  buildAtoll(b) {
    const r = rng(77);
    const atollR = th => 56 + 2.4 * Math.sin(3 * th + .7) + 1.4 * Math.sin(5 * th + 2.1);
    const segs = 120, pos = [], colors = [];
    const gaps = [[.62, .16], [3.75, .14]];
    const inGap = th => gaps.some(([g, w]) => Math.abs(((th - g + Math.PI) % TAU + TAU) % TAU - Math.PI) < w);
    const prof = [[-3.6, -2.6], [-2.2, .1], [-1.2, .42], [1.2, .42], [2.4, .05], [3.8, -2.6]];
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * TAU, a1 = (i + 1) / segs * TAU;
      if (inGap(a0) || inGap(a1)) continue;
      const w0 = 1 + .25 * Math.sin(a0 * 7), w1 = 1 + .25 * Math.sin(a1 * 7);
      for (let k = 0; k < prof.length - 1; k++) {
        const p = (a, w, j) => { const R = atollR(a) + prof[j][0] * w; return [Math.cos(a) * R, prof[j][1], Math.sin(a) * R]; };
        const q = [p(a0, w0, k), p(a1, w1, k), p(a1, w1, k + 1), p(a0, w0, k + 1)];
        pos.push(...q[0], ...q[2], ...q[1], ...q[0], ...q[3], ...q[2]);
        for (let t = 0; t < 2; t++) { const c = jitter(k === 2 ? '#fbf3df' : '#f1e0b6', .3, r); for (let v = 0; v < 3; v++) colors.push(c.r, c.g, c.b); }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    b.add('ground', g, null);
    this.atollR = atollR; this.atollGap = inGap;
    // 沙洲上的棕櫚、小木屋、救生圈、海星
    for (let i = 0; i < 22; i++) {
      const a = r() * TAU; if (inGap(a) || inGap(a + .05) || inGap(a - .05)) continue;
      const R = atollR(a) + (r() - .5) * 1.6;
      P.tree(b, Math.cos(a) * R, .4, Math.sin(a) * R, r, 'palm', .9 + r() * .4);
    }
    const hutA = 1.9, hutR = atollR(hutA);
    P.house(b, Math.cos(hutA) * hutR, .4, Math.sin(hutA) * hutR, -hutA - Math.PI / 2, r, { w: 1.6, d: 1.4, h: 1.2, wall: '#f4e2c0', roof: '#2f8f83' });
    const lrA = 2.35, lrR = atollR(lrA);
    b.add('solid', P.G.box, P.PAL.woodDark, mat(Math.cos(lrA) * lrR, 1.1, Math.sin(lrA) * lrR, 0, 0, 0, .1, 1.4, .1));
    for (let k = 0; k < 8; k++) {
      const seg = new THREE.TorusGeometry(.42, .13, 6, 3, TAU / 8);
      b.add('solid', seg, k % 2 ? '#ffffff' : '#e8455e', mat(Math.cos(lrA) * lrR, 1.4, Math.sin(lrA) * lrR + .08, 0, 0, k * TAU / 8));
    }
    const star = new THREE.Shape();
    for (let k = 0; k < 10; k++) { const rr = k % 2 ? .12 : .32, a = k / 10 * TAU; k ? star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : star.moveTo(rr, 0); }
    const sg = new THREE.ExtrudeGeometry(star, { depth: .06, bevelEnabled: false });
    for (let i = 0; i < 9; i++) {
      const a = r() * TAU; if (inGap(a)) continue;
      const R = atollR(a) + (r() - .5) * 2;
      b.add('solid', sg, r() > .5 ? '#ff8a5c' : '#f3c64b', mat(Math.cos(a) * R, .45, Math.sin(a) * R, -Math.PI / 2, 0, r() * 3));
    }
    // 沙洲浪花
    this.foams = [];
    for (const off of [-2.6, 2.9]) {
      const fpos = [];
      for (let i = 0; i < segs; i++) {
        const a0 = i / segs * TAU, a1 = (i + 1) / segs * TAU;
        if (inGap(a0) || inGap(a1)) continue;
        const r0 = atollR(a0) + off, r1 = atollR(a1) + off, w = .9;
        const q = [[Math.cos(a0) * (r0 - w / 2), Math.sin(a0) * (r0 - w / 2)], [Math.cos(a1) * (r1 - w / 2), Math.sin(a1) * (r1 - w / 2)], [Math.cos(a1) * (r1 + w / 2), Math.sin(a1) * (r1 + w / 2)], [Math.cos(a0) * (r0 + w / 2), Math.sin(a0) * (r0 + w / 2)]];
        for (const k of [0, 2, 1, 0, 3, 2]) fpos.push(q[k][0], .1, q[k][1]);
      }
      const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
      const fm = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .55, depthWrite: false }));
      this.scene.add(fm); this.foams.push(fm);
    }
  }

  // ======================================================
  // 一座島：沙灘、分層岩壁、草地、色塊、樹、房子、小路、碼頭……
  buildIsland(b, s) {
    const r = rng(s.seed);
    const { x, z, top, rf } = s;
    const at = (a, d) => [x + Math.cos(a) * d, z + Math.sin(a) * d];
    const local = th => rf(th);
    // 沙灘斜坡（水下延伸，透過潟湖看得到）
    b.add('ground', ringFrustum(local, -2.3, 1.3, .32, 1.07, 64, false, rr => jitter(P.PAL.sand[Math.floor(rr() * 3)], .3, rr), r), null, mat(x, 0, z));
    b.add('ground', ringFrustum(local, .32, 1.07, .5, .96, 64, true, rr => jitter('#f3e0b4', .25, rr), r), null, mat(x, 0, z));
    // 島底岩層分層
    const layers = [[.4, .965, .95, .955, P.PAL.rock[3]], [.95, .955, 1.5, .93, P.PAL.rock[2]], [1.5, .93, top - .38, .9, P.PAL.rock[1]]];
    for (const [y0, s0, y1, s1, c] of layers) b.add('ground', ringFrustum(local, y0, s0, y1, s1, 64, false, rr => jitter(c, .35, rr), r), null, mat(x, 0, z));
    for (const [y0, c] of [[.95, P.PAL.rock[4]], [1.5, P.PAL.rock[3]]]) b.add('ground', ringFrustum(local, y0 - .04, .962, y0 + .04, .962, 64, false, rr => jitter(c, .2, rr), r), null, mat(x, 0, z));
    // 草地頂面（帶色塊）
    b.add('ground', ringFrustum(local, top - .4, .905, top - .05, .9, 64, false, rr => jitter(P.PAL.grassDark, .4, rr), r), null, mat(x, 0, z));
    b.add('ground', ringFrustum(local, top - .05, .9, top, .875, 64, true, rr => jitter(P.PAL.grass[Math.floor(rr() * 4)], .5, rr), r), null, mat(x, 0, z));
    // 地面色塊拼貼
    for (let i = 0; i < (s.id === 'center' ? 16 : 11); i++) {
      const a = r() * TAU, d = r() * s.R * .78;
      const [px, pz] = at(a, d);
      b.add('ground', blobPatch(.8 + r() * 1.5, s.seed + i * 3), jitter(P.PAL.grass[Math.floor(r() * 4)], .7, r), mat(px, top + .012 + i * .0008, pz));
    }
    // 浪花圈
    const fpos = [], segs = 64;
    for (let i = 0; i < segs; i++) {
      const a0 = i / segs * TAU, a1 = (i + 1) / segs * TAU;
      const ri0 = rf(a0) * 1.1, ri1 = rf(a1) * 1.1, ro0 = rf(a0) * 1.22, ro1 = rf(a1) * 1.22;
      const q = [[Math.cos(a0) * ri0, Math.sin(a0) * ri0], [Math.cos(a1) * ri1, Math.sin(a1) * ri1], [Math.cos(a1) * ro1, Math.sin(a1) * ro1], [Math.cos(a0) * ro0, Math.sin(a0) * ro0]];
      for (const k of [0, 2, 1, 0, 3, 2]) fpos.push(x + q[k][0], .12, z + q[k][1]);
    }
    const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.Float32BufferAttribute(fpos, 3));
    const foam = new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .6, depthWrite: false }));
    this.scene.add(foam); this.foams.push(foam);

    // 石板小路（就是居民散步的環狀路）＋通往橋的小路
    s.ring.forEach((p, k) => { P.stoneTile(b, p.x, top, p.z, r); const n = s.ring[(k + 1) % s.ring.length]; P.stoneTile(b, (p.x + n.x) / 2, top, (p.z + n.z) / 2, r); });
    const bridgeAngles = s.id === 'center' ? this.islands.filter(o => o.id !== 'center').map(o => Math.atan2(o.z, o.x)) : [s.toCenter];
    s.bridgeAngles = bridgeAngles;
    for (const ba of bridgeAngles) for (let d = s.walkR + .5; d < rf(ba) * .86; d += .55) { const [px, pz] = at(ba, d); P.stoneTile(b, px, top, pz, r); }
    if (s.id !== 'center') for (let d = .8; d < s.walkR - .3; d += .6) { const [px, pz] = at(s.toCenter, d + 0); if (d > s.walkR - 1.6) P.stoneTile(b, px, top, pz, r); }

    // 外圍帶狀區：房子、樹、道具
    const angDiff = (a, b) => Math.abs(((a - b + Math.PI) % TAU + TAU) % TAU - Math.PI);
    const nearBridge = a => bridgeAngles.some(ba => angDiff(a, ba) < .42) || s.excludeA.some(ea => angDiff(a, ea) < .22);
    s.obstacles.push(...s.reserve);
    const band = d => d > s.walkR + 1.1;
    const dockA = s.dockA;
    const houseAngles = s.houseAngles;
    s.homes = [];
    const placeHouse = (a, i) => {
      const d = s.walkR + 2.2 + (s.id === 'center' ? 1.2 : 0);
      const [hx, hz] = at(a, d);
      const rad = P.house(b, hx, top, hz, Math.PI * 1.5 - a, r, { w: 1.7 + r() * .5, d: 1.5 + r() * .3, h: 1.35 + r() * .4, roof: P.PAL.roofs[(i + s.seed) % P.PAL.roofs.length] });
      s.obstacles.push([hx, hz, rad]);
      (s.housePos ||= []).push([hx, hz]);
      // 房子旁的圍籬花圃
      const [fx, fz] = at(a + .32, d + .2);
      P.fenceLine(b, fx - .6, fz - .3, fx + .6, fz + .3, top);
      P.flowers(b, fx, top, fz + .45, r, 8, .5);
      s.homes.push(this.nearestRing(s, hx, hz));
      // 房子底下的暗色（假陰影）
      b.add('ground', blobPatch(1.6, s.seed + i), '#5f8f3f', mat(hx, top + .02, hz));
    };
    houseAngles.forEach(placeHouse);
    // 碼頭與小船
    const [dx, dz] = at(dockA, rf(dockA) * .9);
    const [ex, ez] = P.dock(b, dx, top - 1.55, dz, dockA, 3.2);
    s.boatSpot = new THREE.Vector3(ex, 0, ez);
    // 樹（至少兩種樹形）
    const kinds = s.trees || ['round', 'palm', 'pine', 'round', 'palm'];
    let placed = 0;
    for (let i = 0; i < 70 && placed < (s.treeCount || 9); i++) {
      const a = r() * TAU, d = s.walkR + 1.3 + r() * (rf(a) * .8 - s.walkR - 1.3);
      if (!band(d) || nearBridge(a) || angDiff(a, dockA) < .3) continue;
      const [tx, tz] = at(a, d);
      if (s.obstacles.some(([ox, oz, or]) => Math.hypot(tx - ox, tz - oz) < or + .8)) continue;
      const rad = P.tree(b, tx, top, tz, r, kinds[placed % kinds.length], .9 + r() * .35);
      b.add('ground', blobPatch(.9, s.seed + 50 + i), '#6a9a48', mat(tx, top + .018, tz));
      s.obstacles.push([tx, tz, rad]);
      placed++;
    }
    // 花草、灌木、岩石、草叢
    for (let i = 0; i < 40; i++) {
      const a = r() * TAU, d = s.walkR + .9 + r() * (rf(a) * .84 - s.walkR - .9);
      if (nearBridge(a)) continue;
      const [px, pz] = at(a, d);
      if (s.obstacles.some(([ox, oz, or]) => Math.hypot(px - ox, pz - oz) < or + .2)) continue;
      const k = i % 4;
      if (k === 0) P.flowers(b, px, top, pz, r, 5, .45);
      else if (k === 1) P.bush(b, px, top, pz, r, .8);
      else if (k === 2) P.grassTuft(b, px, top, pz, r);
      else P.rock(b, px, top, pz, r, .7);
    }
    // 島緣草叢與小石頭
    for (let i = 0; i < 26; i++) {
      const a = i / 26 * TAU + r() * .1;
      if (nearBridge(a)) continue;
      const [px, pz] = at(a, rf(a) * .84);
      i % 3 ? P.grassTuft(b, px, top, pz, r) : P.rock(b, px, top, pz, r, .55);
    }
    // 小道具：長椅、木箱、告示牌、水井
    const propA = s.toCenter + (s.id === 'center' ? .5 : .55);
    const [bx, bz] = at(propA, s.walkR + 1.2);
    P.bench(b, bx, top, bz, Math.PI / 2 - propA);
    const [cx, cz] = at(s.crateA, rf(s.crateA) * .78);
    P.crate(b, cx, top, cz, r() * 3); P.crate(b, cx + .5, top, cz + .2, r() * 3, .8); P.crate(b, cx + .2, top + .44, cz + .1, r() * 3, .7);
    s.obstacles.push([bx, bz, .6], [cx, cz, .8]);
    if (s.id !== 'center') {
      const [sx, sz] = at(s.toCenter + .28, s.walkR + 1.2);
      P.sign(b, sx, top, sz, Math.PI / 2 - s.toCenter);
      s.obstacles.push([sx, sz, .4]);
      const [wx, wz] = at(s.toCenter - .9, s.walkR + 1.4);
      P.well(b, wx, top, wz);
      s.obstacles.push([wx, wz, .7]);
    }
    // 路燈（每座島 2 盞，中央島另外加）
    const lampAs = s.id === 'center' ? [] : [s.toCenter + .45, s.toCenter - .45];
    for (const la of lampAs) {
      const [lx, lz] = at(la, s.walkR + .75);
      this.addLamp(b, lx, top, lz);
      s.obstacles.push([lx, lz, .3]);
    }
  }
  addLamp(b, x, y, z) {
    const p = P.lampPost(b, x, y, z);
    const g = P.glowSprite(0xffcf7a, 2.4); g.position.copy(p);
    this.scene.add(g); this.glows.push(g);
    return p;
  }
  nearestRing(s, x, z) {
    let best = 0, bd = 1e9;
    s.ring.forEach((p, i) => { const d = Math.hypot(p.x - x, p.z - z); if (d < bd) { bd = d; best = i; } });
    return best;
  }

  buildBridges(b) {
    const c = this.islandById.center;
    this.bridges = [];
    for (const s of this.islands) {
      if (s.id === 'center') continue;
      const a = s.toCenter, ac = Math.atan2(s.z, s.x);
      const p0 = new THREE.Vector3(s.x + Math.cos(a) * s.rf(a) * .84, s.top, s.z + Math.sin(a) * s.rf(a) * .84);
      const p1 = new THREE.Vector3(Math.cos(ac) * c.rf(ac) * .84, c.top, Math.sin(ac) * c.rf(ac) * .84);
      const info = P.bridge(b, p0.x, p0.z, p1.x, p1.z, p0.y + .05, p1.y + .05);
      const pts = [];
      for (let i = 0; i <= 14; i++) { const t = i / 14; pts.push(new THREE.Vector3(lerp(p0.x, p1.x, t), lerp(p0.y, p1.y, t) + Math.sin(t * Math.PI) * .7 + .11, lerp(p0.z, p1.z, t))); }
      const br = { island: s.id, p0, p1, pts, nx: info.nx, nz: info.nz };
      this.bridges.push(br);
      s.bridge = br;
      // 橋上的彩旗串
      for (const side of [-1, 1]) {
        const q0 = new THREE.Vector3(p0.x + info.nx * .85 * side, p0.y + 1.35, p0.z + info.nz * .85 * side);
        const q1 = new THREE.Vector3(p1.x + info.nx * .85 * side, p1.y + 1.35, p1.z + info.nz * .85 * side);
        const mid = q0.clone().lerp(q1, .5); mid.y += .7;
        this.addAnim(P.bunting(q0, mid, .25, this.mat.anim));
        this.addAnim(P.bunting(mid, q1, .25, this.mat.anim));
      }
    }
  }
  addAnim(a, lowHide = false) { this.scene.add(a.object); this.animated.push(a); if (lowHide) this.extraLow.push(a.object); return a; }

  // ======================================================
  // 地標
  buildLandmarks(b) {
    const r = rng(999);
    const C = this.islandById.center;
    // ---- 中央島：噴泉廣場、雙詩碑、市集、路燈、房子 ----
    for (let k = 0; k < 40; k++) { const a = k / 40 * TAU; const d = 3.6 + (k % 2) * .9; P.stoneTile(b, Math.cos(a) * d, C.top, Math.sin(a) * d, r); }
    b.add('ground', new THREE.CylinderGeometry(6.2, 6.2, .05, 24), '#e3dacd', mat(0, C.top + .01, 0));
    this.addAnim(P.fountain(b, 0, C.top, 0));
    C.obstacles.push([0, 0, 3]);
    const poems = this.content.islands.filter(i => i.sections && i.sections[0] && i.sections[0].type === 'poem').slice(0, 2);
    [[-1.7, '鹿柴', poems[0]], [1.7, '鳥鳴澗', poems[1]]].forEach(([sx, title, isl]) => {
      const lines = isl ? isl.sections[0].lines.map(l => l.replace(/[，。]/g, '')) : [];
      const st = P.stele(lines, title, 1.7, 2.9);
      st.position.set(sx, C.top, 4.6); st.rotation.y = sx < 0 ? .12 : -.12;
      this.scene.add(st);
      C.obstacles.push([sx, 4.6, 1.1]);
      (this.steles ||= {})[sx < 0 ? 'steleLeft' : 'steleRight'] = st;
      this.addAnchor('center', sx < 0 ? 'steleLeft' : 'steleRight', new THREE.Vector3(sx, C.top + 4.3, 4.6), 1.3, new THREE.Vector3(sx, C.top + 1.8, 4.6));
    });
    // 中央噴泉的燈
    const pl = new THREE.PointLight(0xffc56b, 0, 16, 1.6); pl.position.set(0, C.top + 3, 0); this.scene.add(pl); this.pointLights.push([pl, 30]);
    // 廣場路燈（在環狀路內側）
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4 + .38; this.addLamp(b, Math.cos(a) * 6.6, C.top, Math.sin(a) * 6.6); C.obstacles.push([Math.cos(a) * 6.6, Math.sin(a) * 6.6, .3]); }
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4 - .38; this.addLamp(b, Math.cos(a) * 6.6, C.top, Math.sin(a) * 6.6); }
    // 市集攤位（避開四座橋）
    this.marketSpots = [];
    [[0, '#c45a2c'], [Math.PI, '#2f8f83'], [Math.PI * 1.5 - .3, '#b8862f']].forEach(([a, color], i) => {
      const d = 10;
      const sx = Math.cos(a) * d, sz = Math.sin(a) * d;
      const bulbs = P.stall(b, sx, C.top, sz, Math.PI * 1.5 - a, color, r);
      C.obstacles.push([sx, sz, 1.2]);
      bulbs.forEach((p, j) => { if (j % 2 === 0) { const g = P.glowSprite(0xffd27a, 1.1); g.position.copy(p); this.scene.add(g); this.glows.push(g); } });
      this.marketSpots.push({ a, front: new THREE.Vector3(Math.cos(a) * (d - 1.3), C.top, Math.sin(a) * (d - 1.3)) });
    });
    const pl2 = new THREE.PointLight(0xffb85c, 0, 14, 1.6); pl2.position.set(10, C.top + 2.4, 0); this.scene.add(pl2); this.pointLights.push([pl2, 18]);
    // 廣場上的彩旗串
    for (let k = 0; k < 4; k++) {
      const a0 = k * Math.PI / 2 + Math.PI / 4 + .38, a1 = (k + 1) * Math.PI / 2 + Math.PI / 4 - .38;
      this.addAnim(P.bunting(new THREE.Vector3(Math.cos(a0) * 6.6, C.top + 2.05, Math.sin(a0) * 6.6), new THREE.Vector3(Math.cos(a1) * 6.6, C.top + 2.05, Math.sin(a1) * 6.6), .5, this.mat.anim));
    }

    const S = id => this.islandById[id];
    const ids = this.content.islands.map(i => i.id);
    const inner = (s, a, d) => [s.x + Math.cos(a) * d, s.z + Math.sin(a) * d];

    // ---- 島 1：鹿柴（黃昏的空山深林、鹿寨、夕照青苔、詩碑） ----
    if (ids[0]) {
      const s = S(ids[0]); const c = s.toCenter, out = c + Math.PI;
      // 空山：島中央長滿樹的山丘
      const [hx, hz] = inner(s, out, 1.0);
      const hR = 3.5, hH = 4.6;
      const hh = this.mound(b, hx, s.top, hz, hR, hH, 77, ['#5f8f3f', '#557f3a', '#4b7536', '#43692f', '#6d7457']);
      s.obstacles.push([hx, hz, hR + .25]);
      for (let k = 0; k < 30; k++) {
        const a = r() * TAU, d = Math.sqrt(r()) * hR * .82, tx = hx + Math.cos(a) * d, tz = hz + Math.sin(a) * d;
        P.tree(b, tx, hh(tx, tz) - .08, tz, r, k % 4 ? 'pine' : 'round', .85 + r() * .45);
      }
      this.addAnchor(s.id, 'forest', new THREE.Vector3(hx, s.top + hH + 2.6, hz), 3.4, new THREE.Vector3(hx, s.top + 2.5, hz));
      // 鹿寨（木柵圈起來的鹿舍）
      const [px, pz] = s.deerPos, R = 1.5, gate = Math.atan2(s.z - pz, s.x - px);
      for (let k = 0; k < 22; k++) {
        const a = k / 22 * TAU;
        if (Math.abs(((a - gate + Math.PI) % TAU + TAU) % TAU - Math.PI) < .38) continue;
        const h = 1 + (k % 3) * .12;
        b.add('solid', P.G.cyl6, k % 2 ? P.PAL.wood : P.PAL.woodDark, mat(px + Math.cos(a) * R, s.top + h / 2, pz + Math.sin(a) * R, 0, 0, 0, .12, h, .12));
        b.add('solid', P.G.cone6, P.PAL.woodDark, mat(px + Math.cos(a) * R, s.top + h + .1, pz + Math.sin(a) * R, 0, 0, 0, .12, .2, .12));
      }
      for (const yy of [.38, .8]) for (let k = 0; k < 18; k++) {
        const a0 = k / 18 * TAU, a1 = (k + 1) / 18 * TAU;
        if ([a0, a1].some(a => Math.abs(((a - gate + Math.PI) % TAU + TAU) % TAU - Math.PI) < .38)) continue;
        b.add('solid', P.G.box, P.PAL.woodLight, mat(px + Math.cos((a0 + a1) / 2) * R, s.top + yy, pz + Math.sin((a0 + a1) / 2) * R, 0, -(a0 + a1) / 2 + Math.PI / 2, 0, R * TAU / 18 + .05, .07, .06));
      }
      const gx = px + Math.cos(gate) * R, gz = pz + Math.sin(gate) * R, nx = -Math.sin(gate), nz = Math.cos(gate);
      for (const sd of [-1, 1]) b.add('solid', P.G.box, P.PAL.woodDark, mat(gx + nx * .7 * sd, s.top + .9, gz + nz * .7 * sd, 0, 0, 0, .18, 1.8, .18));
      b.add('solid', P.G.box, P.PAL.wood, mat(gx, s.top + 1.85, gz, 0, -gate + Math.PI / 2, 0, 1.8, .2, .26));
      this.addAnim(P.flag(gx + nx * .7, s.top + 1.8, gz + nz * .7, 0xc45a2c, 1.2, this.mat.anim));
      this.deer = [];
      for (let k = 0; k < 2; k++) {
        const d = this.makeDeer(k);
        const a = gate + Math.PI + (k ? .9 : -.7);
        d.object.position.set(px + Math.cos(a) * .6, s.top, pz + Math.sin(a) * .6);
        d.object.rotation.y = r() * TAU; d.baseY = s.top;
        this.addAnim(d); this.deer.push(d);
      }
      this.addAnchor(s.id, 'deer', new THREE.Vector3(px, s.top + 2.4, pz), 1.9, new THREE.Vector3(px, s.top + .8, pz));
      // 青苔石與夕照光束
      const [mx, mz] = s.mossPos;
      b.add('solid', P.G.dodec, '#8a8a7a', mat(mx, s.top + .25, mz, .2, .3, 0, .62, .42, .56));
      this.mossMat = new THREE.MeshStandardMaterial({ color: 0x6fbf5a, flatShading: true, emissive: 0x9be06a, emissiveIntensity: 0 });
      const moss = new THREE.Mesh(P.G.ico0, this.mossMat); moss.scale.set(.52, .2, .46); moss.position.set(mx, s.top + .54, mz); moss.castShadow = true;
      this.scene.add(moss);
      this.beam = this.addAnim(P.lightBeam(mx + 3.2, s.top + 8, mz - 2.4, new THREE.Vector3(mx, s.top + .5, mz)));
      this.addAnchor(s.id, 'moss', new THREE.Vector3(mx, s.top + 2, mz), 1.2, new THREE.Vector3(mx, s.top + .5, mz));
      // 山路旁的詩碑
      const [tx, tz] = inner(s, c - .55, s.walkR - 1.25);
      const lines = (this.content.islands[0].sections[0].lines || []).map(l => l.replace(/[，。]/g, ''));
      this.tablet = P.stele(lines, '鹿柴', 1.3, 2.1);
      this.tablet.scale.setScalar(.75); this.tablet.position.set(tx, s.top, tz); this.tablet.rotation.y = Math.atan2(s.x + Math.cos(c) * 20 - tx, s.z + Math.sin(c) * 20 - tz);
      this.scene.add(this.tablet);
      s.obstacles.push([tx, tz, .8]);
      this.addAnchor(s.id, 'tablet', new THREE.Vector3(tx, s.top + 2.6, tz), 1, new THREE.Vector3(tx, s.top + 1.2, tz));
      // 深林：外圍也是一片松林
      for (let k = 0; k < 14; k++) {
        const a = out + (k - 7) * .14, d = s.walkR + 1.3 + (k % 3) * .6;
        const [qx, qz] = inner(s, a, d);
        if (s.obstacles.some(([ox, oz, or]) => Math.hypot(qx - ox, qz - oz) < or + .45)) continue;
        P.tree(b, qx, s.top, qz, r, k % 3 ? 'pine' : 'round', 1.1 + r() * .3); s.obstacles.push([qx, qz, .65]);
      }
    }
    // ---- 島 2：鳥鳴澗（春夜：兩山中間的溪澗、桂花、賞月石、山後月出、春花） ----
    if (ids[1]) {
      const s = S(ids[1]); const c = s.toCenter, out = s.streamAngle;
      const spring = inner(s, out, .4);
      b.add('ground', new THREE.CylinderGeometry(1.3, 1.3, .06, 14), '#4fb3c9', mat(spring[0], s.top + .02, spring[1]));
      const edge = s.rf(out) * .88;
      for (let d = .8; d < edge; d += .35) {
        const [qx, qz] = inner(s, out + Math.sin(d * 1.3) * .05, d);
        b.add('ground', P.G.box, d % .7 < .35 ? '#58bfd3' : '#4aaec4', mat(qx, s.top + .03, qz, 0, -out + Math.PI / 2, 0, .4, .04, 1.1));
        b.add('solid', P.G.dodec, P.PAL.rock[1], mat(qx - Math.sin(out) * .7, s.top + .05, qz + Math.cos(out) * .7, 0, d, 0, .18, .12, .16));
      }
      const [kx, kz] = inner(s, out, s.walkR);
      for (let i = 0; i < 7; i++) { const t = i / 6; b.add('solid', P.G.box, P.PAL.woodLight, mat(kx + Math.cos(out) * (t - .5) * 1.4, s.top + .1 + Math.sin(t * Math.PI) * .35, kz + Math.sin(out) * (t - .5) * 1.4, 0, -out, 0, .26, .08, 1.3)); }
      this.streamPos = new THREE.Vector3(kx, s.top + .1, kz);
      this.addAnchor(s.id, 'stream', new THREE.Vector3(kx, s.top + 1.8, kz), 1.2, new THREE.Vector3(kx, s.top + .2, kz));
      const [fx, fz] = inner(s, out, s.rf(out) * .92);
      this.addAnim(P.waterfall(fx + Math.cos(out) * .2, s.top, .15, fz + Math.sin(out) * .2, -out + Math.PI / 2, 1.1));
      // 溪澗兩邊的山（澗＝兩山中間的流水）
      for (const sd of [-1, 1]) {
        const [rx, rz] = s.ridges[sd < 0 ? 0 : 1];
        const a = out + sd * .62;
        const hh = this.mound(b, rx, s.top, rz, 1, 3.9, 90 + sd, ['#5c8a3e', '#527d39', '#4a7234', '#41662f', '#62705a'], 1.55, 2.3, a);
        for (let k = 0; k < 10; k++) {
          const u = (r() - .5) * 2 * .8, v = (r() - .5) * 2 * .8;
          if (u * u + v * v > .64) continue;
          const tx = rx + Math.cos(a) * u * 1.55 - Math.sin(a) * v * 2.3, tz = rz + Math.sin(a) * u * 1.55 + Math.cos(a) * v * 2.3;
          P.tree(b, tx, hh(tx, tz) - .08, tz, r, k % 3 ? 'pine' : 'osmanthus', .8 + r() * .3);
        }
      }
      // 水車
      const wa = out + .45, [wx, wz] = inner(s, wa, 2.3);
      this.addAnim(P.waterwheel(b, wx, s.top, wz, -out, this.mat.anim));
      s.obstacles.push([wx, wz, 1.3]);
      // 桂花樹＋落花＋樹上睡覺的山鳥
      const oa = out - 1.5, [ox, oz] = inner(s, oa, 2.4);
      P.tree(b, ox, s.top, oz, r, 'osmanthus', 1.45);
      s.obstacles.push([ox, oz, 1.1]);
      this.addAnim(this.makePetals(ox, s.top + 2.4, oz));
      this.osmanthusPos = new THREE.Vector3(ox, s.top + 2.4, oz);
      this.addAnchor(s.id, 'osmanthus', new THREE.Vector3(ox, s.top + 4.6, oz), 1.6, new THREE.Vector3(ox, s.top + 2, oz));
      this.perched = this.makePerchedBirds(new THREE.Vector3(ox, s.top + 3.1, oz));
      // 賞月石與月光燈
      const la = out - .6, [lx, lz] = inner(s, la, 3.2);
      b.add('solid', P.G.dodec, '#b9b1a2', mat(lx + .5, s.top + .2, lz, 0, .4, 0, .55, .3, .45));
      b.add('solid', P.G.cyl6, '#4a3f37', mat(lx, s.top + 1.2, lz, 0, 0, 0, .07, 2.4, .07));
      b.add('window', P.G.sphere, '#ffffff', mat(lx, s.top + 2.55, lz, 0, 0, 0, .35));
      const g = P.glowSprite(0xdfe8ff, 3.4); g.position.set(lx, s.top + 2.55, lz); this.scene.add(g); this.glows.push(g);
      const pl3 = new THREE.PointLight(0xcfe0ff, 0, 12, 1.6); pl3.position.set(lx, s.top + 2.6, lz); this.scene.add(pl3); this.pointLights.push([pl3, 14]);
      s.obstacles.push([lx, lz, .7], [spring[0], spring[1], 1.4]);
      // 山後的月亮（點了會升起來）
      const mp = new THREE.Vector3(s.x + Math.cos(out) * 24, 0, s.z + Math.sin(out) * 24);
      this.addAnchor(s.id, 'moon', new THREE.Vector3(lx, s.top + 3.6, lz), 1.1, new THREE.Vector3(lx, s.top + 1, lz), new THREE.Vector3(mp.x, s.top + 9, mp.z));
      const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.moonTexture(), transparent: true, depthWrite: false, fog: false }));
      moon.scale.setScalar(7);
      this.moon = { sprite: moon, low: s.top - 3.5, high: s.top + 12, base: mp, k: 0, target: 0 };
      moon.position.set(mp.x, this.moon.low, mp.z);
      this.scene.add(moon);
      // 春天的花樹
      const [sx2, sz2] = inner(s, c + .95, 3.0);
      P.tree(b, sx2, s.top, sz2, r, 'blossom', 1.2);
      P.flowers(b, sx2 + .8, s.top, sz2 + .4, r, 16, .9, ['#f29ac0', '#ffffff', '#f7c6d9', '#e8455e']);
      s.obstacles.push([sx2, sz2, 1]);
      this.springPos = new THREE.Vector3(sx2, s.top + 2.4, sz2);
      this.addAnchor(s.id, 'spring', new THREE.Vector3(sx2, s.top + 3.8, sz2), 1.3, new THREE.Vector3(sx2, s.top + 1.2, sz2));
    }
    // ---- 島 3：延伸學習（字詞練功房、積木字塊塔、風車） ----
    if (ids[2]) {
      const s = S(ids[2]); const out = s.toCenter + Math.PI;
      const [hx, hz] = inner(s, out, 1.3);
      P.house(b, hx, s.top, hz, Math.PI / 2 - s.toCenter, r, { w: 2.8, d: 2.2, h: 1.9, wall: '#fff3e0', roof: '#2f8f83' });
      s.obstacles.push([hx, hz, 2.1]);
      // 招牌
      const plaque = P.charBlock('練', '#c45a2c', .7);
      const [px, pz] = inner(s, out, 1.3 - 1.25);
      plaque.position.set(px, s.top + 2.55, pz); plaque.rotation.y = Math.PI / 2 - s.toCenter;
      this.scene.add(plaque);
      // 積木字塊塔
      const chars = [['寨', '#c45a2c'], ['漆', '#2f8f83'], ['乍', '#e0a43a'], ['澗', '#7a9cd6'], ['描', '#8e4f6e'], ['添', '#5f9e4f'], ['詩', '#c45a2c']];
      const ta = s.toCenter + 1.25, [tx, tz] = inner(s, ta, 2.6);
      const layout = [[-.5, 0, 0], [.5, 0, 0], [0, 0, .9], [0, 1, .3], [-.5, 1, -.2], [.5, 1, -.2], [0, 2, 0]];
      layout.forEach(([lx, ly, lz], i) => {
        const bl = P.charBlock(chars[i][0], chars[i][1], .9);
        bl.position.set(tx + lx, s.top + .45 + ly * .98, tz + lz); bl.rotation.y = Math.PI / 2 - s.toCenter + (i % 2 ? .1 : -.08);
        bl.userData.charBlock = true; bl.userData.baseY = bl.position.y; bl.userData.i = i;
        this.scene.add(bl);
      });
      s.obstacles.push([tx, tz + .3, 1.3]);
      // 風車（外圍）
      const wa = s.toCenter + 2.05, [wx, wz] = s.windmillPos;
      this.windmill = this.addAnim(P.windmill(b, wx, s.top, wz, Math.PI * 1.5 - wa, this.mat.anim));
      // 花圃
      const fa = s.toCenter - 1.3, [fx, fz] = inner(s, fa, 2.4);
      P.flowers(b, fx, s.top, fz, r, 24, 1.1);
      P.fenceLine(b, fx - 1.2, fz - 1.1, fx + 1.2, fz - 1.1, s.top); P.fenceLine(b, fx - 1.2, fz + 1.1, fx + 1.2, fz + 1.1, s.top);
      s.obstacles.push([fx, fz, 1.3]);
      // 可以打開的門
      const c = s.toCenter, [dx, dz] = inner(s, out, 1.3 - 1.13);
      const hinge = new THREE.Group(); hinge.position.set(dx - Math.cos(c + Math.PI / 2) * .23, s.top + .16, dz - Math.sin(c + Math.PI / 2) * .23); hinge.rotation.y = Math.PI / 2 - c;
      const door = new THREE.Mesh(P.G.box, M('#7a5230')); door.scale.set(.46, 1.08, .06); door.position.set(.23, .55, 0); door.castShadow = true;
      const knob = new THREE.Mesh(P.G.sphere, M('#e0a43a')); knob.scale.setScalar(.04); knob.position.set(.4, .55, .05);
      hinge.add(door, knob); this.scene.add(hinge);
      this.door = { hinge, open: 0, target: 0 };
      this.blocks = this.scene.children.filter(o => o.userData.charBlock);
      this.addAnchor(s.id, 'blocks', new THREE.Vector3(tx, s.top + 3.6, tz), 1.5, new THREE.Vector3(tx, s.top + 1, tz));
      this.addAnchor(s.id, 'windmill', new THREE.Vector3(wx, s.top + 4.6, wz), 1.6, new THREE.Vector3(wx, s.top + 2, wz));
      this.addAnchor(s.id, 'door', new THREE.Vector3(dx, s.top + 2.2, dz), .9, new THREE.Vector3(dx, s.top + .8, dz));
      this.addAnchor(s.id, 'flowerbed', new THREE.Vector3(fx, s.top + 1.3, fz), 1.3, new THREE.Vector3(fx, s.top + .3, fz));
      this.flowerbedPos = new THREE.Vector3(fx, s.top + .5, fz);
    }
    // ---- 島 4：王維（詩畫亭、畫架、竹林、花田） ----
    if (ids[3]) {
      const s = S(ids[3]); const out = s.toCenter + Math.PI;
      const [cx, cz] = inner(s, out, 1.1);
      const pr = 1.5;
      b.add('solid', new THREE.CylinderGeometry(2.2, 2.4, .35, 8), '#d9cfc0', mat(cx, s.top + .17, cz, 0, Math.PI / 8));
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; b.add('solid', P.G.cyl6, '#a8452a', mat(cx + Math.cos(a) * pr, s.top + 1.4, cz + Math.sin(a) * pr, 0, 0, 0, .12, 2.2, .12)); }
      b.add('solid', new THREE.ConeGeometry(2.7, 1.1, 6), '#2f6b5f', mat(cx, s.top + 3.0, cz));
      b.add('solid', new THREE.ConeGeometry(1.6, .9, 6), '#2f8f83', mat(cx, s.top + 3.7, cz));
      b.add('solid', P.G.sphere, '#e0a43a', mat(cx, s.top + 4.2, cz, 0, 0, 0, .18));
      b.add('solid', new THREE.CylinderGeometry(2.75, 2.75, .12, 6), '#a8452a', mat(cx, s.top + 2.5, cz));
      for (let k = 0; k < 6; k++) { const a = k / 6 * TAU; b.add('solid', P.G.cone4, '#2f6b5f', mat(cx + Math.cos(a) * 2.75, s.top + 2.62, cz + Math.sin(a) * 2.75, 0, -a, .9, .14, .5, .14)); }
      // 桌與卷軸
      b.add('solid', P.G.cyl8, P.PAL.wood, mat(cx, s.top + .7, cz, 0, 0, 0, .6, .08, .6));
      b.add('solid', P.G.cyl6, P.PAL.woodDark, mat(cx, s.top + .5, cz, 0, 0, 0, .1, .5, .1));
      // 可以打開的卷軸
      const scroll = new THREE.Group(); scroll.position.set(cx, s.top + .8, cz); scroll.rotation.y = Math.PI / 2 - s.toCenter;
      const rollL = new THREE.Mesh(P.G.cyl8, M('#8a5a3a')); rollL.scale.set(.06, .55, .06); rollL.rotation.x = Math.PI / 2;
      const rollR = rollL.clone();
      const paper = new THREE.Mesh(new THREE.BoxGeometry(1, .02, .5), new THREE.MeshStandardMaterial({ map: P.scrollTexture(), roughness: .9 }));
      paper.scale.x = .05;
      scroll.add(rollL, rollR, paper); this.scene.add(scroll);
      this.scroll = { group: scroll, rollL, rollR, paper, k: 0, target: 0 };
      this.updateScroll(0);
      s.obstacles.push([cx, cz, 2.4]);
      this.addAnchor(s.id, 'scroll', new THREE.Vector3(cx, s.top + 4.9, cz), 2, new THREE.Vector3(cx, s.top + 1.2, cz));
      this.addAnim(P.flag(cx, s.top + 4.2, cz, 0xc45a2c, 1.2, this.mat.anim));
      // 畫架與畫
      const ea = s.toCenter + 1.2, [ex, ez] = inner(s, ea, 3.2);
      const rot = Math.PI / 2 - s.toCenter + Math.PI;
      for (const sd of [-1, 1]) b.add('solid', P.G.box, P.PAL.woodDark, mat(ex + Math.cos(rot) * .45 * sd, s.top + .9, ez - Math.sin(rot) * .45 * sd, -.15, rot, 0, .07, 1.8, .07));
      const canvas = new THREE.Mesh(new THREE.BoxGeometry(1.25, 1.05, .05), [M('#f4e6d0'), M('#f4e6d0'), M('#f4e6d0'), M('#f4e6d0'), P.painting(), M('#f4e6d0')]);
      canvas.position.set(ex, s.top + 1.35, ez); canvas.rotation.set(0, rot + Math.PI, 0); canvas.rotateX(-.15); canvas.castShadow = true;
      this.scene.add(canvas);
      // 畫布上的白紙（探索後慢慢消失，露出畫）
      const veil = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1), new THREE.MeshBasicMaterial({ color: 0xf7efe2, transparent: true, opacity: .92 }));
      veil.position.set(0, 0, .035); canvas.add(veil);
      this.veil = veil;
      s.obstacles.push([ex, ez, .8]);
      this.addAnchor(s.id, 'easel', new THREE.Vector3(ex, s.top + 2.5, ez), 1, new THREE.Vector3(ex, s.top + 1.2, ez));
      // 竹林（會隨風搖）
      const [bx, bz] = s.bambooPos;
      this.bamboo = this.addAnim(this.makeBamboo(bx, s.top, bz));
      this.addAnchor(s.id, 'bamboo', new THREE.Vector3(bx, s.top + 4.8, bz), 1.6, new THREE.Vector3(bx, s.top + 2, bz));
      const [hx4, hz4] = s.housePos[0];
      this.chimney = new THREE.Vector3(hx4, s.top + 2.8, hz4);
      this.addAnchor(s.id, 'home', new THREE.Vector3(hx4, s.top + 3.6, hz4), 1.4, new THREE.Vector3(hx4, s.top + 1.2, hz4));
      // 花田（蝴蝶在這裡飛）
      const [fx, fz] = s.fieldPos;
      b.add('ground', blobPatch(1.9, 444), '#6b8f3a', mat(fx, s.top + .03, fz));
      P.flowers(b, fx, s.top, fz, r, 60, 1.8);
      s.flowerField = new THREE.Vector3(fx, s.top, fz);
    }
    // 中央島也有花田給蝴蝶
    const cfa = Math.PI * .5 - .45;
    const cf = [Math.cos(cfa) * 10.2, Math.sin(cfa) * 10.2];
    b.add('ground', blobPatch(1.4, 445), '#6b8f3a', mat(cf[0], C.top + .03, cf[1]));
    P.flowers(b, cf[0], C.top, cf[1], r, 34, 1.2);
    C.flowerField = new THREE.Vector3(cf[0], C.top, cf[1]);
    C.obstacles.push([cf[0], cf[1], 1.4]);
    // 熱氣球
    this.balloons = [];
    [['#c45a2c', '#f3c64b', 52, 30, 0], ['#2f8f83', '#ffffff', 46, 36, 2.1], ['#8e4f6e', '#f29ac0', 60, 26, 4.2]].forEach(([c1, c2, R, y, a0]) => {
      const g = P.balloon(c1, c2, this.mat.anim);
      this.scene.add(g);
      this.balloons.push({ g, R, y, a0 });
    });
  }
  makeDeer(k) {
    const g = new THREE.Group();
    const c = k ? '#b98552' : '#a8744a';
    const part = (geo, color, x, y, z, sx, sy, sz, rx = 0) => { const m = new THREE.Mesh(geo, M(color)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.x = rx; m.castShadow = true; g.add(m); return m; };
    part(P.G.box, c, 0, .62, 0, .34, .32, .8);
    for (const [x, z] of [[-.12, .3], [.12, .3], [-.12, -.3], [.12, -.3]]) part(P.G.box, c, x, .3, z, .08, .55, .08);
    const neck = new THREE.Group(); neck.position.set(0, .75, .35); g.add(neck);
    const n = new THREE.Mesh(P.G.box, M(c)); n.scale.set(.14, .45, .14); n.position.y = .2; n.rotation.x = .35; neck.add(n);
    const head = new THREE.Mesh(P.G.box, M(c)); head.scale.set(.2, .2, .32); head.position.set(0, .45, .12); neck.add(head);
    for (const sd of [-1, 1]) { const ant = new THREE.Mesh(P.G.box, M('#e9dcc6')); ant.scale.set(.03, .3, .03); ant.position.set(sd * .08, .65, .05); ant.rotation.z = sd * .4; neck.add(ant); }
    for (let i = 0; i < 5; i++) part(P.G.sphere, '#f4e6d0', (i % 2 - .5) * .2, .79, -.25 + i * .12, .04, .02, .04);
    part(P.G.box, '#f4e6d0', 0, .7, -.42, .08, .14, .06);
    const ph = Math.random() * 6;
    return { object: g, update(t, dt, still) { neck.rotation.x = still ? 0 : .3 + Math.sin(t * .8 + ph) * .35; } };
  }
  makePetals(x, y, z) {
    const N = 30, pos = new Float32Array(N * 3), seeds = Array.from({ length: N }, () => ({ a: Math.random() * TAU, r: Math.random() * 1.4, p: Math.random() }));
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffd45c, size: .13 }));
    pts.frustumCulled = false;
    const upd = (t, dt, still) => {
      seeds.forEach((s, i) => {
        const ph = (s.p + (still ? 0 : t * .12)) % 1;
        pos[i * 3] = x + Math.cos(s.a + ph * 3) * (s.r + ph * .6); pos[i * 3 + 1] = y - ph * 2.3; pos[i * 3 + 2] = z + Math.sin(s.a + ph * 3) * (s.r + ph * .6);
      });
      geo.attributes.position.needsUpdate = true;
    };
    upd(0, 0, false);
    return { object: pts, update: upd };
  }
  makeBamboo(x, y, z) {
    const g = new THREE.Group(); g.position.set(x, y, z);
    const stems = [];
    const r = rng(55);
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Group(); s.position.set((r() - .5) * 1.8, 0, (r() - .5) * 1.8);
      const h = 3 + r() * 1.5;
      const parts = [];
      for (let k = 0; k < 5; k++) parts.push([P.G.cyl6, k % 2 ? '#7fae4f' : '#6f9e44', mat(0, h * (k + .5) / 5, 0, 0, 0, 0, .08, h / 5 - .03, .08)]);
      for (let k = 0; k < 4; k++) parts.push([P.G.cone4, '#5f9e4f', mat(Math.cos(k * 1.6) * .3, h * .7 + k * .3, Math.sin(k * 1.6) * .3, 0, k, 1.2, .14, .6, .05)]);
      s.add(mergedMesh(parts, this.mat.anim));
      g.add(s); stems.push([s, r() * 6]);
    }
    const api = { object: g, boost: 0, update(t, dt, still) { if (still) return; const k = 1 + api.boost * 5; stems.forEach(([s, ph]) => { s.rotation.z = Math.sin(t * 1.3 * (1 + api.boost) + ph) * .05 * k; s.rotation.x = Math.cos(t * 1.1 + ph) * .04 * k; }); if (api.boost > 0) api.boost = Math.max(0, api.boost - dt / 4); } };
    return api;
  }
  // ---------- 場景互動：山丘、錨點、特效 ----------
  // 低多邊形山丘（可拉長、旋轉）；回傳某點的地面高度
  mound(b, cx, cy, cz, R, H, seed, colors, sx = 1, sz = 1, rotA = 0) {
    const rr = rng(seed);
    const rf = makeRadiusFn(R, seed);
    const n = 5, prof = d => H * Math.max(0, 1 - Math.pow(d, 1.6));
    const M4 = mat(cx, cy - .05, cz, 0, -rotA, 0, sx, 1, sz);
    for (let k = 0; k < n; k++) {
      const s0 = 1 - k / n, s1 = 1 - (k + 1) / n;
      const g = ringFrustum(rf, prof(s0), s0, prof(Math.max(s1, .001)), Math.max(s1, .02), 22, k === n - 1, q => jitter(colors[Math.min(k, colors.length - 1)], .45, q), rr);
      b.add('solid', g, null, M4);
    }
    const ca = Math.cos(rotA), sa = Math.sin(rotA);
    return (x, z) => {
      const dx = x - cx, dz = z - cz;
      const lx = (dx * ca + dz * sa) / sx, lz = (-dx * sa + dz * ca) / sz;
      return cy + prof(Math.min(1, Math.hypot(lx, lz) / R));
    };
  }
  addAnchor(island, key, pos, r, focus, look) {
    (this.anchors ||= {});
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
    sphere.position.copy(focus || pos); sphere.userData.anchor = { island, key };
    this.scene.add(sphere);
    (this.anchorPick ||= []).push(sphere);
    const s = this.islandById[island];
    const ground = new THREE.Vector3((focus || pos).x, s.top, (focus || pos).z);
    this.anchors[island + ':' + key] = { island, key, pos, focus: focus || pos, ground, r, look };
  }
  anchor(island, key) { return this.anchors && this.anchors[island + ':' + key]; }
  // 冒險者走到物件旁邊的位置
  approachPoint(a) {
    const s = this.islandById[a.island];
    const i0 = this.nearestRing(s, a.ground.x, a.ground.z);
    const start = s.ring[i0];
    let best = start.clone();
    for (let k = 1; k <= 20; k++) {
      const p = start.clone().lerp(a.ground, k / 20);
      if (!this.walkable(p.x, p.z) || !this.segmentClear(start, p)) break;
      if (p.distanceTo(a.ground) < a.r + .4) { best = p; break; }
      best = p;
    }
    best.y = s.top;
    return best;
  }
  walkPlayerToAnchor(a, done) {
    const pl = this.player; if (!pl) { done && done(); return; }
    const target = this.approachPoint(a);
    const s = this.islandById[a.island];
    const finish = () => { pl.faceTo(a.ground.x, a.ground.z); this.checkPlayerIsland(); done && done(); };
    if (this.whereIs(pl.pos) !== a.island) {
      this.walkPlayerTo(a.island, () => { this.movePlayerToPoint(target) ? (pl.path.length ? pl.onDone = finish : finish()) : finish(); });
      return;
    }
    if (this.movePlayerToPoint(target) && pl.path.length) pl.onDone = finish; else finish();
    void s;
  }
  focusAnchor(a, done) {
    const s = this.islandById[a.island];
    if (a.look) { // 往某個方向看（例如看山後的月亮）
      const dir = a.look.clone().sub(a.focus); dir.y = 0; dir.normalize();
      const far0 = this.camera.aspect < .8 ? 1.4 : 1;
      const end = a.focus.clone().addScaledVector(dir, -9 * far0); end.y = a.focus.y + 2.5 * far0;
      const tgt = a.focus.clone().lerp(a.look, .55);
      const mid = this.camera.position.clone().lerp(end, .5); mid.y += 4;
      this.fly([mid, end], tgt, this.mobile ? .9 : 1.3, done);
      return;
    }
    const dir = new THREE.Vector3(a.focus.x - s.x, 0, a.focus.z - s.z);
    if (dir.lengthSq() < .5) dir.set(Math.cos(s.toCenter || Math.PI / 2), 0, Math.sin(s.toCenter || Math.PI / 2));
    dir.normalize();
    const side = new THREE.Vector3(-dir.z, 0, dir.x);
    const far = this.camera.aspect < .8 ? 1.5 : 1;
    const end = a.focus.clone().addScaledVector(dir, 5.5 * far).addScaledVector(side, 3 * far); end.y = a.focus.y + 5 * far;
    const mid = this.camera.position.clone().lerp(end, .5); mid.y += 4;
    this.fly([mid, end], a.focus.clone(), this.mobile ? .9 : 1.3, done);
  }
  moonTexture() {
    return textTexture((ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, w * .2, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,248,220,1)'); g.addColorStop(.42, 'rgba(255,240,200,1)'); g.addColorStop(.46, 'rgba(255,236,190,.45)'); g.addColorStop(1, 'rgba(255,230,180,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(220,205,170,.55)';
      [[.42, .4, .06], [.58, .55, .045], [.47, .6, .03], [.55, .38, .025]].forEach(([x, y, r]) => { ctx.beginPath(); ctx.arc(w * x, h * y, w * r, 0, 6.3); ctx.fill(); });
    }, 128, 128);
  }
  makePerchedBirds(at) {
    const birds = [];
    const mat_ = M('#5a4a6a');
    for (let i = 0; i < 6; i++) {
      const g = new THREE.Group();
      const body = new THREE.Mesh(P.G.sphere, mat_); body.scale.set(.13, .11, .2); g.add(body);
      const head = new THREE.Mesh(P.G.sphere, mat_); head.scale.setScalar(.08); head.position.set(0, .1, .13); g.add(head);
      const beak = new THREE.Mesh(P.G.cone4, M('#f3c64b')); beak.scale.set(.03, .07, .03); beak.rotation.x = Math.PI / 2; beak.position.set(0, .09, .22); g.add(beak);
      const wl = new THREE.Mesh(P.G.box, mat_); wl.scale.set(.25, .02, .12); wl.position.set(-.12, .02, 0);
      const wr = wl.clone(); wr.position.x = .12;
      g.add(wl, wr);
      const a = i / 6 * TAU, home = new THREE.Vector3(at.x + Math.cos(a) * .8, at.y + (i % 2) * .35, at.z + Math.sin(a) * .8);
      g.position.copy(home); g.rotation.y = -a;
      this.scene.add(g);
      birds.push({ g, wl, wr, home, ph: Math.random() * 6 });
    }
    return { birds, fly: 0 };
  }
  updateScroll(k) {
    const sc = this.scroll; if (!sc) return;
    const w = .12 + k * .95;
    sc.paper.scale.x = w; sc.rollL.position.x = -w / 2; sc.rollR.position.x = w / 2;
  }
  burst(pos, color = 0xffe08a, n = 40, opts = {}) {
    const geo = new THREE.BufferGeometry(), arr = new Float32Array(n * 3), vel = [];
    for (let i = 0; i < n; i++) { arr.set([pos.x, pos.y, pos.z], i * 3); const a = Math.random() * TAU, u = Math.random(); vel.push(new THREE.Vector3(Math.cos(a) * (opts.spread || 1.6) * u, (opts.up ?? 2.2) * (.4 + Math.random()), Math.sin(a) * (opts.spread || 1.6) * u)); }
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color, size: opts.size || .22, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false }));
    pts.frustumCulled = false; this.scene.add(pts);
    let life = 0; const dur = opts.dur || 2.2, g = opts.gravity ?? 2.4;
    this.fxs.push(dt => {
      life += dt;
      for (let i = 0; i < n; i++) { vel[i].y -= g * dt; vel[i].multiplyScalar(opts.drag || .985); arr[i * 3] += vel[i].x * dt; arr[i * 3 + 1] += vel[i].y * dt; arr[i * 3 + 2] += vel[i].z * dt; }
      geo.attributes.position.needsUpdate = true;
      pts.material.opacity = Math.max(0, 1 - life / dur);
      if (life > dur) { this.scene.remove(pts); geo.dispose(); return false; }
      return true;
    });
  }
  floatText(pos, text, color = '#ffffff') {
    const tex = textTexture((ctx, w, h) => { ctx.font = `700 64px ${CJK}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.shadowColor = 'rgba(0,0,0,.4)'; ctx.shadowBlur = 8; ctx.fillStyle = color; ctx.fillText(text, w / 2, h / 2); }, 256, 96);
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sp.scale.set(2.4, .9, 1); sp.position.copy(pos); this.scene.add(sp);
    let life = 0;
    this.fxs.push(dt => { life += dt; sp.position.y += dt * .7; sp.position.x += Math.sin(life * 2) * dt * .3; sp.material.opacity = Math.min(1, life * 2) * Math.max(0, 1 - life / 3.2); if (life > 3.2) { this.scene.remove(sp); return false; } return true; });
  }
  ripple(pos) {
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Mesh(new THREE.RingGeometry(.3, .38, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.x = -Math.PI / 2; m.position.copy(pos); m.position.y += .08; this.scene.add(m);
      let life = -k * .45;
      this.fxs.push(dt => { life += dt; if (life < 0) { m.visible = false; return true; } m.visible = true; const s = 1 + life * 3; m.scale.set(s, s, s); m.material.opacity = Math.max(0, .8 - life / 1.6); if (life > 1.6) { this.scene.remove(m); return false; } return true; });
    }
  }
  // 物件的變化（instant＝重新整理時直接套用已完成的狀態）
  fx(name, island, key, instant = false) {
    const a = this.anchor(island, key);
    if (!instant && a && !this.reduced) this.burst(a.focus.clone().add(new THREE.Vector3(0, .6, 0)), 0xffe08a, 34, { dur: 1.6, up: 2.6 });
    switch (name) {
      case 'murmur':
        if (!instant && a) ['……', '人語', '……'].forEach((t, i) => setTimeout(() => this.floatText(a.focus.clone().add(new THREE.Vector3((i - 1) * 1.4, 1.5 + i * .3, 0)), t, '#fff5d6'), i * 600));
        break;
      case 'beam': this.beamBoost = instant ? 0 : 5; this.mossGlow = 1; break;
      case 'deer': if (!instant) this.deerHop = 2.4; break;
      case 'tablet': case 'stele': this.glowTarget = name === 'tablet' ? this.tablet : this.steles && this.steles[key]; this.glowT = instant ? 0 : 3; break;
      case 'petals': if (!instant && this.osmanthusPos) this.burst(this.osmanthusPos, 0xffd45c, 60, { up: .6, gravity: .5, spread: 1.4, dur: 4, drag: .97, size: .16 }); break;
      case 'stream': if (!instant && this.streamPos) this.ripple(this.streamPos); break;
      case 'moon': if (this.moon) { this.moon.target = 1; if (instant) this.moon.k = 1; } if (!instant && this.perched) this.perched.fly = 7; break;
      case 'spring': if (!instant && this.springPos) this.burst(this.springPos, 0xf7a8c8, 50, { up: .8, gravity: .6, spread: 1.6, dur: 3.5, drag: .97, size: .18 }); break;
      case 'blocks': if (!instant) this.blockHop = 1.6; break;
      case 'windmill': if (this.windmill && !instant) this.windmill.boost = 1; break;
      case 'door': if (this.door) { this.door.target = 1; if (instant) this.door.open = 1; } break;
      case 'flowers': if (!instant && this.flowerbedPos) { this.burst(this.flowerbedPos, 0xff9ac0, 30, { up: 1.6, dur: 2 }); this.burst(this.flowerbedPos, 0x9be0ff, 30, { up: 1.8, dur: 2 }); } break;
      case 'painting': this.veilTarget = 0; if (instant && this.veil) this.veil.material.opacity = 0; break;
      case 'scroll': if (this.scroll) { this.scroll.target = 1; if (instant) { this.scroll.k = 1; this.updateScroll(1); } } break;
      case 'bamboo': if (this.bamboo && !instant) this.bamboo.boost = 1; break;
      case 'home': if (!instant) this.smokeT = 6; break;
      default: break;
    }
  }
  updateFx(dt, t, still) {
    this.fxs = (this.fxs || []).filter(f => f(dt));
    if (this.beam) { this.beamBoost = Math.max(0, (this.beamBoost || 0) - dt); this.beam.boost = this.beamBoost > 0 ? 3.5 : 1; }
    if (this.mossMat) this.mossMat.emissiveIntensity += (((this.mossGlow || 0) * (.25 + (this.beamBoost > 0 ? .5 : 0))) - this.mossMat.emissiveIntensity) * Math.min(1, dt * 3);
    if (this.deer && this.deerHop > 0) { this.deerHop -= dt; this.deer.forEach((d, i) => { d.object.position.y = d.baseY + Math.max(0, Math.sin((this.deerHop * 3 + i) * Math.PI)) * .45; d.object.rotation.y += dt * 1.5; }); }
    else if (this.deer) this.deer.forEach(d => { d.object.position.y = d.baseY; });
    if (this.glowT > 0 && this.glowTarget) {
      this.glowT -= dt;
      const v = this.glowT > 0 ? .5 + Math.sin(this.glowT * 6) * .3 : 0;
      this.glowTarget.traverse(o => { if (o.material && o.material.map) { o.material.emissive = o.material.emissive || new THREE.Color(); o.material.emissive.set(0xffd27a); o.material.emissiveIntensity = v; o.material.emissiveMap = o.material.map; } });
    }
    if (this.moon) {
      const m = this.moon; m.k += (m.target - m.k) * Math.min(1, dt * (still ? 99 : .9));
      m.sprite.position.y = lerp(m.low, m.high, m.k);
      m.sprite.material.opacity = clamp(.35 + this.env.night, 0, 1) * (m.k > .02 ? 1 : .8);
    }
    if (this.perched) {
      const P_ = this.perched; P_.fly = Math.max(0, P_.fly - dt);
      P_.birds.forEach((b, i) => {
        if (P_.fly > 1.2) {
          const a = t * 1.2 + i * 1.05, r = 2.2 + (i % 3) * .7;
          const target = new THREE.Vector3(b.home.x + Math.cos(a) * r, b.home.y + 2.5 + Math.sin(t * 2 + i) * .6, b.home.z + Math.sin(a) * r);
          b.g.position.lerp(target, Math.min(1, dt * 2.5));
          b.g.rotation.y = -a;
          const f = Math.sin(t * 18 + b.ph) * .9; b.wl.rotation.z = f; b.wr.rotation.z = -f;
        } else {
          b.g.position.lerp(b.home, Math.min(1, dt * 2));
          b.wl.rotation.z = 0; b.wr.rotation.z = 0;
        }
      });
    }
    if (this.blocks && this.blockHop > 0) { this.blockHop -= dt; this.blocks.forEach(bl => { const ph = this.blockHop * 6 - bl.userData.i * .6; bl.position.y = bl.userData.baseY + Math.max(0, Math.sin(ph)) * .35; }); }
    else if (this.blocks) this.blocks.forEach(bl => { bl.position.y = bl.userData.baseY; });
    if (this.door) { const d = this.door; if (d.base == null) d.base = d.hinge.rotation.y; d.open += (d.target - d.open) * Math.min(1, dt * (still ? 99 : 3)); d.hinge.rotation.y = d.base - d.open * 1.6; }
    if (this.veil) { const tgt = this.veilTarget ?? .92; this.veil.material.opacity += (tgt - this.veil.material.opacity) * Math.min(1, dt * (still ? 99 : .8)); this.veil.visible = this.veil.material.opacity > .01; }
    if (this.scroll) { const sc = this.scroll; sc.k += (sc.target - sc.k) * Math.min(1, dt * (still ? 99 : 2.2)); this.updateScroll(sc.k); }
    if (this.smokeT > 0 && this.chimney) { this.smokeT -= dt; this._smokeAcc = (this._smokeAcc || 0) + dt; if (this._smokeAcc > .35) { this._smokeAcc = 0; this.burst(this.chimney, 0xd8d0c8, 6, { up: 1.2, gravity: -.2, spread: .25, dur: 2.4, size: .5 }); } }
  }
  setFoundState(ids) {
    const all = [this.content.center, ...this.content.islands];
    for (const isl of all) for (const d of isl.discoveries || []) if (ids.includes(d.id)) this.fx(d.fx, isl.id || 'center', d.anchor, true);
  }
  resetFoundState() {
    if (this.moon) { this.moon.target = 0; this.moon.k = 0; }
    if (this.door) { this.door.target = 0; this.door.open = 0; }
    this.veilTarget = .92; if (this.veil) this.veil.material.opacity = .92;
    if (this.scroll) { this.scroll.target = 0; this.scroll.k = 0; this.updateScroll(0); }
    this.mossGlow = 0;
  }
  // 依課文情境調整光線：鹿柴＝黃昏、鳥鳴澗＝春夜
  setSceneFocus(id) {
    this.focusIsland = id;
    if (this.timeMode !== 'scene') return;
    const isl = id === 'center' ? this.content.center : this.content.islands.find(i => i.id === id);
    const mood = (isl && isl.mood) || 'day';
    this.targetHour = { day: 13, dusk: 18.1, night: 22 }[mood] ?? 13;
    if (this.reduced) this.hour = this.targetHour;
  }
  nearestAnchor(maxD = 2.8) {
    const pl = this.player; if (!pl || !this.anchors) return null;
    let best = null, bd = maxD;
    for (const a of Object.values(this.anchors)) { const d = Math.hypot(pl.pos.x - a.ground.x, pl.pos.z - a.ground.z) - a.r * .6; if (d < bd) { bd = d; best = a; } }
    return best;
  }
  buildMountains(b) {
    const r = rng(2024);
    for (let i = 0; i < 46; i++) {
      const a = i / 46 * TAU + r() * .08, d = 300 + r() * 70, h = 26 + r() * 46, w = 30 + r() * 30;
      b.add('ground', P.G.cone6, jitter(r() > .5 ? '#7d9a86' : '#6f8a7c', .4, r), mat(Math.cos(a) * d, h / 2 - 4, Math.sin(a) * d, 0, r() * 3, 0, w, h, w * .8));
      if (r() > .5) b.add('ground', P.G.ico0, jitter('#5f7f68', .4, r), mat(Math.cos(a + .03) * (d - 20), 2, Math.sin(a + .03) * (d - 20), 0, r(), 0, 16, 10, 14));
    }
  }

  // ======================================================
  // 居民、課程導師、送貨員、商人、路人、馨馨
  buildPeople() {
    const c = this.content;
    const r = rng(3030);
    const npcLooks = [
      { hat: 'douli', basket: true, shirt: '#5f7f4a', pants: '#4a3f37' },
      { hat: 'bun', lantern: true, cloak: '#2f3f6b', shirt: '#4b6b9a' },
      { hat: 'hair', glasses: true, apron: '#c45a2c', shirt: '#f4e6d0' },
      { hat: 'bun', robe: true, scroll: true, shirt: '#2f6b5f', hair: '#6b6b6b' }
    ];
    // 每島導師
    c.islands.forEach((d, i) => {
      const s = this.islandById[d.id];
      const m = makePerson(Object.assign({ rng: r }, npcLooks[i % npcLooks.length]));
      const a = new Agent(m, { type: 'npc', info: Object.assign({ island: d.id, npc: true }, d.npc) });
      const p = new THREE.Vector3(s.x + Math.cos(s.toCenter) * (s.walkR - 1.1), s.top, s.z + Math.sin(s.toCenter) * (s.walkR - 1.1));
      const off = s.toCenter + Math.PI / 2;
      p.x += Math.cos(off) * .9; p.z += Math.sin(off) * .9;
      a.setPos(p); a.faceTo(s.entry.x, s.entry.z); a.root.rotation.y = a.yaw;
      a.home = p.clone();
      this.scene.add(a.root); this.agents.push(a);
      s.npc = a;
    });
    // 馨馨（中央島嚮導）
    const C = this.islandById.center;
    const mm = makePerson({ hat: 'band', bandColor: '#b8282e', weave: true, shirt: '#f7efe4', pants: '#f7efe4', skin: '#f6d2b4', hair: '#2b1d16', scale: 1.15 });
    const mascot = new Agent(mm, { type: 'npc', info: { island: 'center', npc: true, mascot: true, name: c.mascot.name, title: '群島嚮導' } });
    mascot.setPos(new THREE.Vector3(0, C.top, 6.3)); mascot.yaw = 0; mascot.root.rotation.y = 0;
    this.scene.add(mascot.root); this.agents.push(mascot); C.npc = mascot;
    // 島民
    const byIsland = {};
    c.residents.forEach(res => { (byIsland[res.island] ||= []).push(res); });
    for (const [id, list] of Object.entries(byIsland)) {
      const s = this.islandById[id]; if (!s) continue;
      list.forEach((res, j) => {
        const a = new Agent(makePerson({ rng: r }), { type: 'resident', info: res, speed: .9 + r() * .4, brain: this.ringBrain(s) });
        a.island = s; a.ringIdx = s.ringRange ? this.ringIndexAt(s, s.ringRange[0] + (j + .5) * (s.ringRange[1] - s.ringRange[0]) / 2) : Math.floor(r() * s.ring.length);
        a.setPos(s.ring[a.ringIdx]);
        a.nightHome = j === 0 && s.homes.length ? s.homes[0] : null;
        this.scene.add(a.root); this.agents.push(a);
        if (j > 0) a.lowHide = true;
      });
    }
    // 中央路人
    c.walkers.forEach((w, j) => {
      const a = new Agent(makePerson({ rng: r }), { type: 'resident', info: w, speed: 1, brain: this.ringBrain(C) });
      a.island = C; a.ringIdx = j * 12; a.setPos(C.ring[a.ringIdx]);
      a.nightHome = j === 0 ? C.homes[0] : null;
      if (j > 0) a.lowHide = true;
      this.scene.add(a.root); this.agents.push(a);
    });
    // 市集商人
    const ms = this.marketSpots[0];
    const merchant = new Agent(makePerson({ rng: r, hat: 'straw', apron: '#2f8f83' }), { type: 'merchant', info: c.merchant });
    merchant.setPos(ms.front); merchant.faceTo(0, 0); merchant.root.rotation.y = merchant.yaw; merchant.baseYaw = merchant.yaw;
    merchant.brain = (ag) => { ag.wait = 2 + Math.random() * 2; ag.yaw = ag.baseYaw + (Math.random() - .5) * 1.4; };
    this.scene.add(merchant.root); this.agents.push(merchant);
    // 送貨員
    c.couriers.forEach((info, j) => {
      const a = new Agent(makePerson({ rng: r, hat: 'cap', hatColor: j ? '#2f8f83' : '#c45a2c' }), { type: 'courier', info, speed: 1.6 });
      a.marketIdx = j % this.marketSpots.length;
      const spot = this.marketSpots[a.marketIdx];
      a.setPos(this.ringPointAt(C, spot.a));
      a.target = j;
      a.wait = 1 + j * 3;
      a.brain = (ag) => this.courierBrain(ag);
      if (j > 0) a.lowHide = true;
      this.scene.add(a.root); this.agents.push(a);
    });
  }
  ringPointAt(s, a) { const n = s.ring.length; const i = ((Math.round(a / TAU * n) % n) + n) % n; return s.ring[i].clone(); }
  ringIndexAt(s, a) { const n = s.ring.length; return ((Math.round(a / TAU * n) % n) + n) % n; }
  ringWalk(s, from, to) {
    const n = s.ring.length, pts = [];
    let d = ((to - from) % n + n) % n; const dir = d > n / 2 ? -1 : 1; if (dir < 0) d = n - d;
    for (let k = 1; k <= d; k++) pts.push(s.ring[((from + dir * k) % n + n) % n].clone());
    return pts;
  }
  ringBrain(s) {
    return (a, env) => {
      if (env.night > .6 && a.nightHome != null) {
        if (a.ringIdx !== a.nightHome) { a.go(this.ringWalk(s, a.ringIdx, a.nightHome)); a.ringIdx = a.nightHome; }
        a.wait = 3; return;
      }
      const n = s.ring.length;
      let to = ((a.ringIdx + Math.floor((Math.random() - .5) * 9)) % n + n) % n;
      if (s.ringRange) {
        const ok = i => { const ang = i / n * TAU, mid = (s.ringRange[0] + s.ringRange[1]) / 2, half = (s.ringRange[1] - s.ringRange[0]) / 2; return Math.abs(((ang - mid + Math.PI) % TAU + TAU) % TAU - Math.PI) <= half; };
        if (!ok(a.ringIdx)) to = this.ringIndexAt(s, (s.ringRange[0] + s.ringRange[1]) / 2);
        else if (!ok(to)) to = a.ringIdx;
      }
      a.go(this.ringWalk(s, a.ringIdx, to));
      a.ringIdx = to;
      a.wait = 1 + Math.random() * 3;
      if (Math.random() < .3) a.wave(1.4);
    };
  }
  // 走到某座島：中央環狀路 → 橋 → 島的入口
  routeCenterToIsland(fromPos, id) {
    const C = this.islandById.center, s = this.islandById[id];
    const fromIdx = this.nearestRing(C, fromPos.x, fromPos.z);
    const ac = Math.atan2(s.z, s.x);
    const pts = [C.ring[fromIdx].clone(), ...this.ringWalk(C, fromIdx, this.ringIndexAt(C, ac))];
    const br = s.bridge;
    pts.push(...br.pts.slice().reverse().map(p => p.clone()));
    pts.push(s.entry.clone());
    return pts;
  }
  routeIslandToCenter(id, fromPos) {
    const s = this.islandById[id];
    const idx = this.nearestRing(s, fromPos.x, fromPos.z);
    const entryIdx = this.ringIndexAt(s, s.toCenter);
    const pts = [s.ring[idx].clone(), ...this.ringWalk(s, idx, entryIdx), s.entry.clone()];
    pts.push(...s.bridge.pts.map(p => p.clone()));
    const C = this.islandById.center, ac = Math.atan2(s.z, s.x);
    pts.push(C.ring[this.ringIndexAt(C, ac)].clone());
    return pts;
  }
  courierBrain(a) {
    const C = this.islandById.center;
    const outer = this.islands.filter(s => s.id !== 'center');
    if (!a.out) {
      const s = outer[a.target % outer.length];
      a.target++;
      a.m.carry.visible = true;
      a.go(this.routeCenterToIsland(a.pos, s.id), () => {
        a.m.carry.visible = false; a.wave(1.8);
        if (s.npc) { s.npc.wave(1.8); }
        a.out = s.id; a.wait = 2;
      });
      a.wait = 0;
    } else {
      const id = a.out; a.out = null;
      const back = this.routeIslandToCenter(id, a.pos);
      const spot = this.marketSpots[a.marketIdx];
      back.push(...this.ringWalk(C, this.nearestRing(C, back[back.length - 1].x, back[back.length - 1].z), this.ringIndexAt(C, spot.a)));
      a.go(back, () => { a.wait = 2.5; a.faceTo(spot.front.x, spot.front.z); });
    }
  }

  // ======================================================
  buildAnimals() {
    const r = rng(4040);
    const ids = this.content.islands.map(i => i.id);
    const S = i => this.islandById[ids[i]] || this.islandById.center;
    const C = this.islandById.center;
    const add = (kind, opts) => {
      const m = makeAnimal(kind);
      const a = new Agent(m, Object.assign({ type: 'animal', info: { animal: kind } }, opts));
      this.scene.add(a.root); this.animals.push(a);
      return a;
    };
    // 陸地動物：沿著環狀路走
    const land = [['cat', S(3)], ['cat', C], ['dog', S(1)], ['dog', C], ['rabbit', S(2)], ['rabbit', S(2)], ['rabbit', S(3)]];
    const seen = {};
    land.forEach(([kind, s], i) => {
      const a = add(kind, { speed: kind === 'rabbit' ? 1.3 : .9 });
      a.island = s; a.ringIdx = Math.floor(r() * s.ring.length); a.setPos(s.ring[a.ringIdx]);
      a.brain = (ag, env) => { if (env.night > .6) { ag.sleep = true; ag.wait = 2; return; } ag.sleep = false; this.ringBrain(s)(ag, { night: 0 }); };
      if (seen[kind]) a.lowHide = true; seen[kind] = true;
    });
    // 岸邊排隊：鴨子在鹿柴的沙灘，企鵝在沙洲
    const shoreLine = (kind, n, pathFn, speed) => {
      for (let k = 0; k < n; k++) {
        const a = add(kind, { speed });
        a.shore = { fn: pathFn, u: -k * .012, speed };
        if (k > 0) a.lowHide = true;
      }
    };
    const s1 = S(0);
    shoreLine('duck', 3, u => { const th = s1.toCenter + Math.PI * .4 + Math.sin(u * TAU) * .9; const R = s1.rf(th) * 1.0; return new THREE.Vector3(s1.x + Math.cos(th) * R, .42, s1.z + Math.sin(th) * R); }, .02);
    shoreLine('duck', 2, u => { const th = 1.0 + Math.sin(u * TAU) * .6; const R = C.rf(th) * 1.0; return new THREE.Vector3(Math.cos(th) * R, .42, Math.sin(th) * R); }, .025);
    shoreLine('penguin', 3, u => { const th = 2.6 + Math.sin(u * TAU) * .55; const R = this.atollR(th) - .2; return new THREE.Vector3(Math.cos(th) * R, .45, Math.sin(th) * R); }, .012);
    // 海裡：海龜在潟湖、海豚在外海
    const swim = (kind, n, R, y, speed, jump) => {
      for (let k = 0; k < n; k++) { const a = add(kind, {}); a.swim = { R: R + k * 6, y, speed: speed * (k ? -1 : 1), a: r() * TAU, jump, ph: r() * 10 }; if (k > 0) a.lowHide = true; }
    };
    swim('turtle', 2, 47, -.2, .035, false);
    swim('dolphin', 2, 72, -.5, .05, true);
    // 蝴蝶：花田上空
    const flies = [[S(3).flowerField || C.flowerField, 3], [C.flowerField, 2]];
    flies.forEach(([c0, n]) => { for (let k = 0; k < n; k++) { const a = add('butterfly', {}); a.fly = { c: c0.clone(), ph: r() * 10, R: .8 + r() * 1.2 }; a.root.scale.setScalar(1.4); if (k > 0) a.lowHide = true; } });
  }

  buildSkyLife() {
    // 雲
    this.clouds = [];
    const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, transparent: true, opacity: .95 });
    const r = rng(5050);
    const mkCloud = (scale) => {
      const g = new THREE.Group();
      const mat_ = cm.clone();
      const n = 3 + Math.floor(r() * 3);
      for (let k = 0; k < n; k++) { const m = new THREE.Mesh(P.G.ico1, mat_); const s = (2.2 + r() * 2.2) * scale; m.scale.set(s, s * .7, s); m.position.set((k - n / 2) * 2.6 * scale, r() * 1.2 * scale, (r() - .5) * 2.5 * scale); g.add(m); }
      g.userData.mat = mat_;
      return g;
    };
    for (let i = 0; i < 11; i++) {
      const g = mkCloud(1);
      const c = { g, R: 80 + r() * 60, y: 34 + r() * 14, a: r() * TAU, speed: .006 + r() * .006 };
      this.scene.add(g); this.clouds.push(c);
      if (i > 7) this.extraLow.push(g);
    }
    // 開場要穿過的雲層
    this.introClouds = [];
    for (let i = 0; i < 7; i++) {
      const g = mkCloud(2.4);
      g.position.set(-140 + i * 14 + r() * 8, 105 + r() * 18, 170 - i * 14 + r() * 10);
      g.visible = false;
      this.scene.add(g); this.introClouds.push(g);
    }
    // 鳥群
    this.flocks = [];
    const birdGeo = new THREE.BufferGeometry();
    birdGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, .9, 0, -.25, 0, 0, -.5], 3));
    birdGeo.computeVertexNormals();
    const birdMat = new THREE.MeshStandardMaterial({ color: 0x3a3a48, side: THREE.DoubleSide, flatShading: true });
    for (let f = 0; f < 3; f++) {
      const flock = new THREE.Group(); const birds = [];
      for (let k = 0; k < 6; k++) {
        const bird = new THREE.Group();
        const body = new THREE.Mesh(P.G.box, birdMat); body.scale.set(.18, .14, .6); bird.add(body);
        const wl = new THREE.Mesh(birdGeo, birdMat), wr = new THREE.Mesh(birdGeo, birdMat); wr.scale.x = -1;
        bird.add(wl, wr);
        const row = Math.ceil(k / 2), side = k % 2 ? 1 : -1;
        bird.position.set(k ? side * row * 1.4 : 0, 0, -row * 1.3);
        flock.add(bird); birds.push({ bird, wl, wr, ph: r() * 6 });
        if (k > 3) this.extraLow.push(bird);
      }
      this.scene.add(flock);
      this.flocks.push({ flock, birds, R: 44 + f * 12, y: 17 + f * 4, a: f * 2.1, speed: (.05 + f * .01) * (f % 2 ? -1 : 1) });
    }
    // 帆船
    this.boats = [];
    for (let k = 0; k < 2; k++) {
      const g = new THREE.Group();
      const parts = [
        [new THREE.CylinderGeometry(.9, .5, .7, 6), k ? '#f4e6d0' : '#a8452a', mat(0, .1, 0, 0, 0, 0, 1, 1, 2.6)],
        [P.G.box, P.PAL.woodDark, mat(0, 2.2, .2, 0, 0, 0, .1, 4, .1)]
      ];
      const sail = new THREE.BufferGeometry(); sail.setAttribute('position', new THREE.Float32BufferAttribute([0, .6, .4, 0, 4, .3, 0, .6, -1.9], 3));
      const sail2 = new THREE.BufferGeometry(); sail2.setAttribute('position', new THREE.Float32BufferAttribute([0, .6, .55, 0, 3.6, .4, 0, .6, 2.2], 3));
      parts.push([sail, k ? '#2f8f83' : '#ffffff', mat(.02, 0, 0)], [sail2, '#fbefe3', mat(.02, 0, 0)]);
      const m = mergedMesh(parts, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide }));
      g.add(m);
      this.scene.add(g);
      this.boats.push({ g, R: 84 + k * 16, a: k * Math.PI, speed: (.018 - k * .004) * (k ? -1 : 1) });
    }
    // 碼頭邊的小船
    this.rowboats = [];
    for (const s of this.islands) {
      if (!s.boatSpot) continue;
      const g = mergedMesh([[new THREE.CylinderGeometry(.55, .35, .4, 6), '#b07a46', mat(0, 0, 0, 0, 0, 0, 1, 1, 2)], [P.G.box, '#7a5230', mat(0, .12, 0, 0, 0, 0, .9, .06, .2)]], this.mat.anim);
      g.position.copy(s.boatSpot); g.position.y = .15; g.rotation.y = -s.dockA + .4;
      this.scene.add(g); this.rowboats.push(g);
    }
  }
  buildFireflies() {
    const N = 90, pos = new Float32Array(N * 3), seeds = [];
    const isl = this.islands;
    for (let i = 0; i < N; i++) { const s = isl[i % isl.length]; seeds.push({ s, a: Math.random() * TAU, d: Math.random() * s.R * .8, h: .5 + Math.random() * 2, ph: Math.random() * 10 }); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.fireflies = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xfff08a, size: .28, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.fireflies.frustumCulled = false;
    this.fireflySeeds = seeds;
    this.scene.add(this.fireflies);
  }
  buildShells() {
    this.shells = [];
    const geo = new THREE.ConeGeometry(.28, .2, 7);
    const m = new THREE.MeshStandardMaterial({ color: 0xf7c6c0, flatShading: true, emissive: 0x4a2a24, emissiveIntensity: .2 });
    for (const s of this.islands) {
      const a = (s.dockA || 0) - .7;
      const R = s.rf(a) * 1.0;
      const mesh = new THREE.Mesh(geo, m);
      mesh.position.set(s.x + Math.cos(a) * R, .55, s.z + Math.sin(a) * R);
      mesh.rotation.x = -Math.PI / 2 + .3; mesh.scale.set(1, 1, .5);
      mesh.castShadow = true;
      this.scene.add(mesh);
      this.shells.push({ island: s.id, mesh, active: true, respawn: 0 });
    }
  }

  // ======================================================
  // 畫質、時間、主題
  applyQuality() {
    const low = this.quality === 'low';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, low ? 1.25 : 2));
    this.renderer.shadowMap.enabled = !low;
    this.sun.castShadow = !low;
    const size = this.mobile ? 1024 : 2048;
    if (this.sun.shadow.mapSize.x !== size) { this.sun.shadow.mapSize.set(size, size); if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; } }
    this.scene.traverse(o => { if (o.material && o.isMesh) o.material.needsUpdate = true; });
    for (const o of this.extraLow) o.visible = !low;
    for (const a of [...this.agents, ...this.animals]) if (a.lowHide) { a.hidden = low; a.root.visible = !low; }
    this.pointLights.forEach(([pl], i) => { pl.visible = !low || i === 0; });
    if (this.sea) this.buildSea();
  }
  setQuality(q) { if (q === this.quality) return; this.quality = q; this.applyQuality(); }
  setReduced(v) { this.reduced = v; if (v && this.flight) this.finishFlight(); }
  setTheme(name) { this.theme = name; this.applyTime(true); }
  setTimeMode(mode) {
    this.timeMode = mode;
    if (MODE_HOUR[mode] != null) this.targetHour = MODE_HOUR[mode];
    if (mode === 'scene') { this.timeMode = 'scene'; this.setSceneFocus(this.focusIsland || 'center'); }
    if (mode === 'realtime') { const d = new Date(); this.targetHour = d.getHours() + d.getMinutes() / 60; }
    if (this.reduced) { this.hour = this.targetHour; this.applyTime(true); }
  }
  timeInfo() {
    const h = ((this.hour % 24) + 24) % 24;
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    const phase = phaseOf(h);
    return { hour: h, text: `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`, phase, mode: this.timeMode };
  }
  stepTime(dt) {
    if (this.timeMode === 'auto') { this.targetHour = (this.targetHour + dt * 24 / 150) % 24; this.hour = this.reduced ? MODE_HOUR[phaseOf(this.targetHour)] : this.targetHour; return; }
    if (this.timeMode === 'realtime') { const d = new Date(); this.targetHour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
    let diff = this.targetHour - this.hour;
    if (diff > 12) diff -= 24; if (diff < -12) diff += 24;
    if (Math.abs(diff) < .01 || this.reduced) this.hour = this.targetHour;
    else this.hour = (this.hour + diff * Math.min(1, dt * 2.2) + 24) % 24;
  }
  applyTime() {
    const p = palette(this.hour);
    const tint = new THREE.Color(THEME_TINT[this.theme] || '#fbefe3');
    const tintAmt = this.theme === 'dusk' ? .18 : .14;
    const hor = p.hor.clone().lerp(tint, tintAmt), fog = p.fog.clone().lerp(tint, tintAmt + .05);
    this.skyMat.uniforms.top.value.copy(p.top);
    this.skyMat.uniforms.hor.value.copy(hor);
    this.skyMat.uniforms.bot.value.copy(fog);
    this.scene.fog.color.copy(fog);
    this.renderer.setClearColor(fog);
    this.hemi.color.copy(p.hs); this.hemi.groundColor.copy(p.hg); this.hemi.intensity = p.hI;
    this.sun.color.copy(p.sun); this.sun.intensity = p.sunI;
    const h = ((this.hour % 24) + 24) % 24;
    const dayT = (h - 6) / 12;
    const night = p.night;
    let el, az;
    if (h >= 5.5 && h <= 18.8) { el = Math.max(.34, Math.sin(clamp(dayT, 0, 1) * Math.PI)) * 1.15; az = lerp(-.4, Math.PI + .4, clamp(dayT, 0, 1)); }
    else { el = .95; az = 2.2; }
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el) * .6 + .45).normalize();
    this.sun.position.copy(dir).multiplyScalar(140);
    this.sun.target.position.set(0, 0, 0);
    this.sunSprite.position.copy(dir).multiplyScalar(700);
    this.sunSprite.material.opacity = clamp(1 - night * 1.6, 0, 1);
    this.sunSprite.material.color.copy(p.sun);
    const moonDir = new THREE.Vector3(-.5, .55, -.6).normalize();
    this.moonSprite.position.copy(moonDir).multiplyScalar(650);
    this.moonSprite.material.opacity = clamp((night - .4) * 1.8, 0, 1);
    this.stars.material.opacity = clamp((night - .5) * 2, 0, 1);
    this.seaUniforms.uShallow.value.copy(p.seaS);
    this.seaUniforms.uDeep.value.copy(p.seaD);
    this.deepMat.color.copy(p.seaD).multiplyScalar(.6);
    // 夜燈
    const win = new THREE.Color('#5d6b78').lerp(new THREE.Color('#ffd27a'), clamp(night * 1.3, 0, 1));
    this.mat.window.color.copy(win);
    for (const g of this.glows) g.material.opacity = clamp((night - .25) * 1.4, 0, 1);
    this.pointLights.forEach(([pl, I]) => { pl.intensity = clamp((night - .3) * 1.5, 0, 1) * I; });
    this.fireflies.material.opacity = clamp((night - .55) * 2.2, 0, 1);
    for (const c of this.clouds) c.g.userData.mat.color.copy(new THREE.Color('#ffffff').lerp(p.hs, .25).lerp(p.hor, .15).multiplyScalar(lerp(1, .45, night)));
    for (const f of this.flocks) f.flock.visible = night < .5;
    this.amb.intensity = .12 + night * .1;
    this.renderer.toneMappingExposure = lerp(1.0, 1.25, night);
    this.env = { night, duskBeam: phaseOf(h) === 'dusk' ? 2.6 : 1, reduced: this.reduced };
  }

  // ======================================================
  // 鏡頭
  homeView() {
    const a = this.camera.aspect || 1.6;
    const k = a < .8 ? 1.75 : a < 1.2 ? 1.3 : 1;
    return { pos: new THREE.Vector3(0, 70 * k, 101 * k), target: new THREE.Vector3(0, 0, 3) };
  }
  setCamera(v) { this.camera.position.copy(v.pos); this.controls.target.copy(v.target); this.camera.lookAt(v.target); this.controls.update(); }
  fly(points, targetEnd, dur, done) {
    if (this.reduced || dur <= 0) { this.flight = null; this.controls.enabled = true; this.camera.position.copy(points[points.length - 1]); this.controls.target.copy(targetEnd); this.controls.update(); done && done(); return; }
    const curve = new THREE.CatmullRomCurve3([this.camera.position.clone(), ...points], false, 'centripetal');
    this.flight = { curve, t0: this.controls.target.clone(), t1: targetEnd.clone(), dur, el: 0, done };
    this.controls.enabled = false;
  }
  finishFlight() {
    const f = this.flight; if (!f) return;
    this.camera.position.copy(f.curve.getPoint(1)); this.controls.target.copy(f.t1);
    this.flight = null; this.controls.enabled = true; this.controls.update();
    f.done && f.done();
  }
  flyHome(done) {
    const v = this.homeView();
    const mid = this.camera.position.clone().lerp(v.pos, .5); mid.y += 10;
    this.fly([mid, v.pos], v.target, this.mobile ? .9 : 1.3, done);
  }
  flyToIsland(id, done) {
    const s = this.islandById[id]; if (!s) return;
    const front = id === 'center' ? Math.PI / 2 : s.toCenter;
    const dist = this.camera.aspect < .8 ? 30 : 22, h = this.camera.aspect < .8 ? 22 : 15;
    const end = new THREE.Vector3(s.x + Math.cos(front) * dist, s.top + h, s.z + Math.sin(front) * dist);
    const target = new THREE.Vector3(s.x, s.top + 1.5, s.z);
    // 先拉高、沿弧線繞到正面再推近
    const cur = this.camera.position.clone();
    const curA = Math.atan2(cur.z - s.z, cur.x - s.x);
    let dA = front - curA; while (dA > Math.PI) dA -= TAU; while (dA < -Math.PI) dA += TAU;
    const lift = cur.clone(); lift.y += 14;
    const midA = curA + dA * .55, midR = Math.max(34, Math.hypot(cur.x - s.x, cur.z - s.z) * .7);
    const mid = new THREE.Vector3(s.x + Math.cos(midA) * midR, s.top + h + 16, s.z + Math.sin(midA) * midR);
    this.fly([lift, mid, end], target, this.mobile ? 1.45 : 2.1, done);
  }
  playIntro(done) {
    const v = this.homeView();
    this.cinema = true;
    this.introClouds.forEach(c => { c.visible = true; });
    this.camera.position.set(-170, 150, 210);
    this.controls.target.set(0, 0, 0);
    const pts = [new THREE.Vector3(-120, 115, 160), new THREE.Vector3(-70, 80, 85), new THREE.Vector3(-95, 52, -30), new THREE.Vector3(-20, 38, -85), new THREE.Vector3(70, 30, -60), new THREE.Vector3(48, 20, 30), new THREE.Vector3(10, 28, 52), v.pos];
    const dur = this.mobile ? 3.9 : 5.6;
    this.fly(pts, v.target, dur, () => { this.endIntro(); done && done(); });
    if (this.flight) { this.flight.t0 = new THREE.Vector3(0, 0, 0); this.flight.intro = true; }
  }
  endIntro() { this.cinema = false; this.introClouds.forEach(c => { c.visible = false; }); }
  skipIntro() { if (this.flight && this.flight.intro) this.finishFlight(); }
  setFollow(v) { this.follow = v; }
  // 面板打開時把畫面往旁邊推，島不會被面板蓋住
  setViewShift(x, y) { this.shiftTarget = [x || 0, y || 0]; }
  updateViewShift(dt) {
    const tgt = this.shiftTarget || [0, 0];
    const cur = this.shift || (this.shift = [0, 0]);
    const k = this.reduced ? 1 : Math.min(1, dt * 5);
    cur[0] += (tgt[0] - cur[0]) * k; cur[1] += (tgt[1] - cur[1]) * k;
    if (Math.abs(cur[0]) < .5 && Math.abs(cur[1]) < .5 && !tgt[0] && !tgt[1]) { if (this.camera.view) { this.camera.clearViewOffset(); } return; }
    this.camera.setViewOffset(this._w, this._h, cur[0], cur[1], this._w, this._h);
  }

  // ======================================================
  // 冒險者
  setPlayer(style, atId) {
    if (this.player) { this.scene.remove(this.player.root); this.player = null; }
    if (style == null) return;
    const looks = [
      { shirt: '#c45a2c', backpack: '#2f8f83', hat: 'cap', hatColor: '#2f8f83', pants: '#3d4f6b' },
      { shirt: '#2f8f83', robe: true, scroll: true, hat: 'bun', pants: '#2f6b5f' },
      { shirt: '#f3c64b', hat: 'beret', hatColor: '#8e4f6e', brush: true, pants: '#6f4a2e' }
    ];
    const m = makePerson(Object.assign({ skin: '#f2c9a0' }, looks[style] || looks[0]));
    const a = new Agent(m, { type: 'player', speed: 8 });
    // 腳下的光圈
    const ring = new THREE.Mesh(new THREE.RingGeometry(.45, .62, 20), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: .85, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = .04; a.root.add(ring);
    this.player = a;
    this.scene.add(a.root);
    const s = this.islandById[atId] || this.islandById.center;
    a.setPos(s.id === 'center' ? this.centerSpot() : s.entry.clone());
    a.at = s.id;
    a.faceTo(s.x, s.z);
  }
  centerSpot() { const C = this.islandById.center; return C.ring[this.ringIndexAt(C, Math.PI / 2)].clone(); }
  playerRouteTo(id) {
    const a = this.player; if (!a) return [];
    const C = this.islandById.center;
    let pts = [];
    const from = this.whereIs(a.pos);
    if (from === id) {
      if (id === 'center') pts = this.ringWalk(C, this.nearestRing(C, a.pos.x, a.pos.z), this.ringIndexAt(C, Math.PI / 2));
      else { const s = this.islandById[id]; const i0 = this.nearestRing(s, a.pos.x, a.pos.z); pts = [s.ring[i0].clone(), ...this.ringWalk(s, i0, this.ringIndexAt(s, s.toCenter)), s.entry.clone()]; }
      return pts;
    }
    let cur = a.pos.clone();
    if (from && from !== 'center') { pts = this.routeIslandToCenter(from, cur); cur = pts[pts.length - 1]; }
    else if (!from) { pts = [this.nearestWalkable(cur)]; cur = pts[0]; }
    if (id === 'center') {
      const i0 = this.nearestRing(C, cur.x, cur.z);
      pts.push(C.ring[i0].clone(), ...this.ringWalk(C, i0, this.ringIndexAt(C, Math.PI / 2)));
    } else pts.push(...this.routeCenterToIsland(cur, id));
    return pts;
  }
  walkPlayerTo(id, onArrive) {
    const a = this.player; if (!a) { onArrive && onArrive(); return; }
    const pts = this.playerRouteTo(id);
    const finish = () => { a.at = id; const s = this.islandById[id]; if (s.npc) a.faceTo(s.npc.pos.x, s.npc.pos.z); this.on.playerEnter && this.on.playerEnter(id); onArrive && onArrive(); };
    if (this.reduced || !pts.length) { if (pts.length) a.setPos(pts[pts.length - 1]); a.path = []; finish(); return; }
    a.go(pts, finish);
  }
  movePlayerToPoint(p) {
    const a = this.player; if (!a) return false;
    const toIsland = this.whereIs(p);
    if (!toIsland || !this.walkable(p.x, p.z)) return false;
    const s = this.islandById[toIsland];
    const target = new THREE.Vector3(p.x, s.top, p.z);
    let pts;
    const from = this.whereIs(a.pos);
    if (from === toIsland && this.segmentClear(a.pos, target)) pts = [target];
    else {
      pts = from === toIsland ? [] : this.playerRouteTo(toIsland);
      const last = pts.length ? pts[pts.length - 1] : a.pos;
      const i0 = this.nearestRing(s, last.x, last.z), i1 = this.nearestRing(s, target.x, target.z);
      if (this.segmentClear(last, target)) pts.push(target);
      else pts.push(s.ring[i0].clone(), ...this.ringWalk(s, i0, i1), target);
    }
    if (this.reduced) { a.setPos(pts[pts.length - 1]); this.checkPlayerIsland(); return true; }
    a.go(pts, () => this.checkPlayerIsland());
    return true;
  }
  whereIs(p) {
    for (const s of this.islands) { const d = Math.hypot(p.x - s.x, p.z - s.z); const th = Math.atan2(p.z - s.z, p.x - s.x); if (d < s.rf(th) * .88) return s.id; }
    return null;
  }
  walkable(x, z) {
    for (const s of this.islands) {
      const d = Math.hypot(x - s.x, z - s.z), th = Math.atan2(z - s.z, x - s.x);
      if (d < s.rf(th) * .8) return !s.obstacles.some(([ox, oz, or]) => Math.hypot(x - ox, z - oz) < or);
    }
    return !!this.onBridge(x, z);
  }
  onBridge(x, z) {
    for (const br of this.bridges) {
      const ax = br.p1.x - br.p0.x, az = br.p1.z - br.p0.z, L2 = ax * ax + az * az;
      const t = ((x - br.p0.x) * ax + (z - br.p0.z) * az) / L2;
      if (t < -.05 || t > 1.05) continue;
      const px = br.p0.x + ax * t, pz = br.p0.z + az * t;
      if (Math.hypot(x - px, z - pz) < .7) return { br, t: clamp(t, 0, 1) };
    }
    return null;
  }
  heightAt(x, z) {
    const ob = this.onBridge(x, z);
    if (ob) { const { br, t } = ob; return lerp(br.p0.y, br.p1.y, t) + Math.sin(t * Math.PI) * .7 + .11; }
    const id = this.whereIs({ x, z });
    return id ? this.islandById[id].top : 0;
  }
  segmentClear(a, b) {
    const n = Math.ceil(a.distanceTo(b) / .3);
    for (let i = 1; i <= n; i++) { const t = i / n; if (!this.walkable(lerp(a.x, b.x, t), lerp(a.z, b.z, t))) return false; }
    return true;
  }
  nearestWalkable(p) {
    let best = this.centerSpot(), bd = 1e9;
    for (const s of this.islands) for (const q of s.ring) { const d = q.distanceTo(p); if (d < bd) { bd = d; best = q.clone(); } }
    return best;
  }
  checkPlayerIsland() {
    const a = this.player; if (!a) return;
    const id = this.whereIs(a.pos);
    if (id && id !== a.at) { a.at = id; this.on.playerEnter && this.on.playerEnter(id); }
  }
  updatePlayerKeys(dt) {
    const a = this.player; if (!a || !this.inputEnabled || !this.keys.size) return;
    let fx = 0, fz = 0;
    if (this.keys.has('up')) fz -= 1; if (this.keys.has('down')) fz += 1;
    if (this.keys.has('left')) fx -= 1; if (this.keys.has('right')) fx += 1;
    if (!fx && !fz) return;
    a.path = [];
    const cam = this.camera;
    const fwd = new THREE.Vector3(); cam.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
    const mv = fwd.multiplyScalar(-fz).add(right.multiplyScalar(fx)).normalize().multiplyScalar(dt * 5.5);
    if (this.reduced) mv.multiplyScalar(1);
    const nx = a.pos.x + mv.x, nz = a.pos.z + mv.z;
    if (this.walkable(nx, nz)) { a.pos.x = nx; a.pos.z = nz; }
    else if (this.walkable(nx, a.pos.z)) a.pos.x = nx;
    else if (this.walkable(a.pos.x, nz)) a.pos.z = nz;
    a.pos.y = this.heightAt(a.pos.x, a.pos.z);
    a.yaw = Math.atan2(mv.x, mv.z);
    a.keyWalk = .15;
    this.checkPlayerIsland();
  }

  // ======================================================
  // 輸入：點擊判定（居民、動物、貝殼、島）
  bindInput() {
    const el = this.canvas;
    this.raycaster = new THREE.Raycaster();
    let down = null;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: performance.now(), type: e.pointerType }; if (this.cinema) this.on.skip && this.on.skip(); });
    el.addEventListener('pointerup', e => {
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      if (moved < 8 && performance.now() - down.t < 700 && !this.cinema) this.handleTap(e.clientX, e.clientY, down.type);
      down = null;
    });
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    if (window.ResizeObserver) new ResizeObserver(() => this.resize()).observe(el);
  }
  handleTap(x, y, type) {
    const touch = type === 'touch' || type === 'pen';
    const lim = touch ? 54 : 34;
    const rect = this.canvas.getBoundingClientRect();
    let best = null, bd = lim;
    for (const a of [...this.agents, ...this.animals]) {
      if (!a.root.visible) continue;
      const sp = this.project(a.pos, a.m.kind === 'person' ? .9 : .3);
      if (!sp.front) continue;
      const d = Math.hypot(sp.x + rect.left - x, sp.y + rect.top - y);
      if (d < bd) { bd = d; best = a; }
    }
    if (best) { this.on.tapAgent && this.on.tapAgent(best); return; }
    {
      const ndc0 = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      this.raycaster.setFromCamera(ndc0, this.camera);
      const ah = this.raycaster.intersectObjects(this.anchorPick || [], false)[0];
      if (ah) { const u = ah.object.userData.anchor; this.on.tapAnchor && this.on.tapAnchor(u.island, u.key); return; }
    }
    for (let i = 0; i < this.shells.length; i++) {
      const sh = this.shells[i]; if (!sh.active) continue;
      const sp = this.project(sh.mesh.position, 0);
      if (sp.front && Math.hypot(sp.x + rect.left - x, sp.y + rect.top - y) < (touch ? 44 : 30)) { this.on.tapShell && this.on.tapShell(i); return; }
    }
    const ndc = new THREE.Vector2(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObjects(this.pickables, false)[0];
    if (hit) { this.on.tapIsland && this.on.tapIsland(hit.object.userData.island, hit.point); return; }
    // 沒點到島：看看是不是橋
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -2.4);
    const p = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(plane, p) && this.onBridge(p.x, p.z)) { this.on.tapGround && this.on.tapGround(p); return; }
    this.on.tapEmpty && this.on.tapEmpty();
  }
  pickShell(i) {
    const sh = this.shells[i]; if (!sh || !sh.active) return false;
    sh.active = false; sh.mesh.visible = false; sh.respawn = 20;
    return true;
  }
  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    if (!w || !h) return;
    if (this._w === w && this._h === h) return;
    this._w = w; this._h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < .8 ? 52 : 42;
    this.camera.updateProjectionMatrix();
  }
  project(v, dy = 0) {
    const p = this._pv || (this._pv = new THREE.Vector3());
    p.copy(v); p.y += dy;
    p.project(this.camera);
    return { x: (p.x * .5 + .5) * this._w, y: (-p.y * .5 + .5) * this._h, front: p.z < 1 && p.z > -1 };
  }

  // ======================================================
  frame() {
    const m0 = c => c.g.userData.mat.opacity;
    const rawDt = Math.min(.05, this.clock.getDelta());
    const dt = rawDt;
    const still = this.reduced;
    if (!still) this.t += dt;
    const t = this.t;
    this.stepTime(dt);
    if (this._appliedH !== this.hour || this._appliedTheme !== this.theme || this.timeMode === 'auto') { this.applyTime(); this._appliedH = this.hour; this._appliedTheme = this.theme; }
    const env = this.env; env.reduced = still;
    if (!still) this.seaUniforms.uTime.value = t;
    for (const a of this.animated) a.update(t, dt, still, env);
    this.updateFx(dt, t, still);
    // 地面的浪花脈動
    this.foams.forEach((f, i) => { f.material.opacity = still ? .5 : .42 + Math.sin(t * 1.6 + i) * .18; });
    // 居民
    for (const a of this.agents) if (!a.hidden) a.update(dt, t, env);
    // 導師偶爾揮手
    for (const s of this.islands) if (s.npc && !still && !s.npc.talking) { s.npc.nextWave = (s.npc.nextWave ?? (3 + Math.random() * 5)) - dt; if (s.npc.nextWave < 0) { s.npc.wave(1.6); s.npc.nextWave = 6 + Math.random() * 6; } }
    // 動物
    for (const a of this.animals) {
      if (a.hidden) continue;
      if (a.shore && !a.talking) {
        const sleeping = env.night > .6;
        if (!still && !sleeping) a.shore.u += dt * a.shore.speed;
        const p = a.shore.fn(a.shore.u), q = a.shore.fn(a.shore.u + .002);
        a.pos.copy(p); a.yaw = Math.atan2(q.x - p.x, q.z - p.z);
        a.sleep = sleeping;
        a.path = []; a.brainless = true;
        a.update(dt, t, Object.assign({}, env, { reduced: still || sleeping }));
        if (!still && !sleeping) { a.walkT += dt * 8; a.m.body.rotation.z = Math.sin(a.walkT) * .15; }
        continue;
      }
      if (a.swim) {
        const s = a.swim;
        if (!still && !a.talking) s.a += dt * s.speed;
        const x = Math.cos(s.a) * s.R, z = Math.sin(s.a) * s.R;
        let y = s.y + (still ? 0 : Math.sin(t * 1.3 + s.ph) * .12);
        let pitch = 0;
        if (s.jump && !still) { const j = (t * .25 + s.ph) % 4; if (j < 1) { y += Math.sin(j * Math.PI) * 3.2; pitch = -Math.cos(j * Math.PI) * .7; } }
        else if (!s.jump && !still) { const j = (t * .1 + s.ph) % 3; if (j < .5) y += Math.sin(j / .5 * Math.PI) * .45; }
        a.pos.set(x, y, z);
        if (!a.talking) { a.yaw = Math.atan2(-Math.sin(s.a) * Math.sign(s.speed), Math.cos(s.a) * Math.sign(s.speed)); a.root.rotation.y = a.yaw; }
        a.m.body.rotation.x = pitch;
        if (a.m.legs.length && !still) a.m.legs.forEach((l, i) => { l.rotation.y = Math.sin(t * 3 + i) * .4; });
        a.update(dt, t, Object.assign({}, env, { reduced: true }));
        continue;
      }
      if (a.fly) {
        const f = a.fly;
        const sleeping = env.night > .6;
        a.root.visible = !sleeping && !a.hidden;
        if (!still && !a.talking) f.ph += dt;
        a.pos.set(f.c.x + Math.cos(f.ph * .9) * f.R + Math.sin(f.ph * 2.3) * .3, f.c.y + 1 + Math.sin(f.ph * 1.7) * .4, f.c.z + Math.sin(f.ph * 1.1) * f.R);
        a.root.rotation.y = -f.ph * .9;
        const flap = still ? .3 : Math.sin(t * 18 + f.ph) * .9;
        a.m.wings[0].rotation.z = flap; a.m.wings[1].rotation.z = -flap;
        continue;
      }
      a.update(dt, t, env);
    }
    // 冒險者
    if (this.player) {
      this.updatePlayerKeys(dt);
      const pl = this.player;
      if (pl.path.length && !still) pl.pos.y = this.heightAt(pl.pos.x, pl.pos.z);
      const walking = pl.path.length > 0 || (pl.keyWalk > 0);
      if (pl.keyWalk > 0) { pl.keyWalk -= dt; pl.walkT += dt * 9; const sw = still ? 0 : Math.sin(pl.walkT); pl.m.legL.rotation.x = sw * .6; pl.m.legR.rotation.x = -sw * .6; pl.m.armL.rotation.x = -sw * .5; pl.m.armR.rotation.x = sw * .5; }
      pl.update(dt, t, env);
      if (pl.path.length) pl.pos.y = this.heightAt(pl.pos.x, pl.pos.z);
      this.playerWalking = walking;
    }
    // 雲
    const camPos = this.camera.position, tgt = this.controls.target;
    const seg = new THREE.Line3(camPos, tgt), cp = new THREE.Vector3();
    for (const c of this.clouds) {
      if (!still) c.a += dt * c.speed;
      c.g.position.set(Math.cos(c.a) * c.R, c.y, Math.sin(c.a) * c.R);
      seg.closestPointToPoint(c.g.position, true, cp);
      const d = cp.distanceTo(c.g.position);
      // 在鏡頭和群島之間的雲淡出，不擋住島
      const inFront = c.g.position.distanceTo(camPos) < camPos.distanceTo(tgt) * .95;
      const target = d < 18 || inFront ? 0 : .95;
      c.g.visible = m0(c) > .02 || target > 0;
      const m = c.g.userData.mat;
      m.opacity += (target - m.opacity) * (this._cloudInit ? Math.min(1, dt * 4) : 1);
      m.depthWrite = m.opacity > .9;
    }
    this._cloudInit = true;
    // 鳥群
    for (const f of this.flocks) {
      if (!still) f.a += dt * f.speed;
      const x = Math.cos(f.a) * f.R, z = Math.sin(f.a) * f.R * .8;
      f.flock.position.set(x, f.y + Math.sin(t * .5 + f.R) * 2, z);
      const nx = -Math.sin(f.a) * Math.sign(f.speed), nz = Math.cos(f.a) * .8 * Math.sign(f.speed);
      f.flock.rotation.y = Math.atan2(nx, nz);
      f.birds.forEach(b => { const w = still ? .2 : Math.sin(t * 10 + b.ph) * .7; b.wl.rotation.z = w; b.wr.rotation.z = -w; });
    }
    for (const bo of this.boats) {
      if (!still) bo.a += dt * bo.speed;
      bo.g.position.set(Math.cos(bo.a) * bo.R, .15 + (still ? 0 : Math.sin(t * 1.2 + bo.R) * .2), Math.sin(bo.a) * bo.R);
      bo.g.rotation.y = Math.atan2(-Math.sin(bo.a) * Math.sign(bo.speed), Math.cos(bo.a) * Math.sign(bo.speed)) + Math.PI / 2;
      bo.g.rotation.z = still ? 0 : Math.sin(t * .9 + bo.R) * .08;
    }
    this.rowboats.forEach((g, i) => { g.position.y = .12 + (still ? 0 : Math.sin(t * 1.4 + i) * .07); g.rotation.z = still ? 0 : Math.sin(t + i) * .05; });
    for (const b of this.balloons) {
      const a = b.a0 + (still ? 0 : t * .02);
      b.g.position.set(Math.cos(a) * b.R, b.y + (still ? 0 : Math.sin(t * .4 + b.a0) * 1.5), Math.sin(a) * b.R);
      b.g.rotation.y = still ? 0 : t * .05;
    }
    // 螢火蟲
    if (this.fireflies.material.opacity > 0) {
      const pos = this.fireflies.geometry.attributes.position.array;
      this.fireflySeeds.forEach((s, i) => {
        const a = s.a + (still ? 0 : t * .2 * (i % 2 ? 1 : -1));
        pos[i * 3] = s.s.x + Math.cos(a) * s.d; pos[i * 3 + 1] = s.s.top + s.h + (still ? 0 : Math.sin(t * 2 + s.ph) * .4); pos[i * 3 + 2] = s.s.z + Math.sin(a) * s.d;
      });
      this.fireflies.geometry.attributes.position.needsUpdate = true;
    }
    // 貝殼重生
    for (const sh of this.shells) {
      if (!sh.active) { sh.respawn -= dt; if (sh.respawn <= 0) { sh.active = true; sh.mesh.visible = true; } }
      else if (!still) sh.mesh.position.y = .55 + Math.sin(t * 2 + sh.mesh.position.x) * .05;
    }
    // 鏡頭
    if (this.flight) {
      const f = this.flight;
      f.el += dt;
      const k = clamp(f.el / f.dur, 0, 1), e = easeInOutCubic(k);
      this.camera.position.copy(f.curve.getPoint(e));
      this.controls.target.lerpVectors(f.t0, f.t1, f.intro ? clamp(e * 1.4, 0, 1) : e);
      this.camera.lookAt(this.controls.target);
      if (f.intro) this.canvas.style.filter = k < .25 ? `blur(${(1 - k / .25) * 3}px)` : '';
      if (k >= 1) { this.canvas.style.filter = ''; this.finishFlight(); }
    } else {
      if (this.follow && this.player && !this.userControlling && (this.playerWalking || this.followSnap)) {
        const goal = this.player.pos.clone(); goal.y += 1;
        const delta = goal.sub(this.controls.target).multiplyScalar(still ? 1 : Math.min(1, dt * 3));
        this.controls.target.add(delta); this.camera.position.add(delta);
      }
      this.controls.update();
    }
    this.updateViewShift(dt);
    this.renderer.render(this.scene, this.camera);
    this.on.frame && this.on.frame(dt);
    // FPS 監測：太慢就自動降成低畫質
    this.fps.acc += rawDt; this.fps.n++;
    if (this.fps.acc > 2) {
      const fps = this.fps.n / this.fps.acc; this.fps.acc = 0; this.fps.n = 0; this.lastFps = fps;
      if (fps < 24 && this.quality === 'high' && !document.hidden) { this.fps.low++; if (this.fps.low >= 2) { this.setQuality('low'); this.on.autoLow && this.on.autoLow(); } }
      else this.fps.low = 0;
    }
  }
}
