// 等她决定的卡片（docs/UI.md §4）：首页「等你决定」和任务页最上面用同一张。
// 普通决定：问题 / 为什么现在要定 / 每个选项的会得到、代价 / 推荐 / 按钮；敏感操作：要做什么 / 为什么 / 影响 / 回滚 + 批准 / 不批准（只能在 Mac 本机页面上批）。
// 入口自己提的几类（decision.handler）：
//   life-zoe       需要你做一件事：问题写要她做什么，文字框写做完的结果，两个按钮（接着做 / 取消这个任务）
//   life-none      按原来的要求做不到了：换个方式再试 / 按现在的结论结束
//   site-conflict  她指定的模型在需要的那台机器上跑不了
// 回答带着决定的指纹（d.fp）；这一条已经答过（还在路上，或者入口已经收下、页面还没刷新到）时按钮先不让再点。
import { h } from '../lib/dom.mjs';
import { rows, button, statusLine, latest } from './common.mjs';

const said = (s) => (s && String(s).trim() ? String(s) : '没写');
const TITLE = { 'life-zoe': '需要你做一件事', 'life-none': '按原来的要求做不到了', 'site-conflict': '你指定的模型在这台机器上跑不了' };
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
      status);
  }
  const opts = d.options || [];
  const rec = String(d.recommend || '');
  const isRec = (o) => !!rec && !!o.name && (rec === o.name || rec.startsWith(String(o.name)));
  if (!doTask) onlyText = button('只发这句', () => send(''), { disabled: busy || !input.value.trim() });
  return h('section', { class: ['block', 'decision', doTask ? 'is-task' : ''], attrs: { 'data-handler': d.handler || null } },
    h('h3', { class: 'block-title', text: TITLE[d.handler] || '等你决定' }),
    h('p', { class: 'question', text: said(d.question) }),
    d.why ? h('p', { class: 'why' }, h('span', { class: 'label', text: '为什么现在要定' }), h('span', { text: d.why })) : null,
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
