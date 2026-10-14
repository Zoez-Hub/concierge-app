// 手机批准（hub#152 桥二）：iPhone 上用面容 ID（passkey，WebAuthn）批准登记动作。浏览器和 Mac 入口共用这个文件，
// 保证两边算出来的“挑战”（被签的东西）一字不差。不依赖 DOM，不依赖 Node 内置模块（用 globalThis.crypto.subtle）。
//
// 为什么在设备签名之外还要 passkey：设备的签名钥匙（不可导出）在页面的 IndexedDB 里，页面代码能直接用它签名——托管页面要是被人改了，
// 改过的代码可以在她不知情时替她签一条“批准”。passkey 每次签名都要她本人面容 ID / 密码（userVerification:'required'），
// 页面代码静默拿不到；而且被签的挑战绑死了：哪个任务、哪一张审批卡（指纹）、哪一个动作（动作指纹：清单编号、参数、脚本哈希、地点、有效期）、
// 哪一台设备。换一张卡、换一个动作、换一台设备，签名都对不上。
// 剩下的风险（如实写在 docs/ACTIONS.md）：页面被改过时，可能在她面容 ID 之前显示假的内容，骗她批准一个**已经在等批准**的登记动作；
// 它造不出新的动作申请，也改不了动作的内容（清单、参数、脚本都由 Mac 核对）。
import { canon, b64url, sha256, checkWebauthn, checkPasskeyPayload, PASSKEY_LIMITS } from './proto.mjs';

// 被签的挑战：32 字节（SHA-256），和 Mac 那边逐字节一样
export async function approvalChallenge({ digest, decisionFp, ref, device }) {
  return sha256(canon({ v: 1, kind: 'action-approve', digest: String(digest), decisionFp: String(decisionFp), ref: String(ref), device: String(device) }));
}

// 开启手机批准时两边对的核对码：6 位数字（凭据编号 + 公钥的哈希）。Zoe 把手机上显示的码敲进 Mac 本机页面才算开启
export async function passkeyCode(credId, spki) {
  const h = await sha256(canon({ c: 'passkey', id: String(credId), k: String(spki) }));
  const n = ((h[0] << 16) | (h[1] << 8) | h[2]) % 1000000;
  return String(n).padStart(6, '0');
}
export const normalizePasskeyCode = (s) => { const t = String(s ?? '').normalize('NFKC').replace(/[\s-]/g, ''); return /^\d{6}$/.test(t) ? t : null; };

export { b64url, checkWebauthn, checkPasskeyPayload, PASSKEY_LIMITS };
