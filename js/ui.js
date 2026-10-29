// 共用的小工具：建立元素、跳脫、下載、提示
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
export function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
export function h(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }

export function toast(msg, ms = 2600) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast'; el.textContent = msg;
  box.appendChild(el);
  while (box.children.length > 3) box.firstChild.remove();
  setTimeout(() => el.remove(), ms);
}
export function download(name, data, type = 'text/plain;charset=utf-8') {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (e2) {}
    ta.remove(); return ok;
  }
}
export const sampleBadge = (on = true) => on ? '<span class="badge sample" title="這是補寫的示意內容">示意</span>' : '';
export function today() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }

// 冒險者造型的小圖（SVG）
export function avatarSvg(style) {
  const looks = [
    { shirt: '#c45a2c', hat: '<ellipse cx="32" cy="16" rx="15" ry="8" fill="#2f8f83"/><rect x="32" y="16" width="16" height="4" rx="2" fill="#2f8f83"/>', extra: '<rect x="12" y="44" width="8" height="14" rx="3" fill="#2f8f83"/>' },
    { shirt: '#2f8f83', hat: '<circle cx="32" cy="9" r="6" fill="#2b1d16"/><ellipse cx="32" cy="18" rx="15" ry="8" fill="#2b1d16"/>', extra: '<rect x="44" y="50" width="12" height="4" rx="2" fill="#f4e6d0"/>' },
    { shirt: '#e0a43a', hat: '<ellipse cx="34" cy="14" rx="16" ry="6" fill="#8e4f6e" transform="rotate(-10 34 14)"/>', extra: '<rect x="46" y="44" width="3" height="16" fill="#6f4a2e" transform="rotate(20 47 52)"/>' }
  ];
  const l = looks[style] || looks[0];
  return `<svg viewBox="0 0 64 76" aria-hidden="true"><ellipse cx="32" cy="72" rx="15" ry="3" fill="#000" opacity=".15"/><rect x="24" y="58" width="7" height="12" rx="2" fill="#3d4f6b"/><rect x="33" y="58" width="7" height="12" rx="2" fill="#3d4f6b"/><path d="M18 40 Q32 34 46 40 L46 60 L18 60Z" fill="${l.shirt}"/>${l.extra}<circle cx="32" cy="24" r="14" fill="#f2c9a0"/>${l.hat}<circle cx="27" cy="26" r="2" fill="#2b1d16"/><circle cx="37" cy="26" r="2" fill="#2b1d16"/><path d="M28 31 Q32 34 36 31" stroke="#8b3b2a" stroke-width="1.5" fill="none" stroke-linecap="round"/></svg>`;
}
export const STYLE_NAMES = ['小探險家', '小詩人', '小畫家'];
export const STYLE_ICONS = ['🧭', '📜', '🎨'];
