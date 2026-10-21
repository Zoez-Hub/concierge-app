// 任务页（docs/V2.md §4，hub#165；设计整合按木木的 V2 设计稿 concierge/design/v2/），从上到下：
//   1 头：「#N · 短名」（21px）、一句话状态（谁在做 / 在哪 / 当前阶段；需要你的写要做什么；交付的写三格事实）、状态点行（状态词 · 更新 · 自动更新）
//     + 2×2 摘要格（谁在做 / 下一步 / 最新进展 / 需要你），1px 分割线栅格，手机单列
//   2 按六类核心状态（core）的第一块：要你 → 交互卡（动词按钮开弹层：选方案 / 敏感批准 / 真机测试，ui/decision.mjs）；旧卡 →「工程待接手（旧卡）」；
//     进行中 / 等待 / 没人在做 → 现在的事实（谁在做、在哪、Windows 那几行、当前阶段、轮次、已用资源 / 在等什么 / 为什么停了）；
//     完成 / 结束 → 交付三格（代码完成 / 部署 / 实际验收，验收入口在第三格）+ 最终汇报
//   3 现在能做的（继续 / 重新开一轮 / 让后台继续 / 复制接管）4 受限执行器（有才有）5 上一轮的汇报（折叠）
//   6 进展（最新在上、最多 4 条 + 更多；标题右侧「补一句 / 追加截图」）+ 补充记录
//   7 协作记录（一行一个角色：who + 证据小字）+ GPT Web 协调者一行（有连接证据才给“请它看一眼”）
//   8 三个折叠：你说的（含附件和缺失数）→ 执行方案与资源 → 工程详情   9 最底下一行：取消这个任务（点两次）
// Issue、PR、分支这些词只出现在工程详情里。
import { h, link } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { rows, button, statusLine, latest, copyButton } from './common.mjs';
import { decisionCard } from './decision.mjs';
import { attachState, attachIds, attachBusy, attachFailed, attachClear, renderAttach, attachPickers, syncAttach } from './attach.mjs';
import { icon } from './icons.mjs';
import { nameNode } from './tasks.mjs';

export { decisionCard };

const said = (s) => (s && String(s).trim() ? String(s) : '没写');
const sec = (title, ...right) => h('h2', { class: 'sec' }, title, right.length ? h('span', { class: 'r' }, ...right) : null);

// 页面自己会更新（不用她刷新）：写明最近一次读到状态是什么时候
function freshText(app) {
  const at = app.local ? app.transport.status().lastOk : app.view?.board?.at;
  const w = at ? F.when(typeof at === 'number' ? new Date(at).toISOString() : at) : '';
  return w ? `自动更新 · ${w}` : '自动更新';
}

// 状态卡（V2.md §4 + 设计稿的头和摘要格）：第一屏回答“这是哪件事、现在归谁、要不要我动手、接下来干什么”。
// 需要你：和列表、需要你卡同一个口径（format.mjs 的 needKind / needLine，hub#30 C03）。只有要她本人动手的写“要：……”（黄铜）
function summaryNeed(t) {
  if (t.state === 'done') return t.result?.zoe && String(t.result.zoe).trim() ? t.result.zoe : '不需要';
  if (t.state === 'cancelled') return '不需要';
  return F.needLine(t);
}
function summaryBlock(app, t, options) {
  const pr = F.latestProgress(t);
  const upd = [t.updatedAt, pr?.at].filter((x) => x && Number.isFinite(Date.parse(x))).sort((a, b) => Date.parse(b) - Date.parse(a))[0];
  const kind = F.needKind(t);
  const core = F.coreState(t);
  const ended = t.state === 'done' || t.state === 'cancelled';
  // 两台设备答同一张卡（反例 6）：卡片已经不在了（任务往下走了），在这里说清楚她那一下为什么没算
  const ans = latest(app.actions, (a) => a.kind === 'answer' && a.ref === t.ref);
  const echo = t.state !== 'needs_zoe' ? F.answerEcho(t, ans, { local: app.local }) : null;
  const owner = F.ownerLine(t, options);
  const title = F.statusTitle(t);
  const cell = (k, v, { wide = false, cls = '' } = {}) => h('div', { class: ['cell', wide ? 'wide' : ''] }, h('span', { class: 'k', text: k }), h('span', { class: ['v', cls] }, v));
  return h('section', { class: ['summary', 'status-card', `is-${t.state}`, `core-${core}`, kind ? `need-${kind.replace(/_/g, '-')}` : ''], attrs: { 'data-need': kind || 'none', 'data-core': core } },
    h('div', { class: 'thead' },
      h('h1', { class: 'tp-name' }, nameNode(F.taskName(t, { home: app.view?.board?.home || null, max: 60 }), 'tp-name-text')),
      h('p', { class: 'tp-headline', text: F.headline(t, options) }),
      h('p', { class: 'tp-meta tp-tagline' },
        h('span', { class: 'pill' }, h('span', { class: ['dot', `is-${core}`], attrs: { 'aria-hidden': 'true' } }), h('span', { class: ['core-tag', `is-${core}`], text: F.coreLabel(t) })),
        title !== F.coreLabel(t) ? h('span', { class: 'tp-status', text: title }) : null,
        F.when(upd) ? h('span', { text: `更新 ${F.when(upd)}` }) : null,
        h('span', { class: 'tp-fresh', text: freshText(app) }))),
    h('div', { class: 'sgrid' },
      cell(ended ? '谁做的' : '谁在做', h('span', { class: 'tp-owner', text: owner.replace(/^(现在|谁做的)：/, '') })),
      cell('下一步', F.nextLine(t)),
      cell('最新进展', pr ? [F.clip(pr.text, 140), F.when(pr.at) ? h('span', { class: 't', text: F.when(pr.at) }) : null] : F.findingLine(t), { wide: true }),
      cell('需要你', summaryNeed(t), { wide: true, cls: F.needsOwner(t) ? 'brass' : '' })),
    echo ? h('p', { class: ['status', 'is-error', 'answer-echo'], attrs: { role: 'status' }, text: echo }) : null,
    F.truncatedNote(t) ? h('p', { class: 'note', text: F.truncatedNote(t) }) : null);
}

// 授权范围（hub#165 §15.3，摘要格下方、交互卡之前）：提交时的预检（每项：已预授权 / 到时要单独批）、已预授权（动作 · 范围 ·「撤销」点两次 / 已撤销）、
// 等你批准（提前申请的、还没批的：不急，任务还在做；「去批准」开审批弹层）、已按预授权执行的记录。什么都没有就不出这一块
function authorityBlock(app, t) {
  const a = F.authority(t);
  if (a.empty) return null;
  const out = [sec('授权范围')];
  if (a.preflight.length) {
    out.push(h('h3', { class: 'auth-h', text: '这件事可能需要（提交时预检）' }),
      h('ul', { class: 'auth-items', attrs: { 'data-k': 'preflight' } }, a.preflight.map((x) => h('li', { class: ['auth-item', `is-${x.status}`], attrs: { 'data-pf': x.runbook || x.kind || '' } },
        h('span', { class: 'auth-t', text: x.title }), h('span', { class: ['auth-tag', x.status === 'granted' ? 'is-ok' : ''], text: x.tag }),
        x.why ? h('span', { class: 'auth-why', text: x.why }) : null))));
  }
  if (a.preauth) {
    const p = a.preauth;
    const acts = t.actions || [];
    const act = latest(app.actions, (x) => x.kind === 'preauth-revoke' && x.ref === t.ref);
    let revoke = null;
    if (!p.revokedAt && acts.includes('preauth-revoke') && app.transport.preauthRevoke) {
      // 点两次：第一次“上膛”记在 app.ui 里（15 秒内有效），页面中途重画也不丢
      const arm = (app.ui.preauthArm ||= new Map());
      const armed = (arm.get(t.ref) || 0) > Date.now() - 15000;
      const sent = !!act && ['sending', 'waiting', 'done'].includes(act.state);
      revoke = button(sent ? '已送出' : armed ? '确认撤销' : '撤销', () => {
        if (!((arm.get(t.ref) || 0) > Date.now() - 15000)) { arm.set(t.ref, Date.now()); revoke.textContent = '确认撤销'; revoke.setAttribute('aria-label', '再点一次确认撤销这个任务的预授权'); return; }
        arm.delete(t.ref);
        revoke.disabled = true;
        app.act(() => app.transport.preauthRevoke(t));
      }, { cls: 'btn-quiet btn-small', disabled: sent, attrs: { 'data-k': 'preauth-revoke', 'aria-label': armed ? '再点一次确认撤销这个任务的预授权' : '撤销这个任务的预授权' } });
    }
    out.push(h('h3', { class: 'auth-h', text: '已预授权' }),
      h('ul', { class: 'auth-items', attrs: { 'data-k': 'preauth' } }, p.runbooks.map((r) => h('li', { class: ['auth-item', p.revokedAt ? 'is-revoked' : 'is-granted'], attrs: { 'data-rb': r.id } },
        h('span', { class: 'auth-t', text: r.title || r.id }),
        h('span', { class: ['auth-tag', p.revokedAt ? '' : 'is-ok'], text: p.revokedAt ? `已撤销${F.dayTime(p.revokedAt) ? ` · ${F.dayTime(p.revokedAt)}` : ''}` : '到时参数核对得上就直接执行，不再问你' })))),
      h('p', { class: 'note auth-scope', text: F.preauthScope(p) }),
      revoke ? h('div', { class: 'action-row' }, revoke, h('span', { class: 'note', text: '撤销之后，还没执行的回到普通审批（点两次）。' })) : null,
      act ? statusLine(act, { online: app.macOnline(), app }) : null);
  }
  if (a.waiting.length || a.expired.length) {
    const items = a.waiting.map((x) => {
      const inDecision = t.decision?.deferred === true;
      const can = inDecision || !!t.deferredDecision;
      let go = null;
      if (can && app.openOverlay) {
        go = button('去批准', () => app.openOverlay('approval', t.ref, go, { deferred: !inDecision }), { primary: true, cls: 'btn-small', attrs: { 'data-k': 'deferred-approve', 'aria-haspopup': 'dialog', 'aria-label': `去批准：${x.title}` } });
      }
      return h('li', { class: 'auth-item is-waiting', attrs: { 'data-act': x.id } },
        h('span', { class: 'auth-t', text: x.title }),
        h('span', { class: 'auth-tag', text: `不急，任务还在做${x.expiresAt && F.dayTime(x.expiresAt) ? ` · ${F.dayTime(x.expiresAt)} 前批有效` : ''}` }), go);
    });
    for (const x of a.expired) items.push(h('li', { class: 'auth-item is-expired', attrs: { 'data-act': x.id } }, h('span', { class: 'auth-t', text: x.title }), h('span', { class: 'auth-tag', text: '已过期，没有执行（要的话会重新申请）' })));
    out.push(h('h3', { class: 'auth-h', text: '等你批准（提前申请的）' }), h('ul', { class: 'auth-items', attrs: { 'data-k': 'waiting' } }, items));
  }
  if (a.ran.length) {
    out.push(h('h3', { class: 'auth-h', text: '已按预授权执行' }),
      h('ul', { class: 'auth-items', attrs: { 'data-k': 'ran' } }, a.ran.map((x) => h('li', { class: 'auth-item is-ran', attrs: { 'data-act': x.id || '' } },
        h('span', { class: 'auth-t', text: x.title || '一个动作' }), h('span', { class: 'auth-tag is-ok', text: [x.text, x.at && F.when(x.at)].filter(Boolean).join(' · ') || '已执行' })))));
  }
  return h('section', { class: ['block', 'authority'], attrs: { id: 'authority', 'aria-label': '授权范围' } }, ...out.filter(Boolean));
}

// 页面每分钟会重画一次：她点开的折叠块保持点开
function keepOpen(app, d, key) {
  d.open = !!app.ui.reportOpen?.has(key);
  d.addEventListener('toggle', () => {
    if (!app.ui.reportOpen) app.ui.reportOpen = new Set();
    if (d.open) app.ui.reportOpen.add(key); else app.ui.reportOpen.delete(key);
  });
}
const fold = (app, key, cls, title, ...kids) => {
  const d = h('details', { class: ['fold', cls] }, h('summary', {}, h('span', { text: title }), icon('chev')), h('div', { class: 'fold-body' }, ...kids));
  keepOpen(app, d, key);
  return d;
};

// 你说的（折叠）：原话、额外要求、提交时的附件和没传到 Mac 的个数、来源
function saidBlock(app, t) {
  const att = F.submitAttachLines(t);
  return fold(app, `${t.ref}|said`, 'said', '你说的',
    h('p', { class: 'tp-want', text: said(t.want || t.title) }),
    t.extra ? h('p', { class: 'tp-extra' }, h('span', { class: 'label', text: '额外要求' }), h('span', { text: t.extra })) : null,
    att.files.length ? h('p', { class: 'tp-attach' }, h('span', { class: 'label', text: `附件 ${att.files.length} 个` }), h('span', { text: att.files.join('；') })) : null,
    att.missing ? h('p', { class: ['tp-attach-missing', 'is-error'], attrs: { 'data-k': 'attach-missing' }, text: att.missing }) : null,
    h('p', { class: 'tp-source', text: F.sourceLine(t) }));
}

// 已用资源一行（进展、原因）
function spentText(t) {
  const b = t.bill;
  const spent = [b ? `${b.sessions} 次会话` : null, F.since(t.createdAt) ? `提交后 ${F.since(t.createdAt)}` : null].filter(Boolean).join(' · ');
  const subs = (t.provenance?.subagents || []).reduce((a, x) => a + (Number(x.n) || 0), 0);
  const cons = (t.provenance?.consults || []).reduce((a, x) => a + (Number(x.n) || 0), 0);
  return [spent || '还没有用量记录', subs ? `子代理 ${subs} 个` : null, cons ? `咨询 ${cons} 次` : null].filter(Boolean).join(' · ');
}
const attemptRows = (t) => (F.attemptText(t) ? [['轮次', F.attemptText(t)]] : []);
const facts = (cls, title, list) => h('section', { class: ['facts', 'status-block', ...cls] }, sec(title), rows(list));

// 进行中（core working）：谁在做 · 在哪 · 当前阶段 · 最新一句进展 · 第几轮（每一栏都按视图里的真实字段写）
function progressCard(t, options) {
  const n = t.now || {};
  return facts(['progress-card', `is-${t.state}`, 'core-working'], '现在', [
    ['谁在做', F.executorText(t, options)],
    ['在哪', F.targetEnv(t)],
    ...F.windowsRows(t),
    ['当前阶段', n.phase || t.stateText],
    ['最新进展', F.findingLine(t)],
    ...attemptRows(t),
    ['已用资源', spentText(t)],
  ]);
}

// 等待（core waiting）：在等什么 · 预计 · 会自己接着做（不用她动）
function waitText(t) {
  if (F.needKind(t) === 'awaiting_quota') {
    const p = t.plan?.wait;
    const pool = { claude: 'Claude 的', codex: 'GPT 的', gptweb: 'GPT Web 的' }[p?.pool] || '';
    return p ? `${pool}额度恢复` : '额度或条件恢复';
  }
  const w = F.windowsRun(t);
  if (w?.kind === 'none') return 'Windows · 未领取（等 Windows 上的接收器领取）';
  if (w?.kind === 'stale' || (t.state === 'paused' && /没有心跳/.test(t.stateText || ''))) return 'Windows · 超过 10 分钟没心跳（等那边恢复心跳）';
  return F.waitingFor(t).replace(/^在等\s*/, '');
}
function waitCard(t) {
  const until = t.life?.until || t.plan?.wait?.until || null;
  return facts(['wait-card', `is-${t.state}`, 'core-waiting'], '在等什么', [
    ['在等什么', waitText(t)],
    ...F.windowsRows(t),
    ...(until && F.when(until) ? [['预计恢复', `${F.when(until)} 前后自动接着做`]] : []),
    ['接下来', '等到了会自己接着做，不需要你动手'],
    ...(t.state === 'paused' ? [['暂停原因', F.pausedReason(t)]] : [['当前阶段', t.now?.phase || t.stateText]]),
    ...attemptRows(t),
  ]);
}

// 没人在做（core idle）：为什么停 · 怎么才会接着做 · 要不要你动手（工程待接手不要；停着等“继续”的点一下就行）
function reasonCard(t) {
  const k = F.needKind(t);
  const paused = t.state === 'paused';
  const why = F.launchReason(t) || (paused ? F.pausedReason(t) : F.blockedReason(t));
  return facts(['reason-card', `is-${t.state}`, 'core-idle'], '为什么停了', [
    [paused ? '暂停原因' : '原因', why],
    ['怎么才会接着做', F.nextLine(t)],
    ['要你动手吗', k === 'paused' ? '不用你修；要接着做，点下面的“继续”' : '不需要你动手（工程这边的事）'],
    ...F.windowsRows(t),
    ...attemptRows(t),
    ['已用资源', spentText(t)],
  ]);
}

// 受限执行器（hub#152）：最近一个登记动作到哪一步了、结果是什么。等批准的在上面的交互卡和弹层里，这里不重复
function actionBlock(t) {
  const a = t.action;
  if (!a || a.state === 'pending') return null;
  const via = a.approvedVia === 'device' ? '你在手机上批准的' : a.approvedVia === 'page' ? '你在 Mac 上批准的' : null;
  return h('section', { class: ['action-block', `is-${a.state}`], attrs: { 'data-action-state': a.state } },
    sec('受限执行器'),
    rows([
      ['动作', a.title || a.runbook],
      ['状态', a.stateText || a.state],
      ...(a.summary ? [['结果', a.summary]] : []),
      ...(a.owner ? [['要你做的', a.owner]] : []),
      ['在哪执行', a.site === 'windows' ? 'Windows' : 'Mac'],
      ...(via ? [['批准', via]] : []),
      ...(a.rollbackOf ? [['说明', '这是一次回滚']] : []),
    ]));
}

// 进展：会话自己写的几句人话（最新在上、最多 4 条 +「更多」），页面自己会更新。没有原始日志、没有工具名。
// 标题右侧是「补一句 / 追加截图」（任务没结束时）
const PROGRESS_SHOWN = 4;
function progressSection(app, t) {
  const items = F.progressItems(t);
  const acts = t.actions || [];
  const canAmend = acts.includes('amend') && app.transport.amend;
  const st = canAmend ? amendState(app, t.ref) : null;
  const rerender = () => { app.ui.amendTick = (app.ui.amendTick || 0) + 1; app.render(); };
  const toggle = canAmend ? button(st.open ? '收起补充' : '补一句 / 追加截图', () => { st.open = !st.open; rerender(); if (st.open) globalThis.document?.getElementById?.('amend-text')?.focus(); },
    { cls: 'btn-quiet btn-small amend-toggle', attrs: { 'aria-expanded': st.open ? 'true' : 'false', 'aria-controls': 'amend-form' } }) : null;
  if (!items.length && !canAmend) return null;
  const all = !!app.ui.progressAll?.has(t.ref);
  const shown = all ? items : items.slice(0, PROGRESS_SHOWN);
  const more = items.length > PROGRESS_SHOWN ? button(all ? '收起' : `更多（还有 ${items.length - PROGRESS_SHOWN} 条）`, () => {
    if (!app.ui.progressAll) app.ui.progressAll = new Set();
    if (all) app.ui.progressAll.delete(t.ref); else app.ui.progressAll.add(t.ref);
    rerender();
  }, { cls: 'btn-quiet btn-small more' }) : null;
  const act = canAmend ? latest(app.actions, (a) => a.kind === 'amend' && a.ref === t.ref) : null;
  return h('section', { class: 'progress progress-sec' },
    sec('进展', h('span', { text: items.length ? '最新在上' : '' }), toggle),
    items.length ? h('ol', { class: 'timeline progress-list' }, shown.map((x) => h('li', {},
      h('span', { class: 'progress-at', text: x.at }),
      h('span', { class: 'progress-text', text: x.who ? `${x.text}（${x.who}）` : x.text })))) : h('p', { class: 'empty', text: '还没有进展记录。' }),
    more,
    canAmend && st.open ? amendForm(app, t) : null,
    canAmend && !st.open ? statusLine(act, { online: app.macOnline(), app }) : null);
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
  }, { cls: 'btn-quiet btn-small report-toggle', attrs: { 'aria-expanded': open() ? 'true' : 'false' } });
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
  return h('div', { class: 'folds' }, fold(app, `${t.ref}|last`, 'last-result', `上一轮的汇报（还没做到）${F.when(r.at) ? ` · ${F.when(r.at)}` : ''}`,
    h('div', { class: 'last-result-body' }, rows(list), r.report ? h('p', { class: 'report', text: r.report }) : null)));
}

// 执行方案：分诊之后定下来的（模型、档位、子代理、咨询谁几次、为什么）；还没定的照实说
function planBlock(t, options) {
  const list = F.planRows(t, options);
  if (list.length) return h('div', { class: 'sub-block plan' }, h('h3', { text: '执行方案' }), rows(list));
  if (t.state === 'queued') return h('div', { class: 'sub-block plan' }, h('h3', { text: '执行方案' }), h('p', { class: 'note', text: '还没定：Concierge 还在分诊。' }));
  return null;
}

// 交付三格：代码完成 / 部署 / 实际验收，各一个圆标（绿勾 / 空圈）+ 一句事实（format.mjs 的 deliverFacts，复审 F4）：
// true / false 只来自结构化证据（这件事的 PR 合并了没有、她的验收，标“已核对”）或 done 的规范答法整串「是 / 否」（标“据汇报”）；
// 别的自由文本一律空圈 +「会话汇报：原文」。验收入口在第三格
function deliverBlock(app, t) {
  const f = F.deliverFacts(t);
  const acts = t.actions || [];
  const accept = acts.includes('accept') && app.transport.accept ? acceptBlock(app, t) : null;
  const cellOf = (k, x, extra = null) => h('div', { class: ['st', x.on === true ? 'on' : ''], attrs: { 'data-k': `deliver:${k}`, 'data-state': x.on === true ? 'yes' : x.on === false ? 'no' : 'unknown', ...(x.src ? { 'data-src': x.src } : {}) } },
    h('span', { class: 'st-h' }, h('span', { class: 'mk', attrs: { 'aria-hidden': 'true' } }, x.on === true ? icon('check') : null), k),
    h('span', { class: 'st-v', text: x.text }), extra);
  return h('section', { class: ['deliver-sec', 'deliver-block'] }, sec('交付'),
    h('div', { class: 'deliver' }, cellOf('代码完成', f.code), cellOf('部署', f.deploy), cellOf('实际验收', f.real, accept)));
}

// 完成：先是会话的最终汇报（它自己组织的话，原样显示），再是“原来的要求做到没有”“要你做的”“验收”，
// 然后才是过程记录（五项，放进「执行方案与资源」折叠）。旧结果没有最终汇报：照旧只有五项
function resultBlock(app, t) {
  const r = t.result;
  const card = (title, ...kids) => h('section', { class: ['result', 'is-met'] }, sec(title), h('div', { class: 'report-card' }, ...kids));
  if (!r || r.missing) return card('完成', h('p', { text: '已经结束，但没有留下结果说明。' }), acceptRow(t));
  if (!r.report) return card('完成', recordRows(t), acceptRow(t));
  // 做完 = 原来要的做到了；只有她手动关掉的才可能是“部分 / 否”
  const met = r.goalMet !== '部分' && r.goalMet !== '否';
  return h('section', { class: ['result', met ? 'is-met' : 'is-unmet'] },
    sec(met ? '最终汇报' : F.statusTitle(t)),
    h('div', { class: 'report-card' }, reportNode(app, `${t.ref}|result`, r.report),
      rows([['原来的要求', F.goalLine(r)], ['要你做的', said(r.zoe)], ...acceptRows(t)])));
}
const recordRows = (t) => {
  const r = t.result || {};
  return rows([
    ['做了什么', said(r.did)],
    ['怎么验证的', said(r.verified)],
    ['部署了吗', said(r.deployed)],
    ['真实环境验证了吗', said(r.realworld)],
    ['还有什么遗留', said(r.gaps)],
  ], 'record');
};

// 已取消 / 按她的决定结束：不算完成。有汇报的照样能读完
function cancelledBlock(app, t) {
  const r = t.result;
  const acts = t.actions || [];
  const accept = acts.includes('accept') && app.transport.accept && !(r && !r.missing) ? acceptBlock(app, t) : null;
  return h('section', { class: ['result', 'is-cancelled'] },
    sec(F.statusTitle(t)),
    h('div', { class: 'report-card' },
      t.stateText && t.stateText !== F.statusTitle(t) ? h('p', { text: t.stateText }) : null,
      r && r.report ? reportNode(app, `${t.ref}|result`, r.report) : null,
      r && !r.missing && (r.goalMet || r.zoe) ? rows([['原来的要求', F.goalLine(r) || '没做到'], ['要你做的', said(r.zoe)], ...acceptRows(t)]) : acceptRow(t),
      accept));
}

// 验收了没有（V2.md §8.2）：旧视图没有 acceptance 这一项就不写
const acceptRows = (t) => (t && 'acceptance' in t ? [['验收', F.acceptLine(t) || '还没验收']] : []);
const acceptRow = (t) => (acceptRows(t).length ? rows(acceptRows(t)) : null);

function engineering(t) {
  const e = t.engineering || {};
  const list = [];
  if (e.issueUrl) list.push(['Issue', link(e.issueUrl, e.issueUrl.replace('https://github.com/', ''))]);
  for (const p of e.prs || []) list.push([p.own ? 'PR（这件事的改动）' : 'PR（提到它的）', h('span', {}, link(p.url, String(p.url || '').replace('https://github.com/', '')), ` · ${p.state === 'MERGED' ? '已合并' : p.state === 'OPEN' ? '还没合并' : p.state === 'CLOSED' ? '已关闭、没合并' : (p.state || '状态不明')}`)]);
  if (e.branch) list.push(['分支', `${e.branch}${e.base ? `（从 ${e.base}）` : ''}`]);
  if (e.repo) list.push(['代码仓库', e.repo]);
  for (const ev of e.evidence || []) list.push([ev.kind === 'result' ? '结果评论' : ev.kind === 'decision' ? '决定记录' : '证据', link(ev.url, String(ev.url || '').replace('https://github.com/', ''))]);
  // 小动工：每份施工单的分支、草稿 PR、提交、git / gh 的原始报错
  for (const w of e.smallWork || []) {
    const k = `小动工 ${w.k}`;
    if (w.branch) list.push([`${k} · 分支`, `${w.branch}${w.base ? `（从 ${w.base}）` : ''}`]);
    if (w.pr) list.push([`${k} · 草稿 PR`, link(w.pr, String(w.pr).replace('https://github.com/', ''))]);
    if (w.commit) list.push([`${k} · 提交`, String(w.commit).slice(0, 12)]);
    if (w.detail) list.push([`${k} · 原始报错`, w.detail]);
    if (!w.branch && !w.pr && !w.commit && !w.detail) list.push([k, '还没有工程记录']);
  }
  return list.length
    ? h('dl', { class: 'rows' }, list.map(([k, v]) => h('div', { class: 'row' }, h('dt', { text: k }), h('dd', {}, v))))
    : h('p', { class: 'note', text: '没有工程记录。' });
}

// 没人在做时“现在能做的”上面那一句（hub#143 复核、hub#149）：照实写没人在做、后台不会自己接着做、怎么才会接着做。
// 系统里没有能自动接手工程待接手这类事的工程执行队列（hub#149 核对过）：不写“工程这边会接手”
export function needNote(t) {
  const k = F.needKind(t);
  if (k === 'engineer_blocked') {
    const same = t.life?.engineer === 'same-site' ? '点“继续”只会再开一轮同样受限的后台会话，解决不了这里的限制。' : '';
    return `工程待接手：现在没有工程执行者在做这件事，后台也不会自己接着做（还没有能自动接手这类事的工程执行队列）。要推进，需要在有人值守的工程窗口说“接管”。${same}工程这边的事（装机、改配置、写 GitHub、合并部署）不用你自己动手。`;
  }
  if (k === 'paused') return '现在没人在做，后台不会自己接着做。不用你动手修；要接着做，点“继续”让后台再开一轮，或者复制“接管”到工程窗口。';
  return null;
}

// 现在能做的：继续 / 让后台继续 / 不等了直接做 / 复制接管 / 重新开一轮（取消在页面最底下一行，补一句在进展标题右侧，验收在交付第三格）
function actionsBlock(app, t) {
  const acts = t.actions || [];
  const items = [];
  const legacy = t.state === 'needs_zoe' && !!t.decision?.misfiled;
  if (acts.includes('resume')) {
    const label = t.state === 'queued' && t.plan?.consult?.async ? '不等了，直接做' : t.state === 'paused' ? '继续' : '让后台继续';
    // 工程待接手的暂停：“继续”只会再开一轮后台，不算要她做的事，不做成主按钮（hub#30 C03 / hub#149）
    items.push(button(label, () => app.act(() => app.transport.resume(t)), { primary: t.state === 'paused' && F.needKind(t) !== 'engineer_blocked' }));
  }
  // 工程这边的按钮（复制“接管”）：工程待接手（hub#149：现在唯一能接手的就是有人值守的工程窗口）、或者状态说明里说要接管的时候给。
  // 它不算要她做的事（hub#30 C03），只是方便她顺手转给工程窗口
  if (!legacy && (['engineer_blocked', 'paused'].includes(F.needKind(t)) || ((t.state === 'stalled' || t.state === 'handed_off') && /接管/.test(t.stateText || '')))) items.push(copyButton(`复制：接管 ${t.ref}`, `接管 ${t.ref}`, app.copy));
  // 重新开一轮（hub#165）：没做到 / 已取消的任务，同一个任务接着做（resume 带 reopen）
  if (acts.includes('reopen')) items.push(button('重新开一轮', () => app.act(() => app.transport.resume(t, { reopen: true })), { attrs: { 'data-k': 'reopen' } }));
  if (!items.length) return null;
  const act = latest(app.actions, (a) => a.kind === 'resume' && a.ref === t.ref);
  const engNote = !legacy && needNote(t) ? h('p', { class: 'note', text: needNote(t) }) : null;
  return h('section', { class: 'actions' }, sec('现在能做的'), engNote,
    h('div', { class: 'action-row' }, items),
    statusLine(act, { online: app.macOnline(), app }));
}

// 取消这个任务：页面最底下一行静音的危险按钮，点一次变成“确认取消”，再点才送出。取消不算完成（旧卡的取消在卡上）
function cancelRow(app, t) {
  const acts = t.actions || [];
  const legacy = t.state === 'needs_zoe' && !!t.decision?.misfiled;
  if (legacy || !acts.includes('cancel') || !app.transport.cancel) return null;
  const ca = latest(app.actions, (a) => a.kind === 'cancel' && a.ref === t.ref);
  const sent = !!ca && (ca.state === 'sending' || ca.state === 'waiting' || ca.state === 'done');
  let sure = false;
  const cancel = button('取消这个任务', () => {
    if (!sure) { sure = true; cancel.textContent = '确认取消'; cancel.setAttribute('aria-label', '再点一次确认取消这个任务'); return; }
    cancel.disabled = true;
    app.act(() => app.transport.cancel(t, { text: '' }));
  }, { cls: 'btn-quiet btn-danger', disabled: sent, attrs: { 'data-k': 'cancel' } });
  return h('div', { class: 'danger-row actions-cancel' }, cancel, statusLine(ca, { online: app.macOnline(), app }));
}

// 「补一句 / 追加截图」（V2.md §8.1，反例 5）：任务没结束时随时补充；正在跑的这一轮也读得到，下一轮提示词带上全部补充。
// 文字 ≤ 2000 字 + 附件（最多 4 个）。状态放在 app.ui.amend 里：页面每分钟重画一次也不丢
function amendState(app, ref) {
  if (!app.ui.amend) app.ui.amend = new Map();
  if (!app.ui.amend.has(ref)) app.ui.amend.set(ref, { open: false, text: '', att: attachState() });
  return app.ui.amend.get(ref);
}
function amendForm(app, t) {
  const st = amendState(app, t.ref);
  syncAttach(app, st.att);
  const act = latest(app.actions, (a) => a.kind === 'amend' && a.ref === t.ref);
  const ta = h('textarea', { id: 'amend-text', class: 'reply', rows: 3, maxLength: 2000, value: st.text, placeholder: '要补充或者修改的要求（正在做的这一轮也读得到）', attrs: { 'aria-describedby': 'amend-help' } });
  ta.addEventListener('input', () => { st.text = ta.value; });
  const err = h('p', { class: 'status is-error', attrs: { role: 'status', id: 'amend-error' } });
  const sendBtn = button('送出补充', async () => {
    syncAttach(app, st.att);
    const text = ta.value.trim();
    if (attachBusy(st.att)) { err.textContent = '附件还没传好，等一下再送。'; return; }
    if (attachFailed(st.att)) { err.textContent = '有附件没传上：删掉它，或者点「重传」。'; return; }
    const ids = attachIds(st.att);
    if (!text && !ids.length) { err.textContent = '先写一句，或者加一个附件。'; ta.focus(); return; }
    sendBtn.disabled = true;
    await app.act(async () => {
      const r = await app.transport.amend(t, { text, attachments: ids });
      if (r && r.state !== 'failed') { st.text = ''; attachClear(st.att); st.open = false; }
      return r;
    });
  }, { primary: true, attrs: { id: 'amend-send' } });
  // 附件那一块自己重画（不等整页重画：她正在文字框里打字时整页不重画，选了文件也要马上看到）
  const box = h('div', { class: 'attach', attrs: { role: 'group', 'aria-label': '补充的附件' } });
  const tools = h('div', { class: 'amend-bar tools' });
  st.attachEl = box;
  st.attachRedraw = () => {
    if (st.attachEl !== box) return;
    const doc = globalThis.document;
    const ae = doc?.activeElement;
    const focusKey = ae && (box.contains?.(ae) || tools.contains?.(ae)) ? ae.getAttribute('aria-label') || ae.id : null;
    box.replaceChildren(...renderAttach(app, st.att, { id: 'amend-attach', onChange: st.attachRedraw }).filter(Boolean));
    tools.replaceChildren(...attachPickers(app, st.att, { id: 'amend-attach', onChange: st.attachRedraw, labels: true }));
    if (focusKey && box.querySelectorAll) ([...box.querySelectorAll('button'), ...tools.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === focusKey || b.id === focusKey) || doc.getElementById('amend-attach-add'))?.focus();
  };
  st.attachRedraw();
  return h('div', { class: ['amend', 'amend-form'], attrs: { id: 'amend-form' } },
    h('label', { class: 'label', htmlFor: 'amend-text', text: '补充的话' }), ta,
    box, tools,
    h('p', { class: 'note', attrs: { id: 'amend-help' }, text: '补充会记在这个任务上，正在做的这一轮也读得到；下一轮会带上全部补充。图片只给工程看，这里不显示内容。' }),
    h('div', { class: 'action-row' }, sendBtn), err,
    statusLine(act, { online: app.macOnline(), app }));
}

// 远端附件的回执到了（app.actions 变了）：正开着的补充表单里的附件那一块自己重画（app.mjs 每次 render 都调）
export function refreshAmendAttach(app) {
  for (const st of app.ui.amend?.values?.() || []) {
    if (st.attachEl?.isConnected && syncAttach(app, st.att)) st.attachRedraw?.();
  }
}

// 验收（V2.md §8.2）：完成 / 结束了的任务（在交付第三格里）。通过 = 只记下；不通过要写一句，同一个任务重新开一轮。
// 发现问题（V2 验收反馈，Zoe 10-21）：没验收时是「不通过」，验收通过之后（几天、几周后也行）是「后来发现问题」。展开后写一句，两条路：
//   原来的问题没解决 / 又出现 → 同一个任务接着改（accept ok:false，走重新开一轮的闸门；验收历史留在记录里）；
//   另一个新问题 → 开后续任务：她的话放进工作台提交框，额外要求写明关联这个任务（原任务的验收、PR、部署记录不动），她加截图、确认提交
function acceptBlock(app, t) {
  if (!app.ui.accept) app.ui.accept = new Map();
  const st = app.ui.accept.get(t.ref) || { no: false, text: '' };
  app.ui.accept.set(t.ref, st);
  const act = latest(app.actions, (a) => a.kind === 'accept' && a.ref === t.ref);
  const busy = !!act && (act.state === 'sending' || act.state === 'waiting');
  const rerender = () => { app.ui.amendTick = (app.ui.amendTick || 0) + 1; app.render(); };
  const a = t.acceptance;
  const passed = a?.ok === true;
  // 交给 Windows 的任务：这里只能验收通过 / 开后续任务；同一个任务接着改要到 Mac 上的工程窗口接管（后台从 Mac 开不了 Windows 那边的新一轮）
  const win = t.reopenOnWindows === true;
  const parts = [h('h4', { class: 'sub-title', text: '验收' }),
    h('p', { class: 'note', text: a ? F.acceptLine(t) : win ? '看过结果之后，没问题就点「通过」。' : '看过结果之后点一个。不通过要写一句哪里不对：同一个任务会带着你的话重新开一轮。' })];
  if (win) parts.push(h('p', { class: 'note', attrs: { 'data-k': 'accept-windows' }, text: F.WINDOWS_ACCEPT_NO }));
  const row = [];
  if (!passed) row.push(button('通过', () => app.act(() => app.transport.accept(t, { ok: true, text: '' })), { primary: true, cls: 'btn-small', disabled: busy, attrs: { 'data-k': 'accept-ok' } }));
  // Windows 任务：同一个任务接着改要去 Mac 接管，这里只剩「开后续任务」，所以不叫「不通过」
  const openLabel = passed ? '后来发现问题' : win ? '发现别的问题' : '不通过';
  row.push(button(st.no ? '先不写了' : openLabel, () => { st.no = !st.no; rerender(); if (st.no) globalThis.document?.getElementById?.('accept-text')?.focus(); },
    { cls: st.no ? 'btn-quiet btn-small' : 'btn-small', disabled: busy, attrs: { 'aria-expanded': st.no ? 'true' : 'false', 'aria-controls': 'accept-no', 'data-k': 'accept-issue' } }));
  parts.push(h('div', { class: 'action-row' }, row));
  if (st.no) {
    const label = passed ? '发现了什么（写一句）' : '哪里不对（必须写一句）';
    const ta = h('textarea', { id: 'accept-text', class: 'reply', rows: 2, maxLength: 2000, value: st.text, placeholder: passed ? '比如：升级之后通知不响了' : '哪里不对（必须写一句）' });
    const err = h('p', { class: 'status is-error', attrs: { role: 'status' } });
    const same = win ? null : button(passed ? '原来的问题，接着改' : '不通过，重新开一轮', () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      st.no = false; st.text = '';
      app.act(() => app.transport.accept(t, { ok: false, text }));
    }, { cls: passed ? 'btn-small' : 'btn-danger btn-small', disabled: busy || !st.text.trim(), attrs: { id: 'accept-no-send', 'data-k': 'accept-same' } });
    const follow = button('新问题，开后续任务', () => {
      const text = ta.value.trim();
      if (!text) { ta.focus(); return; }
      if (!app.prefillCompose?.({ want: text, extra: F.followUpExtra(t, app.view?.board?.home || null) })) {
        err.textContent = '工作台的提交框里还有没提交的内容：先提交或清空它，再点这里。';
        return;
      }
      st.no = false; st.text = '';
      app.nav?.('#/');
    }, { cls: 'btn-small', disabled: busy || !st.text.trim(), attrs: { 'data-k': 'accept-follow' } });
    ta.addEventListener('input', () => { st.text = ta.value; const off = busy || !ta.value.trim(); if (same) same.disabled = off; follow.disabled = off; });
    parts.push(h('div', { class: 'accept-no', attrs: { id: 'accept-no' } },
      h('label', { class: 'label', htmlFor: 'accept-text', text: label }), ta,
      h('p', { class: 'note', attrs: { 'data-k': 'accept-which' }, text: F.FOLLOW_HINT }),
      h('div', { class: 'action-row' }, same, follow), err));
  }
  parts.push(statusLine(act, { online: app.macOnline(), app }));
  return h('div', { class: 'accept' }, parts);
}

// 补充记录（V2.md §8.1）：最近的在上面；附件只有名字、类别、大小
function amendmentsBlock(t) {
  const items = F.amendmentItems(t);
  if (!items.length) return null;
  // 交给 Windows 的任务：那边的会话读不到 Mac 上的补充文件，只从任务记录（评论）里读到
  const win = t.execution?.machine === 'Windows' || t.reopenOnWindows === true;
  return h('section', { class: 'amendments' }, sec('补充记录'),
    win ? h('p', { class: 'note', attrs: { 'data-k': 'amend-windows' }, text: F.AMEND_WINDOWS_NOTE }) : null,
    h('ol', { class: 'amend-list' }, items.map((x) => h('li', {},
      h('span', { class: 'progress-at', text: `${x.at} · ${x.via}` }),
      h('span', { class: 'amend-body' }, h('span', { class: 'progress-text', text: x.text }), x.files.length ? h('span', { class: 'note', text: x.files.join('；') }) : null)))));
}

// 协作记录（V2.md §7，设计稿的协作网格）：一行一个角色——who + 证据小字（括号里的那段），没有的写「没有」。
// 下面一行是 GPT Web 协调者和这个任务（有连接证据才给“请它看一眼”和复制）
function collabBlock(app, t, options) {
  const list = F.collaborationRows(t, options).map(([k, v]) => {
    const s = String(v ?? '没有');
    // 证据小字 = 结尾那一段括号（配对的「（…）」），比如「（设备签名验过）」；中间带括号的（模型名之类）不拆
    let i = -1;
    if (s.endsWith('）')) for (let k = s.length - 1, depth = 0; k >= 0; k--) { if (s[k] === '）') depth++; else if (s[k] === '（' && --depth === 0) { i = k; break; } }
    return h('div', { class: 'row' }, h('dt', { text: k }), h('dd', {}, h('span', { class: 'who', text: i > 0 ? s.slice(0, i) : s }), i > 0 ? h('span', { class: 'ev', text: s.slice(i) }) : null));
  });
  return h('section', { class: 'collab' }, sec('协作记录', h('span', { text: '谁提的 · 谁协调 · 谁真的在做 · 谁审' })),
    h('dl', { class: 'rows collab-grid' }, list),
    coordinatorBlock(app, t));
}

// GPT Web 协调者（ChatGPT 网页端，经 Engineering Bridge）和这个任务：能观测到的连接证据、它和这个任务的关系、请它看一眼。
// 和本机 Codex 的咨询是两回事。没有连接证据时不给“请它看一眼”，只写事实
function coordinatorBlock(app, t) {
  if (!(t.actions || []).includes('consult')) return null;
  const coord = F.coordinatorStatus((app.view?.board?.options?.consult || []).find((x) => x.async));
  const items = [];
  if (coord.connected) {
    const open = app.ui.consultOpen === t.ref;
    items.push(button('请 GPT Web 协调者看一眼', () => { app.ui.consultOpen = open ? null : t.ref; app.render(); }, { cls: 'btn-small', attrs: { 'aria-expanded': open ? 'true' : 'false' } }));
    if (t.state !== 'done') items.push(copyButton(`复制：看 ${t.ref}`, `看 ${t.ref}`, app.copy));
  }
  const form = coord.connected && app.ui.consultOpen === t.ref ? consultForm(app, t, coord) : null;
  const act = latest(app.actions, (a) => a.kind === 'consult' && a.ref === t.ref);
  return h('div', { class: 'coord' }, h('h3', { class: 'sub-title', text: 'GPT Web 协调者' }),
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
    h('div', { class: 'action-row' }, button('发出请求', () => {
      const question = q.value.trim(); const smallWork = note.available && box.checked;
      app.ui.consultOpen = null; app.ui.consultDraft = ''; app.ui.consultSw = false;
      return app.act(() => app.transport.consult(t, { question, smallWork }));
    }, { primary: true })));
}

// 按核心状态的第一块
function firstBlock(app, t, options) {
  if (t.state === 'needs_zoe') return decisionCard(app, t); // 旧卡（misfiled）画成「工程待接手（旧卡）」
  if (t.state === 'done') return [deliverBlock(app, t), resultBlock(app, t)];
  if (t.state === 'cancelled') return [t.result && !t.result.missing ? deliverBlock(app, t) : null, cancelledBlock(app, t)];
  const core = F.coreState(t);
  if (core === 'working') return progressCard(t, options);
  if (core === 'waiting') return waitCard(t);
  return reasonCard(t);
}

// wide：桌面（设计修订 2）——两栏 minmax(0,1fr) 300：主列 = 头 + 摘要格 + 交互卡 / 最终汇报 + 进展 + 折叠；右栏 = 交付三格（单列）+ 协作记录。
// 手机合成一列，顺序和以前一样
export function renderTaskPage(app, t, { wide = false } = {}) {
  if (!t) {
    return [h('section', { class: 'summary status-card' }, h('div', { class: 'thead' },
      h('h1', { class: 'tp-name', text: app.view ? '没有找到这个任务' : '正在读取…' }),
      app.view ? h('p', { class: 'tp-headline', text: '它可能已经不在最近 40 个里了。' }) : null))];
  }
  const options = app.view?.board?.options || null;
  const bill = F.billRows(t);
  const ended = t.state === 'done' || t.state === 'cancelled';
  // 三个折叠（固定顺序）：你说的 → 执行方案与资源 → 工程详情
  const folds = h('div', { class: 'folds' },
    saidBlock(app, t),
    fold(app, `${t.ref}|evidence`, 'evidence', '执行方案与资源',
      planBlock(t, options),
      h('div', { class: 'sub-block' }, h('h3', { text: ended ? '本次执行资源' : '到目前为止用的资源' }), bill ? rows(bill) : h('p', { class: 'note', text: '还没有用量记录。' })),
      t.result && !t.result.missing && t.result.report ? h('div', { class: 'sub-block' }, h('h3', { text: '过程记录' }), recordRows(t)) : null),
    fold(app, `${t.ref}|eng`, 'eng', '工程详情', engineering(t)));
  const first = [firstBlock(app, t, options)].flat().filter(Boolean);
  if (wide) {
    const side = first.filter((n) => String(n.className || '').split(' ').includes('deliver-block'));
    const main = first.filter((n) => !side.includes(n));
    return [h('div', { class: 'tp-cols' },
      h('div', { class: 'tp-main' }, ...[summaryBlock(app, t, options), authorityBlock(app, t), ...main, actionsBlock(app, t), actionBlock(t), lastResultBlock(app, t), progressSection(app, t), amendmentsBlock(t), folds, cancelRow(app, t)].filter(Boolean)),
      h('aside', { class: 'tp-side', attrs: { 'aria-label': '交付和协作记录' } }, ...side, collabBlock(app, t, options)))];
  }
  return [
    summaryBlock(app, t, options),
    authorityBlock(app, t),
    ...first,
    actionsBlock(app, t),
    actionBlock(t),
    lastResultBlock(app, t),
    progressSection(app, t),
    amendmentsBlock(t),
    collabBlock(app, t, options),
    folds,
    cancelRow(app, t),
  ].filter(Boolean);
}
