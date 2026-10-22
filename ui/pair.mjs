// 远端设备第一次打开（docs/UI.md §6、§11.13；hub#165 V2.md §14.3「扫码 / 输码 → 可信确认 → 完成」）。连好之前不显示任何任务内容。
// 起始屏三项：① 粘贴连接链接（Mac 上「添加设备」→「复制链接」，通用剪贴板；主屏幕 App 也先给这一项）② 扫码（说明）③ 手动连接码（折叠）。
//   扫码 / 粘贴链接之后（hub#165 §15.1）：一屏「连接到 Zoe 的 Mac？」（Mac、这台设备、「连接」「取消」）→ 连接中 → 完成（进主界面）。
//   链接里带着 GitHub 授权（Mac 启用了 GitHub App）就不出令牌那一屏；没带：「连接」之后一屏「首次连接需要一次 GitHub 授权」——
//   「去 GitHub 创建」+ 粘贴框 +「连接」，细节折叠（这一屏可以写令牌这类原名）。
//   手动：GitHub 授权 → 显示 12 位连接码 → 到 Mac 上「设置 → 设备 → 输入连接码」→ 页面内置了 Mac 的身份（发布过的页面）：自动显示「已连接」；
//   没内置（本地源码）：Mac 再显示 6 位确认码，输回这里，对上了才进入（终审 F1d）。
// 另外几屏：认的 Mac 一直核对不上 / 状态记录读不到（Mac 的身份对不上 / 状态记录换了 / 旧版本连接的）——直说，认的那把照旧记着，
// 「重新连接」由她自己点；已经连好的设备又打开了连接链接——先问一句要不要换（F1e）。界面上不出现令牌 / 公钥 / 签名（GitHub 授权那一屏除外）。
import { h, link } from '../lib/dom.mjs';
import { decodePairFragment } from '../lib/proto.mjs';
import { button } from './common.mjs';

const REPO = /^([A-Za-z0-9-]{1,39})\/([A-Za-z0-9_.-]{1,100})$/;

export const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
export const isStandalone = () => navigator.standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches === true;

// GitHub 授权（§0 语言规则的唯一例外：这一屏可以写 GitHub 设置页上的原名，不然她找不到那个开关）。
// 一个按钮打开 GitHub 的创建页（带好名字、到期、Issues 读写这些参数），一个粘贴框，细节折叠。已经有这台设备用过的直接粘贴。
function ghCreateUrl(frag, label) {
  const query = new URLSearchParams({ name: `Concierge ${label}`.slice(0, 40), expires_in: '30', issues: 'write' });
  if (frag?.o) query.set('target_name', frag.o);
  return `https://github.com/settings/personal-access-tokens/new?${query}`;
}
function tokenHelp(frag = null, label = '设备', next = '连接') {
  const repo = frag ? `${frag.o}/${frag.r}` : 'Mac 上 Concierge 使用的仓库';
  return h('details', { class: 'help token-help' }, h('summary', { text: '怎么创建、为什么需要' }),
    h('ol', {},
      h('li', { text: '点上面的「去 GitHub 创建」，登录自己的 GitHub 账号。保留这一页，建好后回来。' }),
      h('li', { text: `Resource owner 确认是 ${frag?.o || '仓库所有者'}。选 Only select repositories，只选 ${repo}；Issues 选 Read and write，其他权限保持默认。` }),
      h('li', { text: `确认到期日（默认 30 天），点 Generate token。复制生成的内容（github_pat_ 开头），回到这里粘贴，再点「${next}」。` })),
    h('p', { class: 'note', text: '为什么：这个页面直接和 GitHub 收发任务，所以每个浏览器要一份只给这个仓库 Issues 读写的令牌（Metadata 只读会自动带上）。不要选全部仓库、不要加代码权限，也不要用 Mac、命令行或 Windows 后台服务的高权限令牌。若 GitHub 要求组织批准，等批准后再连接。令牌只存在这个浏览器里、只发给 GitHub，不发给 Mac，不放进链接；到期后要换新的，清除浏览器数据或换浏览器后要重新粘贴。' }));
}
// 「首次连接需要一次 GitHub 授权」那一块：说明一句 + 去 GitHub 创建 + 粘贴框 + 细节折叠
function ghAuth(frag, label, inputId, value, onInput, next) {
  const tok = h('input', { id: inputId, type: 'password', autocomplete: 'off', spellcheck: false, value: value || '', placeholder: 'github_pat_…', attrs: { autocapitalize: 'off' } });
  tok.addEventListener('input', () => onInput(tok.value));
  const create = link(ghCreateUrl(frag, label), '去 GitHub 创建');
  create.className = 'btn gh-create';
  return { tok, node: h('div', { class: 'gh-auth' },
    h('p', { text: '这个浏览器第一次连接，需要一份只给 Concierge 用的 GitHub 授权（以后打开不用再做）。已经有这台设备用过的，直接粘贴。' }),
    h('div', { class: 'action-row' }, create),
    h('label', { class: 'label', htmlFor: inputId, text: '粘贴 GitHub 生成的令牌' }), tok,
    tokenHelp(frag, label, next)) };
}

// 这台设备是什么（按 isIos / isStandalone / UA 判）
export function deviceKind() {
  const ua = navigator.userAgent || '';
  const pad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const name = pad ? 'iPad' : 'iPhone';
  if (isIos() && isStandalone()) return { kind: 'ios-app', text: `${name} 主屏幕上的 Concierge App` };
  if (isIos()) return { kind: 'ios-safari', text: `${name} 上的 Safari 标签页` };
  if (/Windows/.test(ua)) return { kind: 'windows', text: 'Windows 上的浏览器' };
  if (isStandalone()) return { kind: 'app', text: '桌面上的 Concierge App' };
  return { kind: 'browser', text: '这台设备上的浏览器' };
}
const APP_NOTE = '这是主屏幕 App，和 Safari 里的是两套身份：Safari 里连好的，这里还要单独连一次。最省事：在 Mac 上点「添加设备」→「复制链接」，回到这里粘贴。';

const CHANGED = {
  'mac-key': ['Mac 的身份对不上', '这台设备连接时记住了 Mac 的钥匙。这几分钟里，状态记录上没有一份内容是这把钥匙发的，却有别的钥匙发的。可能是 Mac 上的 Concierge 重新生成了钥匙，也可能是有人在捣乱。为了不显示没核对过的内容，这里先什么都不显示。'],
  'state-replaced': ['Mac 换了一条状态记录', '这台设备连接时记住的那条状态记录被关掉、删掉或者转移了，Mac 上的 Concierge 会换一条新的，这台设备找不到它。'],
  legacy: ['要重新连接一次', '这台设备是用旧版本连接的，没有记住 Mac 的钥匙，核对不了 Mac 发来的内容。'],
};

function changedScreen(app, mc) {
  const [title, why] = CHANGED[mc.why] || CHANGED['mac-key'];
  return [h('h1', { class: 'pair-title', text: 'Concierge' }),
    h('section', { class: 'block mac-changed' }, h('h2', { text: title }),
      h('p', { text: why }),
      mc.why === 'legacy' ? null : h('p', { class: 'note', text: '这台设备还记着原来那把 Mac 钥匙，不会自己换掉它。要是只是一阵捣乱，等 Mac 上的 Concierge 用原来那把钥匙发出新的内容，这里会自己恢复。' }),
      h('p', { text: '要换成新的：在这台设备上重新连接（最好在 Mac 上用「设置 → 设备 → 添加设备」扫码），再到 Mac 的设备列表里把旧的这一台移除。' }),
      button('重新连接', async () => { await app.transport.unpair(); location.replace(location.pathname + location.search); }, { primary: true }))];
}

// 已经连好的设备打开了连接链接：不悄悄换掉认的 Mac，先问（终审 F1e）
function replaceScreen(app) {
  return [h('h1', { class: 'pair-title', text: 'Concierge' }),
    h('section', { class: 'block pair-replace' }, h('h2', { text: '这台设备已经连接过。要换成这次的连接吗？' }),
      h('p', { text: '换了之后，这台设备只认这个链接里的 Mac，原来的连接就不用了（再到 Mac 的设备列表里把旧的这一台移除）。不是你刚在 Mac 上点的「添加设备」，就别换。' }),
      app.pair.error ? h('p', { class: 'status is-error', text: app.pair.error }) : null,
      h('div', { class: 'action-row' },
        button(app.pair.busy ? '正在连接…' : '换成这次的连接', () => app.startLink(app.pair.frag, { replace: true }), { primary: true, disabled: !!app.pair.busy }),
        button('不换', () => app.cancelReplace(), { cls: 'btn-quiet' })))];
}

// 「连接到 Zoe 的 Mac？」（hub#165 §15.1）：扫码 / 粘贴链接之后先问一句。Mac 的名字看板里没有，写“Mac”；这台设备写它自己报的名字和是哪种身份
export const linkLabel = (app) => (isIos() && isStandalone() ? `${app.defaultLabel} 主屏幕` : app.defaultLabel);
// iPhone 的 Safari 里扫码打开（#172 F2）：相机扫码只会在 Safari 里打开，可手机通知只有主屏幕上的 Concierge 能收，
// 两边存的东西不通——所以先推荐“把这条链接复制到主屏幕 App 里去连”。复制在点击里直接调剪贴板（iOS 要求在手势里）；
// 复制不了就把链接显示出来让她自己长按选中。链接只在内存里（app.pair.rawLink），不存
export const HOME_STEPS = ['在 Safari 里点分享 → 添加到主屏幕（已经添加过就跳过）。', '点下面的「复制连接链接」。', '从主屏幕打开 Concierge，粘贴，点「连接」。'];
export const HOME_ONCE = '同一条链接只能连一台：在主屏幕 App 里连了，这里就不要再点连接；10 分钟内有效。';
export const CLIP_NOTE = '链接里含这台设备的连接授权，不要转发；连好之后复制点别的内容覆盖剪贴板。';
function homeHandoff(app) {
  const p = app.pair;
  const raw = typeof p.rawLink === 'string' ? p.rawLink : '';
  const copy = () => {
    let done;
    try { done = globalThis.navigator?.clipboard?.writeText ? globalThis.navigator.clipboard.writeText(raw) : Promise.reject(new Error('no clipboard')); } catch (e) { done = Promise.reject(e); }
    return Promise.resolve(done).then(() => { p.copyState = 'ok'; }, () => { p.copyState = 'fail'; }).then(() => app.render());
  };
  return h('div', { class: 'pair-home', attrs: { id: 'pair-home', role: 'group', 'aria-labelledby': 'pair-home-t' } },
    h('h3', { class: 'pair-home-t', attrs: { id: 'pair-home-t' }, text: '推荐：在主屏幕 App 里连接' }),
    h('p', { text: '手机通知只有主屏幕上的 Concierge 能收，Safari 里的收不到。' }),
    h('ol', { class: 'pair-home-steps' }, HOME_STEPS.map((x) => h('li', { text: x }))),
    raw ? h('div', { class: 'action-row' }, button('复制连接链接', copy, { primary: true, attrs: { id: 'pair-home-copy' } })) : null,
    p.copyState === 'ok' ? h('p', { class: 'status is-done', attrs: { role: 'status', id: 'pair-home-copied' }, text: '已复制。现在从主屏幕打开 Concierge，粘贴，点「连接」。' }) : null,
    // 复制不了（或者没拿到原样的链接）：把链接摆出来，长按就能全选
    raw && p.copyState === 'fail' ? h('p', { class: 'note', attrs: { role: 'status' }, text: '复制不了。长按下面这段，全选、拷贝：' }) : null,
    raw && p.copyState === 'fail' ? h('p', { class: 'pair-raw', attrs: { id: 'pair-raw' }, text: raw }) : null,
    h('p', { class: 'note', text: HOME_ONCE }),
    // 链接里含这台设备的连接授权（复审 8）：一次性和 10 分钟管的是连接邀请，链接里的授权本身连好之后还有效
    h('p', { class: 'note', attrs: { id: 'pair-home-clip' }, text: CLIP_NOTE }));
}
function confirmScreen(app) {
  const p = app.pair;
  const dk = deviceKind();
  const safari = isIos() && !isStandalone();
  return h('section', { class: 'block pair-ask', attrs: { id: 'pair-ask' } }, h('h2', { text: '连接到 Zoe 的 Mac？' }),
    h('dl', { class: 'rows pair-ask-rows' },
      h('div', { class: 'row' }, h('dt', { text: 'Mac' }), h('dd', { text: 'Mac（链接里的那一台）' })),
      h('div', { class: 'row' }, h('dt', { text: '这台设备' }), h('dd', { text: `${linkLabel(app)} · ${dk.text}` }))),
    safari ? homeHandoff(app) : null,
    safari ? h('h3', { class: 'pair-alt-t', attrs: { id: 'pair-alt-t' }, text: '或者就在 Safari 里连接' }) : null,
    h('p', { text: '连接之后，这台设备能看任务、提交、回答问题、做真机验收。批准动作要另外在「权限」里开启手机批准；敏感操作仍然只在 Mac 上批。' }),
    p.frag && !p.frag.t ? h('p', { class: 'note', text: '这个浏览器第一次连接：点「连接」之后还要做一次 GitHub 授权。' }) : null,
    h('p', { class: 'note', text: '不是你刚在 Mac 上点的「添加设备」，就点「取消」。链接 10 分钟内有效，只能用一次。' }),
    p.error ? h('p', { class: 'status is-error', attrs: { role: 'status' }, text: p.error }) : null,
    h('div', { class: 'action-row' },
      // Safari 里「连接」是第二选择（推荐的是上面的复制）：不用实心按钮
      button(p.busy ? '正在连接…' : '连接', () => app.confirmLink(), { primary: !safari, disabled: !!p.busy, attrs: { id: 'pair-ask-go' } }),
      button('取消', () => app.cancelReplace(), { cls: 'btn-quiet' })));
}

// 连接码：设备显示 12 位连接码；Zoe 在 Mac 上敲进去。页面内置了 Mac 的身份（pin 'build'）：Mac 上输对了，这里自己显示「已连接」；
// 没内置（pin 'board'）：Mac 显示 6 位确认码，她把确认码敲回这里，对上了才算连好（终审 F1d）
function codeScreen(app, pg) {
  const p = app.pair;
  if (pg.pin === 'build') {
    return h('section', { class: 'block pair-code' }, h('h2', { text: '到 Mac 上输入这个连接码' }),
      h('p', { class: 'code', text: pg.code || '', attrs: { 'aria-label': `连接码 ${pg.code || ''}` } }),
      h('p', { text: '在 Mac 上打开 Concierge → 设置 → 设备 →「添加设备」，在对话框下面的输入框里输入这 12 位。30 分钟内有效。' }),
      h('p', { class: 'waiting', attrs: { role: 'status', id: 'code-wait' } }, h('span', { class: 'breath', attrs: { 'aria-hidden': 'true' } }),
        h('span', { text: 'Mac 上输对之后，这里会自动显示「已连接」，不用再输别的。连好之前这里不显示任何任务。' })),
      h('div', { class: 'action-row' },
        button('Mac 上说没找到？重新开始', async () => { const label = app.pair.label; await app.transport.unpair(); app.pair = { step: 'code', label: label || app.defaultLabel }; app.render(); }, { cls: 'btn-quiet' }),
        button('取消连接', async () => { await app.transport.unpair(); app.pair = { step: 'start' }; app.render(); }, { cls: 'btn-quiet' })));
  }
  const input = h('input', { id: 'confirm-code', type: 'text', value: p.confirmText || '', maxLength: 12, autocomplete: 'off', spellcheck: false, placeholder: '000 000', attrs: { inputmode: 'numeric', 'aria-describedby': 'confirm-help' } });
  input.addEventListener('input', () => { p.confirmText = input.value; });
  const go = () => { input.blur(); app.confirmCode(input.value); };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
  return h('section', { class: 'block pair-code' }, h('h2', { text: '到 Mac 上输入这个连接码' }),
    h('p', { class: 'code', text: pg.code || '', attrs: { 'aria-label': `连接码 ${pg.code || ''}` } }),
    h('p', { text: '在 Mac 上打开 Concierge → 设置 → 设备 →「添加设备」，在对话框下面的输入框里输入这 12 位。30 分钟内有效。' }),
    h('div', { class: 'confirm-box' },
      h('label', { class: 'label', htmlFor: 'confirm-code', text: '再把 Mac 上显示的 6 位确认码输到这里' }),
      h('div', { class: 'code-row' }, input, button(p.busy ? '正在核对…' : '确认', go, { primary: true, disabled: !!p.busy })),
      p.confirmError ? h('p', { class: 'status is-error', attrs: { role: 'status', id: 'confirm-result' }, text: p.confirmError }) : null,
      h('p', { class: 'note', attrs: { id: 'confirm-help' }, text: 'Mac 上输对了连接码才会显示确认码。确认码对上了才算连好，连好之前这里不显示任何任务。' })),
    h('div', { class: 'action-row' },
      button('Mac 上说没找到？重新开始', async () => { const label = app.pair.label; await app.transport.unpair(); app.pair = { step: 'code', label: label || app.defaultLabel }; app.render(); }, { cls: 'btn-quiet' }),
      button('取消连接', async () => { await app.transport.unpair(); app.pair = { step: 'start' }; app.render(); }, { cls: 'btn-quiet' })));
}

export function renderPair(app) {
  const p = app.pair; // { step, frag, error, busy, found, token, label, confirmText, confirmError }
  const st = app.transport.status();
  if (p.step === 'link-replace' && p.frag) return replaceScreen(app);
  if (st.macChanged) return changedScreen(app, st.macChanged);
  const out = [h('h1', { class: 'pair-title', text: 'Concierge' })];
  const dk = deviceKind();
  // 扫码 / 粘贴链接之后：先问「连接到 Zoe 的 Mac？」
  if (p.step === 'link-confirm' && p.frag && !st.pairing) { out.push(confirmScreen(app)); return out; }

  // 连接中 / 失败
  if (st.pairing || (st.device && !st.paired)) {
    const pg = st.pairing;
    if (!pg || pg.state === 'failed') {
      out.push(h('section', { class: 'block' }, h('h2', { text: '没有连接成功' }),
        h('p', { class: 'status is-error', text: pg?.error || '连接请求没有送出去。' }),
        button('重新开始', async () => { const label = app.pair.label; await app.transport.unpair(); app.pair = pg?.mode === 'code' ? { step: 'code', label: label || app.defaultLabel } : { step: 'start' }; app.render(); }, { primary: true })));
      return out;
    }
    if (pg.mode === 'code') {
      if (dk.kind === 'ios-app') out.push(h('p', { class: 'note hint app-identity', attrs: { id: 'app-identity' }, text: APP_NOTE }));
      out.push(codeScreen(app, pg));
    } else {
      out.push(h('section', { class: 'block' }, h('h2', { text: '正在连接…' }),
        h('p', { text: '已经把这台设备的连接请求送到了。等 Mac 上的 Concierge 确认，通常半分钟内。' }),
        h('p', { class: 'note', text: 'Mac 要开着，上面的 Concierge 在运行。' })));
    }
    return out;
  }

  // 拿到了连接链接，但这个浏览器还没有 GitHub 授权：一屏「首次连接需要一次 GitHub 授权」
  if (p.step === 'link-token' && p.frag) {
    const gh = ghAuth(p.frag, app.defaultLabel, 'tok-link', p.token, (v) => { p.token = v; }, '连接');
    out.push(h('section', { class: 'block pair-gh' }, h('h2', { text: '首次连接需要一次 GitHub 授权' }),
      gh.node,
      p.error ? h('p', { class: 'status is-error', text: p.error }) : null,
      h('div', { class: 'action-row' }, button(p.busy ? '正在连接…' : '连接', () => app.pairLink(p.frag, gh.tok.value.trim()), { primary: true, disabled: !!p.busy }),
        button('取消', () => app.cancelReplace(), { cls: 'btn-quiet' })),
      h('p', { class: 'note', text: 'Mac 的邀请 10 分钟内有效；过期了在 Mac 上重新「添加设备」，已经建好的令牌不用重建。' })));
    return out;
  }

  // 手动：连接码（链接传不过来时）——名字 + GitHub 授权 → 找到状态记录 →（多个时选一个）→ 12 位连接码
  if (p.step === 'code') {
    if (dk.kind === 'ios-app') out.push(h('p', { class: 'note hint app-identity', attrs: { id: 'app-identity' }, text: APP_NOTE }));
    const label = h('input', { id: 'dev-label', type: 'text', value: p.label || '', maxLength: 40, autocomplete: 'off' });
    label.addEventListener('input', () => { p.label = label.value; });
    const gh = ghAuth(null, app.defaultLabel, 'tok-code', p.token, (v) => { p.token = v; }, '下一步');
    const sec = h('section', { class: 'block' }, h('h2', { text: '用连接码连接' }),
      h('label', { class: 'label', htmlFor: 'dev-label', text: '这台设备叫什么' }), label, gh.node);
    if (p.found && p.found.length > 1 && !p.busy) {
      sec.append(h('p', { text: '这份授权能看到好几个 Concierge，选一个：' }),
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
        app.discover(gh.tok.value.trim(), m ? { owner: m[1], repo: m[2] } : null);
      }, { primary: true, disabled: !!p.busy }),
      button('返回', () => { app.pair = { step: 'start' }; app.render(); }, { cls: 'btn-quiet' })));
    out.push(sec);
    return out;
  }

  // 起始屏（hub#165 §14.3）：① 粘贴连接链接（主屏幕 App 也先给这一项）② 扫码 ③ 手动连接码（折叠）
  const linkIn = h('input', { id: 'pair-link', type: 'url', autocomplete: 'off', spellcheck: false, placeholder: '粘贴 Mac 上复制的连接链接', value: p.linkText || '', attrs: { autocapitalize: 'off' } });
  linkIn.addEventListener('input', () => { p.linkText = linkIn.value; });
  const identity = dk.kind === 'ios-safari' ? `${dk.text}（和主屏幕上的 Concierge App 是两套身份，各连各的）`
    : dk.kind === 'ios-app' ? `${dk.text}（和 Safari 里的是两套身份，要单独连一次）` : dk.text;
  const useLink = () => {
    const raw = String(linkIn.value || '').trim();
    const i = raw.indexOf('#');
    const frag = i >= 0 ? decodePairFragment(raw.slice(i)) : null;
    linkIn.value = ''; p.linkText = '';
    if (!frag) { p.linkError = '这不是有效的连接链接。在 Mac 上重新点「添加设备」，再复制一次。'; app.render(); return; }
    p.linkError = null;
    app.startLink(frag, { rawLink: raw });
  };
  linkIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); useLink(); } });
  // 从剪贴板粘贴（#172 F2）：主屏幕 App 里从 Safari 复制过来的链接一下就进来。读剪贴板要在点击里（iOS 会弹一个「粘贴」气泡）；
  // 读不到（拒绝了 / 浏览器不给）→ 把焦点给输入框，提示长按选「粘贴」
  const clip = globalThis.navigator?.clipboard;
  const paste = typeof clip?.readText === 'function' ? button('从剪贴板粘贴', () => {
    let got;
    try { got = clip.readText(); } catch (e) { got = Promise.reject(e); }
    return Promise.resolve(got).then((text) => {
      linkIn.value = String(text || '').trim();
      p.pasteHint = null;
      useLink();
    }, () => {
      p.pasteHint = '读不到剪贴板。长按上面的输入框，选「粘贴」，再点「连接」。';
      app.render();
      globalThis.document?.getElementById?.('pair-link')?.focus?.();
    });
  }, { attrs: { id: 'pair-paste' } }) : null;
  out.push(
    h('p', { class: 'lead', text: '把这台设备连到 Mac 上的 Concierge。连好之前，这里不显示任何任务。' }),
    h('p', { class: 'pair-intro', attrs: { id: 'pair-intro' } }, h('span', { class: 'label', text: '这台设备 ' }), h('span', { text: identity })),
    dk.kind === 'ios-app' ? h('p', { class: 'note hint app-identity', attrs: { id: 'app-identity' }, text: APP_NOTE }) : null,
    h('section', { class: 'block pair-way', attrs: { 'data-way': 'link' } }, h('h2', { text: '粘贴连接链接' }),
      h('p', { text: '在 Mac 上打开 Concierge → 设置 → 设备 →「添加设备」，点「复制链接」，粘贴到这里（iPhone 和 Mac 之间可以用通用剪贴板）。' }),
      h('label', { class: 'sr-only', htmlFor: 'pair-link', text: '连接链接' }), linkIn,
      p.linkError ? h('p', { class: 'status is-error', text: p.linkError }) : null,
      p.pasteHint ? h('p', { class: 'note', attrs: { role: 'status', id: 'pair-paste-hint' }, text: p.pasteHint }) : null,
      h('div', { class: 'action-row' }, button('连接', useLink, { primary: true, attrs: { id: 'use-link' } }), paste)),
    h('section', { class: 'block pair-way', attrs: { 'data-way': 'scan' } }, h('h2', { text: '扫码' }),
      h('p', { text: dk.kind === 'ios-app'
        ? '主屏幕 App 里扫不了：相机扫码会在 Safari 里打开，那是另一个身份。这里用上面的「粘贴连接链接」。'
        : '在 Mac 上「添加设备」出二维码，用 iPhone 相机扫（会在 Safari 里打开）。Windows 用上面的粘贴链接。' })),
    h('details', { class: 'block pair-way pair-manual', attrs: { 'data-way': 'code' } }, h('summary', { text: '手动连接码（链接传不过来时）' }),
      h('p', { text: st.builtinMac
        ? '这里会显示一个 12 位连接码，到 Mac 上「设置 → 设备 → 添加设备」里输入；Mac 上输对了，这里自动显示「已连接」。要先在这台设备上做一次 GitHub 授权。'
        : '这里会显示一个 12 位连接码，到 Mac 上「设置 → 设备 → 添加设备」里输入；Mac 再给一个 6 位确认码，输回这里就连好了。要先在这台设备上做一次 GitHub 授权。' }),
      button('用连接码连接', () => { app.pair = { step: 'code', label: dk.kind === 'ios-app' ? `${app.defaultLabel} 主屏幕` : app.defaultLabel }; app.render(); })));
  return out;
}
