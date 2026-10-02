// 建 DOM 的唯一入口。规矩（docs/UI.md §8）：
//   - 来自任务、视图、GitHub 的文字一律用 textContent 写进页面（字符串子节点 → 文本节点）。
//   - 不用 innerHTML / insertAdjacentHTML / outerHTML，也不拼 HTML 字符串。
//   - 不写 on* 属性、不写 style 属性（CSP 不允许内联样式；事件用 addEventListener）。
//   - 链接只允许 https://github.com/ 开头，其余一律显示成纯文字。

const FORBIDDEN_ATTR = /^(on|style$|srcdoc$|href$|src$|formaction$|action$)/i;

// h('button', { class: 'x', type: 'button', on: { click }, attrs: { 'aria-label': '…' } }, '文字', 子节点…)
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  const p = props || {};
  if (p.class) el.className = Array.isArray(p.class) ? p.class.filter(Boolean).join(' ') : p.class;
  if (p.text !== undefined && p.text !== null) el.textContent = String(p.text);
  for (const k of ['type', 'id', 'name', 'value', 'placeholder', 'autocomplete', 'inputMode', 'enterKeyHint', 'maxLength', 'rows', 'tabIndex', 'htmlFor', 'checked', 'disabled', 'hidden', 'readOnly', 'spellcheck', 'title']) {
    if (p[k] !== undefined && p[k] !== null) el[k] = p[k];
  }
  for (const [k, v] of Object.entries(p.attrs || {})) {
    if (FORBIDDEN_ATTR.test(k)) throw new Error(`不允许的属性：${k}`);
    if (v === false || v === null || v === undefined) continue;
    el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const [k, fn] of Object.entries(p.on || {})) el.addEventListener(k, fn);
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const clear = (el) => { el.replaceChildren(); return el; };

// 只放行 https://github.com/ 开头、能被 URL 解析、主机就是 github.com 的地址
export function safeHref(url) {
  if (typeof url !== 'string' || url.length > 2000 || !url.startsWith('https://github.com/')) return null;
  if (/[\s\u0000-\u001f\u007f]/.test(url)) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' || u.hostname !== 'github.com' || u.username || u.password || u.port) return null;
    return u.href;
  } catch { return null; }
}

// 链接：地址不合规就只显示文字
export function link(url, label) {
  const href = safeHref(url);
  const text = String(label ?? url ?? '');
  if (!href) return h('span', { class: 'plainlink', text });
  const a = h('a', { text, attrs: { target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' } });
  a.href = href;
  return a;
}

// 复制到剪贴板。拿不到剪贴板权限时返回 false（调用方提示手动复制）
export async function copyText(s) {
  try { await navigator.clipboard.writeText(String(s)); return true; } catch { return false; }
}
