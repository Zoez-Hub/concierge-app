// 设置（⚙）：这台设备 / 设备（只在 Mac 本机页面）/ 可用模型 / Windows 接收器 / 关于。
// 「添加设备」：Mac 上的 Concierge 给一次性配对密钥和 Mac 公钥，页面在浏览器里拼出配对链接（带 m）并画成二维码。
// 可选的令牌只留在这个页面的内存里：不发给 Concierge 的服务，不写进任何存储；关掉面板就清掉。
// 「输入设备上显示的配对码」：设备上显示 12 位码，Zoe 敲进来（docs/REMOTE.md §3.1）。没有待批准列表。
// 敲对了显示 6 位数字（pair-code 回的 confirm），请她敲回设备：设备那边核对得上才算配好（终审 F1d）。
import { h } from '../lib/dom.mjs';
import * as F from '../lib/format.mjs';
import { encodePairFragment, normalizePairingCode } from '../lib/proto.mjs';
import qrcode from '../vendor/qrcode-generator-2.0.4.mjs';
import { rows, section, button, statusLine, latest } from './common.mjs';
import { BUILD } from '../build.mjs';
import * as C from '../lib/choices.mjs';


// 只在内存里的配对状态（不进任何存储）
const pair = { form: false, label: 'iPhone', token: '', url: null, expiresAt: null, withToken: false, error: null, busy: false, startDevices: null };
// 敲配对码那一栏（只在内存里）
const code = { text: '', busy: false, result: null };

export function wipePairing() {
  pair.token = ''; pair.form = false; pair.url = null; pair.expiresAt = null; pair.withToken = false; pair.error = null; pair.busy = false; pair.startDevices = null;
  code.text = ''; code.busy = false; code.result = null;
}

function drawQr(canvas, text) {
  const q = qrcode(0, 'M');
  q.addData(text);
  q.make();
  const n = q.getModuleCount();
  const quiet = 4;
  const dpr = Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1));
  const size = Math.round(264 * dpr);
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cell = size / (n + quiet * 2);
  // 二维码永远是白底黑块（深色模式下也一样，扫码才稳）
  ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#000000';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) ctx.fillRect(Math.floor((c + quiet) * cell), Math.floor((r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
  return n;
}

function thisDevice(app) {
  if (app.local) return section('这台设备', h('p', { text: '这台 Mac（Mac 上的 Concierge 本机页面）。敏感操作的批准、设备管理只在这里做。' }));
  const st = app.transport.status();
  const d = st.device || {};
  let confirming = false;
  const un = button('解除配对', async () => {
    if (!confirming) { confirming = true; un.textContent = '确认解除配对'; return; }
    await app.transport.unpair();
    location.replace(location.pathname + location.search);
  }, { cls: 'btn-danger' });
  return section('这台设备',
    rows([['名字', d.label || '设备'], ['配对时间', d.pairedAt ? F.dayTime(d.pairedAt) : '还没配对好'], ['认的 Mac', d.macId ? `钥匙编号 ${d.macId}` : '还没有记住']]),
    h('p', { class: 'note', text: '这台设备只显示这把 Mac 钥匙签过名的内容。' }),
    h('p', { class: 'note', text: '解除配对会清掉这台设备上的令牌和密钥。之后到 Mac 上把它从设备列表里移除。' }),
    un);
}

function devicesSection(app) {
  const d = app.devices;
  if (!d) return section('设备', h('p', { class: 'note', text: '正在读取…' }));
  const r = d.remote || {};
  const remoteOn = !!r.enabled;
  const parts = [];
  if (!remoteOn) parts.push(h('p', { class: 'note', text: '远端通道还没开启：手机和 Windows 现在还连不上这个页面。已配对的设备仍然可以在这里移除。' }));
  // 状态记录换过了：已经配对的设备找不到新的那条，要重新配对（原因是 Mac 记下的工程说法，折起来放）
  if (r.stateReplaced) {
    parts.push(h('div', { class: 'replaced', attrs: { role: 'status' } },
      h('p', { class: 'status is-error', text: `${r.stateReplaced.at ? `${F.dayTime(r.stateReplaced.at)} ` : ''}Mac 换了一条状态记录（原来那条不能用了）。已经配对的设备找不到新的那条：要在每台设备上重新配对，再把旧的从下面移除。` }),
      r.stateReplaced.why ? h('details', { class: 'help' }, h('summary', { text: '工程上的原因' }), h('p', { text: String(r.stateReplaced.why) })) : null));
  }
  const list = d.devices || [];
  parts.push(list.length
    ? h('ul', { class: 'devlist' }, list.map((x) => {
      let sure = false;
      const rm = button('移除', async () => {
        if (!sure) { sure = true; rm.textContent = '确认移除'; return; }
        await app.act(() => app.transport.removeDevice(x.id));
        await app.loadDevices();
      }, { cls: 'btn-quiet' });
      return h('li', { class: 'dev' }, h('span', { class: 'dev-name', text: x.label }),
        h('span', { class: 'dev-meta', text: [x.via === 'code' ? '配对码' : '链接', x.addedAt ? `${F.day(x.addedAt)} 加的` : null, x.lastSeenAt ? `最近 ${F.when(x.lastSeenAt)}` : '还没用过'].filter(Boolean).join(' · ') }), rm);
    }))
    : h('p', { class: 'note', text: '还没有配对的设备。' }));
  if (remoteOn) parts.push(codeBox(app), addDevice(app, list));
  return section('设备', ...parts);
}

// 敲配对码：设备上显示 12 位码，在这里输入。码由设备公钥和 Mac 公钥一起算出，Mac 找到恰好一台对得上的才登记
function codeBox(app) {
  const input = h('input', { id: 'pair-code', type: 'text', value: code.text, maxLength: 20, autocomplete: 'off', spellcheck: false, placeholder: 'XXXX-XXXX-XXXX', attrs: { autocapitalize: 'characters', 'aria-describedby': 'pair-code-help' } });
  input.addEventListener('input', () => { code.text = input.value; });
  const go = async () => {
    if (code.busy) return;
    input.blur(); // 输入框有焦点时设置面板不重画（app.mjs 的 paint）：先让出焦点，结果才显示得出来
    const raw = String(input.value || '').trim();
    if (!normalizePairingCode(raw)) { code.result = F.pairCodeMessage({ ok: false, status: 400 }); app.render(); return; }
    code.busy = true; code.result = null; app.render();
    const r = await app.transport.pairCode(raw);
    code.busy = false;
    code.result = F.pairCodeMessage(r);
    if (r?.ok) code.text = '';
    await app.loadDevices();
    app.render();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return h('div', { class: 'codebox' },
    h('label', { class: 'label', htmlFor: 'pair-code', text: '输入设备上显示的配对码' }),
    h('div', { class: 'code-row' }, input, button(code.busy ? '正在找…' : '配对', go, { primary: true, disabled: code.busy })),
    h('p', { class: 'note', attrs: { id: 'pair-code-help' }, text: '没法扫码的设备（比如 Windows）上点「手动：粘贴令牌」，它会显示 12 位码。大小写、横线都不要紧。' }),
    code.result ? h('p', { class: ['status', code.result.ok ? 'is-done' : 'is-error'], attrs: { role: 'status', id: 'pair-code-result' }, text: code.result.text }) : null,
    // 反方向的确认（终审 F1d）：码对上了，Mac 显示 6 位数字，Zoe 敲回设备上
    code.result?.ok && code.result.confirm ? h('div', { class: 'pair-confirm', attrs: { id: 'pair-confirm' } },
      h('p', { class: 'confirm-line' }, '在设备上输入这 6 位：', h('span', { class: 'confirm-digits', text: code.result.confirm })),
      button('完成', () => { code.result = null; app.render(); }, { cls: 'btn-quiet' })) : null);
}

function addDevice(app, list) {
  if (pair.url) {
    const canvas = h('canvas', { class: 'qr', attrs: { role: 'img', 'aria-label': '配对二维码：用要配对的设备扫' } });
    try { drawQr(canvas, pair.url); } catch { pair.error = '二维码画不出来（链接太长）'; }
    const newDev = pair.startDevices ? list.find((x) => !pair.startDevices.includes(x.id)) : null;
    let copied = null;
    const copyBtn = button('复制链接', async () => { const ok = await app.copy(pair.url); copied.textContent = ok ? '已复制。可以在设备上粘贴到「粘贴配对链接」。' : '复制不了。'; });
    copied = h('p', { class: 'note', attrs: { role: 'status' } });
    return h('div', { class: 'pairbox' },
      newDev ? h('p', { class: 'status is-done', text: `已配对：${newDev.label}` }) : null,
      canvas,
      h('p', { text: `用要配对的设备扫这个码。${pair.expiresAt ? `${F.clock(pair.expiresAt)} 前有效，` : ''}只能用一次。` }),
      pair.withToken ? h('p', { class: 'note', text: '二维码里带着你刚填的令牌：别让别人拍到。链接不在屏幕上显示。' }) : null,
      h('div', { class: 'action-row' }, copyBtn, button('完成', () => { wipePairing(); app.render(); }, { cls: 'btn-quiet' })),
      copied);
  }
  if (!pair.form) return button('添加设备', () => { pair.form = true; app.render(); }, { primary: true });
  const label = h('input', { id: 'pair-label', type: 'text', value: pair.label, maxLength: 40, autocomplete: 'off' });
  const token = h('input', { id: 'pair-token', type: 'password', autocomplete: 'off', spellcheck: false, placeholder: '可以不填', value: pair.token });
  // 重画面板时不丢已经填的字（仍然只在内存里）
  label.addEventListener('input', () => { pair.label = label.value; });
  token.addEventListener('input', () => { pair.token = token.value; });
  const go = async () => {
    if (pair.busy) return;
    pair.busy = true; pair.error = null;
    pair.label = label.value.trim() || '设备';
    const t = (pair.token || token.value).trim();
    pair.token = ''; token.value = ''; // 输入框和内存里都不留
    try {
      const s = await app.transport.startPair(pair.label);
      if (!s.appUrl) throw new Error('远端页面的地址还没配置（config.json 的 remote.appUrl），没法生成链接');
      if (!s.mac?.pub) throw new Error('没有拿到 Mac 的公钥，没法生成链接');
      // m：Mac 公钥。设备经这条可信的路钉住它，之后只认它签名的内容
      const frag = encodePairFragment({ o: s.owner, r: s.repo, i: s.stateIssue, p: s.pairId, k: s.secret, m: s.mac.pub, t: t || undefined });
      pair.url = `${String(s.appUrl).split('#')[0]}#${frag}`;
      pair.expiresAt = s.expiresAt; pair.withToken = !!t;
      pair.startDevices = (app.devices?.devices || []).map((x) => x.id);
    } catch (e) { pair.error = F.startPairMessage(e); }
    pair.busy = false;
    app.render();
  };
  return h('div', { class: 'pairform' },
    h('label', { class: 'label', htmlFor: 'pair-label', text: '设备名字' }), label,
    h('label', { class: 'label', htmlFor: 'pair-token', text: '令牌（可选）' }), token,
    h('p', { class: 'note', text: '填了就一起带进二维码，设备扫完不用再粘贴。令牌只留在这个页面里，不发给 Concierge 的服务。' }),
    pair.error ? h('p', { class: 'status is-error', text: pair.error }) : null,
    h('div', { class: 'action-row' }, button('生成二维码', go, { primary: true }), button('取消', () => { wipePairing(); app.render(); }, { cls: 'btn-quiet' })));
}

function modelsSection(app) {
  const o = app.view?.board?.options || {};
  const list = [
    // 主执行模型：Claude 和 GPT（Codex）都在这里，写明是哪个命令行、能不能在 Windows 上跑
    ...(o.models || []).map((m) => [m.name, [C.PROVIDER_LABEL[C.providerOf(m)], C.modelSub(m)].join(' · ')]),
    ...(o.consult || []).map((c) => [c.label, c.async ? `Concierge 测不了（在 ChatGPT 里由你自己选）· ${F.coordinatorStatus(c).text}` : c.verifiedAt ? `上次实测 ${F.day(c.verifiedAt)}` : '按配置，还没实测过']),
    ...(o.smallWork ? [['小动工 · Luna', o.smallWork.available ? `能用（${o.smallWork.model || 'gpt-5.6-luna'}）` : `暂时不能用：${o.smallWork.note || '原因不明'}`]] : []),
  ];
  const act = latest(app.actions, (a) => a.kind === 'caps');
  return section('可用模型',
    list.length ? rows(list, 'wide') : h('p', { class: 'note', text: '还没有读到。' }),
    h('p', { class: 'note', text: `实测调不通的不列；还没实测过的会标出来。${o.capabilitiesProbedAt ? `上次重测 ${F.dayTime(o.capabilitiesProbedAt)}。` : '还没手动重测过。'}重测会给每个模型发一次很小的调用。` }),
    app.transport.capabilities.capsProbe ? button('重新实测', () => app.act(() => app.transport.probeCaps())) : null,
    act && act.state === 'done' ? h('p', { class: 'status', attrs: { role: 'status' }, text: '已开始重测：在后台一个一个测，测完这里的日期会更新。' }) : statusLine(act, { online: app.macOnline(), app }));
}

// Windows 接收器（board.receivers）：编号、钥匙编号（和 Windows 上 pin 打印的对）、版本、自动启动、上一轮的错误类别
function receiversSection(app) {
  const list = Array.isArray(app.view?.board?.receivers) ? app.view.board.receivers : [];
  if (!list.length) {
    return section('Windows 接收器',
      // 页面里不写仓库名（托管副本是公开的）：只说 C:\Projects 下工程总仓库里的 _tools 文件夹
      h('p', { text: '还没有接入。在 Windows 上打开 C:\\Projects 下工程总仓库里的 _tools 文件夹，双击 receiver-setup.cmd：它会钉住 Mac 的钥匙、装好自动启动；接收器开始发心跳之后这里就有了。' }));
  }
  return section('Windows 接收器',
    ...list.map((r) => rows(F.receiverRows(r))),
    h('p', { class: 'note', text: '钥匙编号要和 Windows 上 receiver-setup.cmd（或 receiver.cmd pin）打印的「接收器钥匙编号」一样；对不上就是有别人抢先冒充了这台接收器。Mac 只认一台接收器：要换（或者清掉冒充的），得在 Mac 上有人值守地处理。在线＝最近 5 分钟里收到过它签名的心跳。' }));
}

function about(app) {
  const b = app.view?.board || {};
  // 页面、Mac 入口、Windows 接收器各是哪份代码；页面和入口对不上时说一句
  const ver = F.versionRows(b, BUILD, { local: app.local });
  const list = [...ver.rows, ['Mac 最近在线', b.mac?.seenAt ? F.dayTime(b.mac.seenAt) : '不知道']];
  const mismatch = ver.note ? h('p', { class: 'note is-warn', attrs: { id: 'version-note' }, text: ver.note }) : null;
  if (app.local) {
    const r = app.devices?.remote;
    list.push(['远端发布', !r ? '正在读取…' : !r.enabled ? '没有开启' : r.lastError ? '上一轮出错了（原因在下面）' : r.lastPublishAt ? `${F.dayTime(r.lastPublishAt)} 发布过` : '还没发布过']);
    if (r?.enabled && app.devices?.mac?.id) list.push(['Mac 钥匙编号', app.devices.mac.id]);
    // 出错的原文是给工程看的（可能带工程说法），折起来放
    return section('关于', rows(list), mismatch, r?.enabled && r.lastError ? h('details', { class: 'help' }, h('summary', { text: '工程上的原因' }), h('p', { text: String(r.lastError) })) : null);
  } else list.push(['看板更新于', b.at ? F.dayTime(b.at) : '不知道']);
  return section('关于', rows(list), mismatch);
}

export function renderSettings(app) {
  return [
    h('div', { class: 'tp-head' }, button('‹ 返回', () => app.back(), { cls: 'btn-quiet back', attrs: { 'aria-label': '关掉设置' } }), h('h2', { class: 'settings-title', text: '设置' })),
    thisDevice(app),
    app.transport.capabilities.devices ? devicesSection(app) : null,
    modelsSection(app),
    receiversSection(app),
    about(app),
  ].filter(Boolean);
}
