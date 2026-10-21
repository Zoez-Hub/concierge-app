// 等她决定的事（docs/UI.md §4、V2.md §5；设计整合按木木的 V2 设计稿）：三种交互 = 三套弹层，入口是工作台「需要你」卡和任务页的交互卡。
//   选方案（owner_action，以及 life-none / site-conflict / scope-conflict 这些带选项的卡）：桌面居中对话框 / 手机底部面板。
//     问题、发生了什么、选项（得到 / 代价 / 推荐）、补一句；先选一个，选好了才能确认（送回工程，不自动开工别的）。
//   敏感批准（owner_approval）：桌面右侧面板 / 手机独立页面。工程师原话引用块（要做什么 / 为什么 / 影响 / 回滚 / 风险）+ 署名、可信设备条、
//     登记动作的四行事实（动作 / 在哪 / 版本 / 有效期）。三种弹层里的工程师文字都放引用块（设计修订 2）。
//     批准要点两次（第二次按钮变黄铜「确认批准」，点别处取消）。登记动作（hub#152）在设备上：允许手机批的、这台设备开启了手机批准的，
//     批准由 transport.answer 走面容 ID（和以前同一个调用）；别的只能看和拒绝，拒绝随时可以。
//   真机测试（life-zoe 三项齐全）：桌面右侧面板 / 手机独立页面。核对清单——步骤从卡片的「做什么」拆出来（format.mjs 的 checkSteps，
//     不编造），「应该看到」是卡片的 expected；全部勾完才能「通过，接着做」；「没通过」随时可以，但要写一句。
// 回答带着决定的指纹（transport 里算 d.fp）；这一条已经答过（还在路上，或者 Mac 已经收下、页面还没刷新到）时按钮先不让再点。
// 旧的 life-zoe 卡（decision.misfiled）不是要她动手：任务页上画成「工程待接手（旧卡）」，没有弹层、没有「我做完了」。
// 两台设备答同一张卡（反例 6）：这一条的回执是卡片不一致、视图里有另一条回答时，状态行写“已经在「…」上回答过了”。
import { h, link } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { rows, button, statusLine, latest, copyButton } from './common.mjs';
import { passkeyState } from './passkey.mjs';
import { icon } from './icons.mjs';
import { verbButton } from './tasks.mjs';
import { attachState } from './attach.mjs';

const said = (s) => (s && String(s).trim() ? String(s) : '没写');
const TITLE = { 'life-zoe': '需要你做一件事', 'life-none': '按原来的要求做不到了', 'site-conflict': '你指定的模型在这台机器上跑不了', 'scope-conflict': F.SCOPE_CONFLICT_TITLE };
const kindTag = (text) => h('p', { class: 'kind-tag', text });
// 原话没能完整传到这里（#165 第六次 / 第七次复核 F3）：不让她对着半截内容批准 / 确认，只能看、拒绝。新视图看 decision.truncated，
// 旧视图看顶层 truncated 里的 decision.* / all（format.mjs 的 decisionClipped）。任务详情和 Mac 本机页面拿到的是同一份投影，
// 所以不指去“任务详情里看”：远端请她到 Mac 本机页面；Mac 本机页面指向工程记录里的决定记录（链接在交互卡里，入口照样不收肯定回答）
export const CLIPPED_REMOTE = '内容太长，这里没能完整显示，所以不能在这里批；请在 Mac 本机页面查看完整内容后再批。';
export const CLIPPED_LOCAL = '内容太长，页面上没能完整显示，所以不能在页面上批；完整内容在工程记录里（任务详情 → 工程详情 → 决定记录链接），看完后在有人值守的工程窗口里批。';
export const CLIPPED_TEXT = CLIPPED_REMOTE;
const clipped = (t) => F.decisionClipped(t);
const clippedNote = (app, t, { withLink = false } = {}) => {
  const local = !!app.transport?.capabilities?.local;
  const url = local && withLink ? F.decisionRecordUrl(t) : null;
  return h('div', { class: 'decision-clipped', attrs: { role: 'status' } },
    h('p', { class: ['status', 'is-error'], text: local ? CLIPPED_LOCAL : CLIPPED_REMOTE }),
    url ? h('p', { class: 'note clipped-link' }, link(url, '打开决定记录（完整内容）')) : null);
};

// 引用块（设计修订 2，DESIGN_SPEC §7）：工程师的原话放在左 2px 线的引用块里，不改写；下面 12px 署名「<谁> · <几点> 的原话」
// （谁 = 决定记录的执行者，几点 = 决定的时间，format.mjs 的 quoteBy）
function quote(app, d, ...kids) {
  return h('figure', { class: 'quote' },
    h('blockquote', { class: 'quote-b' }, ...kids.filter(Boolean)),
    h('figcaption', { class: 'quote-by', text: F.quoteBy(d, { options: app.view?.board?.options || null }) }));
}

// 回答这一条的状态行：两台设备答同一张卡时写清楚是在哪台上答过的（反例 6）
export function answerStatus(app, t, act) {
  const echo = F.answerEcho(t, act, { local: app.local });
  if (echo) return h('p', { class: ['status', 'is-error', 'answer-echo'], attrs: { role: 'status' }, text: echo });
  return statusLine(act, { online: app.macOnline(), app });
}

// 旧的 life-zoe 卡（反例 4）：工程待接手，不是要她动手。“让工程接手”= reclassify（撤回 Concierge 自己提的那张卡，从不替她回答）
export function legacyCard(app, t) {
  const d = t.decision || {};
  const acts = t.actions || [];
  const act = latest(app.actions, (a) => (a.kind === 'reclassify' || a.kind === 'cancel') && a.ref === t.ref);
  const sent = (k) => !!act && act.kind === k && ['sending', 'waiting', 'done'].includes(act.state);
  const items = [];
  if (acts.includes('reclassify') && app.transport.reclassify) items.push(button('让工程接手', () => app.act(() => app.transport.reclassify(t)), { primary: true, disabled: sent('reclassify') }));
  items.push(copyButton(`复制：接管 ${t.ref}`, `接管 ${t.ref}`, app.copy));
  if (acts.includes('cancel') && app.transport.cancel) {
    let sure = false;
    const cancel = button('取消这个任务', () => {
      if (!sure) { sure = true; cancel.textContent = '确认取消'; cancel.setAttribute('aria-label', '再点一次确认取消这个任务'); return; }
      cancel.disabled = true;
      app.act(() => app.transport.cancel(t, { text: '' }));
    }, { cls: 'btn-quiet btn-danger', disabled: sent('cancel') });
    items.push(cancel);
  }
  const why = d.misfiled === 'zoe-incomplete' ? '它没写清楚具体要你做什么、做完应该看到什么。' : '它写的其实是工程这边的事（合并、部署、装机、写回执这类），不该你动手。';
  return h('section', { class: ['inline-card', 'legacy-card'], attrs: { 'data-need': 'engineer_blocked', 'data-handler': 'life-zoe' } },
    h('span', { class: 'kind' }, h('span', { class: 'dot', attrs: { 'aria-hidden': 'true' } }), kindTag('工程待接手（旧卡）')),
    h('h3', { class: 'block-title', text: '这张旧卡不用你动手' }),
    h('p', { text: `这是以前的规则提的「要你做一件事」。${why}现在的规则不会拿它来问你。` }),
    h('p', { class: 'note', text: '点「让工程接手」：Concierge 撤回这张卡，任务停在“工程待接手”（不替你回答）；要推进，需要在有人值守的工程窗口说“接管”。' }),
    // 原来那张卡的原文是会话写的工程说法（合并 PR、贴到 #147……）：不上屏，原文在工程详情链接的记录里
    h('div', { class: 'action-row decision-actions' }, items),
    statusLine(act, { online: app.macOnline(), app }));
}

// 任务页的交互卡（需要你的三种各一张）：黄铜 kind 行 + 正文 + 底部说明 + 动词按钮（开弹层）
export function askCard(app, t) {
  const d = t.decision || {};
  const k = F.needCardKind(t);
  const ra = d.handler === 'action' ? d.action : null;
  const act = latest(app.actions, (a) => a.kind === 'answer' && a.ref === t.ref);
  let body;
  let note;
  if (k.type === 'approval') {
    body = [h('p', { text: said(d.what) }),
      ra?.expiresAt ? h('p', { class: 'why', text: `${new Date(ra.expiresAt).toLocaleString('zh-CN', { hour12: false })} 之前批准有效 · 批准只认可信设备：Mac 本机页面${ra.remote ? '，或开了手机批准（面容 ID）的 iPhone' : ''}` }) : null];
    note = ra ? '批准后受限执行器只执行这一个动作一次。' : '敏感操作只能在 Mac 本机页面上批。';
  } else if (k.type === 'test') {
    const steps = F.checkSteps(d.what);
    body = [h('p', { text: `${said(d.what)}${steps.length > 1 ? `（${steps.length} 步核对）` : ''}` }), d.why ? h('p', { class: 'why', text: d.why }) : null];
    note = steps.length > 1 ? `${steps.length} 步都核过才能点通过。` : '核过了才能点通过。';
  } else {
    body = [h('p', { class: 'question', text: said(d.question) }), d.why ? h('p', { class: 'why', text: d.why }) : null];
    note = d.handler === 'life-zoe' ? '做完在弹出来的框里写一句结果。' : '选好后送回给工程师，不会自动开工别的。';
  }
  return h('section', { class: ['inline-card', 'decision-card', `is-${k.type || 'open'}`, d.kind === 'sensitive' ? 'is-sensitive' : ''], attrs: { 'data-need': F.needKind(t) || 'none', 'data-handler': d.handler || null } },
    h('span', { class: 'kind' }, h('span', { class: 'dot brass', attrs: { 'aria-hidden': 'true' } }), `${k.label} · ${F.needWhat(t)}`),
    ...body,
    clipped(t) ? clippedNote(app, t, { withLink: true }) : null,
    h('div', { class: 'foot' }, h('span', { class: 'note', text: note }), verbButton(app, t, { page: true })),
    answerStatus(app, t, act));
}

// 兼容：任务页 / 测试用的入口。旧卡画旧卡；别的是交互卡
export function decisionCard(app, t) {
  return t.decision?.misfiled ? legacyCard(app, t) : askCard(app, t);
}

// ---------------- 弹层 ----------------

export function overlayShape(type, wide) {
  if (type === 'choice') return wide ? 'dialog' : 'sheet';
  return wide ? 'side' : 'page';
}

// 弹层里选中的选项、勾过的核对项按「哪张卡」存（任务 + 卡片指纹，hub#165 终审 F1）：同一个任务换了一张新卡，
// 旧卡上勾过的不会带过去。没有指纹的老视图用卡片时间和内容凑一个
export function cardKey(t) {
  const d = t?.decision || {};
  return `${t?.ref}|${d.fp || `${d.at || ''}:${d.what || d.question || ''}`}`;
}
// 这个任务别的卡（旧卡）上的选择和勾选都扔掉；keep 是还在用的那张卡的 key（不给就全扔）
export function forgetCards(app, ref, keep = null) {
  for (const m of [app.ui.pick, app.ui.checks]) for (const k of [...m.keys()]) if (k.startsWith(`${ref}|`) && k !== keep) m.delete(k);
}

// 提前申请的那张卡（hub#165 §15.3）在 t.deferredDecision 里时（t.decision 被别的卡占着、或任务已经收尾）：弹层按“这张卡就是 decision”画，
// 回答时交回原来那份任务视图（远端要它是验过签的那一份，卡片指纹从它算），并说明答的是 deferred 那张
const BASE = new WeakMap();
export function deferredView(t) {
  if (!t || !t.deferredDecision) return null;
  // 截短记账（旧视图的顶层 truncated）：deferredDecision.* 才是这张卡的；decision.* 是被占着的那张别的卡的，不算
  const tr = Array.isArray(t.truncated)
    ? t.truncated.filter((x) => !String(x).startsWith('decision.')).map((x) => (String(x).startsWith('deferredDecision.') ? `decision.${String(x).slice(17)}` : x))
    : t.truncated;
  const v = { ...t, decision: t.deferredDecision, ...(tr !== undefined ? { truncated: tr } : {}) };
  BASE.set(v, t);
  return v;
}

// 弹层里的回答：和以前的决定卡同一个调用（transport.answer，带上文字框里的话；成功了清掉草稿和这张卡上的选择 / 勾选）
function answering(app, t, draftKey, input) {
  const d = t.decision || {};
  const act = latest(app.actions, (a) => a.kind === 'answer' && a.ref === t.ref);
  const busy = !!act && (act.state === 'sending' || act.state === 'waiting' || (act.state === 'done' && act.fp === d.fp));
  const base = BASE.get(t) || null;
  const send = (choice) => app.act(async () => {
    const r = await app.transport.answer(base || t, { choice, text: input.value.trim(), ...(base ? { card: 'deferred' } : {}) });
    if (r && r.state !== 'failed') { app.ui.drafts.delete(draftKey); forgetCards(app, t.ref); }
    return r;
  });
  return { act, busy, send };
}

function draftBox(app, t, { id, label, placeholder, rows: n = 2, main = false }) {
  const draftKey = `${t.ref}|${t.decision?.fp}`;
  const input = h('textarea', { class: ['reply', 'ta', main ? 'is-main' : ''], id, rows: n, value: app.ui.drafts.get(draftKey) || '', placeholder, attrs: { 'aria-label': label } });
  input.addEventListener('input', () => app.ui.drafts.set(draftKey, input.value));
  return { input, draftKey, box: h('div', { class: ['reply-box', main ? 'is-main' : ''] }, h('label', { class: 'label', htmlFor: id, text: label }), input) };
}

// 选方案：问题和选项都是模型原话（不改写、不截短）。needs=none 的卡（life-none）：「接受这个结论」/「我改一下要求」——后者展开一个必填的输入框再发
function choiceParts(app, t) {
  const d = t.decision || {};
  const doTask = d.handler === 'life-zoe';
  const opts = d.options || [];
  const amendName = d.handler === 'life-none' ? (opts.map((o) => String(o.name || '')).find((n) => n === F.LIFE_NONE_AMEND) || null) : null;
  const ck = cardKey(t);
  const pick = opts.some((o) => o.name === app.ui.pick.get(ck)) ? app.ui.pick.get(ck) : null;
  const amending = !!amendName && pick === amendName;
  const { input, draftKey, box } = draftBox(app, t, doTask
    ? { id: 'reply', label: '做完的结果（写在这里）', placeholder: '做完了在这里写一句结果，比如看到了什么、改了哪里', rows: 4, main: true }
    : amending ? { id: 'reply', label: '怎么改（必须写一句）', placeholder: '写一句要怎么改，工程照这句在同一个任务里重新做', rows: 3, main: true }
      : { id: 'reply', label: '补一句（可选）', placeholder: '想补一句，或者都不选、直接说你的想法', rows: 1 });
  const { act, busy, send } = answering(app, t, draftKey, input);
  const rec = String(d.recommend || '');
  const isRec = (o) => !!rec && !!o.name && (rec === o.name || rec.startsWith(String(o.name)));
  const choose = (name) => { app.ui.pick.set(ck, name); app.ui.ovTick = (app.ui.ovTick || 0) + 1; app.render(); };
  const list = opts.length ? h('ul', { class: 'opts options' }, opts.map((o) => h('li', {}, h('button', {
    type: 'button', class: ['opt', 'option', isRec(o) ? 'is-recommended' : ''], disabled: busy || !o.name,
    attrs: { 'aria-pressed': pick === o.name ? 'true' : 'false', 'data-k': `opt:${o.name || ''}` },
    on: { click: () => choose(o.name) },
  },
  h('span', { class: 'opt-h option-name' }, h('span', { text: o.name || '（没有名字的选项）' }), isRec(o) ? h('span', { class: 'rec tag', text: '推荐' }) : null),
  o.gain || o.cost ? h('span', { class: 'opt-l' }, o.gain ? [h('span', { text: '得到' }), h('span', { text: o.gain })] : null, o.cost ? [h('span', { text: '代价' }), h('span', { text: o.cost })] : null) : null)))) : null;
  const needText = amending && !input.value.trim();
  const cut = clipped(t);
  const confirm = button(pick ? `确认选「${pick}」` : '先选一个', () => { if (!pick || cut) return; if (amending && !input.value.trim()) { input.focus(); return; } send(String(pick).slice(0, 200)); }, { primary: true, disabled: busy || !pick || needText || cut, attrs: { 'data-k': 'confirm' } });
  if (amending) input.addEventListener('input', () => { confirm.disabled = busy || cut || !input.value.trim(); });
  const onlyText = doTask || amendName ? null : button('只发这句', () => send(''), { cls: 'btn-quiet', disabled: busy || !input.value.trim(), attrs: { 'data-k': 'only-text' } });
  if (onlyText) input.addEventListener('input', () => { onlyText.disabled = busy || !input.value.trim(); });
  // 有自己的标题的几种卡（按原来的要求做不到了、模型在这台机器上跑不了……）：标题那一行写在正文最上面，弹层标题是任务名
  const cardTitle = TITLE[d.handler] || null;
  const section = h('section', { class: ['decision', 'is-action', doTask ? 'is-task' : ''], attrs: { 'data-handler': d.handler || null, 'data-need': doTask ? 'owner_physical_action' : 'owner_action' } },
    cardTitle ? kindTag(cardTitle) : null,
    cut ? clippedNote(app, t) : null,
    quote(app, d,
      h('p', { class: 'why lead-text question said', text: said(d.question) }),
      d.why ? h('p', { class: 'why said' }, h('span', { class: 'label', text: doTask ? '为什么要你做 ' : '为什么现在要定 ' }), h('span', { text: d.why })) : null),
    doTask ? box : null,
    list,
    d.recommend ? h('p', { class: 'why recommend' }, h('span', { class: 'label', text: '推荐 ' }), h('span', { text: d.recommend })) : null,
    doTask || (amendName && !amending) ? null : box,
    onlyText ? h('div', { class: 'action-row' }, onlyText) : null);
  return {
    kind: `${F.needCardKind(t).label} · ${F.taskNumber(t.ref, app.view?.board?.home || null)}`,
    title: F.taskName(t, { home: app.view?.board?.home || null, max: 60 }),
    body: [section],
    foot: [viewTask(app, t), button('再想想', () => app.closeOverlay?.(), { attrs: { 'data-k': 'later' } }), confirm, answerStatus(app, t, act)],
  };
}

// 「查看任务详情」：关掉弹层，进这个任务的详情页，滚到交互卡（背景、进展、执行者、证据都在详情页）
function viewTask(app, t) {
  return button('查看任务详情', () => {
    if (app.viewTask) app.viewTask(t.ref);
    else { app.closeOverlay?.({ refocus: false }); app.nav?.(F.hashOfTask(t.ref)); }
  }, { cls: 'btn-quiet ov-detail', attrs: { 'data-k': 'detail' } });
}

// 敏感批准
function approvalParts(app, t) {
  const d = t.decision || {};
  const caps = app.transport.capabilities || {};
  const ra = d.handler === 'action' && d.action ? d.action : null;
  const phone = !caps.local && !!ra;
  const phoneOk = phone && ra.remote && caps.passkey && passkeyState(app) === 'active';
  const cut = clipped(t);
  const canApprove = ((caps.sensitiveApprove && d.answerable === 'mac-only') || phoneOk) && !cut;
  const canDeny = canApprove || phone || (cut && ((caps.sensitiveApprove && d.answerable === 'mac-only') || phoneOk));
  const { input, draftKey, box } = draftBox(app, t, { id: 'reply', label: '补一句（可选）', placeholder: '想补一句（可选）', rows: 1 });
  const { act, busy, send } = answering(app, t, draftKey, input);
  // 两次确认（原样保留）：第一次按钮变成「确认批准」（黄铜），第二次才送出；点别处取消
  let confirm = false;
  const label = phoneOk ? '用面容 ID 批准' : canApprove ? '批准' : phone ? '只能在 Mac 上批准' : '批准';
  const note = h('span', { class: 'note', text: canApprove ? '批准要点两次。' : canDeny ? '这里只能看和拒绝。' : '这里只能看。' });
  const reset = () => { if (!confirm) return; confirm = false; approve.textContent = label; approve.className = 'btn btn-primary'; approve.removeAttribute('aria-label'); note.textContent = '批准要点两次。'; };
  const approve = button(label, () => {
    if (!canApprove) return;
    if (!confirm) { confirm = true; approve.textContent = '确认批准'; approve.className = 'btn btn-brass'; approve.setAttribute('aria-label', '再点一次确认批准'); note.textContent = '再点一次就执行，点别处取消。'; return; }
    send('批准');
  }, { primary: canApprove, disabled: !canApprove || busy, attrs: { 'data-k': 'approve' } });
  const deny = button('不批准', () => send('不批准'), { disabled: !canDeny || busy, attrs: { 'data-k': 'deny' } });
  const why = cut ? '原话没能完整传到这里，看完整内容再批'
    : !phone && !canApprove ? '敏感操作请回到 Mac 上批准'
    : !phone ? null
      : !ra.remote ? '这个动作只能在 Mac 上批准（这里可以拒绝）'
        : !caps.passkey ? '这个浏览器用不了面容 ID 批准：回到 Mac 上批准（这里可以拒绝）'
          : passkeyState(app) !== 'active' ? '这台设备还没开启手机批准（设置 → 权限 → 手机批准）；也可以回到 Mac 上批准' : null;
  // 可信设备条：一行
  const trust = canApprove
    ? h('div', { class: ['trust', 'is-ok'] }, h('span', { class: 'trust-i', attrs: { 'aria-hidden': 'true' } }, icon('check')),
      h('span', { class: 'trust-t', text: phoneOk ? '可信设备：这台设备，手机批准已开启 · 批准要面容 ID，也要点两次' : '可信设备：Mac 本机页面 · 批准要点两次' }))
    : h('div', { class: ['trust', 'is-no'] }, h('span', { class: 'trust-i', attrs: { 'aria-hidden': 'true' }, text: '!' }),
      h('span', { class: 'trust-t', text: `只能看：${why || '敏感操作请回到 Mac 上批准'}` }));
  // 正文（设计修订 2）：工程师原话放引用块（要做什么 / 为什么 / 影响 / 回滚 / 风险，标签保留，不改写、不截短）+ 署名；
  // 可信设备条；登记动作再给四行事实（动作含参数 / 在哪 / 版本 / 有效期，64px 标签列）
  const said4 = [['要做什么', said(d.what)], ['为什么', said(d.why)], ['影响', said(d.impact)], ['回滚', said(d.rollback)]];
  if (ra || d.risk) said4.push(['风险', said(d.risk)]);
  const facts = ra ? [
    ['动作', `${F.actionTitle(ra)}${Object.keys(ra.args || {}).length ? `（${Object.entries(ra.args).map(([k, v]) => `${k} = ${v}`).join('；')}）` : ''}`],
    ['在哪', `${ra.site === 'windows' ? 'Windows' : 'Mac'} 上的受限执行器，只执行这一次`],
    ['版本', ra.scriptSha ? `脚本指纹 ${ra.scriptSha}` : '没写'],
    ['有效期', ra.expiresAt ? `${new Date(ra.expiresAt).toLocaleString('zh-CN', { hour12: false })} 之前批准有效` : '没写'],
  ] : [];
  const section = h('section', { class: ['decision', 'is-sensitive', ra ? 'is-runbook' : ''], attrs: { 'data-need': 'owner_approval', 'data-handler': ra ? 'action' : null } },
    cut ? clippedNote(app, t) : null,
    quote(app, d, h('dl', { class: 'sens said' }, said4.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })]))),
    trust,
    facts.length ? h('dl', { class: 'facts4' }, facts.map(([k, v]) => [h('dt', { text: k }), h('dd', { text: v })])) : null,
    canDeny ? box : null);
  // 「点别处取消」（终审 F2）：overlayContent 把 onOutside 接到整个弹层内容上（标题、正文、页脚、关闭），批准按钮本身除外
  return {
    kind: `等你批准 · ${ra ? `「${F.actionTitle(ra)}」` : '敏感操作'} · ${F.taskNumber(t.ref, app.view?.board?.home || null)}`,
    title: F.taskName(t, { home: app.view?.board?.home || null, max: 60 }),
    body: [section],
    foot: [viewTask(app, t), note, deny, approve, answerStatus(app, t, act)],
    onOutside: (e) => { if (!approve.contains(e.target)) reset(); },
  };
}

// 真机测试：核对清单
// 现在测不了：关掉弹层就行，什么都不记（不算通过也不算没通过），卡留在「需要你」里
export const TEST_LATER = '现在测不了：直接关掉就行，这张卡留在「需要你」里，不算通过也不算没通过。';
// 打开任务页的「补一句 / 追加截图」（状态和 task.mjs 的 amendState 同一个：app.ui.amend）
function openAmend(app, ref) {
  if (!app.ui.amend) app.ui.amend = new Map();
  const s = app.ui.amend.get(ref) || { open: false, text: '', att: attachState() };
  s.open = true;
  app.ui.amend.set(ref, s);
  // 任务页的重画键里有 amendTick（app.mjs）：不加的话，已经在这个任务页上时表单不会展开（第十二轮复核 P2）
  app.ui.amendTick = (app.ui.amendTick || 0) + 1;
}
function testParts(app, t) {
  const d = t.decision || {};
  const steps = F.checkSteps(d.what);
  const ck = cardKey(t);
  const checks = app.ui.checks.get(ck) || new Set();
  const all = steps.length > 0 && steps.every((_, i) => checks.has(i));
  // 通过时也能补一句（额外发现随「通过」一起交回）；没通过必须写
  const { input, draftKey, box } = draftBox(app, t, { id: 'reply', label: '补一句（可选；没通过必须写）', placeholder: '看到的情况、额外的发现都可以写；没通过要写一句哪里不对', rows: 2 });
  const { act, busy, send } = answering(app, t, draftKey, input);
  const doneName = (d.options || []).map((o) => String(o.name || '')).find((n) => /做完/.test(n)) || '我做完了，接着做';
  const err = h('p', { class: 'status is-error', attrs: { role: 'status' } });
  const toggle = (i) => {
    const s = new Set(checks);
    if (s.has(i)) s.delete(i); else s.add(i);
    app.ui.checks.set(ck, s); app.ui.ovTick = (app.ui.ovTick || 0) + 1; app.render();
    globalThis.document?.querySelector?.(`#ov [data-k="ck:${i}"]`)?.focus();
  };
  const cut = clipped(t);
  const pass = button('通过，接着做', () => { if (all && !cut) send(doneName); }, { primary: true, disabled: busy || !all || cut, attrs: { 'data-k': 'pass' } });
  const fail = button('没通过', () => {
    if (!input.value.trim()) { err.textContent = '没通过要写一句你看到的（工程按这句接着改）。'; input.focus(); return; }
    send('没通过');
  }, { disabled: busy, attrs: { 'data-k': 'fail' } });
  // 正文 = 模型原话：做什么（整段，再拆成核对项）/ 为什么 / 应该看到
  const section = h('section', { class: ['decision', 'is-action', 'is-task', 'is-test'], attrs: { 'data-handler': 'life-zoe', 'data-need': 'owner_physical_action' } },
    cut ? clippedNote(app, t) : null,
    quote(app, d, h('dl', { class: 'sens said' }, h('dt', { text: '做什么' }), h('dd', { text: said(d.what) }), h('dt', { text: '为什么' }), h('dd', { text: said(d.why) }))),
    h('ul', { class: 'check', attrs: { 'aria-label': '核对清单' } }, steps.map((s, i) => h('li', {}, h('button', {
      type: 'button', class: 'ck', disabled: busy, attrs: { 'aria-pressed': checks.has(i) ? 'true' : 'false', 'data-k': `ck:${i}` }, on: { click: () => toggle(i) },
    }, h('span', { class: 'bx', attrs: { 'aria-hidden': 'true' } }, icon('check')), h('span', { class: 'tx', text: s }))))),
    h('dl', { class: 'sens' }, h('dt', { text: '应该看到' }), h('dd', { text: said(d.expected) })),
    box, err,
    h('p', { class: 'note', attrs: { 'data-k': 'test-later' }, text: TEST_LATER }));
  // 截图：复用任务页的「补一句 / 追加截图」（这一轮没结束，补充随时能加，工程下一步读得到）
  const shot = (t.actions || []).includes('amend') && app.transport.amend
    ? button('加截图', () => {
      openAmend(app, t.ref);
      // viewTask 带 focus:'amend'：重画后在下一帧滚到并聚焦补充输入框（不再被交互卡抢走焦点，第十三轮复核 P2）
      if (app.viewTask) app.viewTask(t.ref, { focus: 'amend' });
      else { app.closeOverlay?.({ refocus: false }); app.nav?.(F.hashOfTask(t.ref)); app.render?.(); }
    },
      { cls: 'btn-quiet', disabled: busy, attrs: { 'data-k': 'test-shot' } })
    : null;
  return {
    kind: `等你真机测试 · ${F.taskNumber(t.ref, app.view?.board?.home || null)}`,
    title: F.taskName(t, { home: app.view?.board?.home || null, max: 60 }),
    body: [section],
    foot: [viewTask(app, t), shot, h('span', { class: 'note', text: all ? '都核过了。' : steps.length > 1 ? `核完 ${steps.length} 步才能点通过。` : '核过了才能点通过。' }), fail, pass, answerStatus(app, t, act)],
  };
}

// 弹层的全部内容（app.mjs 放进 #ov 里，跟着视图和动作状态重画）
export function overlayContent(app, t, type, { wide = true } = {}) {
  const parts = type === 'approval' ? approvalParts(app, t) : type === 'test' ? testParts(app, t) : choiceParts(app, t);
  const shape = overlayShape(type, wide);
  const head = h('div', { class: 'ov-h' },
    h('span', { class: 'kind' }, h('span', { class: 'dot brass', attrs: { 'aria-hidden': 'true' } }), parts.kind),
    h('h2', { id: 'ov-title', text: parts.title, tabIndex: -1 }),
    shape === 'page' ? null : h('button', { type: 'button', class: 'ov-x', attrs: { 'aria-label': '关闭' }, on: { click: () => app.closeOverlay?.() } }, icon('x')));
  const foot = h('div', { class: 'ov-f' }, parts.foot);
  const nodes = shape === 'page'
    ? [h('div', { class: 'ov-pagebar' },
      h('button', { type: 'button', class: 'back', attrs: { 'aria-label': '返回任务' }, on: { click: () => app.closeOverlay?.() } }, icon('back'), '返回'),
      h('span', { class: 'ttl', text: type === 'approval' ? '批准这个动作' : '真机测试' })),
    h('div', { class: 'ov-b' }, head, ...parts.body), foot]
    : [shape === 'sheet' ? h('div', { class: 'grab', attrs: { 'aria-hidden': 'true' } }) : null, head, h('div', { class: 'ov-b' }, ...parts.body), foot];
  // 弹层里点任何地方（批准按钮除外）都交给 onOutside：敏感批准的「确认批准」回到「批准」
  if (parts.onOutside) for (const n of nodes) n?.addEventListener('click', parts.onOutside);
  return nodes;
}
