// 设置 → 通知（hub#152，docs/NOTIFY.md）。
// 远端（iPhone / Windows 上的托管副本）：这台设备开 / 关系统通知、发一条试试。开通知 = 请求通知权限 → 注册 sw.mjs（只管显示通知、点了打开任务，
//   不缓存任何东西）→ 用看板里 Mac 签过名的 VAPID 公钥订阅 → 发一条设备签名的 push 动作把订阅交给 Mac。
//   iPhone 上只有“添加到主屏幕、从主屏幕打开”的页面才有推送：Safari 里打开时只说怎么做。
// 本机（Mac 上的页面）：Mac 系统通知和 Web Push 两个渠道开没开、最近一次送达；每台设备的通知状态在「设备」那一段。
// 订阅地址和钥匙只在这台设备的浏览器里、和 Mac 的运行目录里；页面上只显示类别和时间。
import { h } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { fromB64url, b64url, pushEndpointOk } from '../lib/proto.mjs';
import { rows, section, button, statusLine, latest } from './common.mjs';
import { isIos, isStandalone } from './pair.mjs';

export const SW_URL = 'sw.mjs';

// 这个浏览器能不能订阅推送（测试可以换 app.pushEnv）
export function pushEnv(app) {
  const g = app.pushEnv || globalThis;
  const nav = g.navigator || {};
  const supported = !!(nav.serviceWorker && g.PushManager && g.Notification);
  return { g, nav, supported, ios: app.pushEnv ? !!app.pushEnv.ios : isIos(), standalone: app.pushEnv ? !!app.pushEnv.standalone : isStandalone(), permission: g.Notification?.permission || 'default' };
}

const sameKey = (key, vapid) => {
  if (!key) return false;
  try { return b64url(new Uint8Array(key)) === vapid; } catch { return false; }
};

// 浏览器这边的订阅现在什么样（异步）：设置页打开时、每次操作之后读一次，放在 app.ui.push 里
export async function refreshPushState(app) {
  const e = pushEnv(app);
  const st = app.ui.push || (app.ui.push = {});
  st.permission = e.permission;
  if (!e.supported) { st.subscribed = false; return st; }
  try {
    const reg = await e.nav.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    st.subscribed = !!sub;
  } catch { st.subscribed = false; }
  return st;
}

async function enable(app) {
  const e = pushEnv(app);
  const st = app.ui.push || (app.ui.push = {});
  const vapid = app.view?.board?.notify?.push?.vapid;
  st.error = null;
  if (!vapid) { st.error = 'Mac 上的通知还没有开'; app.render(); return; }
  st.busy = true; app.render();
  try {
    // iPhone：权限要在点按钮的这一下里直接问（中间不能先等别的）
    const perm = await e.g.Notification.requestPermission();
    if (perm !== 'granted') throw new Error(perm === 'denied' ? '这台设备拒绝了通知：到系统设置里给 Concierge 打开通知，再回来点一次' : '没有允许通知，这次没开');
    const reg = await e.nav.serviceWorker.register(SW_URL);
    const ready = await e.nav.serviceWorker.ready;
    const pm = (ready || reg).pushManager;
    let sub = await pm.getSubscription();
    // 订阅的是另一把 VAPID 钥匙（Mac 换过钥匙）：先退掉旧的
    if (sub && !sameKey(sub.options?.applicationServerKey, vapid)) { await sub.unsubscribe(); sub = null; }
    if (!sub) sub = await pm.subscribe({ userVisibleOnly: true, applicationServerKey: fromB64url(vapid) });
    const j = sub.toJSON ? sub.toJSON() : sub;
    if (!pushEndpointOk(j.endpoint)) { await sub.unsubscribe(); throw new Error('这个浏览器用的推送服务 Mac 不认，开不了通知'); }
    await app.act(() => app.transport.push({ action: 'subscribe', endpoint: j.endpoint, keys: { p256dh: F.b64urlOf(j.keys?.p256dh), auth: F.b64urlOf(j.keys?.auth) } }));
  } catch (err) { st.error = err?.message || '开不了通知'; }
  st.busy = false;
  await refreshPushState(app);
  app.render();
}

async function disable(app) {
  const e = pushEnv(app);
  const st = app.ui.push || (app.ui.push = {});
  st.error = null; st.busy = true; app.render();
  try {
    const reg = await e.nav.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    const endpoint = sub ? (sub.toJSON ? sub.toJSON() : sub).endpoint : null;
    if (sub) await sub.unsubscribe();
    if (endpoint && pushEndpointOk(endpoint)) await app.act(() => app.transport.push({ action: 'unsubscribe', endpoint }));
  } catch (err) { st.error = err?.message || '关不了通知'; }
  st.busy = false;
  await refreshPushState(app);
  app.render();
}

// 远端：这台设备的通知
function remoteSection(app) {
  const e = pushEnv(app);
  const b = app.view?.board || {};
  const n = b.notify || null;
  const me = (b.devices || []).find((d) => d.id === app.transport.status().device?.id) || null;
  // iPhone 在 Safari 里打开（不是主屏幕上的那个）：Safari 里的页面收不到推送，只给引导、不给按钮（V2.md §9、NOTIFY.md §2）
  if (e.ios && !e.standalone) {
    return section('通知', h('div', { class: 'notify-guide', attrs: { id: 'notify-ios-hint' } },
      h('p', { text: '这是 Safari 里打开的页面，收不到推送。通知要从主屏幕的 Concierge 打开：' }),
      h('ol', { class: 'steps', attrs: { id: 'notify-ios-steps' } },
        h('li', { text: '在 Safari 里点分享 → 添加到主屏幕（已经添加过就跳过）。' }),
        h('li', { text: '从主屏幕上的 Concierge 图标打开。它是另一套身份，第一次要单独连一次：在 Mac 上点「添加设备」→「复制链接」，回到 App 里粘贴。' }),
        h('li', { text: '在那边的设置 → 通知 点「开启通知」，系统问时点允许；再点「发一条试试」。' })),
      h('p', { class: 'note', text: 'Safari 这边的连接保留，可以照常用。之后 App 没开着也能收到通知。' })));
  }
  if (!e.supported) return null; // 这个浏览器不支持推送：不显示这一段
  const st = app.ui.push || {};
  const macOn = n?.push?.on === true && !!n.push.vapid;
  const on = me?.notify?.state === 'on' && st.subscribed === true;
  const act = latest(app.actions, (a) => a.kind === 'push');
  const list = [
    ['Mac 那边', macOn ? '能发通知' : '还没有开通知（要工程在 Mac 上打开，不用你动手）'],
    ['这台设备', F.notifyStateText(me?.notify)],
    ['最近送达', F.notifyLastText(me?.notify)],
    ['这个浏览器', F.notifyPermissionText(st.permission || e.permission)],
  ];
  const buttons = !macOn ? null : on
    ? h('div', { class: 'action-row' }, button('发一条试试', () => app.act(() => app.transport.push({ action: 'test' })), { disabled: !!st.busy }), button('关闭通知', () => disable(app), { cls: 'btn-quiet', disabled: !!st.busy }))
    : h('div', { class: 'action-row' }, button(st.busy ? '正在开…' : '开启通知', () => enable(app), { primary: true, disabled: !!st.busy, attrs: { id: 'notify-enable' } }));
  return section('通知',
    h('div', { attrs: { id: 'notify-rows' } }, rows(list)),
    h('p', { class: 'note', text: '有任务做完、要你批准或决定、卡住、领取了、Windows 一直没领取时，这台设备会收到一条系统通知；按你提交时的预授权执行了一步、提前申请的动作过期没执行，也各通知一条。通知里只有任务名和一句状态，点开直接到这个任务；不在通知上批准。' }),
    buttons,
    st.error ? h('p', { class: 'status is-error', attrs: { role: 'status', id: 'notify-error' }, text: st.error }) : null,
    statusLine(act, { online: app.macOnline(), app }));
}

// 本机：两个渠道开没开
function localSection(app) {
  const n = app.view?.board?.notify || null;
  if (!n) return null;
  return section('通知',
    rows([
      ['Mac 系统通知', n.mac?.on ? `开着 · 最近 ${F.notifyLastText(n.mac)}` : '没开'],
      ['手机和 Windows（Web Push）', n.push?.on ? '开着' : '没开'],
    ]),
    h('p', { class: 'note', text: '这两个开关由工程在 Mac 上改 Concierge 的配置、重启之后生效，不用你动手。每台设备开没开通知、最近一次送达，在上面「设备」里；设备要在自己的设置里点「开启通知」。' }));
}

export function renderNotify(app) {
  return app.local ? localSection(app) : remoteSection(app);
}
