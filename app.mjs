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
import { renderTaskList, renderFilterChips } from './ui/tasks.mjs';
import { renderTaskPage, refreshAmendAttach } from './ui/task.mjs';
import { overlayContent, overlayShape, cardKey, forgetCards, deferredView } from './ui/decision.mjs';
import { renderSettings, wipePairing, pairDialog, pairDialogKey, pair as pairState } from './ui/settings.mjs';
import { refreshPushState } from './ui/notify.mjs';
import { renderPair, isIos, isStandalone } from './ui/pair.mjs';
import { button, latest } from './ui/common.mjs';
import { BUILD } from './build.mjs';

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
// 本机页面上有任务在动（排队、正在做、刚提交还没变成任务）时轮询快一点：状态自己从领取走到完成，不用她刷新
const POLL_BUSY_MS = 4000;
const busy = () => (app.view?.tasks || []).some((t) => t.state === 'queued' || t.state === 'working')
  || (app.view?.board?.pending || []).length > 0 || app.outbox.length > 0;

const app = {
  transport: null, local: false, store: null,
  view: null, ordered: [], actions: [], outbox: [], devices: null,
  error: null, flashText: null, chipNote: null,
  route: F.routeOf(location.hash),
  ui: { quotaOpen: new Set(), doneAll: false, drafts: new Map(), consultOpen: null, macPop: false, reportOpen: new Set(), cancelledOpen: false, quick: new Set(), filter: null, amend: new Map(), accept: new Map(), overlay: null, pick: new Map(), checks: new Map(), progressAll: new Set() },
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

// ---- 搜索与筛选（V2.md §3）：只在页面里筛，不发请求；写进地址 #/?q=…&f=…&s=…&o=…（替换当前这一条历史），刷新保持 ----
app.ui.filter = app.route.filter || null;
app.setFilter = (next) => {
  const f = F.parseFilter(F.homeHash(next).replace(/^#\/\??/, ''));
  app.ui.filter = f;
  const hash = F.homeHash(f);
  history.replaceState(history.state, '', hash === '#/' ? location.pathname + location.search : hash);
  app.route = F.routeOf(location.hash);
  if (document.activeElement !== $('q')) $('q').value = f?.q || '';
  render();
};
let qTimer = null;
$('q').value = app.ui.filter?.q || '';
$('q').addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => app.setFilter({ ...(app.ui.filter || {}), q: $('q').value }), 150); });
$('q').addEventListener('keydown', (e) => { if (e.key === 'Escape' && $('q').value) { e.stopPropagation(); $('q').value = ''; app.setFilter({ ...(app.ui.filter || {}), q: '' }); } });

// ---- 路由：#/t/<repo>/<号>、#/settings（手机：设置首页）、#/settings/<tab>（六页之一，设计修订 2）、首页（可以带筛选）----
// 设置（hub#165 §14.2）：桌面上没有设置首页——#/settings 换成上次所在的那一页（默认「额度」），地址跟着；
// 手机上 #/settings 是六行的首页，进每一页时记下 parent，「‹ 设置」和系统返回回到首页。

const wide = () => globalThis.matchMedia?.('(min-width: 1040px)').matches === true;
// parent：这一条的上一级（手机设置的某一页 → '#/settings'）；replace：替换当前这条（桌面在设置里换页）
app.nav = (hash, { parent = null, replace = false } = {}) => {
  // 从列表进到任务之前记下列表滚到哪（render 之后列表就收起了，滚动值会被截掉）
  if (app.route.name === 'home') app.ui.listY = window.scrollY;
  if (replace) history.replaceState(history.state, '', hash);
  else history.pushState({ concierge: true, ...(parent ? { parent } : {}) }, '', hash);
  onRoute();
};
app.back = () => {
  const r = app.route;
  // 手机：设置的某一页 → 设置首页（从首页进来的就退回去；直接打开的就换成首页，再返回才回工作台）
  if (r.name === 'settings' && r.tab && !wide()) {
    if (history.state?.parent === '#/settings') history.back();
    else { history.replaceState(null, '', '#/settings'); onRoute(); }
    return;
  }
  if (history.state?.concierge) history.back();
  else { history.replaceState(null, '', location.pathname + location.search); onRoute(); }
};
// 「查看任务详情」（弹层里，§14.4）：关弹层、进这个任务的详情页、滚到交互卡。
// focus:'amend'（真机核对清单的「加截图」，V2.md §16）：滚到并聚焦「补一句 / 追加截图」的输入框，不去抢交互卡（第十三轮复核 P2）
app.viewTask = (ref, { focus = 'card' } = {}) => {
  app.closeOverlay({ refocus: false });
  if (!(app.route.name === 'task' && app.route.ref === ref)) app.nav(F.hashOfTask(ref));
  if (focus === 'amend') render();
  const reduce = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  requestAnimationFrame(() => {
    const target = focus === 'amend' ? document.getElementById('amend-text') : document.querySelector('#taskpage .inline-card');
    if (!target) return;
    if (focus !== 'amend') target.tabIndex = -1;
    target.scrollIntoView({ block: focus === 'amend' ? 'center' : 'start', behavior: reduce ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
  });
};

function onRoute() {
  const prev = app.route;
  app.route = F.routeOf(location.hash);
  if (app.route.name === 'settings') {
    if (app.route.tab) app.ui.setTab = app.route.tab;
    else if (wide()) { history.replaceState(history.state, '', F.settingsHash(app.ui.setTab || 'quota')); app.route = F.routeOf(location.hash); }
  }
  if (app.route.name === 'home') {
    app.ui.filter = app.route.filter || null;
    if (document.activeElement !== $('q')) $('q').value = app.ui.filter?.q || '';
  }
  if (app.route.name !== 'settings') wipePairing();
  if (app.route.name === 'settings' && prev.name !== 'settings') {
    app.loadDevices();
    // 这个浏览器的推送订阅（hub#152）：读一次，设置里的「通知」照它显示开 / 关
    if (!app.local) refreshPushState(app).then(() => app.render()).catch(() => {});
  }
  render();
  // 换页之后把焦点放到新页的“返回”上（键盘和读屏用户知道到了哪）
  // 任务详情是普通页面（整页只有一个滚动条，hub#30 C09）：进去时记下列表滚到哪、回到顶上；回来时回到列表原来的位置
  if (prev.name !== app.route.name || prev.ref !== app.route.ref || prev.tab !== app.route.tab) {
    // 换页的时候关掉还开着的弹层（它属于上一页的任务）
    if (app.ui.overlay) app.closeOverlay({ refocus: false });
    const target = app.route.name === 'task' ? $('taskpage') : app.route.name === 'settings' ? $('settings') : null;
    if (target) window.scrollTo(0, 0);
    // 页面切换（DESIGN_SPEC §5）：桌面淡入上移 4px；手机进详情侧滑、返回反向
    const back = (app.route.name === 'home' && prev.name !== 'home') || (app.route.name === 'settings' && !app.route.tab && !!prev.tab);
    animate(target || $('home'), back ? 'view-back' : app.route.name === 'home' ? 'view-in' : 'view-slide');
    if (target) { target.focus({ preventScroll: true }); } else if (prev.name === 'task') {
      window.scrollTo(0, app.ui.listY || 0);
      document.querySelector(`#tasklist a.task[data-ref="${CSS.escape(prev.ref)}"]`)?.focus({ preventScroll: true });
    }
  }
}
function animate(el, cls) {
  if (!el) return;
  el.classList.remove('view-in', 'view-slide', 'view-back');
  void el.offsetWidth;
  el.classList.add('view-in');
  if (cls !== 'view-in') el.classList.add(cls);
}
window.addEventListener('popstate', onRoute);
window.addEventListener('hashchange', () => {
  const f = takePairHash();
  if (f && app.transport) {
    if (f === 'bad') { pairFragBad = true; render(); return; }
    if (app.local) app.flash('这是 Mac 本机上的页面。连接链接要在要连接的那台设备上打开。');
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
// 输入框失去焦点后补画；但手指 / 鼠标还按着的时候先不画（不然她刚打完字去点「送出」，按钮在按下和抬起之间被换掉，这一下就点空了），抬起、点完再画
let pointerDown = false;
let pendingPaint = false;
const dirtyRegions = () => [...document.querySelectorAll('.region')].some((r) => r._dirty);
document.addEventListener('pointerdown', () => { pointerDown = true; }, true);
for (const ev of ['pointerup', 'pointercancel']) {
  document.addEventListener(ev, () => { pointerDown = false; if (pendingPaint) setTimeout(() => { pendingPaint = false; if (dirtyRegions()) render(); }, 0); }, true);
}
document.addEventListener('focusout', () => setTimeout(() => { if (!dirtyRegions()) return; if (pointerDown) pendingPaint = true; else render(); }, 0));

const minute = () => Math.floor(Date.now() / 60000);

function render() {
  // 整屏的几种（远端）：钉住的 Mac 一直验不过 / 状态记录读不到（说明、请她自己决定要不要重新配对，不显示任何内容，连之前验过的也不显示）；
  // 已经配好的设备打开了配对链接（先问要不要换）；正在换成新的配对、还没配好（终审 F1c、F1e）
  const rst0 = app.local ? null : app.transport.status();
  if (rst0 && (rst0.macChanged || app.pair.step === 'link-replace' || (entered && (!rst0.paired || app.pair.step === 'link-token' || app.pair.step === 'link-confirm')))) {
    $('top').hidden = true; $('app').hidden = true; $('rail').hidden = true; document.body.classList.remove('is-in');
    if (app.ui.overlay) app.closeOverlay({ refocus: false });
    renderPairScreen();
    return;
  }
  if (!entered) { renderPairScreen(); return; }
  // 从整屏说明里恢复过来（钉住的那把钥匙又签出了新看板）：主界面重新显示出来
  if (!app.local && $('app').hidden) { $('pair').hidden = true; $('top').hidden = false; $('app').hidden = false; }
  $('rail').hidden = false;
  document.body.classList.add('is-in');
  const view = app.view;
  const board = view?.board || null;
  app.ordered = F.orderTasks(board, view?.tasks || []);
  // 标签页标题、导轨上的数、手机齿轮旁的黄铜点：同一个口径，只数要她本人做的（旧卡不算）
  const needs = app.ordered.filter((t) => F.needsOwner(t)).length;
  document.title = needs ? `(${needs}) Concierge` : 'Concierge';
  $('nav-count').replaceChildren(...(needs ? [h('span', { class: 'dot brass', attrs: { 'aria-hidden': 'true' } }), h('span', { text: String(needs) })] : []));
  $('nav-count').setAttribute('aria-label', needs ? `需要你的 ${needs} 件` : '');
  $('gear-dot').hidden = !needs;

  // 顶栏：页名 / 返回 + 自动更新时间；手机：返回 + 编号
  const r = app.route;
  const t0 = r.name === 'task' ? app.ordered.find((x) => x.ref === r.ref) || null : null;
  const stab = r.name === 'settings' ? F.SETTINGS_TABS.find(([k]) => k === r.tab) || null : null;
  const subPage = !!stab && !wide(); // 手机：设置的某一页（返回到设置首页）
  $('nav-work').setAttribute('aria-current', r.name === 'settings' ? 'false' : 'page');
  $('nav-settings').setAttribute('aria-current', r.name === 'settings' ? 'page' : 'false');
  $('back').hidden = r.name === 'home';
  $('back-text').textContent = subPage ? '设置' : '工作台';
  $('back').setAttribute('aria-label', subPage ? '返回设置' : r.name === 'settings' ? '关掉设置，回到工作台' : '返回工作台');
  $('brand').hidden = r.name !== 'home';
  $('settings-btn').hidden = r.name !== 'home';
  $('page-title').textContent = r.name === 'settings' ? (stab ? (wide() ? `设置 · ${stab[1]}` : stab[1]) : '设置') : r.name === 'task' ? '任务' : '工作台';
  $('page-title').classList.toggle('is-task', r.name === 'task');
  $('top-ref').textContent = r.name === 'task' ? (t0 ? F.taskNumber(t0.ref, board?.home || null) : '') : '';
  $('top-fresh').textContent = freshText();

  // 状态三行（桌面在导轨底部，手机是页头下面一条静音行）：都从看板的真实字段来，没有就写“还没有接入 / 不可观测”
  const ms = F.macStatus(board, { local: app.local, lastOk: app.local && !app.error ? app.transport.status().lastOk : null });
  $('mac-text').textContent = ms.text;
  $('mac-sub').textContent = F.macSubText(board, { local: app.local, lastOk: app.local && !app.error ? app.transport.status().lastOk : null });
  $('mac').classList.toggle('is-online', ms.online);
  $('mac').querySelector('.dot').className = `dot ${ms.online ? 'ok' : ''}`;
  $('mac').setAttribute('aria-expanded', app.ui.macPop ? 'true' : 'false');
  paint($('mac-pop'), JSON.stringify([app.ui.macPop, ms, latest(app.actions, (a) => a.kind === 'ping'), minute()]), () => macPop(ms));
  $('mac-pop').hidden = !app.ui.macPop;
  // Windows 接收器在不在线（看板里 Mac 验过签的心跳；没有证据不写在线）
  const rs = F.receiverStatus(board);
  const rsx = F.splitStat(rs ? rs.text : '');
  $('receiver-line').replaceChildren(...(rs ? [h('span', { class: `dot ${rs.online ? 'hollow' : ''}`, attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'stat-body' }, h('span', { class: 'stat-t', text: rsx.title }), rsx.sub ? h('span', { class: 'stat-sub', text: rsx.sub }) : null)] : []));
  $('receiver-line').setAttribute('aria-label', rs ? rs.text : '');
  $('receiver-line').classList.toggle('is-online', !!rs?.online);
  $('receiver-line').classList.add('stat');
  // GPT Chat 协调：只认能观测到的连接证据（隧道在跑、最近一次被调用）
  const gc = F.gptChatStat(board);
  $('gpt-line').replaceChildren(h('span', { class: `dot ${gc.connected ? 'hollow' : ''}`, attrs: { 'aria-hidden': 'true' } }), h('span', { class: 'stat-body' }, h('span', { class: 'stat-t', text: 'GPT Chat 协调' }), h('span', { class: 'stat-sub', text: gc.sub })));

  // 横幅：读不到最新状态、设备被移除、有内容没通过签名校验、加到主屏幕
  const rst = app.local ? null : app.transport.status();
  paint($('banner'), JSON.stringify([app.error, app.flashText, rst?.revoked, rst?.rejected, app.homeHint, view?.board?.at, board?.github]), banner);

  paint($('filter-chips'), JSON.stringify([app.ui.filter, app.ordered.map((t) => [t.ref, F.taskGroupKey(t), F.taskSite(t), t.source?.via]), board?.home]), () => renderFilterChips(app, app.ordered));

  compose?.update(view);
  const ca = latest(app.actions, (a) => a.kind === 'chip');
  $('chips-status').textContent = ca && (ca.state === 'sending' || ca.state === 'waiting') ? (app.local ? '正在保存标签…' : '标签改动已送出，Mac 处理后生效。')
    : ca && ca.state === 'failed' ? `标签没改成：${ca.error}` : '';

  // 工作台：需要你的卡片里有动词按钮（打开弹层），回答的动作状态变了也要重画
  paint($('tasklist'), JSON.stringify([app.ordered, app.outbox, board?.pending, app.ui.doneAll, minute(), !!view, app.macOnline(), app.actions.filter((a) => ['answer', 'resume', 'reclassify', 'cancel'].includes(a.kind)), app.ui.cancelledOpen, [...app.ui.quick], app.ui.filter, app.local ? null : passkeyKey()]), () => (view ? renderTaskList(app, view, app.ordered, app.outbox) : skeleton(4)));

  document.body.classList.toggle('has-task', r.name === 'task');
  for (const n of ['home', 'task', 'settings']) document.body.classList.toggle(`page-${n}`, r.name === n);
  document.body.classList.toggle('has-settings', r.name === 'settings');
  $('taskpage').hidden = r.name !== 'task';
  $('settings').hidden = r.name !== 'settings';
  // 进到任务或设置里，工作台整块收起（详情是独立的主工作区，整页只有一个滚动条）
  $('home').hidden = r.name !== 'home';
  $('home').inert = r.name !== 'home';
  if (r.name === 'task') {
    paint($('taskpage'), JSON.stringify([t0, app.actions.filter((a) => a.ref === r.ref || a.kind === 'attach'), app.ui.consultOpen, app.macOnline(), minute(), !!view, board?.options?.smallWork, board?.options?.consult, app.ui.amendTick || 0, app.local ? null : passkeyKey(), wide()]), () => renderTaskPage(app, t0, { wide: wide() }));
    refreshAmendAttach(app);
  }
  if (r.name === 'settings') paint($('settings'), JSON.stringify([r.tab || null, wide(), board?.options, board?.mac, board?.at, board?.receivers, board?.notify, board?.devices, board?.quota, minute(), app.devices, app.actions.filter((a) => a.kind === 'caps' || a.kind === 'push' || a.kind === 'quota'), app.ui.push || null, app.settingsTick || 0, app.local ? null : app.transport.status().device]), () => renderSettings(app, { tab: r.tab || null, wide: wide() }));
  renderPairDialog();
  renderOverlay();
}
const passkeyKey = () => { const id = app.transport.status?.()?.device?.id; return (app.view?.board?.devices || []).find((x) => x && x.id === id)?.passkey || null; };
function freshText() {
  const at = app.local ? app.transport.status().lastOk : app.view?.board?.at;
  const w = at ? F.when(typeof at === 'number' ? new Date(at).toISOString() : at) : '';
  return w ? `自动更新 · ${w}` : '自动更新';
}

// ---- 弹层（D）：选方案 / 敏感批准 / 真机测试。<dialog> + showModal：焦点困在里面，Esc 关；内容跟着视图和动作状态重画 ----
// deferred：开的是提前申请的那张卡（t.deferredDecision，hub#165 §15.3；任务页「授权范围」块里的「去批准」）——弹层按那张卡画、答那张卡
const ovTask = (t, o) => (o?.deferred ? deferredView(t) : t);
app.openOverlay = (type, ref, opener = null, { deferred = false } = {}) => {
  const t0 = app.ordered.find((x) => x.ref === ref);
  const t = t0 && (deferred ? deferredView(t0) : t0);
  if (!t || !t.decision) return;
  app.ui.overlay = { type, ref, fp: t.decision?.fp || null, opener, deferred: !!deferred };
  app.ui.ovMore = false; // 新开的弹层「详细」从折着开始
  forgetCards(app, ref, cardKey(t)); // 同一个任务旧卡上的选择 / 勾选不带到这张卡（终审 F1）
  const d = $('ov');
  d.className = `ov ov-${overlayShape(type, wide())}`;
  $('ov-in')._key = null;
  renderOverlay();
  if (!d.open) d.showModal();
  // 焦点放到第一个能操作的东西上（不是关闭按钮）
  // 焦点放到第一个选项 / 核对项上；批准页放在关闭（返回）上——不直接进文字框（手机上会弹键盘）
  (d.querySelector('.opt:not([disabled])') || d.querySelector('.ck:not([disabled])') || d.querySelector('#ov-title'))?.focus();
};
app.closeOverlay = ({ refocus = true } = {}) => {
  const o = app.ui.overlay;
  app.ui.overlay = null;
  const d = $('ov');
  if (d.open) d.close();
  $('ov-in').replaceChildren(); $('ov-in')._key = null;
  if (refocus && o?.opener?.isConnected) o.opener.focus();
  else if (refocus && o) document.querySelector(`[data-ov-ref="${CSS.escape(o.ref)}"]`)?.focus();
};
// 「添加设备」对话框（设计修订 2：居中 520）：只在设置里、Mac 本机页面上开；内容跟着设备列表重画（新设备出现 → 完成态）
function renderPairDialog() {
  const d = $('pairdlg');
  const want = pairState.open && app.local && app.route.name === 'settings';
  if (!want) { if (d.open) d.close(); $('pairdlg-in')._key = null; if ($('pairdlg-in').childElementCount) $('pairdlg-in').replaceChildren(); if (pairState.open && app.route.name !== 'settings') wipePairing(); return; }
  paint($('pairdlg-in'), JSON.stringify([pairDialogKey(), app.devices?.devices?.map((x) => x.id), app.devices?.devices?.length, minute()]), () => pairDialog(app));
  if (!d.open) { d.showModal(); $('pairdlg-title')?.focus(); }
}
$('pairdlg').addEventListener('cancel', (e) => { e.preventDefault(); wipePairing(); render(); });
$('pairdlg').addEventListener('click', (e) => { if (e.target === $('pairdlg')) { wipePairing(); render(); } });
function renderOverlay() {
  const o = app.ui.overlay;
  if (!o) return;
  const t = ovTask(app.ordered.find((x) => x.ref === o.ref) || null, o);
  // 这张卡已经不在了（答过了、任务往下走了、换了一张新卡）：弹层自己关掉，状态写在任务页上
  if (!t || !t.decision || (o.fp && t.decision.fp !== o.fp)) { forgetCards(app, o.ref, t?.decision ? cardKey(t) : null); app.closeOverlay(); return; }
  const ck = cardKey(t);
  paint($('ov-in'), JSON.stringify([t, o.type, app.actions.filter((a) => a.ref === o.ref), app.macOnline(), app.local ? null : passkeyKey(), wide(), app.ui.pick.get(ck) || null, [...(app.ui.checks.get(ck) || [])], app.ui.ovTick || 0]), () => overlayContent(app, t, o.type, { wide: wide() }));
}
$('ov').addEventListener('cancel', (e) => { e.preventDefault(); app.closeOverlay(); });
// 焦点困在打开的弹层里（showModal 挡住了后面的页面，但 Tab 到最后一个之后会跑到浏览器外面）：首尾相接
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  const d = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (!d) return;
  const items = [...d.querySelectorAll('button, [href], input, textarea, select, summary, [tabindex]:not([tabindex="-1"])')].filter((x) => !x.disabled && x.getClientRects().length && getComputedStyle(x).visibility !== 'hidden');
  if (!items.length) return;
  const first = items[0]; const last = items.at(-1);
  const inside = d.contains(document.activeElement);
  if (e.shiftKey && (document.activeElement === first || !inside)) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && (document.activeElement === last || !inside)) { e.preventDefault(); first.focus(); }
});
// 点在弹层外面（::backdrop 上的点击落在 dialog 本身）：关掉
$('ov').addEventListener('click', (e) => { if (e.target === $('ov')) app.closeOverlay(); });
globalThis.matchMedia?.('(min-width: 1040px)').addEventListener?.('change', () => {
  if (app.ui.overlay) { $('ov').className = `ov ov-${overlayShape(app.ui.overlay.type, wide())}`; $('ov-in')._key = null; renderOverlay(); }
  // 设置：变宽了没有首页（换成上次那一页）；顶栏的返回和页名跟着变
  if (app.route.name === 'settings' && !app.route.tab && wide()) onRoute(); else if (entered) render();
});

// ---- 输入法（§14.5）：键盘弹起时（visualViewport 比窗口矮一截）body 加 kb-open——底部固定的操作区改成跟着内容走、留出能滚上来的空间；
// 正在输入的那个框所在的输入区 / 弹层的操作区被键盘挡住时滚上来。不写内联样式（只切类、只滚动）；env(keyboard-inset-height) 在 CSS 里兜底 ----
const KB_MIN = 120;
function keepVisible() {
  const vv = globalThis.visualViewport;
  if (!vv) return;
  const open = window.innerHeight - vv.height > KB_MIN;
  document.body.classList.toggle('kb-open', open);
  if (!open) return;
  const ae = document.activeElement;
  if (!ae || !(ae.tagName === 'TEXTAREA' || (ae.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'file'].includes(ae.type)))) return;
  const dlg = ae.closest('dialog');
  // 要露出来的：弹层操作区里的按钮（不算它下面留出来的空白）/ 输入区的工具条（发送）/ 输入框所在的那一小块
  const foot = dlg?.querySelector('.ov-f, .sheet-f, .pp-f');
  const boxes = foot ? [...foot.querySelectorAll('button')].map((b) => b.getBoundingClientRect()).filter((r) => r.height > 0)
    : [(ae.closest('.composer')?.querySelector('.compose-bar') || ae.closest('.code-row, .amend-form, .accept, .reply-box') || ae).getBoundingClientRect()];
  if (!boxes.length) return;
  const over = Math.max(...boxes.map((r) => r.bottom)) - (vv.offsetTop + vv.height - 8);
  if (over <= 0) return;
  if (dlg) dlg.scrollTop += over; else window.scrollBy(0, over);
}
globalThis.visualViewport?.addEventListener?.('resize', keepVisible);
globalThis.visualViewport?.addEventListener?.('scroll', keepVisible);
document.addEventListener('focusin', () => setTimeout(keepVisible, 60));
document.addEventListener('focusout', () => setTimeout(keepVisible, 60));
app.keepVisible = keepVisible;

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
    out.push(h('div', { class: 'banner is-error' }, h('span', { text: '这台设备已经在 Mac 上被移除了。要继续用，先解除连接，再重新连接。' }),
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
  // Mac 连不上 GitHub（#61 跟进）：本机页面上任务状态会停在旧的，照实说一句
  const gd = F.githubDownText(app.view?.board);
  if (gd) out.push(h('div', { class: 'banner', attrs: { role: 'status', id: 'github-down' } }, h('span', { text: gd })));
  if (app.homeHint) {
    out.push(h('div', { class: 'banner', attrs: { id: 'home-hint' } }, h('span', { text: '通知要从主屏幕的 Concierge 打开。已经添加过？直接点主屏幕图标；它是另一套身份，第一次要单独连一次（在 Mac 上「添加设备」→「复制链接」，到 App 里粘贴）。Safari 这边的连接保留。' }),
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
    if (pairFragBad) out.splice(1, 0, h('p', { class: 'status is-error', text: '这个连接链接不对或者不完整。在 Mac 上重新点「添加设备」。' }));
    return out;
  });
}

// replace：已经配好的设备换成这次的配对（她在“要换成这次的配对吗？”上点了“换”，终审 F1e）
// 第一次配对（hub#165 §15.1）：先一屏「连接到 Zoe 的 Mac？」（Mac、这台设备、连接 / 取消），她点了「连接」才往下走
app.startLink = (frag, { replace = false } = {}) => {
  if (!replace) { app.pair = { step: 'link-confirm', frag }; render(); return; }
  app.pairLink(frag, null, { replace });
};
// 「连接到 Zoe 的 Mac？」上点了「连接」：链接里带着 GitHub 授权（Mac 启用了 GitHub App）直接连；没带 → 「首次连接需要一次 GitHub 授权」那一屏
app.confirmLink = () => {
  const frag = app.pair.frag;
  if (!frag) return;
  if (!frag.t) { app.pair = { step: 'link-token', frag }; render(); return; }
  app.pairLink(frag, null);
};
app.pairLink = async (frag, token, { replace = app.pair.replace === true } = {}) => {
  const back = app.pair.step === 'link-replace' ? 'link-replace' : app.pair.step === 'link-confirm' ? 'link-confirm' : 'link-token';
  app.pair = { ...app.pair, step: back, frag, busy: true, error: null, replace };
  render();
  try {
    await app.transport.pairByLink(frag, { label: isIos() && isStandalone() ? `${app.defaultLabel} 主屏幕` : app.defaultLabel, token, replace }); // 主屏幕 App 名字带“主屏幕”（设备页据此标徽章）
    app.pair = { step: 'waiting' }; // 配对密钥用过就不留在内存里
  } catch (e) {
    const error = e.status === 401 && back === 'link-token' ? '访问凭据无效或已到期。请在当前页重新粘贴有效凭据；需要新建时按创建步骤操作。'
      : e.status === 401 && back === 'link-confirm' ? '链接里带的 GitHub 授权用不了了（过期或者被撤销）。在 Mac 上重新点「添加设备」。' : e.message;
    app.pair = { step: back, frag, busy: false, error, replace };
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

// ---- 轮询：页面可见时每 10 秒（本机有任务在动时每 4 秒）；不可见时停；回到前台立刻刷新一次 ----
// 一轮里任何一步出错（包括画页面）都不能让轮询停下：否则页面停在旧状态，只有手动刷新才会变

async function tick() {
  clearTimeout(timer); timer = null;
  if (document.hidden) return;
  try {
    try { await app.transport.refresh(); app.error = null; } catch (e) { app.error = e.message || '出错了'; }
    app.view = app.transport.view();
    app.actions = await app.transport.actions();
    app.outbox = await app.transport.outbox();
    if (!entered && app.transport.status().paired) await enter();
    if (entered && app.route.name === 'settings' && app.local) await app.loadDevices();
    render();
  } catch (e) {
    console.warn('这一轮更新没画完，下一轮再试：', e);
  } finally {
    clearTimeout(timer);
    if (!document.hidden) timer = setTimeout(tick, app.local && busy() ? POLL_BUSY_MS : POLL_MS);
  }
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
    if (app.local) app.flash('这是 Mac 本机上的页面。连接链接要在要连接的那台设备上打开。');
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
for (const b of [$('settings-btn'), $('nav-settings')]) b.addEventListener('click', () => { if (app.route.name !== 'settings') app.nav('#/settings'); });
// 导轨里设置的四个子项（桌面）：在设置里换页替换当前这条历史（返回仍回到工作台）
$('nav-work').addEventListener('click', () => { if (app.route.name !== 'home') app.back(); });
$('back').addEventListener('click', () => app.back());
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (app.ui.macPop) { app.ui.macPop = false; render(); return; }
  // 焦点在一条展开的快捷详情里（或者它那一行上）：Esc 收起它，焦点回到「›」
  const qi = document.activeElement?.closest?.('#tasklist li.task-item.is-open');
  const qref = qi?.querySelector('button.quick-toggle')?.getAttribute('data-quick');
  if (qref && app.route.name === 'home' && !document.body.classList.contains('sheet-open') && !document.querySelector('dialog[open]')) {
    app.ui.quick.delete(qref); render();
    document.querySelector(`#tasklist button.quick-toggle[data-quick="${CSS.escape(qref)}"]`)?.focus();
    return;
  }
  if (document.querySelector('dialog[open]')) return;
  if (app.route.name !== 'home' && !document.body.classList.contains('sheet-open') && $('chip-menu').hidden) app.back();
});
for (const b of [$('brand'), $('rail-brand')]) b.addEventListener('click', (e) => { e.preventDefault(); if (app.route.name !== 'home') app.back(); });

async function boot() {
  app.local = await detectLocal();
  if (app.local) {
    app.transport = makeLocalTransport();
  } else {
    try { app.store = await openStore(); } catch { app.store = memoryStore(); }
    try { await navigator.storage?.persist?.(); } catch { /* 拿不到持久存储也能用 */ }
    app.transport = makeGithubTransport({ store: app.store, builtinMacPub: BUILD.macPub || null });
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
