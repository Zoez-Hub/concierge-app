// 等她决定的卡片（docs/UI.md §4）：首页「等你决定」和任务页最上面用同一张。
// 普通决定：问题 / 为什么现在要定 / 每个选项的会得到、代价 / 推荐 / 按钮；敏感操作：要做什么 / 为什么 / 影响 / 回滚 + 批准 / 不批准（只能在 Mac 本机页面上批）。
// 入口自己提的几类（decision.handler）：
//   life-zoe       需要你做一件事（owner_physical_action，hub#149：只有你本人能做的，比如解锁 / 信任 / 看一眼手机）：
//                  做什么 / 为什么要你做 / 做完应该看到什么三行（hub#30 C03；旧卡只有问题），文字框写做完的结果，
//                  两个按钮（接着做 / 取消这个任务）
// 敏感审批卡和普通操作卡分开（hub#30 C03）：卡片顶上一个标签（“敏感审批 · 只能在 Mac 上批” / “要你动手” / “要你选”），敏感的另用警示色
//   life-none      按原来的要求做不到了：换个方式再试 / 按现在的结论结束
//   site-conflict  她指定的模型在需要的那台机器上跑不了
// 回答带着决定的指纹（d.fp）；这一条已经答过（还在路上，或者入口已经收下、页面还没刷新到）时按钮先不让再点。
import { h } from '../lib/dom.mjs';
import { rows, button, statusLine, latest } from './common.mjs';
import { passkeyState } from './passkey.mjs';

const said = (s) => (s && String(s).trim() ? String(s) : '没写');
const TITLE = { 'life-zoe': '需要你做一件事', 'life-none': '按原来的要求做不到了', 'site-conflict': '你指定的模型在这台机器上跑不了' };
const kindTag = (text) => h('p', { class: 'kind-tag', text });
// 同一页上可能有两张同一个任务的卡片（桌面上首页和任务页并排）：文字框的 id 分开
const slug = (ref) => String(ref || '').replace(/[^A-Za-z0-9_-]/g, '-');

export function decisionCard(app, t, { where = 'page' } = {}) {
  const d = t.decision || {};
  const caps = app.transport.capabilities;
  const act = latest(app.actions, (a) => a.kind === 'answer' && a.ref === t.ref);
  const busy = !!act && (act.state === 'sending' || act.state === 'waiting' || (act.state === 'done' && act.fp === d.fp));
  const draftKey = `${t.ref}|${d.fp}`;
  const id = where === 'page' ? 'reply' : `reply-${slug(t.ref)}`;
  const doTask = d.handler === 'life-zoe';
  const input = h('textarea', {
    class: ['reply', doTask ? 'is-main' : ''], id, rows: doTask ? 4 : 2, value: app.ui.drafts.get(draftKey) || '',
    placeholder: doTask ? '做完了在这里写一句结果，比如看到了什么、改了哪里' : '想补一句，或者都不选、直接说你的想法',
    attrs: { 'aria-label': doTask ? '做完的结果' : '补一句（可选）' },
  });
  let onlyText = null;
  input.addEventListener('input', () => { app.ui.drafts.set(draftKey, input.value); if (onlyText) onlyText.disabled = busy || !input.value.trim(); });
  const send = (choice) => app.act(async () => {
    const r = await app.transport.answer(t, { choice, text: input.value.trim() });
    if (r && r.state !== 'failed') app.ui.drafts.delete(draftKey);
    return r;
  });
  const reply = h('div', { class: ['reply-box', doTask ? 'is-main' : ''] }, h('label', { class: 'label', htmlFor: id, text: doTask ? '做完的结果（写在这里）' : '补一句（可选）' }), input);
  const status = statusLine(act, { online: app.macOnline(), app });

  if (d.kind === 'sensitive') {
    // 登记动作（hub#152）在设备上：允许手机批的、这台设备开启了手机批准的，用面容 ID 批；拒绝随时可以
    const ra = d.handler === 'action' && d.action ? d.action : null;
    const phone = !caps.local && !!ra;
    const phoneOk = phone && ra.remote && caps.passkey && passkeyState(app) === 'active';
    const canApprove = (caps.sensitiveApprove && d.answerable === 'mac-only') || phoneOk;
    const canDeny = canApprove || phone;
    let confirm = false;
    const approve = button('批准', () => {
      if (!confirm) { confirm = true; approve.textContent = '确认批准'; approve.setAttribute('aria-label', '再点一次确认批准'); return; }
      send('批准');
    }, { primary: canApprove, disabled: !canApprove || busy });
    if (phoneOk) approve.textContent = '用面容 ID 批准';
    const deny = button('不批准', () => send('不批准'), { disabled: !canDeny || busy });
    // 登记动作（hub#152）：批准后由受限执行器只执行这一次。多写：风险、在哪执行、参数、脚本指纹、有效期
    const a = d.handler === 'action' && d.action ? d.action : null;
    const actionRows = a ? [
      ['风险', said(d.risk)],
      ['怎么执行', `批准后由 ${a.site === 'windows' ? 'Windows' : 'Mac'} 上的受限执行器只执行这一次（登记动作「${a.title || a.runbook}」）`],
      ['参数', Object.entries(a.args || {}).map(([k, v]) => `${k} = ${v}`).join('；') || '没有'],
      ['脚本指纹', a.scriptSha || '没写'],
      ['有效期', a.expiresAt ? `${new Date(a.expiresAt).toLocaleString('zh-CN', { hour12: false })} 之前批准有效` : '没写'],
    ] : [];
    return h('section', { class: ['block', 'decision', 'is-sensitive', a ? 'is-runbook' : ''], attrs: { 'data-need': 'owner_approval', 'data-handler': a ? 'action' : null } },
      kindTag(a ? '审批 · 批准后受限执行器执行' : '敏感审批 · 只能在 Mac 上批'),
      h('h3', { class: 'block-title', text: a ? `等你批准：${a.title || '一个动作'}` : '等你批准一个敏感操作' }),
      rows([['要做什么', said(d.what)], ['为什么', said(d.why)], ['影响', said(d.impact)], ...actionRows, ['回滚', said(d.rollback)]]),
      canDeny ? reply : null,
      h('div', { class: 'decision-actions' }, approve, deny),
      canApprove ? null : h('p', { class: 'note strong', text: !phone ? '敏感操作请回到 Mac 上批准'
        : !ra.remote ? '这个动作只能在 Mac 上批准（这里可以拒绝）'
          : !caps.passkey ? '这个浏览器用不了面容 ID 批准：回到 Mac 上批准（这里可以拒绝）'
            : '这台设备还没开启手机批准（设置 → 这台设备 → 手机批准）；也可以回到 Mac 上批准' }),
      status);
  }
  const opts = d.options || [];
  const rec = String(d.recommend || '');
  const isRec = (o) => !!rec && !!o.name && (rec === o.name || rec.startsWith(String(o.name)));
  if (!doTask) onlyText = button('只发这句', () => send(''), { disabled: busy || !input.value.trim() });
  // 要你做一件事、而且写全了三项（新卡）：做什么 / 为什么要你做 / 做完应该看到什么，分三行
  const three = doTask && (d.what || d.expected);
  return h('section', { class: ['block', 'decision', 'is-action', doTask ? 'is-task' : ''], attrs: { 'data-handler': d.handler || null, 'data-need': doTask ? 'owner_physical_action' : 'owner_action' } },
    kindTag(doTask ? '要你动手' : '要你选'),
    h('h3', { class: 'block-title', text: TITLE[d.handler] || '等你决定' }),
    three
      ? rows([['要你做什么', said(d.what || d.question)], ['为什么要你做', said(d.why)], ['做完应该看到', said(d.expected)]])
      : h('p', { class: 'question', text: said(d.question) }),
    !three && d.why ? h('p', { class: 'why' }, h('span', { class: 'label', text: '为什么现在要定' }), h('span', { text: d.why })) : null,
    // 要她做一件事：结果框放在选项前面，最醒目
    doTask ? reply : null,
    opts.length ? h('ol', { class: 'options' }, opts.map((o) => h('li', { class: ['option', isRec(o) ? 'is-recommended' : ''] },
      h('p', { class: 'option-name' }, h('span', { text: o.name || '（没有名字的选项）' }), isRec(o) ? h('span', { class: 'tag', text: '推荐' }) : null),
      o.gain ? h('p', {}, h('span', { class: 'label', text: '会得到' }), h('span', { text: o.gain })) : null,
      o.cost ? h('p', {}, h('span', { class: 'label', text: '代价' }), h('span', { text: o.cost })) : null))) : null,
    d.recommend ? h('p', { class: 'recommend' }, h('span', { class: 'label', text: '推荐' }), h('span', { text: d.recommend })) : null,
    doTask ? null : reply,
    h('div', { class: 'decision-actions' }, opts.map((o) => button(doTask ? String(o.name || '') : `选「${o.name}」`, () => send(String(o.name || '').slice(0, 200)), { primary: !/取消|结束/.test(String(o.name || '')), disabled: busy || !o.name })), onlyText),
    status);
}
