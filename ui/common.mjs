// 几个界面上反复用到的小块。文字一律经 h()（textContent）。
import { h } from '../lib/dom.mjs';
// 和 transport/github.mjs 的 CARD_CHANGED 一字不差（有测试盯着）；界面不 import 取数方式
export const CARD_CHANGED = '这个任务的内容在你操作之后变了，看一下新的内容再操作';

// 一组“名称 — 内容”的行（任务页的谁做了什么、资源账单、额度详情）
export function rows(list, cls = '') {
  return h('dl', { class: ['rows', cls] }, list.map(([k, v]) => h('div', { class: 'row' }, h('dt', { text: k }), h('dd', { text: v ?? '没有' }))));
}

export function section(title, ...children) {
  return h('section', { class: 'block' }, h('h3', { class: 'block-title', text: title }), ...children);
}

// 动作的状态一句话。online：Mac 在不在线（远端才有意义）
export function actionText(a, { online = true } = {}) {
  if (!a) return null;
  switch (a.state) {
    case 'sending': return a.error ? `还没送出去，会自动重试（${a.error}）` : '正在送出…';
    case 'waiting': return online ? '已送出，等 Mac 处理' : '已送出。Mac 现在不在线，上线后处理';
    case 'done': return '已处理';
    case 'failed':
      // 远端的两种回执：卡片对不上（Mac 上已经变了，什么都没做，页面整页重读）；签名太旧（再点一次会用新的编号和时间重新签）。
      // 设备自己发现的（终审 F2）：要重发 / 重签时，任务的卡片已经不是她操作的那张了——不发，请她看着新的内容重新操作（没有“再发一次”）
      if (a.cardMismatch && a.error === CARD_CHANGED) return CARD_CHANGED;
      if (a.cardMismatch) return '没成功：页面上的和 Mac 上的不一致（Mac 上已经变了），这次什么都没做。页面已经刷新成 Mac 上最新的，看一眼再操作。';
      if (a.stale) return '没成功：这条操作太旧了，Mac 没有执行。再点一次就行。';
      return `没成功：${a.error || '原因不明'}`;
    // 没有回执就不算做了（远端）：Mac 在线却一直没回执，多半是这条动作被删了或者没被认
    case 'undelivered': return '没有送到：Mac 一直没有回执，这条操作没有生效。';
    default: return null;
  }
}

// 动作的状态一行；没送到的带「再发一次」（app 给了才有）
export function statusLine(a, opts = {}) {
  const t = actionText(a, opts);
  if (!t) return null;
  const line = h('p', { class: ['status', a.state === 'failed' || a.state === 'undelivered' ? 'is-error' : '', a.state === 'done' ? 'is-done' : ''], text: t, attrs: { role: 'status' } });
  if (a.state !== 'undelivered' || !opts.app?.transport?.retry) return line;
  return h('div', { class: 'status-row' }, line, button('再发一次', () => opts.app.act(() => opts.app.transport.retry(a.id)), { cls: 'btn-quiet' }));
}

// 最近一次针对某个任务（或某类）的动作
export function latest(actions, pred) {
  return (actions || []).filter(pred).sort((a, b) => b.at - a.at)[0] || null;
}

// 按钮：type=button，文字是动词
export const button = (text, on, { primary = false, cls = '', disabled = false, attrs = {} } = {}) =>
  h('button', { type: 'button', class: ['btn', primary ? 'btn-primary' : '', cls], text, disabled, attrs, on: on ? { click: on } : {} });

// 复制按钮：「复制：看 <任务号>」
export function copyButton(label, value, copy) {
  const b = button(label, async () => {
    const ok = await copy(value);
    b.textContent = ok ? '已复制' : `复制不了，手动复制：${value}`;
    setTimeout(() => { b.textContent = label; }, 2500);
  }, { cls: 'btn-quiet' });
  return b;
}
