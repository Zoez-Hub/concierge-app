// 手机批准（hub#152 → hub#165 §15.2，docs/ACTIONS.md §5）的两块界面：
//   设备上（设置 → 权限 → 手机批准）：「开启手机批准」→ 面容 ID → 等待态「等 Mac 允许（申请 02:41）」→ 开启后一行状态；关掉只在 Mac 上。
//   Mac 本机页面（设置 → 权限 → 手机批准，每台设备一行）：申请开启的那一行「iPhone 主屏幕 · 02:41 申请开启手机批准 · 允许 / 拒绝」，
//   「允许」要点两次；不再有核对码（申请由那台设备自己的钥匙签过，冒充者造不出；核对码原本也防不了“开启时页面已被改过”）。
// 开启 = 身份（这台手机 + 本人面容 ID 可用）；每次批准一个登记动作仍要面容 ID 确认那一张卡、那一个动作（授权），这两件事分开。
import { h } from '../lib/dom.mjs';
import { button } from './common.mjs';
import { clock } from '../lib/format.mjs';

// 只在内存里
const st = { busy: false, error: null, local: undefined, macMsg: new Map(), arm: new Map() };

// 看板里这台设备的手机批准状态：'active' | 'pending' | null
export function passkeyState(app) {
  const id = app.transport.status?.()?.device?.id;
  const me = (app.view?.board?.devices || []).find((x) => x && x.id === id);
  return me?.passkey || null;
}
// 申请开启的时间（看板里 Mac 记的；还没出现在看板里时用这台设备自己记的）
function pendingAt(app) {
  const id = app.transport.status?.()?.device?.id;
  const me = (app.view?.board?.devices || []).find((x) => x && x.id === id);
  if (me?.passkeyAt) return me.passkeyAt;
  return st.local?.at ? new Date(st.local.at).toISOString() : null;
}

export function phoneApprovalSection(app) {
  const caps = app.transport.capabilities || {};
  if (caps.local) return null;
  const state = passkeyState(app);
  if (st.local === undefined) { st.local = null; app.transport.passkeyLocal?.().then((x) => { st.local = x; app.render(); }).catch(() => {}); }
  const parts = [h('h4', { class: 'sub-title', text: '手机批准（面容 ID）' })];
  // 申请出现在看板里之后就以看板为准；Mac 上拒绝了（看板里又没有了）就回到「开启手机批准」，说一句
  if (state === 'pending') { st.sent = false; st.wasPending = true; }
  const denied = !state && st.wasPending && !st.sent;
  if (state === 'active') st.wasPending = false;
  if (!caps.passkey) {
    parts.push(h('p', { class: 'note', text: '这个浏览器用不了面容 ID 批准。要在 iPhone 上批准受限执行器的动作，用 iOS 17 或更新的 Safari（添加到主屏幕后从主屏幕打开也可以）。不开也没关系：回到 Mac 上照样能批。' }));
    return h('div', { class: 'passkey-box' }, parts);
  }
  if (state === 'active') {
    parts.push(h('p', { class: 'status is-done', attrs: { id: 'passkey-state' }, text: '已开启：批准受限执行器的动作时，会要你的面容 ID。' }),
      h('p', { class: 'note', text: '开启只是认这台手机和你的面容 ID；每次批准一个动作，仍要面容 ID 确认那一张卡、那一个动作。要关闭或换一台，在 Mac 上：设置 → 权限。' }));
  } else if (state === 'pending' || st.sent) {
    const at = pendingAt(app);
    parts.push(h('p', { class: 'waiting', attrs: { role: 'status', id: 'passkey-wait' } }, h('span', { class: 'breath', attrs: { 'aria-hidden': 'true' } }),
      h('span', { text: `等 Mac 允许${at && clock(at) ? `（申请 ${clock(at)}）` : ''}` })),
      h('p', { text: '在 Mac 上打开 Concierge → 设置 → 权限，在这台设备那一行点「允许」。只在 Mac 本机页面上能允许，这里不能自己开。' }),
      button('重新申请', () => enroll(app), { cls: 'btn-quiet', disabled: st.busy }));
  } else {
    if (denied) parts.push(h('p', { class: 'status is-error', attrs: { role: 'status', id: 'passkey-denied' }, text: '上一次申请没有在 Mac 上被允许（被拒绝了，或者过期了）。要开启就再申请一次。' }));
    parts.push(h('p', { text: '开启后，工程申请的受限动作（比如把新版本装到这台 iPhone、合并一个改动）可以直接在这里用面容 ID 批准，不用回到 Mac。每次批准都要面容 ID，只对那一张卡、那一个动作有效。' }),
      button(st.busy ? '正在开启…' : '开启手机批准', () => enroll(app), { primary: true, disabled: st.busy }));
  }
  if (st.error) parts.push(h('p', { class: 'status is-error', attrs: { role: 'status' }, text: st.error }));
  return h('div', { class: 'passkey-box' }, parts);
}

async function enroll(app) {
  if (st.busy) return;
  st.busy = true; st.error = null; app.render();
  try { await app.transport.passkeyEnroll(); st.sent = true; st.local = undefined; } catch (e) { st.error = e.message || '没有开启'; }
  st.busy = false; app.render();
}

// Mac 本机页面：权限页「手机批准」里一台设备的操作。申请开启的：「允许」（点两次）/「拒绝」；开着的：「关掉手机批准」（点两次）
export function macPasskeyControl(app, x) {
  if (!app.transport.capabilities?.local || x.role === 'coordinator') return null;
  const msg = st.macMsg.get(x.id);
  const say = msg ? h('p', { class: ['status', msg.ok ? 'is-done' : 'is-error'], attrs: { role: 'status' }, text: msg.text }) : null;
  if (x.passkey === 'active') {
    let sure = false;
    const off = button('关掉手机批准', async () => {
      if (!sure) { sure = true; off.textContent = '确认关掉'; return; }
      await app.act(() => app.transport.revokePasskey(x.id)); await app.loadDevices();
    }, { cls: 'btn-quiet btn-small', attrs: { 'aria-label': `关掉 ${x.label || '设备'} 的手机批准` } });
    return h('div', { class: 'dev-passkey' }, off, say);
  }
  if (x.passkey !== 'pending') return say ? h('div', { class: 'dev-passkey' }, say) : null;
  // 「允许」点两次：第一次“上膛”记在内存里（15 秒内有效，连同当时看到的那一次申请的 requestId），设置页中途重画（每 10 秒读一次设备列表）也不丢；
  // 申请变了（刷新到新的 requestId）就清掉上膛，要重新看、重新点两次（终审 P1-C）
  const arm0 = st.arm.get(x.id);
  if (arm0 && arm0.requestId !== (x.requestId || null)) st.arm.delete(x.id);
  const armed = () => { const a = st.arm.get(x.id); return !!a && a.at > Date.now() - 15000 && a.requestId === (x.requestId || null); };
  const done = async (fn, ok) => {
    try { await fn(); st.macMsg.set(x.id, { ok: true, text: ok }); } catch (e) { st.macMsg.set(x.id, { ok: false, text: e.message || '没有处理' }); }
    await app.loadDevices(); app.render();
  };
  const sureLabel = `再点一次确认允许 ${x.label || '设备'} 开启手机批准`;
  const allow = button(armed() ? '确认允许' : '允许', () => {
    if (!armed()) { st.arm.set(x.id, { at: Date.now(), requestId: x.requestId || null }); allow.textContent = '确认允许'; allow.className = 'btn btn-brass btn-small'; allow.setAttribute('aria-label', sureLabel); return; }
    st.arm.delete(x.id);
    allow.disabled = true;
    done(() => app.transport.allowPasskey(x.id, { requestId: x.requestId || null, credFp: x.credFp || null }), `已允许：${x.label || '这台设备'} 开启了手机批准`);
  }, { primary: !armed(), cls: armed() ? 'btn-brass btn-small' : 'btn-small', attrs: { 'data-k': 'pk-allow', 'aria-label': armed() ? sureLabel : `允许 ${x.label || '设备'} 开启手机批准` } });
  const deny = button('拒绝', () => { st.arm.delete(x.id); done(() => app.transport.denyPasskey(x.id), `已拒绝：${x.label || '这台设备'} 的手机批准没有开启`); }, { cls: 'btn-quiet btn-small', attrs: { 'data-k': 'pk-deny', 'aria-label': `拒绝 ${x.label || '设备'} 开启手机批准` } });
  return h('div', { class: 'dev-passkey' }, h('div', { class: 'action-row' }, deny, allow), say);
}
