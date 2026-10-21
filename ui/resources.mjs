// 设置 → 额度（hub#165 §14.1；设计修订 2 的额度卡，DESIGN_SPEC §7）：每个池子一张卡——
//   标题行：名字 + 账号徽章（只写“Mac 命令行”，套餐名看板里有才写）| 右上角一句新鲜度（新鲜 · hh:mm 读取 / 最后读取 …，已过期 / 还没读到过）
//   两行窗口：44px 标签 + 6px 条 + 右对齐的数值（剩 62% / 已重置 / 未读取）；条下 12px 小字（重置 15:40 / 过期说明）
//   底部「详细信息」折叠：来源、准确度、技术限制、上次读取。
// 四态：新鲜 / 过期（条和数值变淡，写的是当时读到的）/ 过了重置时间（不显示旧百分比）/ 还没读到；GPT Web 虚线框「不可读取」。
// 「刷新额度」一个按钮（卡片下面）：走 Mac 上官方的零推理只读通道（probe.free：不花额度），能读的池子各读一次；GPT Web 没有。
// 条的宽度用 .w0…w100 类，不写内联样式。
import { h } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { rows, button, statusLine, latest } from './common.mjs';

function meter(w) {
  const has = w.left !== null;
  return h('span', {
    class: ['meter', `is-${w.state}`],
    attrs: { role: 'img', 'aria-label': `${w.label}：${w.text}` },
  }, has ? h('span', { class: ['meter-fill', F.meterClass(w.left)] }) : null);
}

// 能读的池子（Mac 上有官方只读通道、这个页面能发动作）
const probeable = (app, q, v) => !!q.probe?.available && !!app.transport.capabilities.quotaProbe && v.state !== 'unobservable';

export function renderQuota(app, quota, actions) {
  const list = Array.isArray(quota) ? quota : [];
  if (!list.length) return [h('p', { class: 'empty', text: '还没有额度信息。' })];
  const now = Date.now();
  const cards = list.map((q) => {
    const v = F.quotaPool(q, now);
    const head = h('div', { class: 'pool-h' },
      h('span', { class: 'pool-title' }, h('span', { class: 'pool-name', text: v.name }), v.badge ? h('span', { class: 'pool-badge', text: v.badge }) : null),
      h('span', { class: ['pool-fresh', v.state === 'fresh' ? 'is-fresh' : ''], text: v.freshText }));
    if (v.state === 'unobservable') {
      return h('section', { class: ['pool', 'is-unobservable'], attrs: { 'data-pool': q.pool, 'data-state': v.state, 'aria-label': `${v.name} 的额度` } },
        head, h('p', { class: 'pool-line', text: v.line }),
        h('details', { class: 'pool-more', attrs: { open: app.ui.quotaOpen?.has(q.pool) || null }, on: { toggle: (e) => keep(app, q.pool, e) } }, h('summary', { text: '详细信息' }), rows(F.quotaMore(q, now))));
    }
    const wins = h('div', { class: 'wins' }, v.windows.map((w) => h('div', { class: ['win', `is-${w.state}`], attrs: { 'data-win': w.label } },
      h('span', { class: 'win-label', text: w.label }),
      meter(w),
      h('span', { class: 'win-text', text: w.value }),
      h('span', { class: 'win-sub', text: w.sub }))));
    // 「详细信息」点开之后保持开着（额度刷新、页面重画都不收起）
    const more = h('details', { class: 'pool-more', attrs: { open: app.ui.quotaOpen?.has(q.pool) || null }, on: { toggle: (e) => keep(app, q.pool, e) } },
      h('summary', { text: '详细信息' }), rows(F.quotaMore(q, now)));
    const st = probeable(app, q, v) ? statusLine(latest(actions, (a) => a.kind === 'quota' && a.text === q.pool), { online: app.macOnline(), app }) : null;
    return h('section', { class: ['pool', `is-${v.state}`], attrs: { 'data-pool': q.pool, 'data-state': v.state, 'aria-label': `${v.name} 的额度` } }, head, wins, st, more);
  });
  const can = list.filter((q) => probeable(app, q, F.quotaPool(q, now)));
  const free = can.some((q) => q.probe?.free);
  const probe = can.length ? h('div', { class: 'pool-probe' },
    button('刷新额度', async () => { for (const q of can) await app.act(() => app.transport.probeQuota(q.pool)); }, { cls: 'btn-small', attrs: { id: 'quota-refresh' } }),
    h('span', { class: 'note probe-free', text: free ? '不花额度：不发消息、不消耗推理，只读官方客户端记下的用量' : '读一次额度' })) : null;
  return [h('div', { class: 'pools' }, cards), probe];
}

function keep(app, pool, e) {
  const set = app.ui.quotaOpen || (app.ui.quotaOpen = new Set());
  if (e.currentTarget.open) set.add(pool); else set.delete(pool);
}
