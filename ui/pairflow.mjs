// 链接配对的几步（从 app.mjs 拆出来，好单独测；#172 复审 5）：
//   startLink → 「连接到 Zoe 的 Mac？」→ confirmLink → pairLink（异步）；cancelReplace 取消。
// 代次（generation）：每次开始一轮异步连接、每次取消都 +1；异步结果回来时代次对不上（中途取消过、或者又开了一轮）就丢掉，
// 不恢复确认屏、不把原样链接（rawLink，只在内存里）带回来。取消时 rawLink 跟着整个 app.pair 一起丢掉。
import { isIos, isStandalone } from './pair.mjs';

export function installLinkFlow(app, { render, tick = () => {} }) {
  let gen = 0;
  app.pairGen = () => gen;
  // replace：已经配好的设备换成这次的配对（她在“要换成这次的配对吗？”上点了“换”，终审 F1e）
  // 第一次配对（hub#165 §15.1）：先一屏「连接到 Zoe 的 Mac？」，她点了「连接」才往下走。rawLink（#172）：原样的链接，只在内存里
  app.startLink = (frag, { replace = false, rawLink = null } = {}) => {
    if (!replace) { gen += 1; app.pair = { step: 'link-confirm', frag, ...(typeof rawLink === 'string' && rawLink ? { rawLink } : {}) }; render(); return; }
    app.pairLink(frag, null, { replace });
  };
  // 「连接」：链接里带着 GitHub 授权（Mac 启用了 GitHub App）直接连；没带 → 「首次连接需要一次 GitHub 授权」那一屏
  app.confirmLink = () => {
    const frag = app.pair.frag;
    if (!frag) return;
    if (!frag.t) { app.pair = { step: 'link-token', frag }; render(); return; }
    app.pairLink(frag, null);
  };
  app.pairLink = async (frag, token, { replace = app.pair.replace === true } = {}) => {
    const back = app.pair.step === 'link-replace' ? 'link-replace' : app.pair.step === 'link-confirm' ? 'link-confirm' : 'link-token';
    const rawLink = app.pair.rawLink || null; // 连不上时「复制连接链接」还在（#172）
    const mine = ++gen;
    app.pair = { ...app.pair, step: back, frag, busy: true, error: null, replace };
    render();
    let next;
    try {
      await app.transport.pairByLink(frag, { label: isIos() && isStandalone() ? `${app.defaultLabel} 主屏幕` : app.defaultLabel, token, replace }); // 主屏幕 App 名字带“主屏幕”（设备页据此标徽章）
      next = { step: 'waiting' }; // 配对密钥用过就不留在内存里
    } catch (e) {
      const error = e.status === 401 && back === 'link-token' ? '访问凭据无效或已到期。请在当前页重新粘贴有效凭据；需要新建时按创建步骤操作。'
        : e.status === 401 && back === 'link-confirm' ? '链接里带的 GitHub 授权用不了了（过期或者被撤销）。在 Mac 上重新点「添加设备」。' : e.message;
      next = { step: back, frag, busy: false, error, replace, ...(rawLink ? { rawLink } : {}) };
    }
    if (mine !== gen) return; // 中途取消过（或者又开了一轮）：这次的结果不要了
    app.pair = next;
    render();
    tick();
  };
  // 取消：代次 +1（在路上的结果回来也作废），连同原样链接一起丢掉
  app.cancelReplace = () => { gen += 1; app.pair = { step: 'start' }; render(); };
}
