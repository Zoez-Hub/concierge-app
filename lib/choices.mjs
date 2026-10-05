// 执行偏好和常用标签：页面上的状态 ↔ 提交给入口的 prefs（和 lib/prefs.mjs 的 normalizePrefs 同一个形状）。
// 纯函数，不碰 DOM。入口照样会再校验一遍（不认识的值落回自动），这里只决定界面上能选什么。
//
// 页面状态：
//   { model: id|null, effort: string|null, subagents: 0|1|2|null,
//     consult: { mode: 'auto'|'none'|'named', key: 'target|model'|null, effort: string|null, max: 1|2, smallWork: boolean } }

import { coordinatorStatus, consultName, day } from './format.mjs';

export const emptyPrefs = () => ({ model: null, effort: null, subagents: null, consult: { mode: 'auto', key: null, effort: null, max: 1, smallWork: false } });

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
  if (p.model && !modelOf(options, p.model)) p.model = null;
  if (!p.model || !effortChoices(options, p.model).includes(p.effort)) p.effort = null;
  if (p.subagents !== null && !subagentChoices(options).includes(p.subagents)) p.subagents = null;
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
  return !p.model && !p.effort && p.subagents === null && p.consult.mode === 'auto';
}

// 提交用的 prefs：全自动时是 null。里面不放 undefined（签名用的稳定 JSON 不接受）
export function toPayload(prefs, options) {
  const p = fixPrefs(prefs, options);
  if (isAuto(p)) return null;
  const out = {};
  if (p.model) out.model = p.model;
  if (p.effort) out.effort = p.effort;
  if (p.subagents !== null) out.maxSubagents = p.subagents;
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
  const m = modelOf(options, p.model);
  if (m) parts.push(String(m.name).replace(/^Claude\s+/, ''));
  if (m && p.effort) parts.push(p.effort);
  if (p.subagents === 0) parts.push('不开子代理');
  else if (p.subagents !== null) parts.push(`最多 ${p.subagents} 个子代理`);
  if (p.consult.mode === 'none') parts.push('不咨询');
  else if (p.consult.mode === 'named') {
    const o = findConsult(options, p.consult.key);
    parts.push(`咨询 ${o.label}${o.controllable && p.consult.effort ? ` · ${p.consult.effort}` : ''}${!o.async && p.consult.max === 2 ? ' × 2' : ''}`);
    if (p.consult.smallWork) parts.push('允许小动工');
  }
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
    ['主执行模型', m ? m.name : autoModelText(options)],
    ['思考档位', !m ? '自动' : !effortChoices(options, p.model).length ? '这个模型不分档' : p.effort || '自动：用命令行默认档位'],
    ['子代理', p.subagents === 0 ? '不开（硬限制）' : p.subagents === null ? `自动：一般不开，分诊认为有并行价值时最多 ${cap} 个` : `最多 ${p.subagents} 个`],
    ['咨询', c.mode === 'none' ? '不咨询'
      : !o ? `自动：分诊觉得值得时咨询${auto ? ` ${consultName(auto)}` : '另一个模型'} 1 次，否则不咨询`
        : o.async ? 'GPT Web 协调者（先等它的意见再开工）' : `${consultName(o)} · 最多 ${c.max} 次`],
    ['咨询思考档位', !o ? (c.mode === 'none' ? '不适用' : '自动') : o.async ? '在 ChatGPT 里由你自己选，Concierge 控制不了也核实不了' : c.effort || '自动：用它的默认档位'],
    ['允许小动工', c.smallWork ? '允许（只对这一个任务）' : '不允许'],
    ['代码仓库', '提交后由 Concierge 分诊判断（拿不准会先问你）'],
  ];
}
