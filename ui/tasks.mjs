// 统一工作台的列表部分（docs/V2.md §3，hub#165；设计整合按木木的 V2 设计稿 concierge/design/v2/）：
//   刚送出 → 需要你（卡片：黄铜点 + 类别 + 时间、任务名、一句要做什么、右下一个动词按钮——去选 / 去批准 / 开始核对，点了直接开弹层）
//   → 正在执行 → 等条件 · 没人在做 → 最近交付（完成 + 结束没做到，最近 5 条 + 更多）→ 已取消 / 已结束（折起来）。
// 列表行：没有卡，上分割线；第一行「#N · 短名」，第二行 状态点 + 状态词 + 一句话（交付的多三小段 代码 / 部署 / 验收）；右侧时间，
//   再右边「⌄」原地展开快捷详情（谁负责 / 下一步 / 需要你 / 最近更新 +「打开」和首要动作）。行上按空格也能展开；点任务名进任务页。
// 搜索或筛选一动，下面变成一份结果列表；清掉回到分组。分组口径是 format.mjs 的 groupTasks / taskGroupKey（六类核心状态）。
// 还没变成任务的（刚送出、正在登记）没有编号，照旧显示她说的那句话。
import { h } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { button, rows, statusLine, latest, copyButton } from './common.mjs';
import { icon } from './icons.mjs';
import { passkeyState } from './passkey.mjs';

const firstLine = (s) => String(s || '').trim().split('\n')[0];
const slug = (ref) => String(ref || '').replace(/[^A-Za-z0-9_-]/g, '-');
const homeOf = (app) => app.view?.board?.home || null;
const esc = (s) => (globalThis.CSS?.escape ? CSS.escape(s) : s);

// 「#86 · 短名」：编号用 ink-2 500（DESIGN_SPEC §2）
export function nameNode(name, cls = 'task-want') {
  const i = String(name).indexOf(' · ');
  if (i < 0) return h('span', { class: cls, text: name });
  return h('span', { class: cls }, h('span', { class: 'n', text: name.slice(0, i) }), name.slice(i));
}

// 展开 / 收起一条的快捷详情；重画之后焦点放回原来那个元素（行或者「⌄」）
function toggleQuick(app, ref, refocus) {
  if (!app.ui.quick) app.ui.quick = new Set();
  if (app.ui.quick.has(ref)) app.ui.quick.delete(ref); else app.ui.quick.add(ref);
  app.render();
  const doc = globalThis.document;
  if (refocus && doc?.querySelector) doc.querySelector(refocus === 'row' ? `a.task[data-ref="${esc(ref)}"]` : `button.quick-toggle[data-quick="${esc(ref)}"]`)?.focus();
}

// 这个任务的首要动作（快捷详情里「打开」旁边那个）
export function firstAction(app, t) {
  const acts = t.actions || [];
  const k = F.needKind(t);
  if (t.state === 'needs_zoe' && t.decision?.misfiled && acts.includes('reclassify') && app.transport.reclassify) return button('让工程接手', () => app.act(() => app.transport.reclassify(t)));
  if (acts.includes('resume') && t.state === 'queued' && t.plan?.consult?.async) return button('不等了，直接做', () => app.act(() => app.transport.resume(t)));
  if (acts.includes('resume') && (k === 'paused' || (k === 'owner_action' && t.state !== 'needs_zoe'))) return button(k === 'paused' ? '继续' : '让后台继续', () => app.act(() => app.transport.resume(t)));
  if (acts.includes('reopen')) return button('重新开一轮', () => app.act(() => app.transport.resume(t, { reopen: true })));
  if (k === 'engineer_blocked') return copyButton(`复制：接管 ${t.ref}`, `接管 ${t.ref}`, app.copy);
  return null;
}

// 需要你的卡（和任务页的交互卡）用的动词按钮：点了开对应的弹层（选方案 / 敏感批准 / 真机测试）。
// 远端设备上的登记动作：开了手机批准、动作允许远端批时写「面容 ID 批准」；别的只能看和拒绝（弹层里写明为什么）
export function verbButton(app, t, { page = false } = {}) {
  const k = F.needCardKind(t);
  if (!k.type) {
    const fa = firstAction(app, t);
    return fa || button('打开', () => app.nav(F.hashOfTask(t.ref)), { primary: true });
  }
  let verb = page ? k.pageVerb : k.verb;
  if (k.type === 'approval' && !app.local) {
    const ra = t.decision?.handler === 'action' ? t.decision.action : null;
    const phoneOk = !!ra && ra.remote && app.transport.capabilities?.passkey && passkeyState(app) === 'active';
    verb = phoneOk ? '面容 ID 批准' : '查看';
  }
  const act = latest(app.actions, (a) => a.kind === 'answer' && a.ref === t.ref);
  const sent = !!act && (act.state === 'sending' || act.state === 'waiting' || (act.state === 'done' && act.fp === t.decision?.fp));
  const b = button(sent ? '已送出' : verb, () => app.openOverlay?.(k.type, t.ref, b), {
    primary: true, disabled: sent, attrs: { 'data-ov': k.type, 'data-ov-ref': t.ref, 'aria-haspopup': 'dialog', 'aria-label': `${verb}：${F.taskName(t, { home: homeOf(app) })}` },
  });
  return b;
}

function needCard(app, t, wide) {
  const href = F.hashOfTask(t.ref);
  const name = F.taskName(t, { home: homeOf(app) });
  const k = F.needCardKind(t);
  const a = h('a', { class: ['task', `is-${t.state}`], attrs: { 'data-ref': t.ref } }, nameNode(name));
  a.href = href;
  a.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); app.nav(href); });
  const act = latest(app.actions, (x) => x.ref === t.ref && ['answer', 'resume', 'reclassify'].includes(x.kind));
  const note = k.type === 'approval' && !app.local && !/面容/.test(verbButton(app, t).textContent) ? '只能在 Mac 上批，这里可以拒绝' : null;
  return h('li', { class: ['need', 'task-item', 'core-needs_you', wide ? 'wide' : ''], attrs: { 'data-ref': t.ref, 'data-kind': k.type || 'open' } },
    h('div', { class: 'need-hd' }, h('span', { class: 'kind' }, h('span', { class: 'dot brass', attrs: { 'aria-hidden': 'true' } }), k.label), h('span', { class: 'tm', text: F.when(t.updatedAt) })),
    a,
    h('p', { class: 'need-what', text: F.needWhat(t) }),
    h('div', { class: 'need-act' }, note ? h('span', { class: 'note', text: note }) : null, verbButton(app, t)),
    act && act.kind !== 'answer' ? statusLine(act, { online: app.macOnline(), app }) : null);
}

function quickDetail(app, t, options, id) {
  const href = F.hashOfTask(t.ref);
  const pr = F.latestProgress(t);
  const upd = [t.updatedAt, pr?.at].filter((x) => x && Number.isFinite(Date.parse(x))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const need = t.state === 'done' ? (t.result?.zoe && String(t.result.zoe).trim() ? t.result.zoe : '不需要') : t.state === 'cancelled' ? '不需要' : F.needLine(t);
  const first = F.needsOwner(t) ? verbButton(app, t) : firstAction(app, t);
  const act = latest(app.actions, (a) => a.ref === t.ref && ['resume', 'reclassify'].includes(a.kind));
  const owner = F.ownerLine(t, options);
  const name = F.taskName(t, { home: homeOf(app) });
  return h('div', { class: 'quick', id, attrs: { role: 'region', 'aria-label': `快捷详情：${name}` } },
    rows([
      ['谁负责', owner.replace(/^现在：/, '')],
      ['下一步', F.nextLine(t)],
      ['需要你', need],
      ['最近更新', F.when(upd) || '没有记录'],
    ]),
    h('div', { class: 'action-row quick-actions' },
      button('打开', () => app.nav(href), { primary: !first, attrs: { 'aria-label': `打开 ${name}` } }),
      first),
    first && !F.needsOwner(t) ? statusLine(act, { online: app.macOnline(), app }) : null);
}

// 交付的三小段（代码 / 部署 / 验收）：和任务页三格同一个三态、同一个来源标记——有证据（on）/ 明确没有（空）/ 没有证据（half）；
// 读屏和悬停写“已完成（已核对）”“还没有（据汇报）”“没有证据”
function steps3(t) {
  const f = F.deliverFacts(t);
  const cls = (x) => (x.on === true ? 'on' : x.on === null ? 'half' : '');
  const say = (x, yes) => (x.on === null ? '没有证据' : `${x.on ? yes : '还没有'}（${x.src}）`);
  const label = `代码${say(f.code, '已完成')} · 部署${say(f.deploy, '已部署')} · 验收${say(f.real, '已验收')}`;
  const cell = (x) => h('i', { class: cls(x), attrs: x.src ? { 'data-src': x.src } : {} });
  return h('span', { class: 'steps3', attrs: { role: 'img', 'aria-label': label, title: label } }, cell(f.code), cell(f.deploy), cell(f.real));
}

function row(app, t, options) {
  const href = F.hashOfTask(t.ref);
  const core = F.coreState(t);
  const open = !!app.ui.quick?.has(t.ref);
  const qid = `quick-${slug(t.ref)}`;
  const name = F.taskName(t, { home: homeOf(app) });
  const a = h('a', { class: ['task', `is-${t.state}`], attrs: { 'data-ref': t.ref, 'aria-keyshortcuts': 'Space' } },
    nameNode(name),
    h('span', { class: 'task-meta' },
      h('span', { class: ['dot', `is-${core}`], attrs: { 'aria-hidden': 'true' } }),
      h('span', { class: ['core-tag', `is-${core}`], text: F.coreLabel(t) }),
      t.state === 'done' && !t.result?.missing ? steps3(t) : null,
      h('span', { class: 'lt', text: F.listLine(t, options) })));
  a.href = href;
  a.addEventListener('click', (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); app.nav(href); });
  // 空格：原地展开 / 收起快捷详情（回车照常打开任务）
  a.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Spacebar') { e.preventDefault(); toggleQuick(app, t.ref, 'row'); } });
  const tog = h('button', {
    type: 'button', class: ['quick-toggle', open ? 'is-open' : ''],
    attrs: { 'aria-expanded': open ? 'true' : 'false', 'aria-controls': qid, 'aria-label': `快捷详情：${name}`, 'data-quick': t.ref },
    on: { click: () => toggleQuick(app, t.ref, 'toggle') },
  }, icon('chev'));
  return h('li', { class: ['task-item', `core-${core}`, open ? 'is-open' : ''] },
    h('div', { class: 'task-row' }, a, h('span', { class: 'tm', text: F.when(t.updatedAt) }), tog),
    open ? quickDetail(app, t, options, qid) : null);
}

// 还没变成任务的输入：远端设备上自己刚送出的（outbox）、Mac 那边正在登记的（board.pending）
function pendingRows(app, view, outbox) {
  const online = app.macOnline();
  const mine = new Set();
  const out = [];
  const item = (want, meta, { failed = false, tools = null, attrs = {} } = {}) => h('li', { class: ['pending', 'task-item'], attrs },
    h('div', { class: ['task', 'is-pending', failed ? 'is-failed' : ''] }, h('span', { class: 'task-want', text: firstLine(want) }),
      h('span', { class: 'task-meta' }, h('span', { class: 'dot hollow', attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'lt', text: meta })), tools));
  for (const o of outbox || []) {
    mine.add(o.id);
    let meta;
    let tools = null;
    if (o.state === 'sending') meta = o.error ? `还没送出去，会自动重试（${o.error}）` : '正在送出…';
    else if (o.state === 'failed') {
      meta = `没送出去：${o.error || '原因不明'}`;
      tools = h('span', { class: 'row-tools' },
        button('再试一次', () => app.act(() => app.transport.retry(o.id)), { cls: 'btn-small' }),
        button('删掉', () => app.act(() => app.transport.discard(o.id)), { cls: 'btn-quiet btn-small' }));
    } else if (o.stage) meta = o.claimError ? `已领取 · 刚才出了点问题，后台会自动重试：${o.claimError}` : `已领取 · ${o.stage}`;
    else meta = app.local || online ? '已送出' : '已送出。Mac 现在不在线，上线后会领取。';
    out.push(item(o.want, meta, { failed: o.state === 'failed', tools, attrs: { 'data-client': o.id } }));
  }
  for (const p of view?.board?.pending || []) {
    if (!p || (p.clientId && mine.has(p.clientId)) || mine.has(p.id)) continue;
    out.push(item(p.want, p.error ? `已收到 · 刚才出了点问题，后台会自动重试：${p.error}` : `已收到 · ${p.stage || '正在处理'}`));
  }
  return out;
}

const title = (text, n, note = null) => h('h2', { class: 'group-title' }, text, n !== null ? h('span', { class: 'count', text: String(n) }) : null, note ? h('span', { class: 'r', text: note }) : null);

export function renderTaskList(app, view, ordered, outbox) {
  const options = view?.board?.options || null;
  const filter = app.ui.filter || null;
  const filtering = F.filterActive(filter);
  const out = [];
  const ul = (items, cls = '') => h('ul', { class: ['tasklist', cls] }, items.map((t) => row(app, t, options)));
  // 搜索或筛选一动：一份结果列表（需要你的也是行，快捷详情里有动词按钮）
  if (filtering) {
    const list = F.filterTasks(ordered, filter, { home: homeOf(app) });
    if (!list.length) {
      return [h('div', { class: 'empty-filter' }, h('p', { class: 'empty lead', text: '没有符合的任务。换个词，或者清掉筛选。' }),
        button('清除搜索和筛选', () => app.setFilter?.(null), { cls: 'btn-quiet' }))];
    }
    return [h('section', { class: 'group-sec result-sec', attrs: { 'aria-label': '结果' } }, title('结果', list.length), ul(list))];
  }
  const { needs, active, waiting, idle, done, unmet, cancelled } = F.groupTasks(ordered);
  const pend = pendingRows(app, view, outbox);
  if (pend.length) out.push(h('section', { class: 'group-sec pending-sec', attrs: { 'aria-label': '刚送出' } }, title('刚送出', pend.length), h('ul', { class: 'tasklist' }, pend)));
  // 需要你：卡片，桌面两列，奇数最后一张通栏（CSS 只在桌面上让 .wide 通栏）
  out.push(h('section', { class: 'group-sec is-needs', attrs: { 'aria-label': '需要你' } }, title('需要你', needs.length),
    needs.length ? h('ul', { class: 'needs needs-list' }, needs.map((t, i) => needCard(app, t, needs.length % 2 === 1 && i === needs.length - 1)))
      : h('p', { class: 'empty', text: '现在没有要你决定的事。' })));
  out.push(h('section', { class: 'group-sec active-sec', attrs: { 'aria-label': '正在执行' } }, title('正在执行', active.length),
    active.length ? ul(active) : h('p', { class: 'empty', text: '现在没有在执行的任务。' })));
  // hub#149：不在做的不放在“正在执行”下面。会自己往下走的（等条件）和后台不会自己接着做的（没人在做）放一组，每一条的第二行写着在等什么、要谁接手
  const stuck = [...waiting, ...idle];
  if (stuck.length) {
    out.push(h('section', { class: ['group-sec', 'waiting-sec', idle.length ? 'idle-sec' : ''], attrs: { 'aria-label': '等条件 · 没人在做' } },
      title('等条件 · 没人在做', stuck.length, '到了条件会自己接着做；没人在做的写着要谁接手'),
      ul(stuck)));
  }
  const ended = [...done, ...unmet];
  const shown = app.ui.doneAll ? ended : ended.slice(0, F.DONE_SHOWN);
  out.push(h('section', { class: ['group-sec', 'done-sec', unmet.length ? 'unmet-sec' : ''], attrs: { 'aria-label': '最近交付' } },
    title('最近交付', ended.length, '代码 · 部署 · 验收 三格分开记'),
    ended.length ? ul(shown) : h('p', { class: 'empty', text: '还没有交付的任务。' }),
    ended.length > F.DONE_SHOWN ? button(app.ui.doneAll ? '收起' : `显示全部 ${ended.length} 条`, () => { app.ui.doneAll = !app.ui.doneAll; app.render(); }, { cls: 'btn-quiet more' }) : null));
  // 已取消 / 按她的决定结束的：不算完成，折起来放在最后
  if (cancelled.length) {
    const d = h('details', { class: 'group-sec cancelled-sec' },
      h('summary', { class: 'group-title' }, '已取消 / 已结束', h('span', { class: 'count', text: String(cancelled.length) })),
      ul(cancelled));
    d.open = !!app.ui.cancelledOpen;
    d.addEventListener('toggle', () => { app.ui.cancelledOpen = d.open; });
    out.push(d);
  }
  if (!ordered.length && !pend.length) out.unshift(h('p', { class: 'empty lead', text: '还没有任务。在上面写一句你要什么，发送就行。' }));
  return out;
}

// 筛选芯片（带计数）：第一行按状态，第二行按机器和来源。再点一下取消（状态回到「全部」）。计数按搜索词和另一行的筛选算
export function renderFilterChips(app, ordered = app.ordered || []) {
  const f = app.ui.filter || {};
  const group = f.f || 'all';
  const base = F.filterTasks(ordered, { q: f.q, s: f.s, o: f.o }, { home: homeOf(app) });
  const chip = (label, on, next, key, n) => h('button', {
    type: 'button', class: ['chip-filter', on ? 'is-on' : ''],
    attrs: { 'aria-pressed': on ? 'true' : 'false', 'data-filter': key },
    on: { click: () => app.setFilter?.(next) },
  }, h('span', { text: label }), n !== null ? h('span', { class: 'k', text: String(n) }) : null);
  const count = (k) => (k === 'all' ? base.length : base.filter((t) => F.filterGroupHas(k, F.taskGroupKey(t))).length);
  return [
    h('div', { class: 'filter-row', attrs: { role: 'group', 'aria-label': '按状态筛选' } },
      F.FILTER_GROUPS.map(([k, label]) => chip(label, group === k || (k === 'waiting' && group === 'idle') || (k === 'unmet' && group === 'cancelled'), { ...f, f: k === 'all' || group === k ? null : k }, `f:${k}`, count(k)))),
    h('div', { class: 'filter-row', attrs: { role: 'group', 'aria-label': '按机器和来源筛选' } },
      F.FILTER_SITES.map(([k, label]) => chip(label, f.s === k, { ...f, s: f.s === k ? null : k }, `s:${k}`, null)),
      F.FILTER_SOURCES.map(([k, label]) => chip(label, f.o === k, { ...f, o: f.o === k ? null : k }, `o:${k}`, null))),
  ];
}
