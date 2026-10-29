import * as THREE from 'three';
import { mat, jitter, col, mergedMesh, textTexture, CJK, CJK_SERIF, glowTexture } from './util.js';

export const PAL = {
  grass: ['#8fbd5c', '#7caf50', '#a2c86b', '#86b657'],
  grassDark: '#5f8f3f',
  sand: ['#f1dcae', '#ead09c', '#f6e6c2'],
  rock: ['#a39282', '#8a786a', '#726355', '#5c4e43', '#4a3f37'],
  wood: '#9b6a43', woodDark: '#6f4a2e', woodLight: '#c08b5a',
  roofs: ['#c45a2c', '#2f8f83', '#b8862f', '#8e4f6e', '#a8452a'],
  walls: ['#f4e6d0', '#efd9bd', '#fff3e0', '#e9dcc6', '#f6dfc8'],
  leaf: ['#5f9e4f', '#4f8a45', '#76b25c', '#6aa652'],
  palm: ['#4f9a52', '#5aa85a', '#3f8a48'],
  pine: ['#3f7a4a', '#356b40', '#4a8a55'],
  flower: ['#e86a5a', '#f3c64b', '#f29ac0', '#ffffff', '#9b7fd6', '#ff9a3c', '#e8455e'],
  stone: ['#d9cfc0', '#cbbfae', '#e3dacd', '#bfb3a2'],
  primary: '#c45a2c', accent: '#2f8f83', cream: '#fbefe3'
};
const pick = (arr, r) => arr[Math.floor(r() * arr.length)];

const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
  cyl12: new THREE.CylinderGeometry(1, 1, 1, 12),
  cone6: new THREE.ConeGeometry(1, 1, 6),
  cone7: new THREE.ConeGeometry(1, 1, 7),
  cone4: new THREE.ConeGeometry(1, 1, 4),
  ico0: new THREE.IcosahedronGeometry(1, 0),
  ico1: new THREE.IcosahedronGeometry(1, 1),
  dodec: new THREE.DodecahedronGeometry(1, 0),
  oct: new THREE.OctahedronGeometry(1, 0),
  sphere: new THREE.SphereGeometry(1, 8, 6),
  torus: new THREE.TorusGeometry(1, .35, 6, 12)
};
export { G };

// ---------- 樹 ----------
export function tree(b, x, y, z, r, type = 'round', s = 1) {
  const rot = r() * 6.28;
  if (type === 'round' || type === 'osmanthus') {
    const h = (1.1 + r() * .5) * s;
    b.add('solid', G.cyl6, PAL.woodDark, mat(x, y + h / 2, z, 0, rot, 0, .16 * s, h, .16 * s));
    const n = 2 + Math.floor(r() * 2);
    for (let i = 0; i < n; i++) {
      const rr = (.75 + r() * .35) * s;
      b.add('solid', G.ico0, jitter(pick(PAL.leaf, r), .6, r), mat(x + (r() - .5) * .7 * s, y + h + rr * .55 + i * .35 * s, z + (r() - .5) * .7 * s, r(), r(), 0, rr, rr * .9, rr));
    }
    if (type === 'osmanthus') {
      for (let i = 0; i < 26; i++) {
        const a = r() * 6.28, e = r() * 1.2, rr = .95 * s;
        b.add('solid', G.oct, '#f2c04a', mat(x + Math.cos(a) * rr * Math.cos(e - .3), y + h + .7 * s + Math.sin(e) * rr * .8, z + Math.sin(a) * rr * Math.cos(e - .3), 0, 0, 0, .09));
      }
    }
    return 0.7 * s;
  }
  if (type === 'pine') {
    const h = (.7 + r() * .3) * s;
    b.add('solid', G.cyl6, PAL.woodDark, mat(x, y + h / 2, z, 0, rot, 0, .14 * s, h, .14 * s));
    const c = pick(PAL.pine, r);
    for (let i = 0; i < 3; i++) {
      const w = (1.05 - i * .27) * s;
      b.add('solid', G.cone7, jitter(c, .4, r), mat(x, y + h + .45 * s + i * .62 * s, z, 0, rot + i, 0, w, 1.15 * s, w));
    }
    return 0.65 * s;
  }
  if (type === 'palm') {
    let px = x, py = y, pz = z;
    const lean = .18 + r() * .2, dir = r() * 6.28;
    const seg = 6, segH = .42 * s;
    for (let i = 0; i < seg; i++) {
      const nx = px + Math.cos(dir) * lean * segH * (i / seg) * 1.6, nz = pz + Math.sin(dir) * lean * segH * (i / seg) * 1.6;
      b.add('solid', G.cyl6, i % 2 ? '#a07b54' : '#8a6744', mat((px + nx) / 2, py + segH / 2, (pz + nz) / 2, Math.sin(dir) * lean * .6, 0, -Math.cos(dir) * lean * .6, (.15 - i * .01) * s, segH * 1.05, (.15 - i * .01) * s));
      px = nx; pz = nz; py += segH;
    }
    const lc = pick(PAL.palm, r);
    for (let i = 0; i < 7; i++) {
      const a = i / 7 * 6.28 + r() * .3;
      const L = (1.25 + r() * .3) * s;
      b.add('solid', G.cone4, jitter(lc, .5, r), mat(px + Math.cos(a) * L * .45, py - .12 * s, pz + Math.sin(a) * L * .45, 0, -a, Math.PI / 2 + .35, .3 * s, L, .06 * s));
    }
    for (let i = 0; i < 3; i++) b.add('solid', G.sphere, '#6b4a2a', mat(px + Math.cos(i * 2.1) * .18 * s, py - .2 * s, pz + Math.sin(i * 2.1) * .18 * s, 0, 0, 0, .12 * s));
    return 0.45 * s;
  }
  return 0.5;
}
export function bush(b, x, y, z, r, s = 1) {
  const c = pick(PAL.leaf, r);
  for (let i = 0; i < 3; i++) b.add('solid', G.ico0, jitter(c, .7, r), mat(x + (r() - .5) * .6 * s, y + .25 * s, z + (r() - .5) * .6 * s, r(), r(), 0, (.32 + r() * .2) * s));
}
export function rock(b, x, y, z, r, s = 1) {
  b.add('solid', G.dodec, jitter(pick(PAL.rock.slice(0, 3), r), .5, r), mat(x, y + .12 * s, z, r(), r() * 6, r(), (.35 + r() * .25) * s, (.22 + r() * .15) * s, (.3 + r() * .25) * s));
}
export function flowers(b, x, y, z, r, n = 6, rad = .6, palette = PAL.flower) {
  for (let i = 0; i < n; i++) {
    const a = r() * 6.28, d = Math.sqrt(r()) * rad;
    const fx = x + Math.cos(a) * d, fz = z + Math.sin(a) * d;
    b.add('solid', G.box, PAL.grassDark, mat(fx, y + .12, fz, 0, 0, 0, .03, .24, .03));
    b.add('solid', G.oct, pick(palette, r), mat(fx, y + .27, fz, 0, r() * 3, 0, .1, .08, .1));
  }
}
export function grassTuft(b, x, y, z, r) {
  const c = jitter(PAL.grassDark, .5, r);
  for (let i = 0; i < 3; i++) b.add('solid', G.cone4, c, mat(x + (r() - .5) * .25, y + .14, z + (r() - .5) * .25, (r() - .5) * .5, r() * 3, (r() - .5) * .5, .05, .3, .05));
}

// ---------- 房子 ----------
export function house(b, x, y, z, rot, r, o = {}) {
  const w = o.w || 1.8, d = o.d || 1.6, h = o.h || 1.5;
  const wall = o.wall || pick(PAL.walls, r), roof = o.roof || pick(PAL.roofs, r);
  const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1));
  const add = (bucket, geo, color, lx, ly, lz, sx, sy, sz, rx = 0, ry = 0, rz = 0) => b.add(bucket, geo, color, M.clone().multiply(mat(lx, ly, lz, rx, ry, rz, sx, sy, sz)));
  add('solid', G.box, '#7d6a58', 0, .08, 0, w + .2, .16, d + .2);
  add('solid', G.box, wall, 0, .16 + h / 2, 0, w, h, d);
  // 屋頂（三角柱）
  const roofGeo = new THREE.CylinderGeometry(1, 1, 1, 3);
  add('solid', roofGeo, roof, 0, .16 + h + .36, 0, (w + .55) / 1.732, d + .4, .72, -Math.PI / 2, 0, 0);
  add('solid', G.box, jitter(roof, .6, r), 0, .16 + h + .03, 0, w + .3, .08, d + .35);
  // 煙囪
  if (r() > .4) add('solid', G.box, '#8a5a40', w * .25, .16 + h + .6, -d * .15, .22, .6, .22);
  // 門與窗（窗戶放到會發光的桶）
  add('solid', G.box, PAL.woodDark, 0, .16 + .55, d / 2 + .01, .45, 1.05, .05);
  add('window', G.box, '#ffffff', -w * .3, .16 + h * .62, d / 2 + .02, .34, .34, .04);
  add('window', G.box, '#ffffff', w * .3, .16 + h * .62, d / 2 + .02, .34, .34, .04);
  add('window', G.box, '#ffffff', w / 2 + .02, .16 + h * .62, 0, .04, .34, .34);
  add('solid', G.box, '#ffffff', -w * .3, .16 + h * .62 - .22, d / 2 + .04, .44, .06, .08);
  add('solid', G.box, '#ffffff', w * .3, .16 + h * .62 - .22, d / 2 + .04, .44, .06, .08);
  // 窗台花盆
  add('solid', G.box, '#c97b4a', w * .3, .16 + h * .62 - .3, d / 2 + .12, .4, .12, .14);
  add('solid', G.oct, pick(PAL.flower, r), w * .3, .16 + h * .62 - .18, d / 2 + .12, .1, .08, .1);
  return Math.max(w, d) * .75;
}

export function fenceLine(b, x0, z0, x1, z1, y, color = PAL.woodLight) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), n = Math.max(2, Math.round(L / .6));
  const a = Math.atan2(dz, dx);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    b.add('solid', G.box, color, mat(x0 + dx * t, y + .3, z0 + dz * t, 0, 0, 0, .1, .6, .1));
  }
  b.add('solid', G.box, color, mat((x0 + x1) / 2, y + .45, (z0 + z1) / 2, 0, -a, 0, L, .06, .06));
  b.add('solid', G.box, color, mat((x0 + x1) / 2, y + .22, (z0 + z1) / 2, 0, -a, 0, L, .06, .06));
}
export function bench(b, x, y, z, rot) {
  b.add('solid', G.box, PAL.wood, mat(x, y + .32, z, 0, rot, 0, 1.0, .08, .34));
  b.add('solid', G.box, PAL.wood, mat(x - Math.sin(rot) * .15, y + .55, z - Math.cos(rot) * .15, 0, rot, 0, 1.0, .3, .06));
  b.add('solid', G.box, PAL.woodDark, mat(x + Math.cos(rot) * .4, y + .16, z - Math.sin(rot) * .4, 0, rot, 0, .08, .32, .3));
  b.add('solid', G.box, PAL.woodDark, mat(x - Math.cos(rot) * .4, y + .16, z + Math.sin(rot) * .4, 0, rot, 0, .08, .32, .3));
}
export function crate(b, x, y, z, rot, s = 1) {
  b.add('solid', G.box, '#b07a46', mat(x, y + .22 * s, z, 0, rot, 0, .44 * s, .44 * s, .44 * s));
  b.add('solid', G.box, '#7a5230', mat(x, y + .22 * s, z, 0, rot, 0, .46 * s, .08 * s, .46 * s));
}
export function sign(b, x, y, z, rot) {
  b.add('solid', G.box, PAL.woodDark, mat(x, y + .5, z, 0, rot, 0, .08, 1, .08));
  b.add('solid', G.box, PAL.woodLight, mat(x, y + .95, z, 0, rot, 0, .7, .36, .06));
}
export function well(b, x, y, z) {
  b.add('solid', G.cyl8, '#b3a594', mat(x, y + .3, z, 0, 0, 0, .45, .6, .45));
  b.add('solid', G.cyl8, '#3a6b8a', mat(x, y + .58, z, 0, 0, 0, .34, .05, .34));
  b.add('solid', G.box, PAL.woodDark, mat(x - .38, y + .9, z, 0, 0, 0, .07, .9, .07));
  b.add('solid', G.box, PAL.woodDark, mat(x + .38, y + .9, z, 0, 0, 0, .07, .9, .07));
  b.add('solid', G.cone4, PAL.primary, mat(x, y + 1.55, z, 0, Math.PI / 4, 0, .7, .45, .7));
}
export function stoneTile(b, x, y, z, r) {
  b.add('ground', G.cyl6, jitter(pick(PAL.stone, r), .4, r), mat(x, y + .02, z, 0, r() * 3, 0, .32 + r() * .1, .06, .3 + r() * .1));
}
export function dock(b, x, y, z, rot, len = 3) {
  const cos = Math.cos(rot), sin = Math.sin(rot);
  for (let i = 0; i < len * 2.5; i++) {
    const d = i * .4;
    b.add('solid', G.box, i % 2 ? PAL.wood : PAL.woodLight, mat(x + cos * d, y, z + sin * d, 0, -rot, 0, .34, .08, 1.2));
  }
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const d = i * len * .45;
    b.add('solid', G.cyl6, PAL.woodDark, mat(x + cos * d - sin * .55 * s, y - .5, z + sin * d + cos * .55 * s, 0, 0, 0, .08, 1.4, .08));
  }
  return [x + cos * (len + .4), z + sin * (len + .4)];
}
export function lampPost(b, x, y, z) {
  b.add('solid', G.cyl6, '#4a3f37', mat(x, y + .9, z, 0, 0, 0, .06, 1.8, .06));
  b.add('solid', G.box, '#4a3f37', mat(x, y + 1.8, z, 0, 0, 0, .3, .05, .3));
  b.add('window', G.box, '#ffffff', mat(x, y + 1.95, z, 0, 0, 0, .2, .26, .2));
  b.add('solid', G.cone4, '#4a3f37', mat(x, y + 2.17, z, 0, Math.PI / 4, 0, .22, .18, .22));
  return new THREE.Vector3(x, y + 1.95, z);
}
export function stall(b, x, y, z, rot, color, r) {
  const M = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(1, 1, 1));
  const add = (geo, c, lx, ly, lz, sx, sy, sz, rx = 0, ry = 0, rz = 0, bucket = 'solid') => b.add(bucket, geo, c, M.clone().multiply(mat(lx, ly, lz, rx, ry, rz, sx, sy, sz)));
  add(G.box, PAL.wood, 0, .45, 0, 1.6, .9, .8);
  add(G.box, PAL.woodLight, 0, .92, 0, 1.7, .06, .9);
  for (const sx of [-.78, .78]) for (const sz of [-.38, .38]) add(G.box, PAL.woodDark, sx, 1.2, sz, .07, 2.4, .07);
  for (let i = 0; i < 6; i++) add(G.box, i % 2 ? '#ffffff' : color, -.75 + i * .3, 2.3, .05, .3, .07, 1.25, .25);
  // 攤位上的貨
  for (let i = 0; i < 4; i++) add(G.sphere, pick(['#e8455e', '#f3c64b', '#7caf50', '#ff9a3c'], r), -.55 + i * .36, 1.04, .1, .13);
  const bulbs = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < 5; i++) { v.set(-.7 + i * .35, 2.08, .62).applyMatrix4(M); bulbs.push(v.clone()); add(G.sphere, '#ffffff', -.7 + i * .35, 2.08, .62, .06, .06, .06, 0, 0, 0, 'window'); }
  return bulbs;
}

// ---------- 橋與彩旗 ----------
export function bridge(b, x0, z0, x1, z1, y0, y1) {
  const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), a = Math.atan2(dz, dx);
  const n = Math.round(L / .42);
  const nx = -Math.sin(a), nz = Math.cos(a);
  for (let i = 0; i <= n; i++) {
    const t = i / n, arch = Math.sin(t * Math.PI) * .7;
    const px = x0 + dx * t, pz = z0 + dz * t, py = y0 + (y1 - y0) * t + arch;
    b.add('solid', G.box, i % 3 ? PAL.wood : PAL.woodLight, mat(px, py, pz, 0, -a, 0, .38, .1, 1.7));
    if (i % 4 === 0) for (const s of [-1, 1]) {
      b.add('solid', G.box, PAL.woodDark, mat(px + nx * .85 * s, py + .4, pz + nz * .85 * s, 0, 0, 0, .09, .85, .09));
      b.add('solid', G.cyl6, PAL.woodDark, mat(px + nx * .85 * s, py - 1, pz + nz * .85 * s, 0, 0, 0, .1, 2.2, .1));
    }
  }
  // 扶手
  for (const s of [-1, 1]) {
    const seg = 12;
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg, t1 = (i + 1) / seg;
      const p0 = [x0 + dx * t0 + nx * .85 * s, y0 + (y1 - y0) * t0 + Math.sin(t0 * Math.PI) * .7 + .8, z0 + dz * t0 + nz * .85 * s];
      const p1 = [x0 + dx * t1 + nx * .85 * s, y0 + (y1 - y0) * t1 + Math.sin(t1 * Math.PI) * .7 + .8, z0 + dz * t1 + nz * .85 * s];
      const len = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]);
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(...p0), new THREE.Vector3(...p1), new THREE.Vector3(0, 1, 0));
      const q = new THREE.Quaternion().setFromRotationMatrix(m);
      b.add('solid', G.box, PAL.woodLight, new THREE.Matrix4().compose(new THREE.Vector3((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), q, new THREE.Vector3(.07, .07, len)));
    }
  }
  return { nx, nz, L, a };
}

const BUNTING_COLORS = ['#c45a2c', '#2f8f83', '#f3c64b', '#f29ac0', '#ffffff', '#7a9cd6'];
// 彩旗串：回傳一個可以擺動的物件
export function bunting(p0, p1, sag = .6, material) {
  const group = new THREE.Group();
  const pivot = new THREE.Vector3().lerpVectors(p0, p1, .5);
  group.position.copy(pivot);
  const parts = [];
  const n = Math.max(4, Math.round(p0.distanceTo(p1) / .45));
  const tri = new THREE.BufferGeometry();
  tri.setAttribute('position', new THREE.Float32BufferAttribute([-.16, 0, 0, .16, 0, 0, 0, -.34, 0], 3));
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const yaw = Math.atan2(-dir.z, dir.x);
  const at = t => { const p = new THREE.Vector3().lerpVectors(p0, p1, t); p.y -= Math.sin(t * Math.PI) * sag; return p.sub(pivot); };
  for (let i = 0; i < n; i++) {
    const p = at((i + .5) / n);
    parts.push([tri, BUNTING_COLORS[i % BUNTING_COLORS.length], mat(p.x, p.y, p.z, 0, yaw, 0)]);
  }
  const mesh = mergedMesh(parts, material, false);
  const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 13 }, (_, i) => at(i / 12))), new THREE.LineBasicMaterial({ color: 0x5a4636 }));
  const swing = new THREE.Group();
  swing.add(mesh, line);
  group.add(swing);
  const axis = dir.clone().normalize();
  const phase = Math.random() * 6;
  return { object: group, update(t, dt, still) { if (!still) swing.quaternion.setFromAxisAngle(axis, Math.sin(t * 2.1 + phase) * .18); } };
}

// ---------- 會動的小機關 ----------
export function windmill(b, x, y, z, rot, material) {
  b.add('solid', G.cyl8, '#f4e6d0', mat(x, y + 1.6, z, 0, 0, 0, .7, 3.2, .7));
  b.add('solid', new THREE.CylinderGeometry(.55, .75, 3.2, 8), '#f4e6d0', mat(x, y + 1.6, z));
  b.add('solid', G.cone6, PAL.primary, mat(x, y + 3.65, z, 0, 0, 0, .85, 1, .85));
  b.add('solid', G.box, PAL.woodDark, mat(x + Math.sin(rot) * .62, y + .5, z + Math.cos(rot) * .62, 0, rot, 0, .45, .8, .1));
  b.add('window', G.box, '#ffffff', mat(x + Math.sin(rot) * .66, y + 2.2, z + Math.cos(rot) * .66, 0, rot, 0, .3, .3, .05));
  const hub = new THREE.Group();
  hub.position.set(x + Math.sin(rot) * .9, y + 3.1, z + Math.cos(rot) * .9);
  hub.rotation.y = rot;
  const parts = [[G.cyl8, PAL.woodDark, mat(0, 0, 0, Math.PI / 2, 0, 0, .18, .3, .18)]];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    parts.push([G.box, PAL.woodLight, mat(Math.cos(a) * 1.1, Math.sin(a) * 1.1, 0, 0, 0, a, 2.1, .08, .05)]);
    parts.push([G.box, i % 2 ? '#ffffff' : PAL.cream, mat(Math.cos(a) * 1.25 - Math.sin(a) * .22, Math.sin(a) * 1.25 + Math.cos(a) * .22, .02, 0, 0, a, 1.5, .42, .03)]);
  }
  const blades = mergedMesh(parts, material);
  hub.add(blades);
  return { object: hub, update(t, dt, still) { if (!still) blades.rotation.z -= dt * 1.2; } };
}
export function waterwheel(b, x, y, z, rot, material) {
  const wheel = new THREE.Group();
  wheel.position.set(x, y + 1, z); wheel.rotation.y = rot;
  const parts = [];
  parts.push([G.torus, PAL.wood, mat(0, 0, .25, 0, 0, 0, 1, 1, .4)]);
  parts.push([G.torus, PAL.wood, mat(0, 0, -.25, 0, 0, 0, 1, 1, .4)]);
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * 6.28;
    parts.push([G.box, PAL.woodDark, mat(Math.cos(a) * .55, Math.sin(a) * .55, 0, 0, 0, a, 1.1, .06, .06)]);
    parts.push([G.box, PAL.woodLight, mat(Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0, 0, 0, a, .4, .06, .62)]);
  }
  parts.push([G.cyl8, PAL.woodDark, mat(0, 0, 0, Math.PI / 2, 0, 0, .14, .9, .14)]);
  const m = mergedMesh(parts, material);
  wheel.add(m);
  b.add('solid', G.box, PAL.woodDark, mat(x + Math.cos(rot) * .5, y + .5, z - Math.sin(rot) * .5, 0, rot, 0, .12, 1.2, .12));
  b.add('solid', G.box, PAL.woodDark, mat(x - Math.cos(rot) * .5, y + .5, z + Math.sin(rot) * .5, 0, rot, 0, .12, 1.2, .12));
  return { object: wheel, update(t, dt, still) { if (!still) m.rotation.z += dt * .9; } };
}
export function flag(x, y, z, color, h = 2.4, material) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  const pole = new THREE.Mesh(G.cyl6, material);
  pole.scale.set(.05, h, .05); pole.position.y = h / 2; pole.castShadow = true;
  const poleMat = material.clone(); poleMat.vertexColors = false; poleMat.color = col('#5a4636'); pole.material = poleMat;
  group.add(pole);
  const geo = new THREE.PlaneGeometry(1, .62, 8, 2);
  geo.translate(.5, 0, 0);
  const fm = new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, flatShading: true, roughness: .8 });
  const cloth = new THREE.Mesh(geo, fm);
  cloth.position.y = h - .35; cloth.castShadow = true;
  group.add(cloth);
  const base = geo.attributes.position.array.slice();
  const phase = Math.random() * 6;
  return {
    object: group,
    update(t, dt, still) {
      if (still) return;
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const bx = base[i * 3];
        p.setZ(i, Math.sin(bx * 4 - t * 5 + phase) * .14 * bx);
        p.setY(i, base[i * 3 + 1] - bx * .05 + Math.sin(bx * 3 - t * 4) * .02);
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
    }
  };
}
export function fountain(b, x, y, z) {
  b.add('solid', new THREE.CylinderGeometry(2.6, 2.8, .5, 16), '#d9cfc0', mat(x, y + .25, z));
  b.add('ground', new THREE.CylinderGeometry(2.3, 2.3, .1, 16), '#5fb6c9', mat(x, y + .45, z));
  b.add('solid', new THREE.CylinderGeometry(.3, .45, 1.4, 8), '#cbbfae', mat(x, y + 1.1, z));
  b.add('solid', new THREE.CylinderGeometry(1.1, .8, .3, 12), '#d9cfc0', mat(x, y + 1.8, z));
  b.add('ground', new THREE.CylinderGeometry(.95, .95, .06, 12), '#6fc2d4', mat(x, y + 1.93, z));
  const N = 140;
  const pos = new Float32Array(N * 3), seeds = [];
  for (let i = 0; i < N; i++) seeds.push({ a: Math.random() * 6.28, p: Math.random(), big: i < 40 });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xd8f4ff, size: .16, transparent: true, opacity: .85, depthWrite: false }));
  pts.frustumCulled = false;
  const upd = (t, dt, still) => {
    for (let i = 0; i < N; i++) {
      const s = seeds[i];
      const ph = (s.p + (still ? 0 : t * (s.big ? .55 : .8))) % 1;
      if (s.big) { // 中央水柱
        const r = ph * .9, h = 2 + Math.sin(ph * Math.PI) * 1.6;
        pos[i * 3] = x + Math.cos(s.a) * r; pos[i * 3 + 1] = y + h; pos[i * 3 + 2] = z + Math.sin(s.a) * r;
      } else { // 外圈小水柱
        const r = 2.2 - ph * .9, h = .5 + Math.sin(ph * Math.PI) * .9;
        pos[i * 3] = x + Math.cos(s.a) * r; pos[i * 3 + 1] = y + h; pos[i * 3 + 2] = z + Math.sin(s.a) * r;
      }
    }
    geo.attributes.position.needsUpdate = true;
  };
  upd(0, 0, false);
  return { object: pts, update: upd };
}
export function waterfall(x, y0, y1, z, rot, w = 1.2) {
  const tex = textTexture((ctx, W, H) => {
    ctx.fillStyle = '#7fd0e6'; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(255,255,255,${.25 + Math.random() * .5})`; ctx.fillRect(Math.random() * W, Math.random() * H, 2 + Math.random() * 4, 10 + Math.random() * 30); }
  }, 64, 128);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 2);
  const h = y0 - y1;
  const geo = new THREE.PlaneGeometry(w, h, 1, 4);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) { const yy = p.getY(i); p.setZ(i, (1 - (yy / h + .5)) * .9); }
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: .9, side: THREE.DoubleSide }));
  const g = new THREE.Group();
  g.position.set(x, (y0 + y1) / 2, z); g.rotation.y = rot;
  g.add(m);
  const foam = new THREE.Mesh(new THREE.CircleGeometry(1, 10), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .7, depthWrite: false }));
  foam.rotation.x = -Math.PI / 2; foam.position.set(0, -h / 2 + .06 - (y1 - 0.05), 1.1);
  foam.position.y = -h / 2 + .05;
  g.add(foam);
  return { object: g, update(t, dt, still) { if (!still) tex.offset.y = (tex.offset.y + dt * 1.4) % 1; const s = 1 + Math.sin(t * 6) * .08; foam.scale.set(s, s, s); } };
}
export function lightBeam(x, y, z, target) {
  const len = new THREE.Vector3(x, y, z).distanceTo(target);
  const geo = new THREE.CylinderGeometry(.22, .95, len, 10, 1, true);
  geo.translate(0, -len / 2, 0);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffd28a, transparent: true, opacity: .22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  m.position.set(x, y, z);
  m.lookAt(target); m.rotateX(Math.PI / 2);
  // 讓圓錐軸線指向目標
  const dir = new THREE.Vector3().subVectors(target, m.position).normalize();
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir);
  return { object: m, update(t, dt, still, env) { const day = 1 - (env ? env.night : 0); m.material.opacity = (.07 + (still ? 0 : Math.sin(t * 2) * .025)) * (env ? env.duskBeam : 1) * day; m.visible = m.material.opacity > .01; } };
}
export function balloon(color, stripe, material) {
  const g = new THREE.Group();
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(Math.max(.05, Math.sin(t * Math.PI) * 1.6 * (1 - t * .35)) + (t > .9 ? .3 : 0), -t * 3.4 + 1.7)); }
  pts.reverse();
  const parts = [];
  for (let k = 0; k < 8; k++) parts.push([new THREE.LatheGeometry(pts, 2, k * Math.PI / 4, Math.PI / 4), k % 2 ? stripe : color, mat(0, 0, 0)]);
  parts.push([G.box, PAL.wood, mat(0, -2.6, 0, 0, 0, 0, .7, .5, .7)]);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push([G.box, '#5a4636', mat(sx * .3, -2.1, sz * .3, 0, 0, 0, .03, .9, .03)]);
  g.add(mergedMesh(parts, material, false));
  return g;
}

// ---------- 帶貼圖的地標 ----------
export function stele(text, title, w = 2, h = 3.2) {
  const tex = textTexture((ctx, W, H) => {
    ctx.fillStyle = '#e9e0d1'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#8a786a'; ctx.lineWidth = 10; ctx.strokeRect(14, 14, W - 28, H - 28);
    ctx.fillStyle = '#7a2e1a';
    ctx.font = `900 46px ${CJK_SERIF}`;
    ctx.textAlign = 'center';
    // 直書：標題在右
    const cols = text;
    const colW = (W - 80) / (cols.length + 1);
    title.split('').forEach((ch, i) => ctx.fillText(ch, W - 50, 90 + i * 52));
    ctx.fillStyle = '#3a2318'; ctx.font = `700 40px ${CJK_SERIF}`;
    cols.forEach((line, ci) => line.split('').forEach((ch, i) => ctx.fillText(ch, W - 50 - colW * (ci + 1), 100 + i * 52)));
  }, 320, 512);
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ color: 0xbfb3a2, flatShading: true, roughness: .9 });
  const slab = new THREE.Mesh(new THREE.BoxGeometry(w, h, .4), stone);
  slab.position.y = h / 2 + .5; slab.castShadow = slab.receiveShadow = true;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w * .86, h * .86), new THREE.MeshStandardMaterial({ map: tex, roughness: .9 }));
  face.position.set(0, h / 2 + .5, .205);
  const cap = new THREE.Mesh(new THREE.BoxGeometry(w + .3, .3, .6), stone);
  cap.position.y = h + .65; cap.castShadow = true;
  const base = new THREE.Mesh(new THREE.BoxGeometry(w + .6, .5, 1), stone);
  base.position.y = .25; base.castShadow = base.receiveShadow = true;
  g.add(slab, face, cap, base);
  return g;
}
export function charBlock(ch, color, size = 1) {
  const tex = textTexture((ctx, W, H) => {
    ctx.fillStyle = color; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,.18)'; ctx.fillRect(0, 0, W, 18);
    ctx.fillStyle = 'rgba(0,0,0,.12)'; ctx.fillRect(0, H - 18, W, 18);
    ctx.fillStyle = '#fff'; ctx.font = `900 150px ${CJK}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(ch, W / 2, H / 2 + 8);
  }, 256, 256);
  const m = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ map: tex, roughness: .7 }));
  m.castShadow = m.receiveShadow = true;
  // 積木上方的凸點
  const studMat = new THREE.MeshStandardMaterial({ color, roughness: .6 });
  for (const sx of [-.22, .22]) for (const sz of [-.22, .22]) {
    const s = new THREE.Mesh(G.cyl8, studMat);
    s.scale.set(.13 * size, .1 * size, .13 * size); s.position.set(sx * size, .55 * size, sz * size); s.castShadow = true;
    m.add(s);
  }
  return m;
}
export function painting() {
  const tex = textTexture((ctx, W, H) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f7e7c9'); g.addColorStop(1, '#efd5a8');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(80,100,90,.55)';
    ctx.beginPath(); ctx.moveTo(0, H * .75); ctx.lineTo(W * .25, H * .35); ctx.lineTo(W * .45, H * .6); ctx.lineTo(W * .7, H * .25); ctx.lineTo(W, H * .7); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = 'rgba(50,70,60,.75)';
    ctx.beginPath(); ctx.moveTo(0, H * .9); ctx.lineTo(W * .35, H * .6); ctx.lineTo(W * .6, H * .85); ctx.lineTo(W, H * .65); ctx.lineTo(W, H); ctx.lineTo(0, H); ctx.fill();
    ctx.fillStyle = '#c45a2c'; ctx.beginPath(); ctx.arc(W * .78, H * .2, 18, 0, 6.3); ctx.fill();
    ctx.fillStyle = '#3a2318'; ctx.font = `700 26px ${CJK_SERIF}`; ctx.textAlign = 'center';
    '詩中有畫'.split('').forEach((c, i) => ctx.fillText(c, 30, 46 + i * 30));
    ctx.fillStyle = '#b8282e'; ctx.fillRect(18, 170, 24, 24);
  }, 256, 220);
  return new THREE.MeshStandardMaterial({ map: tex, roughness: .9 });
}
export function glowSprite(color = 0xffd27a, size = 1.6) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: sharedGlow(), color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0 }));
  s.scale.set(size, size, size);
  return s;
}
let _glow;
export function sharedGlow() { return (_glow ||= glowTexture()); }
