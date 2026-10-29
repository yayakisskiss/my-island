import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// 可重現的亂數
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const smooth = t => t * t * (3 - 2 * t);
export const easeInOutCubic = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const _c = new THREE.Color();
export function col(hex) { return new THREE.Color(hex); }
export function jitter(hex, amt, r) {
  _c.set(hex);
  const hsl = {}; _c.getHSL(hsl);
  _c.setHSL(hsl.h + (r() - .5) * amt * .1, clamp(hsl.s + (r() - .5) * amt * .3, 0, 1), clamp(hsl.l + (r() - .5) * amt * .25, 0, 1));
  return _c.clone();
}

// 把幾何體轉成「只有 position + color」的非索引幾何，方便合併
export function prep(geo, color, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo.clone();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'color') g.deleteAttribute(k);
  if (matrix) g.applyMatrix4(matrix);
  if (!g.attributes.color) {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  return g;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
export function mat(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _q.setFromEuler(_e.set(rx, ry, rz));
  return _m.clone().compose(_v.set(x, y, z), _q, _s.set(sx, sy, sz));
}

// 靜態物件合併器：同一種材質的東西合成一個網格，手機也不卡
export class StaticBatch {
  constructor() { this.buckets = {}; }
  add(bucket, geo, color, matrix) {
    (this.buckets[bucket] ||= []).push(prep(geo, color, matrix));
  }
  build(materials, parent) {
    const out = {};
    for (const [k, list] of Object.entries(this.buckets)) {
      if (!list.length) continue;
      const g = mergeGeometries(list, false);
      g.computeVertexNormals();
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, materials[k] || materials.solid);
      m.castShadow = k === 'solid';
      m.receiveShadow = k !== 'glow';
      m.matrixAutoUpdate = false; m.updateMatrix();
      parent.add(m);
      out[k] = m;
      list.forEach(x => x.dispose());
    }
    this.buckets = {};
    return out;
  }
}

// 只有 position+color 的群組（給會動的物件）
export function mergedMesh(parts, material, shadow = true) {
  const g = mergeGeometries(parts.map(p => prep(p[0], p[1], p[2])), false);
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, material);
  m.castShadow = shadow; m.receiveShadow = shadow;
  return m;
}

// 有起伏海岸線的島嶼外形
export function makeRadiusFn(R, seed) {
  const r = rng(seed);
  const a = [r() * 6.28, r() * 6.28, r() * 6.28, r() * 6.28];
  return th => R * (1 + .075 * Math.sin(3 * th + a[0]) + .05 * Math.sin(5 * th + a[1]) + .03 * Math.sin(8 * th + a[2]) + .018 * Math.sin(13 * th + a[3]));
}

// 一圈截頭錐（可帶頂面），半徑依角度變化
export function ringFrustum(rf, y0, s0, y1, s1, segs, cap = false, colorFn = null, r = Math.random) {
  const pos = [], colors = [];
  const push = (x, y, z) => pos.push(x, y, z);
  for (let i = 0; i < segs; i++) {
    const a0 = i / segs * Math.PI * 2, a1 = (i + 1) / segs * Math.PI * 2;
    const r00 = rf(a0) * s0, r01 = rf(a1) * s0, r10 = rf(a0) * s1, r11 = rf(a1) * s1;
    const p = [
      [Math.cos(a0) * r00, y0, Math.sin(a0) * r00], [Math.cos(a1) * r01, y0, Math.sin(a1) * r01],
      [Math.cos(a1) * r11, y1, Math.sin(a1) * r11], [Math.cos(a0) * r10, y1, Math.sin(a0) * r10]
    ];
    push(...p[0]); push(...p[2]); push(...p[1]);
    push(...p[0]); push(...p[3]); push(...p[2]);
    if (colorFn) { const c1 = colorFn(r), c2 = colorFn(r); for (let k = 0; k < 3; k++) colors.push(c1.r, c1.g, c1.b); for (let k = 0; k < 3; k++) colors.push(c2.r, c2.g, c2.b); }
    if (cap) {
      push(0, y1, 0); push(...p[2]); push(...p[3]);
      if (colorFn) { const c = colorFn(r); for (let k = 0; k < 3; k++) colors.push(c.r, c.g, c.b); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colorFn) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  return g;
}

// 不規則的平面色塊（地面拼貼）
export function blobPatch(R, seed, segs = 9) {
  const r = rng(seed);
  const pts = [];
  for (let i = 0; i < segs; i++) {
    const a = i / segs * Math.PI * 2;
    const rr = R * (.7 + r() * .45);
    pts.push(new THREE.Vector2(Math.cos(a) * rr, Math.sin(a) * rr));
  }
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts));
  g.rotateX(-Math.PI / 2);
  return g;
}

// 文字貼圖（字塊、詩碑、畫作）
export function textTexture(draw, w = 256, h = 256) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  draw(ctx, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export const CJK = '"Noto Sans TC", "Noto Sans CJK TC", "Microsoft JhengHei", "PingFang TC", sans-serif';
export const CJK_SERIF = '"Noto Serif TC", "Noto Serif CJK TC", "PMingLiU", serif';

export function glowTexture(inner = 'rgba(255,240,200,1)', outer = 'rgba(255,200,120,0)') {
  return textTexture((ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, inner); g.addColorStop(.25, inner.replace(/[\d.]+\)$/, '.6)')); g.addColorStop(1, outer);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  }, 128, 128);
}
