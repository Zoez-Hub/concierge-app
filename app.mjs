// Concierge 产品页面的入口（docs/UI.md）。一套界面、两种取数方式：
//   本机（页面就在 Mac 的 127.0.0.1 入口上，/api/health 答话）→ transport/local.mjs
//   远端（GitHub Pages 上的静态副本，iPhone / Windows）       → transport/github.mjs
// 界面代码不知道自己在哪一种上，只看 transport.capabilities。
import { decodePairFragment } from './lib/proto.mjs';
import { h } from './lib/dom.mjs';
import * as F from './lib/format.mjs';
import { copyText } from './lib/dom.mjs';
import { openStore, memoryStore } from './lib/store.mjs';
import { makeLocalTransport, detectLocal } from './transport/local.mjs';
import { makeGithubTransport } from './transport/github.mjs';
import { mountCompose } from './ui/compose.mjs';
import { renderQuota } from './ui/resources.mjs';
import { renderTaskList } from './ui/tasks.mjs';
import { renderTaskPage } from './ui/task.mjs';
import { renderSettings, wipePairing } from './ui/settings.mjs';
import { renderPair, isIos, isStandalone } from './ui/pair.mjs';
import { button, latest } from './ui/common.mjs';

// ---- 配对链接：在任何网络请求之前，先把片段从地址栏里抹掉（片段里有一次性密钥，可能还有令牌）----
// 页面已经开着时再打开配对链接（只改了 # 后面）不会重新加载，所以 hashchange 时也走这里。
function takePairHash() {
  const raw = location.hash;
  if (!raw.startsWith('#pair=')) return null;
  history.replaceState(null, '', location.pathname + location.search);
  return decodePairFragment(raw) || 'bad';
}
let pairFrag = takePairHash();
let pairFragBad = pairFrag === 'bad';
if (pairFragBad) pairFrag = null;

const $ = (id) => document.getElementById(id);
const POLL_MS = 10000;

const app = {
  transport: null, local: false, store: null,
  view: null, ordered: [], actions: [], outbox: [], devices: null,
  error: null, flashText: null, chipNote: null,
  route: F.routeOf(location.hash),
  ui: { quotaOpen: new Set(), doneAll: false, drafts: new Map(), consultOpen: null, macPop: false },
  pair: { step: 'start' },
  defaultLabel: F.guessLabel(navigator.userAgent, navigator.platform),
  copy: copyText,
};

let compose = null;
let timer = null;
let entered = false;

// ---- 小工具 ----

app.macOnline = () => {
  if (app.local) return !!app.transport?.status().lastOk && !app.error;
  return F.macStatus(app.view?.board).online;
};

app.flash = (text) => {
  app.flashText = text;
  render();
  clearTimeout(app.flashTimer);
  app.flashTimer = setTimeout(() => { app.flashText = null; render(); }, 6000);
};

app.refreshSoon = (ms) => { clearTimeout(timer); timer = setTimeout(tick, ms ?? (app.local ? 300 : 2500)); };

app.act = async (fn) => {
  try {
    const r = await fn();
    if (r && r.state === 'failed' && r.error && !r.id) app.flash(r.error);
  } catch (e) { app.flash(e.message || '出错了'); }
  app.actions = await app.transport.actions();
  app.outbox = await app.transport.outbox();
  render();
  app.refreshSoon();
};

app.chipAction = (action, text) => app.act(() => app.transport.chip(action, text));

app.loadDevices = async () => {
  if (!app.transport.capabilities.devices) return;
  try { app.devices = await app.transport.devices(); } catch (e) { app.devices = { devices: [], remote: { enabled: false, lastError: e.message, stateReplaced: null }, mac: { id: null } }; }
  render();
};

// ---- 路由：#/t/<repo>/<号>、#/settings ----

app.nav = (hash) => {
  history.pushState({ concierge: true }, '', hash);
  onRoute();
};
app.back = () => {
  if (history.state?.concierge) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); onRoute(); }
};

function onRoute() {
  const prev = app.route;
  app.route = F.routeOf(location.hash);
  if (app.route.name !== 'settings') wipePairing();
  if (app.route.name === 'settings' && prev.name !== 'settings') app.loadDevices();
  render();
  // 换页之后把焦点放到新页的“返回”上（键盘和读屏用户知道到了哪）
  if (prev.name !== app.route.name || prev.ref !== app.route.ref) {
    const target = app.route.name === 'task' ? $('taskpage') : app.route.name === 'settings' ? $('settings') : null;
    if (target) { target.scrollTop = 0; target.focus({ preventScroll: true }); } else if (prev.name === 'task') document.querySelector(`[data-ref="${CSS.escape(prev.ref)}"]`)?.focus({ preventScroll: true });
  }
}
window.addEventListener('popstate', onRoute);
window.addEventListener('hashchange', () => {
  const f = takePairHash();
  if (f && app.transport) {
    if (f === 'bad') { pairFragBad = true; render(); return; }
    if (app.local) app.flash('这是 Mac 本机上的页面。配对链接要在要配对的那台设备上打开。');
    // 已经配好的设备：不悄悄换掉钉住的 Mac，先问一句（终审 F1e）
    else if (app.transport.status().paired) { app.pair = { step: 'link-replace', frag: f }; render(); }
    else { pairFragBad = false; app.startLink(f); }
    return;
  }
  onRoute();
});

// ---- 画 ----

// 内容没变就不重画；输入框正在输入时也先不重画那一块（失去焦点后再补）
function paint(el, key, build) {
  if (!el || el._key === key) return;
  const ae = document.activeElement;
  if (ae && el.contains(ae) && (ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !['radio', 'checkbox', 'button'].includes(ae.type)))) { el._dirty = true; return; }
  el._key = key; el._dirty = false;
  el.replaceChildren(...build().filter((n) => n !== null && n !== undefined && n !== false));
}
document.addEventListener('focusout', () => setTimeout(() => { if (document.querySelector('.region') && [...document.querySelectorAll('.region')].some((r) => r._dirty)) render(); }, 0));

const minute = () => Math.floor(Date.now() / 60000);

function render() {
  // 整屏的几种（远端）：钉住的 Mac 一直验不过 / 状态记录读不到（说明、请她自己决定要不要重新配对，不显示任何内容，连之前验过的也不显示）；
  // 已经配好的设备打开了配对链接（先问要不要换）；正在换成新的配对、还没配好（终审 F1c、F1e）
  const rst0 = app.local ? null : app.transport.status();
  if (rst0 && (rst0.macChanged || app.pair.step === 'link-replace' || (entered && (!rst0.paired || app.pair.step === 'link-token')))) {
    $('top').hidden = true; $('app').hidden = true; $('settings').hidden = true; $('settings-backdrop').hidden = true;
    renderPairScreen();
    return;
  }
  if (!entered) { renderPairScreen(); return; }
  // 从整屏说明里恢复过来（钉住的那把钥匙又签出了新看板）：主界面重新显示出来
  if (!app.local && $('app').hidden) { $('pair').hidden = true; $('top').hidden = false; $('app').hidden = false; }
  const view = app.view;
  const board = view?.board || null;
  app.ordered = F.orderTasks(board, view?.tasks || []);
  const needs = app.ordered.filter((t) => t.state === 'needs_zoe').length;
  document.title = needs ? `(${needs}) Concierge` : 'Concierge';

  // 页头：Mac 在不在线
  const ms = F.macStatus(board, { local: app.local, lastOk: app.local && !app.error ? app.transport.status().lastOk : null });
  $('mac-text').textContent = ms.text;
  $('mac').classList.toggle('is-online', ms.online);
  $('mac').setAttribute('aria-expanded', app.ui.macPop ? 'true' : 'false');
  paint($('mac-pop'), JSON.stringify([app.ui.macPop, ms, latest(app.actions, (a) => a.kind === 'ping'), minute()]), () => macPop(ms));
  $('mac-pop').hidden = !app.ui.macPop;

  // 横幅：读不到最新状态、设备被移除、有内容没通过签名校验、加到主屏幕
  const rst = app.local ? null : app.transport.status();
  paint($('banner'), JSON.stringify([app.error, app.flashText, rst?.revoked, rst?.rejected, app.homeHint, view?.board?.at]), banner);

  compose?.update(view);
  const ca = latest(app.actions, (a) => a.kind === 'chip');
  $('chips-status').textContent = ca && (ca.state === 'sending' || ca.state === 'waiting') ? (app.local ? '正在保存标签…' : '标签改动已送出，Mac 处理后生效。')
    : ca && ca.state === 'failed' ? `标签没改成：${ca.error}` : '';

  paint($('quota'), JSON.stringify([board?.quota, [...app.ui.quotaOpen], app.actions.filter((a) => a.kind === 'quota'), minute(), !!view]), () => (view ? renderQuota(app, board?.quota, app.actions) : skeleton(3)));
  paint($('tasklist'), JSON.stringify([app.ordered, app.outbox, board?.pending, app.ui.doneAll, minute(), !!view, app.macOnline()]), () => (view ? renderTaskList(app, view, app.ordered, app.outbox) : skeleton(4)));

  const r = app.route;
  document.body.classList.toggle('has-task', r.name === 'task');
  document.body.classList.toggle('has-settings', r.name === 'settings');
  $('taskpage').hidden = r.name !== 'task';
  $('settings').hidden = r.name !== 'settings';
  $('settings-backdrop').hidden = r.name !== 'settings';
  // 手机上任务页盖住整屏：底下的内容对读屏和键盘不可达
  const narrow = !matchMedia('(min-width: 1040px)').matches;
  $('left').inert = (narrow && r.name === 'task') || r.name === 'settings';
  $('tasklist').inert = r.name === 'task' || r.name === 'settings';
  if (r.name === 'task') {
    const t = app.ordered.find((x) => x.ref === r.ref) || null;
    paint($('taskpage'), JSON.stringify([t, app.actions.filter((a) => a.ref === r.ref), app.ui.consultOpen, app.macOnline(), minute(), !!view, board?.options?.smallWork]), () => renderTaskPage(app, t));
  }
  if (r.name === 'settings') paint($('settings'), JSON.stringify([board?.options, board?.mac, board?.at, app.devices, app.actions.filter((a) => a.kind === 'caps'), app.settingsTick || 0, app.local ? null : app.transport.status().device]), () => renderSettings(app));
}
app.render = () => { if (app.route.name === 'settings') app.settingsTick = (app.settingsTick || 0) + 1; render(); };

function skeleton(n) {
  return Array.from({ length: n }, () => h('div', { class: 'skel', attrs: { 'aria-hidden': 'true' } }));
}

function macPop(ms) {
  if (app.local) return [h('p', { text: '这是 Mac 本机上的页面，直接连着 Mac 上的 Concierge。' })];
  const ping = latest(app.actions, (a) => a.kind === 'ping');
  return [
    h('p', { text: ms.online ? `Mac 在线。最近一次消息 ${F.when(ms.seenAt)}。` : ms.seenAt ? `Mac 最近一次在线是 ${F.dayTime(ms.seenAt)}。现在提交的会排着，Mac 上线后领取。` : '还没收到 Mac 的消息。' }),
    h('p', { class: 'note', text: 'Mac 开着时每 10 分钟报一次；超过 15 分钟没消息就算不在线。' }),
    button('问一下 Mac', () => app.act(() => app.transport.ping())),
    ping ? h('p', { class: 'note', text: ping.state === 'done' ? 'Mac 回话了。' : ping.state === 'failed' ? `没成功：${ping.error}` : ping.state === 'undelivered' ? '没有送到：Mac 一直没有回执。' : '已经问了，Mac 在线的话一分钟内回话。' }) : null,
  ];
}

function banner() {
  const out = [];
  if (app.flashText) out.push(h('div', { class: 'banner', attrs: { role: 'alert' } }, h('span', { text: app.flashText })));
  if (!app.local && app.transport.status().revoked) {
    out.push(h('div', { class: 'banner is-error' }, h('span', { text: '这台设备已经在 Mac 上被移除了。要继续用，先解除配对，再重新配对。' }),
      button('去设置', () => app.nav('#/settings'), { cls: 'btn-quiet' })));
  }
  // 状态记录上有验不过签名的内容（被改过的视图、别人贴的假看板）：一律不显示，只安静地说一句
  if (!app.local && app.transport.status().rejected > 0) {
    out.push(h('p', { class: 'banner-quiet', attrs: { id: 'rejected-note' }, text: '有内容没有通过 Mac 的签名校验，已忽略。' }));
  }
  if (app.error) {
    const at = app.view?.board?.at;
    out.push(h('div', { class: 'banner is-error', attrs: { role: 'status' } }, h('span', { text: `读不到最新状态：${app.error}${app.view && at ? `。下面是 ${F.when(at)} 的内容。` : ''}` }),
      button('重试', () => tick(), { cls: 'btn-quiet' })));
  }
  if (app.homeHint) {
    out.push(h('div', { class: 'banner' }, h('span', { text: '加到主屏幕，下次像 App 一样打开：点分享 → 添加到主屏幕。（主屏幕图标里要再配对一次。）' }),
      button('知道了', async () => { app.homeHint = false; await app.store?.set('hintHome', true); render(); }, { cls: 'btn-quiet' })));
  }
  return out;
}

// ---- 远端：配对 ----

function renderPairScreen() {
  $('pair').hidden = false;
  $('boot').hidden = true;
  paint($('pair'), JSON.stringify([app.pair, app.transport.status(), pairFragBad]), () => {
    const out = renderPair(app);
    if (pairFragBad) out.splice(1, 0, h('p', { class: 'status is-error', text: '这个配对链接不对或者不完整。在 Mac 上重新点「添加设备」。' }));
    return out;
  });
}

// replace：已经配好的设备换成这次的配对（她在“要换成这次的配对吗？”上点了“换”，终审 F1e）
app.startLink = (frag, { replace = false } = {}) => {
  // 链接里没带令牌：第一次配对要先粘贴；换配对时沿用这台设备现在的令牌（transport 里）
  if (!frag.t && !replace) { app.pair = { step: 'link-token', frag, replace }; render(); return; }
  app.pairLink(frag, null, { replace });
};
app.pairLink = async (frag, token, { replace = app.pair.replace === true } = {}) => {
  const back = app.pair.step === 'link-replace' ? 'link-replace' : 'link-token';
  app.pair = { ...app.pair, step: back, frag, busy: true, error: null, replace };
  render();
  try {
    await app.transport.pairByLink(frag, { label: app.defaultLabel, token, replace });
    app.pair = { step: 'waiting' }; // 配对密钥用过就不留在内存里
  } catch (e) {
    app.pair = { step: back, frag, busy: false, error: e.message, replace };
  }
  render();
  tick();
};
app.cancelReplace = () => { app.pair = { step: 'start' }; render(); };
// 配对码的反方向确认：把 Mac 上显示的 6 位数字交给设备核对（终审 F1d）
app.confirmCode = async (digits) => {
  const p = app.pair;
  p.busy = true; p.confirmError = null; render();
  let r;
  try { r = await app.transport.confirmCode(digits); } catch (e) { r = { ok: false, error: e.message || '出错了' }; }
  p.busy = false;
  if (r.ok) { p.confirmText = ''; tick(); return; }
  p.confirmError = r.error;
  render();
};
app.discover = async (tok, only) => {
  const p = app.pair;
  p.busy = true; p.error = null; p.token = tok;
  render();
  try {
    if (!tok) throw new Error('先粘贴令牌');
    const found = await app.transport.discover(tok, only);
    p.found = found;
    if (found.length === 1) { await app.pairCode(found[0]); return; }
    if (!found.length) { p.askRepo = true; p.error = '这个令牌看不到 Concierge。确认令牌选了那个仓库、给了 Issues 读写，Mac 上的远端通道也开着。'; }
  } catch (e) { p.error = e.message; }
  p.busy = false;
  render();
};
app.pairCode = async (f) => {
  const p = app.pair;
  p.busy = true; render();
  try {
    await app.transport.pairByCode({ owner: f.owner, repo: f.repo, issues: f.issues, token: p.token, label: p.label || app.defaultLabel });
    app.pair = { step: 'waiting', label: p.label || app.defaultLabel }; // 名字留着：“重新开始”时不用再填（令牌不留）
  } catch (e) { p.error = e.message; p.busy = false; p.found = null; }
  render();
  tick();
};

// ---- 轮询：页面可见时每 10 秒；不可见时停；回到前台立刻刷新一次 ----

async function tick() {
  clearTimeout(timer); timer = null;
  if (document.hidden) return;
  try { await app.transport.refresh(); app.error = null; } catch (e) { app.error = e.message || '出错了'; }
  app.view = app.transport.view();
  app.actions = await app.transport.actions();
  app.outbox = await app.transport.outbox();
  if (!entered && app.transport.status().paired) await enter();
  if (entered && app.route.name === 'settings' && app.local) await app.loadDevices();
  render();
  if (!document.hidden) timer = setTimeout(tick, POLL_MS);
}
document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(timer); timer = null; } else tick(); });
window.addEventListener('online', () => tick());
window.addEventListener('pageshow', (e) => { if (e.persisted) tick(); });

async function enter() {
  entered = true;
  $('pair').hidden = true;
  $('top').hidden = false;
  $('app').hidden = false;
  if (!compose) compose = mountCompose(app);
  if (!app.local && isIos() && !isStandalone() && !(await app.store?.get('hintHome'))) app.homeHint = true;
  if (pairFrag) {
    // 已经配好的设备打开配对链接：先问要不要换（终审 F1e）
    if (app.local) app.flash('这是 Mac 本机上的页面。配对链接要在要配对的那台设备上打开。');
    else app.pair = { step: 'link-replace', frag: pairFrag };
    pairFrag = null;
  }
  onRoute();
}

// ---- 启动 ----

$('mac').addEventListener('click', () => { app.ui.macPop = !app.ui.macPop; render(); });
// 点别处关掉“Mac 在不在线”的小窗
document.addEventListener('click', (e) => {
  if (app.ui.macPop && !e.target.closest('#mac-pop, #mac')) { app.ui.macPop = false; render(); }
});
$('settings-btn').addEventListener('click', () => app.nav('#/settings'));
$('settings-backdrop').addEventListener('click', () => app.back());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (app.ui.macPop) { app.ui.macPop = false; render(); return; }
  if (app.route.name !== 'home' && !document.body.classList.contains('sheet-open') && $('chip-menu').hidden) app.back();
});
$('brand').addEventListener('click', (e) => { e.preventDefault(); if (app.route.name !== 'home') app.back(); });

async function boot() {
  app.local = await detectLocal();
  if (app.local) {
    app.transport = makeLocalTransport();
  } else {
    try { app.store = await openStore(); } catch { app.store = memoryStore(); }
    try { await navigator.storage?.persist?.(); } catch { /* 拿不到持久存储也能用 */ }
    app.transport = makeGithubTransport({ store: app.store });
  }
  document.body.dataset.mode = app.local ? 'local' : 'remote';
  const st = await app.transport.init();
  $('boot').hidden = true;
  if (st.state === 'paired') {
    app.view = app.transport.view(); // 上一次的视图先画出来，网络回来再更新
    await enter();
  } else if (pairFrag && !app.local) {
    app.startLink(pairFrag);
    pairFrag = null;
  }
  render();
  tick();
}

boot().catch((e) => {
  $('boot').hidden = false;
  $('boot').replaceChildren(h('p', { text: `页面没能启动：${e.message || '原因不明'}` }), button('重新加载', () => location.reload(), { primary: true }));
});
