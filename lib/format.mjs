// 产品页面的文字和分组：纯函数，不碰 DOM（Node 里也能测）。
// 输入只有产品视图（docs/VIEW.md）。拿不到的写「不可观测」或「没有」，不编；计划和实际不一样时两个都写。

export const ONLINE_MS = 15 * 60000;      // 看板 10 分钟一次心跳；超过 15 分钟没消息算 Mac 不在线
export const STALE_QUOTA_MS = 3600000;    // 额度观测超过 1 小时：灰色、写「过期 · 最后观测 mm-dd hh:mm」
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

// 连不上 GitHub（看板的 github，#61 跟进）：横幅一句话。没有就是 null
export function githubDownText(board) {
  const since = board?.github?.since;
  if (!since || !Number.isFinite(Date.parse(since))) return null;
  return `从 ${dayTime(since)} 起，Mac 上的 Concierge 读写 GitHub 一直连不上或响应超时，下面的任务状态可能不是最新的。后台在自动重试，恢复之后自己会更新。`;
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

// ---- Windows 接收器（board.receivers，docs/VIEW.md「Windows 接收器」、UI.md §1）----
// Mac 把验过签的接收器心跳放进看板：{ machine, id, keyId, version, lastSeenAt, online, running:[ref…], autostart, error }。
// 没有证据不写“在线”：Mac 说在线、而且最近心跳离这台设备的钟不超过 5 分钟（远端看板可能是一阵子之前发的）才算
export const RECEIVER_ONLINE_MS = 5 * 60000;
export const RECEIVER_ERROR_TEXT = {
  github: '读写 GitHub 失败，在自动重试',
  unpinned: '还没钉住 Mac 的钥匙',
  'mac-key': 'Mac 的钥匙变了，停着等你核对（在 Windows 上跑 receiver.cmd pin --reset）',
  state: '钉住的状态记录读不到了或被关了',
  unverified: 'Mac 的看板验不过签名，这一轮跳过了',
  'no-claude': '找不到 claude 命令行',
  internal: '接收器自己出错了（详情在 Windows 的日志里）',
  'model-unreachable': '在线，但模型网络不通（Windows 上的代理没在运行），暂不领取',
};
const AUTOSTART_TEXT = { installed: '已装（登录就启动，崩溃一分钟内重启）', none: '没装（在 Windows 上双击 receiver-setup.cmd）', service: 'Windows 后台服务（不用登录）', unknown: '不知道' };
// 服务身份的心跳才有（#45）：模型走哪条网络、启动自检
export const MODEL_CHANNEL_TEXT = { 'dedicated-proxy': '专用后台代理（只通模型接口）', 'configured-proxy': '本机代理（依赖 Zoe 登录后的代理程序）', direct: '直连' };
export function selfcheckText(c) {
  if (!c || typeof c !== 'object') return null;
  const roots = c.roots === 'ok' ? '诊断目录可读' : '诊断目录有读不了的';
  const write = c.writeRestricted === true ? '写入受限已生效' : c.writeRestricted === false ? '写入受限没有生效（只靠程序自身的限制）' : '写入受限查不了';
  return `${roots} · ${write}`;
}
export function receiverOnline(r, now = Date.now()) {
  const t = Date.parse(r?.lastSeenAt);
  return r?.online === true && Number.isFinite(t) && now - t <= RECEIVER_ONLINE_MS && t - now <= 60000;
}
// 页头那一行。board 没读到就是 null（不显示）。Mac 只钉一个接收器（Zoe 10-03 定）：只按钉住的那一个判在线，
// 前面带它钥匙编号的前 8 位，Zoe 一眼能和 Windows 上打印的对（完整的在设置里）
export function receiverStatus(board, now = Date.now()) {
  if (!board) return null;
  const list = Array.isArray(board.receivers) ? board.receivers : [];
  if (!list.length) return { state: 'none', online: false, text: 'Windows 接收器：还没有接入' };
  const r = list[0];
  const name = `Windows 接收器${r.keyId ? ` ${String(r.keyId).slice(0, 8)}` : ''}`;
  if (receiverOnline(r, now)) {
    const n = Array.isArray(r.running) ? r.running.length : 0;
    if (r.error === 'model-unreachable') return { state: 'online', online: true, text: `${name}：${RECEIVER_ERROR_TEXT['model-unreachable']} · 最近心跳 ${clock(r.lastSeenAt)}${n ? ` · ${n} 个会话在跑` : ''}` };
    return { state: 'online', online: true, text: `${name}：在线 · 最近心跳 ${clock(r.lastSeenAt)} · ${n ? `${n} 个会话在跑` : '没有会话在跑'}` };
  }
  return { state: 'offline', online: false, text: r.lastSeenAt ? `${name}：离线（最近 ${when(r.lastSeenAt, now)}）` : `${name}：离线（还没收到过心跳）` };
}
// 设置页「Windows 接收器」里一台接收器的几行
export function receiverRows(r, now = Date.now()) {
  const online = receiverOnline(r, now);
  const running = Array.isArray(r.running) ? r.running : [];
  return [
    ['编号', r.id || '不知道'],
    ['钥匙编号', r.keyId || '不知道'],
    ['状态', online ? '在线' : '离线'],
    ['最近心跳', r.lastSeenAt ? dayTime(r.lastSeenAt) : '还没收到过'],
    ['版本', r.version || '不知道'],
    ['自动启动', AUTOSTART_TEXT[r.autostart] || AUTOSTART_TEXT.unknown],
    ['上一轮', r.error ? (RECEIVER_ERROR_TEXT[r.error] || '出错了') : '正常'],
    ['在跑的会话', running.length ? running.join('、') : '没有'],
    ...(r.modelChannel ? [['模型网络', MODEL_CHANNEL_TEXT[r.modelChannel] || '不知道']] : []),
    ...(selfcheckText(r.selfcheck) ? [['服务自检', selfcheckText(r.selfcheck)]] : []),
  ];
}

// ---- 任务分组 ----

// 还活着的任务分三组（hub#149）：真有人在做的（needKind 是 null：会话在跑、Windows 那边领了在跑、有人值守的窗口在做）叫“正在处理”；
// 会自己往下走的（排队、等额度、等 Windows 下一轮领取 / 恢复心跳：awaiting_*）叫“排队 / 等条件”；
// 后台不会自己接着做的（暂停、工程待接手、等她在 Mac 上放行）叫“没人在做”。取消（cancelled）不算完成，单独放一组
export const ACTIVE = ['working', 'queued', 'handed_off', 'stalled', 'paused'];

export function orderTasks(board, tasks) {
  const by = new Map((tasks || []).map((t) => [t.ref, t]));
  const out = [];
  for (const ref of board?.tasks || []) if (by.has(ref)) { out.push(by.get(ref)); by.delete(ref); }
  // 看板没列到的（刚发布、看板还没跟上）排在后面，按更新时间
  return out.concat([...by.values()].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))));
}

// 结束了但原来要的没做到（最终汇报 goalMet 是“部分 / 否”，或她手动关掉的）：不算完成，单独一组（hub#30 C04 / B4）
// hub#165（V2.md §3）：分组按六类核心状态（core）和 needsOwner——“等你决定”只放真要她本人回答的（owner_*），
// 旧的 life-zoe 卡（decision.misfiled，工程待接手）不再进“等你决定”，进“没人在做”
export function groupTasks(list) {
  const needs = []; const active = []; const waiting = []; const idle = []; const done = []; const unmet = []; const cancelled = [];
  for (const t of list) {
    const k = taskGroupKey(t);
    ({ needs, working: active, waiting, idle, done, unmet, cancelled })[k].push(t);
  }
  return { needs, active, waiting, idle, done, unmet, cancelled };
}
// 一个任务归在哪一组（列表分组和筛选片同一个口径）
export function taskGroupKey(t) {
  if (t?.state === 'cancelled') return 'cancelled';
  const c = coreState(t);
  if (t?.state === 'done') return c === 'ended' ? 'unmet' : 'done';
  if (c === 'needs_you' && needsOwner(t)) return 'needs';
  return { working: 'working', waiting: 'waiting' }[c] || 'idle';
}

// ---- 任务名（hub#30 C08 / B1）：「#86 · 修复图片上传」。编号是真实的任务编号；不在默认仓库（看板的 home）的加仓库名（「OurHome#4 · …」），
// 不知道默认仓库时一律带仓库名。短名取分诊起的标题，去掉开头的 [项目][领域]；没有标题时用原话第一行。列表、详情、以后的通知都用这一个
export const shortTitle = (title) => String(title || '').replace(/^(\s*\[[^\]]*\])+\s*/, '').trim();
export function taskNumber(ref, home = null) {
  const m = String(ref || '').match(/^([^#\s]+)#(\d+)$/);
  if (!m) return '';
  return home && m[1] === home ? `#${m[2]}` : `${m[1]}#${m[2]}`;
}
export function taskName(t, { home = null, max = 40 } = {}) {
  const name = clip(shortTitle(t?.title) || String(t?.want || '').trim().split('\n')[0] || '（没有名字）', max);
  const n = taskNumber(t?.ref, home);
  return n ? `${n} · ${name}` : name;
}

// ---- 暂停、取消、进展、轮次 ----
// 暂停分两种说法：在等条件自己恢复的（额度、Windows 那边）叫“等待恢复”；停在那里等她点“继续”的叫“暂停”
export const isWaiting = (t) => t?.state === 'paused' && (t.life?.state === 'wait' || /^等 /.test(t.stateText || '') || /^暂停：Windows 那边的会话超过/.test(t.stateText || ''));
export const pausedTitle = (t) => (isWaiting(t) ? '等待恢复' : '暂停');
// 暂停的原因（去掉开头的“暂停：”）
export const pausedReason = (t) => String(t?.stateText || '').replace(/^暂停[：:]\s*/, '') || '原因没有记下';
// 取消：她点了取消，或者按她的决定结束（原来要的没做到）。都不算完成
export const endedUnmet = (t) => /按你的决定结束/.test(t?.stateText || '');
export const cancelledTitle = (t) => (endedUnmet(t) ? '已结束（没做到）' : '已取消');
// 做完的任务只有一种情况会说“没全做到”：她手动关掉的（lib/view.mjs 的那一句）
export const CLOSED_UNMET = '已经关闭，但你原来要的没有全部做到';
const doneUnmet = (t) => t?.state === 'done' && (t.result?.goalMet === '部分' || t.result?.goalMet === '否' || t.stateText === CLOSED_UNMET);

export const clip = (s, n) => { const str = String(s ?? '').replace(/\s+/g, ' ').trim(); return str.length > n ? `${str.slice(0, Math.max(0, n - 1))}…` : str; };
// 第几轮（第一轮不写）
export const attemptText = (t) => (Number(t?.attempt) > 1 ? `第 ${t.attempt} 轮` : null);

// 最近进展：会话自己写的人话和 Concierge 写的，最新的在前。who 是 Concierge 的标出来
export function progressItems(t, now = Date.now()) {
  const list = Array.isArray(t?.progress) ? t.progress : [];
  return list.filter((x) => x && x.text).slice().reverse()
    .map((x) => ({ at: when(x.at, now) || '时间没有记录', text: String(x.text), who: x.who === 'Concierge' ? 'Concierge' : null }));
}
export const latestProgress = (t) => {
  const list = Array.isArray(t?.progress) ? t.progress.filter((x) => x && x.text) : [];
  return list.length ? list[list.length - 1] : null;
};

// 最终汇报太长时先显示前一段（在换行处断开），“展开完整结果”在原地显示全部
export const REPORT_PREVIEW = 600;
export function reportPreview(report, n = REPORT_PREVIEW) {
  const s = String(report ?? '');
  if (s.length <= n + 80) return { text: s, long: false };
  const cut = s.lastIndexOf('\n', n);
  const end = cut >= n * 0.6 ? cut : n;
  return { text: `${s.slice(0, end).trimEnd()}…`, long: true };
}

// 上一轮没做到时，后台接下来要什么（lifecycle 的 needs）
export const NEEDS_TEXT = { auto: '后台自己接着做', windows: '要到 Windows 的现场接着做', mac: '要回到 Mac 接着做', zoe: '要你做一件事', none: '按原来的要求做不到', wait: '要等外部条件' };

// ---- 任务页首屏摘要（hub#30 C05 / B2）：最新进展、下一步。都按视图里的真实字段写，没有就照实说 ----
export function findingLine(t, now = Date.now()) {
  if (t.state === 'done' || t.state === 'cancelled') {
    const r = t.result;
    if (r?.report) return clip(r.report, 140);
    if (r?.did) return clip(r.did, 140);
  }
  const pr = latestProgress(t);
  if (pr) return `${clip(pr.text, 140)}${when(pr.at, now) ? `（${when(pr.at, now)}）` : ''}`;
  if (t.lastResult?.report) return `上一轮：${clip(t.lastResult.report, 120)}`;
  return '还没有进展记录';
}
// 下一步：和摘要卡的状态标题、“需要你”同一个口径（按 windowsRun 和 stateText 的真实情况写，不说会自己开工却其实在等人）
export function nextLine(t) {
  // 旧的 life-zoe 卡（hub#165 反例 4）：不是等她做事
  if (t.state === 'needs_zoe' && t.decision?.misfiled) return '工程待接手：点「让工程接手」撤掉这张旧卡；之后要有人值守的工程窗口接管才会接着做';
  if (t.state === 'needs_zoe') {
    if (t.decision?.handler === 'action') return '等你批准或拒绝；批准后由受限执行器执行这一次，结果自动回来，任务接着做';
    if (t.decision?.kind === 'sensitive') return '等你批准或拒绝，之后接着做';
    if (t.decision?.handler === 'life-zoe') return '等你做完那件事、写一句结果，之后接着做';
    return '等你在下面选一个，之后接着做';
  }
  if (t.action && ['approved', 'running'].includes(t.action.state) && t.state === 'working') return '执行完自动写回结果，工程接着做';
  if (t.state === 'done') return doneUnmet(t) ? `原来要的还差：${clip(t.result?.remaining || '没写', 120)}` : '没有了';
  if (t.state === 'cancelled') return '不再继续';
  if (t.state === 'paused') {
    if (t.life?.state === 'wait' || isWaiting(t)) return `条件恢复后自动接着做${t.life?.until && clock(t.life.until) ? `（预计 ${clock(t.life.until)} 前后）` : ''}`;
    // 暂停（不是在等条件恢复）不是她要修的事（hub#30 C03），但后台不会自己接着做（hub#143 复核）：照实写怎么才会接着做
    if (needKind(t) === 'engineer_blocked') return '工程待接手：有人值守的工程窗口接管之后才会接着做';
    return '没人在做：点“继续”或到工程窗口接管之后才会接着做';
  }
  const st = t.stateText || '';
  const win = windowsRun(t);
  if (win) {
    return {
      none: UNCLAIMED_TEXT.test(st) ? '等 Windows 上的接收器领取' : '交给 Windows 了，等那边接手',
      claimed: 'Windows 那边已领取，会话马上开始',
      running: 'Windows 那边接着做，做完写最终汇报',
      stale: '看不到 Windows 那边还在不在跑，等确认',
      exited: 'Windows 那边的会话结束了，等核对结果、安排下一步',
      legacy: 'Windows 那边有人值守在做',
    }[win.kind] || '交给 Windows 了';
  }
  if (/Mac 上点/.test(st)) return '等你在 Mac 上点“让后台继续”';
  if (isAsyncWait(t) || /交施工单|GPT Web 协调者的意见/.test(st)) return '等 GPT Web 协调者的意见或施工单';
  if (t.state === 'queued') return t.plan ? '排队，安排好就开工' : 'Concierge 还在分诊，分好就开工';
  if (t.state === 'working') return lunaWorking(t) ? 'Luna 做完这份小施工单' : '后台接着做，做完写最终汇报';
  if (t.state === 'handed_off') return /接管|工程窗口/.test(st) ? '等有人值守的工程窗口接管' : '交出去了，等那边接手';
  // 没人在做（stalled）：上一轮留下的下一步还有参考价值
  if (t.lastResult?.next) return clip(t.lastResult.next, 140);
  if (t.lastResult?.needs && NEEDS_TEXT[t.lastResult.needs]) return NEEDS_TEXT[t.lastResult.needs];
  return '没人在做，等处理';
}

// 等她决定的卡有没有被截短（第七次复核 F3）：新视图看 decision.truncated；旧视图（视图版本 1、远端缓存里还在）只有顶层 truncated，
// 里面列了 decision.* 或 'all' 也算。只有标题、原话这些非决定项被截时不算（照样能批）
export function decisionClipped(t) {
  if (!t?.decision) return false;
  if (t.decision.truncated === true) return true;
  return (Array.isArray(t.truncated) ? t.truncated : []).some((x) => x === 'all' || String(x).startsWith('decision.'));
}
// 决定记录的链接（工程详情里那一条；截短的卡指向它看完整内容）
export const decisionRecordUrl = (t) => (t?.engineering?.evidence || []).find((e) => e && e.kind === 'decision' && e.url)?.url || null;

// 任务页顶上的“截短了”提示：最终汇报现在完整放在页面里，只有别的内容被截了才提一句（不指去别处看）
export function truncatedNote(t) {
  const cut = (Array.isArray(t?.truncated) ? t.truncated : []).filter((x) => !['result.report', 'lastResult.report'].includes(x));
  return cut.length ? '有些内容太长，这里只显示了一部分。' : null;
}

const isAsyncWait = (t) => t.state === 'queued' && t.plan?.consult?.async && t.actions?.includes('resume');
// 最后一份施工单（小动工，docs/VIEW.md「小动工和 GPT Web 协调者」）
export const lastSmallWork = (t) => (Array.isArray(t?.smallWork) && t.smallWork.length ? t.smallWork[t.smallWork.length - 1] : null);
const lunaWorking = (t) => t.state === 'working' && (/Luna/.test(t.now?.who || '') || lastSmallWork(t)?.state === 'running');

// ---- 交给 Windows 的任务（taskView.execution，docs/VIEW.md「Windows 上的任务」）----
// execution 只有路由到 Windows 的任务才有：{ machine:'Windows', receiver:'none'|'claimed', session:null|'running'|'stale'|'exited',
// claimedAt, lastSeenAt, exit:{code,at}|null }。页面按它说“领没领取、那边的会话在不在跑”，不按“交出去了”一句话糊过去。
// 没领取（receiver 不是 claimed）时，只有 Mac 说“接收器还没有领取”那一句才算“未领取、要启动接收器”。别的没领取的情况
// （等你在 Mac 上点“让后台继续”、领过一次之后你又回答了、没签名的表单来件、那边有人值守写过交接、敏感操作批准了等有人值守、
// 这台 Mac 上没有登记交给 Windows）启动接收器也不会来领：返回 null，按 Mac 的状态说明和 now 写（审查 4）。
// 旧视图（Mac 上的 Concierge 还没升级，没有 execution）只认旧的两句：“等那边接手”= 还没有人领取；“Windows 那边在做”= 那边写回过进展，
// 现在在不在跑不可观测。等你决定、完成的照常按那两种状态写。
export const UNCLAIMED_TEXT = /接收器还没有领取/;
export function windowsRun(t) {
  if (!t || t.state === 'done' || t.state === 'needs_zoe' || t.state === 'cancelled') return null;
  const x = t.execution;
  const st = t.stateText || '';
  if (x && x.machine === 'Windows') {
    if (x.receiver !== 'claimed') return UNCLAIMED_TEXT.test(st) ? { kind: 'none', x } : null;
    return { kind: ['running', 'stale', 'exited'].includes(x.session) ? x.session : 'claimed', x };
  }
  if (/等那边接手/.test(st)) return { kind: 'none', x: null };
  if (st === 'Windows 那边在做') return { kind: 'legacy', x: null };
  return null;
}

function windowsLine(w, now) {
  const x = w.x || {};
  switch (w.kind) {
    case 'none': return 'Windows · 未领取';
    case 'running': return ['Windows · 会话在跑', x.lastSeenAt && when(x.lastSeenAt, now) ? `最近心跳 ${when(x.lastSeenAt, now)}` : null].filter(Boolean).join(' · ');
    case 'stale': return 'Windows · 超过 10 分钟没心跳';
    case 'exited': return 'Windows · 会话已退出';
    case 'claimed': return 'Windows · 已领取，会话还没开始';
    default: return 'Windows · 那边写回过进展，现在在不在跑不可观测';
  }
}

// 列表里一条的第二行
export function listLine(t, options, now = Date.now()) {
  const nw = t.now || {};
  const sw = lastSmallWork(t);
  const win = windowsRun(t);
  // 旧的 life-zoe 卡（hub#165 反例 4）：工程待接手，不是要她动手
  if (t.state === 'needs_zoe' && t.decision?.misfiled) return '没人在做 · 工程待接手（旧卡）';
  // 暂停的（包括 Windows 那边没心跳、结束了没留下结论的）按暂停说：原因在 stateText 里
  if (win && t.state !== 'paused') return windowsLine(win, now);
  switch (t.state) {
    case 'working': {
      if (lunaWorking(t)) return ['正在小动工', 'Luna', nw.model || sw?.model, nw.effort || sw?.effort, nw.machine, since(nw.since, now)].filter(Boolean).join(' · ');
      // 有进展就说最新的一句（会话自己写的人话）和时间，比“正在处理 · 模型”有用
      const pr = latestProgress(t);
      if (pr) return [clip(pr.text, 40), when(pr.at, now), attemptText(t)].filter(Boolean).join(' · ');
      const parts = ['正在处理', attemptText(t), modelLabel(nw.model, options), nw.effort, nw.machine, since(nw.since, now)];
      return parts.filter(Boolean).join(' · ');
    }
    case 'paused':
      return [pausedTitle(t), clip(pausedReason(t), 40)].join(' · ');
    case 'cancelled':
      return cancelledTitle(t);
    case 'needs_zoe':
      // 提前申请的卡（hub#165 §15.3）：不挡着任务——后台照常在做，列表第二行写进展，后面只提一句
      if (t.decision?.deferred) {
        const pr = latestProgress(t);
        return [pr ? clip(pr.text, 40) : '后台照常在做', `不急：等你批准「${clip(actionTitle(t.decision.action || {}), 20)}」`].join(' · ');
      }
      if (t.decision?.handler === 'life-zoe') return '需要你做一件事 · 做完了在这里写一句结果';
      if (t.decision?.handler === 'action') return `等你批准 · ${clip(t.decision.action?.title || '受限执行器的动作', 40)}`;
      return t.decision?.kind === 'sensitive' ? '等你批准 · 敏感操作，只能在 Mac 上批' : '等你决定 · 选一个方案';
    case 'done': {
      if (t.result?.missing) return '结束了 · 没有留下结果说明';
      const main = (t.provenance?.main || [])[0];
      // 只做了小动工（主执行还没跑过）：改动等她看
      if (!main && sw?.state === 'ok') return ['小动工做完了 · 改动等你看', duration(sw.durationMs)].filter(Boolean).join(' · ');
      // 最终汇报说原来的要求没全做到：放在最前面说。要她做什么是会话自己写的一段话，只在任务页完整显示，列表里不截一半
      // 做完 = 原来要的做到了。只有她手动关掉的才会出现“没全做到”
      // hub#165 §8.2：完成的写验收了没有（旧视图没有 acceptance 这一项：不写）
      const head = doneUnmet(t) ? '结束了 · 原来要的还没全部做到' : t && 'acceptance' in t ? `完成 · ${acceptShort(t)}` : '完成';
      return [head, modelLabel(main?.model, options), duration(t.bill?.durationMs)].filter(Boolean).join(' · ');
    }
    case 'stalled':
      if (sw && /^小动工/.test(t.stateText || '')) {
        return sw.state === 'failed' ? '没人在做 · 小动工没做成' : sw.state === 'refused' ? '没人在做 · 小动工没有执行' : '没人在做 · 小动工中断了';
      }
      return /中断/.test(t.stateText || '') ? '没人在做 · 上次会话结果不明'
        : /坏了/.test(t.stateText || '') ? '没人在做 · 这台 Mac 上的记录坏了'
          : /工程窗口/.test(t.stateText || '') ? '没人在做 · 最后是工程窗口在做' : '没人在做';
    case 'handed_off':
      if (/没有这个任务的登记|没有这个任务交给 Windows 的登记/.test(t.stateText || '')) return '交出去了 · 这台 Mac 上没有登记';
      if (/有人看着的工程窗口/.test(t.stateText || '')) return '交出去了 · 有人值守的工程窗口';
      // 交给 Windows、接收器不会来领的几种（审查 4）：照 Mac 的说明写
      if (nw.machine === 'Windows') return t.stateText === 'Windows 那边在做' ? '交给 Windows 了 · 那边有人值守在做' : /接管/.test(t.stateText || '') ? '交给 Windows 了 · 等工程窗口接管' : '交给 Windows 了';
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

// ---- 任务页的状态块（没做完、也不在等她决定的任务）：标题、当前执行者、目标环境、需要你 ----
// 都按视图里的真实字段写：没人在做的写“没人在做”，看不到的写“不可观测”，不写成“正在处理”。

// 最终汇报里“原来的要求做到没有”那一行（旧结果没有，返回 null）
export function goalLine(r) {
  if (!r || !r.goalMet) return null;
  if (r.goalMet === '是') return '做到了';
  return `${r.goalMet === '部分' ? '只做到一部分' : '没做到'}，还差：${r.remaining || '没写'}`;
}

export function statusTitle(t) {
  if (t.state === 'done') return doneUnmet(t) ? '结束了 · 原来要的还没全部做到' : '完成';
  if (t.state === 'cancelled') return cancelledTitle(t);
  if (t.state === 'paused') return pausedTitle(t);
  if (t.state === 'needs_zoe' && t.decision?.misfiled) return '工程待接手（旧卡）';
  if (t.state === 'needs_zoe') return t.decision?.handler === 'life-zoe' ? '需要你做一件事' : '等你决定';
  const win = windowsRun(t);
  if (win) return { none: '交给 Windows 了 · 未领取', running: '正在处理', stale: '运行状态不可观测', exited: '没人在做', claimed: '交给 Windows 了 · 已领取' }[win.kind] || '交给 Windows 了';
  if (t.state === 'working') return lunaWorking(t) ? '正在小动工' : '正在处理';
  if (t.state === 'queued') return '排队';
  if (t.state === 'handed_off') return '交出去了';
  return '没人在做';
}

// 当前执行者：now.who（谁）· 模型 · effort。机器另起一行写在「目标环境」里
export function executorText(t, options) {
  const n = t.now || {};
  // 登记动作批了、在执行（hub#152）：真正在做的是 Mac 上的受限执行器
  if (t.action && ['approved', 'running'].includes(t.action.state) && t.state !== 'needs_zoe') return `${t.action.site === 'windows' ? 'Windows' : 'Mac'} 上的受限执行器`;
  const who = n.who ? [n.who, modelLabel(n.model, options), n.effort].filter(Boolean).join(' · ') : null;
  const win = windowsRun(t);
  if (win) {
    if (win.kind === 'none') return '还没有人领取';
    if (win.kind === 'stale') return `不可观测：那边的会话超过 10 分钟没有心跳${who ? `（${who}）` : ''}`;
    if (win.kind === 'exited') return `没人在做：那边的会话已经退出${who ? `（${who}）` : ''}`;
    if (win.kind === 'legacy') return who || '不可观测：那边写回过进展，现在在不在跑看不到';
    return who || 'Windows 上的接收器（已领取）';
  }
  if (t.state === 'stalled') return who ? `没人在做（最后：${who}）` : '没人在做';
  if (t.state === 'paused' && !who) return '暂停中，现在没人在做';
  if (who) return who;
  if (t.state === 'queued') return '还没开始';
  return '没人在做';
}

// 目标环境：这件事在哪台机器上做。只有 Mac 会自己执行；交给 Windows 的写 Windows；看不到的写“不可观测”
export function targetEnv(t) {
  if (windowsRun(t)) return 'Windows';
  const n = t.now || {};
  if (n.machine) return n.machine;
  if (/没有这个任务的登记|工程窗口/.test(t.stateText || '')) return '不可观测';
  const m = (t.provenance?.main || []).at(-1)?.machine;
  if (m) return m;
  if (t.state === 'queued' && !t.plan) return '还没定（Concierge 还在分诊）';
  return 'Mac';
}

// ---- 「需要你」的口径（hub#30 C03）：只有真正要 Zoe 本人动手的才写“要：……” ----
// needKind 由 Mac 算好放在视图里（lib/view.mjs）；旧视图没有这一项时页面按同一个函数自己算，口径一样。
// 只按视图里已有的字段推（state、decision.kind / handler、life、execution、stateText、actions、plan），不新增数据来源。
// 判定顺序（先命中的算）：
//   1 完成 / 已取消                                   → null
//   2 needs_zoe：敏感操作                             → owner_approval（只能在 Mac 上批，卡片单独一种样子）
//     needs_zoe：life-zoe（要你本人做一件事：解锁 / 信任 / 接上 / 看一眼手机……，hub#149）→ owner_physical_action
//     needs_zoe：别的决定（产品取舍、选一个）          → owner_action（卡片上写明了选什么）
//   3 正在做（working）                               → null
//   4 在等额度 / 条件恢复（life.state 是 wait，或排队 / 暂停时方案在等额度池） → awaiting_quota
//   5 要她在 Mac 上点“让后台继续”放行（不是在 Mac 上提交的改动，有这个按钮） → owner_action
//   6 Windows 那边超过 10 分钟没心跳（暂停、等那台机器自己恢复） → awaiting_worker
//     暂停、而且是工程待接手（life.engineer：同一台机器还要同一台机器的现场 / 说要你动手却没写清三项 / 写的其实是工程的事，hub#149）
//                                                     → engineer_blocked
//     别的暂停、有“继续”（自动轮数到上限、上一轮没留下结论……）→ paused：没人在做，点“继续”后台会再开一轮
//     暂停但没有“继续”、没人在做（stalled：会话退出了、上一轮中断、记录坏了……）→ engineer_blocked
//   engineer_blocked 的意思是“工程必须接手，但现在没有可信的执行者在做”：系统里没有能自动接这类事的工程执行队列（hub#149 核对过），
//   所以页面照实写“工程待接手”，不写“工程这边在处理 / 已接手”；要推进，得有人值守的工程窗口说“接管”
//   7 交出去了（handed_off）：接收器在线、下一轮就领 / 交回 Windows 等领取 → awaiting_worker；
//     有人值守的窗口正在做（或那边写过“在做”）       → null；
//     接收器没领取、不会领、要工程窗口接管            → engineer_blocked
//   8 排队（queued）                                  → awaiting_worker（分诊、等协调者的意见或施工单、马上交给 Luna）
//   9 其余                                            → null
export const NEED_KINDS = ['owner_approval', 'owner_physical_action', 'owner_action', 'engineer_blocked', 'paused', 'awaiting_worker', 'awaiting_quota'];
const WIN_AWAIT = /下一轮轮询|等接收器领取/;
const SOMEONE_ON_IT = /^Windows 那边在做|有人值守的工程窗口在做/;
export function needKindOf(t) {
  if (!t || t.state === 'done' || t.state === 'cancelled') return null;
  const st = t.stateText || '';
  // 旧的 life-zoe 卡（hub#165 反例 4）：缺做什么 / 为什么 / 预期结果之一，或者写的其实是工程的事。
  // 判定在 Mac（lib/view.mjs 按 lifecycle.engineeringAsk 标 decision.misfiled）；这里只认这个标记：工程待接手，不是要她动手
  if (t.state === 'needs_zoe' && t.decision?.handler === 'life-zoe' && t.decision?.misfiled) return 'engineer_blocked';
  if (t.state === 'needs_zoe') return t.decision?.kind === 'sensitive' ? 'owner_approval' : t.decision?.handler === 'life-zoe' ? 'owner_physical_action' : 'owner_action';
  if (t.state === 'working') return null;
  if (t.life?.state === 'wait' || (t.plan?.wait && (t.state === 'queued' || t.state === 'paused'))) return 'awaiting_quota';
  if (/Mac 上点/.test(st) && (t.actions || []).includes('resume')) return 'owner_action';
  // Windows 那边超过 10 分钟没心跳：暂停、等那台机器自己恢复（页面标题是“等待恢复”）
  if (t.state === 'paused' && isWaiting(t)) return 'awaiting_worker';
  if (t.state === 'paused' && !t.life?.engineer && (t.actions || []).includes('resume')) return 'paused';
  if (t.state === 'paused' || t.state === 'stalled') return 'engineer_blocked';
  if (t.state === 'handed_off') {
    if (WIN_AWAIT.test(st)) return 'awaiting_worker';
    if (SOMEONE_ON_IT.test(st)) return null;
    // Windows 上的接收器已经领了、那边的会话在起 / 在跑：有人在做
    if (t.execution?.receiver === 'claimed' && ['starting', 'running', null, undefined].includes(t.execution.session)) return null;
    return 'engineer_blocked';
  }
  if (t.state === 'queued') return 'awaiting_worker';
  return null;
}
// 视图里带了就用视图的（Mac 算的），没带（旧视图）就自己算
export const needKind = (t) => (t && t.needKind !== undefined && (t.needKind === null || NEED_KINDS.includes(t.needKind)) ? t.needKind : needKindOf(t));
export const needsOwner = (t) => ['owner_approval', 'owner_physical_action', 'owner_action'].includes(needKind(t));

// ---- 六类核心状态（hub#165，docs/V2.md §4）：任务页首屏第一块和列表右侧的标签按它来 ----
// Mac 在视图里算好（lib/view.mjs 的 core，调的就是这个函数）；旧视图没有 core 时页面按同一个函数自己算。
//   needs_you  needKind 是 owner_*（要你选 / 要你动手 / 敏感审批）
//   working    needKind 是 null、而且真有人在做（会话在跑、Windows 那边领了在跑、有人值守的窗口、受限执行器在跑）
//   waiting    awaiting_worker / awaiting_quota：会自己接着做
//   idle       engineer_blocked / paused：没人在做（工程待接手，或者停着等“继续”）
//   done       完成而且原来要的做到了
//   ended      结束 · 没做到（done-unmet、按她的决定结束）/ 已取消
export const CORE_STATES = ['needs_you', 'working', 'waiting', 'idle', 'done', 'ended'];
export function coreStateOf(t) {
  if (!t) return 'idle';
  if (t.state === 'cancelled') return 'ended';
  if (t.state === 'done') return doneUnmet(t) ? 'ended' : 'done';
  const k = needKind(t);
  if (k === 'owner_approval' || k === 'owner_physical_action' || k === 'owner_action') return 'needs_you';
  if (k === 'awaiting_worker' || k === 'awaiting_quota') return 'waiting';
  if (k === 'engineer_blocked' || k === 'paused') return 'idle';
  if (['working', 'handed_off'].includes(t.state) || ['approved', 'running'].includes(t.action?.state)) return 'working';
  return 'idle';
}
// 视图里带了就用视图的（Mac 算的），没带（旧视图）就自己算
export const coreState = (t) => (t && CORE_STATES.includes(t.core) ? t.core : coreStateOf(t));

// 工程卡住的原因：状态说明里去掉开头的“暂停：”“交给 Windows 了。”和教人动手的那半句（“要做的话到工程窗口说……”“点“继续”……”）
export function blockedReason(t) {
  const st = String(t?.stateText || '').replace(/^暂停[：:]\s*/, '').replace(/^交给 Windows 了。/, '');
  const teach = /^(要做的话|要继续|点“继续”|之后|你点)/;
  const keep = st.split('。').map((x) => x.split('；').map((y) => y.trim()).filter((y) => y && !teach.test(y)).join('；')).filter(Boolean);
  return clip(keep.join('。') || '原因没有记下', 100);
}
// 在等谁 / 等什么（“不需要：”后面那半句）
export function waitingFor(t) {
  const st = t.stateText || '';
  if (WIN_AWAIT.test(st)) return '在等 Windows 上的接收器领取（它每分钟轮询一次）';
  if (t.state === 'paused' && /没有心跳/.test(st)) return '在等 Windows 那边恢复心跳（超过 10 分钟没有心跳了，恢复后接着做）';
  if (t.state === 'paused') return '在等条件恢复';
  if (isAsyncWait(t)) return `在等 GPT Web 协调者的意见（想快一点：到连着 Engineering Bridge 的那个 ChatGPT 对话里说一句“看 ${t.ref}”，或者点“不等了，直接做”）`;
  if (/交施工单/.test(st)) return '在等 GPT Web 协调者交施工单';
  if (/GPT Web 协调者的意见/.test(st)) return '在等 GPT Web 协调者的意见';
  if (/施工单到了/.test(st)) return '施工单到了，马上交给 Luna';
  if (t.state === 'queued') return t.plan ? '在等后台安排开工' : '在等 Concierge 分诊';
  return '在等那边接手';
}
// 要她做的那件事（owner_physical_action / owner_action）：卡片上写明了的照写
function ownerActionText(t) {
  const st = t.stateText || '';
  if (t.state === 'needs_zoe') {
    const d = t.decision || {};
    if (d.handler === 'life-zoe') return d.what ? `要：${clip(d.what, 80)}（做完在下面写一句结果）` : '要：做下面说的那件事，做完在这里写一句结果';
    return '要：在下面选一个';
  }
  if (/Mac 上点/.test(st)) return '要：在 Mac 上点“让后台继续”';
  return `要：${clip(st, 80)}`;
}

// 需要你（摘要卡那一行）：只有 owner_* 写“要：……”；工程待接手的写“不需要你动手：工程待接手……（原因）”；
// 停着等“继续”的照实写没人在做；等待类写“不需要：在等……”。没人在做时不写“工程这边在处理 / 已接手”（hub#143 复核、hub#149）
export function needLine(t) {
  switch (needKind(t)) {
    // 登记动作（hub#152）：允许手机批的写明“Mac 上，或开启了手机批准的 iPhone（面容 ID）”
    case 'owner_approval': return t.decision?.handler === 'action' && t.decision?.action
      ? `${t.decision.action.remote ? '要：批准或拒绝（Mac 上，或开启了手机批准的 iPhone 用面容 ID）' : '要：批准或拒绝（只能在 Mac 上批，手机上可以拒绝）'}${t.decision.deferred ? '。不急：这是提前申请的，任务还在做' : ''}`
      : '要：批准或拒绝（只能在 Mac 上批）';
    case 'owner_physical_action':
    case 'owner_action': return ownerActionText(t);
    case 'engineer_blocked': return `不需要你动手：工程待接手，现在没有工程执行者在做（${blockedReason(t)}）`;
    case 'paused': return `不用你修：现在没人在做，后台不会自己接着做（${blockedReason(t)}）；点“继续”会再开一轮`;
    case 'awaiting_worker': return `不需要：${waitingFor(t)}`;
    case 'awaiting_quota': {
      const until = t.life?.until || t.plan?.wait?.until;
      return `不需要：在等额度或条件恢复，恢复后会自动接着做${until && clock(until) ? `（预计 ${clock(until)} 前后）` : ''}`;
    }
    default: return '不需要';
  }
}

// Windows 那边能观测到的事实（任务页状态块里多的几行）。旧视图没有 execution：不出这几行
export function windowsRows(t, now = Date.now()) {
  const x = t.execution;
  if (!x || x.machine !== 'Windows' || !windowsRun(t)) return [];
  const at = (iso) => when(iso, now) || '时间没有记录';
  const rows = [['Windows 接收器', x.receiver === 'claimed' ? `已领取 · ${at(x.claimedAt)}${x.run > 1 ? ` · 第 ${x.run} 次会话` : ''}` : '还没有领取：那边没有运行接收器，或者还没轮询到']];
  if (x.receiver === 'claimed') {
    const s = x.session;
    rows.push(['那边的会话', s === 'running' ? `在跑 · 最近心跳 ${at(x.lastSeenAt)}`
      : s === 'stale' ? `超过 10 分钟没有心跳（最近一次 ${at(x.lastSeenAt)}），在不在跑不可观测`
        : s === 'exited' ? `已退出${Number.isInteger(x.exit?.code) ? `（退出码 ${x.exit.code}）` : ''} · ${at(x.exit?.at)}，${/已有进展交接/.test(t.stateText || '') ? '已有进展交接，尚无最终结果' : '尚无最终结果记录'}`
          : '还没开始']);
    if (s === 'exited' && x.reason) rows.push(['没起来的原因', x.reason]);
  }
  return rows;
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
  if (s.via === 'coordinator') return ['GPT Web 协调者派的工', s.device ? `经「${s.device}」` : null, s.verified === false ? '没有验过' : null].filter(Boolean).join(' · ');
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
      const effort = effortActualText(m);
      // 同一个配置一行；其中有结果不明的（Mac 上的 Concierge 重启过）在这一行里说明，不另起一行
      const parts = [`${EXECUTOR[m.executor] || m.executor || '后台'} ${model}`, effort, m.machine, `${m.sessions || 0} 次会话${m.unknown ? `，其中 ${m.unknown} 次结果不明` : ''}`].filter(Boolean);
      let line = parts.join(' · ');
      if (m.modelFrom === '要求') line += '（模型是要求的，日志里没核对到）';
      if (m.modelCheck === 'mismatch' && plan?.model) line += `（要的是 ${modelLabel(plan.model, options)}，实际是 ${model}）`;
      if (!m.effortCheck && m.effort && m.effortEvidence) line += `（effort：${m.effortEvidence}）`;
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

// 实际的思考档位和证据（provenance.main 的一行）。只写有证据的那么多：Claude 的日志里没有实际档位，只能说“已请求”
export function effortActualText(m) {
  const req = m?.effort || null;
  const act = m?.effortActual || null;
  switch (m?.effortCheck) {
    case 'verified': return `${act || req}（已核实）`;
    case 'requested': return `${req}（已请求；Claude 日志核对不了实际档位）`;
    case 'mismatch': return `实际 ${act || '不明'}（要的是 ${req || '没指定'}，实际档位和要的不一样）`;
    case 'observed': return `${act}（没指定，记录里看到的实际档位）`;
    case 'default': return '没指定，用命令行默认档位';
    default: return req || '默认档位';
  }
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
  if (mainRan && (p.main || []).length) rows.push(['思考档位', (p.main || []).map(effortActualText).join('，')]);
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

// 协调者那一项（board.options.consult 里 async 的）能观测到的连接事实。connected=false 时这一项不能选，任务页也不给“请它看一眼”。
// 只有两样能观测：Mac 上的隧道进程在不在跑（tunnelRunning）、桥上次被调用的时间（lastCallAt）。两样都有才算“有连接证据”：
// 隧道在跑不等于 ChatGPT 连着；上次调用只是历史，ChatGPT 现在连没连着不可观测，所以不写“已接通”。
export function coordinatorStatus(o, now = Date.now()) {
  const called = !!o?.lastCallAt && Number.isFinite(Date.parse(o.lastCallAt));
  const last = called ? `上次调用 ${when(o.lastCallAt, now)}` : null;
  if (o?.tunnelRunning === false) return { connected: false, text: `还没接通：Mac 上的隧道没在跑${last ? `（${last}）` : ''}` };
  if (o?.tunnelRunning === true) {
    return called ? { connected: true, text: `隧道在跑 · ${last}（ChatGPT 现在是否连着不可观测）` } : { connected: false, text: '隧道在跑，但 ChatGPT 还没调用过（没有连接证据）' };
  }
  return { connected: false, text: last ? `${last}（隧道在不在跑不可观测）` : '还没接通' };
}

// 咨询对象的名字：本机的 Codex 和 GPT Web 协调者是两回事，哪儿都不能混（GPT Web 协调者没有“模型 ×次数”）
export function consultName(o) {
  if (!o) return null;
  if (o.async || o.target === 'gptweb') return 'GPT Web 协调者';
  const label = String(o.label || '');
  if (o.target !== 'codex' || /Codex/.test(label)) return label || String(o.target || '');
  return ['Codex（本机）', label || o.model].filter(Boolean).join(' · ');
}

// 任务页「执行方案」：分诊之后定下来的方案（taskView.plan），每项写明是自动定的还是她指定的
export function planRows(t, options) {
  const p = t.plan;
  if (!p) return [];
  const a = p.auto || {};
  const c = p.consult;
  const model = p.modelName ? String(p.modelName).replace(/^Claude\s+/, '') : modelLabel(p.model, options);
  const rows = [
    // 自动选的写出选了谁、为什么；旧方案（自动 = 没传模型）照旧写
    ['主执行模型', !model ? '自动：用命令行默认的模型' : a.model ? `${model}（${p.modelWhy || '自动'}）` : `${model}（你指定的）`],
    // 自动选的档位写出是哪档、为什么（effortWhy，比如“自动：普通任务”）；她指定的写“你指定的”
    ['思考档位', !p.effort ? '自动：用命令行默认档位' : p.effortAuto ? `${p.effort}（${p.effortWhy || '自动'}）` : `${p.effort}${a.effort ? '' : '（你指定的）'}`],
    ['子代理', p.maxSubagents === 0 ? (a.subagents ? `不开（${p.subagentsWhy || '自动'}）` : '不开（硬限制）') : Number.isInteger(p.maxSubagents) ? `最多 ${p.maxSubagents} 个（${a.subagents ? (p.subagentsWhy || '自动') : '你指定的'}）` : '自动'],
  ];
  // hub#165 §6：子代理用什么模型、执行范围（旧方案没有这两项：不出这两行）
  if ('subagentModel' in p) rows.push(['子代理模型', subagentModelPlanText(p, options)]);
  // 在哪台机器上做：有执行地点的限定（hub#165 反例 9：偏好手选 / 原话写明）就写「只在 …」和硬约束；
  // 没有限定时只有不在 Mac 上才单列一行（Mac 是默认）
  if (p.site && Array.isArray(p.site.allowed) && p.site.allowed.length) rows.push(['在哪台机器上做', `只在 ${p.site.allowed.map((m) => (m === 'windows' ? 'Windows' : 'Mac')).join(' / ')}（${p.site.pinned ? '你指定的' : '原话里写明的'}，硬约束：做不到会先问你，不会换机器）`]);
  else if (p.machine && p.machine !== 'Mac') rows.push(['在哪台机器上做', p.machine]);
  if (p.wait) rows.push(['在等额度', `${POOL_NAME[p.wait.pool] || p.wait.pool || '额度'}用满了${p.wait.until && when(p.wait.until) ? `，预计 ${when(p.wait.until)} 后接着做` : '，恢复后接着做'}`]);
  if (p.conflict) rows.push(['跑不了', `你指定的 ${String(p.conflict.modelName || p.conflict.model || '模型').replace(/^Claude\s+/, '')} 不能在 ${p.conflict.machine || '这台机器'} 上跑`]);
  if (!c) rows.push(['咨询', a.consult ? '不咨询（自动：分诊认为不需要）' : '不咨询（你选的）']);
  else if (c.async || c.target === 'gptweb') {
    rows.push(['咨询', 'GPT Web 协调者 · 先等它的意见再开工（你指定的）']);
    rows.push(['咨询思考档位', '在 ChatGPT 里由你自己选，Concierge 控制不了也核实不了']);
    rows.push(['允许小动工', p.smallWork ? '允许（只对这一个任务）' : p.smallWorkLegacy ? '旧版本开的，现在不算数（要用的话重新开一次）' : '不允许（它只给意见）']);
  } else {
    rows.push(['咨询', `${consultName(c)} · 最多 ${c.max} 次（${a.consult ? '自动：分诊认为值得第二个模型看一眼' : '你指定的'}）`]);
    rows.push(['咨询思考档位', c.effort || '自动：用它的默认档位']);
  }
  if ('scope' in p) rows.push(['执行范围', p.scope ? `你指定的：${SCOPE_TEXT[p.scope] || p.scope}` : `自动：${SCOPE_TEXT.fix}`]);
  // hub#165 §15.3：提交时勾的预授权（只有勾了才有这一行；撤销了照写）
  const pre = t.preauth;
  if (pre && Array.isArray(pre.runbooks) && pre.runbooks.length) rows.push(['预授权', `${pre.runbooks.map((r) => r.title || r.id).join('、')}（你提交时勾的，只对这个任务${pre.revokedAt ? `；${dayTime(pre.revokedAt)} 撤销了` : ''}）`]);
  return rows;
}

// ---- 授权范围（hub#165 §15.3，任务页「授权范围」块）：只读视图里的 plan.preflight / preauth / actionsPending / action ----
//   preflight  提交时的权限预检（只是提示，不是授权）：每项带状态 已预授权 / 已撤销 / 到时要单独批（可以预授权但提交时没勾的也写到时单独批）
//   preauth    提交时勾的预授权（动作 · 范围 · 谁在哪勾的 · 撤销了没有）
//   waiting    提前申请、还没批的动作（不急：任务还在做；可以在这里直接批）；expired 是过期没批的
//   ran        已经按预授权执行的（action.approvedVia 'preauth'，或者 actionsPending 里按预授权批了、在跑的）
export const PREAUTH_BY = { 'mac-page': 'Mac 本机页面', device: '已连接的设备' };
export function authority(t) {
  const pre = t?.preauth && Array.isArray(t.preauth.runbooks) && t.preauth.runbooks.length ? t.preauth : null;
  const granted = new Set(pre && !pre.revokedAt ? pre.runbooks.map((r) => r.id) : []);
  const revoked = new Set(pre && pre.revokedAt ? pre.runbooks.map((r) => r.id) : []);
  const preflight = (Array.isArray(t?.plan?.preflight) ? t.plan.preflight : []).filter((x) => x && x.title).map((x) => {
    const status = x.runbook && granted.has(x.runbook) ? 'granted' : x.runbook && revoked.has(x.runbook) ? 'revoked' : 'separate';
    const tag = status === 'granted' ? '已预授权' : status === 'revoked' ? '预授权已撤销，到时要单独批' : x.preauthable ? '提交时没勾预授权，到时要单独批' : '到时要单独批';
    return { ...x, status, tag };
  });
  // 动作名用产品说法（登记清单里的名字可能带“PR”：actionTitle 换成“改动”）
  const pend = (Array.isArray(t?.actionsPending) ? t.actionsPending : []).filter(Boolean).map((a) => ({ ...a, title: actionTitle(a) }));
  const waiting = pend.filter((a) => a.deferred && ['pending', 'deciding'].includes(a.state));
  const expired = pend.filter((a) => a.deferred && a.state === 'expired');
  const ran = [];
  if (t?.action && t.action.approvedVia === 'preauth') ran.push({ id: t.action.id, title: actionTitle(t.action), state: t.action.state, text: t.action.stateText || null, at: t.action.at || null });
  for (const a of pend) if (a.approvedVia === 'preauth' && !ran.some((r) => r.id === a.id)) ran.push({ id: a.id, title: a.title, state: a.state, text: a.state === 'running' ? '在执行' : '已批准，等执行器接手', at: null });
  const empty = !pre && !preflight.length && !waiting.length && !expired.length && !ran.length;
  return { preflight, preauth: pre, waiting, expired, ran, empty };
}
// 预授权的范围一句话（不写分支名这些工程说法）
export function preauthScope(p) {
  if (!p) return '';
  const by = PREAUTH_BY[p.by] || '提交的地方';
  return `只对这个任务${p.scope?.repo ? `（${p.scope.repo} 上这个任务自己的改动）` : ''} · ${by}${p.at && dayTime(p.at) ? ` ${dayTime(p.at)}` : ''} 提交时勾的`;
}

// ---- 执行偏好的两项新内容（hub#165，V2.md §6）：子代理模型、执行范围 ----
// 页面上的说法：不说 PR，说“草稿改动”（UI.md §0）
export const SUBAGENT_MODEL_NAME = { haiku: 'Haiku', sonnet: 'Sonnet', main: '跟随主执行模型' };
export const SCOPE_TEXT = {
  research: '只研究，不改文件（Mac 上会话只有只读工具，硬限制；Windows 上现在做不到，会先问你）',
  fix: '可以修复（改文件、交改动；合并这类要你批准）',
  pr: '可以修复，但只到草稿改动（不申请合并）',
};
// 子代理模型的名字：登记里有就用登记的名字（“Haiku 4.5”），没有就用通用叫法
export function subagentModelName(id, options) {
  if (!id) return null;
  if (id === 'main') return SUBAGENT_MODEL_NAME.main;
  const m = (options?.models || []).find((x) => x.id === id || new RegExp(`^claude\\s+${id}\\b`, 'i').test(String(x.name || '')));
  return m?.name ? String(m.name).replace(/^Claude\s+/, '') : SUBAGENT_MODEL_NAME[id] || modelLabel(id, options);
}
export function subagentModelPlanText(p, options) {
  if (!p.subagentModel) return `不适用（${p.subagentModelWhy || (p.provider === 'codex' ? 'Codex 主执行不开子代理' : '不开子代理')}）`;
  const name = p.subagentModel === 'main' ? `跟随主执行（${p.modelName ? String(p.modelName).replace(/^Claude\s+/, '') : '主执行模型'}）` : subagentModelName(p.subagentModel, options);
  return p.subagentModelAuto ? `${name}（${p.subagentModelWhy || '自动'}）` : `${name}（你指定的）`;
}

const POOL_NAME = { claude: 'Claude 的额度', codex: 'GPT 的额度', gptweb: 'GPT Web 的额度' };

// 任务页「GPT Web 协调者」那一段：它和这个任务的关系（taskView.coordinator + provenance.coordinator）。
// 读过 ≠ 现在还在看；只有写回了意见 / 施工单才算参与（账单里的“GPT Web 协调者”一行同一个口径）
export function coordinatorParticipation(t, now = Date.now()) {
  const co = t.coordinator || {};
  const pc = t.provenance?.coordinator || {};
  const opinions = Math.max(Number(co.opinions) || 0, Number(pc.opinions) || 0);
  const orders = Number(pc.orders) || 0;
  if (opinions || orders) return `参与了：${[opinions ? `写回过 ${opinions} 次意见` : null, orders ? `交过 ${orders} 份施工单` : null].filter(Boolean).join('、')}`;
  if (co.readAt && when(co.readAt, now)) return `读过这个任务 · ${when(co.readAt, now)}（现在还在不在看不可观测），还没写回意见`;
  if (co.requested) return '请求过，还没有读取记录';
  return '没有参与';
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
// 6 位确认码（hub#165 §15.1）：Mac 页面总会要它（?legacyConfirm=1）。设备：只有旧版页面（没有内置 Mac 的身份）才用得上，所以只附带、折起来；
// GPT Web 协调者的派工通道（Windows 上的工程 MCP）钉的是看板自签名里的那把，一定要这 6 位（coordinator:true 时直接显示）
export function pairCodeMessage(r) {
  if (r && r.ok) {
    const digits = /^[0-9]{6}$/.test(String(r.confirm || '')) ? `${r.confirm.slice(0, 3)} ${r.confirm.slice(3)}` : null;
    const coord = r.role === 'coordinator';
    return {
      ok: true, confirm: digits, coordinator: coord,
      text: `${r.already ? `「${r.label}」早就在 Mac 上登记过了。` : `已在 Mac 上登记：${r.label}。`}${coord ? `它是 GPT Web 协调者：只能派普通任务、取消自己派的任务。${digits ? '把下面这 6 位确认码输回派工通道那一头，它才算连好。' : ''}` : '设备上会自动显示「已连接」。'}`,
    };
  }
  const s = r?.status;
  if (s === 400) return { ok: false, text: '连接码的格式不对：设备上显示的是 12 位，像 ABCD-EFGH-JKMN。' };
  if (s === 404) return { ok: false, text: '没找到这个连接码。核对一下设备上显示的码；码在设备上出现后 30 分钟内有效。' };
  if (s === 429) return { ok: false, text: '试得太多了，等一分钟再试。' };
  if (s === 409) {
    return { ok: false, text: /不止一台/.test(String(r?.error || ''))
      ? '有不止一台设备对得上这个码，为了安全这次没有连接。在你的设备上重新开始连接。'
      : '远端通道现在还没准备好（刚启动，或者读 GitHub 出错了）。等一会儿再试。' };
  }
  return { ok: false, text: s ? '没连上：Mac 上的 Concierge 出错了（详情在 Mac 的日志里）。' : '没连上：连不上 Mac 上的 Concierge。' };
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

// 一个窗口在这台设备的钟上是什么状态（#30 C3）：
//   fresh  1 小时内观测、没过重置时间 → 给百分比和观测时间
//   stale  有观测但超过 1 小时 → 「过期 · 最后观测 mm-dd hh:mm」，点开才写当时的百分比
//   reset  过了重置时间 → 「过期」，不再给旧百分比
//   none   从来没观测到 → 「还没观测到」
// Mac 算视图时已经给了 state；设备上的看板可能是一阵之前发的，所以按 observedAt / resetsAt 和这台设备的钟再判一次
export const QUOTA_NONE = '还没观测到';
export const QUOTA_UNOBSERVABLE = '不可观测';
export function quotaWindowState(w, q = {}, now = Date.now()) {
  if (!w) return 'none';
  if (windowPassed(w, now)) return 'reset';
  if (!Number.isFinite(w.usedPct)) return 'none';
  const obs = Date.parse(w.observedAt || q?.observedAt);
  return Number.isFinite(obs) && now - obs <= STALE_QUOTA_MS ? 'fresh' : 'stale';
}
// 整个池子：unobservable 只有 GPT Web；有一个窗口新鲜就是 fresh；有过观测但都不新鲜是 stale；一次都没有是 none
export function quotaState(q, now = Date.now()) {
  if (!q || q.pool === 'gptweb' || q.state === 'unobservable') return 'unobservable';
  const ws = [q.fiveHour, q.weekly].map((w) => quotaWindowState(w, q, now)).filter((x) => x !== 'none');
  if (ws.includes('fresh')) return 'fresh';
  return ws.length || q.observedAt ? 'stale' : 'none';
}
const lastSeen = (iso) => `过期 · 最后观测 ${dayTime(iso) || '时间不知道'}`;
const leftPct = (w) => Math.max(0, Math.min(100, Math.round(100 - w.usedPct)));

export function quotaTile(q, now = Date.now()) {
  const label = q.pool === 'claude' ? 'Claude' : q.pool === 'codex' ? 'GPT' : q.pool === 'gptweb' ? 'GPT Web' : (q.label || q.pool);
  const state = quotaState(q, now);
  if (state === 'unobservable') return { label, state, main: QUOTA_UNOBSERVABLE, sub: null, stale: false, observable: false, remaining: null };
  if (state === 'none') return { label, state, main: QUOTA_NONE, sub: null, stale: false, observable: true, remaining: null };
  const short = (w) => {
    const s = quotaWindowState(w, q, now);
    return s === 'fresh' ? `剩 ${leftPct(w)}%` : s === 'none' ? QUOTA_NONE : '过期';
  };
  const main = `五小时${short(q.fiveHour)} · 每周${short(q.weekly)}`;
  const remaining = quotaWindowState(q.fiveHour, q, now) === 'fresh' ? leftPct(q.fiveHour) : null;
  const obs = q.observedAt || [q.fiveHour?.observedAt, q.weekly?.observedAt].filter(Boolean).sort().pop() || null;
  const sub = state === 'fresh' ? `${when(obs, now)} 观测` : lastSeen(obs);
  return { label, state, main, sub, stale: state === 'stale', observable: true, remaining };
}

export const ACCURACY = {
  官方只读: '命令行从官方账号读到的用量，不花推理额度，取整；只代表读到那一刻。',
  会话日志: '命令行在 Concierge 派发的会话里自己报的值，取整。只代表观测那一刻，之后别的用量（包括你自己在终端里用的）要等下一次观测才看得到。',
  主动探测: '命令行在一次很小的探测调用里自己报的值，取整。只代表观测那一刻。',
};

export function quotaDetail(q, now = Date.now()) {
  const rows = [];
  const state = quotaState(q, now);
  if (state === 'unobservable') { rows.push(['为什么', q.note || 'Concierge 拿不到这个池子的数']); return rows; }
  const win = (w, name) => {
    const s = quotaWindowState(w, q, now);
    const at = w?.observedAt || q.observedAt;
    if (s === 'none') return [name, QUOTA_NONE];
    if (s === 'reset') return [name, `${lastSeen(at)}（之后${w.resetsAt ? `在 ${when(w.resetsAt, now)} ` : ''}已重置，旧数字不再显示）`];
    const reset = w.resetsAt ? `，${when(w.resetsAt, now)} 重置` : '';
    if (s === 'stale') return [name, `${lastSeen(at)}（当时剩 ${leftPct(w)}%${reset}）`];
    return [name, `剩 ${leftPct(w)}%（${when(at, now)} 观测${reset}）`];
  };
  rows.push(win(q.fiveHour, '五小时窗口'));
  rows.push(win(q.weekly, '每周窗口'));
  if (state === 'none') {
    rows.push(['说明', q.note || '还没有观测到。等下一次后台会话或咨询，或者点「现在测一次」。']);
  } else {
    rows.push(['数据来源', q.source || '不知道']);
    rows.push(['准确度', ACCURACY[q.source] || '命令行自己报的值，只代表观测那一刻。']);
    rows.push(['观测时间', q.observedAt ? dayTime(q.observedAt) : '不知道']);
    if (state === 'stale') rows.push(['说明', q.note || '最后一次观测超过 1 小时，之后没有新的数。']);
  }
  const p = q.probe || {};
  if (p.lastAt) rows.push(['上次探测', `${when(p.lastAt, now)} · ${p.ok ? '拿到了' : `没拿到${p.error ? `：${p.error}` : ''}`}`]);
  return rows;
}

// ---- 设置 → 资源（hub#165 §14.1）：每个池子两条剩余条（5 小时 / 每周）+ 剩多少 + 几点重置 + 最近观测；来源、准确度、技术限制收进「详细」 ----
// 四态（每个窗口）：新鲜（条 + 剩 n% + 几点重置）/ 过期（条变灰，写当时剩多少）/ 过了重置时间（不显示旧百分比）/ 还没读到；
// GPT Web 整个池子「不可读取」（没有官方接口），没有条、没有「刷新额度」。设备上的看板可能是一阵之前发的：按这台设备的钟再判一次。
export const QUOTA_UNREADABLE = '不可读取';
export const POOL_TITLE = { claude: 'Claude', codex: 'Codex（GPT）', gptweb: 'GPT Web' };
// 额度从哪读（#165 第六次复核 F4）：只是查询的位置，不代表确认过登录——Concierge 没有账号登录状态这个事实
export const POOL_WHERE = { claude: 'Mac 上的 Claude 命令行', codex: 'Mac 上的 Codex 命令行', gptweb: 'ChatGPT 网页（没有官方额度接口）' };
export const QUOTA_LIMIT = {
  claude: '只读这台 Mac 上 Claude 命令行登录的那个账号；百分比是官方取整后的值；你在别处用掉的，要等下一次读取才看得到。',
  codex: '只读这台 Mac 上 Codex 命令行登录的那个账号（Codex 和 Luna 共用）；百分比是官方取整后的值；你在别处用掉的，要等下一次读取才看得到。',
  gptweb: 'ChatGPT 网页端没有官方的额度接口；Concierge 不拿你的登录信息去调内部接口，所以读不到。',
};
const leftOf = (w) => Math.max(0, Math.min(100, Math.round(100 - w.usedPct)));
export const meterClass = (left) => `w${Math.max(0, Math.min(100, Math.round(left / 5) * 5))}`;
export function quotaPool(q, now = Date.now()) {
  const pool = q?.pool || '';
  const name = POOL_TITLE[pool] || q?.label || pool;
  const where = POOL_WHERE[pool] || '';
  const state = quotaState(q, now);
  if (state === 'unobservable') return { pool, name, where, state, windows: [], obsText: null, freshText: QUOTA_UNREADABLE, badge: null, seenText: '读不到', line: `${QUOTA_UNREADABLE}：${q?.note || 'ChatGPT 网页端没有官方接口，Concierge 读不到'}`, summary: QUOTA_UNREADABLE };
  // 修订 2 的额度卡（DESIGN_SPEC §7）：一行一个窗口——标签 + 条 + 右对齐的数值（value），条下一行小字（sub：几点重置 / 过期说明）。
  // text 是两样连起来的一句（读屏、摘要用）
  const win = (w, label) => {
    const s = quotaWindowState(w, q, now);
    const at = w?.resetsAt ? when(w.resetsAt, now) : '';
    if (s === 'fresh') return { label, state: s, left: leftOf(w), value: `剩 ${leftOf(w)}%`, sub: at ? `重置 ${at}` : '重置时间不知道', text: `剩 ${leftOf(w)}%${at ? ` · ${at} 重置` : ''}` };
    if (s === 'stale') return { label, state: s, left: leftOf(w), value: `剩 ${leftOf(w)}%`, sub: `过期 · 这是当时读到的${at ? ` · 重置 ${at}` : ''}`, text: `过期 · 当时剩 ${leftOf(w)}%${at ? ` · ${at} 重置` : ''}` };
    if (s === 'reset') return { label, state: s, left: null, value: '已重置', sub: QUOTA_RESET_PASSED, text: QUOTA_RESET_PASSED };
    return { label, state: 'none', left: null, value: '未读取', sub: '还没读到', text: '还没读到' };
  };
  const windows = [win(q.fiveHour, '5 小时'), win(q.weekly, '每周')];
  const obs = [q.fiveHour?.observedAt, q.weekly?.observedAt, q.observedAt].filter(Boolean).sort().pop() || null;
  const obsText = state === 'none' || !obs ? '还没读到过' : `最近观测 ${when(obs, now)} · ${state === 'fresh' ? '新鲜' : '过期'}`;
  // 卡片右上角的一句新鲜度
  const freshText = state === 'none' || !obs ? '还没读到过' : state === 'fresh' ? `新鲜 · ${when(obs, now)} 读取` : `最后读取 ${when(obs, now)}，已过期`;
  // 账号徽章：只写能确定的——从哪读（Mac 命令行），套餐名看板里有才写（读不到不编）
  const badge = ['claude', 'codex'].includes(pool) ? `Mac 命令行${q?.plan ? ` · ${String(q.plan).slice(0, 20)}` : ''}` : null;
  // 读到过没有（AI 账号页一句话）：有观测写“读到过（最近 hh:mm）”，没有写“还没读到过”；不说登录了没有
  const seenText = state === 'none' || !obs ? '还没读到过' : `读到过（最近 ${when(obs, now)}）`;
  const summary = windows.map((x) => `${x.label}${x.state === 'fresh' ? x.value : x.state === 'stale' ? '过期' : x.state === 'reset' ? '已过重置时间' : '还没读到'}`).join(' · ');
  return { pool, name, where, state, windows, obsText, freshText, badge, seenText, line: null, summary };
}
// 「详细」折叠里的几行：来源、准确度、技术限制、上次读取结果
export function quotaMore(q, now = Date.now()) {
  const pool = q?.pool || '';
  const rows = [];
  if (quotaState(q, now) === 'unobservable') {
    rows.push(['为什么', q?.note || 'Concierge 拿不到这个池子的数']);
    rows.push(['技术限制', QUOTA_LIMIT.gptweb]);
    return rows;
  }
  const src = q?.source || null;
  rows.push(['来源', src === '官方只读' ? '官方只读（命令行从官方账号读，不花推理额度）' : src === '会话日志' ? '会话日志（Concierge 派发的会话结束时顺带记下的）' : src === '主动探测' ? '旧的探测记录（以前的一次很小的调用，已经不用）' : '还没有']);
  rows.push(['准确度', ACCURACY[src] || '命令行自己报的值，只代表观测那一刻。']);
  rows.push(['技术限制', QUOTA_LIMIT[pool] || '只读这台 Mac 上命令行登录的账号；只代表读到那一刻。']);
  const p = q?.probe || {};
  rows.push(['上次读取', p.lastAt ? `${when(p.lastAt, now)} · ${p.ok ? '读到了' : `没读到${p.error ? `：${p.error}` : ''}`}` : '还没读过']);
  return rows;
}

// ---- 设置 → 设备（hub#165 §14.2）：身份按“入口”一条一条算；同一台手机的几个入口按名字猜成一组，只做展示，信任仍按每一把钥匙 ----
export function deviceEntry(d) {
  const label = String(d?.label || '');
  if (d?.role === 'coordinator') return { kind: 'coordinator', text: 'GPT Chat 派工通道' };
  if (/主屏幕/.test(label)) return { kind: 'ios-app', text: '主屏幕 App' };
  if (/iPhone|iPad/i.test(label)) return { kind: 'ios-safari', text: 'Safari' };
  if (/Windows|\bPC\b|笔记本/i.test(label)) return { kind: 'windows', text: 'Windows 浏览器' };
  return { kind: 'browser', text: '浏览器' };
}
export const deviceGroupName = (label) => String(label || '设备').replace(/[\s（(]*(主屏幕(\s*App)?|Safari)[）)]?\s*$/i, '').trim() || String(label || '设备');
// 人用的身份分组（协调者不在这里）：[{ name, items }]，保持原来的顺序
export function groupDevices(list) {
  const groups = [];
  for (const d of list || []) {
    if (!d || d.role === 'coordinator') continue;
    const name = deviceGroupName(d.label);
    let g = groups.find((x) => x.name === name);
    if (!g) { g = { name, items: [] }; groups.push(g); }
    g.items.push(d);
  }
  return groups;
}

// ---- 手机的设置首页（设计修订 2）：每行右侧一句摘要，全从看板 / 设备列表的真实字段来；拿不到的写“不知道”，不编 ----
const POOL_SHORT = { claude: 'Claude', codex: 'GPT' };
export function settingsSummary(tab, { board = null, devices = null, local = false, me = null, build = null, now = Date.now() } = {}) {
  const b = board || {};
  const devs = (local ? devices : b.devices) || [];
  const humans = devs.filter((x) => x && x.role !== 'coordinator');
  const receivers = Array.isArray(b.receivers) ? b.receivers : [];
  if (tab === 'quota') {
    const parts = (Array.isArray(b.quota) ? b.quota : []).filter((q) => POOL_SHORT[q?.pool]).map((q) => {
      const v = quotaPool(q, now);
      const five = v.windows[0];
      if (v.state === 'none') return `${POOL_SHORT[q.pool]} 还没读到`;
      if (five?.state === 'fresh') return `${POOL_SHORT[q.pool]} 5 小时${five.value}`;
      return `${POOL_SHORT[q.pool]} ${v.state === 'stale' ? '过期' : '已过重置时间'}`;
    });
    return parts.join(' · ') || '还没有额度信息';
  }
  if (tab === 'accounts') {
    const n = (Array.isArray(b.quota) ? b.quota : []).length;
    const m = (b.options?.models || []).length;
    return `${n} 个账号 · ${m} 个模型`;
  }
  if (tab === 'devices') return `${1 + humans.length + receivers.length} 台`;
  if (tab === 'permissions') {
    const on = humans.some((x) => x.passkey === 'active' || x.passkey?.state === 'active');
    return on ? '手机批准已开' : '手机批准没开';
  }
  if (tab === 'notify') {
    const x = local ? (b.notify?.mac ? { state: b.notify.mac.on ? 'on' : 'off', at: b.notify.mac.at } : null) : (b.devices || []).find((d) => d && d.id === me)?.notify || null;
    if (!x) return '没开';
    const st = notifyStateText(x);
    return x.state === 'on' && x.at ? `${st} · 最近 ${when(x.at, now)}` : st;
  }
  if (tab === 'about') {
    const c = build?.commit && build.commit !== 'source' ? String(build.commit).slice(0, 7) : commitOf(b.mac?.version)?.slice(0, 7);
    return c ? `版本 ${c}` : b.mac?.version ? `版本 ${String(b.mac.version).slice(0, 30)}` : '版本不知道';
  }
  return '';
}

// 在 GitHub 上撤销 App 的授权（Revoke / Revoke all）是整个 App 一起撤：所有用它连接的设备一起断开（#172）
export const REVOKE_ALL = '这会让所有用 GitHub App 连接的设备一起断开，之后要在 Mac 上重新「添加设备」';
// ---- 移除设备之后 GitHub 授权的提示（hub#165 §15.1 A′，终审 P2-F）：Mac 撤不了（入口重启过，手里没有令牌）→ 请她到 GitHub 设置里撤；
// 这次没撤掉、Mac 在自动重试 → 说一声，一直撤不掉再去 GitHub 设置。撤掉了 / 不是 GitHub App 令牌的设备：null ----
// retrying / exhausted 不在这里说：Mac 把它记成待办（GET /api/devices.ghRevokes），设备列表上面一直提示，见 ghRevokeRow
export function ghRevokeNote(ghToken, label = '') {
  const who = label ? `「${label}」已移除。` : '设备已移除。';
  if (ghToken === 'unknown') return `${who}这台设备的 GitHub 授权没法由 Mac 撤销，请到 GitHub → Settings → Applications 里撤销 Concierge 的授权（${REVOKE_ALL}）。`;
  return null;
}
// 撤销待办一行（第十轮复核 F）：retrying（Mac 到点自动再试）/ exhausted（5 次都没成功，不再自动试）/ lost（入口重启过，令牌没了，只剩提示）。
// 返回 { text, canRetry }
export function ghRevokeRow(p, { now = Date.now() } = {}) {
  const who = p?.label ? `「${p.label}」` : '一台已移除的设备';
  const go = `请到 GitHub → Settings → Applications 里撤销 Concierge 的授权（${REVOKE_ALL}）`;
  if (p?.state === 'retrying') {
    const next = p.nextAt ? Date.parse(p.nextAt) : NaN;
    const inMin = Number.isFinite(next) ? Math.max(1, Math.round((next - now) / 60000)) : null;
    return { text: `${who}的 GitHub 授权还没撤掉（已试 ${p.tries || 1} 次），Mac ${inMin ? `约 ${inMin} 分钟后` : '稍后'}自动再试；一直撤不掉的话，${go}。`, canRetry: true };
  }
  if (p?.state === 'exhausted') return { text: `${who}的 GitHub 授权试了 ${p.tries || 5} 次都没撤掉，Mac 不再自动试：${go}，或者点「再试一次」。`, canRetry: true };
  return { text: `${who}的 GitHub 授权没撤掉，Concierge 重启过、Mac 手里已经没有它的令牌：${go}，撤完点「知道了」。`, canRetry: false };
}

// ---- 弹层引用块的署名（设计修订 2）：「<谁> · <几点> 的原话」。谁 = 决定记录写的执行者，几点 = 决定的时间 ----
// 执行者是工程写法（“Claude Code (opus)”）：括号里的模型照登记的名字写；读不出来就原样写。时间读不出来就不写时间
export function quoteBy(d, { options = null, now = Date.now() } = {}) {
  const ex = String(d?.executor || '').trim();
  const m = ex.match(/\(([^)]{1,60})\)\s*$/);
  const model = m ? m[1] : null;
  const who = model ? ((options?.models || []).find((x) => x.id === model)?.name || model) : ex || '工程师';
  const raw = String(d?.at || '');
  const iso = /^\d{4}-\d\d-\d\d \d/.test(raw) ? raw.replace(' ', 'T') : raw;
  const t = Number.isFinite(Date.parse(iso)) ? when(iso, now) : '';
  return `${who}${t ? ` · ${t}` : ''} 的原话`;
}

// 设备身份的徽章（设计修订 2）：主屏幕 App / Safari / Windows 浏览器 / 浏览器；同一台手机已经有主屏幕 App 的，Safari 那个标「旧身份」
export function staleSafari(list) {
  const groups = groupDevices(list);
  const out = new Set();
  for (const g of groups) {
    if (!g.items.some((x) => deviceEntry(x).kind === 'ios-app')) continue;
    for (const x of g.items) if (deviceEntry(x).kind === 'ios-safari') out.add(x.id);
  }
  return out;
}

// ---- 设置 → 关于：工程师的授权范围（docs/LIFECYCLE.md §13 的产品版，同一个口径；只去掉多余的请示，不扩大权限） ----
// 登记动作的名字（登记清单里写的）：页面上不出现工程说法，“PR”写成“改动”
export const actionTitle = (a) => String(a?.title || a?.runbook || a?.id || '一个动作').replace(/\s*\bPR\b\s*/g, '改动');
export const AUTHORITY_DO = [
  '看：任务、改动记录、规范和状态页、按范围的 Windows 诊断目录',
  '查：复现、定位、联网查资料、登记过的只读检查',
  '改：在这个任务自己的工作副本里改代码、文档、测试，装依赖、构建、跑测试、在 Xcode 里构建（不装机）',
  '交：提交、推这个任务自己的改动、开或更新草稿改动',
  '协作：方案允许次数内的咨询、上限内的子代理、写进展',
  '判断：重试、换办法、可以撤回的实现细节（写进汇报）',
  '收尾：如实写没做到的；卡住了就交接，不硬编结论',
  '申请（不执行）登记动作：比如合并、装机，等你批准',
];
export const AUTHORITY_ASK = [
  '敏感操作：生产部署或重启（包括 Concierge 和 Windows 服务）、改真实用户的数据、迁移 / 删除 / 覆盖、换凭据、改写历史、难撤回的生产操作、改变你批过的产品语义或架构',
  '登记动作的批准：合并、装机这类，你批准后受限执行器只执行一次',
  '授权开关：允许小动工、连接设备或协调者、开手机批准、放行只能在 Mac 上处理的来件',
  '产品取舍：你原话没覆盖的用户可见选择、接受结论还是改要求、你手选的和现场冲突',
  '只有你本人能做的事：会写清楚做什么、为什么、做完应该看到什么',
];
export const AUTHORITY_NOT_ASK = '审改动、合并、装机、贴回执、通知别的工程师、重试还是放弃、选哪个库或方案、要不要第二个模型或子代理——这些不会来问你。合并和装机是“申请登记动作”，要你批准了才执行。';

// ---- 路由：#/t/<repo>/<号>、#/settings ----

// 设置六页（hub#165 设计修订 2，DESIGN_SPEC §7）：[键, 名字, 分组]。分组：资源（额度 / 账号与模型）、设备（设备 / 权限 / 通知）、其他（关于）
export const SETTINGS_TABS = [['quota', '额度', '资源'], ['accounts', '账号与模型', '资源'], ['devices', '设备', '设备'], ['permissions', '权限', '设备'], ['notify', '通知', '设备'], ['about', '关于', '其他']];
export const SETTINGS_GROUPS = ['资源', '设备', '其他'];
// 旧地址（四页时代）：#/settings/resources 是现在的「额度」
const SETTINGS_OLD = { resources: 'quota' };
export const settingsHash = (tab) => (SETTINGS_TABS.some(([k]) => k === tab) ? `#/settings/${tab}` : '#/settings');
export function hashOfTask(ref) {
  const m = String(ref).match(/^([A-Za-z0-9][A-Za-z0-9_.-]{0,99})#([1-9][0-9]{0,8})$/);
  return m ? `#/t/${m[1]}/${m[2]}` : '#';
}
export function routeOf(hash) {
  const s = String(hash || '').replace(/^#/, '');
  const t = s.match(/^\/t\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([1-9][0-9]{0,8})$/);
  if (t) return { name: 'task', ref: `${t[1]}#${t[2]}` };
  if (s === '/settings') return { name: 'settings' };
  // 设置的六页（设计修订 2）：#/settings/quota | accounts | devices | permissions | notify | about；旧的 resources 认成 quota；不认识的当成设置首页
  const st = s.match(/^\/settings\/([a-z]{1,20})$/);
  if (st) { const k = SETTINGS_OLD[st[1]] || st[1]; return SETTINGS_TABS.some(([x]) => x === k) ? { name: 'settings', tab: k } : { name: 'settings' }; }
  // 首页的搜索和筛选（hub#165 §3）：#/?q=…&f=…&s=…&o=…，刷新保持；不认识的值不算
  const f = s.match(/^\/\?(.{1,600})$/);
  const filter = f ? parseFilter(f[1]) : null;
  return filter ? { name: 'home', filter } : { name: 'home' };
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

// ---- 设置 → 关于：页面、Mac 入口、Windows 接收器各是哪个版本 ----
// build：web/build.mjs 的 BUILD（发布时改写成提交号；源码里是 'source'）。Mac 的版本是“包版本 · 短提交号”
export const commitOf = (version) => (String(version || '').split(/\s*·\s*/).reverse().find((x) => /^[0-9a-f]{7,40}$/i.test(x)) || null);
export function versionRows(board, build, { local = false } = {}) {
  const b = board || {};
  const commit = build?.commit && build.commit !== 'source' ? String(build.commit) : null;
  const rows = [['页面版本', commit ? `${commit.slice(0, 7)}${build.builtAt && dayTime(build.builtAt) ? `（${dayTime(build.builtAt)} 发布）` : ''}` : local ? '本机（和 Mac 上的 Concierge 同一份代码）' : '源码（没有经过发布）']];
  rows.push(['Mac 上的 Concierge 版本', b.mac?.version || '不知道']);
  const rs = Array.isArray(b.receivers) ? b.receivers : [];
  if (rs.length) rows.push(['Windows 接收器版本', rs.map((r) => r.version || '不知道').join('，')]);
  const mac = commitOf(b.mac?.version);
  const a = commit ? commit.toLowerCase() : null; const m = mac ? mac.toLowerCase() : null;
  const mismatch = !!(a && m && !a.startsWith(m) && !m.startsWith(a));
  return { rows, note: mismatch ? `这个页面（${a.slice(0, 7)}）和 Mac 上的 Concierge（${m.slice(0, 7)}）不是同一份代码，有些新功能可能对不上。` : null };
}

// ---- 通知（hub#152，docs/NOTIFY.md）----
// 看板里只有类别和时间（没有订阅地址、出错原文）：这里翻成人话
export const NOTIFY_RESULT_TEXT = { ok: '送到了', gone: '推送服务说这条订阅失效了', rejected: '推送服务不收', error: '没送到（会自动再试）' };
// 这台设备在 Mac 上的订阅状态（board.devices[].notify.state）
export function notifyStateText(x) {
  if (x?.state === 'on') return '已开';
  if (x?.state === 'gone') return '失效了（要重新开一次）';
  return '没开';
}
// 最近一次送达：时间 + 结果类别
export function notifyLastText(x) {
  if (!x?.at) return '还没送过';
  return `${dayTime(x.at)} ${NOTIFY_RESULT_TEXT[x.result] || '结果不明'}`;
}
// 这个浏览器的通知权限（Notification.permission）
export function notifyPermissionText(p) {
  if (p === 'granted') return '允许通知';
  if (p === 'denied') return '拒绝了通知（要到系统设置里打开）';
  return '还没问过';
}
// 订阅里的钥匙：浏览器给的是 base64url，个别浏览器带填充或用标准 base64，统一成不带填充的 base64url
export const b64urlOf = (s) => String(s || '').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ======================================================================================
// V2 统一工作台（hub#165，docs/V2.md）：核心状态标签、责任一行、待办提醒、搜索与筛选、协作记录、验收、补充
// 都只按视图里的字段写；旧视图（没有 core / acceptance / amendments）照常工作
// ======================================================================================

// 列表右侧和状态卡上的核心状态标签（V2.md §4）
export const CORE_LABEL = { needs_you: '要你', working: '进行中', waiting: '等待', idle: '没人在做', done: '完成' };
export function coreLabel(t) {
  const c = coreState(t);
  if (c === 'ended') return t?.state === 'cancelled' && !endedUnmet(t) ? '已取消' : '结束 · 没做到';
  return CORE_LABEL[c] || '没人在做';
}

// 子代理模型选「自动」时的说明（C12）：她指定了主执行模型就跟随它；主模型也是自动时按任务难度省额度
export const SUBAGENT_AUTO_NOTE = '你指定了主执行模型就跟随它；主模型也是自动时，普通任务用 Haiku、复杂任务用 Sonnet（分诊定）';
export const subagentAutoText = (prefs) => (prefs?.model ? '跟随你指定的主执行模型' : '普通任务用 Haiku，复杂任务用 Sonnet');
// 只研究在 Windows 上做不到的决定卡标题（审查 P1-1）
// needs=none 卡的「我改一下要求」（hub#165 §14.4-7）：和 lib/pipeline.mjs 的 LIFE_NONE_AMEND 一字不差（有测试盯着）；选它要写一句怎么改
export const LIFE_NONE_AMEND = '我改一下要求';
export const SCOPE_CONFLICT_TITLE = '你要的“只研究”在 Windows 上现在做不到';
// 交给 Windows 的任务验收不通过时的可执行说法（视图 reopenOnWindows，审查 P1-2）
export const WINDOWS_ACCEPT_NO = '这件事在 Windows 上做，验收不通过要在 Mac 上到工程窗口说“接管”';
// 验收（V2.md §8.2）：列表第二行的短说法、结果卡上的一行
export function acceptShort(t) {
  const a = t?.acceptance;
  if (!a) return '还没验收';
  return a.ok ? '你验收通过' : '你验收不通过';
}
export function acceptLine(t, now = Date.now()) {
  const a = t?.acceptance;
  if (!a) return null;
  if (a.ok) return `你验收通过${when(a.at, now) ? ` · ${when(a.at, now)}` : ''}`;
  return '你验收不通过 · 已重新开一轮';
}

// 验收之后发现问题（V2 验收反馈，Zoe 10-21）：两条路怎么选的那句，和开后续任务时写进「额外要求」的关联说明
export const FOLLOW_HINT = '原来的问题没解决或又出现了：点「原来的问题，接着改」，在这个任务里接着改。是另一个新问题：点「新问题，开后续任务」，它会关联到这个任务，这里的验收、改动和上线记录都不动。截图：接着改的话，开始之后在「补一句 / 追加截图」里加；后续任务在提交框里加。';
export function followUpExtra(t, home = null) {
  const name = taskName(t, { home, max: 40 });
  return `这是「${name}」之后发现的新问题。原任务的验收、改动和上线记录保留不动；这是关联它的后续任务，相关任务写 ${t?.ref || '原任务'}。`;
}

// 会话没起来（反例 1，hub#156）：暂停原因里“没能启动：”后面那一段
export function launchReason(t) {
  if (t?.life?.engineer !== 'launch') return null;
  const st = String(t.stateText || '');
  const m = st.match(/没能启动[：:]\s*([^。]+)/);
  return `会话没起来：${clip(m ? m[1] : blockedReason(t), 100)}`;
}

// 没人在做的原因码（责任一行括号里那几个字）
function idleCode(t) {
  if (t?.state === 'needs_zoe' && t.decision?.misfiled) return '工程待接手 · 旧卡';
  if (t?.life?.engineer === 'launch') return '会话没起来';
  if (needKind(t) === 'paused') return '停着，点“继续”才会接着做';
  return '工程待接手';
}

// 状态卡的责任一行（V2.md §4）：working 写执行者；needs_you 写「要你」；waiting 写在等谁；idle 写「没人在做」+ 原因码；done / ended 写谁做的
export function ownerLine(t, options) {
  const c = coreState(t);
  if (c === 'needs_you') return '现在：要你';
  if (c === 'working') return `现在：${executorText(t, options)}`;
  if (c === 'waiting') {
    const k = needKind(t);
    if (k === 'awaiting_quota') return '现在：在等额度或条件恢复';
    const w = windowsRun(t);
    if (w?.kind === 'stale' || (t.state === 'paused' && /没有心跳/.test(t.stateText || ''))) return '现在：在等 Windows 那边恢复心跳';
    return `现在：${clip(waitingFor(t).replace(/（.*$/, ''), 60)}`;
  }
  if (c === 'idle') return `现在：没人在做（${idleCode(t)}）`;
  const last = (t.provenance?.main || []).at(-1);
  return `谁做的：${last ? [modelLabel(last.model, options), last.machine].filter(Boolean).join(' · ') : '没有执行记录'}`;
}

// 首页顶上的待办提醒条（V2.md §3 第 2 块）：只数要她本人做的（needsOwner），每件一行「#N · 短名 · 要你做什么」
export function todoLine(t, home = null) {
  const k = needKind(t);
  const d = t.decision || {};
  let what;
  if (k === 'owner_approval') what = d.handler === 'action' ? `批准或拒绝「${clip(d.action?.title || '一个动作', 30)}」` : '批准或拒绝一个敏感操作（只能在 Mac 上批）';
  else if (k === 'owner_physical_action') what = d.what ? clip(d.what, 40) : '做一件事，做完写一句结果';
  else what = /Mac 上点/.test(t.stateText || '') ? '在 Mac 上点“让后台继续”' : '选一个';
  return `${taskName(t, { home })} · ${what}`;
}

// ---- 搜索与筛选（V2.md §3 第 4 块）：纯前端，不发请求；状态记在地址 #/?q=…&f=…&s=…&o=… 里 ----
// 设计稿（hub#165 设计整合）：全部 / 需要你 / 正在执行 / 等条件 · 没人在做 / 已交付 / 没做到。
// 「等条件 · 没人在做」= 分组 waiting + idle；「没做到」= unmet + 已取消 / 已结束。地址里老的 f=idle、f=cancelled 照旧认（只是不再有自己的筛选片）
export const FILTER_GROUPS = [['all', '全部'], ['needs', '需要你'], ['working', '正在执行'], ['waiting', '等条件 · 没人在做'], ['done', '已交付'], ['unmet', '没做到']];
const FILTER_ALIASES = { idle: ['idle'], cancelled: ['cancelled'] };
const FILTER_MEMBERS = { waiting: ['waiting', 'idle'], unmet: ['unmet', 'cancelled'] };
export const filterGroupHas = (group, key) => (FILTER_MEMBERS[group] || FILTER_ALIASES[group] || [group]).includes(key);
export const FILTER_SITES = [['mac', 'Mac'], ['windows', 'Windows']];
export const FILTER_SOURCES = [['mine', '我提交的'], ['coordinator', '协调者派的']];
const keysOf = (pairs) => pairs.map(([k]) => k);
// 地址里的筛选：只认名单里的值；全空就是 null（没有筛选）
export function parseFilter(qs) {
  let p;
  try { p = new URLSearchParams(String(qs || '')); } catch { return null; }
  const out = {};
  const q = String(p.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, 100);
  if (q) out.q = q;
  if ([...keysOf(FILTER_GROUPS), ...Object.keys(FILTER_ALIASES)].includes(p.get('f')) && p.get('f') !== 'all') out.f = p.get('f');
  if (keysOf(FILTER_SITES).includes(p.get('s'))) out.s = p.get('s');
  if (keysOf(FILTER_SOURCES).includes(p.get('o'))) out.o = p.get('o');
  return Object.keys(out).length ? out : null;
}
export function homeHash(filter) {
  const f = filter || {};
  const p = new URLSearchParams();
  if (f.q) p.set('q', f.q);
  if (f.f && f.f !== 'all') p.set('f', f.f);
  if (f.s) p.set('s', f.s);
  if (f.o) p.set('o', f.o);
  const s = p.toString();
  return s ? `#/?${s}` : '#/';
}
// 这个任务在哪台机器上做：方案 / 交给 Windows / 正在做的机器 / 最后一次主执行；都不知道是 null（不进 Mac / Windows 筛选）
export function taskSite(t) {
  const m = t?.plan?.machine || t?.execution?.machine || (windowsRun(t) ? 'Windows' : null) || t?.now?.machine || (t?.provenance?.main || []).at(-1)?.machine || null;
  return m === 'Windows' ? 'windows' : m === 'Mac' ? 'mac' : null;
}
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
// list：已经排好序的任务；filter：{ q, f（分组）, s（mac / windows）, o（mine / coordinator）}，也收 { group, site, source }
export function filterTasks(list, filter = {}, { home = null } = {}) {
  const q = norm(filter.q);
  const group = filter.f || filter.group || 'all';
  const site = filter.s || filter.site || null;
  const source = filter.o || filter.source || null;
  const num = q.match(/^#?(\d{1,9})$/);
  return (list || []).filter((t) => {
    if (!t) return false;
    if (group !== 'all' && !filterGroupHas(group, taskGroupKey(t))) return false;
    if (site && taskSite(t) !== site) return false;
    const via = t.source?.via || null;
    if (source === 'coordinator' && via !== 'coordinator') return false;
    if (source === 'mine' && !['mac-page', 'device', 'github-form'].includes(via)) return false;
    if (q) {
      if (num && String(t.ref || '').endsWith(`#${num[1]}`)) return true;
      const hay = norm([taskName(t, { home, max: 400 }), t.ref, t.title, t.want, t.extra].filter(Boolean).join('\n'));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
export const filterActive = (f) => !!(f && (f.q || (f.f && f.f !== 'all') || f.s || f.o));

// ---- 协作记录「谁参与了」（V2.md §7）：一行一个角色，没有的写「没有」，永不把 A 写成 B ----
export const RESIDENT_NONE = '没有居民参与（木木 / 小狐狸本人接单还没有接入）';
const ROLE_TEXT = { submit: '提交', answer: '回答', approve: '批准', amend: '补充', accept: '验收' };
const sumN = (xs) => (xs || []).reduce((a, x) => a + (Number(x?.n) || 0), 0);

function executorLine(m, plan, options) {
  const model = modelLabel(m.model, options) || '模型没有记录';
  const who = `${m.machine ? `${m.machine} 上的 ` : ''}${EXECUTOR[m.executor] || m.executor || '后台'}`;
  let line = [who, model, effortActualText(m), `${m.sessions || 0} 次会话${m.unknown ? `（其中 ${m.unknown} 次结果不明）` : ''}`].filter(Boolean).join(' · ');
  if (m.modelFrom === '要求') line += '（模型是要求的，日志里没核对到）';
  if (m.modelCheck === 'mismatch' && plan?.model) line += `（要的是 ${modelLabel(plan.model, options)}，实际是 ${model}）`;
  return line;
}
function coordinatorRole(t, options) {
  const p = t.provenance || {};
  const plan = t.plan || null;
  const dispatched = t.source?.via === 'coordinator';
  const co = p.coordinator || {};
  const consulted = (Number(co.opinions) || 0) + (Number(co.orders) || 0) > 0 || (p.consults || []).some((c) => c.target === 'gptweb' && Number(c.n) > 0);
  const planned = !!(plan?.consult && (plan.consult.async || plan.consult.target === 'gptweb'));
  if (!dispatched && !consulted && !planned && !p.gptWeb) return '没有';
  let cons = `咨询 ${consulted || p.gptWeb ? '✓' : '✗'}`;
  if (consulted) {
    const bits = [co.opinions ? `写回过 ${co.opinions} 次意见` : null, co.orders ? `交过 ${co.orders} 份施工单` : null].filter(Boolean).join('、');
    const self = Array.isArray(co.selfReported) && co.selfReported.length ? `模型自报：${co.selfReported.join('、')}，自报` : null;
    const inner = [bits, self].filter(Boolean).join('；');
    if (inner) cons += `（${inner}）`;
  } else if (!p.gptWeb) {
    const st = coordinatorStatus((options?.consult || []).find((x) => x.async));
    cons += st.connected ? (planned ? '（请求过，还没写回意见）' : '') : `（${st.text.replace(/^还没接通：/, '')}）`;
  }
  return `GPT Web 协调者：派工 ${dispatched ? '✓' : '✗'} · ${cons}`;
}
function subagentRole(t, options) {
  const p = t.provenance || {};
  const plan = t.plan || null;
  const subs = p.subagents || [];
  const used = sumN(subs);
  const reqId = subs.find((x) => x.requested)?.requested || null;
  const req = reqId ? subagentModelName(reqId, options) : plan?.subagentModel ? subagentModelName(plan.subagentModel, options) : null;
  if (!used) {
    if (plan && plan.maxSubagents === 0) return '没有（这次不开子代理）';
    if (plan && plan.maxSubagents > 0) return `还没有（计划最多 ${plan.maxSubagents} 个${req ? ` · 要求 ${req}` : ''}）`;
    return '没有';
  }
  const actual = [...new Set(subs.map((x) => x.model).filter(Boolean))].map((m) => modelLabel(m, options));
  const parts = [`${used} 个`, req ? `要求 ${req}` : null, actual.length ? `实际 ${actual.join('、')}（日志）` : '实际模型日志无法核对'];
  let line = parts.filter(Boolean).join(' · ');
  if (plan && Number.isInteger(plan.maxSubagents)) {
    if (plan.maxSubagents === 0) line += '（计划不开，硬限制）';
    else if (used > plan.maxSubagents) line += `（计划最多 ${plan.maxSubagents} 个）`;
  }
  return line;
}
function consultRole(t) {
  const cs = t.provenance?.consults || [];
  if (cs.length) {
    return cs.map((c) => {
      const bits = [`${c.label || c.target} × ${c.n || 0}`];
      if (c.failed) bits.push(`其中 ${c.failed} 次失败`);
      if (c.selfReported) bits.push(c.model ? `模型自报：${c.model}` : '模型没有自报');
      else if (c.checked) bits.push(`实际 ${c.model || '?'}${c.effort ? ` · ${c.effort}` : ''}（已从会话记录核对）`);
      else if (c.model) bits.push(`${c.model}${c.effort ? ` · ${c.effort}` : ''}（没核对到）`);
      return bits.join(' · ');
    }).join('；');
  }
  const pc = t.plan?.consult;
  if (pc) return `还没有（计划：${consultName(pc)}${pc.async ? '' : ` · 最多 ${pc.max} 次`}）`;
  return '没有';
}
function reviewerRole(t, options) {
  const rs = t.provenance?.reviewers || [];
  if (!rs.length) return '没有';
  const named = (r) => { const m = r.model ? modelLabel(r.model, options) : null; const l = String(r.label || r.target || ''); return m && !l.toLowerCase().includes(String(m).toLowerCase()) && !l.toLowerCase().includes(String(r.model).toLowerCase()) ? `${l} · ${m}` : l; };
  return `第二模型审查：${rs.map((r) => `${named(r)} × ${r.n || 1}`).join('；')}`;
}
function smallWorkRole(t, options) {
  const sw = t.provenance?.smallWork || [];
  const plan = t.plan || null;
  if (sw.length) return sw.map((x) => [`${executorName(x.executor)} × ${x.n}`, x.model ? modelLabel(x.model, options) : '模型没有记录', x.effort, x.state ? SW_STATE[x.state] || x.state : null].filter(Boolean).join(' · ')).join('，');
  if (plan?.smallWork) return '允许，还没有';
  if (plan?.smallWorkLegacy) return '旧版本开的，现在不算数（要用的话重新开一次）';
  return '没有';
}
function actionRole(t) {
  const a = t.action;
  if (!a) return '没有';
  const via = a.approvedVia === 'device' ? '你在手机上批准的' : a.approvedVia === 'page' ? '你在 Mac 上批准的' : a.state === 'pending' ? '等你批准' : null;
  return [a.site === 'windows' ? 'Windows' : 'Mac', `「${a.title || a.runbook}」`, via, a.stateText || a.state].filter(Boolean).join(' · ');
}
function devicesRole(t) {
  const ds = t.provenance?.devices || [];
  if (!ds.length) return t.provenance && 'devices' in t.provenance ? '没有记录' : '不可观测（Mac 上的 Concierge 还没升级）';
  return ds.map((d) => `${d.label}（${(d.roles || []).map((r) => ROLE_TEXT[r] || r).join('、') || '出现过'}）`).join(' · ');
}
export function collaborationRows(t, options) {
  const p = t.provenance || {};
  const plan = t.plan || null;
  const s = t.source || {};
  const rows = [];
  let src = s.via === 'legacy' || !s.via ? '没有记录' : sourceText(s);
  if (s.via === 'device' && s.verified === true && !s.editedAfterSign) src += '（设备签名验过）';
  rows.push(['来源', src]);
  rows.push(['协调者', coordinatorRole(t, options)]);
  const main = p.main || [];
  if (!main.length) rows.push(['执行者', plan?.modelName ? `还没开始（计划：${String(plan.modelName).replace(/^Claude\s+/, '')}${plan.effort ? ` · ${plan.effort}` : ''}）` : '还没开始']);
  else for (const m of main) rows.push(['执行者', executorLine(m, plan, options)]);
  rows.push(['子代理', subagentRole(t, options)]);
  rows.push(['咨询者', consultRole(t)]);
  rows.push(['审查者', reviewerRole(t, options)]);
  rows.push(['小动工', smallWorkRole(t, options)]);
  for (const o of Array.isArray(t.smallWork) ? t.smallWork : []) rows.push([`施工单 ${o.k}`, smallWorkLine(o)]);
  rows.push(['受限执行器', actionRole(t)]);
  rows.push(['设备', devicesRole(t)]);
  rows.push(['居民', RESIDENT_NONE]);
  return rows;
}

// ---- 两台设备答同一张卡（反例 6）：她这一次的回答没成功，而视图里有另一条可信回答 ----
// 只在这几样都对上时写：最近那条回答答的就是她这次点的那张卡（指纹一致）；回执是“卡片不一致”（远端），或者本机回了 409
// （这个任务已经不在等决定了）；最近一条回答在她点之前 30 分钟以内或之后。别的失败（网络、页面太旧、别的卡）照常显示原因
export const ANSWER_ECHO_MS = 30 * 60000;
export function answerEcho(t, act, { local = false } = {}) {
  const la = t?.lastAnswer;
  if (!la || !act || act.kind !== 'answer' || act.state !== 'failed') return null;
  if (!la.decisionFp || !act.fp || la.decisionFp !== act.fp) return null;
  if (!(local ? act.status === 409 : act.cardMismatch === true)) return null;
  const at = Date.parse(la.at);
  if (!Number.isFinite(at) || !Number.isFinite(act.at) || at < act.at - ANSWER_ECHO_MS) return null;
  const where = la.via === 'device' ? (la.device || '另一台设备') : 'Mac';
  return `这个决定已经在「${where}」上回答过了（${when(la.at)}${la.choice ? `，选了「${clip(la.choice, 40)}」` : ''}）`;
}

// ---- 补充记录（V2.md §8.1）：一条一行 ----
const KB = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
export const bytesText = (n) => (Number.isFinite(n) && n > 0 ? KB(n) : '大小不明');
export const AMEND_WINDOWS_NOTE = 'Windows 那边的会话从任务记录里读到这条';
// 提交时带的附件（视图 attachments）和没传到 Mac 的个数（attachmentsMissing，审查 P1-3）：任务页「原话和额外要求」里列出
const fileText = (x) => `${x.kind === 'image' ? '图片' : '文本'}「${x.name}」 · ${bytesText(x.bytes)}`;
export function submitAttachLines(t) {
  const out = (Array.isArray(t?.attachments) ? t.attachments : []).map(fileText);
  const miss = Number(t?.attachmentsMissing) || 0;
  return { files: out, missing: miss > 0 ? `有 ${miss} 个附件没传到 Mac` : null };
}
export function amendmentItems(t, now = Date.now()) {
  const list = Array.isArray(t?.amendments) ? t.amendments : [];
  return list.slice().reverse().map((a) => ({
    at: when(a.at, now) || '时间没有记录',
    via: a.via === 'device' ? '设备上' : 'Mac 上',
    text: String(a.text || '').trim() || '（只有附件）',
    files: (a.attachments || []).map(fileText),
  }));
}


// ======================================================================================
// 设计整合（hub#165，木木的 V2 设计稿）：任务页一句话状态、交付三格、需要你的卡、真机核对清单、导轨状态三行。
// 都只按视图里已有的字段写，拿不到的写“还没有 / 不可观测”，不编
// ======================================================================================

// 要她做什么（需要你的卡和待办同一个口径；不带任务名）
export function needWhat(t) {
  const k = needKind(t);
  const d = t?.decision || {};
  if (k === 'owner_approval') return d.handler === 'action' ? `批准或拒绝「${clip(d.action?.title || '一个动作', 30)}」` : '批准或拒绝一个敏感操作（只能在 Mac 上批）';
  if (t?.state === 'needs_zoe' && d.handler === 'life-zoe' && d.what) return clip(d.what, 60);
  if (k === 'owner_physical_action') return d.what ? clip(d.what, 60) : '做一件事，做完写一句结果';
  if (t?.state === 'needs_zoe') return d.question ? clip(d.question, 60) : '选一个';
  return /Mac 上点/.test(t?.stateText || '') ? '在 Mac 上点“让后台继续”' : '选一个';
}
// 需要你的卡上的类别（黄铜点 + 标签）和动词：等你选方案 / 等你批准 / 等你真机测试
export function needCardKind(t) {
  const k = needKind(t);
  const d = t?.decision || {};
  // 提前申请的卡（hub#165 §15.3）：照样是审批，但不挡着任务
  if (k === 'owner_approval') return { type: 'approval', label: d.deferred ? '等你批准 · 不急，任务还在做' : '等你批准', verb: '去批准', pageVerb: '查看并批准' };
  if (t?.state === 'needs_zoe' && !d.misfiled && d.kind !== 'sensitive' && d.handler === 'life-zoe' && d.what && d.expected) return { type: 'test', label: '等你真机测试', verb: '开始核对', pageVerb: '开始核对' };
  if (t?.state === 'needs_zoe') return { type: 'choice', label: d.handler === 'life-zoe' ? '等你做一件事' : '等你选方案', verb: '去选', pageVerb: d.handler === 'life-zoe' ? '去做' : '去选' };
  return { type: null, label: '等你放行', verb: '打开', pageVerb: null };
}

// 交付三格（代码完成 / 部署 / 实际验收）：on 是 true（绿勾）/ false（空圈，明确没有）/ null（空圈，没有证据，照写原文）。
// hub#165 复审 F4：会话写的自由文本不映射成任何状态（“已在模拟器上验证通过”“已部署到候选环境”都不是“已真实验收 / 已部署”）。
//   true / false 只有两种来源，每格都带来源标记 src（一句话状态、三格、列表三小段共用）：
//     「已核对」= 结构化证据：代码 = 这件事自己的 PR 已合并（own && MERGED → true）/ 还开着（OPEN → false）；
//               实际验收 = 她的验收（acceptance.ok === true → true，验收不通过 → false）。
//     「据汇报」= done 工具的规范答法：result.did / deployed / realworld 整串就是「是」→ true、整串就是「否」→ false。
//               部署没有结构化证据来源，只有这一种。
//   其余一律 null，显示「会话汇报：<原文>」（没写就是“还没有证据 · 没写”）。
export const SRC_CHECKED = '已核对';
export const SRC_SAID = '据汇报';
// 整串精确「是」/「否」（只去掉首尾空白）；别的都不算
export function exactYesNo(s) {
  const x = String(s ?? '').trim();
  return x === '是' ? true : x === '否' ? false : null;
}
const NO_PROOF = '还没有证据';
const saidText = (raw) => (raw ? `会话汇报：${clip(raw, 70)}` : `${NO_PROOF} · 没写`);
const tagged = (main, src) => `${main}（${src}）`;
export function deliverFacts(t) {
  const r = t?.result && !t.result.missing ? t.result : null;
  const prs = (t?.engineering?.prs || []).filter((p) => p && p.own);
  const merged = prs.some((p) => p.state === 'MERGED');
  const open = prs.some((p) => p.state === 'OPEN');
  const raw = (v) => (v != null && String(v).trim() ? String(v).trim() : null);
  const fromSaid = (v) => {
    const yn = exactYesNo(v);
    return yn === null ? { on: null, via: null, src: null, raw: v, text: saidText(v) } : { on: yn, via: 'said', src: SRC_SAID, raw: v, text: tagged(yn ? '是' : '否', SRC_SAID) };
  };
  const did = raw(r?.did);
  const also = did ? ` · 会话汇报：${clip(did, 60)}` : '';
  const code = merged ? { on: true, via: 'merged', src: SRC_CHECKED, raw: did, text: `${tagged('已合并', SRC_CHECKED)}${also}` }
    : open ? { on: false, via: 'open', src: SRC_CHECKED, raw: did, text: `${tagged('改动还没合并', SRC_CHECKED)}${also}` }
      : fromSaid(did);
  const deploy = fromSaid(raw(r?.deployed));
  const a = t?.acceptance;
  const real = a ? { on: a.ok === true, via: 'acceptance', src: SRC_CHECKED, raw: raw(r?.realworld), text: tagged(acceptLine(t), SRC_CHECKED) } : fromSaid(raw(r?.realworld));
  return { code, deploy, real };
}
const proofNote = (x) => (x.raw ? `（会话汇报：${clip(x.raw, 40)}）` : '（没写）');

// 任务页头的一句话状态（谁在做 / 在哪 / 当前阶段；需要你的写要做什么；交付的写三格事实）
export function headline(t, options) {
  const c = coreState(t);
  if (c === 'needs_you') return `${needCardKind(t).label}：${needWhat(t)}`;
  if (c === 'working') {
    const who = executorText(t, options);
    const env = targetEnv(t);
    const phase = t.now?.phase || null;
    return [who && !who.includes(env) && !/^(还没|没人|不可观测)/.test(who) ? `${who}，在 ${env} 上做` : who, phase].filter(Boolean).join(' · ');
  }
  if (c === 'waiting') return ownerLine(t, options).replace(/^现在：/, '');
  if (c === 'idle') {
    if (t.state === 'needs_zoe' && t.decision?.misfiled) return '没人在做：一张旧的“要你做一件事”的卡，其实是工程的事，不用你动手';
    return `没人在做：${launchReason(t)?.replace(/^会话没起来：/, '会话没起来，') || (t.state === 'paused' ? clip(pausedReason(t), 80) : blockedReason(t))}`;
  }
  if (t?.state === 'cancelled') return endedUnmet(t) ? '按你的决定结束了，原来要的没有做到' : '已取消，不算完成';
  if (c === 'ended') return `结束了，原来要的还没全部做到${t.result?.remaining ? `：还差 ${clip(t.result.remaining, 60)}` : ''}`;
  if (t.result?.missing) return '已经结束，但没有留下结果说明';
  // 和三格同一个来源（deliverFacts），每段带同一个来源标记：（已核对）/（据汇报）；没有证据的写会话原文
  const f = deliverFacts(t);
  const code = f.code.on === true ? tagged(f.code.via === 'merged' ? '代码完成并已合并' : '代码完成', f.code.src)
    : f.code.on === false ? tagged(f.code.via === 'open' ? '改动还没合并' : '代码没有完成', f.code.src)
      : `代码是否完成没有证据${proofNote(f.code)}`;
  const dep = f.deploy.on === true ? tagged('已部署', f.deploy.src) : f.deploy.on === false ? tagged('还没部署', f.deploy.src) : `部署没有证据${proofNote(f.deploy)}`;
  const real = f.real.via === 'acceptance' ? tagged(f.real.on ? '你验收通过' : '你验收不通过', f.real.src)
    : f.real.on === true ? tagged('已真实验收', f.real.src) : f.real.on === false ? tagged('还没真实验收', f.real.src) : `实际验收没有证据${proofNote(f.real)}`;
  return `${code}；${dep}，${real}。`;
}

// 真机测试的核对步骤：把卡片里的“做什么”按“；”“。”换行或“1. 2.”拆开，最多 5 步；拆不开就是一步。不编造步骤文字
export function checkSteps(what) {
  const s = String(what || '').trim();
  if (!s) return [];
  let parts = s.split(/\s*(?:^|\n|\s)(?:\d{1,2}[.、)）](?!\d)|[①②③④⑤⑥⑦⑧⑨])\s*/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) parts = s.split(/[；;。\n]+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return [s];
  if (parts.length > 5) parts = [...parts.slice(0, 4), parts.slice(4).join('；')];
  return parts.map((x) => x.replace(/[；;。，,]+$/, ''));
}

// 导轨底部 / 手机静音行：「标题：内容」拆两段
export function splitStat(text) {
  const s = String(text || '');
  const i = s.indexOf('：');
  return i < 0 ? { title: s, sub: '' } : { title: s.slice(0, i), sub: s.slice(i + 1) };
}
export function macSubText(board, { local = false, lastOk = null, now = Date.now() } = {}) {
  if (local) return lastOk ? '本机页面 · 直接连着 Concierge' : '本机页面 · 现在连不上';
  const st = macStatus(board, { now });
  if (!st.seenAt) return '还没收到过消息';
  return st.online ? '经 GitHub 同步 · 10 分钟一报' : '现在提交的会排着，上线后领取';
}
export function gptChatStat(board, now = Date.now()) {
  const o = (board?.options?.consult || []).find((x) => x && x.async) || null;
  if (!o) return { connected: false, sub: '还没有接入' };
  const st = coordinatorStatus(o, now);
  return { connected: st.connected, sub: st.connected ? `最近一次调用 ${when(o.lastCallAt, now)}` : st.text };
}
