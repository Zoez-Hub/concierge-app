// ① 说要什么（设计整合：Composer 卡）：输入框 + 工具条（左：图片 / 文件；右：齿轮 / 发送圆钮）。聚焦或有字时展开出：额外要求、
// 常用标签（一行静音芯片，长按 / ⋯ 菜单照旧）、附件能力提示。「发送」先出确认表，确认了才送出。
// 输入框本身写在 index.html 里（首屏就有），这里只接事件、画标签、附件和执行偏好面板。
// 什么都没写、偏好是自动、没有附件时，点到别处（或者用键盘离开）才收起；输入区里点来点去不收（手机上点按钮不一定拿到焦点）。
// 执行偏好（齿轮）：桌面右侧面板 / 手机底部面板（<dialog>）。顺序：在哪里做 → 主执行模型（按 Claude / GPT 分组，GPT 标只能在 Mac）→ Effort
// → 子代理 → 子代理模型 → 咨询 → GPT Chat 参与（不参与 / 协调 / 协调 + 小动工 = 咨询 GPT Web 协调者 + 允许小动工）→ 范围。
// 冲突 fail-closed（choices.mjs 的 conflicts）：有冲突时「好」和发送都禁用，写明冲突在哪，不在后台悄悄换。
import { h, clear } from '../lib/dom.mjs';
import * as C from '../lib/choices.mjs';
import * as F from '../lib/format.mjs';
import { button } from './common.mjs';
import { icon } from './icons.mjs';
import { attachState, attachIds, attachBusy, attachFailed, attachNames, attachClear, renderAttach, attachPickers, syncAttach } from './attach.mjs';
import { preflightOf, cleanPreauth } from '../lib/proto.mjs';

const $ = (id) => document.getElementById(id);
const LONG_PRESS_MS = 500;
const SUB_NOTE = '自动：一般不开，分诊认为有并行价值时才开。0 是硬限制；1、2 是写给会话的要求，实际用了几个会在结果里如实显示。';
const CODEX_NOTE = '模型和 effort 由 Concierge 指定，结果里会核对实际值。';
const CLAUDE_CONSULT_NOTE = '模型和 effort 由 Concierge 指定；Claude 的日志核对不了实际档位，结果里写“已请求”。';
const SUBMODEL_NOTE = '会话里的子代理按这个模型开；实际用的是哪个模型，会在任务页「协作记录」里写明（日志核对不到的照实写）。';
const SCOPE_NOTE = '只研究：在 Mac 上是硬限制，会话只有只读工具，改不了文件；要在 Windows 上做的事现在做不到只研究，会先问你怎么办。只到草稿改动：可以改，但不申请合并。';
const GPTWEB_NOTE = '模型和思考档位在 ChatGPT 里由你自己选，Concierge 不能强制也核实不了。提交后到连着 Engineering Bridge 的那个 ChatGPT 对话里说一句“看 <任务号>”；普通的 ChatGPT 对话读不到任务。';
const wide = () => globalThis.matchMedia?.('(min-width: 1040px)').matches === true;
const slug = (s) => String(s ?? 'auto').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'x';

// 权限预检（hub#165 §15.3）：用和 Mac 分诊同一个函数（proto.preflightOf）列「这件事可能需要」——能预授权的每项一个勾（默认勾上，能取消），
// 不能预授权的写“到时单独批”；勾上的签进提交 prefs.preauth（cleanPreauth 只留清单里 preauthable 的）。齿轮里没有这个开关，只在这里。
// 预授权只能在 Mac 本机页面勾（终审 P1-B）：远端设备（local:false）不显示勾选，只列「这件事可能需要」，并说明预授权要在 Mac 上提交时勾
export function reviewPreflight(pf, picked, onChange = () => {}, { local = true } = {}) {
  if (!pf.length) return null;
  const items = pf.map((x) => {
    if (local && x.preauthable && x.runbook) {
      const id = `pf-${slug(x.runbook)}`;
      const box = h('input', { id, type: 'checkbox', checked: picked.has(x.runbook), attrs: { 'data-rb': x.runbook } });
      box.addEventListener('change', () => { if (box.checked) picked.add(x.runbook); else picked.delete(x.runbook); onChange(); });
      return h('li', { class: 'pf-item is-pre' }, h('label', { class: 'check-label', htmlFor: id }, box, ` 预授权：${x.title}`), h('span', { class: 'pf-why', text: x.why }));
    }
    return h('li', { class: 'pf-item is-sep', attrs: { 'data-pf': x.runbook || x.kind || '' } }, h('span', { class: 'pf-h' }, h('span', { class: 'pf-t', text: x.title }), h('span', { class: 'rv-tag', text: ' · 到时单独批' })), h('span', { class: 'pf-why', text: x.why }));
  });
  return h('div', { class: 'preflight', attrs: { id: 'review-preflight', role: 'group', 'aria-labelledby': 'review-preflight-h' } },
    h('h3', { class: 'sub-title', attrs: { id: 'review-preflight-h' }, text: '这件事可能需要' }),
    h('ul', { class: 'pf-list' }, items),
    !pf.some((x) => x.preauthable) ? h('p', { class: 'note', text: '这些到时都要单独批（它们不能预授权）。' })
      : local ? h('p', { class: 'note', text: '勾上的只对这个任务：到时工程申请这一步、参数核对得上就直接执行，不再问你；任务页「授权范围」里随时可以撤销。没勾的、不能预授权的到时单独批。' })
        : h('p', { class: 'note', attrs: { 'data-k': 'preauth-mac-only' }, text: '预授权要在 Mac 上提交时勾。从这台设备提交的，这些到时都单独批。' }));
}
// 确认了：勾上的预授权签进 prefs.preauth（cleanPreauth 只留清单里 preauthable 的；一个都没勾就没有这个字段，payload 原样）
export function withPreauth(payload, picked, actions = []) {
  const pre = cleanPreauth([...(picked || [])], Array.isArray(actions) ? actions : []);
  return pre.length ? { ...payload, prefs: { ...(payload.prefs || {}), preauth: pre } } : payload;
}

export function mountCompose(app) {
  const want = $('want');
  const extra = $('extra');
  const chipsBox = $('chips');
  const prefsOpen = $('prefs-open');
  const prefsSummary = $('prefs-summary');
  const prefsReset = $('prefs-reset');
  const panel = $('prefs-panel');
  const submit = $('submit');
  const status = $('compose-status');
  const menu = $('chip-menu');
  const box = $('compose');
  const more = $('compose-more');
  const attachBox = $('attach');
  const attachTools = $('attach-tools');
  const att = attachState();

  let prefs = C.emptyPrefs();
  let options = null;
  let chipKey = '';
  let open = false;
  let sending = false;
  let hint = null; // 刚送出之后的那句提示（format.mjs 的 submitHint 决定什么时候收起）

  // 一行起步，展开之后至少三行，随内容长高（改 rows，不写内联样式）
  let expanded = false;
  const grow = () => {
    want.rows = expanded ? 3 : 1;
    while (expanded && want.scrollHeight > want.clientHeight + 1 && want.rows < 16) want.rows += 1;
  };
  // 有东西在输入区里（字、额外要求、附件、改过的偏好、正在送出 / 确认）就不收起
  const holding = () => !!want.value.trim() || !!extra.value.trim() || att.items.length > 0 || !C.isAuto(prefs) || open || !!review || sending;
  function setExpanded(v) {
    if (expanded === v) return;
    expanded = v;
    more.hidden = !v;
    box.classList.toggle('is-open', v);
    grow();
    renderAttachBox(true);
  }
  box.addEventListener('focusin', () => setExpanded(true));
  want.addEventListener('input', () => { if (want.value) setExpanded(true); grow(); renderSend(); if (status.classList.contains('is-error')) say(''); });
  extra.addEventListener('input', () => renderChips(true));
  // 点到输入区以外（不算标签菜单、弹层）、或者键盘焦点移到输入区以外：什么都没有就收起。
  // 等这一下点完了再收（不在按下的时候收）：按下时就收起，下面的内容会往上挪，手指抬起时点到的就不是她要点的那一条了
  const outside = (el) => el && el.isConnected && !box.contains(el) && !el.closest?.('#chip-menu, #menu-backdrop, dialog');
  const later = (e) => setTimeout(() => { if (expanded && outside(e.target) && !holding() && !box.contains(document.activeElement)) setExpanded(false); }, 0);
  document.addEventListener('click', later);
  document.addEventListener('focusin', (e) => { if (expanded && outside(e.target) && !holding() && e.target !== document.body) later(e); });

  function say(text, kind = '') {
    status.textContent = text;
    status.className = ['status', 'compose-status', kind === 'error' ? 'is-error' : '', kind === 'done' ? 'is-done' : ''].filter(Boolean).join(' ');
  }
  // 发送圆钮：有冲突时不能发（fail-closed）；没写字时照样能点（点了说一句“先写一句”，不悄悄没反应）
  function renderSend() {
    const cf = C.conflicts(prefs, options);
    submit.disabled = sending || cf.length > 0;
    submit.setAttribute('aria-label', cf.length ? '提交任务（执行偏好有冲突，先解决）' : '提交任务');
  }

  // ---- 常用标签（设计稿没画：放在展开态工具条上方一行静音芯片） ----
  function renderChips(force = false) {
    const list = C.sortChips(options?.chips || []);
    const key = JSON.stringify([list, prefs, extra.value]);
    if (!force && key === chipKey) return;
    chipKey = key;
    const nodes = list.map((c) => {
      const on = C.chipOn(c, prefs, extra.value);
      const chip = h('button', {
        type: 'button', class: ['chip', on ? 'is-on' : '', c.pinned ? 'is-pinned' : ''], text: c.text,
        attrs: { 'aria-pressed': on ? 'true' : 'false', 'data-k': `chip:${c.text}` },
      });
      let timer = null; let longed = false;
      const cancel = () => { clearTimeout(timer); timer = null; };
      chip.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'mouse') return;
        longed = false;
        timer = setTimeout(() => { longed = true; openMenu(c, chip); }, LONG_PRESS_MS);
      });
      for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) chip.addEventListener(ev, cancel);
      chip.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); openMenu(c, chip); });
      chip.addEventListener('click', (e) => {
        if (longed) { longed = false; e.preventDefault(); return; }
        const next = C.toggleChip(c, prefs, extra.value);
        prefs = C.fixPrefs(next.prefs, options); extra.value = next.extra;
        renderAll();
      });
      const more2 = h('button', { type: 'button', class: 'chip-more', text: '⋯', attrs: { 'aria-label': `整理标签「${c.text}」`, 'aria-haspopup': 'menu' }, on: { click: () => openMenu(c, more2) } });
      return h('span', { class: 'chipgroup' }, chip, more2);
    });
    const add = h('button', { type: 'button', class: 'chip chip-add', text: '+', attrs: { 'aria-label': '把额外要求里的话存成常用标签' }, on: { click: addChips } });
    chipsBox.replaceChildren(...nodes, add);
    const pend = (app.chipNote || null);
    $('chips-status').textContent = pend || '';
  }

  async function addChips() {
    const texts = C.newChipTexts(options?.chips || [], extra.value);
    if (!texts.length) { $('chips-status').textContent = '先在「额外要求」里写一句短话（24 字以内），再点 +'; extra.focus(); return; }
    for (const t of texts) await app.chipAction('add', t);
  }

  function openMenu(c, anchor) {
    clear(menu);
    const close = () => { menu.hidden = true; $('menu-backdrop').hidden = true; anchor?.focus?.(); };
    const act = (action) => async () => { close(); await app.chipAction(action, c.text); };
    menu.append(
      h('p', { class: 'menu-title', text: c.text }),
      button(c.pinned ? '取消固定' : '固定', act(c.pinned ? 'unpin' : 'pin'), { attrs: { role: 'menuitem' } }),
      button('删除', act('delete'), { attrs: { role: 'menuitem' } }),
      button('取消', close, { cls: 'btn-quiet', attrs: { role: 'menuitem' } }),
    );
    menu.hidden = false; $('menu-backdrop').hidden = false;
    $('menu-backdrop').onclick = close;
    menu.onkeydown = (e) => { if (e.key === 'Escape') close(); };
    menu.querySelector('button')?.focus();
  }

  // ---- 执行偏好 ----
  function renderSummary() {
    const auto = C.isAuto(prefs);
    prefsSummary.textContent = `执行偏好：${C.summary(prefs, options)}`;
    // 有手选偏好时齿轮变黄铜并显示摘要（黄铜 =“你指定”）
    prefsOpen.classList.toggle('is-set', !auto);
    prefsReset.hidden = auto;
  }

  function setPrefs(next) { prefs = C.fixPrefs(next, options); renderAll(); }

  // 一组芯片式单选（真的 radio：键盘方向键、读屏都照常；芯片只是外观）。hints：这一组下面的说明行
  function segs(name, legend, items, current, onPick, { sub = null, hints = [], id = null } = {}) {
    return h('fieldset', { class: 'fs', attrs: id ? { id } : {} },
      h('legend', {}, legend, sub ? h('span', { class: 'sub', text: sub }) : null),
      h('div', { class: 'segs' }, items.map((it) => {
        if (it.heading) return h('p', { class: 'grp choice-group', text: it.heading });
        const iid = it.id || `${name}-${slug(it.value)}`;
        const input = h('input', { type: 'radio', name, id: iid, checked: it.value === current, disabled: !!it.disabled, attrs: { 'data-k': iid } });
        input.addEventListener('change', () => { if (input.checked) onPick(it.value); });
        return h('label', { class: ['seg', 'choice', it.disabled ? 'is-disabled' : ''], htmlFor: iid, attrs: it.why ? { title: it.why } : {} }, input, it.label);
      })),
      hints.filter(Boolean).map((x) => (typeof x === 'string' ? h('p', { class: 'hint-line note', text: x }) : x)));
  }

  function renderPanel() {
    const focusKey = panel.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
    const o = options || { models: [], consult: [] };
    const verified = (at) => (at ? `上次实测 ${F.day(at)}` : '按配置，还没实测过');
    const groups = C.modelGroups(o);
    const winOnly = prefs.site === 'windows';
    const pickedModel = C.modelOf(o, prefs.model);
    // 主执行模型：Claude 和 GPT（Codex）都列（同一份登记），按命令行分组；GPT 那一组标“只能在 Mac 上跑”
    const models = [{ value: null, label: '自动', id: 'p-model-auto' },
      ...groups.flatMap((g) => [...(groups.length > 1 || g.provider === 'codex' ? [{ heading: g.provider === 'codex' ? `${g.label} · 只能在 Mac 上跑` : g.label }] : []),
        ...g.models.map((m) => ({ value: m.id, label: m.name, id: `p-model-${m.id}` }))])];
    const modelHint = !pickedModel ? C.autoModelText(o).replace(/^自动：/, '自动：') : `${pickedModel.name}：${C.modelSub(pickedModel)}`;
    const efforts = C.effortChoices(o, prefs.model);
    const subs = C.subagentChoices(o);
    const subUse = C.subagentModelUsable(prefs, o);
    const consults = (o.consult || []).filter((x) => !x.async);
    const asyncOpt = (o.consult || []).find((x) => x.async) || null;
    const c = prefs.consult;
    const picked = c.mode === 'named' ? C.findConsult(o, c.key) : null;
    const coordSt = asyncOpt ? F.coordinatorStatus(asyncOpt) : null;
    const sw = F.smallWorkNote(o.smallWork);
    const gpt = C.gptChatValue(prefs, o);
    const cf = C.conflicts(prefs, o);
    const ws = o.windowsSite;

    const parts = [
      segs('p-site', '在哪里做', [
        { value: null, label: '自动' },
        { value: 'mac', label: 'Mac' },
        { value: 'windows', label: 'Windows', disabled: ws?.available === false, why: ws?.available === false ? ws.why : null },
      ], prefs.site ?? null, (v) => setPrefs({ ...prefs, site: v }), {
        sub: '自动按这件事要的现场选；手选是硬约束',
        hints: [prefs.site ? h('p', { class: 'hint-line hard', text: `你指定了 ${C.SITE_NAME[prefs.site]}：做不了会先停下来问你，不会偷偷换地方。${prefs.site === 'windows' ? 'Windows 上只有 Claude 做主执行。' : ''}` })
          : '自动：按这件事要的现场选；原话里写了“只在 Mac 做”“不派给 Windows”的照办。',
        ws?.available === false ? `Windows：${ws.why}` : null],
      }),
      segs('p-model', '主执行模型', models, prefs.model, (v) => setPrefs({ ...prefs, model: v, effort: null }), {
        sub: '只列实测调得通的',
        hints: [modelHint, winOnly && C.macOnly(pickedModel) ? null : null],
      }),
      prefs.model && !efforts.length ? null
        : segs('p-effort', 'Effort', prefs.model ? [{ value: null, label: '自动' }, ...efforts.map((e) => ({ value: e, label: e }))] : [{ value: null, label: '自动' }], prefs.effort, (v) => setPrefs({ ...prefs, effort: v }), {
          sub: prefs.model ? `只列 ${pickedModel?.name || '这个模型'} 原生的档位` : '模型选自动时只有自动',
          hints: [prefs.model ? null : '模型选「自动」时，effort 也是自动。'],
        }),
      segs('p-sub', '子代理', [{ value: null, label: '自动' }, ...subs.map((n) => ({ value: n, label: String(n) }))], prefs.subagents, (v) => setPrefs({ ...prefs, subagents: v }), { hints: [SUB_NOTE] }),
      // hub#165 §6：子代理用什么模型。个数 0 或主执行是 Codex 时置灰，写明为什么
      segs('p-submodel', '子代理用什么模型', [
        { value: null, label: '自动' },
        { value: 'haiku', label: F.subagentModelName('haiku', o) },
        { value: 'sonnet', label: F.subagentModelName('sonnet', o) },
        { value: 'main', label: '跟随主模型' },
      ].map((x) => (subUse.ok ? x : { ...x, disabled: true })), prefs.subagentModel, (v) => setPrefs({ ...prefs, subagentModel: v }), {
        hints: [h('p', { class: 'hint-line note', attrs: { id: 'p-submodel-note' }, text: subUse.ok ? (prefs.subagentModel ? SUBMODEL_NOTE : `自动：${F.SUBAGENT_AUTO_NOTE}`) : subUse.why })],
      }),
      // 咨询：另一个模型给意见（本机的 Codex 等）。GPT Web 协调者在下面一组「GPT Chat 参与」
      segs('p-consult', '咨询', [
        { value: 'auto', label: '自动', id: 'p-consult-auto' },
        { value: 'none', label: '不咨询', id: 'p-consult-none' },
        ...consults.map((x) => ({ value: C.consultKey(x), label: x.label, id: `p-consult-${slug(C.consultKey(x))}` })),
      ], gpt !== 'none' ? '__gpt' : c.mode === 'named' ? c.key : c.mode, (v) => {
        if (v === 'auto' || v === 'none') setPrefs({ ...prefs, consult: { ...C.emptyPrefs().consult, mode: v } });
        else setPrefs({ ...prefs, consult: { mode: 'named', key: v, effort: null, max: 1, smallWork: false } });
      }, {
        sub: '另一个模型给意见，和子代理是两回事',
        hints: [
          gpt !== 'none' ? '这一轮的咨询给了 GPT Chat（下面「GPT Chat 参与」）：一个任务同时只指定一个咨询对象。' : null,
          c.mode === 'auto' && gpt === 'none' ? '自动：分诊觉得值得第二个模型看一眼时咨询 1 次，否则不咨询。' : null,
          picked && !picked.async ? `${C.providerOf(picked) === 'claude' && picked.target !== 'codex' ? CLAUDE_CONSULT_NOTE : CODEX_NOTE}${picked.verifiedAt ? ` ${verified(picked.verifiedAt)}。` : ''}` : null,
          '咨询有没有真的发生、发生了几次，会写在任务页的协作记录里。',
        ],
      }),
      picked && picked.controllable && !picked.async ? segs('p-ceffort', '咨询 effort', [{ value: null, label: '自动' }, ...(picked.efforts || []).map((e) => ({ value: e, label: e }))], c.effort, (v) => setPrefs({ ...prefs, consult: { ...c, effort: v } })) : null,
      picked && !picked.async ? segs('p-cmax', '最多咨询几次', [{ value: 1, label: '1 次' }, { value: 2, label: '2 次' }], c.max, (v) => setPrefs({ ...prefs, consult: { ...c, max: v } })) : null,
      // GPT Chat 参与：不参与 / 协调（= 咨询 GPT Web 协调者，先等它的意见）/ 协调 + 小动工（再允许 Luna 小动工）。没有连接证据时置灰并写原因
      segs('p-gpt', 'GPT Chat 参与', [
        { value: 'none', label: '不参与', id: 'p-gpt-none' },
        { value: 'coord', label: '协调', id: 'p-gpt-coord', disabled: !coordSt?.connected },
        { value: 'coord-sw', label: '协调 + 小动工', id: 'p-smallwork', disabled: !coordSt?.connected || !sw.available },
      ], gpt, (v) => {
        if (v === 'none') setPrefs({ ...prefs, consult: gpt !== 'none' ? C.emptyPrefs().consult : prefs.consult });
        else setPrefs({ ...prefs, consult: { mode: 'named', key: C.consultKey(asyncOpt), effort: null, max: 1, smallWork: v === 'coord-sw' } });
      }, {
        hints: [
          !asyncOpt ? '还没接通：Mac 上没有开 Engineering Bridge。现在选了也没人看。'
            : coordSt.connected ? (gpt !== 'none' ? `${coordSt.text}。${GPTWEB_NOTE}` : coordSt.text) : `${coordSt.text}。现在选了也没人看。`,
          asyncOpt ? h('p', { class: 'hint-line note', attrs: { id: 'p-smallwork-note' }, text: sw.text }) : null,
          'GPT Chat 只协调，不执行；执行的永远是上面选的模型。',
        ],
      }),
      // hub#165 §6：执行范围（放在最后）
      segs('p-scope', '范围', [
        { value: null, label: '自动' },
        { value: 'research', label: '只研究' },
        { value: 'fix', label: '可修复' },
        { value: 'pr', label: '只到草稿改动' },
      ], prefs.scope, (v) => setPrefs({ ...prefs, scope: v }), {
        hints: [prefs.scope ? `${C.SCOPE_NAME[prefs.scope]}：${F.SCOPE_TEXT[prefs.scope]}` : `自动：${F.SCOPE_TEXT.fix}`, SCOPE_NOTE],
      }),
      cf.length ? h('div', { class: 'conflicts', attrs: { role: 'alert', id: 'prefs-conflicts' } }, cf.map((x) => h('p', { class: 'conflict' }, h('span', { class: 'dot brass', attrs: { 'aria-hidden': 'true' } }), h('span', { text: x })))) : null,
      h('div', { class: 'promise' }, h('span', { class: 'sub-title', text: '提交后会这样执行' }), h('p', { class: 'note', text: C.summary(prefs, o) === '自动' ? '全部自动：分诊之后定下来的方案写在任务页的「执行方案」里。' : `你指定了：${C.summary(prefs, o)}；其余自动。手选的都是硬约束，做不到会先问你。` })),
    ];
    const isWide = wide();
    const shape = isWide ? 'side' : 'sheet';
    panel.className = `ov ov-${shape} prefs-panel`;
    const ok = button('好', () => setOpen(false), { primary: true, disabled: cf.length > 0, attrs: { 'data-k': 'prefs-ok' } });
    panel.replaceChildren(h('div', { class: 'ov-in' },
      shape === 'sheet' ? h('div', { class: 'grab', attrs: { 'aria-hidden': 'true' } }) : null,
      h('div', { class: 'ov-h' }, h('h2', { id: 'prefs-title', class: 'panel-title', text: '执行偏好' }),
        h('button', { type: 'button', class: 'ov-x', attrs: { 'aria-label': '关闭执行偏好' }, on: { click: () => setOpen(false) } }, icon('x'))),
      h('div', { class: 'ov-b' }, h('div', { class: 'pref' }, parts.filter(Boolean))),
      h('div', { class: 'ov-f panel-actions' },
        h('span', { class: 'note', text: cf.length ? '先解决冲突。' : '只对这一条任务有效。' }),
        button('恢复自动', () => setPrefs(C.emptyPrefs()), { cls: 'btn-quiet', attrs: { 'data-k': 'prefs-auto' } }), ok)));
    if (focusKey) panel.querySelector(`[data-k="${CSS.escape(focusKey)}"]`)?.focus();
  }

  function setOpen(v) {
    open = v;
    prefsOpen.setAttribute('aria-expanded', v ? 'true' : 'false');
    document.body.classList.toggle('sheet-open', v);
    if (v) {
      renderPanel();
      if (!panel.open) panel.showModal();
      panel.querySelector('input:checked, input:not([disabled]), button')?.focus();
    } else {
      if (panel.open) panel.close();
      prefsOpen.focus();
    }
    renderSend();
  }
  prefsOpen.addEventListener('click', () => setOpen(!open));
  prefsReset.addEventListener('click', () => setPrefs(C.emptyPrefs()));
  // Esc：关面板（dialog 的 cancel）；有冲突时照样能关（冲突还在，发送仍然禁用）
  panel.addEventListener('cancel', (e) => { e.preventDefault(); setOpen(false); });
  panel.addEventListener('click', (e) => { if (e.target === panel) setOpen(false); });

  function renderAll() {
    renderSummary();
    renderChips();
    renderAttachBox();
    if (open) renderPanel();
    if (holding()) setExpanded(true);
    renderSend();
  }

  // ---- 附件 ----
  let attachKey = '';
  function renderAttachBox(force = false) {
    syncAttach(app, att);
    const key = JSON.stringify([att.items.map((x) => [x.key, x.state, x.error, x.bytes]), att.note, app.macOnline(), expanded]);
    if (!force && key === attachKey) return;
    attachKey = key;
    const ae = document.activeElement;
    const focusId = ae && (attachBox.contains(ae) || attachTools.contains(ae)) ? ae.getAttribute('aria-label') || ae.id : null;
    const onChange = () => { renderAttachBox(true); if (att.items.length) setExpanded(true); };
    attachBox.replaceChildren(...renderAttach(app, att, { id: 'attach', onChange, hint: expanded }).filter(Boolean));
    attachTools.replaceChildren(...attachPickers(app, att, { id: 'attach', onChange }));
    // 重画之后焦点还在原来那个按钮上（删掉的那一个没了：落回「添加文件」）
    if (focusId) ([...attachBox.querySelectorAll('button'), ...attachTools.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === focusId || b.id === focusId) || $('attach-add'))?.focus();
  }

  // ---- 发送：先确认，确认了才送出 ----
  // 确认表列出这次要送出去的全部内容（原话、额外要求、附件数、每一项执行偏好，写明“自动”还是“你指定”）。
  // 确认之前不调 transport、不建任务；「返回修改」什么都不动；快捷键也走这里；一次确认只送一次（送出中、确认框开着时再按都不算）
  let review = null;
  function onSubmit(e) {
    e?.preventDefault?.();
    if (sending || review) return;
    if (!want.value.trim()) { say('先写一句你要什么，或者哪里不对。', 'error'); want.focus(); return; }
    const cf = C.conflicts(prefs, options);
    if (cf.length) { say(`执行偏好有冲突，先解决：${cf[0]}`, 'error'); setOpen(true); return; }
    syncAttach(app, att);
    if (attachBusy(att)) { say(app.local || app.macOnline() ? '附件还没传好，等一下再提交。' : '附件还在等 Mac 收下（Mac 现在不在线，上线后收）。等附件传好再提交，或者先删掉附件。', 'error'); return; }
    if (attachFailed(att)) { say('有附件没传上：删掉它，或者点「重传」，再提交。', 'error'); return; }
    const ids = attachIds(att);
    const payload = { want: want.value.trim(), extra: extra.value.trim(), prefs: C.toPayload(prefs, options), chips: C.activeChips(options?.chips || [], prefs, extra.value), ...(ids.length ? { attachments: ids } : {}) };
    const files = attachNames(att);
    const shownPrefs = JSON.stringify(payload.prefs);
    const isWide = wide();
    const dialog = h('dialog', { class: ['ov', isWide ? 'ov-dialog' : 'ov-sheet', 'submit-review'], attrs: { 'aria-labelledby': 'review-title' } });
    review = dialog;
    let done = false;
    const close = () => { if (done) return; done = true; if (dialog.open) dialog.close(); dialog.remove(); review = null; renderSend(); };
    const back = button('返回修改', () => { close(); want.focus(); });
    const confirm = button('确认提交', () => {
      if (done || sending) return;
      // 确认框开着的时候 Mac 那边的可选项变了（比如模型重新实测过），这一次的偏好可能已经不是她看到的：不送，请她再看一眼
      if (JSON.stringify(C.toPayload(prefs, options)) !== shownPrefs) { close(); say('可选的执行偏好刚刚变了，再确认一次。', 'error'); submit.focus(); return; }
      // 勾上的预授权签进 prefs.preauth（只留清单里 preauthable 的；一个都没勾就没有这个字段）
      close(); submit.focus(); send(withPreauth(payload, picked, Array.isArray(options?.actions) ? options.actions : []));
    }, { primary: true });
    const set = C.reviewSet(prefs, options);
    const prefRows = C.reviewRows(prefs, options);
    // 预检：和 Mac 分诊同一个函数；能预授权的默认勾上
    const acts = Array.isArray(options?.actions) ? options.actions : [];
    const pf = preflightOf({ want: payload.want, extra: payload.extra }, acts);
    // 远端设备不能给预授权（终审 P1-B）：不勾、不显示「预授权」那一行，提交里也就没有 prefs.preauth
    const local = !!app.local;
    const picked = new Set(local ? pf.filter((x) => x.preauthable && x.runbook).map((x) => x.runbook) : []);
    const titleOf = (id) => pf.find((x) => x.runbook === id)?.title || id;
    const preText = () => (picked.size ? [...picked].map(titleOf).join('、') : '没有');
    const preDd = h('dd', {}, preText());
    const preRow = local && pf.some((x) => x.preauthable) ? h('div', { class: 'row', attrs: { 'data-k': 'review-preauth' } }, h('dt', { text: '预授权' }), preDd) : null;
    dialog.append(h('div', { class: 'ov-in' },
      isWide ? null : h('div', { class: 'grab', attrs: { 'aria-hidden': 'true' } }),
      h('div', { class: 'ov-h' }, h('h2', { class: 'review-title', id: 'review-title', text: '确认提交这个任务' })),
      h('div', { class: 'ov-b' },
        h('p', { class: 'review-want', text: payload.want }),
        h('dl', { class: 'rows' }, [
          ['额外要求', payload.extra || '没有', null],
          ['附件', files.length ? `${files.length} 个：${files.join('、')}` : '没有', null],
          ...prefRows.map(([k, v], i) => [k, v, set[i]]),
        ].map(([k, v, s]) => h('div', { class: 'row' }, h('dt', { text: k }), h('dd', {}, v, s === null ? null : h('span', { class: ['rv-tag', s ? 'is-set' : ''], text: s ? ' · 你指定' : ' · 自动' })))), preRow),
        reviewPreflight(pf, picked, () => { preDd.textContent = preText(); }, { local }),
        h('p', { class: 'note', text: '“自动”的那几项提交之后由 Concierge 分诊决定，定下来的方案会写在任务页的「执行方案」里。确认之后才会建任务。' })),
      h('div', { class: 'ov-f review-actions' }, h('span', { class: 'note', text: '送出去的就是这些。' }), back, confirm)));
    dialog.addEventListener('cancel', (ev) => { ev.preventDefault(); close(); want.focus(); });
    document.body.append(dialog);
    dialog.showModal();
    confirm.focus();
  }
  async function send(payload) {
    if (sending) return;
    const w = payload.want;
    if (!w) { say('先写一句你要什么，或者哪里不对。', 'error'); want.focus(); return; }
    sending = true; submit.disabled = true; say('正在送出…'); hint = null;
    const before = (app.view?.tasks || []).map((t) => t.ref);
    try {
      const r = await app.transport.submit(payload);
      if (r && r.ok === false) {
        // 没送出去而且不会自动重试（比如令牌没权限）：写的东西留在输入框里
        if (r.id && app.transport.discard) await app.transport.discard(r.id);
        say(`没送出去：${r.error || '原因不明'}（你写的还在，可以再点一次）`, 'error');
        return;
      }
      want.value = ''; extra.value = ''; prefs = C.emptyPrefs(); attachClear(att); grow(); setOpen(false);
      const online = app.macOnline();
      const kind = r?.state === 'sending' ? 'sending' : app.local || online ? 'sent' : 'offline';
      const text = { sending: '还没送出去，会自动重试。你写的已经存在这台设备上。', sent: '已送出。', offline: '已送出。Mac 现在不在线，上线后会领取。' }[kind];
      say(text, kind === 'sending' ? '' : 'done');
      // 这一条出现在任务列表里、被 Mac 领取、或者 Mac 又在线之后，这句就收起（update 里看）
      hint = r?.id ? { id: r.id, kind, text, want: w, before, seen: false } : null;
      renderAll();
      app.refreshSoon();
    } catch (err) {
      say(`没送出去：${err.message}（你写的还在，可以再点一次）`, 'error');
    } finally { sending = false; renderSend(); }
  }
  $('compose-form').addEventListener('submit', onSubmit);
  // 快捷键同样先确认
  want.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(e); });

  grow();
  renderSummary();
  renderAttachBox(true);
  renderSend();
  // 从任务页开后续任务（V2 验收反馈）：把她写的话放进「我要什么」、关联说明放进「额外要求」，展开、聚焦，等她加截图、确认提交。
  // 已经有没提交的内容时不覆盖，返回 false（页面提示她先处理工作台上那条）
  app.prefillCompose = ({ want: w = '', extra: x = '' } = {}) => {
    if (want.value.trim() || extra.value.trim() || att.items.length || sending) return false;
    want.value = String(w); extra.value = String(x);
    setExpanded(true); grow(); renderChips(true); renderSend();
    want.focus();
    return true;
  };
  return {
    update(view) {
      // 能不能手选 Windows 跟着接收器的能力走（choices.windowsSite），并进 options 一起比较
      const next = view?.board?.options ? { ...view.board.options, windowsSite: C.windowsSite(view.board) } : null;
      const k = JSON.stringify(next);
      if (k !== JSON.stringify(options)) { options = next; prefs = C.fixPrefs(prefs, options); }
      if (hint) {
        const h2 = F.submitHint(hint, { tasks: view?.tasks || [], pending: view?.board?.pending || [], outbox: app.outbox || [], online: app.macOnline(), local: app.local });
        // 只收起自己说的那句：之后又说了别的（比如出错）就不动
        if (!h2 && status.textContent === hint.text) say('');
        hint = h2;
      }
      renderAll();
    },
    rerenderChips() { renderChips(true); },
    // 远端附件的回执到了（app.actions 变了）：重画附件那一块
    refreshAttach() { renderAttachBox(); },
  };
}
