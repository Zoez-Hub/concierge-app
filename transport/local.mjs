// 本机取数方式：页面就在 Mac 的入口服务上（127.0.0.1），直接调 /api/*。
// 界面只通过和 transport/github.mjs 一样的接口用它，按 capabilities 决定哪些按钮可用。
// 地址都是相对的（'api/view'），页面放在哪个路径下都对。

export function makeLocalTransport({ fetch = globalThis.fetch.bind(globalThis), base = '', now = () => Date.now() } = {}) {
  let view = null;
  let viewKey = '';
  let lastOk = null;
  let lastError = null;
  const actions = new Map(); // id → { id, kind, ref, text, state:'sending'|'done'|'failed', error, at }
  const sent = new Map();    // 刚提交、还没出现在看板 pending 里的输入：id → { id, want, at }
  let seq = 0;

  async function call(method, path, body) {
    let r;
    try {
      r = await fetch(`${base}${path}`, {
        method, cache: 'no-store', credentials: 'same-origin',
        headers: body === undefined ? {} : { 'Content-Type': 'application/json', 'X-Concierge': '1' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch { throw new Error('连不上 Mac 上的 Concierge。它可能没在运行：在终端跑 concierge/start.sh'); }
    let j = null;
    try { j = await r.json(); } catch { j = null; }
    if (!r.ok) throw Object.assign(new Error(String(j?.error || `Concierge 出错了（${r.status}）`).slice(0, 300)), { status: r.status });
    return j;
  }

  async function act(kind, meta, fn) {
    const id = `a${++seq}`;
    const rec = { id, kind, ref: meta.ref || null, fp: meta.fp || null, text: meta.text || null, state: 'sending', error: null, at: now() };
    actions.set(id, rec);
    try {
      const out = await fn();
      rec.state = 'done'; rec.result = out;
      // 额度探测：请求本身成功，但这次没拿到数（入口照实说的原因）
      if (out && out.ok === false && out.error) { rec.state = 'failed'; rec.error = String(out.error).slice(0, 300); }
      return rec;
    } catch (e) {
      rec.state = 'failed'; rec.error = e.message; rec.status = Number(e.status) || 0;
      return rec;
    } finally {
      // 动作的结果在界面上留一会儿就够了
      for (const [k, a] of actions) if (now() - a.at > 10 * 60000) actions.delete(k);
    }
  }

  return {
    kind: 'local',
    capabilities: { local: true, sensitiveApprove: true, devices: true, unpair: false, ping: false, quotaProbe: true, capsProbe: true },

    async init() { return { state: 'paired' }; },
    status: () => ({ paired: true, lastOk, lastError }),

    // 拉一次产品视图。changed：和上一次不一样
    async refresh() {
      try {
        const v = await call('GET', 'api/view');
        lastOk = now(); lastError = null;
        const key = JSON.stringify(v);
        const changed = key !== viewKey;
        viewKey = key; view = v;
        const ids = new Set((v.board?.pending || []).map((p) => p.id));
        for (const [k, s] of sent) if (ids.has(k) || now() - s.at > 60000) sent.delete(k);
        return { changed };
      } catch (e) { lastError = e.message; throw e; }
    },
    view: () => view,

    // 还没出现在看板里的提交（本机通常一两秒内就出现）
    outbox: () => [...sent.values()].map((s) => ({ id: s.id, kind: 'submit', want: s.want, state: 'sent', at: s.at })),
    actions: () => [...actions.values()],

    async submit({ want, extra, prefs, chips, attachments = [] }) {
      const out = await call('POST', 'api/tasks', { want, extra, prefs, chips, ...(Array.isArray(attachments) && attachments.length ? { attachments } : {}) });
      if (out?.id) sent.set(out.id, { id: out.id, want, at: now() });
      return { ok: true, id: out?.id || null };
    },
    // card:'deferred'：答的是提前申请的那张卡（t.deferredDecision，hub#165 §15.3），decisionFp 写它的指纹
    // viewFp：页面拿到的那张卡的呈现指纹（终审 P1-D）：入口按这一刻的投影重算，对不上（旧页面看到的是截短的或别的呈现）就不记肯定回答
    answer: (t, { choice, text, card = null }) => {
      const d = card === 'deferred' ? t.deferredDecision : t.decision;
      const fp = d?.fp;
      return act('answer', { ref: t.ref, fp, text: choice || text }, () => call('POST', 'api/answer', { ref: t.ref, choice, text, decisionFp: fp, ...(d?.viewFp ? { viewFp: d.viewFp } : {}) }));
    },
    // reopen：已经结束的任务「重新开一轮」（hub#165）
    resume: (t, { reopen = false } = {}) => act('resume', { ref: t.ref }, () => call('POST', 'api/resume', { ref: t.ref, ...(reopen ? { reopen: true } : {}) })),
    // ---- hub#165 ----
    // 旧卡让工程接手（撤回 Concierge 自己提的那张卡，任务暂停、工程待接手）
    reclassify: (t) => act('reclassify', { ref: t.ref }, () => call('POST', 'api/reclassify', { ref: t.ref })),
    // 撤销这个任务提交时给的预授权（hub#165 §15.3）：之后还没执行的预授权动作回到普通审批
    preauthRevoke: (t) => act('preauth-revoke', { ref: t.ref, text: '撤销预授权' }, () => call('POST', 'api/preauth/revoke', { ref: t.ref })),
    // 补充要求：一句话 + 已经传上来的附件编号（attach 返回的 id）
    amend: (t, { text = '', attachments = [] } = {}) => act('amend', { ref: t.ref, text }, () => call('POST', 'api/amend', { ref: t.ref, text: String(text || ''), attachments: Array.isArray(attachments) ? attachments : [] })),
    // 验收：ok true 通过 / false 不通过（text 写哪里不对；不通过 = 同一个任务重新开一轮）
    accept: (t, { ok, text = '' } = {}) => act('accept', { ref: t.ref, text: ok ? '通过' : '不通过' }, () => call('POST', 'api/accept', { ref: t.ref, ok: ok === true, text: String(text || '') })),
    // 上传一个附件（data 是 base64）。成功返回 { ok:true, id, name, kind, bytes }；失败不抛，返回 { ok:false, error }
    async attach({ name, type, data }) {
      try { const r = await call('POST', 'api/attach', { name, type, data }); return { ok: true, ...r }; } catch (e) { return { ok: false, error: e.message }; }
    },
    // 取消这个任务（不算完成）。text：她补的一句原因（可以空）
    cancel: (t, { text = '' } = {}) => act('cancel', { ref: t.ref }, () => call('POST', 'api/cancel', { ref: t.ref, text: String(text || '') })),
    consult: (t, { question, smallWork }) => act('consult', { ref: t.ref }, () => call('POST', 'api/consult', { ref: t.ref, question, smallWork: smallWork === true })),
    chip: (action, text) => act('chip', { text }, () => call('POST', 'api/chips', { action, text })),
    probeQuota: (pool) => act('quota', { text: pool }, () => call('POST', 'api/quota/probe', { pool })),
    probeCaps: () => act('caps', {}, () => call('POST', 'api/capabilities/probe', {})),

    // ---- 只有本机有的：设备管理（docs/REMOTE.md §3、§6）----
    // GET api/devices → { devices, ghRevokes, remote:{enabled, appUrl, stateIssue, statePinnedAt, stateReplaced, lastPublishAt, lastError, githubApp}, mac:{id} }
    devices: () => call('GET', 'api/devices'),
    // 「添加设备」：{ pairId, secret, expiresAt, label, owner, repo, stateIssue, appUrl, mac:{id, pub} }
    // 启用了 GitHub App（hub#165 §15.1 A′）时多一项 github:{ authUrl }：页面打开它让 Zoe 在 GitHub 授权一次（已授权过的 GitHub 会直接跳回），
    // 再用 pairToken 轮询拿到这台设备的令牌放进链接的 t；没启用时没有这一项，和以前一样
    startPair: (label) => call('POST', 'api/pair/start', { label }),
    // { state:'waiting'|'ready'|'expired'|'none', t? }：ready 时 t 是这台新设备的 GitHub 令牌（只放进配对链接，不存）
    pairToken: (pairId) => call('POST', 'api/pair/token', { pairId }),
    // 一键创建 GitHub App（#172）：{ url }——本机的创建页（一次性，60 分钟），页面跳过去
    ghAppStart: () => call('POST', 'api/gh/app/start', {}),
    // 敲设备上显示的配对码。成功 { ok:true, id, label, already, confirm? }；失败不抛，返回 { ok:false, status, error }（界面按状态码说人话）。
    // 总是要旧的 6 位回显（?legacyConfirm=1，hub#165 §15.1）：Mac 不知道那台设备的页面有没有内置 Mac 公钥——内置了的设备自己显示「已连接」，
    // 没内置的（本地源码 / 没发布过的页面）还在等这 6 位。页面把它折起来，设备上要了才去看
    async pairCode(code, role = null) {
      try { return await call('POST', 'api/devices?legacyConfirm=1', { action: 'pair-code', code: String(code ?? ''), ...(role ? { role } : {}) }); } catch (e) { return { ok: false, status: e.status || 0, error: e.message }; }
    },
    removeDevice: (id) => call('POST', 'api/devices', { action: 'revoke', id }),
    // GitHub App 令牌撤销待办（第十轮复核 F）：「再试一次」/「知道了」
    ghRevokeRetry: (key) => call('POST', 'api/devices', { action: 'gh-revoke-retry', key }),
    ghRevokeDismiss: (key) => call('POST', 'api/devices', { action: 'gh-revoke-dismiss', key }),
    // 手机批准（hub#152）：关掉。开启（hub#165 §15.2）：设备申请之后 Mac 上一键「允许」/「拒绝」，不再敲核对码
    // 带上页面看到的那一次申请（GET /api/devices 那一行的 requestId / credFp）：申请变了入口回 409（终审 P1-C）
    allowPasskey: (id, { requestId = null, credFp = null } = {}) => call('POST', 'api/devices', { action: 'passkey-allow', id, requestId, credFp }),
    denyPasskey: (id) => call('POST', 'api/devices', { action: 'passkey-deny', id }),
    // 旧的：敲核对码开启（保留一轮兼容，Mac 不再核对码，等于「允许」）
    confirmPasskey: (id, code) => call('POST', 'api/devices', { action: 'passkey-confirm', id, code }),
    revokePasskey: (id) => call('POST', 'api/devices', { action: 'passkey-revoke', id }),
  };
}

// 页面是不是在 Mac 本机的入口服务上：主机是 127.0.0.1 / localhost，而且 /api/health 答话
export async function detectLocal({ location = globalThis.location, fetch = globalThis.fetch.bind(globalThis) } = {}) {
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(location.hostname)) return false;
  try {
    const r = await fetch('api/health', { cache: 'no-store' });
    if (!r.ok) return false;
    const j = await r.json();
    return j?.ok === true;
  } catch { return false; }
}
