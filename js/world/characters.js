import * as THREE from 'three';
import { G } from './props.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const matCache = new Map();
export function M(color, extra) {
  const key = color + (extra ? JSON.stringify(extra) : '');
  if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial(Object.assign({ color, flatShading: true, roughness: .85 }, extra || {})));
  return matCache.get(key);
}
function part(geo, color, x, y, z, sx, sy, sz, parent, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, typeof color === 'string' || typeof color === 'number' ? M(color) : color);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  parent.add(m);
  return m;
}
function limb(parent, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; }

// 把同一個群組裡的小零件合成一個網格（減少繪製次數）
const _vcMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .85 });
function consolidate(group, keep = new Set()) {
  const meshes = group.children.filter(c => c.isMesh && !keep.has(c) && c.material && c.material.color && !c.material.map && !(c.material.emissive && c.material.emissive.getHex() !== 0) && c.material.side !== THREE.DoubleSide);
  if (meshes.length < 2) return;
  const parts = meshes.map(m => {
    m.updateMatrix();
    let g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position') g.deleteAttribute(k);
    g.applyMatrix4(m.matrix);
    const n = g.attributes.position.count, c = m.material.color, arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  });
  const merged = mergeGeometries(parts, false);
  merged.computeVertexNormals();
  const mesh = new THREE.Mesh(merged, _vcMat);
  mesh.castShadow = true;
  meshes.forEach(m => group.remove(m));
  group.add(mesh);
}
function consolidateAll(root, keep) {
  const groups = [];
  root.traverse(o => { if (o.isGroup || o === root) groups.push(o); });
  groups.forEach(g => consolidate(g, keep));
}

const SKINS = ['#f6d2b4', '#e8b993', '#d49a73', '#b97a55', '#f2c9a0'];
const SHIRTS = ['#c45a2c', '#2f8f83', '#e0a43a', '#7a9cd6', '#8e4f6e', '#5f9e4f', '#d96b6b', '#4b6b9a'];
const PANTS = ['#4a3f37', '#3d4f6b', '#6f4a2e', '#5a5a5a'];
const HAIR = ['#2b1d16', '#4a2f1d', '#6b4a2a', '#1d1d1d'];
export const rand = (arr, r = Math.random) => arr[Math.floor(r() * arr.length)];

// Q 版小人：頭、眼睛、帽子或頭髮、身體、兩手兩腳
export function makePerson(o = {}) {
  const r = o.rng || Math.random;
  const skin = o.skin || rand(SKINS, r), shirt = o.shirt || rand(SHIRTS, r), pants = o.pants || rand(PANTS, r), hair = o.hair || rand(HAIR, r);
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const legL = limb(body, -.09, .4, 0), legR = limb(body, .09, .4, 0);
  part(G.box, pants, 0, -.19, 0, .13, .38, .15, legL);
  part(G.box, pants, 0, -.19, 0, .13, .38, .15, legR);
  part(G.box, '#3a2a20', 0, -.37, .03, .14, .06, .2, legL);
  part(G.box, '#3a2a20', 0, -.37, .03, .14, .06, .2, legR);
  const torsoGeo = o.robe ? new THREE.CylinderGeometry(.19, .32, .62, 8) : new THREE.CylinderGeometry(.19, .23, .44, 8);
  const torso = part(torsoGeo, shirt, 0, o.robe ? .55 : .6, 0, 1, 1, 1, body);
  const armL = limb(body, -.25, .78, 0), armR = limb(body, .25, .78, 0);
  part(G.box, shirt, 0, -.15, 0, .1, .3, .11, armL);
  part(G.box, shirt, 0, -.15, 0, .1, .3, .11, armR);
  part(G.sphere, skin, 0, -.33, 0, .065, .065, .065, armL);
  part(G.sphere, skin, 0, -.33, 0, .065, .065, .065, armR);
  const head = new THREE.Group(); head.position.y = 1.02; body.add(head);
  part(G.sphere, skin, 0, 0, 0, .25, .24, .24, head);
  part(G.box, '#1d1410', -.08, .02, .22, .045, .06, .02, head);
  part(G.box, '#1d1410', .08, .02, .22, .045, .06, .02, head);
  part(G.sphere, '#f19a8b', -.14, -.06, .19, .04, .025, .02, head);
  part(G.sphere, '#f19a8b', .14, -.06, .19, .04, .025, .02, head);
  const hat = o.hat || rand(['hair', 'cap', 'straw', 'hair', 'bun'], r);
  const hatColor = o.hatColor || rand(['#c45a2c', '#2f8f83', '#f3c64b', '#ffffff', '#8e4f6e'], r);
  if (hat === 'hair' || hat === 'bun' || hat === 'band') {
    part(G.sphere, hair, 0, .07, -.03, .27, .2, .26, head);
    if (hat === 'bun') part(G.sphere, hair, 0, .27, -.06, .1, .1, .1, head);
    if (hat === 'band') part(G.box, o.bandColor || '#b8282e', 0, .1, 0, .54, .07, .52, head);
  } else if (hat === 'cap') {
    part(G.sphere, hatColor, 0, .1, 0, .27, .17, .27, head);
    part(G.box, hatColor, 0, .06, .22, .26, .03, .18, head);
  } else if (hat === 'straw' || hat === 'douli') {
    part(G.cone6, hat === 'douli' ? '#c9a464' : '#e6c27a', 0, .24, 0, hat === 'douli' ? .58 : .42, .22, hat === 'douli' ? .58 : .42, head);
  } else if (hat === 'beret') {
    part(G.sphere, hatColor, .04, .17, 0, .27, .1, .27, head, 0, 0, -.2);
  }
  const extras = {};
  if (o.basket) extras.basket = part(G.cyl8, '#a07b54', 0, .66, -.24, .16, .36, .14, body);
  if (o.lantern) { const l = part(G.sphere, M('#ffd27a', { emissive: '#ffb347', emissiveIntensity: 1.2 }), 0, -.45, .1, .11, .13, .11, armR); extras.lantern = l; }
  if (o.cloak) part(new THREE.ConeGeometry(.36, .78, 8), o.cloak, 0, .6, -.04, 1, 1, 1, body);
  if (o.glasses) { part(G.torus, '#2b1d16', -.09, .02, .23, .055, .055, .03, head); part(G.torus, '#2b1d16', .09, .02, .23, .055, .055, .03, head); }
  if (o.apron) part(G.box, o.apron, 0, .55, .2, .3, .4, .03, body);
  if (o.scroll) part(G.cyl8, '#f4e6d0', 0, -.38, .08, .05, .3, .05, armL, 0, 0, Math.PI / 2);
  if (o.backpack) part(G.box, o.backpack, 0, .64, -.2, .3, .32, .14, body);
  if (o.brush) part(G.cyl6, '#6f4a2e', 0, -.42, .06, .025, .3, .025, armR, .4);
  if (o.weave) { // 太魯閣族服的紅色織紋
    part(G.box, '#b8282e', 0, .5, 0, .48, .07, .48, body);
    part(G.box, '#b8282e', 0, .7, 0, .4, .06, .4, body);
    part(new THREE.ConeGeometry(.34, .5, 8), '#f7efe4', 0, .42, 0, 1, 1, 1, body);
    part(G.box, '#b8282e', 0, .25, 0, .58, .07, .58, body);
  }
  const carry = part(G.box, '#b07a46', 0, 1.45, 0, .42, .32, .38, body);
  carry.visible = false;
  consolidateAll(root, new Set([carry]));
  root.scale.setScalar(o.scale || 1);
  return { root, body, legL, legR, armL, armR, head, torso, carry, extras, kind: 'person' };
}

// ---------- 動物 ----------
export function makeAnimal(kind) {
  const root = new THREE.Group();
  const body = new THREE.Group(); root.add(body);
  const p = { root, body, kind, legs: [], wings: [] };
  const eyes = (parent, x, y, z, s = .03) => { part(G.box, '#1d1410', -x, y, z, s, s * 1.3, s * .6, parent); part(G.box, '#1d1410', x, y, z, s, s * 1.3, s * .6, parent); };
  if (kind === 'duck') {
    part(G.sphere, '#fff7e0', 0, .25, 0, .2, .17, .28, body);
    const h = new THREE.Group(); h.position.set(0, .45, .2); body.add(h); p.head = h;
    part(G.sphere, '#fff7e0', 0, 0, 0, .13, .13, .13, h);
    part(G.cone4, '#f39c2a', 0, -.02, .15, .06, .14, .04, h, Math.PI / 2, Math.PI / 4);
    eyes(h, .06, .03, .11, .025);
    part(G.box, '#f39c2a', -.07, .04, 0, .05, .08, .1, body); part(G.box, '#f39c2a', .07, .04, 0, .05, .08, .1, body);
    p.wings.push(part(G.sphere, '#f3e6c4', -.17, .27, -.02, .05, .1, .18, body), part(G.sphere, '#f3e6c4', .17, .27, -.02, .05, .1, .18, body));
  } else if (kind === 'penguin') {
    part(G.sphere, '#2b2b35', 0, .38, 0, .22, .36, .2, body);
    part(G.sphere, '#ffffff', 0, .34, .08, .16, .28, .14, body);
    const h = new THREE.Group(); h.position.set(0, .7, 0); body.add(h); p.head = h;
    part(G.sphere, '#2b2b35', 0, 0, 0, .15, .14, .14, h);
    part(G.cone4, '#f39c2a', 0, -.02, .16, .04, .1, .03, h, Math.PI / 2);
    eyes(h, .06, .03, .12, .025);
    p.wings.push(part(G.box, '#2b2b35', -.22, .4, 0, .04, .26, .12, body, 0, 0, .2), part(G.box, '#2b2b35', .22, .4, 0, .04, .26, .12, body, 0, 0, -.2));
    part(G.box, '#f39c2a', -.08, .02, .06, .08, .04, .12, body); part(G.box, '#f39c2a', .08, .02, .06, .08, .04, .12, body);
  } else if (kind === 'turtle') {
    part(G.sphere, '#3f7a4a', 0, .12, 0, .5, .24, .6, body);
    part(G.sphere, '#5a9a5f', 0, .2, 0, .35, .14, .42, body);
    const h = new THREE.Group(); h.position.set(0, .12, .62); body.add(h); p.head = h;
    part(G.sphere, '#9cc48a', 0, 0, 0, .16, .13, .18, h); eyes(h, .07, .04, .13, .03);
    for (const [x, z] of [[-.45, .3], [.45, .3], [-.35, -.4], [.35, -.4]]) p.legs.push(part(G.box, '#9cc48a', x, .05, z, .3, .05, .16, body));
  } else if (kind === 'dolphin') {
    part(G.sphere, '#6f93b3', 0, 0, 0, .35, .38, 1.2, body);
    part(G.sphere, '#dbe7ef', 0, -.12, .1, .26, .22, .9, body);
    part(G.cone4, '#6f93b3', 0, .02, 1.3, .1, .4, .1, body, Math.PI / 2);
    part(G.cone4, '#5b7f9f', 0, .45, -.1, .06, .45, .25, body, -.3);
    part(G.box, '#5b7f9f', 0, 0, -1.25, .9, .06, .3, body);
    eyes(body, .2, .08, .95, .04);
  } else if (kind === 'cat' || kind === 'dog') {
    const c = kind === 'cat' ? '#f0a35e' : '#b07a46', c2 = kind === 'cat' ? '#fff3e0' : '#f4e6d0';
    part(G.box, c, 0, .32, 0, .3, .26, .55, body);
    part(G.box, c2, 0, .26, .05, .24, .14, .46, body);
    const h = new THREE.Group(); h.position.set(0, .55, .32); body.add(h); p.head = h;
    part(G.box, c, 0, 0, 0, .3, .26, .26, h);
    part(G.box, c2, 0, -.06, .13, .16, .1, .06, h);
    part(G.box, '#3a2a20', 0, -.02, .16, .06, .04, .03, h);
    eyes(h, .07, .04, .135, .035);
    if (kind === 'cat') { part(G.cone4, c, -.09, .17, 0, .07, .14, .05, h); part(G.cone4, c, .09, .17, 0, .07, .14, .05, h); }
    else { part(G.box, '#7a5230', -.16, .02, 0, .05, .2, .12, h); part(G.box, '#7a5230', .16, .02, 0, .05, .2, .12, h); }
    const tail = new THREE.Group(); tail.position.set(0, .4, -.27); body.add(tail); p.tail = tail;
    part(G.box, c, 0, .12, -.04, .06, .3, .06, tail, -.5);
    for (const [x, z] of [[-.1, .2], [.1, .2], [-.1, -.2], [.1, -.2]]) { const l = limb(body, x, .2, z); part(G.box, c, 0, -.1, 0, .08, .2, .08, l); p.legs.push(l); }
  } else if (kind === 'rabbit') {
    part(G.sphere, '#f4efe8', 0, .22, -.04, .2, .2, .26, body);
    const h = new THREE.Group(); h.position.set(0, .42, .16); body.add(h); p.head = h;
    part(G.sphere, '#f4efe8', 0, 0, 0, .15, .14, .15, h);
    part(G.box, '#f4efe8', -.06, .2, -.02, .05, .26, .04, h, 0, 0, .1); part(G.box, '#f4efe8', .06, .2, -.02, .05, .26, .04, h, 0, 0, -.1);
    part(G.box, '#f2a7b5', -.06, .2, -.005, .025, .2, .02, h, 0, 0, .1); part(G.box, '#f2a7b5', .06, .2, -.005, .025, .2, .02, h, 0, 0, -.1);
    part(G.sphere, '#f2a7b5', 0, -.02, .14, .03, .025, .02, h);
    eyes(h, .07, .03, .12, .03);
    part(G.sphere, '#ffffff', 0, .25, -.3, .07, .07, .07, body);
  } else if (kind === 'butterfly') {
    const c = rand(['#f29ac0', '#f3c64b', '#9b7fd6', '#7ec8e3', '#ff9a3c']);
    part(G.box, '#3a2a20', 0, 0, 0, .03, .03, .2, body);
    const wg = new THREE.PlaneGeometry(.22, .2); wg.translate(.11, 0, 0);
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); body.add(w);
      const m = new THREE.Mesh(wg, new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, flatShading: true }));
      m.rotation.x = -Math.PI / 2; m.scale.x = s; w.add(m);
      p.wings.push(w);
    }
  }
  consolidateAll(root, new Set());
  return p;
}

// ---------- 會走路的角色 ----------
const _v = new THREE.Vector3();
export class Agent {
  constructor(model, o = {}) {
    this.m = model;
    this.root = model.root;
    this.info = o.info || null;     // 對話資料
    this.type = o.type || 'resident';
    this.speed = o.speed || 1.1;
    this.path = [];
    this.wait = Math.random() * 2;
    this.phase = Math.random() * 10;
    this.walkT = 0;
    this.state = 'idle';
    this.talking = false;
    this.waveT = 0;
    this.brain = o.brain || null;
    this.yaw = 0;
    this.sleep = false;
    this.hidden = false;
  }
  setPos(v) { this.root.position.copy(v); }
  get pos() { return this.root.position; }
  go(points, onDone) { this.path = points.map(p => p.clone()); this.onDone = onDone || null; }
  stopTalk() { this.talking = false; }
  talk(camPos) { this.talking = true; this.talkCam = camPos.clone(); this.waveT = 2.2; this.hop = .5; }
  wave(sec = 1.6) { this.waveT = sec; }
  faceTo(x, z) { this.yaw = Math.atan2(x - this.pos.x, z - this.pos.z); }

  update(dt, t, env) {
    const m = this.m;
    const reduced = env.reduced;
    let moving = false;
    if (this.talking) {
      if (this.talkCam) this.faceTo(this.talkCam.x, this.talkCam.z);
    } else if (!reduced && this.path.length) {
      const target = this.path[0];
      _v.subVectors(target, this.pos);
      const dist = _v.length();
      const step = this.speed * dt;
      if (dist <= step) {
        this.pos.copy(target); this.path.shift();
        if (!this.path.length) { const cb = this.onDone; this.onDone = null; cb && cb(this); }
      } else {
        _v.multiplyScalar(step / dist);
        this.pos.add(_v);
        if (Math.abs(_v.x) + Math.abs(_v.z) > 1e-5) this.yaw = Math.atan2(_v.x, _v.z);
        moving = true;
      }
    } else if (!this.path.length && this.brain && !reduced) {
      this.wait -= dt;
      if (this.wait <= 0) { this.brain(this, env); }
    }
    // 轉向（平滑）
    let dy = this.yaw - this.root.rotation.y;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.root.rotation.y += dy * Math.min(1, dt * 10);
    // 動作
    const k = m.kind;
    if (k === 'person') {
      if (moving) this.walkT += dt * this.speed * 7;
      const sw = moving ? Math.sin(this.walkT) : 0;
      m.legL.rotation.x = sw * .6; m.legR.rotation.x = -sw * .6;
      m.armL.rotation.x = -sw * .5;
      m.body.position.y = moving ? Math.abs(Math.sin(this.walkT)) * .05 : 0;
      if (this.waveT > 0 && !reduced) {
        this.waveT -= dt;
        m.armR.rotation.z = 2.6 + Math.sin(t * 12) * .35; m.armR.rotation.x = 0;
      } else if (this.waveT > 0) { this.waveT -= dt; m.armR.rotation.z = 2.6; }
      else { m.armR.rotation.z = 0; m.armR.rotation.x = sw * .5; }
      if (this.hop > 0 && !reduced) { this.hop -= dt; m.body.position.y += Math.max(0, Math.sin((.5 - this.hop) * 2 * Math.PI)) * .18; }
      if (!moving && !this.talking && !reduced && m.head) m.head.rotation.y = Math.sin(t * .7 + this.phase) * .35;
      else if (m.head) m.head.rotation.y = 0;
    } else {
      if (moving) this.walkT += dt * 10;
      const bob = moving && !reduced ? Math.abs(Math.sin(this.walkT)) : 0;
      if (k === 'rabbit') m.body.position.y = moving ? Math.abs(Math.sin(this.walkT * .6)) * .25 : 0;
      else if (k === 'duck' || k === 'penguin') { m.body.rotation.z = moving ? Math.sin(this.walkT) * .15 : 0; m.body.position.y = bob * .03; }
      else if (k === 'cat' || k === 'dog') { m.legs.forEach((l, i) => { l.rotation.x = moving ? Math.sin(this.walkT + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * .5 : 0; }); m.body.position.y = bob * .03; }
      if (m.tail && !reduced) m.tail.rotation.z = Math.sin(t * (k === 'dog' ? 10 : 3) + this.phase) * .4;
      if (m.head && !moving && !reduced && !this.sleep) m.head.rotation.y = Math.sin(t * .9 + this.phase) * .5;
      if (this.hop > 0 && !reduced) { this.hop -= dt; m.body.position.y += Math.max(0, Math.sin((.5 - this.hop) * 2 * Math.PI)) * .25; }
      if (this.sleep) { m.body.rotation.x = 0; m.body.position.y = -.08; if (m.head) m.head.rotation.x = .4; }
      else if (m.head) m.head.rotation.x = 0;
    }
  }
}
