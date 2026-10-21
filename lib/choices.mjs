// 执行偏好和常用标签：页面上的状态 ↔ 提交给入口的 prefs（和 lib/prefs.mjs 的 normalizePrefs 同一个形状）。
// 纯函数，不碰 DOM。入口照样会再校验一遍（不认识的值落回自动），这里只决定界面上能选什么。
//
// 页面状态：
//   { model: id|null, effort: string|null, subagents: 0|1|2|null,
//     subagentModel: null|'haiku'|'sonnet'|'main', scope: null|'research'|'fix'|'pr',   （hub#165 §6）
//     consult: { mode: 'auto'|'none'|'named', key: 'target|model'|null, effort: string|null, max: 1|2, smallWork: boolean } }

import { coordinatorStatus, consultName, day, subagentModelName, subagentAutoText, SCOPE_TEXT } from './format.mjs';

export const emptyPrefs = () => ({ site: null, model: null, effort: null, subagents: null, subagentModel: null, scope: null, consult: { mode: 'auto', key: null, effort: null, max: 1, smallWork: false } });

// 子代理模型（hub#165 §6，C11 / C12）：自动（普通任务 Haiku、复杂任务 Sonnet，分诊定）/ Haiku / Sonnet / 跟随主模型。
// 不开子代理（个数选 0）或主执行是 Codex（Codex 那边没有接子代理）时不能选，写明为什么
export const SUBAGENT_MODELS = ['haiku', 'sonnet', 'main'];
export function subagentModelUsable(prefs, options) {
  const p = prefs || emptyPrefs();
  if (p.subagents === 0) return { ok: false, why: '子代理个数选了 0：不开子代理，这一项不适用' };
  if (providerOf(modelOf(options, p.model)) === 'codex' && p.model) return { ok: false, why: '主执行是 Codex：Codex 那边不开子代理，这一项不适用' };
  return { ok: true, why: null };
}
// 执行范围（hub#165 §6）：自动 / 只研究（Mac 上是硬限制：会话只有只读工具；Windows 上现在做不到，会先问她）/ 可修复 / 只到草稿改动（不申请合并）
export const SCOPES = ['research', 'fix', 'pr'];
export const SCOPE_NAME = { research: '只研究', fix: '可修复', pr: '只到草稿改动' };

// 在哪里做（hub#30 C01 / C10，B6）：自动 / 只在 Mac / 只在 Windows。手选是硬约束：Mac 的分诊、改派、放行和 Windows 的领取都按它复核（hub#127），
// 做不到会停下来问，不会换机器。这里只是让她选、把选择原样签进提交里
export const SITES = ['mac', 'windows'];
export const SITE_NAME = { mac: 'Mac', windows: 'Windows' };
// 手选 Windows 只在“在线的 Windows 接收器已经带上工作副本仓库身份修复”时才给（hub#125：旧接收器的 fetch / publish 可能对错仓库）。
// 接收器在心跳里报能力 repo-identity 才算；没报（现役旧版本）就置灰：要 Windows 现场的任务照旧由分诊安排，不开新的手动入口
export const WINDOWS_SAFE_CAP = 'repo-identity';
export function windowsSite(board) {
  const ok = (board?.receivers || []).some((r) => r && r.online === true && Array.isArray(r.caps) && r.caps.includes(WINDOWS_SAFE_CAP));
  return ok ? { available: true, why: null } : { available: false, why: 'Windows 接收器还没更新到带仓库身份修复的版本，暂时不能手选 Windows；要 Windows 现场的任务照旧由分诊安排' };
}

export const consultKey = (o) => `${o.target}|${o.model || ''}`;
export const findConsult = (options, key) => (options?.consult || []).find((o) => consultKey(o) === key) || null;
// 能不能选：GPT Web 协调者（async）要有能观测到的连接证据（隧道在跑，而且被调用过，format.mjs 的 coordinatorStatus）；别的咨询对象列出来就能选
export const consultUsable = (o) => !!o && (!o.async || coordinatorStatus(o).connected);
export const modelOf = (options, id) => (options?.models || []).find((m) => m.id === id) || null;

// 主执行模型按命令行分组（Claude / GPT（Codex）），保持入口给的顺序。没写 provider 的（旧入口）算 Claude
export const PROVIDER_LABEL = { claude: 'Claude', codex: 'GPT（Codex）' };
export const providerOf = (x) => (x?.provider === 'codex' ? 'codex' : 'claude');
export function modelGroups(options) {
  const groups = [];
  for (const m of options?.models || []) {
    const p = providerOf(m);
    let g = groups.find((x) => x.provider === p);
    if (!g) { g = { provider: p, label: PROVIDER_LABEL[p], models: [] }; groups.push(g); }
    g.models.push(m);
  }
  return groups;
}
// 只能在 Mac 上跑：机器列表里没有 Windows（旧入口没给 machines 的不写）
export const macOnly = (m) => Array.isArray(m?.machines) && !m.machines.includes('Windows');
// 执行偏好里一个模型下面那行小字：登记里的说明、只能在 Mac 上跑、实测情况
export function modelSub(m) {
  return [m?.note || null, macOnly(m) ? '只能在 Mac 上跑' : null, m?.verifiedAt ? `上次实测 ${day(m.verifiedAt)}` : '按配置，还没实测过'].filter(Boolean).join(' · ');
}

// 所选模型原生的 effort 档位。模型“自动”时只有“自动”（返回 []）；模型没有档位也是 []（界面上不显示这一栏）
export function effortChoices(options, modelId) {
  const m = modelOf(options, modelId);
  return m && Array.isArray(m.efforts) ? m.efforts.map(String) : [];
}

export function subagentChoices(options) {
  const cap = Number.isInteger(options?.maxSubagentsCap) ? options.maxSubagentsCap : 2;
  return Array.from({ length: cap + 1 }, (_, i) => i);
}

// 改一项之后，把不再成立的选择落回自动（换模型后原来的 effort 不在新模型的档位里，等等）
export function fixPrefs(prefs, options) {
  const p = structuredClone(prefs || emptyPrefs());
  if (!SITES.includes(p.site)) p.site = null;
  // 不能手选 Windows 的时候（windowsSite 不可用）：落回自动，面板上那一项是置灰的
  if (p.site === 'windows' && options?.windowsSite?.available === false) p.site = null;
  if (p.model && !modelOf(options, p.model)) p.model = null;
  // 只在 Windows 上做 + 只能在 Mac 上跑的模型：不在这里悄悄改掉哪一边（设计整合：冲突 fail-closed，conflicts() 写明，「好」和发送都禁用）
  if (!p.model || !effortChoices(options, p.model).includes(p.effort)) p.effort = null;
  if (p.subagents !== null && !subagentChoices(options).includes(p.subagents)) p.subagents = null;
  if (p.subagentModel === undefined || !SUBAGENT_MODELS.includes(p.subagentModel) || !subagentModelUsable(p, options).ok) p.subagentModel = null;
  if (!SCOPES.includes(p.scope)) p.scope = null;
  const c = p.consult;
  if (c.mode === 'named') {
    const o = findConsult(options, c.key);
    if (!o || !consultUsable(o)) { p.consult = emptyPrefs().consult; return p; }
    if (!o.controllable || !(o.efforts || []).includes(c.effort)) c.effort = null;
    if (o.async) c.max = 1;
    if (c.max !== 2) c.max = 1;
    if (!o.async || !options?.smallWork?.available) c.smallWork = false;
  } else { c.key = null; c.effort = null; c.max = 1; c.smallWork = false; }
  return p;
}

export function isAuto(prefs) {
  const p = prefs || emptyPrefs();
  return !p.site && !p.model && !p.effort && p.subagents === null && !p.subagentModel && !p.scope && p.consult.mode === 'auto';
}

// 提交用的 prefs：全自动时是 null。里面不放 undefined（签名用的稳定 JSON 不接受）
export function toPayload(prefs, options) {
  const p = fixPrefs(prefs, options);
  if (isAuto(p)) return null;
  const out = {};
  if (p.site) out.site = p.site;
  if (p.model) out.model = p.model;
  if (p.effort) out.effort = p.effort;
  if (p.subagents !== null) out.maxSubagents = p.subagents;
  if (p.subagentModel) out.subagentModel = p.subagentModel;
  if (p.scope) out.scope = p.scope;
  if (p.consult.mode === 'none') out.consult = { mode: 'none' };
  else if (p.consult.mode === 'named') {
    const o = findConsult(options, p.consult.key);
    out.consult = { mode: 'named', target: o.target, model: o.model || null, max: p.consult.max };
    if (p.consult.effort) out.consult.effort = p.consult.effort;
    if (p.consult.smallWork) out.consult.smallWork = true;
  } else out.consult = { mode: 'auto' };
  return out;
}

// 「执行偏好」那一行的摘要
export function summary(prefs, options) {
  const p = fixPrefs(prefs, options);
  if (isAuto(p)) return '自动';
  // 只写改过的项；没改的就是自动
  const parts = [];
  if (p.site) parts.push(`只在 ${SITE_NAME[p.site]}`);
  const m = modelOf(options, p.model);
  if (m) parts.push(String(m.name).replace(/^Claude\s+/, ''));
  if (m && p.effort) parts.push(p.effort);
  if (p.subagents === 0) parts.push('不开子代理');
  else if (p.subagents !== null) parts.push(`最多 ${p.subagents} 个子代理`);
  if (p.subagentModel) parts.push(p.subagentModel === 'main' ? '子代理跟随主模型' : `子代理用 ${subagentModelName(p.subagentModel, options)}`);
  if (p.consult.mode === 'none') parts.push('不咨询');
  else if (p.consult.mode === 'named') {
    const o = findConsult(options, p.consult.key);
    parts.push(`咨询 ${o.label}${o.controllable && p.consult.effort ? ` · ${p.consult.effort}` : ''}${!o.async && p.consult.max === 2 ? ' × 2' : ''}`);
    if (p.consult.smallWork) parts.push('允许小动工');
  }
  if (p.scope) parts.push(SCOPE_NAME[p.scope]);
  return parts.join(' · ');
}

// ---- 常用标签 ----
// 文字标签：在“额外要求”里（按“；”分开的短句）就算点上了；偏好标签：当前偏好和它设的一样就算点上了

export const splitExtra = (extra) => String(extra || '').split(/[；;\n]+/).map((x) => x.trim()).filter(Boolean);

export function chipOn(chip, prefs, extra) {
  if (chip.pref) {
    const p = prefs || emptyPrefs();
    if (chip.pref.maxSubagents !== undefined) return p.subagents === chip.pref.maxSubagents;
    if (chip.pref.consult?.mode === 'none') return p.consult.mode === 'none';
    return false;
  }
  return splitExtra(extra).includes(chip.text);
}

// 点一下：返回新的 { prefs, extra }
export function toggleChip(chip, prefs, extra) {
  const on = chipOn(chip, prefs, extra);
  const p = structuredClone(prefs || emptyPrefs());
  let e = String(extra || '');
  if (chip.pref) {
    if (chip.pref.maxSubagents !== undefined) p.subagents = on ? null : chip.pref.maxSubagents;
    if (chip.pref.consult?.mode === 'none') p.consult = on ? emptyPrefs().consult : { ...emptyPrefs().consult, mode: 'none' };
  } else {
    const parts = splitExtra(e).filter((x) => x !== chip.text);
    if (!on) parts.push(chip.text);
    e = parts.join('；');
  }
  return { prefs: p, extra: e };
}

// 提交时一起带上的标签文字（入口据此记“常用”）
export function activeChips(chips, prefs, extra) {
  return (chips || []).filter((c) => chipOn(c, prefs, extra)).map((c) => String(c.text)).slice(0, 20);
}

// 「+」：把额外要求里还不是标签的短句存成标签（每句 24 字以内）
export function newChipTexts(chips, extra) {
  const have = new Set((chips || []).map((c) => String(c.text)));
  return splitExtra(extra).filter((x) => x.length <= 24 && !have.has(x));
}

// 排序：固定的在前，其余保持入口给的顺序（入口已经按常用排好）
export const sortChips = (chips) => [...(chips || [])].map((c, i) => [c, i]).sort((a, b) => (Number(!!b[0].pinned) - Number(!!a[0].pinned)) || a[1] - b[1]).map(([c]) => c);

// 自动模式怎么选主执行模型（入口给的那句；旧入口没有就照旧写）
export const autoModelText = (options) => options?.auto?.text || '自动：用命令行默认的模型';

// 「提交任务」的确认框：每一项都列出来（摘要只写改过的，这里连自动的也写明是自动）。
// 咨询那一项：本机 Codex 写“名字 · 最多几次”，GPT Web 协调者没有次数和档位可选，写明由她在 ChatGPT 里选
export function reviewRows(prefs, options) {
  const p = fixPrefs(prefs, options);
  const c = p.consult;
  const m = modelOf(options, p.model);
  const o = c.mode === 'named' ? findConsult(options, c.key) : null;
  const auto = (options?.consult || []).find((x) => x.controllable && !x.async) || null;
  const cap = subagentChoices(options).at(-1);
  return [
    ['在哪里做', p.site ? `只在 ${SITE_NAME[p.site]} 上做（硬约束：做不到会先问你，不会换机器）` : '自动：按这件事要的现场选；原话里写了“只在 Mac 做”“不派给 Windows”的照办'],
    ['主执行模型', m ? m.name : autoModelText(options)],
    ['思考档位', !m ? '自动' : !effortChoices(options, p.model).length ? '这个模型不分档' : p.effort || '自动：用命令行默认档位'],
    ['子代理', p.subagents === 0 ? '不开（硬限制）' : p.subagents === null ? `自动：一般不开，分诊认为有并行价值时最多 ${cap} 个` : `最多 ${p.subagents} 个`],
    ['子代理模型', !subagentModelUsable(p, options).ok ? `不适用（${subagentModelUsable(p, options).why.replace(/，这一项不适用$/, '')}）`
      : p.subagentModel === 'main' ? '跟随主执行模型' : p.subagentModel ? subagentModelName(p.subagentModel, options) : `自动：${subagentAutoText(p)}（开了子代理才有用）`],
    ['咨询', c.mode === 'none' ? '不咨询'
      : !o ? `自动：分诊觉得值得时咨询${auto ? ` ${consultName(auto)}` : '另一个模型'} 1 次，否则不咨询`
        : o.async ? 'GPT Web 协调者（先等它的意见再开工）' : `${consultName(o)} · 最多 ${c.max} 次`],
    ['咨询思考档位', !o ? (c.mode === 'none' ? '不适用' : '自动') : o.async ? '在 ChatGPT 里由你自己选，Concierge 控制不了也核实不了' : c.effort || '自动：用它的默认档位'],
    ['允许小动工', c.smallWork ? '允许（只对这一个任务）' : '不允许'],
    ['执行范围', p.scope ? SCOPE_TEXT[p.scope] : `自动：${SCOPE_TEXT.fix}`],
    ['代码仓库', '提交后由 Concierge 分诊判断（拿不准会先问你）'],
  ];
}


// ---- 设计整合（hub#165）：GPT Chat 参与、冲突（fail-closed）、确认表的“自动 / 你指定” ----

// 「GPT Chat 参与」这一组现在的值：不参与 / 协调 / 协调 + 小动工（= 咨询指定 GPT Web 协调者，允不允许小动工）
export function gptChatValue(prefs, options) {
  const c = (prefs || emptyPrefs()).consult;
  if (c.mode !== 'named') return 'none';
  const o = findConsult(options, c.key);
  if (!o?.async) return 'none';
  return c.smallWork ? 'coord-sw' : 'coord';
}

// 冲突（fail-closed）：有一条就不能发送，面板的「好」也禁用；每条写明冲突在哪、怎么解。不在后台替她改掉任何一边。
// 只研究 + Windows：后端也会出 scope-conflict 决定卡，这里先拦下来
export function conflicts(prefs, options) {
  const p = prefs || emptyPrefs();
  const out = [];
  const m = modelOf(options, p.model);
  const win = p.site === 'windows';
  const c = p.consult || emptyPrefs().consult;
  const named = c.mode === 'named' ? findConsult(options, c.key) : null;
  if (win && m && macOnly(m)) out.push(`Windows 上只有 Claude 能做主执行：${m.name} 只能在 Mac 上跑。改在 Mac 上做，或者换一个 Claude 模型。`);
  if (m && providerOf(m) === 'codex' && Number.isInteger(p.subagents) && p.subagents > 0) out.push(`主执行是 ${m.name}（Codex）：Codex 那边不开子代理。子代理选 0 或自动。`);
  if (win && named && !named.async) out.push(`本机 ${named.label} 的咨询只能在 Mac 上做：选了只在 Windows 上做时不能同时指定。改在 Mac 上做，或者咨询选自动 / 不咨询。`);
  if (win && named?.async && c.smallWork) out.push('小动工由 Mac 上的 Luna 做：选了只在 Windows 上做时不能同时开。改在 Mac 上做，或者 GPT Chat 选“协调”。');
  if (win && p.scope === 'research') out.push('只研究在 Windows 上现在做不到（那边的接收器还没有只读档）：改在 Mac 上做，或者范围选可修复。');
  return out;
}

// 确认表每一行是不是她手选的（和 reviewRows 一一对应）：true =“你指定”（黄铜），false =“自动”
export function reviewSet(prefs, options) {
  const p = fixPrefs(prefs, options);
  const c = p.consult;
  return [!!p.site, !!p.model, !!p.effort, p.subagents !== null, !!p.subagentModel, c.mode !== 'auto', !!c.effort, !!c.smallWork, !!p.scope, false];
}
