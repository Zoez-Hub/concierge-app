// 任务页（docs/UI.md §4），从上到下：
//   1 她说的话和额外要求、来源  2 状态块（正在处理 / 等你决定 / 完成）  3 谁做了什么
//   4 本次执行资源  5 工程详情（默认折叠）  6 现在能做的动作（不能做的不显示）
// Issue、PR、分支这些词只出现在第 5 段。
import { h, link } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { rows, section, button, statusLine, latest, copyButton } from './common.mjs';

const said = (s) => (s && String(s).trim() ? String(s) : '没写');

function head(app, t) {
  return h('div', { class: 'tp-head' },
    button('‹ 任务', () => app.back(), { cls: 'btn-quiet back', attrs: { 'aria-label': '返回任务列表' } }),
    h('span', { class: 'tp-ref', text: t ? t.ref : '' }));
}

function saidBlock(t) {
  return h('section', { class: 'block said' },
    h('h2', { class: 'tp-want', text: said(t.want || t.title) }),
    t.extra ? h('p', { class: 'tp-extra' }, h('span', { class: 'label', text: '额外要求' }), h('span', { text: t.extra })) : null,
    h('p', { class: 'tp-source', text: F.sourceLine(t) }),
    Array.isArray(t.truncated) && t.truncated.length ? h('p', { class: 'note', text: '内容太长，这里只显示了一部分；完整的在「工程详情」的链接里。' }) : null);
}

function needText(t) {
  const n = t.now || {};
  if (!n.needsZoe) return '不需要';
  if (t.state === 'queued' && t.plan?.consult?.async) return `不一定：可以到 ChatGPT 说一句“看 ${t.ref}”，也可以不等了直接做`;
  if (t.actions?.includes('resume')) return '要：看一眼，决定要不要让后台继续';
  if (/接管/.test(t.stateText || '')) return `要：到工程窗口说“接管 ${t.ref}”`;
  return `要：${t.stateText}`;
}

function workingBlock(app, t, options) {
  const n = t.now || {};
  const who = [n.who, F.modelLabel(n.model, options), n.effort, n.machine].filter(Boolean).join(' · ') || '没有人在做';
  const b = t.bill;
  const spent = [b ? `${b.sessions} 次会话` : null, F.since(t.createdAt) ? `提交后 ${F.since(t.createdAt)}` : null].filter(Boolean).join(' · ');
  const subs = (t.provenance?.subagents || []).reduce((a, x) => a + (Number(x.n) || 0), 0);
  const cons = (t.provenance?.consults || []).reduce((a, x) => a + (Number(x.n) || 0), 0);
  const list = [
    ['谁在处理', who],
    ['当前阶段', n.phase || t.stateText],
    ['要不要你', needText(t)],
    ['已用资源', [spent || '还没有用量记录', subs ? `子代理 ${subs} 个` : null, cons ? `咨询 ${cons} 次` : null].filter(Boolean).join(' · ')],
  ];
  if (t.planText) list.push(['计划', t.planText]);
  const luna = t.state === 'working' && /Luna/.test(n.who || '');
  return h('section', { class: ['block', 'status-block', `is-${t.state}`] }, h('h3', { class: 'block-title', text: luna ? '正在小动工' : t.state === 'working' ? '正在处理' : t.state === 'queued' ? '排队' : t.state === 'handed_off' ? '交出去了' : '没人在做' }), rows(list));
}

function resultBlock(t) {
  const r = t.result;
  if (!r || r.missing) return section('完成', h('p', { text: '已经结束，但没有留下结果说明。' }));
  return section('完成', rows([
    ['做了什么', said(r.did)],
    ['怎么验证的', said(r.verified)],
    ['部署了吗', said(r.deployed)],
    ['真实环境验证了吗', said(r.realworld)],
    ['还有什么遗留', said(r.gaps)],
  ]));
}

function decisionCard(app, t) {
  const d = t.decision || {};
  const caps = app.transport.capabilities;
  const act = latest(app.actions, (a) => a.kind === 'answer' && a.ref === t.ref);
  // 这一条决定已经答过（还在路上，或者入口已经收下、页面还没刷新到）：按钮先不让再点
  const busy = !!act && (act.state === 'sending' || act.state === 'waiting' || (act.state === 'done' && act.fp === d.fp));
  const draftKey = `${t.ref}|${d.fp}`;
  const input = h('textarea', { class: 'reply', id: 'reply', rows: 2, value: app.ui.drafts.get(draftKey) || '', placeholder: '想补一句，或者都不选、直接说你的想法', attrs: { 'aria-label': '补一句（可选）' } });
  input.addEventListener('input', () => { app.ui.drafts.set(draftKey, input.value); onlyText.disabled = busy || !input.value.trim(); });
  const send = (choice) => app.act(async () => {
    const r = await app.transport.answer(t, { choice, text: input.value.trim() });
    if (r && r.state !== 'failed') app.ui.drafts.delete(draftKey);
    return r;
  });
  const onlyText = button('只发这句', () => send(''), { disabled: busy || !input.value.trim() });
  const reply = h('div', { class: 'reply-box' }, h('label', { class: 'label', htmlFor: 'reply', text: '补一句（可选）' }), input);

  if (d.kind === 'sensitive') {
    const canApprove = caps.sensitiveApprove && d.answerable === 'mac-only';
    let confirm = false;
    const approve = button('批准', () => {
      if (!confirm) { confirm = true; approve.textContent = '确认批准'; approve.setAttribute('aria-label', '再点一次确认批准'); return; }
      send('批准');
    }, { primary: canApprove, disabled: !canApprove || busy });
    const deny = button('不批准', () => send('不批准'), { disabled: !canApprove || busy });
    return h('section', { class: ['block', 'decision', 'is-sensitive'] },
      h('h3', { class: 'block-title', text: '等你批准一个敏感操作' }),
      rows([['要做什么', said(d.what)], ['为什么', said(d.why)], ['影响', said(d.impact)], ['回滚', said(d.rollback)]]),
      canApprove ? reply : null,
      h('div', { class: 'decision-actions' }, approve, deny),
      canApprove ? null : h('p', { class: 'note strong', text: '敏感操作请回到 Mac 上批准' }),
      statusLine(act, { online: app.macOnline(), app }));
  }
  const opts = d.options || [];
  return h('section', { class: ['block', 'decision'] },
    h('h3', { class: 'block-title', text: '等你决定' }),
    h('p', { class: 'question', text: said(d.question) }),
    opts.length ? h('ol', { class: 'options' }, opts.map((o) => h('li', { class: 'option' },
      h('p', { class: 'option-name', text: o.name || '（没有名字的选项）' }),
      o.gain ? h('p', {}, h('span', { class: 'label', text: '会得到' }), h('span', { text: o.gain })) : null,
      o.cost ? h('p', {}, h('span', { class: 'label', text: '代价' }), h('span', { text: o.cost })) : null))) : null,
    d.recommend ? h('p', { class: 'recommend' }, h('span', { class: 'label', text: '推荐' }), h('span', { text: `${d.recommend}${d.why ? `。理由：${d.why}` : ''}` })) : (d.why ? h('p', { class: 'recommend' }, h('span', { class: 'label', text: '理由' }), h('span', { text: d.why })) : null),
    reply,
    h('div', { class: 'decision-actions' }, opts.map((o) => button(`选「${o.name}」`, () => send(String(o.name || '').slice(0, 200)), { primary: true, disabled: busy || !o.name })), onlyText),
    statusLine(act, { online: app.macOnline(), app }));
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
    const label = t.state === 'queued' && t.plan?.consult?.async ? '不等了，直接做' : '让后台继续';
    items.push(button(label, () => app.act(() => app.transport.resume(t))));
  }
  if (acts.includes('consult')) {
    const open = app.ui.consultOpen === t.ref;
    items.push(button('请 GPT Web 协调者看一眼', () => { app.ui.consultOpen = open ? null : t.ref; app.render(); }, { attrs: { 'aria-expanded': open ? 'true' : 'false' } }));
  }
  const look = t.state !== 'done' && (acts.includes('consult') || (t.state === 'queued' && t.plan?.consult?.async));
  if (look) items.push(copyButton(`复制：看 ${t.ref}`, `看 ${t.ref}`, app.copy));
  if ((t.state === 'stalled' || t.state === 'handed_off') && /接管/.test(t.stateText || '')) items.push(copyButton(`复制：接管 ${t.ref}`, `接管 ${t.ref}`, app.copy));
  if (!items.length) return null;
  const form = app.ui.consultOpen === t.ref ? consultForm(app, t) : null;
  const act = latest(app.actions, (a) => (a.kind === 'resume' || a.kind === 'consult') && a.ref === t.ref);
  return h('section', { class: 'block actions' }, h('h3', { class: 'block-title', text: '现在能做的' }), h('div', { class: 'action-row' }, items), form,
    statusLine(act, { online: app.macOnline(), app }),
    act && act.kind === 'consult' && act.state !== 'failed' ? h('p', { class: 'note', text: `到 ChatGPT 对 GPT Web 协调者说一句：看 ${t.ref}` }) : null);
}

function consultForm(app, t) {
  const o = app.view?.board?.options || {};
  const note = F.smallWorkNote(o.smallWork);
  const coord = F.coordinatorStatus((o.consult || []).find((x) => x.async));
  const q = h('textarea', { id: 'consult-q', rows: 2, value: app.ui.consultDraft || '', placeholder: '想让它看什么（可以不写）', attrs: { 'aria-label': '想让 GPT Web 协调者看什么' } });
  q.addEventListener('input', () => { app.ui.consultDraft = q.value; });
  const box = h('input', { type: 'checkbox', id: 'consult-sw', disabled: !note.available, checked: note.available && !!app.ui.consultSw, attrs: { role: 'switch' } });
  box.addEventListener('change', () => { app.ui.consultSw = box.checked; });
  return h('div', { class: 'consult-form' },
    h('p', { class: ['note', coord.connected ? '' : 'is-warn'], attrs: { id: 'consult-coord' }, text: coord.connected ? `GPT Web 协调者：${coord.text}` : `GPT Web 协调者${coord.text}：请求会记下，等它连上、你在 ChatGPT 里说“看 ${t.ref}”时才会被看到。` }),
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
  return [
    head(app, t),
    saidBlock(t),
    t.state === 'needs_zoe' ? decisionCard(app, t) : t.state === 'done' ? resultBlock(t) : workingBlock(app, t, options),
    section('谁做了什么', rows(F.provenanceRows(t, options))),
    section(t.state === 'done' ? '本次执行资源' : '到目前为止用的资源', bill ? rows(bill) : h('p', { class: 'note', text: '还没有用量记录。' })),
    engineering(t),
    actionsBlock(app, t),
  ].filter(Boolean);
}
