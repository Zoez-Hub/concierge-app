// 远端设备第一次打开（docs/UI.md §6）：一屏，两条路。配对完成前不显示任何任务内容。
//   1. 在 Mac 上「设置 → 添加设备」出二维码，用这台设备扫（或者把 Mac 上复制的链接粘贴到这里）。
//   2. 手动：粘贴令牌 → 显示 12 位配对码 → 到 Mac 上把这个码输进去 → Mac 上显示 6 位数字 → 输回这里，对上了才进入（终审 F1d）。
// 另外几屏：钉住的 Mac 一直验不过 / 状态记录读不到（Mac 的身份对不上 / 状态记录换了 / 旧版本配对的）——直说，钉住的那把照旧记着，
// 「重新配对」由她自己点；已经配好的设备又打开了配对链接——先问一句要不要换（F1e）。
import { h, link } from '../lib/dom.mjs';
import { decodePairFragment } from '../lib/proto.mjs';
import { button } from './common.mjs';

const REPO = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/;

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
export const isStandalone = () => navigator.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches === true;

function tokenHelp(frag = null, label = '设备') {
  const query = new URLSearchParams({ name: `Concierge ${label}`.slice(0, 40), expires_in: '30', issues: 'write' });
  if (frag?.o) query.set('target_name', frag.o);
  const repo = frag ? `${frag.o}/${frag.r}` : 'Mac 上 Concierge 使用的仓库';
  return h('div', { class: 'help token-help' },
    h('p', { text: '已有这台设备使用的专用凭据？直接粘贴即可，不必再建。否则按下面三步操作：' }),
    h('ol', {},
      h('li', {}, link(`https://github.com/settings/personal-access-tokens/new?${query}`, '打开 GitHub 创建访问凭据'), '，登录自己的 GitHub 账号。保留此页，创建后返回。'),
      h('li', { text: `Resource owner 确认是 ${frag?.o || '仓库所有者'}。选 Only select repositories，只选 ${repo}；Issues 选 Read and write，其他权限保持默认。` }),
      h('li', { text: `确认到期日（默认 30 天），点 Generate token。复制生成的内容，返回这里粘贴，再点「${frag ? '配对' : '下一步'}」。` })),
    h('details', {}, h('summary', { text: '权限、保存与到期说明' }),
      h('p', { class: 'note', text: '只需要这个仓库的 Issues 读写与自动附带的 Metadata 只读；不要选择全部仓库或增加代码权限。不要使用 Mac、命令行或 Windows 后台服务的高权限令牌。若 GitHub 要求组织批准，等批准后再配对。凭据只保存在当前浏览器并发给 GitHub，不发给 Mac，不放进链接。到期后需更新；清除浏览器数据或换浏览器后需重新设置。' })));
}

function iosHint() {
  if (!isIos() || isStandalone()) return null;
  return h('p', { class: 'note hint', text: '先在 Safari 完成配对，就可以使用。想像 App 一样打开，可稍后点分享 → 添加到主屏幕；如果主屏幕图标要求重新配对，已有专用凭据仍可使用。' });
}

const CHANGED = {
  'mac-key': ['Mac 的身份对不上', '这台设备配对时记住了 Mac 的签名钥匙。这几分钟里，状态记录上没有一份内容是用它签的，却有别的钥匙签的。可能是 Mac 上的 Concierge 重新生成了钥匙，也可能是有人在捣乱。为了不显示没核对过的内容，这里先什么都不显示。'],
  'state-replaced': ['Mac 换了一条状态记录', '这台设备配对时记住的那条状态记录被关掉、删掉或者转移了，Mac 上的 Concierge 会换一条新的，这台设备找不到它。'],
  legacy: ['要重新配对一次', '这台设备是用旧版本配对的，没有记住 Mac 的签名钥匙，核对不了 Mac 发来的内容。'],
};

function changedScreen(app, mc) {
  const [title, why] = CHANGED[mc.why] || CHANGED['mac-key'];
  return [h('h1', { class: 'pair-title', text: 'Concierge' }),
    h('section', { class: 'block mac-changed' }, h('h2', { text: title }),
      h('p', { text: why }),
      mc.why === 'legacy' ? null : h('p', { class: 'note', text: '这台设备还记着原来那把 Mac 钥匙，不会自己换掉它。要是只是一阵捣乱，等 Mac 上的 Concierge 用原来那把钥匙签出新的内容，这里会自己恢复。' }),
      h('p', { text: '要换成新的：在这台设备上重新配对（最好在 Mac 上用「设置 → 添加设备」扫码），再到 Mac 的设备列表里把旧的这一台移除。' }),
      button('重新配对', async () => { await app.transport.unpair(); location.replace(location.pathname + location.search); }, { primary: true }))];
}

// 已经配好的设备打开了配对链接：不悄悄换掉钉住的 Mac，先问（终审 F1e）
function replaceScreen(app) {
  return [h('h1', { class: 'pair-title', text: 'Concierge' }),
    h('section', { class: 'block pair-replace' }, h('h2', { text: '这台设备已经配对过。要换成这次的配对吗？' }),
      h('p', { text: '换了之后，这台设备只认这个链接里的 Mac，原来的配对就不用了（再到 Mac 的设备列表里把旧的这一台移除）。不是你刚在 Mac 上点的「添加设备」，就别换。' }),
      app.pair.error ? h('p', { class: 'status is-error', text: app.pair.error }) : null,
      h('div', { class: 'action-row' },
        button(app.pair.busy ? '正在配对…' : '换成这次的配对', () => app.startLink(app.pair.frag, { replace: true }), { primary: true, disabled: !!app.pair.busy }),
        button('不换', () => app.cancelReplace(), { cls: 'btn-quiet' })))];
}

// 配对码配对：设备显示 12 位码；Zoe 在 Mac 上敲进去，Mac 显示 6 位数字；她把数字敲回这里，对上了才算配好（终审 F1d）
function codeScreen(app, pg) {
  const p = app.pair;
  const input = h('input', { id: 'confirm-code', type: 'text', value: p.confirmText || '', maxLength: 12, autocomplete: 'off', spellcheck: false, placeholder: '000 000', attrs: { inputmode: 'numeric', 'aria-describedby': 'confirm-help' } });
  input.addEventListener('input', () => { p.confirmText = input.value; });
  const go = () => { input.blur(); app.confirmCode(input.value); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return h('section', { class: 'block pair-code' }, h('h2', { text: '到 Mac 上把这个码输进去' }),
    h('p', { class: 'code', text: pg.code || '', attrs: { 'aria-label': `配对码 ${pg.code || ''}` } }),
    h('p', { text: '在 Mac 上打开 Concierge → 设置 → 设备，在「输入设备上显示的配对码」里输入上面这 12 位，点「配对」。' }),
    h('p', { class: 'note', text: '30 分钟内有效。码只在这台设备上显示：Mac 不会列出来让你核对。' }),
    h('div', { class: 'confirm-box' },
      h('label', { class: 'label', htmlFor: 'confirm-code', text: '再把 Mac 上显示的 6 位数字输到这里' }),
      h('div', { class: 'code-row' }, input, button(p.busy ? '正在核对…' : '确认', go, { primary: true, disabled: !!p.busy })),
      p.confirmError ? h('p', { class: 'status is-error', attrs: { role: 'status', id: 'confirm-result' }, text: p.confirmError }) : null,
      h('p', { class: 'note', attrs: { id: 'confirm-help' }, text: 'Mac 上敲对了码才会显示这 6 位数字。数字对上了这台设备才算配好，配好之前这里不显示任何任务。' })),
    h('div', { class: 'action-row' },
      button('Mac 上说没找到？重新开始', async () => { const label = app.pair.label; await app.transport.unpair(); app.pair = { step: 'code', label: label || app.defaultLabel }; app.render(); }, { cls: 'btn-quiet' }),
      button('取消配对', async () => { await app.transport.unpair(); app.pair = { step: 'start' }; app.render(); }, { cls: 'btn-quiet' })));
}

export function renderPair(app) {
  const p = app.pair; // { step, frag, error, busy, found, token, label, confirmText, confirmError }
  const st = app.transport.status();
  if (p.step === 'link-replace' && p.frag) return replaceScreen(app);
  if (st.macChanged) return changedScreen(app, st.macChanged);
  const out = [h('h1', { class: 'pair-title', text: 'Concierge' })];

  // 配对中 / 失败
  if (st.pairing || (st.device && !st.paired)) {
    const pg = st.pairing;
    if (!pg || pg.state === 'failed') {
      out.push(h('section', { class: 'block' }, h('h2', { text: '没有配对成功' }),
        h('p', { class: 'status is-error', text: pg?.error || '配对请求没有送出去。' }),
        button('重新开始', async () => { const label = app.pair.label; await app.transport.unpair(); app.pair = pg?.mode === 'code' ? { step: 'code', label: label || app.defaultLabel } : { step: 'start' }; app.render(); }, { primary: true })));
      return out;
    }
    if (pg.mode === 'code') {
      out.push(codeScreen(app, pg));
    } else {
      out.push(h('section', { class: 'block' }, h('h2', { text: '正在配对…' }),
        h('p', { text: '已经把这台设备的配对请求送到了。等 Mac 上的 Concierge 确认，通常半分钟内。' }),
        h('p', { class: 'note', text: 'Mac 要开着，上面的 Concierge 在运行。' })));
    }
    return out;
  }

  // 拿到了配对链接，但链接里没有令牌：要先粘贴令牌
  if (p.step === 'link-token' && p.frag) {
    const tok = h('input', { id: 'tok-link', type: 'password', autocomplete: 'off', spellcheck: false, value: p.token || '', attrs: { autocapitalize: 'off' } });
    tok.addEventListener('input', () => { p.token = tok.value; });
    out.push(h('section', { class: 'block' }, h('h2', { text: '完成这台设备的一次性设置' }),
      h('p', { text: '已收到 Mac 的邀请。首次使用需要给这台设备开通 GitHub 访问，用来收发任务；以后打开无需重复设置。' }),
      tokenHelp(p.frag, app.defaultLabel),
      h('label', { class: 'label', htmlFor: 'tok-link', text: '粘贴 GitHub 访问凭据（令牌）' }), tok,
      h('p', { class: 'note', text: '邀请 10 分钟内有效；过期后在 Mac 重新添加设备，已有专用凭据不用重建。iPhone 先在 Safari 配对即可使用。' }),
      p.error ? h('p', { class: 'status is-error', text: p.error }) : null,
      h('div', { class: 'action-row' }, button(p.busy ? '正在配对…' : '配对', () => app.pairLink(p.frag, tok.value.trim()), { primary: true, disabled: !!p.busy }),
        button('取消', () => { app.pair = { step: 'start' }; app.render(); }, { cls: 'btn-quiet' }))));
    return out;
  }

  // 手动：粘贴令牌 → 找到仓库 →（多个时选一个）→ 配对码
  if (p.step === 'code') {
    const tok = h('input', { id: 'tok-code', type: 'password', autocomplete: 'off', spellcheck: false, value: p.token || '', attrs: { autocapitalize: 'off' } });
    tok.addEventListener('input', () => { p.token = tok.value; });
    const label = h('input', { id: 'dev-label', type: 'text', value: p.label || '', maxLength: 40, autocomplete: 'off' });
    label.addEventListener('input', () => { p.label = label.value; });
    const sec = h('section', { class: 'block' }, h('h2', { text: '手动配对' }),
      h('label', { class: 'label', htmlFor: 'dev-label', text: '这台设备叫什么' }), label,
      h('label', { class: 'label', htmlFor: 'tok-code', text: '令牌' }), tok, tokenHelp(null, app.defaultLabel));
    if (p.found && p.found.length > 1 && !p.busy) {
      sec.append(h('p', { text: '这个令牌能看到好几个 Concierge，选一个：' }),
        h('div', { class: 'action-row' }, p.found.map((f) => button(`${f.owner}/${f.repo}`, () => app.pairCode(f)))));
    }
    if (p.askRepo) {
      const repo = h('input', { id: 'repo', type: 'text', autocomplete: 'off', spellcheck: false, placeholder: '所有者/仓库', value: p.repo || '', attrs: { autocapitalize: 'off' } });
      repo.addEventListener('input', () => { p.repo = repo.value; });
      sec.append(h('label', { class: 'label', htmlFor: 'repo', text: '自动没找到：填 Concierge 所在的仓库' }), repo);
    }
    if (p.error) sec.append(h('p', { class: 'status is-error', text: p.error }));
    sec.append(h('div', { class: 'action-row' },
      button(p.busy ? '正在找…' : '下一步', () => {
        const m = p.askRepo && String(p.repo || '').trim().match(REPO);
        if (p.askRepo && String(p.repo || '').trim() && !m) { p.error = '仓库要写成「所有者/仓库」'; app.render(); return; }
        app.discover(tok.value.trim(), m ? { owner: m[1], repo: m[2] } : null);
      }, { primary: true, disabled: !!p.busy }),
      button('返回', () => { app.pair = { step: 'start' }; app.render(); }, { cls: 'btn-quiet' })));
    out.push(sec);
    return out;
  }

  // 起始屏
  const linkIn = h('input', { id: 'pair-link', type: 'url', autocomplete: 'off', spellcheck: false, placeholder: '粘贴 Mac 上复制的配对链接', value: p.linkText || '', attrs: { autocapitalize: 'off' } });
  linkIn.addEventListener('input', () => { p.linkText = linkIn.value; });
  out.push(
    h('p', { class: 'lead', text: '把这台设备和 Mac 上的 Concierge 配对。配好之前，这里不显示任何任务。' }),
    iosHint(),
    h('section', { class: 'block' }, h('h2', { text: '扫码（推荐）' }),
      h('p', { text: '在 Mac 上打开 Concierge → 设置 → 添加设备，用这台设备扫码。' }),
      h('label', { class: 'label', htmlFor: 'pair-link', text: '或者粘贴配对链接' }), linkIn,
      p.linkError ? h('p', { class: 'status is-error', text: p.linkError }) : null,
      button('用这个链接配对', () => {
        const raw = String(linkIn.value || '').trim();
        const i = raw.indexOf('#');
        const frag = i >= 0 ? decodePairFragment(raw.slice(i)) : null;
        linkIn.value = ''; p.linkText = '';
        if (!frag) { p.linkError = '这不是有效的配对链接。在 Mac 上重新点「添加设备」，再复制一次。'; app.render(); return; }
        p.linkError = null;
        app.startLink(frag);
      })),
    h('section', { class: 'block' }, h('h2', { text: '手动：粘贴令牌' }),
      h('p', { text: '无法传递配对链接时：粘贴专用访问凭据，这里会显示一个 12 位的配对码，到 Mac 上把它输进去。Windows 也可以直接打开 Mac 复制的链接。' }),
      button('粘贴令牌', () => { app.pair = { step: 'code', label: app.defaultLabel }; app.render(); })));
  return out;
}
