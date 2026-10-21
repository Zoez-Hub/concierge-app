// 附件（hub#165，docs/V2.md §8.3）：提交任务和「补一句 / 追加截图」共用。设计整合：工具条上两个按钮（图片 / 文件），
// 选文件之前就写明这台设备能传多大、会不会压缩（真实上限，不误判）：
//   本机：图片 / 文本 ≤ 2 MB 原样 POST /api/attach；超过拒绝并说明（不悄悄缩小）。
//   远端：图片在页面里压到长边 ≤ 1024、JPEG 0.7，还大就再降，到 ≤ 约 87 KB（两段 × 60000 字符的上限；会转成 JPEG，透明的地方变白底），
//         文本 / JSON 超过约 87 KB 直接拒绝（不截断、不悄悄丢）；分段签名动作 attach，要等每一段的回执都成功，才把编号放进提交 / 补充。
// 页面不显示图片内容（Mac 本机页面也不给预览接口）：列表里只有名字、类别、大小和状态（压缩中 / 正在传 / 等 Mac 收下 / 已传好 / 没传上 · 重传）。最多 4 个。
// 状态都在一个普通对象里（st），页面重画时不丢；原始数据留在内存里，没传上时可以「重传」。
import { h } from '../lib/dom.mjs';
import { ATTACH_TYPES, ATTACH_PART_MAX, ATTACH_PARTS_MAX, ATTACH_PER_USE } from '../lib/proto.mjs';
import { bytesText } from '../lib/format.mjs';
import { button } from './common.mjs';
import { icon } from './icons.mjs';

export const ATTACH_MAX = ATTACH_PER_USE;
const LOCAL_MAX = 2 * 1024 * 1024;
// 远端最多 2 段、每段 60000 个字符（base64）：约 87 KB。规格写的“超过 120 KB 再降”在远端按这个更小的上限执行
const REMOTE_MAX_CHARS = ATTACH_PART_MAX * ATTACH_PARTS_MAX;
const SHRINK_TARGET = 120 * 1024;
const EXT_TYPE = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', txt: 'text/plain', log: 'text/plain', md: 'text/markdown', markdown: 'text/markdown', json: 'application/json' };
export const ACCEPT = 'image/png,image/jpeg,image/webp,text/plain,text/markdown,application/json,.md,.txt,.json,.log';
export const ACCEPT_IMG = 'image/png,image/jpeg,image/webp';
// 选文件之前就写明的那句（设计整合 E）。远端的 87 KB 来自签名动作两段 × 60000 字符（base64）
export const ATTACH_HINT_REMOTE = '手机上图片会压缩到约 87 KB 以内（清晰度会降低，适合截图），会转成 JPEG（透明的地方变成白底）；文本文件最多 87 KB；更大的请在 Mac 上添加。';
export const ATTACH_HINT_LOCAL = '图片和文本文件最多 2 MB，原样交给工程；只收 PNG / JPEG / WebP 图片和纯文本、Markdown、JSON。';
export const LOCAL_TOO_BIG = '文件太大了：Mac 上最多 2 MB（图片先缩小或裁剪再加）';
export const REMOTE_TEXT_TOO_BIG = '文本太大了：从这台设备最多传约 87 KB，更大的请在 Mac 上添加';
const BAD_TYPE = '这种文件不能当附件：只收 PNG / JPEG / WebP 图片，和纯文本、Markdown、JSON';

export const attachState = () => ({ items: [], seq: 0 });
export const attachIds = (st) => (st?.items || []).filter((x) => x.state === 'done' && x.id).map((x) => x.id);
export const attachBusy = (st) => (st?.items || []).some((x) => ['reading', 'shrinking', 'uploading', 'waiting'].includes(x.state));
export const attachFailed = (st) => (st?.items || []).some((x) => x.state === 'failed');
export const attachNames = (st) => (st?.items || []).filter((x) => x.state === 'done').map((x) => x.name);
export function attachClear(st) { if (st) { st.items = []; } }

function typeOf(file) {
  const t = String(file?.type || '').toLowerCase();
  if (ATTACH_TYPES.includes(t)) return t;
  const ext = String(file?.name || '').toLowerCase().split('.').pop();
  return EXT_TYPE[ext] || null;
}

const readB64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
  r.onerror = () => reject(new Error('读不了这个文件'));
  r.readAsDataURL(blob);
});
const b64Bytes = (s) => Math.floor(s.length / 4) * 3 - (s.endsWith('==') ? 2 : s.endsWith('=') ? 1 : 0);

// 缩小图片：长边 ≤ 1024，JPEG 0.7；还大就先降质量、再缩小。透明的地方铺白底（JPEG 没有透明）
async function shrink(file, maxChars) {
  let bmp;
  try { bmp = await createImageBitmap(file); } catch { throw new Error('这张图片读不出来（文件坏了，或者这个浏览器不认这种格式）'); }
  let scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height, 1));
  let q = 0.7;
  for (let i = 0; i < 8; i++) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * scale));
    c.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const url = c.toDataURL('image/jpeg', q);
    const data = url.slice(url.indexOf(',') + 1);
    if (data.length <= maxChars && b64Bytes(data) <= SHRINK_TARGET) { bmp.close?.(); return { data, bytes: b64Bytes(data), type: 'image/jpeg' }; }
    if (q > 0.45) q = Math.round((q - 0.15) * 100) / 100; else scale *= 0.75;
  }
  bmp.close?.();
  throw new Error('图片缩小之后还是太大：换一张小一点的，或者回到 Mac 上传');
}

async function prepare(file, { remote }) {
  const type = typeOf(file);
  if (!type) throw new Error(BAD_TYPE);
  const name = String(file.name || '附件').slice(0, 120);
  if (type.startsWith('image/')) {
    if (!remote) {
      if (file.size > LOCAL_MAX) throw new Error(LOCAL_TOO_BIG);
      return { name, type, data: await readB64(file), bytes: file.size };
    }
    const s = await shrink(file, REMOTE_MAX_CHARS);
    return { name: name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', type: s.type, data: s.data, bytes: s.bytes };
  }
  if (file.size > (remote ? Math.floor(REMOTE_MAX_CHARS / 4) * 3 : LOCAL_MAX)) throw new Error(remote ? REMOTE_TEXT_TOO_BIG : LOCAL_TOO_BIG);
  return { name, type, data: await readB64(file), bytes: file.size };
}

async function upload(app, st, it, onChange) {
  it.state = 'uploading'; it.error = null; it.id = null; it.parts = null;
  onChange();
  try {
    const r = await app.transport.attach({ name: it.name, type: it.type, data: it.data });
    if (app.local) {
      if (!r || r.ok === false) throw new Error(r?.error || '没传上');
      it.id = r.id; it.state = 'done';
      if (Number.isFinite(r.bytes)) it.bytes = r.bytes;
    } else {
      it.id = r.id;
      it.parts = (r.parts || []).map((p) => p.id);
      const bad = (r.parts || []).find((p) => p.state === 'failed');
      if (bad) { it.state = 'failed'; it.error = bad.error || '没送出去'; } else it.state = 'waiting';
      app.actions = await app.transport.actions();
      app.refreshSoon?.();
    }
  } catch (e) { it.state = 'failed'; it.error = e?.message || '没传上'; }
  onChange();
}

// 选好的文件：一个一个读、准备、上传。超过 4 个的不收
export async function addFiles(app, st, files, onChange) {
  const list = [...(files || [])];
  const room = ATTACH_MAX - st.items.length;
  if (list.length > room) st.note = `最多 ${ATTACH_MAX} 个附件，多出来的 ${list.length - Math.max(0, room)} 个没加上。`;
  else st.note = null;
  for (const f of list.slice(0, Math.max(0, room))) {
    const t0 = typeOf(f);
    const it = { key: `a${++st.seq}`, name: String(f.name || '附件'), type: null, kind: t0 ? (t0.startsWith('image/') ? 'image' : 'text') : null, bytes: f.size, data: null, state: !app.local && t0?.startsWith('image/') ? 'shrinking' : 'reading', id: null, parts: null, error: null };
    st.items.push(it);
    onChange();
    try {
      const p = await prepare(f, { remote: !app.local });
      Object.assign(it, p, { kind: p.type.startsWith('image/') ? 'image' : 'text' });
    } catch (e) { it.state = 'failed'; it.error = e?.message || '读不了这个文件'; it.unfixable = true; onChange(); continue; }
    await upload(app, st, it, onChange);
  }
}

// 远端：每一段的回执都成功了才算传好；有一段没成功（类型 / 大小不对、Mac 重启过前面的段丢了）就算没传上，可以重传
export function syncAttach(app, st) {
  let changed = false;
  for (const it of st?.items || []) {
    if (it.state !== 'waiting' || !it.parts) continue;
    const acts = it.parts.map((id) => (app.actions || []).find((a) => a.id === id) || null);
    const bad = acts.find((a) => a && (a.state === 'failed' || a.state === 'undelivered'));
    if (bad) { it.state = 'failed'; it.error = bad.state === 'undelivered' ? 'Mac 一直没有回执' : bad.error || '没传上'; changed = true; } else if (acts.every((a) => a && a.state === 'done')) { it.state = 'done'; changed = true; }
  }
  return changed;
}

// 附件那一块的一句状态
export function attachStatus(app, st) {
  const items = st?.items || [];
  if (st?.note) return st.note;
  if (!items.length) return '';
  const n = (s) => items.filter((x) => x.state === s).length;
  const fixable = items.filter((x) => x.state === 'failed' && !x.unfixable).length;
  const bad = n('failed') ? (fixable ? `有 ${n('failed')} 个附件没传上：删掉，或者点「重传」` : `有 ${n('failed')} 个附件加不上（原因写在它下面）：删掉它`) : null;
  let now = null;
  if (n('shrinking')) now = `正在压缩图片（${n('shrinking')} 个）…`;
  else if (n('reading') || n('uploading')) now = `正在传附件（${n('reading') + n('uploading')} 个）…`;
  else if (n('waiting')) now = app.macOnline() ? `附件已送出，等 Mac 收下（${n('waiting')} 个）` : `附件已送出。Mac 现在不在线，上线后收下（${n('waiting')} 个）`;
  if (now || bad) return [now, bad].filter(Boolean).join('；');
  return `附件 ${n('done')} 个，已传好`;
}

const STATE_TEXT = { reading: '正在读…', shrinking: '压缩中…', uploading: '正在传…', waiting: '等 Mac 收下', done: '已传好', failed: '没传上' };

// 工具条上的两个按钮（图片 / 文件），背后各是一个隐藏的文件选择框。labels：按钮上写字（展开态）
export function attachPickers(app, st, { id, onChange, labels = false }) {
  const full = st.items.length >= ATTACH_MAX;
  const mk = (kind, accept, text) => {
    const input = h('input', { type: 'file', id: kind === 'img' ? `${id}-img-input` : `${id}-input`, class: 'attach-input', hidden: true, attrs: { accept, multiple: true, 'aria-label': kind === 'img' ? '选择图片' : '选择文件' } });
    input.addEventListener('change', () => { const files = input.files; addFiles(app, st, files, onChange); input.value = ''; });
    const b = h('button', {
      type: 'button', class: 'tbtn', id: kind === 'img' ? `${id}-img` : `${id}-add`, disabled: full,
      attrs: { 'aria-label': full ? `最多 ${ATTACH_MAX} 个附件` : kind === 'img' ? '添加图片（截图）' : '添加文件（文本、Markdown、JSON、图片）', 'aria-describedby': `${id}-hint` },
      on: { click: () => input.click() },
    }, icon(kind === 'img' ? 'img' : 'clip'), h('span', { class: labels ? 'tl-on' : 'tl', text }));
    return [input, b];
  };
  return [...mk('img', ACCEPT_IMG, '图片'), ...mk('file', ACCEPT, '文件')];
}

// 画附件那一块：已选列表（每个可以删除，没传上的可以重传）+ 这台设备能传多大（选之前就写明）+ 一句状态
export function renderAttach(app, st, { id, onChange, hint = true }) {
  syncAttach(app, st);
  const list = st.items.length ? h('ul', { class: 'attach-list' }, st.items.map((it) => h('li', { class: ['attach-item', `is-${it.state}`] },
    icon(it.kind === 'image' ? 'img' : 'file'),
    h('span', { class: 'attach-name', text: it.name }),
    h('span', { class: 'attach-meta', text: [it.kind === 'image' ? '图片' : it.kind === 'text' ? '文本' : null, it.bytes ? bytesText(it.bytes) : null, STATE_TEXT[it.state], it.state === 'failed' && it.error ? it.error : null].filter(Boolean).join(' · ') }),
    h('span', { class: 'attach-tools' },
      it.state === 'failed' && !it.unfixable && it.data ? button('重传', () => upload(app, st, it, onChange), { cls: 'btn-quiet', attrs: { 'aria-label': `重传附件「${it.name}」` } }) : null,
      button('删除', () => { st.items = st.items.filter((x) => x !== it); st.note = null; onChange(); }, { cls: 'btn-quiet', attrs: { 'aria-label': `删除附件「${it.name}」` } }))))) : null;
  const status = attachStatus(app, st);
  return [list,
    hint ? h('p', { class: 'attach-hint', attrs: { id: `${id}-hint`, 'data-k': 'attach-hint' }, text: app.local ? ATTACH_HINT_LOCAL : ATTACH_HINT_REMOTE }) : null,
    h('p', { class: ['note', 'attach-status', attachFailed(st) ? 'is-error' : ''], attrs: { id: `${id}-status`, role: 'status' }, text: status })];
}
