// 远端取数方式（iPhone / Windows 上的静态副本）：只和 https://api.github.com 说话（docs/REMOTE.md）。
//   读  状态 Issue 上 Mac 发布的评论（board 一条、每个任务一条 tv），每一条都带 Mac 钥匙的签名。
//       只显示用**配对时钉住的 Mac 公钥**验得过的（proto.readStateViews），同一个看板 / 任务只认 seq 最大的，
//       验过的缓存（带 seq）存在 IndexedDB 里：刷新、重开都不会退回更旧的视图。验不过的一律不显示。
//       第一次整页读；之后按 GitHub 的 since（评论更新时间）只读变了的，没变时带 ETag（304）。
//   写  新任务 = 在收件仓库建一条带设备签名的 Issue；别的动作 = 在状态 Issue 上留一条签名的 cmd 评论。
//       回答 / 让后台继续 / 请咨询都带 card：设备看到的那张（验过签的）卡片的指纹，Mac 对不上就拒绝。
//   配对 = 留一条 enroll 评论。链接配对：片段里的 m 就是 Mac 公钥，钉住它；配对码：从看板的自签名里取 Mac 公钥
//         （恰好一把才继续），显示 pairingCode(自己的公钥, Mac 公钥)，Zoe 把它敲进 Mac 上的 Concierge；
//         Mac 本机页面再显示 6 位数字，Zoe 敲回这台设备，和 pairingConfirm(自己的公钥, 钉住的 Mac 公钥) 对得上才算配好（终审 F1d）。
//   钉住的 Mac 公钥：这台设备自己从不丢掉、也不换掉它（终审 F1c、F1e）。状态记录读不到、看板验不过时整屏说明，
//         照旧记着原来那把，只给「重新配对」（她自己点）；钉住的那把又签出了新的看板就自己恢复。
// 签名、信封、配对片段、视图验签一律用共用模块 lib/proto.mjs（和 Mac 那边同一个文件），这里不另写。
//
// 安全规矩：
//   - 私钥 extractable:false，只存在 IndexedDB 里（私钥、公钥分两条记录）；不导出、不上传。
//   - 令牌只放在 IndexedDB 和请求的 Authorization 头里：不进地址、不进日志、不进错误信息、不写到 GitHub 上。
//   - 提交和动作先落本地 outbox 再发，带客户端编号：结果不明时先查 GitHub 上有没有，再决定重发（同一个编号）。
//   - 从 GitHub 读到的一切都是不可信输入：界面只拿验过签的视图，只用 textContent 显示。
import * as P from '../lib/proto.mjs';

export const API = 'https://api.github.com';
export const STATE_LABEL = 'concierge-state';
export const RESIGN_MS = 10 * 60000;        // 签名时间超过 10 分钟的重发：同一个编号重新签（Mac 按评论创建时间 ±15 分钟验）
export const BACKOFF = [5000, 15000, 30000, 60000, 120000, 300000];
export const PAIR_GRACE_MS = 75000;         // 配对请求被 Mac 删掉之后，等这么久还没出现在（验过签的）设备名单里，就算没成功
export const CODE_TTL_MS = 30 * 60000;      // 配对码：Mac 只认 30 分钟以内的配对请求
export const ACK_TIMEOUT_MS = 180000;       // 动作送出去之后，Mac 在线却这么久没有回执：算没送到（不当成已经做了）
export const MAC_CHANGE_MS = 3 * 60000;     // 看板换了一把 Mac 钥匙、钉住的那把一直验不过，持续这么久才算“Mac 的身份变了”
export const SINCE_MARGIN_MS = 5 * 60000;   // 按更新时间增量读时往回多读的一段（同一秒里的改动、GitHub 的延迟）
export const ISSUE_CHECK_MS = 120000;       // Mac 看起来不在线时，最多这么久核对一次状态记录还开着没有
export const ONLINE_MS = 15 * 60000;        // 看板 10 分钟一次心跳；超过 15 分钟没消息算 Mac 不在线
export const CONFIRM_TRIES = 5;             // 配对码的反方向确认：6 位数字最多输 5 次，错满了这次配对作废（重新开始会换一把新钥匙）
export const CONFIRM_GRACE_MS = 10 * 60000; // Mac 只认 30 分钟以内的配对请求；在 Mac 上敲对之后，再给 10 分钟把 6 位数字敲回来
// 再发一次 / 签名太旧自动重签时，任务的卡片已经和 Zoe 当时操作的那张不一样了：不重签、不发（终审 F2）
export const CARD_CHANGED = '这个任务的内容在你操作之后变了，看一下新的内容再操作';
// Mac 回执里的两句固定的话（lib/remote.mjs 的 CARD_ACK / STALE_ACK，有测试盯着一字不差）
export const CARD_ACK = '页面和 Mac 上的不一致，请刷新后再试';
export const STALE_ACK = '这条操作太旧了，请在设备上重新操作';
const DONE_KEEP_MS = 10 * 60000;
const FAILED_KEEP_MS = 24 * 3600000;
const MAX_PAGES = 10;
const MAX_CACHE = 200;
const TASK_KINDS = ['answer', 'resume', 'consult', 'cancel'];
const STATES = ['queued', 'working', 'needs_zoe', 'done', 'handed_off', 'stalled', 'paused', 'cancelled'];
const REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}#[1-9][0-9]{0,8}$/;

export class GhError extends Error {
  constructor(message, { status = 0, definitive = false, code = null } = {}) { super(message); this.status = status; this.definitive = definitive; this.code = code; }
}

// HTTP 状态 → 一句人话。不带响应正文、不带请求头（里面有令牌）
function httpError(status, headers) {
  const limited = headers?.get?.('x-ratelimit-remaining') === '0' || headers?.get?.('retry-after');
  if (status === 401) return new GhError('令牌不对或已经过期。到设置里解除配对，再用新令牌配对', { status, definitive: true });
  if (status === 403 && limited) return new GhError('GitHub 暂时限流了，稍后自动再试', { status });
  if (status === 429) return new GhError('GitHub 暂时限流了，稍后自动再试', { status });
  if (status === 403) return new GhError('这个令牌没有权限（需要那个仓库的 Issues 读写）', { status, definitive: true });
  if (status === 404) return new GhError('找不到：令牌看不到那个仓库，或者那条记录被删了', { status, definitive: true });
  if (status === 410) return new GhError('那条记录已经不在了', { status, definitive: true });
  if (status === 422) return new GhError('GitHub 不接受这条内容', { status, definitive: true });
  if (status >= 500) return new GhError('GitHub 出错了，稍后自动再试', { status });
  return new GhError(`GitHub 回了 ${status}`, { status, definitive: status >= 400 && status < 500 });
}

const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o);
const validTask = (tv) => isPlain(tv) && tv.v === 1 && typeof tv.ref === 'string' && REF.test(tv.ref) && STATES.includes(tv.state);
const validBoard = (b) => isPlain(b) && b.v === 1;
const hasNext = (link) => /rel="next"/.test(link || '');
const blankViews = () => ({ cache: {}, cursor: null, etagUrl: null, etag: null, rejected: 0, readAt: null });

export function makeGithubTransport({
  store, fetch = globalThis.fetch.bind(globalThis), now = () => Date.now(),
  pairGraceMs = PAIR_GRACE_MS, ackTimeoutMs = ACK_TIMEOUT_MS, macChangeMs = MAC_CHANGE_MS,
} = {}) {
  let cfg = null;            // { owner, repo, stateIssue, login, userId, pairedAt, label, macId }
  let token = null;
  let privateKey = null;
  let pub = null;
  let deviceId = null;
  let macPub = null;         // 配对时钉住的 Mac 公钥：只显示它签过的东西
  let pairing = null;        // { mode:'link'|'code', commentId, postedAt, goneAt, state:'waiting'|'failed', error, code }
  let vs = blankViews();     // 验过签的视图缓存（readStateViews 的 cache）+ 读到哪儿了
  let view = null;           // 从 vs.cache 算出来的 { board, tasks }：界面只渲染它
  let macChanged = null;     // { why: 'mac-key' | 'state-replaced' | 'legacy', at, seq }：钉住的 Mac 一直验不过 / 状态记录读不到了
  let suspect = null;        // { since }：看到了别的钥匙自签名的看板、钉住的那把没验过——先怀疑，持续够久才算
  let recheckAt = 0;         // 整屏说明期间，最近一次去看钉住的那把是不是又签出了新看板
  let needFull = false;      // 下一次整页读（卡片对不上之后、怀疑 Mac 换了钥匙时）
  let issueCheckedAt = 0;
  let lastOk = null;
  let lastError = null;
  let refreshing = null;
  const verified = new WeakSet(); // 验过签的视图对象（动作只能从这些卡片发出）
  const mine = new Map();         // 读到过的、这台设备自己的 cmd：动作编号 → 评论编号
  const inflight = new Set();

  const repoPath = (o = cfg?.owner, r = cfg?.repo) => `/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}`;
  const iso = (ms) => new Date(ms).toISOString();

  async function api(method, path, { body, etag, tok } = {}) {
    const auth = tok || token;
    if (!auth) throw new GhError('这台设备还没有令牌', { definitive: true });
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${auth}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (etag) headers['If-None-Match'] = etag;
    let r;
    try {
      r = await fetch(`${API}${path}`, {
        method, headers, body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store', credentials: 'omit', mode: 'cors', referrerPolicy: 'no-referrer',
      });
    } catch { throw new GhError('连不上 GitHub（网络断了，或者被拦了）'); }
    if (r.status === 304) return { status: 304, data: null, etag };
    if (!r.ok) throw httpError(r.status, r.headers);
    let data = null;
    if (r.status !== 204) { try { data = await r.json(); } catch { data = null; } }
    return { status: r.status, data, etag: r.headers.get('etag'), link: r.headers.get('link') || '' };
  }

  // ---- 本地状态 ----

  async function load() {
    [cfg, token, privateKey, pub, deviceId, pairing, macPub, macChanged] = await Promise.all(
      ['config', 'token', 'privateKey', 'publicKey', 'deviceId', 'pairing', 'macPub', 'macChanged'].map((k) => store.get(k)),
    );
    cfg = cfg || null; pairing = pairing || null; macPub = macPub ? P.pubOf(macPub) : null; macChanged = macChanged || null;
    await store.del('view').catch(() => {}); // 旧版本（不验签）留下的缓存：不用
    const saved = await store.get('views');
    vs = blankViews();
    if (saved && isPlain(saved.cache) && macPub) {
      // 本地缓存也只认验得过的（重新验一遍，很快）
      for (const [k, p] of Object.entries(saved.cache)) {
        if (p && p.key === k && (await P.verifyStateComment(macPub, p))) vs.cache[k] = p;
      }
      vs.cursor = saved.cursor || null; vs.etagUrl = saved.etagUrl || null; vs.etag = saved.etag || null; vs.rejected = Number(saved.rejected) || 0;
    }
    // 旧版本配对的设备没有钉住 Mac 公钥：什么都验不了，要重新配对
    if (cfg?.pairedAt && !macPub && !macChanged) macChanged = { why: 'legacy', at: iso(now()) };
    derive();
  }
  const saveCfg = () => store.set('config', cfg);
  const savePairing = () => (pairing ? store.set('pairing', pairing) : store.del('pairing'));
  const saveViews = () => store.set('views', vs).catch(() => {});

  function reset() {
    cfg = null; token = null; privateKey = null; pub = null; deviceId = null; macPub = null; pairing = null;
    vs = blankViews(); view = null; macChanged = null; suspect = null; recheckAt = 0; needFull = false; issueCheckedAt = 0; lastOk = null; lastError = null;
    mine.clear();
  }

  // 缓存 → 界面的视图。任务：看板列着的，或者比看板还新的（刚发布、看板还没跟上）；比看板旧又不在看板里的，是移出窗口的旧任务
  function derive() {
    const b = vs.cache.board;
    if (!b || !validBoard(b.view)) { view = null; return; }
    const listed = new Set(Array.isArray(b.view.tasks) ? b.view.tasks : []);
    const tasks = Object.values(vs.cache).filter((p) => p.kind === 'tv' && validTask(p.view) && (listed.has(p.view.ref) || p.seq > b.seq)).map((p) => p.view);
    view = { board: b.view, tasks };
    verified.add(b.view);
    for (const t of tasks) verified.add(t);
  }

  // 缓存太大时丢掉最旧的任务视图（看板永远留着）
  function capCache(cache) {
    const keys = Object.keys(cache).filter((k) => k !== 'board');
    if (keys.length <= MAX_CACHE) return cache;
    const drop = new Set(keys.sort((a, b) => cache[a].seq - cache[b].seq).slice(0, keys.length - MAX_CACHE));
    return Object.fromEntries(Object.entries(cache).filter(([k]) => !drop.has(k)));
  }

  // 整屏说明（Mac 的身份对不上 / 状态记录换了）。钉住的 Mac 公钥、令牌、钥匙都不动（终审 F1c）：只有 Zoe 点「重新配对」才清。
  // seq：出事时看板的 seq——之后钉住的那把签出了更新的看板（Mac 在线），就自己恢复（recheck）
  async function setMacChanged(why) {
    if (macChanged) return;
    macChanged = { why, at: iso(now()), seq: vs.cache.board?.seq || 0 };
    recheckAt = now();
    await store.set('macChanged', macChanged).catch(() => {});
  }

  // 整屏说明期间，最多两分钟看一次：钉住的那条状态记录开着，上面有一份钉住的钥匙验得过、比出事时更新、Mac 最近在线的看板
  // → 是一阵捣乱（有人关了又开、改坏了看板又被 Mac 重写……），恢复，整页重读。只认钉住的那把钥匙签的，假的造不出来。
  async function recheck() {
    if (!macChanged || macChanged.why === 'legacy' || !macPub || !cfg?.pairedAt) return false;
    if (now() - recheckAt < ISSUE_CHECK_MS) return false;
    recheckAt = now();
    try {
      const it = await api('GET', `${repoPath()}/issues/${cfg.stateIssue}`);
      if (it.data?.state !== 'open') return false;
      const bodies = await allBodies(cfg.owner, cfg.repo, cfg.stateIssue);
      for (const b of bodies) {
        const p = P.parseStateComment(b);
        if (!p || p.kind !== 'board' || !(p.seq > (Number(macChanged.seq) || 0))) continue;
        const seen = Date.parse(p.view?.mac?.seenAt);
        if (!Number.isFinite(seen) || now() - seen > ONLINE_MS) continue;
        if (!(await P.verifyStateComment(macPub, p))) continue;
        macChanged = null; suspect = null; needFull = true; issueCheckedAt = 0;
        await store.del('macChanged').catch(() => {});
        return true;
      }
    } catch { /* 读不到就是还没好，两分钟后再看 */ }
    return false;
  }

  const macOnline = () => {
    const seen = Date.parse(view?.board?.mac?.seenAt);
    return Number.isFinite(seen) && now() - seen <= ONLINE_MS;
  };

  // ---- 读状态 Issue ----

  // 一条 Issue 上的全部评论正文（配对码配对时用：还没有钉住的 Mac 公钥，要看全部的自签名看板）
  async function allBodies(owner, repo, issue, tok) {
    const base = `${repoPath(owner, repo)}/issues/${Number(issue)}/comments?per_page=100`;
    const out = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await api('GET', `${base}&page=${page}`, { tok });
      for (const c of Array.isArray(r.data) ? r.data : []) if (typeof c?.body === 'string') out.push(c.body);
      if (!hasNext(r.link)) break;
    }
    return out;
  }

  // 读一轮：full 时整页读，否则从上次读到的最新更新时间往回 5 分钟起读（GitHub 的 since 按评论更新时间过滤，从旧到新）
  async function readState({ full = false } = {}) {
    const base = `${repoPath()}/issues/${cfg.stateIssue}/comments?per_page=100`;
    const since = !full && vs.cursor?.since ? vs.cursor.since : null;
    const url = since ? `${base}&since=${encodeURIComponent(since)}` : base;
    let first;
    try { first = await api('GET', `${url}&page=1`, { etag: !full && vs.etagUrl === url ? vs.etag : null }); } catch (e) {
      // 状态记录读不到了（被删、被转移）：Mac 会换一条新的，这台设备要重新配对才找得到
      if (cfg.pairedAt && (e.status === 404 || e.status === 410)) await checkIssue({ force: true });
      throw e;
    }
    if (first.status === 304) return { fresh: false, changed: false };
    const all = Array.isArray(first.data) ? [...first.data] : [];
    let more = hasNext(first.link);
    let pages = 1;
    for (let page = 2; more && page <= MAX_PAGES; page++) {
      const r = await api('GET', `${url}&page=${page}`);
      if (Array.isArray(r.data)) all.push(...r.data);
      more = hasNext(r.link); pages += 1;
    }
    const comments = all.filter((c) => c && Number.isSafeInteger(c.id) && typeof c.body === 'string');
    const bodies = comments.map((c) => c.body);
    const r = await P.readStateViews(bodies, macPub, vs.cache);
    // 读到的最新更新时间（GitHub 的时间，不用这台设备的钟）。超过页数上限没读完的：下一次从读到的最后一条接着往后读
    let maxAt = Date.parse(vs.cursor?.maxAt) || 0;
    for (const c of comments) { const t = Date.parse(c.updated_at); if (Number.isFinite(t) && t > maxAt) maxAt = t; }
    vs = {
      cache: capCache(r.cache),
      cursor: maxAt ? { maxAt: iso(maxAt), since: iso(maxAt - SINCE_MARGIN_MS) } : vs.cursor,
      // ETag 只在一页读完时有意义（多页时第一页没变不代表后面没变）
      etagUrl: url, etag: pages === 1 && !more ? first.etag : null,
      rejected: r.rejected, readAt: iso(now()),
    };
    await saveViews();
    // 这台设备自己的动作评论（结果不明时据此判断“其实已经送到了”）
    for (const c of comments) {
      if (!/^\s*<!-- concierge:cmd /.test(c.body)) continue;
      const p = P.parseCommand(c.body);
      if (p.ok && p.cmd.device === deviceId) mine.set(p.cmd.id, c.id);
    }
    await watchMac(bodies, full);
    derive();
    return { fresh: true, changed: r.changed.length > 0 };
  }

  // Mac 的身份还是不是钉住的那把：看板里没有一条验得过，却有别的钥匙自签名的看板 → 先怀疑，整页读确认，持续 3 分钟才算变了。
  // （有人贴一份假看板、或者改坏了真看板：Mac 一两轮之内就清掉 / 重写，不会走到“变了”。）
  async function watchMac(bodies, full) {
    if (!macPub || !cfg?.pairedAt) return;
    const boards = bodies.map((b) => P.parseStateComment(b)).filter((p) => p && p.kind === 'board');
    if (!boards.length) return;
    for (const p of boards) if (await P.verifyStateComment(macPub, p)) { suspect = null; return; }
    const foreign = (await P.selfSignedMacs(bodies)).filter((m) => m.id !== cfg.macId);
    if (!foreign.length) return;
    if (!suspect) suspect = { since: now() };
    else if (full && now() - suspect.since >= macChangeMs) await setMacChanged('mac-key');
    needFull = true;
  }

  // 状态记录还开着吗（Mac 看起来不在线时才查，最多两分钟一次）。没了（404 / 410）或者关了：Mac 会换一条新的。
  // 标签不算数（终审 F1a）：共用账号谁都能去掉 concierge-state 标签，Mac 那边本来就不看标签（还会补回去）。
  async function checkIssue({ force = false } = {}) {
    if (!cfg?.pairedAt || macChanged) return;
    if (!force && (macOnline() || now() - issueCheckedAt < ISSUE_CHECK_MS)) return;
    issueCheckedAt = now();
    let it;
    try { it = await api('GET', `${repoPath()}/issues/${cfg.stateIssue}`); } catch (e) {
      if (e.status === 404 || e.status === 410) await setMacChanged('state-replaced');
      return;
    }
    if (it.data?.state !== 'open') await setMacChanged('state-replaced');
  }

  // ---- 配对 ----

  // label：配对码配对按标签找状态记录（只是线索，真假靠签名和两个方向的确认）；链接配对跟着链接里的 i 走，不看标签（终审 F1f）
  async function checkStateIssue(owner, repo, issue, tok, { label = true } = {}) {
    const it = await api('GET', `${repoPath(owner, repo)}/issues/${Number(issue)}`, { tok });
    const labels = (it.data?.labels || []).map((l) => (typeof l === 'string' ? l : l?.name));
    if ((label && !labels.includes(STATE_LABEL)) || it.data?.state !== 'open' || it.data?.pull_request) throw new GhError('那条记录不是 Concierge 的状态记录，配对不了', { definitive: true });
  }

  async function setupDevice({ owner, repo, issue, tok, label, mac, login, userId }) {
    const m = P.pubOf(mac);
    if (!m) throw new GhError('没有拿到 Mac 的公钥，配对不了', { definitive: true });
    const k = await P.generateDeviceKey();
    const clean = P.cleanLabel(label) || '设备';
    reset();
    cfg = { owner, repo, stateIssue: Number(issue), login, userId: userId ?? null, pairedAt: null, label: clean, macId: await P.deviceIdOf(m) };
    token = tok; privateKey = k.privateKey; pub = k.pub; deviceId = k.deviceId; macPub = m;
    // 私钥和公钥分开存
    await store.set('privateKey', k.privateKey);
    await store.set('publicKey', k.pub);
    await store.set('deviceId', k.deviceId);
    await store.set('macPub', m);
    await store.set('token', tok);
    await store.del('views'); await store.del('macChanged');
    await saveCfg();
    return { label: clean };
  }

  async function postEnroll(pair) {
    const { body } = await P.buildEnroll({ device: { id: deviceId, label: cfg.label, pub }, pair });
    const r = await api('POST', `${repoPath()}/issues/${cfg.stateIssue}/comments`, { body: { body } });
    pairing = {
      mode: pair ? 'link' : 'code', commentId: r.data?.id ?? null, postedAt: now(), goneAt: null, checkedAt: 0, state: 'waiting', error: null,
      code: pair ? null : await P.pairingCode(pub, macPub), tries: 0,
    };
    await savePairing();
  }

  async function checkPairing() {
    if (!cfg || cfg.pairedAt) return;
    if (!pairing || pairing.state !== 'waiting') return;
    const fail = async (error) => { pairing.state = 'failed'; pairing.error = error; await savePairing(); };
    // 配对码：看板的设备名单不够（终审 F1d）——钉住的 Mac 公钥是从看板自签名里取的，假看板也能把这台设备列进去。
    // 只认 Zoe 从 Mac 本机页面抄回来的 6 位数字（confirmCode）。这里只管过期
    if (pairing.mode === 'code') {
      if (now() - pairing.postedAt > CODE_TTL_MS + CONFIRM_GRACE_MS) await fail('配对码过期了：30 分钟内没有在 Mac 上输入。重新开始，会换一个新的码。');
      return;
    }
    // 链接配对：Mac 公钥来自 Mac 本机页面给的链接（可信的路），验过签的看板里出现了这台设备就算配好
    const devs = Array.isArray(view?.board?.devices) ? view.board.devices : [];
    const me = devs.find((d) => d && d.id === deviceId);
    if (me) {
      // 只认验过签的看板里的设备名单：别人贴的假看板写了这台设备也不算
      cfg.pairedAt = iso(now());
      if (typeof me.label === 'string' && me.label) cfg.label = P.cleanLabel(me.label) || cfg.label;
      pairing = null;
      await saveCfg(); await savePairing();
      return;
    }
    // 配对请求还在不在（Mac 处理完会删掉）
    if (pairing.commentId) {
      let present = true;
      try { await api('GET', `${repoPath()}/issues/comments/${pairing.commentId}`); } catch (e) {
        if (e.status === 404 || e.status === 410) present = false; else return;
      }
      if (present) { if (pairing.goneAt) { pairing.goneAt = null; await savePairing(); } return; }
    }
    if (!pairing.goneAt) { pairing.goneAt = now(); await savePairing(); return; }
    if (now() - pairing.goneAt > pairGraceMs) {
      await fail('没有配对成功：链接可能过期了（10 分钟）、已经用过，或者 Mac 上的 Concierge 重启过。在 Mac 上重新点「添加设备」。');
    }
  }

  // ---- outbox ----

  const due = (rec) => ['new', 'unknown'].includes(rec.state) && !inflight.has(rec.id) && (!rec.nextAt || now() >= rec.nextAt);

  // 这条动作绑着的卡片（answer / resume / consult）还是不是 Zoe 现在看到的那张：用正在显示的、验过签的任务视图算 cardFp，
  // 和她当时操作的那张（存在 payload.card 里）比（终审 F2）。不是就不重签：她是对着旧卡片做的决定，不能签到新卡片上
  async function sameCard(rec) {
    if (rec.kind !== 'cmd' || !TASK_KINDS.includes(rec.cmd)) return true;
    const tv = view?.tasks?.find((t) => t.ref === rec.ref) || vs.cache[`tv:${rec.ref}`]?.view;
    if (!tv || !verified.has(tv) || typeof rec.payload?.card !== 'string') return false;
    return (await P.cardFp(tv)) === rec.payload.card;
  }
  const cardChanged = (rec) => Object.assign(rec, { state: 'failed', cardMismatch: true, error: CARD_CHANGED, ackAt: now() });

  async function resign(rec) {
    const ts = iso(now());
    if (rec.kind === 'submit') {
      const s = await P.buildSubmission({ privateKey, device: deviceId, want: rec.want, extra: rec.extra, prefs: rec.prefs, chips: rec.chips, clientId: rec.id, ts, options: view?.board?.options || null });
      Object.assign(rec, { ts, body: s.body, title: s.title });
    } else {
      const c = await P.buildCommand({ privateKey, device: deviceId, kind: rec.cmd, payload: rec.payload, id: rec.id, ts });
      Object.assign(rec, { ts, body: c.body });
    }
  }

  // 结果不明的提交：在 GitHub 上按客户端编号找（提交前一分钟起，自己建的）
  async function findIssue(rec) {
    const since = iso((rec.firstAttemptAt || rec.at) - 60000);
    const r = await api('GET', `${repoPath()}/issues?state=all&creator=${encodeURIComponent(cfg.login)}&since=${encodeURIComponent(since)}&per_page=100&sort=created&direction=desc`);
    for (const it of Array.isArray(r.data) ? r.data : []) {
      if (it.pull_request) continue;
      const p = P.parseSubmission(it.body);
      if (p?.ok && p.envelope.id === rec.id && p.envelope.device === deviceId) return it.number;
    }
    return null;
  }

  async function send(rec) {
    if (inflight.has(rec.id)) return rec;
    inflight.add(rec.id);
    try {
      if (rec.state === 'unknown') {
        // 先查上次是不是其实已经送到了
        if (rec.kind === 'submit') {
          const n = await findIssue(rec);
          if (n) { Object.assign(rec, { state: 'sent', issueNumber: n, error: null, nextAt: null, sentAt: now(), waitFrom: now() }); await store.putItem(rec); return rec; }
        } else {
          // mine 来自最近一次读状态 Issue（refresh 里先读、再处理待发的）
          const acked = (view?.board?.acks || []).some((a) => a?.id === rec.id);
          if (mine.has(rec.id) || acked) { Object.assign(rec, { state: 'sent', commentId: mine.get(rec.id) || null, error: null, nextAt: null, sentAt: now(), waitFrom: now() }); await store.putItem(rec); return rec; }
        }
      }
      if (now() - Date.parse(rec.ts) > RESIGN_MS) {
        // 签名太旧要重签：卡片已经变了就不重签、不发（终审 F2，和“再发一次”同一条规矩）
        if (!(await sameCard(rec))) { cardChanged(rec); await store.putItem(rec); return rec; }
        await resign(rec);
      }
      rec.attempts = (rec.attempts || 0) + 1;
      rec.firstAttemptAt = rec.firstAttemptAt || now();
      rec.state = 'sending';
      await store.putItem(rec); // 先落本地，再发
      try {
        if (rec.kind === 'submit') {
          const r = await api('POST', `${repoPath()}/issues`, { body: { title: rec.title, body: rec.body } });
          Object.assign(rec, { state: 'sent', issueNumber: r.data?.number ?? null, error: null, nextAt: null, sentAt: now(), waitFrom: now() });
        } else {
          const r = await api('POST', `${repoPath()}/issues/${cfg.stateIssue}/comments`, { body: { body: rec.body } });
          Object.assign(rec, { state: 'sent', commentId: r.data?.id ?? null, error: null, nextAt: null, sentAt: now(), waitFrom: now() });
          if (r.data?.id) mine.set(rec.id, r.data.id);
        }
      } catch (e) {
        if (e.definitive) Object.assign(rec, { state: 'failed', error: e.message });
        else Object.assign(rec, { state: 'unknown', error: e.message, nextAt: now() + BACKOFF[Math.min(rec.attempts - 1, BACKOFF.length - 1)] });
      }
      await store.putItem(rec);
      return rec;
    } catch (e) {
      // 查询本身失败（网络）：保持“结果不明”，下一轮再查
      Object.assign(rec, { state: 'unknown', error: e.message, nextAt: now() + BACKOFF[Math.min((rec.attempts || 1) - 1, BACKOFF.length - 1)] });
      await store.putItem(rec);
      return rec;
    } finally { inflight.delete(rec.id); }
  }

  async function processOutbox() {
    const items = await store.items();
    const board = view?.board || null;
    const acks = Array.isArray(board?.acks) ? board.acks : [];
    const taskRefs = new Set([...(board?.tasks || []), ...(view?.tasks || []).map((t) => t.ref)]);
    const online = macOnline();
    for (const rec of items) {
      let dirty = false;
      if (rec.state === 'sending' && !inflight.has(rec.id)) { rec.state = 'unknown'; dirty = true; } // 上次发到一半页面关了
      if (rec.kind === 'submit' && rec.state === 'sent') {
        if (rec.issueNumber && taskRefs.has(`${cfg.repo}#${rec.issueNumber}`)) { await store.delItem(rec.id); continue; }
        const p = (board?.pending || []).find((x) => x && x.clientId === rec.id);
        const stage = p ? (p.stage || '已领取') : null;
        const perr = p?.error || null;
        if (stage !== (rec.stage || null) || perr !== (rec.claimError || null)) { rec.stage = stage; rec.claimError = perr; dirty = true; }
      }
      if (rec.kind === 'cmd') {
        const ack = acks.find((a) => a && a.id === rec.id);
        if (ack && !['done', 'failed'].includes(rec.state)) {
          Object.assign(rec, { state: ack.ok ? 'done' : 'failed', error: ack.ok ? null : String(ack.error || 'Mac 没有执行'), ackAt: now() });
          // 卡片对不上：整页重读一遍，让 Zoe 看着最新的再决定
          if (!ack.ok && ack.error === CARD_ACK) { rec.cardMismatch = true; needFull = true; }
          dirty = true;
        } else if (rec.state === 'sent') {
          // 没有回执就不算做了。Mac 不在线时一直等；在线之后还这么久没有回执：没送到（被删了、或者没被认），可以再发
          if (!online) { rec.waitFrom = now(); dirty = true; }
          else if (now() - (rec.waitFrom || rec.sentAt || rec.at) > ackTimeoutMs) {
            Object.assign(rec, { state: 'undelivered', error: null, undeliveredAt: now() }); dirty = true;
          }
        }
        const age = now() - (rec.ackAt || rec.undeliveredAt || rec.at);
        if (rec.state === 'done' && age > DONE_KEEP_MS) { await store.delItem(rec.id); continue; }
        if ((rec.state === 'failed' || rec.state === 'undelivered') && age > FAILED_KEEP_MS) { await store.delItem(rec.id); continue; }
      }
      if (dirty) await store.putItem(rec);
      if (due(rec)) await send(rec);
    }
  }

  // ---- 对外接口 ----

  async function refreshOnce() {
    if (!cfg) return { changed: false };
    // 整屏说明期间：不发任何东西，只隔一阵看看钉住的那把钥匙是不是又签出了新看板（recheck）；恢复了就接着往下照常读
    if (macChanged) { if (!(await recheck())) return { changed: false }; }
    try {
      const full = needFull || !vs.cursor;
      needFull = false;
      const r = await readState({ full });
      lastOk = now(); lastError = null;
      await checkPairing();
      if (cfg?.pairedAt) {
        await checkIssue();
        if (!macChanged) await processOutbox();
      }
      return { changed: r.changed };
    } catch (e) {
      lastError = e.message;
      if (e.status === 401) lastError = '令牌不对或已经过期。到设置里解除配对，再用新令牌配对';
      throw e;
    }
  }

  // kind 是 answer / resume / consult 时：t 必须是这台设备验过签、正在显示的那份任务视图，card 从它算
  // 整屏说明期间（钉住的 Mac 一直验不过 / 状态记录读不到）什么都不发：发出去也不知道是谁在收
  const MAC_UNSURE = '现在核对不了 Mac 的身份，这台设备先不发任何东西';
  async function command(kind, payload, meta = {}, t = null) {
    if (!cfg?.pairedAt) throw new GhError('这台设备还没配对好', { definitive: true });
    if (macChanged) throw new GhError(MAC_UNSURE, { definitive: true });
    let p = payload;
    if (TASK_KINDS.includes(kind)) {
      if (!t || !verified.has(t)) throw new GhError('页面上这张卡片还没有核对过 Mac 的签名，刷新后再试', { definitive: true });
      p = { ...payload, card: await P.cardFp(t) };
    }
    const { cmd, body } = await P.buildCommand({ privateKey, device: deviceId, kind, payload: p, ts: iso(now()) });
    const rec = { id: cmd.id, kind: 'cmd', cmd: kind, payload: p, ref: p.ref || null, fp: p.decisionFp || null, text: meta.text || null, ts: cmd.ts, body, state: 'new', attempts: 0, at: now() };
    await store.putItem(rec);
    return send(rec);
  }

  const actionState = (s) => (['new', 'sending', 'unknown'].includes(s) ? 'sending' : s === 'sent' ? 'waiting' : s);

  return {
    kind: 'remote',
    capabilities: { local: false, sensitiveApprove: false, devices: false, unpair: true, ping: true, quotaProbe: true, capsProbe: true },

    async init() {
      await load();
      return { state: cfg?.pairedAt ? 'paired' : cfg ? 'pairing' : 'unpaired' };
    },
    status() {
      const devs = view?.board?.devices;
      const revoked = !!(cfg?.pairedAt && Array.isArray(devs) && view?.board?.at && view.board.at > cfg.pairedAt && !devs.some((d) => d?.id === deviceId));
      return {
        paired: !!cfg?.pairedAt, pairing: pairing ? { ...pairing } : null, revoked,
        device: cfg ? { id: deviceId, label: cfg.label, pairedAt: cfg.pairedAt, macId: cfg.macId || null } : null,
        rejected: vs.rejected || 0, macChanged: macChanged ? { ...macChanged } : null,
        lastOk, lastError,
      };
    },

    refresh() {
      if (!refreshing) refreshing = refreshOnce().finally(() => { refreshing = null; });
      return refreshing;
    },
    // 配好之前什么都不给界面（终审 F1d：配对码配对要等 Zoe 把 Mac 上的 6 位数字敲回来）
    view: () => (cfg?.pairedAt ? view : null),

    // 链接 / 二维码配对。frag：decodePairFragment 的结果（m 是 Mac 公钥；令牌可能在里面，也可能要另外粘贴）
    // 已经配好的设备：换掉钉住的 Mac 公钥要 Zoe 在页面上明确点一下（replace:true，终审 F1e）；第一次配对一步到位
    // （Mac 本机页面给的链接就是可信的路）。状态记录上的标签不看（F1f）：跟着链接里的 i 走
    async pairByLink(frag, { label, token: pasted, replace = false } = {}) {
      if (cfg?.pairedAt && replace !== true) throw new GhError('这台设备已经配对过。要换成这次的配对吗？', { definitive: true, code: 'already-paired' });
      const tok = frag.t || pasted || (replace === true && cfg?.pairedAt ? token : null); // 换配对时链接里没带令牌：沿用现在的
      if (!tok) throw new GhError('需要令牌', { definitive: true });
      const u = await api('GET', '/user', { tok });
      if (!u.data?.login) throw new GhError('令牌读不到账号信息');
      await checkStateIssue(frag.o, frag.r, frag.i, tok, { label: false });
      await setupDevice({ owner: frag.o, repo: frag.r, issue: frag.i, tok, label, mac: frag.m, login: u.data.login, userId: u.data.id });
      await postEnroll({ pairId: frag.p, secret: frag.k });
      return this.status();
    },

    // 配对码：先用令牌找到仓库和状态记录（带 concierge-state 标签、开着的 Issue；只是线索，真假靠看板的签名）
    // only：Zoe 手动填的“所有者/仓库”（自动找不到时）。返回 [{ owner, repo, issues: [号…] }]
    async discover(tok, only = null) {
      const u = await api('GET', '/user', { tok });
      if (!u.data?.login) throw new GhError('令牌读不到账号信息');
      let candidates;
      if (only) candidates = [{ owner: { login: only.owner }, name: only.repo, private: true }];
      else {
        const repos = await api('GET', '/user/repos?per_page=100&sort=updated', { tok });
        candidates = (Array.isArray(repos.data) ? repos.data : []).filter((x) => x?.private === true && x.has_issues !== false).slice(0, 10);
      }
      const found = [];
      for (const r of candidates) {
        const owner = r.owner?.login; const name = r.name;
        if (!owner || !name) continue;
        try {
          const is = await api('GET', `${repoPath(owner, name)}/issues?labels=${STATE_LABEL}&state=open&per_page=10&sort=created&direction=asc`, { tok });
          const list = (Array.isArray(is.data) ? is.data : []).filter((x) => !x.pull_request).map((x) => x.number).filter(Number.isSafeInteger);
          if (list.length) found.push({ owner, repo: name, issues: list.slice(0, 5) });
        } catch { /* 这个仓库看不了，跳过 */ }
      }
      return found;
    },

    // 配对码：读看板的自签名，恰好一把 Mac 公钥才钉住它、生成密钥、留配对请求；不止一把就“配不上”，什么都不存
    async pairByCode({ owner, repo, issues, token: tok, label }) {
      const u = await api('GET', '/user', { tok });
      if (!u.data?.login) throw new GhError('令牌读不到账号信息');
      const cands = [];
      for (const issue of Array.isArray(issues) ? issues : [issues]) {
        try {
          await checkStateIssue(owner, repo, issue, tok);
          const macs = await P.selfSignedMacs(await allBodies(owner, repo, issue, tok));
          if (macs.length) cands.push({ issue, macs });
        } catch (e) { if (e.status === 401) throw e; }
      }
      if (!cands.length) throw new GhError('还没读到 Mac 签过名的看板：Mac 上的 Concierge 可能还没开远端通道，或者刚开、还没发布。过一会儿再试。', { definitive: true, code: 'none' });
      if (cands.length > 1 || cands[0].macs.length > 1) {
        throw new GhError('配不上：状态记录上有不止一份自称是 Mac 的看板，分不清哪一份是真的（可能有人在捣乱）。等几分钟再试（Mac 会把假的清掉），或者在 Mac 上用「添加设备」扫码配对。', { definitive: true, code: 'ambiguous' });
      }
      await setupDevice({ owner, repo, issue: cands[0].issue, tok, label, mac: cands[0].macs[0].pub, login: u.data.login, userId: u.data.id });
      await postEnroll(null);
      return this.status();
    },

    // 配对码的反方向确认（终审 F1d）：Zoe 在 Mac 上敲对了码，Mac 本机页面显示 6 位数字，她敲到这里。
    // 用这台设备的公钥和**钉住的** Mac 公钥算 pairingConfirm，对得上才算配好（之后才显示内容）。
    // 设备被骗钉住了假的 Mac 公钥时：真的 Mac 在码对不上时什么数字都不显示，别人也没法让真的 Mac 显示和假公钥对得上的数字。
    // 最多试 CONFIRM_TRIES 次，错满了这次配对作废（重新开始会换一把新钥匙）。
    async confirmCode(input) {
      if (!cfg || cfg.pairedAt || pairing?.mode !== 'code' || pairing.state !== 'waiting' || !pub || !macPub) {
        return { ok: false, error: '现在没有在等 6 位数字的配对。' };
      }
      const d = P.normalizePairingConfirm(String(input ?? ''));
      if (!d) return { ok: false, error: '要输入 Mac 上显示的 6 位数字。', left: CONFIRM_TRIES - (pairing.tries || 0) };
      if (P.safeEqual(d, await P.pairingConfirm(pub, macPub))) {
        cfg.pairedAt = iso(now());
        pairing = null; needFull = true;
        await saveCfg(); await savePairing();
        return { ok: true };
      }
      pairing.tries = (pairing.tries || 0) + 1;
      const left = CONFIRM_TRIES - pairing.tries;
      if (left <= 0) {
        pairing.state = 'failed';
        pairing.error = `6 位数字输错了 ${CONFIRM_TRIES} 次，这次配对作废了，这台设备没有配好。重新开始（会换一把新钥匙和一个新的码）。`;
      }
      await savePairing();
      return { ok: false, left: Math.max(0, left), error: left > 0 ? `数字不对，这台设备没有配好。核对 Mac 上显示的 6 位数字，还可以试 ${left} 次。` : pairing.error };
    },

    // 解除配对：清掉本地的令牌、密钥、钉住的 Mac 公钥、配置、待发的东西和缓存
    async unpair() { await store.clear(); reset(); },

    outbox() {
      return store.items().then((items) => items.filter((r) => r.kind === 'submit').sort((a, b) => a.at - b.at).map((r) => ({
        id: r.id, kind: 'submit', want: r.want, issueNumber: r.issueNumber || null, stage: r.stage || null, claimError: r.claimError || null,
        state: actionState(r.state), error: r.error || null, at: r.at,
      })));
    },
    actions() {
      return store.items().then((items) => items.filter((r) => r.kind === 'cmd').map((r) => ({
        id: r.id, kind: r.cmd, ref: r.ref, fp: r.fp || r.payload?.decisionFp || null, text: r.text, state: actionState(r.state),
        error: r.error || null, cardMismatch: !!r.cardMismatch, stale: r.state === 'failed' && r.error === STALE_ACK, at: r.at,
      })));
    },
    // 再试一次：提交照旧（同一个编号，先查再发）；没送到的动作重新签一条（新编号、新时间）。
    // 回答 / 让后台继续 / 请咨询（终审 F2）：只有现在显示的这份（验过签的）任务视图算出来的卡片，和 Zoe 当时操作的那张一样，才重签；
    // 不一样就不发，标成“卡片变了”（cardMismatch）——她要看着新的内容，用正常的按钮重新操作，这里不替她把旧的决定签到新卡片上
    async retry(id) {
      const r = await store.getItem(id);
      if (!r) return null;
      if (r.kind === 'cmd' && (r.state === 'undelivered' || r.state === 'failed')) {
        const payload = { ...r.payload };
        if (TASK_KINDS.includes(r.cmd)) {
          if (r.cardMismatch) return r;
          const tv = view?.tasks?.find((t) => t.ref === r.ref) || vs.cache[`tv:${r.ref}`]?.view;
          if (!tv || !verified.has(tv)) { Object.assign(r, { state: 'failed', error: '这个任务在页面上已经看不到了' }); await store.putItem(r); return r; }
          if (!(await sameCard(r))) { cardChanged(r); await store.putItem(r); return r; }
          delete payload.card;
          await store.delItem(id);
          return command(r.cmd, payload, { text: r.text }, tv); // command 从 tv 重算的 card 就是原来那张
        }
        await store.delItem(id);
        return command(r.cmd, payload, { text: r.text });
      }
      Object.assign(r, { state: 'unknown', nextAt: null, error: null });
      await store.putItem(r);
      return send(r);
    },
    async discard(id) { await store.delItem(id); },

    async submit({ want, extra = '', prefs = null, chips = [] }) {
      if (!cfg?.pairedAt) throw new GhError('这台设备还没配对好', { definitive: true });
      if (macChanged) throw new GhError(MAC_UNSURE, { definitive: true });
      const s = await P.buildSubmission({ privateKey, device: deviceId, want, extra, prefs, chips, ts: iso(now()), options: view?.board?.options || null });
      const rec = { id: s.clientId, kind: 'submit', want: s.envelope.payload.want, extra: s.envelope.payload.extra, prefs: s.envelope.payload.prefs, chips: s.envelope.payload.chips, ts: s.envelope.ts, title: s.title, body: s.body, state: 'new', attempts: 0, at: now() };
      await store.putItem(rec);
      const out = await send(rec);
      return { ok: out.state !== 'failed', id: rec.id, state: actionState(out.state), error: out.error || null };
    },
    async answer(t, { choice = '', text = '' }) {
      // 敏感操作只能在 Mac 上批：这里根本不发（Mac 那边也会拒）
      if (t.decision?.answerable !== 'any') return { kind: 'answer', ref: t.ref, state: 'failed', error: '敏感操作请回到 Mac 上批准' };
      return command('answer', { ref: t.ref, decisionFp: String(t.decision?.fp || ''), choice: String(choice), text: String(text) }, { text: choice || text }, t);
    },
    resume: (t) => command('resume', { ref: t.ref }, {}, t),
    // 取消这个任务：和继续一样带卡片指纹（对着她看到的那张卡片取消）
    cancel: (t, { text = '' } = {}) => command('cancel', { ref: t.ref, text: String(text || '') }, {}, t),
    consult: (t, { question = '', smallWork = false }) => command('consult', { ref: t.ref, question: String(question), smallWork: smallWork === true }, {}, t),
    chip: (action, text) => command('chip', { action, text: String(text) }, { text }),
    probeQuota: (pool) => command('quota', { pool }, { text: pool }),
    probeCaps: () => command('caps', {}),
    ping: () => command('ping', {}),
  };
}
