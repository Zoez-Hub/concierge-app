// 产品页面的文字和分组：纯函数，不碰 DOM（Node 里也能测）。
// 输入只有产品视图（docs/VIEW.md）。拿不到的写「不可观测」或「没有」，不编；计划和实际不一样时两个都写。

export const ONLINE_MS = 15 * 60000;      // 看板 10 分钟一次心跳；超过 15 分钟没消息算 Mac 不在线
export const STALE_QUOTA_MS = 3600000;    // 额度观测超过 1 小时：灰色、标「可能已过期」
export const DONE_SHOWN = 5;

const pad = (n) => String(n).padStart(2, '0');
const date = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Date(t) : null; };

export function clock(iso) { const d = date(iso); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : ''; }
export function day(iso) { const d = date(iso); return d ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : ''; }
export function dayTime(iso) { const d = date(iso); return d ? `${day(iso)} ${clock(iso)}` : ''; }
// 今天的只写钟点，别的天带日期
export function when(iso, now = Date.now()) {
  const d = date(iso);
  if (!d) return '';
  const n = new Date(now);
  return d.toDateString() === n.toDateString() ? clock(iso) : dayTime(iso);
}

export function duration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return null;
  const m = Math.round(ms / 60000);
  if (m < 1) return '不到 1 分钟';
  if (m < 60) return `${m} 分钟`;
  const hh = Math.floor(m / 60); const mm = m % 60;
  if (hh < 48) return mm ? `${hh} 小时 ${mm} 分钟` : `${hh} 小时`;
  return `${Math.round(hh / 24)} 天`;
}
export const since = (iso, now = Date.now()) => { const t = Date.parse(iso); return Number.isFinite(t) ? duration(now - t) : null; };

// 模型的显示名：可选项里有就用它的名字（去掉“Claude ”前缀）；日志里的实际模型 id 尽量读成人话；都不认识就原样
export function modelLabel(id, options) {
  if (!id) return null;
  const s = String(id);
  const m = (options?.models || []).find((x) => x.id === s);
  if (m?.name) return String(m.name).replace(/^Claude\s+/, '');
  const c = s.match(/^claude-([a-z]+)-(\d+)-(\d+)(?:-\d{8})?$/);
  if (c) return `${c[1][0].toUpperCase()}${c[1].slice(1)} ${c[2]}.${c[3]}`;
  return s;
}

export function macStatus(board, { local = false, lastOk = null, now = Date.now() } = {}) {
  if (local) {
    return lastOk ? { online: true, text: `Mac 在线 ${clock(new Date(lastOk).toISOString())}` } : { online: false, text: '连不上 Mac 上的 Concierge' };
  }
  const seen = Date.parse(board?.mac?.seenAt);
  if (!Number.isFinite(seen)) return { online: false, text: '还没有 Mac 的消息', seenAt: null };
  const online = now - seen <= ONLINE_MS;
  return { online, seenAt: board.mac.seenAt, text: online ? `Mac 在线 ${when(board.mac.seenAt, now)}` : `Mac 最近在线 ${when(board.mac.seenAt, now)}` };
}

// ---- 任务分组 ----

export const ACTIVE = ['working', 'queued', 'handed_off', 'stalled'];

export function orderTasks(board, tasks) {
  const by = new Map((tasks || []).map((t) => [t.ref, t]));
  const out = [];
  for (const ref of board?.tasks || []) if (by.has(ref)) { out.push(by.get(ref)); by.delete(ref); }
  // 看板没列到的（刚发布、看板还没跟上）排在后面，按更新时间
  return out.concat([...by.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
}

export function groupTasks(list) {
  const needs = []; const active = []; const done = [];
  for (const t of list) {
    if (t.state === 'needs_zoe') needs.push(t);
    else if (t.state === 'done') done.push(t);
    else active.push(t);
  }
  return { needs, active, done };
}

const isAsyncWait = (t) => t.state === 'queued' && t.plan?.consult?.async && t.actions?.includes('resume');
// 最后一份施工单（小动工，docs/VIEW.md「小动工和 GPT Web 协调者」）
export const lastSmallWork = (t) => (Array.isArray(t?.smallWork) && t.smallWork.length ? t.smallWork[t.smallWork.length - 1] : null);
const lunaWorking = (t) => t.state === 'working' && (/Luna/.test(t.now?.who || '') || lastSmallWork(t)?.state === 'running');

// 列表里一条的第二行
export function listLine(t, options, now = Date.now()) {
  const nw = t.now || {};
  const sw = lastSmallWork(t);
  switch (t.state) {
    case 'working': {
      if (lunaWorking(t)) return ['正在小动工', 'Luna', nw.model || sw?.model, nw.effort || sw?.effort, nw.machine, since(nw.since, now)].filter(Boolean).join(' · ');
      const parts = ['正在处理', modelLabel(nw.model, options), nw.effort, nw.machine, since(nw.since, now)];
      return parts.filter(Boolean).join(' · ');
    }
    case 'needs_zoe':
      return t.decision?.kind === 'sensitive' ? '等你批准 · 敏感操作，只能在 Mac 上批' : '等你决定 · 选一个方案';
    case 'done': {
      if (t.result?.missing) return '结束了 · 没有留下结果说明';
      const main = (t.provenance?.main || [])[0];
      // 只做了小动工（主执行还没跑过）：改动等她看
      if (!main && sw?.state === 'ok') return ['小动工做完了 · 改动等你看', duration(sw.durationMs)].filter(Boolean).join(' · ');
      return ['完成', modelLabel(main?.model, options), duration(t.bill?.durationMs)].filter(Boolean).join(' · ');
    }
    case 'stalled':
      if (sw && /^小动工/.test(t.stateText || '')) {
        return sw.state === 'failed' ? '没人在做 · 小动工没做成' : sw.state === 'refused' ? '没人在做 · 小动工没有执行' : '没人在做 · 小动工中断了';
      }
      return /中断/.test(t.stateText || '') ? '没人在做 · 上次会话结果不明'
        : /坏了/.test(t.stateText || '') ? '没人在做 · 这台 Mac 上的记录坏了'
          : /工程窗口/.test(t.stateText || '') ? '没人在做 · 最后是工程窗口在做' : '没人在做';
    case 'handed_off':
      if (nw.machine === 'Windows' || /Windows/.test(t.stateText || '')) return `交给 Windows 了 · ${/等那边接手/.test(t.stateText || '') ? '等那边接手' : '那边在做'}`;
      if (/没有这个任务的登记/.test(t.stateText || '')) return '交出去了 · 这台 Mac 上没有登记';
      return '交出去了 · 有人值守的工程窗口';
    case 'queued':
      if (/施工单到了/.test(t.stateText || '')) return '排队 · 施工单到了，马上交给 Luna';
      if (/交施工单/.test(t.stateText || '')) return '排队 · 在等 GPT Web 协调者交施工单';
      if (isAsyncWait(t)) return '排队 · 在等 GPT Web 协调者的意见';
      if (/Mac 上点/.test(t.stateText || '')) return '排队 · 等你在 Mac 上点“让后台继续”';
      return '排队 · 后台正在安排';
    default: return t.stateText || '';
  }
}

// 「交给它」之后输入框下面那句提示（UI.md §2）什么时候收起，不让它一直挂着：
//   这一条出现在任务列表里了：提交之后才出现的任务、原话对得上（视图里的原话可能被截短，结尾是“…”）；
//   设备上：待发记录见过、现在没了（任务出现在验过签的看板里时才会拿掉它，或者她自己删了）；
//   “Mac 现在不在线”那句：另外在 Mac 领取了（看板的待处理里有它）或者 Mac 又在线时就收起。
// hint：{ id, kind: 'sent' | 'offline' | 'sending', want, before: [提交时列表里已有的任务号], seen }。
// 返回 null = 收起；否则返回（可能更新了 seen 的）hint。不碰 DOM
export function submitHint(hint, { tasks = [], pending = [], outbox = [], online = false, local = false } = {}) {
  if (!hint) return null;
  const want = String(hint.want || '');
  const before = new Set(hint.before || []);
  const same = (a) => { const s = String(a || ''); return s === want || (s.length > 1 && s.endsWith('…') && want.startsWith(s.slice(0, -1))); };
  if (want && (tasks || []).some((t) => t && !before.has(t.ref) && same(t.want))) return null;
  const ob = (outbox || []).find((o) => o && o.id === hint.id) || null;
  if (!local && hint.seen && !ob) return null;
  if (hint.kind === 'offline') {
    const claimed = !!ob?.stage || (pending || []).some((p) => p && (p.clientId === hint.id || p.id === hint.id));
    if (claimed || online) return null;
  }
  return ob && !hint.seen ? { ...hint, seen: true } : hint;
}

// 来源这一段的人话（不带时间）。签名提交之后文字被改过的：如实写，不当成验过签的设备提交
export function sourceText(s0) {
  const s = s0 || {};
  if (s.via === 'github-form') return 'GitHub 表单（没有设备签名）';
  if (s.via === 'legacy' || !s.via) return '来源没有记录';
  const dev = s.via === 'mac-page' ? (s.device || 'Mac') : (s.device || '已配对设备');
  const note = s.editedAfterSign === true ? '文字在签名提交之后被改过' : s.verified === false ? '没有验过' : null;
  return [`${s.who || 'Zoe'} · ${dev}`, note].filter(Boolean).join(' · ');
}

export function sourceLine(t) {
  const s = t.source || {};
  const at = dayTime(t.createdAt);
  if (s.via === 'legacy' || !s.via) return ['来源没有记录', at].filter(Boolean).join(' · ');
  return [sourceText(s), at].filter(Boolean).join(' · ');
}

// ---- 谁做了什么（任务页第 3 段）----

const EXECUTOR = { claude: 'Claude', codex: 'Codex', luna: 'Luna' };
// 施工单 / 小动工的状态（provenance.smallWork 的 state 和 taskView.smallWork 的 state）
const SW_STATE = { recorded: '已收下', running: '正在做', ok: '做完了', failed: '没做成', unknown: '中断了', refused: '没有执行', exited: '已结束' };
const executorName = (x) => (x === 'claude' ? 'Claude（旧记录）' : EXECUTOR[x] || x || '后台');

export function provenanceRows(t, options) {
  const p = t.provenance || {};
  const plan = t.plan || null;
  const rows = [];
  const s = t.source || {};
  rows.push(['来源', s.via === 'legacy' || !s.via ? '没有记录' : sourceText(s)]);

  const main = p.main || [];
  if (!main.length) {
    rows.push(['主执行', plan?.modelName ? `还没开始（计划：${String(plan.modelName).replace(/^Claude\s+/, '')}${plan.effort ? ` · ${plan.effort}` : ''}）` : '还没开始']);
  } else {
    for (const m of main) {
      const model = modelLabel(m.model, options) || '模型没有记录';
      const effort = m.effort || '默认档位';
      // 同一个配置一行；其中有结果不明的（Mac 上的 Concierge 重启过）在这一行里说明，不另起一行
      const parts = [`${EXECUTOR[m.executor] || m.executor || '后台'} ${model}`, effort, m.machine, `${m.sessions || 0} 次会话${m.unknown ? `，其中 ${m.unknown} 次结果不明` : ''}`].filter(Boolean);
      let line = parts.join(' · ');
      if (m.modelFrom === '要求') line += '（模型是要求的，日志里没核对到）';
      if (m.modelCheck === 'mismatch' && plan?.model) line += `（要的是 ${modelLabel(plan.model, options)}，实际是 ${model}）`;
      if (m.effort && m.effortEvidence) line += `（effort：${m.effortEvidence}）`;
      rows.push(['主执行', line]);
    }
  }

  const subs = p.subagents || [];
  const used = subs.reduce((a, x) => a + (Number(x.n) || 0), 0);
  let sub = used ? `${used} 个（${subs.map((x) => `${x.type}${x.model ? ` · ${modelLabel(x.model, options)}` : ''}${x.n > 1 ? ` × ${x.n}` : ''}`).join('，')}）` : '没有';
  if (plan && Number.isInteger(plan.maxSubagents)) {
    if (plan.maxSubagents === 0) sub = used ? `计划不开（硬限制），实际 ${used} 个` : '没有（不开，硬限制）';
    else if (used > plan.maxSubagents) sub = `计划最多 ${plan.maxSubagents} 个，实际 ${used} 个`;
  }
  rows.push(['子代理', sub]);

  const cs = p.consults || [];
  if (cs.length) {
    for (const c of cs) {
      const bits = [`${c.label || c.target} × ${c.n || 0}`];
      if (c.failed) bits.push(`其中 ${c.failed} 次失败`);
      if (c.selfReported) bits.push(c.model ? `模型自报：${c.model}` : '模型没有自报');
      else if (c.checked) bits.push(`实际 ${c.model || '?'}${c.effort ? ` · ${c.effort}` : ''}（已从会话记录核对）`);
      else if (c.model) bits.push(`${c.model}${c.effort ? ` · ${c.effort}` : ''}（没核对到）`);
      rows.push(['咨询', bits.join(' · ')]);
    }
  } else if (plan?.consult) rows.push(['咨询', `还没有（计划：${plan.consult.label}${plan.consult.async ? '' : ` 最多 ${plan.consult.max} 次`}）`]);
  else rows.push(['咨询', '没有']);
  const co = p.coordinator || null;
  if (co && (co.opinions || co.orders)) {
    const bits = [co.opinions ? `写过 ${co.opinions} 次意见` : null, co.orders ? `交过 ${co.orders} 份施工单` : null].filter(Boolean).join('、');
    const self = Array.isArray(co.selfReported) && co.selfReported.length ? `（模型自报：${co.selfReported.join('、')}，自报）` : '（模型没有自报）';
    rows.push(['协调者', `GPT Web 协调者${bits}${self}`]);
  } else if (p.gptWeb && !cs.some((c) => c.target === 'gptweb')) rows.push(['协调者', 'GPT Web 协调者参与过']);

  const sw = p.smallWork || [];
  rows.push(['小动工', sw.length ? sw.map((x) => [`${executorName(x.executor)} × ${x.n}`, x.model ? modelLabel(x.model, options) : '模型没有记录', x.effort, x.state ? SW_STATE[x.state] || x.state : null].filter(Boolean).join(' · ')).join('，') : plan?.smallWork ? '允许，还没有' : plan?.smallWorkLegacy ? '旧版本开的，现在不算数（要用的话重新开一次）' : '没有']);
  // 每份施工单一行：谁做的、实际模型和 effort、改了多少、检查过没有
  for (const o of Array.isArray(t.smallWork) ? t.smallWork : []) rows.push([`施工单 ${o.k}`, smallWorkLine(o)]);
  return rows;
}

// 一份施工单（taskView.smallWork 的一项）给人看的一行。title 是 GPT Web 协调者写的，原样显示
// 还在做（running）的时候实际模型、改了多少都还没有：只写状态和要的档位，不写“没有记录”“没通过”。
// 检查（docs/VIEW.md）：ok 是 null = 还没跑——刚收下 / 在做时写“还没跑”，结束了也没跑到时写“没有跑”；
// ok 是 true / false 的只在做完 / 没做成时写“通过 / 没通过”。没有名字的（旧版 Mac 发的 {ok:false}）不写。
const SW_PENDING = ['recorded', 'running'];
export function smallWorkLine(o) {
  const finished = ['ok', 'failed', 'unknown'].includes(o.state);
  const files = Number.isFinite(o.files) ? `改了 ${o.files} 个文件${Number.isFinite(o.lines) ? `（增删 ${o.lines} 行）` : ''}` : null;
  const named = o.check && typeof o.check.name === 'string' && o.check.name;
  const check = named && o.check.ok === null ? `检查「${o.check.name}」${SW_PENDING.includes(o.state) ? '还没跑' : '没有跑'}`
    : (o.state === 'ok' || o.state === 'failed') && named ? `检查「${o.check.name}」${o.check.ok === true ? '通过' : '没通过'}`
      : (o.state === 'ok' && !o.check ? '没有指定检查' : null);
  return [
    o.title ? `「${o.title}」` : null,
    o.stateText || SW_STATE[o.state] || o.state,
    finished ? ['Luna', o.model || '实际模型没有记录', o.effort].filter(Boolean).join(' · ') : null,
    o.state === 'running' && o.effort ? `effort ${o.effort}` : null,
    finished ? files : null, check,
  ].filter(Boolean).join(' · ');
}

// ---- 本次执行资源（任务页第 4 段）----

export function billRows(t) {
  const b = t.bill;
  if (!b) return null;
  const rows = [];
  const counts = {};
  for (const k of Array.isArray(b.triggers) ? b.triggers : []) counts[k] = (counts[k] || 0) + 1;
  const why = Object.entries(counts).map(([k, v]) => `${TRIGGER[k] || '其他'}${v > 1 ? ` ${v} 次` : ''}`).join('，');
  const mainRan = Number(b.sessions) > 0;
  rows.push(['主会话', mainRan ? `${b.sessions} 次${why ? `（起因：${why}）` : ''}` : '还没有（到现在只做了小动工）']);
  const p = t.provenance || {};
  const subs = (p.subagents || []).reduce((a, x) => a + (Number(x.n) || 0), 0);
  rows.push(['子代理', subs ? `${subs} 个` : '没有']);
  const cs = (p.consults || []).reduce((a, x) => a + (Number(x.n) || 0), 0);
  rows.push(['咨询', cs ? `${cs} 次` : '没有']);
  rows.push(['GPT Web 协调者', p.gptWeb ? '参与了' : '没有参与']);
  const luna = (p.smallWork || []).filter((x) => x.executor === 'luna').reduce((a, x) => a + (Number(x.n) || 0), 0);
  rows.push(['Luna', luna ? `参与了 ${luna} 次` : '没有参与']);
  if (mainRan) {
    rows.push(['重试和恢复', b.retries || b.recoveries ? `重试 ${b.retries || 0} 次，恢复 ${b.recoveries || 0} 次` : '没有']);
    if (b.unknown) rows.push(['结果不明', `${b.unknown} 次会话结果不明`]);
    rows.push(['总时长', duration(b.durationMs) || '不可观测']);
    rows.push(['token', b.tokens ? `输入 ${fmtInt(b.tokens.in)}，输出 ${fmtInt(b.tokens.out)}` : '不可观测']);
    rows.push(['五小时窗口', b.fiveHour && b.fiveHour.start !== null && b.fiveHour.start !== undefined ? `开始 ${b.fiveHour.start}%，结束 ${b.fiveHour.end}%（已用，实际观测）` : '不可观测']);
    rows.push(['等价金额', Number.isFinite(b.costUsdEquivalent) ? `约 $${b.costUsdEquivalent.toFixed(2)}（按 API 标价折算，不是实际账单费用）` : '不可观测']);
  }
  // 小动工每份一行：实际模型、effort、token、用时、GPT 五小时窗口前后（都来自那一次的 Codex 会话记录）
  for (const l of Array.isArray(b.luna) ? b.luna : []) rows.push([`Luna 第 ${l.k} 份`, lunaBillLine(l)]);
  return rows;
}

export function lunaBillLine(l) {
  const win = l.fiveHour && Number.isFinite(l.fiveHour.start) && Number.isFinite(l.fiveHour.end)
    ? `GPT 五小时窗口 ${l.fiveHour.start}% → ${l.fiveHour.end}%（已用，实际观测，整个账号）` : 'GPT 五小时窗口不可观测';
  return [
    l.model || '实际模型不可观测', l.effort || null,
    l.tokens ? `token 输入 ${fmtInt(l.tokens.in)}，输出 ${fmtInt(l.tokens.out)}` : 'token 不可观测',
    duration(l.durationMs) ? `用时 ${duration(l.durationMs)}` : '用时不可观测', win,
  ].filter(Boolean).join(' · ');
}

// ---- GPT Web 协调者和小动工的说明（执行偏好 → 咨询；任务页的“请 GPT Web 协调者看一眼”）----

// 协调者那一项（board.options.consult 里 async 的）能观测到的连接事实。connected=false 时这一项不能选
export function coordinatorStatus(o, now = Date.now()) {
  if (!o) return { connected: false, text: '还没接通' };
  if (o.lastCallAt && Number.isFinite(Date.parse(o.lastCallAt))) {
    return { connected: true, text: `已接通 · 上次调用 ${when(o.lastCallAt, now)}${o.tunnelRunning === false ? '（隧道现在没在跑）' : ''}` };
  }
  if (o.tunnelRunning === true) return { connected: true, text: '隧道在跑，还没被调用过' };
  return { connected: false, text: '还没接通' };
}

// 「允许小动工」的说明：能开时说清楚谁做、在哪做、做完是什么；不能开时用 Mac 给的原因
export function smallWorkNote(sw) {
  if (!sw || sw.available !== true) return { available: false, text: (sw && sw.note) || '暂时不能开。' };
  return {
    available: true,
    text: `只对这一个任务有效。GPT Web 协调者可以交一份小改动的施工单，由 Mac 上的 Luna（${sw.model || 'gpt-5.6-luna'}）在一个受限的工作目录里做，只能改施工单里写明的文件。做完是一份等你看的改动草稿：不合并，不碰生产。`,
  };
}

// 在 Mac 上敲配对码之后的一句话（POST /api/devices {action:'pair-code'} 的结果）。
// 敲对了：Mac 给 confirm（6 位数字，终审 F1d），页面请她在设备上输入它——设备输对了才算配好
export function pairCodeMessage(r) {
  if (r && r.ok) {
    const digits = /^[0-9]{6}$/.test(String(r.confirm || '')) ? `${r.confirm.slice(0, 3)} ${r.confirm.slice(3)}` : null;
    return {
      ok: true, confirm: digits,
      text: `${r.already ? `「${r.label}」早就在 Mac 上登记过了。` : `已在 Mac 上登记：${r.label}。`}${digits ? '在设备上输入下面这 6 位数字，设备上输对了才算配好。' : ''}`,
    };
  }
  const s = r?.status;
  if (s === 400) return { ok: false, text: '配对码的格式不对：设备上显示的是 12 位，像 ABCD-EFGH-JKMN。' };
  if (s === 404) return { ok: false, text: '没找到这个配对码。核对一下设备上显示的码；码在设备上出现后 30 分钟内有效。' };
  if (s === 429) return { ok: false, text: '试得太多了，等一分钟再试。' };
  if (s === 409) {
    return { ok: false, text: /不止一台/.test(String(r?.error || ''))
      ? '有不止一台设备对得上这个码，为了安全这次没有配对。在你的设备上重新开始配对。'
      : '远端通道现在还没准备好（刚启动，或者读 GitHub 出错了）。等一会儿再试。' };
  }
  return { ok: false, text: s ? '没配上：Mac 上的 Concierge 出错了（详情在 Mac 的日志里）。' : '没配上：连不上 Mac 上的 Concierge。' };
}
// 「添加设备」没生成出链接（POST /api/pair/start 的错误）：Mac 回的原话是给工程看的，按状态码说人话；页面自己的原因（没有状态码）照原样
export function startPairMessage(e) {
  const s = e?.status;
  if (!s) return String(e?.message || '没生成出来。');
  if (s === 409) return '远端通道现在还没准备好（刚启动，或者读 GitHub 出错了）。等一会儿再试。';
  return '没生成出来：Mac 上的 Concierge 出错了（详情在 Mac 的日志里）。';
}
// 主会话的起因（docs/VIEW.md「账单的会话次数」）：没收尾后自动起的是“重试”，不是“恢复”
const TRIGGER = { intake: '提交', manual: '你点了“让后台继续”', answer: '你回答之后接着做', stalled: '没收尾后自动重试', version: '需求改了', consult: '咨询后' };
const fmtInt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '?');

// ---- 额度 ----

// 一个额度窗口过没过重置时间（终审 F6）：Mac 那边算视图时已经按这条把过期的标成 expired（lib/quota.mjs），
// 但设备上看的看板可能是 Mac 不在线之前发的——用 resetsAt 和这台设备的钟再判一次，过了就不再显示那个百分比
export const QUOTA_RESET_PASSED = '已过重置时间，等下一次观测';
export const windowPassed = (w, now = Date.now()) => !!w && (w.expired === true || (typeof w.resetsAt === 'string' && Number.isFinite(Date.parse(w.resetsAt)) && Date.parse(w.resetsAt) <= now));

export function quotaTile(q, now = Date.now()) {
  const label = q.pool === 'claude' ? 'Claude' : q.pool === 'codex' ? 'GPT' : q.pool === 'gptweb' ? 'GPT Web' : (q.label || q.pool);
  if (!q.observable) return { label, main: '不可观测', sub: null, stale: false, observable: false, remaining: null };
  const obs = Date.parse(q.observedAt);
  const stale = Number.isFinite(obs) && now - obs > STALE_QUOTA_MS;
  const f = q.fiveHour;
  let main;
  let remaining = null;
  if (windowPassed(f, now)) main = `五小时窗口${QUOTA_RESET_PASSED}`;
  else if (f && Number.isFinite(f.usedPct)) { remaining = Math.max(0, Math.min(100, Math.round(100 - f.usedPct))); main = `五小时剩 ${remaining}%`; }
  else main = '五小时窗口不可观测';
  const sub = Number.isFinite(obs) ? `${when(q.observedAt, now)} 观测${stale ? ' · 可能已过期' : ''}` : '观测时间不可观测';
  return { label, main, sub, stale, observable: true, remaining };
}

export function quotaDetail(q, now = Date.now()) {
  const rows = [];
  if (!q.observable) { rows.push(['为什么', q.note || 'Concierge 拿不到这个池子的数']); return rows; }
  const win = (w, name) => {
    if (!w) return [name, '不可观测'];
    if (windowPassed(w, now)) return [name, `${QUOTA_RESET_PASSED}${w.resetsAt ? `（上次重置 ${when(w.resetsAt, now)}）` : ''}`];
    if (!Number.isFinite(w.usedPct)) return [name, '不可观测'];
    return [name, `剩 ${Math.max(0, Math.round(100 - w.usedPct))}%${w.resetsAt ? `，${when(w.resetsAt, now)} 重置` : ''}`];
  };
  rows.push(win(q.fiveHour, '五小时窗口'));
  rows.push(win(q.weekly, '每周窗口'));
  rows.push(['数据来源', q.source || '不可观测']);
  rows.push(['观测时间', q.observedAt ? dayTime(q.observedAt) : '不可观测']);
  if (q.note) rows.push(['说明', q.note]);
  const p = q.probe || {};
  if (p.lastAt) rows.push(['上次探测', `${when(p.lastAt, now)} · ${p.ok ? '拿到了' : `没拿到${p.error ? `：${p.error}` : ''}`}`]);
  return rows;
}

// ---- 路由：#/t/<repo>/<号>、#/settings ----

export function hashOfTask(ref) {
  const m = String(ref).match(/^([A-Za-z0-9][A-Za-z0-9_.-]{0,99})#([1-9][0-9]{0,8})$/);
  return m ? `#/t/${m[1]}/${m[2]}` : '#';
}
export function routeOf(hash) {
  const s = String(hash || '').replace(/^#/, '');
  const t = s.match(/^\/t\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([1-9][0-9]{0,8})$/);
  if (t) return { name: 'task', ref: `${t[1]}#${t[2]}` };
  if (s === '/settings') return { name: 'settings' };
  return { name: 'home' };
}

// 设备名字的猜测（配对时的默认值；Mac 上起的名字优先）
export function guessLabel(ua = '', platform = '') {
  const s = `${ua} ${platform}`;
  if (/iPhone/.test(s)) return 'iPhone';
  if (/iPad/.test(s) || (/Macintosh/.test(s) && /Mobile/.test(s))) return 'iPad';
  if (/Windows/.test(s)) return 'Windows';
  if (/Android/.test(s)) return 'Android';
  if (/Mac/.test(s)) return 'Mac';
  return '设备';
}
