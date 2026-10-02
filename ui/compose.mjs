// ① 说要什么：输入框、额外要求、常用标签、执行偏好、「交给它」。
// 输入框本身写在 index.html 里（首屏就有），这里只接事件、画标签和偏好面板。
import { h, clear } from '../lib/dom.mjs';
import * as C from '../lib/choices.mjs';
import * as F from '../lib/format.mjs';
import { button } from './common.mjs';

const $ = (id) => document.getElementById(id);
const LONG_PRESS_MS = 500;
const SUB_NOTE = '0 是硬限制。1、2 是写给会话的要求，实际用了几个会在结果里如实显示。';
const CODEX_NOTE = '模型和 effort 由 Concierge 指定，结果里会核对实际值。';
const GPTWEB_NOTE = '模型和思考档位在 ChatGPT 里由你自己选，Concierge 不能强制也核实不了。提交后到 ChatGPT 说一句“看 <任务号>”。';

export function mountCompose(app) {
  const want = $('want');
  const extra = $('extra');
  const chipsBox = $('chips');
  const prefsOpen = $('prefs-open');
  const prefsSummary = $('prefs-summary');
  const prefsReset = $('prefs-reset');
  const panel = $('prefs-panel');
  const backdrop = $('prefs-backdrop');
  const submit = $('submit');
  const status = $('compose-status');
  const menu = $('chip-menu');

  let prefs = C.emptyPrefs();
  let options = null;
  let chipKey = '';
  let open = false;
  let sending = false;
  let hint = null; // 刚送出之后的那句提示（format.mjs 的 submitHint 决定什么时候收起）

  // 输入框随内容长高（改 rows，不写内联样式）
  const grow = () => {
    want.rows = 4;
    while (want.scrollHeight > want.clientHeight + 1 && want.rows < 16) want.rows += 1;
  };
  want.addEventListener('input', () => { grow(); if (status.classList.contains('is-error')) say(''); });
  extra.addEventListener('input', () => renderChips(true));

  function say(text, kind = '') {
    status.textContent = text;
    status.className = ['status', kind === 'error' ? 'is-error' : '', kind === 'done' ? 'is-done' : ''].filter(Boolean).join(' ');
  }

  // ---- 常用标签 ----
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
      const more = h('button', { type: 'button', class: 'chip-more', text: '⋯', attrs: { 'aria-label': `整理标签「${c.text}」`, 'aria-haspopup': 'menu' }, on: { click: () => openMenu(c, more) } });
      return h('span', { class: 'chipgroup' }, chip, more);
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
    prefsReset.hidden = auto;
  }

  function setPrefs(next) { prefs = C.fixPrefs(next, options); renderAll(); }

  function radios(name, legend, items, current, onPick, { note = null, cls = '' } = {}) {
    return h('fieldset', { class: ['group', cls] },
      h('legend', { text: legend }),
      h('div', { class: 'choices' }, items.map((it) => {
        const id = `${name}-${it.value ?? 'auto'}`;
        const input = h('input', { type: 'radio', name, id, checked: it.value === current, disabled: !!it.disabled, attrs: { 'data-k': id } });
        input.addEventListener('change', () => { if (input.checked) onPick(it.value); });
        return h('label', { class: ['choice', it.sub ? 'has-sub' : '', it.disabled ? 'is-disabled' : ''], htmlFor: id }, input,
          h('span', { class: 'choice-text' }, h('span', { class: 'choice-name', text: it.label }), it.sub ? h('span', { class: 'choice-sub', text: it.sub }) : null));
      })),
      note ? h('p', { class: 'note', text: note }) : null);
  }

  function renderPanel() {
    const focusKey = panel.contains(document.activeElement) ? document.activeElement.getAttribute('data-k') : null;
    const o = options || { models: [], consult: [] };
    const verified = (at) => (at ? `上次实测 ${F.day(at)}` : '按配置，还没实测过');
    const models = [{ value: null, label: '自动', sub: '不指定，用命令行默认的模型' }, ...(o.models || []).map((m) => ({ value: m.id, label: m.name, sub: verified(m.verifiedAt) }))];
    const efforts = C.effortChoices(o, prefs.model);
    const subs = C.subagentChoices(o);
    const consults = o.consult || [];
    const asyncOpt = consults.find((x) => x.async);
    const c = prefs.consult;
    const picked = c.mode === 'named' ? C.findConsult(o, c.key) : null;

    const parts = [h('h3', { class: 'panel-title', text: '执行偏好' }),
      h('div', { class: 'panel-sec' }, h('h4', { text: '主执行' }),
        radios('p-model', '模型', models, prefs.model, (v) => setPrefs({ ...prefs, model: v, effort: null })),
        prefs.model && !efforts.length ? null
          : radios('p-effort', 'Effort', prefs.model ? [{ value: null, label: '自动' }, ...efforts.map((e) => ({ value: e, label: e }))] : [{ value: null, label: '自动' }], prefs.effort, (v) => setPrefs({ ...prefs, effort: v }), { cls: 'is-inline', note: prefs.model ? null : '模型选「自动」时，effort 也是自动。' })),
      h('div', { class: 'panel-sec' }, h('h4', { text: '子代理' }),
        radios('p-sub', '最多几个子代理', [{ value: null, label: '自动' }, ...subs.map((n) => ({ value: n, label: String(n) }))], prefs.subagents, (v) => setPrefs({ ...prefs, subagents: v }), { cls: 'is-inline', note: SUB_NOTE })),
      h('div', { class: 'panel-sec' }, h('h4', { text: '咨询' }), h('p', { class: 'note', text: '另一个模型给意见，和子代理是两回事。' }),
        radios('p-consult', '要不要咨询', [{ value: 'auto', label: '自动' }, { value: 'none', label: '不咨询' }, { value: 'named', label: '指定', disabled: !consults.length }], c.mode, (v) => {
          const first = consults.find((x) => !x.async) || consults[0];
          setPrefs({ ...prefs, consult: { ...c, mode: v, key: v === 'named' ? (c.key || (first ? C.consultKey(first) : null)) : null } });
        }, { cls: 'is-inline', note: c.mode === 'auto' ? '自动：分诊觉得值得第二个模型看一眼时咨询 1 次，否则不咨询。' : null }),
        c.mode === 'named' ? radios('p-target', '咨询谁', [
          ...consults.map((x) => {
            if (!x.async) return { value: C.consultKey(x), label: x.label, sub: `${CODEX_NOTE}${x.verifiedAt ? ` ${verified(x.verifiedAt)}。` : ''}` };
            // GPT Web 协调者：只写能观测到的连接事实（上次被调用的时间、隧道在不在跑）；还没接通就不能选
            const st = F.coordinatorStatus(x);
            return { value: C.consultKey(x), label: x.label, sub: st.connected ? `${st.text}。${GPTWEB_NOTE}` : `${st.text}：Mac 上还没有看到它连过来，现在选了也没人看。`, disabled: !st.connected };
          }),
          ...(asyncOpt ? [] : [{ value: '__gptweb', label: 'GPT Web 协调者', sub: '还没接通：Mac 上没有开 Engineering Bridge。', disabled: true }]),
        ], c.key, (v) => setPrefs({ ...prefs, consult: { ...c, key: v, effort: null, max: 1, smallWork: false } })) : null,
        picked && picked.controllable && !picked.async ? radios('p-ceffort', '咨询 effort', [{ value: null, label: '自动' }, ...(picked.efforts || []).map((e) => ({ value: e, label: e }))], c.effort, (v) => setPrefs({ ...prefs, consult: { ...c, effort: v } }), { cls: 'is-inline' }) : null,
        picked && !picked.async ? radios('p-cmax', '最多咨询几次', [{ value: 1, label: '1 次' }, { value: 2, label: '2 次' }], c.max, (v) => setPrefs({ ...prefs, consult: { ...c, max: v } }), { cls: 'is-inline' }) : null,
        picked && picked.async ? smallWorkToggle(o, c) : null),
      h('div', { class: 'panel-actions' }, button('恢复自动', () => setPrefs(C.emptyPrefs()), { cls: 'btn-quiet' }), button('完成', () => setOpen(false))),
    ];
    panel.replaceChildren(...parts);
    if (focusKey) panel.querySelector(`[data-k="${CSS.escape(focusKey)}"]`)?.focus();
  }

  // 允许小动工：执行者是 Mac 上的 Luna（board.options.smallWork）。不能开时置灰，写 Mac 给的原因
  function smallWorkToggle(o, c) {
    const note = F.smallWorkNote(o.smallWork);
    const id = 'p-smallwork';
    const input = h('input', { type: 'checkbox', id, checked: !!c.smallWork, disabled: !note.available, attrs: { 'data-k': id, role: 'switch' } });
    input.addEventListener('change', () => setPrefs({ ...prefs, consult: { ...c, smallWork: input.checked } }));
    return h('div', { class: ['toggle', note.available ? '' : 'is-disabled'] },
      h('label', { class: 'toggle-row', htmlFor: id }, input, h('span', { class: 'choice-text' }, h('span', { class: 'choice-name', text: '允许小动工（只对这一个任务）' }),
        h('span', { class: 'choice-sub', attrs: { id: 'p-smallwork-note' }, text: note.text }))));
  }

  function setOpen(v) {
    open = v;
    panel.hidden = !v;
    backdrop.hidden = !v;
    prefsOpen.setAttribute('aria-expanded', v ? 'true' : 'false');
    document.body.classList.toggle('sheet-open', v);
    if (v) { renderPanel(); panel.querySelector('input:checked, input, button')?.focus(); } else prefsOpen.focus();
  }
  prefsOpen.addEventListener('click', () => setOpen(!open));
  prefsReset.addEventListener('click', () => setPrefs(C.emptyPrefs()));
  backdrop.addEventListener('click', () => setOpen(false));
  panel.addEventListener('keydown', (e) => { if (e.key === 'Escape') setOpen(false); });

  function renderAll() {
    renderSummary();
    renderChips();
    if (open) renderPanel();
  }

  // ---- 交给它 ----
  async function onSubmit(e) {
    e?.preventDefault?.();
    if (sending) return;
    const w = want.value.trim();
    if (!w) { say('先写一句你要什么，或者哪里不对。', 'error'); want.focus(); return; }
    sending = true; submit.disabled = true; say('正在送出…'); hint = null;
    const before = (app.view?.tasks || []).map((t) => t.ref);
    try {
      const payload = { want: w, extra: extra.value.trim(), prefs: C.toPayload(prefs, options), chips: C.activeChips(options?.chips || [], prefs, extra.value) };
      const r = await app.transport.submit(payload);
      if (r && r.ok === false) {
        // 没送出去而且不会自动重试（比如令牌没权限）：写的东西留在输入框里
        if (r.id && app.transport.discard) await app.transport.discard(r.id);
        say(`没送出去：${r.error || '原因不明'}（你写的还在，可以再点一次）`, 'error');
        return;
      }
      want.value = ''; extra.value = ''; prefs = C.emptyPrefs(); grow(); setOpen(false);
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
    } finally { sending = false; submit.disabled = false; }
  }
  $('compose-form').addEventListener('submit', onSubmit);
  // 桌面上 ⌘/Ctrl + Enter 直接交
  want.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onSubmit(e); });

  grow();
  renderSummary();
  return {
    update(view) {
      const next = view?.board?.options || null;
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
  };
}
