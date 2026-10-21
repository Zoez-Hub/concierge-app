// 设置（hub#165 §14.2；设计修订 2，DESIGN_SPEC §7）：六页 #/settings/<quota|accounts|devices|permissions|notify|about>，一次只渲染一页。
//   桌面：系统设置式两栏——左边子导航 176（分组「资源：额度 / 账号与模型」「设备：设备 / 权限 / 通知」「其他：关于」，选中项白底 + 1px 线），
//     间距 36，右边内容 ≤ 640。子导航在主列里，不在全局导轨上。
//   手机：#/settings 是六行的设置首页（每行右侧一句摘要）→ 子页 →「‹ 设置」返回（app.mjs 管路由和返回）。
// 每页：额度 = 每池一卡 +「刷新额度」；账号与模型 = AI 账号 + 模型与执行能力 + 工程通道（各设备 GitHub 凭据只写有 / 没有 / 过期日期不可知，不显示值）；
//   设备 = 设备身份列表（名字 · 徽章 · 最近打开 · 通知 · 手机批准 · 连接于；Safari 旧身份标出来）+「添加设备」；
//   权限 = 谁能批什么（1px 栅格）+ 手机批准 + 登记动作 + 三种码对照表；通知；关于。
// 「添加设备」（只在 Mac 本机页面）：居中对话框 520（#pairdlg，app.mjs 里开关）——二维码 168 +「复制链接」+ 一个输入框（设备上显示的 12 位连接码）
//   → 等待态「等待新设备…（10 分钟内有效）」→ 完成态「已连接：…」。链接路径不加两边核对数字；连接码方向不变（设备显示、Mac 输入）。
//   启用了 GitHub App（hub#165 §15.1 A′）：先一步「等 GitHub 授权…」（「打开 GitHub 授权页」，授权完自动往下）→ 链接里带上这台新设备专用的授权（t），
//   新设备扫了直接连上；没启用：和以前一样，底部一句“首次连接的设备要自己准备一次 GitHub 授权；想省掉这一步……”。
import { h, link } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { encodePairFragment, normalizePairingCode } from '../lib/proto.mjs';
import qrcode from '../vendor/qrcode-generator-2.0.4.mjs';
import { rows, button, statusLine, latest } from './common.mjs';
import { BUILD } from '../build.mjs';
import * as C from '../lib/choices.mjs';
import { phoneApprovalSection, macPasskeyControl } from './passkey.mjs';
import { renderNotify } from './notify.mjs';
import { renderQuota } from './resources.mjs';
import { deviceKind } from './pair.mjs';
import { icon } from './icons.mjs';

// 只在内存里的「添加设备」状态（不进任何存储）。gh：GitHub App 那一步（{ authUrl, expiresAt, state:'waiting'|'expired'|'used' }）；
// appOn：这次「添加设备」用没用 GitHub App（Mac 回没回授权页地址）
export const pair = { open: false, url: null, expiresAt: null, error: null, busy: false, startDevices: null, copied: null, pairId: null, gh: null, appOn: null };
// 拼链接用的那几样（一次性密钥在里面）：只在内存里，关掉对话框就扔
let fragBase = null;
// 对话框里「输入连接码」那一栏（只在内存里）
const code = { text: '', busy: false, result: null, coordinator: false };

export function wipePairing() {
  pair.open = false; pair.url = null; pair.expiresAt = null; pair.error = null; pair.busy = false; pair.startDevices = null; pair.copied = null;
  pair.pairId = null; pair.gh = null; pair.appOn = null; fragBase = null;
  code.text = ''; code.busy = false; code.result = null; code.coordinator = false;
}

function drawQr(canvas, text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const quiet = 4;
  const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
  const size = Math.round(168 * dpr);
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cell = size / (n + quiet * 2);
  // 二维码永远是白底黑块（深色模式下也一样，扫码才稳）
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(Math.floor((c + quiet) * cell), Math.floor((r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
  return n;
}

// 一页里的一段：小标题（h3）+ 右侧一句说明 + 内容
const block = (key, title, note, ...kids) => h('section', { class: 'set-block', attrs: { 'data-block': key, 'aria-label': title } },
  h('h3', { class: 'set-h' }, h('span', { text: title }), note ? h('span', { class: 'r', text: note }) : null), ...kids.filter(Boolean));
const sub = (text) => h('h4', { class: 'set-sub', text });
// 每页顶上：页名 + 一句说明
const pageHead = (title, lead) => h('header', { class: 'set-head' }, h('h2', { class: 'set-title', text: title }), lead ? h('p', { class: 'set-lead', text: lead }) : null);

// ---------------- 额度 ----------------
function quotaPage(app) {
  const board = app.view?.board || null;
  return [pageHead('额度', '只读。页面打开、回到前台时，超过 5 分钟没读过才在后台读一次；读额度不发任何模型请求。数字是官方客户端自报的，只代表读取那一刻。'),
    h('div', { class: 'quota region', attrs: { id: 'quota' } }, app.view ? renderQuota(app, board?.quota, app.actions) : h('p', { class: 'note', text: '正在读取…' }))];
}

// ---------------- 账号与模型 ----------------
function accounts(app) {
  const list = Array.isArray(app.view?.board?.quota) ? app.view.board.quota : [];
  const items = list.map((q) => {
    const v = F.quotaPool(q);
    // 额度从哪读、读到过没有（#165 第六次复核 F4）：查询位置不等于登录了，没有登录证据就不说登录
    const meta = v.state === 'unobservable' ? '额度从哪读：没有地方可读（ChatGPT 网页没有官方额度接口）' : `额度从哪读：${v.where || '不知道'} · ${v.seenText}`;
    return h('li', { class: 'acct', attrs: { 'data-pool': q.pool } },
      h('span', { class: 'acct-icon', attrs: { 'aria-hidden': 'true' } }, icon('key')),
      h('span', { class: 'acct-name' }, h('span', { text: v.name }), v.badge ? h('span', { class: 'dev-entry', text: v.badge }) : null),
      h('span', { class: 'acct-meta', text: meta }),
      h('span', { class: 'acct-sum', text: v.summary }),
      v.state === 'unobservable' ? null : button('看额度', () => app.nav(F.settingsHash('quota'), { parent: '#/settings', replace: wideNow() }), { cls: 'btn-quiet btn-small', attrs: { 'aria-label': `看 ${v.name} 的额度` } }));
  });
  return block('accounts', 'AI 账号', '按账号列，以后可以再加',
    items.length ? h('ul', { class: 'acctlist' }, items) : h('p', { class: 'note', text: '还没有账号信息。' }));
}

function models(app) {
  const o = app.view?.board?.options || {};
  const groups = C.modelGroups(o);
  const parts = groups.map((g) => [sub(`${C.PROVIDER_LABEL[g.provider] || g.provider} 账号`), rows(g.models.map((m) => [m.name, C.modelSub(m)]), 'wide')]);
  const consult = (o.consult || []).map((c) => [c.label, c.async ? `Concierge 测不了（在 ChatGPT 里由你自己选）· ${F.coordinatorStatus(c).text}` : c.verifiedAt ? `上次实测 ${F.day(c.verifiedAt)}` : '按配置，还没实测过']);
  if (consult.length) parts.push([sub('咨询'), rows(consult, 'wide')]);
  if (o.smallWork) parts.push([sub('小动工'), rows([['Luna', o.smallWork.available ? `能用（${o.smallWork.model || 'gpt-5.6-luna'}）` : `暂时不能用：${o.smallWork.note || '原因不明'}`]], 'wide')]);
  const act = latest(app.actions, (a) => a.kind === 'caps');
  return block('models', '模型与执行能力', '实测调不通的不列；还没实测过的标出来',
    ...(parts.length ? parts.flat() : [h('p', { class: 'note', text: '还没有读到。' })]),
    h('p', { class: 'note', text: `${o.capabilitiesProbedAt ? `上次重测 ${F.dayTime(o.capabilitiesProbedAt)}。` : '还没手动重测过。'}重测会给每个模型发一次很小的调用。` }),
    app.transport.capabilities.capsProbe ? h('div', { class: 'action-row' }, button('重新实测', () => app.act(() => app.transport.probeCaps()), { cls: 'btn-small' })) : null,
    act && act.state === 'done' ? h('p', { class: 'status', attrs: { role: 'status' }, text: '已开始重测：在后台一个一个测，测完这里的日期会更新。' }) : statusLine(act, { online: app.macOnline(), app }));
}

// 工程通道：各设备往来都经 GitHub，每台设备用自己的一把凭据。这里只写有 / 没有 / 过期日期不可知，从不显示值（Mac 也不保管别的设备的）。
// 这一段是 §0 语言规则的例外（和 GitHub 授权那一屏一样）：要写 GitHub App、令牌这些原名，不然她在 GitHub 设置里找不到
// GitHub App（hub#165 §15.1 A′）：启用没有；没启用时「怎么开启」折叠（docs/REMOTE.md §3.4 的五步）
function ghAppHow() {
  return h('details', { class: 'help gh-app-how', attrs: { id: 'gh-app-how' } }, h('summary', { text: '怎么开启（一次性，要你本人在 GitHub 上做）' }),
    h('ol', {},
      h('li', { text: 'GitHub → Settings → Developer settings → GitHub Apps → New GitHub App：权限只开 Repository permissions → Issues: Read and write；Callback URL 填 http://127.0.0.1:4400/api/gh/callback；取消勾选 Webhook 的 Active；User-to-server token expiration 选 Opt-out；Where can this GitHub App be installed 选 Only on this account。' }),
      h('li', { text: 'Install App → Only select repositories → 只选 Concierge 用的那个仓库。' }),
      h('li', { text: 'Generate a new client secret，在 Mac 终端把它存进钥匙串：security add-generic-password -s concierge-github-app -a concierge -w （后面跟这个 client secret）。' }),
      h('li', { text: '把 App 的 Client ID 写进 Concierge 配置的 remote.githubApp.clientId，enabled 改成 true，重启 Concierge。' }),
      h('li', { text: '第一次在 Mac 上「添加设备」时，在 GitHub 授权页点一次 Authorize。之后新设备扫码就能直接连上，不用它自己再做 GitHub 授权。' })),
    h('p', { class: 'note', text: '开启之后每台新设备拿到的是这个 App 给它单独换的一把授权（只给这个仓库的任务读写），Mac 上移除设备时一并撤销。' }));
}
function channel(app) {
  const b = app.view?.board || {};
  const list = [];
  let appBlock = null;
  if (app.local) {
    const r = app.devices?.remote;
    const appOn = r?.githubApp?.enabled === true;
    list.push(['Mac', !r ? '正在读取…' : !r.enabled ? '远端通道没开，现在用不到' : r.lastPublishAt ? `有（${F.when(r.lastPublishAt)} 用过）· 过期日期不可知` : '还没用过 · 过期日期不可知']);
    list.push(['GitHub App', !r ? '正在读取…' : appOn ? '已启用：「添加设备」时给新设备换一把它专用的授权，新设备扫码直接连上' : '没启用：新设备第一次连接时要自己准备一次 GitHub 授权']);
    for (const x of (app.devices?.devices || []).filter((d) => d && d.role !== 'coordinator')) {
      list.push([x.label || '设备', x.ghCredAt ? `有（GitHub App ${F.dayTime(x.ghCredAt)} 给的）· 过期日期不可知` : '有（连接时它自己准备的，只存在那台设备上）· 现在有没有、什么时候过期这里看不到']);
    }
    appBlock = r && !appOn ? ghAppHow() : null;
  } else {
    const st = app.transport.status();
    list.push(['这台设备', st.paired ? '有（连接时保存在这台设备上）· 过期日期不可知' : '没有']);
    list.push(['Mac', b.at ? `有（${F.when(b.at)} 发布过状态）· 过期日期不可知` : '不知道']);
  }
  for (const r of Array.isArray(b.receivers) ? b.receivers : []) {
    list.push([`Windows 接收器 ${String(r.keyId || r.id || '').slice(0, 8)}`, F.receiverOnline(r) ? '有（最近心跳说明能用）· 过期日期不可知' : '不知道（最近没有心跳）']);
  }
  return block('channel', '工程通道', '各设备的 GitHub 凭据：只写有没有，不显示内容',
    rows(list, 'wide'),
    h('p', { class: 'note', text: '设备和 Mac 之间的往来都经 GitHub，每台设备第一次连接时用自己的一把凭据（只给这一个仓库的任务读写）。Mac 不保管、不转发别的设备的凭据。' }),
    appBlock);
}

function accountsPage(app) {
  return [pageHead('账号与模型', '账号决定能用哪些模型和额度，设备决定在哪台机器上跑。额度从哪读、读到过没有照实写，不说登录了没有。'), accounts(app), models(app), channel(app)];
}

// ---------------- 设备 ----------------
const pkOf = (app, x) => (app.view?.board?.devices || []).find((y) => y.id === x.id)?.passkey || x.passkey || null;
const pkState = (pk) => (pk === 'active' || pk?.state === 'active' ? 'active' : pk === 'pending' || pk?.state === 'pending' ? 'pending' : null);
function deviceMeta(app, x) {
  const nt = (app.view?.board?.devices || []).find((y) => y.id === x.id)?.notify || x.notify || null;
  const pk = pkState(pkOf(app, x));
  return [
    `最近打开 ${x.lastSeenAt ? F.when(x.lastSeenAt) : '还没用过'}`,
    `通知${nt ? F.notifyStateText(nt) : '没开'}`,
    `手机批准${pk === 'active' ? `已开${x.passkeyAt ? `（${F.day(x.passkeyAt)}）` : ''}` : pk === 'pending' ? '申请开启，等你在「权限」里允许' : '没开'}`,
    `${x.via === 'code' ? '连接码' : '链接'}连接于 ${x.addedAt ? F.dayTime(x.addedAt) : '时间不知道'}`,
  ].join(' · ');
}
const KIND_ICON = { 'ios-app': 'phone', 'ios-safari': 'phone', windows: 'monitor', browser: 'monitor', coordinator: 'key' };

function devRow(app, x, { me = false, manage = false, old = false } = {}) {
  const e = F.deviceEntry(x);
  let rm = null;
  if (manage) {
    let sure = false;
    rm = button('移除', async () => {
      if (!sure) { sure = true; rm.textContent = '确认移除'; return; }
      let out = null;
      await app.act(async () => { out = await app.transport.removeDevice(x.id); return out; });
      // GitHub App 令牌 Mac 撤不了（入口重启过，终审 P2-F）：提示留在设备列表上面，点「知道了」才收起。
      // 没撤掉、在重试 / 重试用完的：Mac 记成待办，loadDevices 之后由 ghRevokes 一直显示（第十轮复核 F）
      const note = F.ghRevokeNote(out?.ghToken, x.label || '');
      if (note) (app.ui ||= {}).ghRevokeNote = note;
      await app.loadDevices();
    }, { cls: 'btn-quiet btn-small', attrs: { 'aria-label': `移除 ${x.label}` } });
  }
  return h('li', { class: ['dev', me ? 'is-me' : '', old ? 'is-old' : ''], attrs: { 'data-dev': x.id || null, 'data-entry': e.kind } },
    h('span', { class: 'dev-icon', attrs: { 'aria-hidden': 'true' } }, icon(KIND_ICON[e.kind] || 'monitor')),
    h('span', { class: 'dev-name' }, h('span', { text: x.label || '设备' }), h('span', { class: ['dev-entry', e.kind === 'ios-app' ? 'is-app' : ''], text: e.text }),
      old ? h('span', { class: 'dev-entry is-old', text: '旧身份' }) : null, me ? h('span', { class: 'dev-me', text: '这台' }) : null),
    h('span', { class: 'dev-meta', text: x.role === 'coordinator' ? `只能派普通任务、取消自己派的任务 · 连接于 ${x.addedAt ? F.dayTime(x.addedAt) : '时间不知道'}` : deviceMeta(app, x) }),
    rm);
}

// Mac 本机（入口所在的这台）、Windows 接收器、GPT Chat 派工通道
function macRow(app) {
  return h('li', { class: ['dev', app.local ? 'is-me' : ''], attrs: { 'data-entry': 'mac' } },
    h('span', { class: 'dev-icon', attrs: { 'aria-hidden': 'true' } }, icon('monitor')),
    h('span', { class: 'dev-name' }, h('span', { text: 'Mac' }), h('span', { class: 'dev-entry', text: 'Mac 本机' }), app.local ? h('span', { class: 'dev-me', text: '这台' }) : null),
    h('span', { class: 'dev-meta', text: `Concierge 在这台机器上运行 · 一直可信 · 敏感操作的批准、设备管理只在这里做${app.view?.board?.mac?.seenAt ? ` · 最近在线 ${F.when(app.view.board.mac.seenAt)}` : ''}` }));
}
function receiverRowsOf(app) {
  const recs = Array.isArray(app.view?.board?.receivers) ? app.view.board.receivers : [];
  if (!recs.length) {
    return [h('li', { class: 'dev is-machine', attrs: { 'data-entry': 'receiver' } },
      h('span', { class: 'dev-icon', attrs: { 'aria-hidden': 'true' } }, icon('lock')),
      h('span', { class: 'dev-name' }, h('span', { text: 'Windows 接收器' }), h('span', { class: 'dev-entry', text: '还没有接入' })),
      // 页面里不写仓库名（托管副本是公开的）：只说 C:\Projects 下工程总仓库里的 _tools 文件夹
      h('span', { class: 'dev-meta', text: '在 Windows 上打开 C:\\Projects 下工程总仓库里的 _tools 文件夹，双击 receiver-setup.cmd；接收器开始发心跳之后这里就有了。' }))];
  }
  return recs.map((r) => h('li', { class: 'dev is-machine', attrs: { 'data-entry': 'receiver' } },
    h('span', { class: 'dev-icon', attrs: { 'aria-hidden': 'true' } }, icon('lock')),
    h('span', { class: 'dev-name' }, h('span', { text: 'Windows 接收器' }), h('span', { class: 'dev-entry', text: '接收器' }), h('span', { class: 'dev-entry', text: String(r.keyId || r.id || '').slice(0, 8) })),
    h('span', { class: 'dev-meta', text: `${F.receiverOnline(r) ? '在线' : '离线'} · ${r.lastSeenAt ? `最近心跳 ${F.when(r.lastSeenAt)}` : '还没有心跳'} · 版本 ${r.version || '不知道'}` }),
    h('details', { class: 'dev-more' }, h('summary', { text: '详细' }), rows(F.receiverRows(r)),
      h('p', { class: 'note', text: '钥匙编号要和 Windows 上 receiver-setup.cmd（或 receiver.cmd pin）打印的「接收器钥匙编号」一样；对不上就是有别人抢先冒充了这台接收器。Mac 只认一台接收器：要换，得在 Mac 上有人值守地处理。在线＝最近 5 分钟里收到过它的心跳。' }))));
}

function devicesPage(app) {
  const out = [pageHead('设备', '哪些设备能打开 Concierge、提交任务、回答问题。每个浏览器身份各算一台：iPhone 的主屏幕 App 和 Safari 是两台。')];
  if (!app.local) {
    const st = app.transport.status();
    const d = st.device || {};
    let confirming = false;
    const un = button('解除连接', async () => {
      if (!confirming) { confirming = true; un.textContent = '确认解除连接'; return; }
      await app.transport.unpair();
      location.replace(location.pathname + location.search);
    }, { cls: 'btn-quiet btn-danger' });
    out.push(block('me', '这台设备', null,
      rows([['身份', `${d.label || '设备'} · ${deviceKind().text}`], ['连接', d.pairedAt ? `${F.dayTime(d.pairedAt)} · 认的 Mac 编号 ${d.macId || '还没有记住'}` : '还没连好'], ['能做', '提交、回答、真机验收；登记动作能不能在这里批，见「权限」']]),
      h('p', { class: 'note', text: '这台设备只显示认的那台 Mac 发来、核对过的内容。解除连接会清掉这台设备上保存的 GitHub 授权和连接信息；之后到 Mac 上把它从列表里移除。' }),
      h('div', { class: 'action-row' }, un)));
    const devs = (app.view?.board?.devices || []).filter(Boolean);
    const old = F.staleSafari(devs);
    out.push(block('identities', '已连接', '只在 Mac 上能添加和移除',
      h('ul', { class: 'devlist' }, macRow(app), ...devs.map((x) => devRow(app, x, { me: x.id === d.id, old: old.has(x.id) })), ...receiverRowsOf(app))));
    return out;
  }
  const dv = app.devices;
  const r = dv?.remote || {};
  const list = (dv?.devices || []).filter(Boolean);
  const old = F.staleSafari(list);
  const parts = [];
  if (!dv) parts.push(h('p', { class: 'note', text: '正在读取…' }));
  if (dv && !r.enabled) parts.push(h('p', { class: 'note', text: '远端通道还没开启：手机和 Windows 现在还连不上这个页面。已连接的设备仍然可以在这里移除。' }));
  // 状态记录换过了：已经连接的设备找不到新的那条，要重新连接（原因是 Mac 记下的工程说法，折起来放）
  if (r.stateReplaced) {
    parts.push(h('div', { class: 'replaced', attrs: { role: 'status' } },
      h('p', { class: 'status is-error', text: `${r.stateReplaced.at ? `${F.dayTime(r.stateReplaced.at)} ` : ''}Mac 换了一条状态记录（原来那条不能用了）。已经连接的设备找不到新的那条：要在每台设备上重新连接，再把旧的从下面移除。` }),
      r.stateReplaced.why ? h('details', { class: 'help' }, h('summary', { text: '工程上的原因' }), h('p', { text: String(r.stateReplaced.why) })) : null));
  }
  if (app.ui?.ghRevokeNote) {
    parts.push(h('div', { class: 'hint-card', attrs: { role: 'status', 'data-k': 'gh-revoke-note' } },
      h('span', { class: 'hint-i', attrs: { 'aria-hidden': 'true' }, text: '!' }),
      h('span', { class: 'hint-t' }, h('span', { class: 'hint-s', text: app.ui.ghRevokeNote })),
      button('知道了', () => { app.ui.ghRevokeNote = null; app.render(); }, { cls: 'btn-quiet btn-small' })));
  }
  // Mac 记着的撤销待办（第十轮复核 F）：来自 GET /api/devices.ghRevokes，刷新、重启入口都还在，直到撤掉或点「知道了」
  for (const p of Array.isArray(app.devices?.ghRevokes) ? app.devices.ghRevokes : []) {
    const row = F.ghRevokeRow(p);
    parts.push(h('div', { class: 'hint-card', attrs: { role: 'status', 'data-k': 'gh-revoke', 'data-state': p.state || null } },
      h('span', { class: 'hint-i', attrs: { 'aria-hidden': 'true' }, text: '!' }),
      h('span', { class: 'hint-t' }, h('span', { class: 'hint-s', text: row.text })),
      row.canRetry ? button('再试一次', async () => { await app.act(() => app.transport.ghRevokeRetry(p.key)); await app.loadDevices(); }, { cls: 'btn-quiet btn-small' }) : null,
      button('知道了', async () => { await app.act(() => app.transport.ghRevokeDismiss(p.key)); await app.loadDevices(); }, { cls: 'btn-quiet btn-small' })));
  }
  parts.push(h('ul', { class: 'devlist' }, macRow(app), ...list.map((x) => devRow(app, x, { manage: true, old: old.has(x.id) })), ...receiverRowsOf(app)));
  if (dv && r.enabled) {
    parts.push(h('div', { class: 'action-row dev-actions' },
      button('添加设备', () => { wipePairing(); pair.open = true; startPair(app); app.render(); }, { primary: true, attrs: { id: 'add-device', 'aria-haspopup': 'dialog' } })));
  }
  if (old.size) {
    const names = list.filter((x) => old.has(x.id)).map((x) => x.label || '设备');
    parts.push(h('div', { class: 'hint-card', attrs: { role: 'note' } },
      h('span', { class: 'hint-i', attrs: { 'aria-hidden': 'true' }, text: '!' }),
      h('span', { class: 'hint-t' }, h('span', { class: 'hint-h', text: `${names.join('、')}：Safari 的旧身份` }),
        h('span', { class: 'hint-s', text: '同一台手机的主屏幕 App 已经连好，Safari 那个用不到了。移除它不影响主屏幕 App。' }))));
  }
  out.push(block('identities', `已连接 ${1 + list.length + (app.view?.board?.receivers || []).length}`, '只在 Mac 上能添加和移除', ...parts));
  return out;
}

// 「添加设备」：打开对话框就出二维码（名字由新设备自己报；Mac 上起的“新设备”只是占位）。
// 启用了 GitHub App：先等 GitHub 授权（页面轮询 pairToken），拿到这台新设备的授权再出二维码（链接里多一个 t）
const pairUrl = (base, t = null) => `${base.app}#${encodePairFragment({ o: base.o, r: base.r, i: base.i, p: base.p, k: base.k, m: base.m, ...(t ? { t } : {}) })}`;
async function startPair(app) {
  if (pair.busy) return;
  pair.busy = true; pair.error = null; pair.gh = null; pair.url = null; app.render();
  try {
    await app.loadDevices(); // 先读一遍最新的列表：之后多出来的那一台才是这次连上的
    const s = await app.transport.startPair('新设备');
    if (!s.appUrl) throw new Error('远端页面的地址还没配置（config.json 的 remote.appUrl），没法生成链接');
    if (!s.mac?.pub) throw new Error('没有拿到这台 Mac 的连接信息，没法生成链接');
    // m：Mac 的钥匙。设备经这条可信的路记住它，之后只认它发来的内容
    fragBase = { app: String(s.appUrl).split('#')[0], o: s.owner, r: s.repo, i: s.stateIssue, p: s.pairId, k: s.secret, m: s.mac.pub };
    pair.pairId = s.pairId;
    pair.expiresAt = s.expiresAt;
    pair.startDevices = (app.devices?.devices || []).map((x) => x.id);
    if (s.github?.authUrl) {
      pair.appOn = true;
      pair.gh = { authUrl: s.github.authUrl, expiresAt: s.github.expiresAt || null, state: 'waiting' };
      setTimeout(() => pollToken(app, s.pairId), 1200);
    } else {
      pair.appOn = false;
      pair.url = pairUrl(fragBase);
    }
  } catch (e) { pair.error = F.startPairMessage(e); }
  pair.busy = false;
  app.render();
}
// GitHub 授权完了没有（POST /api/pair/token）：ready 时拿到这台新设备的授权，放进链接的 t（不存、不显示）
export async function pollToken(app, pairId) {
  if (!pair.open || pair.pairId !== pairId || pair.gh?.state !== 'waiting' || !fragBase) return;
  let r = null;
  try { r = await app.transport.pairToken(pairId); } catch { r = null; }
  if (!pair.open || pair.pairId !== pairId || !fragBase) return;
  if (r?.state === 'ready' && r.t) { pair.gh.state = 'ready'; pair.url = pairUrl(fragBase, r.t); app.render(); return; }
  if (r?.state === 'expired' || r?.state === 'used') { pair.gh.state = r.state; app.render(); return; }
  // Mac 上 GitHub App 中途关了：退回没有 t 的链接（新设备自己授权）
  if (r?.state === 'none') { pair.gh = null; pair.appOn = false; pair.url = pairUrl(fragBase); app.render(); return; }
  setTimeout(() => pollToken(app, pairId), 1500);
}

// 对话框里的连接码：设备上显示 12 位码，在这里输入。码由设备和 Mac 两把钥匙一起算出，Mac 找到恰好一台对得上的才登记
function codeBox(app) {
  const input = h('input', { id: 'pair-code', type: 'text', value: code.text, maxLength: 20, autocomplete: 'off', spellcheck: false, placeholder: 'XXXX-XXXX-XXXX', attrs: { autocapitalize: 'characters', 'aria-describedby': 'pair-code-help' } });
  input.addEventListener('input', () => { code.text = input.value; });
  const go = async () => {
    if (code.busy) return;
    input.blur(); // 输入框有焦点时不重画：先让出焦点，结果才显示得出来
    const raw = String(input.value || '').trim();
    if (!normalizePairingCode(raw)) { code.result = F.pairCodeMessage({ ok: false, status: 400 }); app.render(); return; }
    code.busy = true; code.result = null; app.render();
    const r = await app.transport.pairCode(raw, code.coordinator ? 'coordinator' : null);
    code.busy = false;
    code.result = F.pairCodeMessage(r);
    if (r?.ok) { code.text = ''; code.coordinator = false; }
    await app.loadDevices();
    app.render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  // GPT Chat 派工通道（#100）：Windows 上的工程 MCP 显示的码。勾上 = 它只能派普通任务、取消自己派的任务
  const coord = h('input', { id: 'pair-coordinator', type: 'checkbox', checked: !!code.coordinator });
  coord.addEventListener('change', () => { code.coordinator = coord.checked; });
  return h('div', { class: 'codebox', attrs: { id: 'codebox' } },
    h('label', { class: 'label', htmlFor: 'pair-code', attrs: { id: 'pair-code-help' }, text: '扫不了？在新设备上点“手动连接码”，把它显示的 12 位输到下面' }),
    h('div', { class: 'code-row' }, input, button(code.busy ? '正在找…' : '连接', go, { primary: true, disabled: code.busy })),
    h('label', { class: 'check-label', htmlFor: 'pair-coordinator' }, coord, ' 这是 GPT Chat 派工通道（只能派普通任务、取消自己派的任务；回答决定、批准都不行）'),
    code.result ? h('p', { class: ['status', code.result.ok ? 'is-done' : 'is-error'], attrs: { role: 'status', id: 'pair-code-result' }, text: code.result.text }) : null,
    // 6 位确认码（hub#165 §15.1）：发布过的设备页面内置了 Mac 的身份，Mac 上输对了它自己显示「已连接」，不要这 6 位；
    // 只有没内置的页面（本地源码 / 没发布过的）还在等它。Mac 分不出是哪一种，所以折起来放：设备上要了才点开看
    code.result?.ok && code.result.confirm && code.result.coordinator ? h('div', { class: 'pair-confirm', attrs: { id: 'pair-confirm' } },
      h('p', { class: 'confirm-line' }, '在派工通道那一头输入这 6 位确认码：', h('span', { class: 'confirm-digits', text: code.result.confirm }))) : null,
    code.result?.ok && code.result.confirm && !code.result.coordinator ? h('details', { class: 'pair-confirm help', attrs: { id: 'pair-confirm' } },
      h('summary', { text: '设备上在等 6 位确认码？' }),
      h('p', { class: 'confirm-line' }, '在设备上输入这 6 位确认码：', h('span', { class: 'confirm-digits', text: code.result.confirm })),
      h('p', { class: 'note', text: '设备上已经显示「已连接」就不用管它。' })) : null);
}

// 对话框重画的依据（app.mjs 的 paint key）：配对状态 + 连接码那一栏的状态
export const pairDialogKey = () => JSON.stringify([pair, code.busy, code.result, code.coordinator]);

// 「添加设备」对话框的内容（app.mjs 放进 #pairdlg-in，跟着设备列表重画）
export function pairDialog(app) {
  const list = app.devices?.devices || [];
  // 用连接码连上的：留在这一屏给她看 6 位确认码（要敲回设备上），不跳完成态
  const newDev = pair.url && pair.startDevices && !code.result?.ok ? list.find((x) => !pair.startDevices.includes(x.id)) : null;
  const close = () => { wipePairing(); app.render(); };
  const head = h('div', { class: 'ov-h' }, h('h2', { id: 'pairdlg-title', text: '添加设备', tabIndex: -1 }),
    h('button', { type: 'button', class: 'ov-x', attrs: { 'aria-label': '关闭' }, on: { click: close } }, icon('x')));
  let body;
  if (newDev) {
    body = [h('div', { class: 'pair-done', attrs: { id: 'pair-done', role: 'status' } },
      h('span', { class: 'done-mark', attrs: { 'aria-hidden': 'true' } }, icon('check')),
      h('p', { class: 'done-t', text: `已连接：${newDev.label || '设备'}` }),
      h('p', { class: 'note', text: '它已经出现在设备列表里。通知、手机批准在那台设备上分别开（见「通知」「权限」）。' }))];
  } else if (!pair.url && pair.gh) {
    // GitHub App 那一步：等 Zoe 在 GitHub 上授权（第一次点一次 Authorize；授权过的 GitHub 直接跳回），授权完自动出二维码
    const go = link(pair.gh.authUrl, '打开 GitHub 授权页');
    go.classList.add('btn', 'btn-primary', 'gh-auth-go');
    go.id = 'gh-auth-go';
    body = pair.gh.state === 'waiting' ? [h('p', { class: 'pair-big', text: '先在 GitHub 上授权一次' }),
      h('p', { class: 'note center', text: '给这台新设备换一把它专用的授权（只给这个仓库的任务读写），链接里带着它，新设备扫了直接连上。第一次要在 GitHub 上点一次 Authorize；授权过的会直接跳回。' }),
      h('div', { class: 'action-row center' }, go),
      h('p', { class: 'waiting', attrs: { role: 'status', id: 'gh-wait' } }, h('span', { class: 'breath', attrs: { 'aria-hidden': 'true' } }),
        h('span', { text: `等 GitHub 授权…（授权完这里自动出二维码${pair.gh.expiresAt ? `，${F.clock(pair.gh.expiresAt)} 前有效` : ''}）` })),
      codeBox(app)]
      : [h('p', { class: 'status is-error', attrs: { role: 'status' }, text: pair.gh.state === 'used' ? '这次的 GitHub 授权已经用过了。' : 'GitHub 授权超时了（10 分钟）。' }),
        h('div', { class: 'action-row center' }, button('再试一次', () => startPair(app), { cls: 'btn-small' }))];
  } else if (!pair.url) {
    body = [h('p', { class: 'pair-big', text: '让新设备扫这个码' }),
      h('div', { class: 'qr-wrap' }, h('div', { class: 'qr qr-empty', attrs: { role: 'img', 'aria-label': pair.error ? '二维码没生成出来' : '正在生成二维码' } })),
      pair.error ? h('p', { class: 'status is-error', attrs: { role: 'status' }, text: pair.error }) : h('p', { class: 'note center', text: '正在生成…' }),
      pair.error ? h('div', { class: 'action-row center' }, button('再试一次', () => startPair(app), { cls: 'btn-small' })) : null];
  } else {
    const canvas = h('canvas', { class: 'qr', attrs: { role: 'img', 'aria-label': '连接二维码：用要连接的设备扫' } });
    try { drawQr(canvas, pair.url); } catch { pair.error = '二维码画不出来（链接太长）'; }
    const copyBtn = button('复制链接', async () => { const ok = await app.copy(pair.url); pair.copied = ok ? '已复制。在主屏幕 App 或 Windows 上粘贴到「粘贴连接链接」。' : '复制不了。'; app.render(); }, { cls: 'btn-small' });
    body = [h('p', { class: 'pair-big', text: '让新设备扫这个码' }),
      h('div', { class: 'qr-wrap' }, canvas),
      h('div', { class: 'action-row center' }, copyBtn),
      pair.copied ? h('p', { class: 'note center', attrs: { role: 'status' }, text: pair.copied }) : null,
      codeBox(app),
      h('p', { class: 'waiting', attrs: { role: 'status' } }, h('span', { class: 'breath', attrs: { 'aria-hidden': 'true' } }),
        h('span', { text: `等待新设备…（10 分钟内有效${pair.expiresAt ? `，${F.clock(pair.expiresAt)} 前` : ''}）` })),
      pair.appOn
        ? h('p', { class: 'note', attrs: { id: 'pair-app-note' }, text: '链接里带着这台新设备专用的 GitHub 授权（只给这一个仓库的任务读写），新设备扫了直接连上，不用自己再授权。链接只交给自己的设备，10 分钟内有效，只能用一次。' })
        : h('p', { class: 'note', attrs: { id: 'pair-app-note' }, text: '新设备第一次连接时，会要它自己的一把工程通道凭据（只给这一个仓库的任务读写，只留在那台设备上）。Mac 不保管它。链接只交给自己的设备，只能用一次。首次连接的设备要自己准备一次 GitHub 授权；想省掉这一步，设置 → 账号与模型 → 工程通道里有开启方法。' })];
  }
  const foot = h('div', { class: 'ov-f' }, button(newDev ? '完成' : '取消', close, { cls: newDev ? 'btn-primary' : '', attrs: { 'data-k': 'pair-close' } }));
  return [head, h('div', { class: 'ov-b' }, ...body.filter(Boolean)), foot];
}

// ---------------- 权限 ----------------
function permissionsPage(app) {
  const devs = (app.local ? (app.devices?.devices || []) : (app.view?.board?.devices || [])).filter(Boolean);
  const who = [['Mac 本机页面', '全部：批准任何敏感操作和登记动作、添加和移除设备、开关权限']];
  for (const x of devs) {
    if (x.role === 'coordinator') { who.push([x.label || 'GPT Chat 派工通道', '只能派普通任务、取消自己派的任务；什么都批不了']); continue; }
    const pk = pkState(pkOf(app, x));
    const e = F.deviceEntry(x);
    who.push([`${x.label || '设备'} · ${e.text}`, pk === 'active' ? '提交、回答、真机验收；允许在手机上批的登记动作，用面容 ID 批' : pk === 'pending' ? '提交、回答、真机验收；申请了手机批准，等你在下面允许' : '提交、回答、真机验收；不能批准']);
  }
  for (const r of Array.isArray(app.view?.board?.receivers) ? app.view.board.receivers : []) who.push([`Windows 接收器 · ${String(r.keyId || r.id || '').slice(0, 8)}`, '只领取和执行任务；不能批准任何东西']);
  const grid = h('div', { class: 'perm-grid', attrs: { role: 'table', 'aria-label': '谁能批什么' } },
    who.map(([k, v]) => h('div', { class: 'perm-row', attrs: { role: 'row' } }, h('span', { class: 'perm-k', attrs: { role: 'rowheader' }, text: k }), h('span', { class: 'perm-v', attrs: { role: 'cell' }, text: v }))));
  // 手机批准（hub#165 §15.2）：设备上申请（面容 ID）；Mac 上逐台「允许」（点两次）/「拒绝」、关掉。没有核对码
  const phone = [];
  if (app.local) {
    const people = devs.filter((x) => x.role !== 'coordinator');
    const items = people.map((x) => {
      const pk = pkState(pkOf(app, x));
      return h('li', { class: ['dev', pk === 'pending' ? 'is-pending' : ''], attrs: { 'data-dev': x.id || null, 'data-pk': pk || 'off' } },
        h('span', { class: 'dev-icon', attrs: { 'aria-hidden': 'true' } }, icon('phone')),
        h('span', { class: 'dev-name' }, h('span', { text: x.label || '设备' }), h('span', { class: 'dev-entry', text: F.deviceEntry(x).text })),
        h('span', { class: 'dev-meta', text: pk === 'active' ? `已开启${x.passkeyActiveAt || x.passkeyAt ? ` ${F.day(x.passkeyActiveAt || x.passkeyAt)}` : ''} · 每次批准都要面容 ID，确认的就是那一张卡、那一个动作`
          : pk === 'pending' ? `${x.passkeyAt && F.clock(x.passkeyAt) ? `${F.clock(x.passkeyAt)} ` : ''}申请开启手机批准 · 是你自己刚在这台设备上点的才允许` : '没开' }),
        macPasskeyControl(app, x));
    });
    phone.push(items.length ? h('ul', { class: 'devlist' }, items) : h('p', { class: 'note', text: '还没有连接的设备。' }));
  } else {
    phone.push(phoneApprovalSection(app));
  }
  phone.push(h('p', { class: 'note', attrs: { id: 'pk-how' }, text: '开启时：手机上点「开启手机批准」→ 面容 ID → Mac 的「设置 → 权限」这一页出现它的申请 → 点「允许」（点两次）。只有 Mac 本机页面能允许；关掉、换一台也只在 Mac 上做。' }),
    h('p', { class: 'note', attrs: { id: 'pk-identity' }, text: '开启 = 认这台手机和你的面容 ID（身份）；每次批准一个登记动作，仍要面容 ID 确认那一张卡、那一个动作（授权）。只能在 Mac 上批的动作（比如往 iPhone 装 App）开了也不能在手机上批。' }));
  const acts = Array.isArray(app.view?.board?.options?.actions) ? app.view.board.options.actions : null;
  // 码只剩连接码这一条路上的两种（hub#165：手机批准不再有核对码；确认数字只在设备页面没有内置 Mac 身份时出现）
  const codes = h('div', { class: 'code-table', attrs: { role: 'table', 'aria-label': '两种码' } },
    h('div', { class: 'ct-row ct-head', attrs: { role: 'row' } }, ['码', '什么时候', '谁显示', '谁输入'].map((x) => h('span', { attrs: { role: 'columnheader' }, text: x }))),
    [['连接码（12 位）', '扫不了码时连接设备', '新设备', 'Mac'], ['确认数字（6 位）', '只在旧版设备页面上：用连接码连接的最后一步，核对两边是同一次（新版页面自动显示已连接）', 'Mac', '新设备']]
      .map((r) => h('div', { class: 'ct-row', attrs: { role: 'row' } }, r.map((x) => h('span', { attrs: { role: 'cell' }, text: x })))));
  return [pageHead('权限', '谁能在哪台设备上批什么。权限只由 Mac 授予，只往严里改；批准都要点两次。'),
    block('who', '谁能批准', null, grid),
    block('phone', '手机批准（面容 ID）', null, ...phone),
    block('actions', '登记动作', '批准后受限执行器只执行一次',
      acts ? (acts.length ? rows(acts.map((a) => [F.actionTitle(a), `${a.site === 'windows' ? 'Windows' : 'Mac'} 上执行 · ${a.remote ? '可以在开了手机批准的设备上批' : '只能在 Mac 上批'}${a.preauthable ? ' · 提交任务时可以预授权' : ''}`]), 'wide') : h('p', { class: 'note', text: '还没有登记动作。' }))
        : h('p', { class: 'note', text: '登记动作清单还没有读到（Mac 上的 Concierge 更新之后会列在这里）。' })),
    block('codes', '两种码，别混', null, codes)];
}

// ---------------- 关于 ----------------
function aboutPage(app) {
  const b = app.view?.board || {};
  // 页面、Mac 上的 Concierge、Windows 接收器各是哪份代码；页面和 Mac 对不上时说一句
  const ver = F.versionRows(b, BUILD, { local: app.local });
  const list = [...ver.rows, ['Mac 最近在线', b.mac?.seenAt ? F.dayTime(b.mac.seenAt) : '不知道']];
  const mismatch = ver.note ? h('p', { class: 'note is-warn', attrs: { id: 'version-note' }, text: ver.note }) : null;
  let why = null;
  if (app.local) {
    const r = app.devices?.remote;
    list.push(['远端发布', !r ? '正在读取…' : !r.enabled ? '没有开启' : r.lastError ? '上一轮出错了（原因在下面）' : r.lastPublishAt ? `${F.dayTime(r.lastPublishAt)} 发布过` : '还没发布过']);
    if (r?.enabled && app.devices?.mac?.id) list.push(['Mac 编号', app.devices.mac.id]);
    // 出错的原文是给工程看的（可能带工程说法），折起来放
    why = r?.enabled && r.lastError ? h('details', { class: 'help' }, h('summary', { text: '工程上的原因' }), h('p', { text: String(r.lastError) })) : null;
  } else list.push(['看板更新于', b.at ? F.dayTime(b.at) : '不知道']);
  return [
    pageHead('关于', null),
    block('version', '版本', null, rows(list), mismatch, why),
    block('authority', '工程师的授权范围', '不扩大权限，只去掉多余的请示',
      h('p', { class: 'note', text: '无人值守的工程师默认自己把事做完；下面两份清单和它们收到的指示是同一个口径。' }),
      sub('不问就做'),
      h('ul', { class: 'auth-list', attrs: { id: 'auth-do' } }, F.AUTHORITY_DO.map((x) => h('li', { text: x }))),
      sub('必须问你'),
      h('ul', { class: 'auth-list is-ask', attrs: { id: 'auth-ask' } }, F.AUTHORITY_ASK.map((x) => h('li', { text: x }))),
      h('p', { class: 'note', text: F.AUTHORITY_NOT_ASK })),
  ];
}

const TAB_ICON = { quota: 'gauge', accounts: 'key', devices: 'phone', permissions: 'shield', notify: 'bell', about: 'info' };
const wideNow = () => globalThis.matchMedia?.('(min-width: 1040px)').matches === true;

// 手机的设置首页：六行，各进一页；每行右侧一句摘要
function home(app) {
  const ctx = { board: app.view?.board || null, devices: app.devices?.devices || [], local: app.local, me: app.local ? null : app.transport.status?.()?.device?.id || null, build: BUILD };
  return [h('nav', { class: 'set-list', attrs: { 'aria-label': '设置的六页' } }, F.SETTINGS_TABS.map(([k, label]) => h('button', {
    type: 'button', class: 'set-row', attrs: { 'data-tab': k },
    on: { click: () => app.nav(F.settingsHash(k), { parent: '#/settings' }) },
  }, h('span', { class: 'set-row-i', attrs: { 'aria-hidden': 'true' } }, icon(TAB_ICON[k])),
  h('span', { class: 'set-row-t', text: label }),
  h('span', { class: 'set-row-d', text: F.settingsSummary(k, ctx) }), icon('right'))))];
}

// 桌面的子导航（主列左侧 176）：分组标题 + 子项，选中项白底 + 1px 线
function subnav(app, tab) {
  return h('nav', { class: 'set-nav', attrs: { 'aria-label': '设置的六页' } }, F.SETTINGS_GROUPS.map((g) => h('div', { class: 'set-nav-g', attrs: { role: 'group', 'aria-label': g } },
    h('p', { class: 'set-nav-h', text: g }),
    F.SETTINGS_TABS.filter((x) => x[2] === g).map(([k, label]) => h('button', {
      type: 'button', class: 'set-navitem', attrs: { 'data-tab': k, 'aria-current': k === tab ? 'page' : 'false' },
      on: { click: () => { if (k !== tab) app.nav(F.settingsHash(k), { replace: true }); } },
    }, icon(TAB_ICON[k]), h('span', { text: label }))))));
}

// tab：这一页（null = 手机的设置首页）；wide：桌面（两栏，带子导航）
export function renderSettings(app, { tab = null, wide = false } = {}) {
  const cur = F.SETTINGS_TABS.find(([k]) => k === tab);
  const out = [h('h2', { class: 'sr-only', attrs: { id: 'settings-h' }, text: cur ? `设置 · ${cur[1]}` : '设置' })];
  if (!cur) return [...out, ...home(app)];
  const page = tab === 'quota' ? quotaPage(app)
    : tab === 'accounts' ? accountsPage(app)
      : tab === 'devices' ? devicesPage(app)
        : tab === 'permissions' ? permissionsPage(app)
          : tab === 'notify' ? [pageHead('通知', '什么时候通知、各设备开没开、最近一次送到没有。通知上不能批准。'), renderNotify(app) || block('notify', '通知', null, h('p', { class: 'note', text: '这个浏览器收不了推送。' }))]
            : aboutPage(app);
  const content = h('div', { class: 'set-page', attrs: { 'data-tab': tab } }, ...page.filter(Boolean));
  return [...out, wide ? h('div', { class: 'set-wrap' }, subnav(app, tab), content) : content];
}
