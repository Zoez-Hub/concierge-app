// 手机批准（hub#152，docs/ACTIONS.md §手机批准）的两块界面：
//   设备上（设置 → 这台设备）：开启 / 关掉；开启后显示 6 位核对码，请她敲进 Mac 本机页面
//   Mac 本机页面（设置 → 设备列表里每台设备一行）：敲手机上显示的核对码确认开启；关掉
// Mac 页面不显示核对码（她要从手机上抄过来），所以别人在 GitHub 上替设备“申请开启”也开不了。
import { h } from '../lib/dom.mjs';
import { button } from './common.mjs';
import { normalizePasskeyCode } from '../lib/passkey.mjs';

// 只在内存里
const st = { busy: false, code: null, error: null, local: undefined, typed: new Map(), macMsg: new Map() };

// 看板里这台设备的手机批准状态：'active' | 'pending' | null
export function passkeyState(app) {
  const id = app.transport.status?.()?.device?.id;
  const me = (app.view?.board?.devices || []).find((x) => x && x.id === id);
  return me?.passkey || null;
}

const group = (c) => (c ? `${c.slice(0, 3)} ${c.slice(3)}` : '');

export function phoneApprovalSection(app) {
  const caps = app.transport.capabilities || {};
  if (caps.local) return null;
  const state = passkeyState(app);
  if (st.local === undefined) { st.local = null; app.transport.passkeyLocal?.().then((x) => { st.local = x; app.render(); }).catch(() => {}); }
  const code = st.code || st.local?.code || null;
  const parts = [h('h4', { class: 'sub-title', text: '手机批准（面容 ID）' })];
  if (!caps.passkey) {
    parts.push(h('p', { class: 'note', text: '这个浏览器用不了面容 ID 批准。要在 iPhone 上批准受限执行器的动作，用 iOS 17 或更新的 Safari（添加到主屏幕后从主屏幕打开也可以）。不开也没关系：回到 Mac 上照样能批。' }));
    return h('div', { class: 'passkey-box' }, parts);
  }
  if (state === 'active') {
    parts.push(h('p', { class: 'status is-done', text: '已开启：批准受限执行器的动作时，会要你的面容 ID。' }),
      h('p', { class: 'note', text: '要关掉或换一把，在 Mac 上：设置 → 设备。' }));
  } else if (state === 'pending' || code) {
    parts.push(h('p', { text: '还差一步：在 Mac 上打开 Concierge → 设置 → 设备，在这台设备那一行输入下面的核对码，点“确认开启”。' }),
      h('p', { class: 'confirm-line' }, '核对码：', h('span', { class: 'confirm-digits', attrs: { id: 'passkey-code' }, text: code ? group(code) : '（读不到，重新开启一次）' })),
      button('重新开启', () => enroll(app), { cls: 'btn-quiet', disabled: st.busy }));
  } else {
    parts.push(h('p', { text: '开启后，工程申请的受限动作（比如把新版本装到这台 iPhone、合并一个改动）可以直接在这里用面容 ID 批准，不用回到 Mac。每次批准都要面容 ID，签的就是那一张卡、那一个动作。' }),
      button(st.busy ? '正在开启…' : '开启手机批准', () => enroll(app), { primary: true, disabled: st.busy }));
  }
  if (st.error) parts.push(h('p', { class: 'status is-error', attrs: { role: 'status' }, text: st.error }));
  return h('div', { class: 'passkey-box' }, parts);
}

async function enroll(app) {
  if (st.busy) return;
  st.busy = true; st.error = null; app.render();
  try { const r = await app.transport.passkeyEnroll(); st.code = r.code; st.local = undefined; } catch (e) { st.error = e.message || '没有开启'; }
  st.busy = false; app.render();
}

// Mac 本机页面：设备列表里一台设备的手机批准状态和操作
export function macPasskeyControl(app, x) {
  if (!app.transport.capabilities?.local || x.role === 'coordinator') return null;
  if (x.passkey === 'active') {
    let sure = false;
    const off = button('关掉手机批准', async () => {
      if (!sure) { sure = true; off.textContent = '确认关掉'; return; }
      await app.act(() => app.transport.revokePasskey(x.id)); await app.loadDevices();
    }, { cls: 'btn-quiet' });
    return h('div', { class: 'dev-passkey' }, h('span', { class: 'dev-meta', text: '手机批准：已开启' }), off);
  }
  if (x.passkey !== 'pending') return null;
  const at = x.passkeyAt ? new Date(x.passkeyAt).toLocaleString('zh-CN', { hour12: false }) : null;
  const id = `pk-${x.id}`;
  const input = h('input', { id, type: 'text', inputMode: 'numeric', maxLength: 8, autocomplete: 'off', value: st.typed.get(x.id) || '', placeholder: '6 位数字', attrs: { 'aria-label': `${x.label} 上显示的核对码` } });
  input.addEventListener('input', () => st.typed.set(x.id, input.value));
  const go = async () => {
    input.blur();
    const c = normalizePasskeyCode(input.value);
    if (!c) { st.macMsg.set(x.id, { ok: false, text: '核对码是 6 位数字，看手机上显示的' }); app.render(); return; }
    try { await app.transport.confirmPasskey(x.id, c); st.macMsg.set(x.id, { ok: true, text: '已开启手机批准' }); st.typed.delete(x.id); } catch (e) { st.macMsg.set(x.id, { ok: false, text: e.message || '没有开启' }); }
    await app.loadDevices(); app.render();
  };
  const msg = st.macMsg.get(x.id);
  return h('div', { class: 'dev-passkey' },
    h('label', { class: 'label', htmlFor: id, text: `这台设备${at ? `在 ${at} ` : ''}申请开启手机批准：输入它屏幕上显示的核对码（只在你自己刚在手机上点了“开启”时才确认）` }),
    h('div', { class: 'code-row' }, input, button('确认开启', go, { primary: true })),
    msg ? h('p', { class: ['status', msg.ok ? 'is-done' : 'is-error'], attrs: { role: 'status' }, text: msg.text }) : null);
}
