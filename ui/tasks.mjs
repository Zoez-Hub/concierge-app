// ③ 任务列表：刚送出的 → 等你决定（有才显示，最上，醒目）→ 正在处理 → 完成（最近 5 条 + 更多）。
// 每一条两行：她说的那句话（截断）；状态 + 谁在做。
import { h } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { button } from './common.mjs';

const firstLine = (s) => String(s || '').trim().split('\n')[0];

function row(app, t, options) {
  const href = F.hashOfTask(t.ref);
  const a = h('a', { class: ['task', `is-${t.state}`], attrs: { 'data-ref': t.ref } },
    h('span', { class: 'task-want', text: firstLine(t.want) || t.title || '（这条任务没有原话）' }),
    h('span', { class: 'task-meta', text: F.listLine(t, options) }));
  a.href = href;
  a.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); app.nav(href); });
  return h('li', {}, a);
}

// 还没变成任务的输入：远端设备上自己刚送出的（outbox）、入口那边正在登记的（board.pending）
function pendingRows(app, view, outbox) {
  const online = app.macOnline();
  const mine = new Set();
  const out = [];
  for (const o of outbox || []) {
    mine.add(o.id);
    let meta;
    let tools = null;
    if (o.state === 'sending') meta = o.error ? `还没送出去，会自动重试（${o.error}）` : '正在送出…';
    else if (o.state === 'failed') {
      meta = `没送出去：${o.error || '原因不明'}`;
      tools = h('span', { class: 'row-tools' },
        button('再试一次', () => app.act(() => app.transport.retry(o.id))),
        button('删掉', () => app.act(() => app.transport.discard(o.id)), { cls: 'btn-quiet' }));
    } else if (o.stage) meta = o.claimError ? `已领取 · 刚才出了点问题，后台会自动重试：${o.claimError}` : `已领取 · ${o.stage}`;
    else meta = app.local || online ? '已送出' : '已送出。Mac 现在不在线，上线后会领取。';
    out.push(h('li', { class: 'pending', attrs: { 'data-client': o.id } },
      h('div', { class: ['task', 'is-pending', o.state === 'failed' ? 'is-failed' : ''] }, h('span', { class: 'task-want', text: firstLine(o.want) }), h('span', { class: 'task-meta', text: meta }), tools)));
  }
  for (const p of view?.board?.pending || []) {
    if (!p || (p.clientId && mine.has(p.clientId)) || mine.has(p.id)) continue;
    const meta = p.error ? `已收到 · 刚才出了点问题，后台会自动重试：${p.error}` : `已收到 · ${p.stage || '正在处理'}`;
    out.push(h('li', { class: 'pending' }, h('div', { class: ['task', 'is-pending'] }, h('span', { class: 'task-want', text: firstLine(p.want) }), h('span', { class: 'task-meta', text: meta }))));
  }
  return out;
}

export function renderTaskList(app, view, ordered, outbox) {
  const options = view?.board?.options || null;
  const { needs, active, done } = F.groupTasks(ordered);
  const pend = pendingRows(app, view, outbox);
  const out = [];
  if (pend.length) out.push(h('section', { class: 'group-sec', attrs: { 'aria-label': '刚送出' } }, h('h2', { class: 'group-title', text: '刚送出' }), h('ul', { class: 'tasklist' }, pend)));
  if (needs.length) {
    out.push(h('section', { class: 'group-sec is-needs' }, h('h2', { class: 'group-title' }, '等你决定', h('span', { class: 'count', text: String(needs.length) })),
      h('ul', { class: 'tasklist' }, needs.map((t) => row(app, t, options)))));
  }
  out.push(h('section', { class: 'group-sec' }, h('h2', { class: 'group-title' }, '正在处理', active.length ? h('span', { class: 'count', text: String(active.length) }) : null),
    active.length ? h('ul', { class: 'tasklist' }, active.map((t) => row(app, t, options))) : h('p', { class: 'empty', text: '现在没有在处理的任务。' })));
  const shown = app.ui.doneAll ? done : done.slice(0, F.DONE_SHOWN);
  out.push(h('section', { class: 'group-sec' }, h('h2', { class: 'group-title', text: '完成' }),
    done.length ? h('ul', { class: 'tasklist' }, shown.map((t) => row(app, t, options))) : h('p', { class: 'empty', text: '还没有完成的任务。' }),
    done.length > F.DONE_SHOWN ? button(app.ui.doneAll ? '收起' : `更多（还有 ${done.length - F.DONE_SHOWN} 条）`, () => { app.ui.doneAll = !app.ui.doneAll; app.render(); }, { cls: 'btn-quiet more' }) : null));
  if (!ordered.length && !pend.length) out.unshift(h('p', { class: 'empty lead', text: '还没有任务。在上面写一句你要什么，交给它。' }));
  return out;
}
