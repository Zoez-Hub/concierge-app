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
      rec.state = 'failed'; rec.error = e.message;
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

    async submit({ want, extra, prefs, chips }) {
      const out = await call('POST', 'api/tasks', { want, extra, prefs, chips });
      if (out?.id) sent.set(out.id, { id: out.id, want, at: now() });
      return { ok: true, id: out?.id || null };
    },
    answer: (t, { choice, text }) => act('answer', { ref: t.ref, fp: t.decision?.fp, text: choice || text }, () => call('POST', 'api/answer', { ref: t.ref, choice, text, decisionFp: t.decision?.fp })),
    resume: (t) => act('resume', { ref: t.ref }, () => call('POST', 'api/resume', { ref: t.ref })),
    // 取消这个任务（不算完成）。text：她补的一句原因（可以空）
    cancel: (t, { text = '' } = {}) => act('cancel', { ref: t.ref }, () => call('POST', 'api/cancel', { ref: t.ref, text: String(text || '') })),
    consult: (t, { question, smallWork }) => act('consult', { ref: t.ref }, () => call('POST', 'api/consult', { ref: t.ref, question, smallWork: smallWork === true })),
    chip: (action, text) => act('chip', { text }, () => call('POST', 'api/chips', { action, text })),
    probeQuota: (pool) => act('quota', { text: pool }, () => call('POST', 'api/quota/probe', { pool })),
    probeCaps: () => act('caps', {}, () => call('POST', 'api/capabilities/probe', {})),

    // ---- 只有本机有的：设备管理（docs/REMOTE.md §3、§6）----
    // GET api/devices → { devices, remote:{enabled, appUrl, stateIssue, statePinnedAt, stateReplaced, lastPublishAt, lastError}, mac:{id} }
    devices: () => call('GET', 'api/devices'),
    // 「添加设备」：{ pairId, secret, expiresAt, label, owner, repo, stateIssue, appUrl, mac:{id, pub} }
    startPair: (label) => call('POST', 'api/pair/start', { label }),
    // 敲设备上显示的配对码。成功 { ok:true, id, label, already }；失败不抛，返回 { ok:false, status, error }（界面按状态码说人话）
    async pairCode(code) {
      try { return await call('POST', 'api/devices', { action: 'pair-code', code: String(code ?? '') }); } catch (e) { return { ok: false, status: e.status || 0, error: e.message }; }
    },
    removeDevice: (id) => call('POST', 'api/devices', { action: 'revoke', id }),
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
