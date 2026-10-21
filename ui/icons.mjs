// 线条图标（hub#165 设计整合，木木的 V2 设计稿）：SVG 用 createElementNS 建，路径是这里写死的常量（不是数据），
// 没有 innerHTML、没有内联样式；颜色跟着文字（stroke: currentColor，见 app.css 的 svg.i）。读屏不读（aria-hidden）。
// 测试里的假 DOM 没有 createElementNS：退回一个空的 span（只为了不报错，图标不带意思）。
const NS = 'http://www.w3.org/2000/svg';
const P = {
  send: ['M12 19V5', 'M6 11l6-6 6 6'],
  img: ['M5.5 5h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M20 16l-4.5-4.5L8 19', 'M9 8.4a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2z'],
  clip: ['M9 12.5l6.5-6.5a3 3 0 1 1 4.2 4.2L11 19a4.5 4.5 0 0 1-6.4-6.4L12 5.3'],
  gear: ['M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  search: ['M11 4.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13z', 'M20 20l-4.3-4.3'],
  chev: ['M6 9l6 6 6-6'],
  right: ['M9 6l6 6-6 6'],
  back: ['M15 5l-7 7 7 7'],
  x: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 12l5 5 9-10'],
  file: ['M7 3h7l5 5v13H7z', 'M14 3v5h5'],
  // 设置六页（设计修订 2）
  gauge: ['M4.5 16a7.5 7.5 0 1 1 15 0', 'M12 16l3.5-4.5'],
  key: ['M8.5 11.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 1 0 0-7z', 'M11 13l8-8', 'M16 8l2 2', 'M14 10l1.5 1.5'],
  phone: ['M8 3h8a1.5 1.5 0 0 1 1.5 1.5v15A1.5 1.5 0 0 1 16 21H8a1.5 1.5 0 0 1-1.5-1.5v-15A1.5 1.5 0 0 1 8 3z', 'M11 18h2'],
  shield: ['M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z', 'M9 12l2 2 4-4'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20.5a2 2 0 0 0 4 0'],
  info: ['M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 1 0 0-17z', 'M12 11v5', 'M12 8h.01'],
  monitor: ['M4 5h16v11H4z', 'M9 20h6', 'M12 16v4'],
  lock: ['M6.5 11h11v9h-11z', 'M9 11V8a3 3 0 0 1 6 0v3'],
};

export function icon(name, cls = '') {
  const doc = globalThis.document;
  if (!doc?.createElementNS) { const s = doc.createElement('span'); s.className = `i ${cls}`.trim(); return s; }
  const svg = doc.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', `i i-${name} ${cls}`.trim());
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const d of P[name] || []) {
    const p = doc.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    svg.append(p);
  }
  return svg;
}
