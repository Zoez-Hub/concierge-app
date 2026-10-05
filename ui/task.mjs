// 任务页（docs/UI.md §4），从上到下：
//   0 等她决定的卡片（有才显示，在最上面，和首页「等你决定」同一张）
//   1 她说的话和额外要求、来源  2 状态块（正在处理 / 暂停 / 完成 / 已取消）+ 上一轮没做到的汇报  3 执行方案  4 谁做了什么
//   5 本次执行资源  6 工程详情（默认折叠）  7 现在能做的动作（不能做的不显示）  8 GPT Web 协调者（桥开着时）
// Issue、PR、分支这些词只出现在第 6 段。
import { h, link } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { rows, section, button, statusLine, latest, copyButton } from './common.mjs';
import { decisionCard } from './decision.mjs';

export { decisionCard };

const said = (s) => (s && String(s).trim() ? String(s) : '没写');

// 页面自己会更新（不用她刷新）：写明最近一次读到状态是什么时候
function freshText(app) {
  const at = app.local ? app.transport.status().lastOk : app.view?.board?.at;
  const w = at ? F.when(typeof at === 'number' ? new Date(at).toISOString() : at) : '';
  return w ? `自动更新 · ${w}` : '自动更新';
}

function head(app, t) {
  return h('div', { class: 'tp-head' },
    button('‹ 任务', () => app.back(), { cls: 'btn-quiet back', attrs: { 'aria-label': '返回任务列表' } }),
    h('span', { class: 'tp-meta' }, h('span', { class: 'tp-fresh', text: freshText(app) }), h('span', { class: 'tp-ref', text: t ? t.ref : '' })));
}

function saidBlock(t) {
  return h('section', { class: 'block said' },
    h('h2', { class: 'tp-want', text: said(t.want || t.title) }),
    t.extra ? h('p', { class: 'tp-extra' }, h('span', { class: 'label', text: '额外要求' }), h('span', { text: t.extra })) : null,
    h('p', { class: 'tp-source', text: F.sourceLine(t) }),
    F.truncatedNote(t) ? h('p', { class: 'note', text: F.truncatedNote(t) }) : null);
}

// 状态块：每一栏都按视图里的真实字段写（format.mjs 的 statusTitle / executorText / targetEnv / needLine / windowsRows）
function workingBlock(app, t, options) {
  const n = t.now || {};
  const b = t.bill;
  const spent = [b ? `${b.sessions} 次会话` : null, F.since(t.createdAt) ? `提交后 ${F.since(t.createdAt)}` : null].filter(Boolean).join(' · ');
  const subs = (t.provenance?.subagents || []).reduce((a, x) => a + (Number(x.n) || 0), 0);
  const cons = (t.provenance?.consults || []).reduce((a, x) => a + (Number(x.n) || 0), 0);
  const paused = t.state === 'paused';
  // 最近更新：任务本身的更新时间和最新一句进展，取晚的那个
  const pr = F.latestProgress(t);
  const upd = [t.updatedAt, pr?.at].filter((x) => x && Number.isFinite(Date.parse(x))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const list = [
    ['当前执行者', F.executorText(t, options)],
    ['目标环境', F.targetEnv(t)],
    ...F.windowsRows(t),
    paused ? ['暂停原因', F.pausedReason(t)] : ['当前阶段', n.phase || t.stateText],
    ...(paused && t.life?.state === 'wait' && F.when(t.life.until) ? [['预计恢复', `${F.when(t.life.until)} 前后自动接着做`]] : []),
    ...(F.attemptText(t) ? [['轮次', F.attemptText(t)]] : []),
    ['最近更新', F.when(upd) || '没有记录'],
    ['需要你', F.needLine(t)],
    ['已用资源', [spent || '还没有用量记录', subs ? `子代理 ${subs} 个` : null, cons ? `咨询 ${cons} 次` : null].filter(Boolean).join(' · ')],
  ];
  return h('section', { class: ['block', 'status-block', `is-${t.state}`] }, h('h3', { class: 'block-title', text: F.statusTitle(t) }), rows(list), progressList(t));
}

// 最近进展：会话自己写的几句人话（最新的在前），页面自己会更新，不用她刷新。没有原始日志、没有工具名
function progressList(t) {
  const items = F.progressItems(t);
  if (!items.length) return null;
  return h('div', { class: 'progress' }, h('h4', { class: 'sub-title', text: '最近进展' }),
    h('ol', { class: 'progress-list' }, items.map((x) => h('li', {},
      h('span', { class: 'progress-at', text: x.at }),
      h('span', { class: 'progress-text', text: x.who ? `${x.text}（${x.who}）` : x.text })))));
}

// 最终汇报：短的整段显示；长的先显示前一段，“展开完整结果”在原地展开（再点“收起”）。完整内容就在这里，不用去别处看
function reportNode(app, key, report) {
  const pv = F.reportPreview(report);
  if (!pv.long) return h('p', { class: 'report', text: report });
  const open = () => !!app.ui.reportOpen?.has(key);
  const p = h('p', { class: 'report', text: open() ? report : pv.text });
  const btn = button(open() ? '收起' : '展开完整结果', () => {
    if (!app.ui.reportOpen) app.ui.reportOpen = new Set();
    if (open()) app.ui.reportOpen.delete(key); else app.ui.reportOpen.add(key);
    p.textContent = open() ? report : pv.text;
    btn.textContent = open() ? '收起' : '展开完整结果';
    btn.setAttribute('aria-expanded', open() ? 'true' : 'false');
  }, { cls: 'btn-quiet report-toggle', attrs: { 'aria-expanded': open() ? 'true' : 'false' } });
  return h('div', { class: 'report-box' }, p, btn);
}

// 上一轮的汇报（还没做到）：任务还在做，上一轮的结论折起来放，点开能读完
function lastResultBlock(app, t) {
  const r = t.lastResult;
  if (!r || !(r.report || r.remaining)) return null;
  const list = [
    ['做到没有', F.goalLine(r) || '没做到'],
    ...(r.needs && F.NEEDS_TEXT[r.needs] ? [['接下来', F.NEEDS_TEXT[r.needs]]] : []),
    ...(r.next ? [['下一步', r.next]] : []),
  ];
  const d = h('details', { class: 'block last-result' },
    h('summary', { text: `上一轮的汇报（还没做到）${F.when(r.at) ? ` · ${F.when(r.at)}` : ''}` }),
    h('div', { class: 'last-result-body' }, rows(list), r.report ? h('p', { class: 'report', text: r.report }) : null));
  // 页面每分钟会重画一次：她点开的保持点开
  d.open = !!app.ui.reportOpen?.has(`${t.ref}|last`);
  d.addEventListener('toggle', () => {
    if (!app.ui.reportOpen) app.ui.reportOpen = new Set();
    if (d.open) app.ui.reportOpen.add(`${t.ref}|last`); else app.ui.reportOpen.delete(`${t.ref}|last`);
  });
  return d;
}

// 执行方案：分诊之后定下来的（模型、档位、子代理、咨询谁几次、为什么）；还没定的照实说
function planBlock(t, options) {
  const list = F.planRows(t, options);
  if (list.length) return section('执行方案', rows(list));
  if (t.state === 'queued') return section('执行方案', h('p', { class: 'note', text: '还没定：Concierge 还在分诊。' }));
  return null;
}

// 完成：先是会话的最终汇报（它自己组织的话，原样显示），再是“原来的要求做到没有”“要你做的”两行，
// 然后才是过程记录（五项）。旧结果没有最终汇报：照旧只有五项
function resultBlock(app, t) {
  const r = t.result;
  if (!r || r.missing) return section('完成', h('p', { text: '已经结束，但没有留下结果说明。' }));
  const record = rows([
    ['做了什么', said(r.did)],
    ['怎么验证的', said(r.verified)],
    ['部署了吗', said(r.deployed)],
    ['真实环境验证了吗', said(r.realworld)],
    ['还有什么遗留', said(r.gaps)],
  ]);
  if (!r.report) return section('完成', record);
  // 做完 = 原来要的做到了；只有她手动关掉的才可能是“部分 / 否”
  const met = r.goalMet !== '部分' && r.goalMet !== '否';
  return [
    h('section', { class: ['block', 'result', met ? 'is-met' : 'is-unmet'] },
      h('h3', { class: 'block-title', text: F.statusTitle(t) }),
      reportNode(app, `${t.ref}|result`, r.report),
      rows([['原来的要求', F.goalLine(r)], ['要你做的', said(r.zoe)]])),
    section('过程记录', record),
  ];
}

// 已取消 / 按她的决定结束：不算完成。有汇报的照样能读完
function cancelledBlock(app, t) {
  const r = t.result;
  return h('section', { class: ['block', 'result', 'is-cancelled'] },
    h('h3', { class: 'block-title', text: F.statusTitle(t) }),
    t.stateText && t.stateText !== F.statusTitle(t) ? h('p', { text: t.stateText }) : null,
    r && r.report ? reportNode(app, `${t.ref}|result`, r.report) : null,
    r && !r.missing && (r.goalMet || r.zoe) ? rows([['原来的要求', F.goalLine(r) || '没做到'], ['要你做的', said(r.zoe)]]) : null);
}

function engineering(t) {
  const e = t.engineering || {};
  const list = [];
  if (e.issueUrl) list.push(['Issue', link(e.issueUrl, e.issueUrl.replace('https://github.com/', ''))]);
  for (const p of e.prs || []) list.push([p.own ? 'PR（这件事的改动）' : 'PR（提到它的）', h('span', {}, link(p.url, String(p.url || '').replace('https://github.com/', '')), ` · ${p.state === 'MERGED' ? '已合并' : p.state === 'OPEN' ? '还没合并' : p.state === 'CLOSED' ? '已关闭、没合并' : (p.state || '状态不明')}`)]);
  if (e.branch) list.push(['分支', `${e.branch}${e.base ? `（从 ${e.base}）` : ''}`]);
  if (e.repo) list.push(['代码仓库', e.repo]);
  for (const ev of e.evidence || []) list.push([ev.kind === 'result' ? '结果评论' : ev.kind === 'decision' ? '决定评论' : '证据', link(ev.url, String(ev.url || '').replace('https://github.com/', ''))]);
  // 小动工：每份施工单的分支、草稿 PR、提交、git / gh 的原始报错
  for (const w of e.smallWork || []) {
    const k = `小动工 ${w.k}`;
    if (w.branch) list.push([`${k} · 分支`, `${w.branch}${w.base ? `（从 ${w.base}）` : ''}`]);
    if (w.pr) list.push([`${k} · 草稿 PR`, link(w.pr, String(w.pr).replace('https://github.com/', ''))]);
    if (w.commit) list.push([`${k} · 提交`, String(w.commit).slice(0, 12)]);
    if (w.detail) list.push([`${k} · 原始报错`, w.detail]);
    if (!w.branch && !w.pr && !w.commit && !w.detail) list.push([k, '还没有工程记录']);
  }
  const body = list.length
    ? h('dl', { class: 'rows' }, list.map(([k, v]) => h('div', { class: 'row' }, h('dt', { text: k }), h('dd', {}, v))))
    : h('p', { class: 'note', text: '没有工程记录。' });
  return h('details', { class: 'block eng' }, h('summary', { text: '工程详情' }), body);
}

function actionsBlock(app, t) {
  const acts = t.actions || [];
  const items = [];
  if (acts.includes('resume')) {
    const label = t.state === 'queued' && t.plan?.consult?.async ? '不等了，直接做' : t.state === 'paused' ? '继续' : '让后台继续';
    items.push(button(label, () => app.act(() => app.transport.resume(t)), { primary: t.state === 'paused' }));
  }
  if ((t.state === 'stalled' || t.state === 'handed_off') && /接管/.test(t.stateText || '')) items.push(copyButton(`复制：接管 ${t.ref}`, `接管 ${t.ref}`, app.copy));
  // 取消这个任务：点一次变成“确认取消”，再点才送出。取消不算完成
  if (acts.includes('cancel') && app.transport.cancel) {
    const ca = latest(app.actions, (a) => a.kind === 'cancel' && a.ref === t.ref);
    const sent = !!ca && (ca.state === 'sending' || ca.state === 'waiting' || ca.state === 'done');
    let sure = false;
    const cancel = button('取消这个任务', () => {
      if (!sure) { sure = true; cancel.textContent = '确认取消'; cancel.setAttribute('aria-label', '再点一次确认取消这个任务'); return; }
      cancel.disabled = true;
      app.act(() => app.transport.cancel(t, { text: '' }));
    }, { cls: 'btn-danger', disabled: sent });
    items.push(cancel);
  }
  if (!items.length) return null;
  const act = latest(app.actions, (a) => (a.kind === 'resume' || a.kind === 'cancel') && a.ref === t.ref);
  return h('section', { class: 'block actions' }, h('h3', { class: 'block-title', text: '现在能做的' }), h('div', { class: 'action-row' }, items),
    statusLine(act, { online: app.macOnline(), app }));
}

// GPT Web 协调者（ChatGPT 网页端，经 Engineering Bridge）和这个任务：能观测到的连接证据、它和这个任务的关系、请它看一眼。
// 和本机 Codex 的咨询是两回事。没有连接证据时不给“请它看一眼”，只写事实
function coordinatorBlock(app, t) {
  if (!(t.actions || []).includes('consult')) return null;
  const coord = F.coordinatorStatus((app.view?.board?.options?.consult || []).find((x) => x.async));
  const items = [];
  if (coord.connected) {
    const open = app.ui.consultOpen === t.ref;
    items.push(button('请 GPT Web 协调者看一眼', () => { app.ui.consultOpen = open ? null : t.ref; app.render(); }, { attrs: { 'aria-expanded': open ? 'true' : 'false' } }));
    if (t.state !== 'done') items.push(copyButton(`复制：看 ${t.ref}`, `看 ${t.ref}`, app.copy));
  }
  const form = coord.connected && app.ui.consultOpen === t.ref ? consultForm(app, t, coord) : null;
  const act = latest(app.actions, (a) => a.kind === 'consult' && a.ref === t.ref);
  return h('section', { class: 'block coord' }, h('h3', { class: 'block-title', text: 'GPT Web 协调者' }),
    rows([['连接', coord.text], ['这个任务', F.coordinatorParticipation(t)]]),
    h('p', { class: 'note', text: coord.connected
      ? '只有连着 Engineering Bridge 的那个 ChatGPT 对话读得到这个任务，普通的 ChatGPT 对话读不到。本机 Codex 的咨询是另一回事，不经过它。'
      : '没有连接证据，所以这里先不提供“请它看一眼”：请求记下了也没人看。要用的话先让 Mac 上的隧道跑起来、在 ChatGPT 里连上 Engineering Bridge。本机 Codex 的咨询不受影响。' }),
    items.length ? h('div', { class: 'action-row' }, items) : null, form,
    statusLine(act, { online: app.macOnline(), app }),
    act && act.state !== 'failed' ? h('p', { class: 'note', text: `到连着 Engineering Bridge 的那个 ChatGPT 对话里说一句：看 ${t.ref}` }) : null);
}

function consultForm(app, t, coord) {
  const o = app.view?.board?.options || {};
  const note = F.smallWorkNote(o.smallWork);
  const q = h('textarea', { id: 'consult-q', rows: 2, value: app.ui.consultDraft || '', placeholder: '想让它看什么（可以不写）', attrs: { 'aria-label': '想让 GPT Web 协调者看什么' } });
  q.addEventListener('input', () => { app.ui.consultDraft = q.value; });
  const box = h('input', { type: 'checkbox', id: 'consult-sw', disabled: !note.available, checked: note.available && !!app.ui.consultSw, attrs: { role: 'switch' } });
  box.addEventListener('change', () => { app.ui.consultSw = box.checked; });
  return h('div', { class: 'consult-form' },
    h('p', { class: 'note', attrs: { id: 'consult-coord' }, text: `请求会记下。Concierge 叫不醒它：你在那个 ChatGPT 对话里说“看 ${t.ref}”，它才会去看。` }),
    q,
    h('label', { class: ['toggle-row', note.available ? '' : 'is-disabled'], htmlFor: 'consult-sw' }, box,
      h('span', { class: 'choice-text' }, h('span', { class: 'choice-name', text: '允许小动工（只对这一个任务）' }), h('span', { class: 'choice-sub', text: note.text }))),
    button('发出请求', () => {
      const question = q.value.trim(); const smallWork = note.available && box.checked;
      app.ui.consultOpen = null; app.ui.consultDraft = ''; app.ui.consultSw = false;
      return app.act(() => app.transport.consult(t, { question, smallWork }));
    }));
}

export function renderTaskPage(app, t) {
  if (!t) {
    return [head(app, null), h('section', { class: 'block' }, h('p', { text: app.view ? '没有找到这个任务。它可能已经不在最近 40 个里了。' : '正在读取…' }))];
  }
  const options = app.view?.board?.options || null;
  const bill = F.billRows(t);
  const ended = t.state === 'done' || t.state === 'cancelled';
  return [
    head(app, t),
    // 要她决定的放在最上面（她的原话上面），和首页「等你决定」同一张卡片
    t.state === 'needs_zoe' ? decisionCard(app, t, { where: 'page' }) : null,
    saidBlock(t),
    ...[t.state === 'needs_zoe' ? null : t.state === 'done' ? resultBlock(app, t) : t.state === 'cancelled' ? cancelledBlock(app, t) : workingBlock(app, t, options)].flat(),
    lastResultBlock(app, t),
    planBlock(t, options),
    section('谁做了什么', rows(F.provenanceRows(t, options))),
    section(ended ? '本次执行资源' : '到目前为止用的资源', bill ? rows(bill) : h('p', { class: 'note', text: '还没有用量记录。' })),
    engineering(t),
    actionsBlock(app, t),
    coordinatorBlock(app, t),
  ].filter(Boolean);
}
