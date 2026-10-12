// ② 资源：每个执行池一行（五小时 / 每周各写各的状态 + 观测时间），点开看重置时间、来源、准确度和「现在测一次」。
// 新鲜（1 小时内）给百分比；过期写「过期 · 最后观测 mm-dd hh:mm」；从没观测到写「还没观测到」；只有 GPT Web 写「不可观测」。
// 这里只渲染 Mac 发来的缓存：页面打开、回前台、定时刷新都不会去测额度，只有点「现在测一次」才会发一次很小的调用。
import { h } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { rows, button, statusLine, latest } from './common.mjs';

export function renderQuota(app, quota, actions) {
  const list = Array.isArray(quota) ? quota : [];
  if (!list.length) return [h('p', { class: 'empty', text: '还没有额度信息。' })];
  const now = Date.now();
  return list.map((q) => {
    const t = F.quotaTile(q, now);
    const open = app.ui.quotaOpen.has(q.pool);
    const id = `quota-${q.pool}`;
    const head = h('button', {
      type: 'button', class: ['pool-head', t.stale ? 'is-stale' : '', t.observable && t.state !== 'none' ? '' : 'is-unobservable'],
      attrs: { 'aria-expanded': open ? 'true' : 'false', 'aria-controls': id },
      on: { click: () => { if (open) app.ui.quotaOpen.delete(q.pool); else app.ui.quotaOpen.add(q.pool); app.render(); } },
    },
    h('span', { class: 'pool-name', text: t.label }),
    h('span', { class: 'pool-main', text: t.main }),
    t.sub ? h('span', { class: 'pool-sub', text: t.sub }) : null,
    t.remaining !== null ? h('span', { class: 'meter', attrs: { 'aria-hidden': 'true' } }, h('span', { class: `meter-fill w${Math.round(t.remaining / 5) * 5}` })) : null);
    const body = open ? h('div', { class: 'pool-body', id },
      rows(F.quotaDetail(q, now)),
      q.probe?.available && app.transport.capabilities.quotaProbe ? h('div', { class: 'pool-probe' },
        button('现在测一次', async () => { await app.act(() => app.transport.probeQuota(q.pool)); }, { attrs: { 'data-pool': q.pool } }),
        h('p', { class: 'note', text: '会用掉一次很小的调用（页面自己不会去测）；十分钟内测过就直接给上次的值。' }),
        statusLine(latest(actions, (a) => a.kind === 'quota' && a.text === q.pool), { online: app.macOnline(), app })) : null)
      : null;
    return h('div', { class: ['pool', open ? 'is-open' : ''], attrs: { 'data-pool': q.pool } }, head, body);
  });
}
