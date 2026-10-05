// 远端通道的共用协议（ADR-0001 §2.3–2.4，规格见 concierge/docs/REMOTE.md §1）。
// 浏览器（产品页面）和 Node（入口进程，从 ../web/lib/proto.mjs import）用的是**同一个文件**：
// 规范化 JSON、签名串、配对校验码、信封格式只写一遍，两边不可能各算各的。
// 所以这里不依赖 DOM，也不依赖 Node 内置模块：密码学一律走 globalThis.crypto.subtle（Node 18+ 也有）。
//
// 设备身份：每台设备一把 ECDSA P-256 私钥（浏览器里生成，不可导出），公钥在 Mac 本机配对时登记。
// 设备发出的每个动作都带签名：签的是 signingInput()，签名是 IEEE-P1363（r‖s，64 字节）再 base64url。
// GitHub 上的文字不是授权：入口只认验签通过、设备已配对、时间在窗口内、编号没用过的动作。
// 反过来也一样：入口发布到状态 Issue 上的视图由入口自己的“Mac 钥匙”签名（signState），设备只显示验得过的
// （verifyStateComment / readStateViews），动作里再带上它看到的那张卡片的指纹（cardFp），入口对不上就拒绝。
//
// 这里的解析函数只做“形状”校验（字段、类型、长度、字符集），不查设备、不验签；那些在入口（lib/remote.mjs）。

export const PROTO = 'concierge-v1';
export const V = 1;

// 设备能发的动作（cmd 评论）。新任务不走 cmd：设备直接建一条收件 Issue（kind 'submit'）。
export const CMD_KINDS = ['answer', 'resume', 'consult', 'chip', 'quota', 'caps', 'ping', 'cancel'];
export const SUBMIT = 'submit';
export const CHIP_ACTIONS = ['add', 'pin', 'unpin', 'delete'];
export const QUOTA_POOLS = ['claude', 'codex'];

// 收件表单的栏目标题。必须和 lib/gate.mjs、lib/prefs.mjs 里的一字不差（有测试盯着）：
// 验签不过时，入口按普通收件解析正文里的这些栏目。
export const FORM = {
  want: '我要什么 / 哪里不对',
  extra: '额外要求（可选）',
  model: '主执行模型',
  effort: 'Effort',
  subagents: '最大子代理数',
  consult: '跨模型咨询',
  consultEffort: '咨询 effort',
  consultMax: '最大咨询次数',
  auto: '自动',
  noConsult: '不咨询',
  none: '_No response_',
};

// 长度上限。GitHub 上读回来的一切都是不可信输入：超了就整条不认，不截断后再用。
export const LIMITS = {
  want: 8000, extra: 2000, title: 60, label: 40, question: 2000, text: 2000, choice: 200, fp: 200, ref: 120,
  chipText: 24, chips: 20, prefsJson: 4000, cmdBody: 8192, enrollBody: 4096, envelopeJson: 24000, issueBody: 65536,
  stateBody: 65536,
};

// 入口签的两种评论（状态 Issue 上的 board / tv）。设备只显示用配对时钉住的 Mac 公钥验得过的
export const STATE_KINDS = ['board', 'tv'];
// seq 的下限：入口用“毫秒时间 × 1000”打底，十进制正好是签名串里 id 那一段要的 8–64 个字符
export const MIN_SEQ = 1e7;

const ID = /^[A-Za-z0-9_-]{8,64}$/;           // 动作编号 / 客户端编号 / 配对编号
const CARD = /^[A-Za-z0-9_-]{43}$/;            // cardFp 的结果：SHA-256 的 base64url
const DEVICE = /^[A-Za-z0-9_-]{16}$/;          // deviceIdOf 的结果
const KIND = /^[a-z]{1,16}$/;
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;
const SIG = /^[A-Za-z0-9_-]{86}$/;             // 64 字节的 base64url（无填充）
const MAC = /^[A-Za-z0-9_-]{43}$/;             // 32 字节的 base64url
const COORD = /^[A-Za-z0-9_-]{43}$/;           // P-256 坐标，32 字节
const REF = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}#[1-9][0-9]{0,8}$/;

const subtle = () => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error('这个环境没有 WebCrypto（crypto.subtle），不能签名或验签');
  return s;
};
const enc = new TextEncoder();
const isPlain = (o) => o !== null && typeof o === 'object' && !Array.isArray(o)
  && (Object.getPrototypeOf(o) === Object.prototype || Object.getPrototypeOf(o) === null);
const hasOnly = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));

// ---- 稳定 JSON ----

// 按码点比较（不是按 UTF-16 码元）：两边的排序必须一样，规格里写的是码点
function cmpCodePoint(a, b) {
  let i = 0; let j = 0;
  while (i < a.length && j < b.length) {
    const x = a.codePointAt(i); const y = b.codePointAt(j);
    if (x !== y) return x - y;
    i += x > 0xffff ? 2 : 1; j += y > 0xffff ? 2 : 1;
  }
  return (a.length - i) - (b.length - j);
}

// 稳定 JSON：对象键按码点排序，没有多余空白；undefined、函数、非有限数、非普通对象一律拒绝（抛 TypeError），
// 不悄悄丢掉——丢掉的话签名串和看到的内容就对不上了。
export function canon(value) {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new TypeError('canon：不接受非有限数');
      return JSON.stringify(value);
    case 'string': return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) {
        const parts = [];
        for (let i = 0; i < value.length; i++) parts.push(canon(value[i])); // 空位按 undefined 处理，会被拒
        return `[${parts.join(',')}]`;
      }
      if (!isPlain(value)) throw new TypeError('canon：只接受普通对象');
      const keys = Object.keys(value).sort(cmpCodePoint);
      return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(value[k])}`).join(',')}}`;
    }
    default: throw new TypeError(`canon：不接受 ${typeof value}`);
  }
}

// ---- 编码 ----

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_INDEX = Object.fromEntries([...B64].map((c, i) => [c, i]));

const toBytes = (data) => {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (typeof data === 'string') return enc.encode(data);
  throw new TypeError('要的是字节或字符串');
};

export function b64url(data) {
  const b = toBytes(data);
  let out = '';
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63];
  }
  if (b.length - i === 1) { const n = b[i] << 16; out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63]; }
  else if (b.length - i === 2) { const n = (b[i] << 16) | (b[i + 1] << 8); out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63]; }
  return out;
}

// 严格解码：只认 base64url 字符、不带填充、末尾多余的位必须是 0（同一串字节只有一种写法）。不合法返回 null。
export function fromB64url(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0; let buf = 0; let bits = 0;
  for (const c of s) {
    buf = (buf << 6) | B64_INDEX[c]; bits += 6;
    if (bits >= 8) { bits -= 8; out[o++] = (buf >> bits) & 255; }
  }
  if (bits && (buf & ((1 << bits) - 1)) !== 0) return null;
  return out;
}

export const hex = (data) => [...toBytes(data)].map((x) => x.toString(16).padStart(2, '0')).join('');

export async function sha256(data) {
  return new Uint8Array(await subtle().digest('SHA-256', toBytes(data)));
}

// 随机编号（动作编号、客户端编号）：16 字节随机数的 base64url，22 个字符
export function newId(n = 16) {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b64url(b);
}

// 两个字符串比较时间不随内容变（配对校验码用）
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

// ---- 设备身份 ----

// 公钥只认 P-256 的 EC JWK。浏览器导出的 JWK 会多带 ext / key_ops，可以有，但只留下四个字段。不合法返回 null。
export function pubOf(jwk) {
  if (!isPlain(jwk) || !hasOnly(jwk, ['kty', 'crv', 'x', 'y', 'ext', 'key_ops'])) return null;
  if (jwk.kty !== 'EC' || jwk.crv !== 'P-256' || !COORD.test(String(jwk.x)) || !COORD.test(String(jwk.y))) return null;
  if (fromB64url(jwk.x)?.length !== 32 || fromB64url(jwk.y)?.length !== 32) return null;
  return { crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y };
}

// 设备编号 = base64url(SHA-256(canon({crv,kty,x,y}))) 的前 16 个字符
export async function deviceIdOf(pubJwk) {
  const pub = pubOf(pubJwk);
  if (!pub) throw new TypeError('不是 P-256 公钥');
  return b64url(await sha256(canon(pub))).slice(0, 16);
}

// ---- 配对码（没法扫码时）----
// 设备显示一个码，Zoe 把它**敲进** Mac 本机页面；入口在状态 Issue 上找“算出来正好是这个码”的那一条配对请求，
// 恰好一条才登记。码 = Crockford base32(SHA-256(canon({d: 设备公钥, m: Mac 公钥}))) 的前 12 个字符（60 位），
// 显示成 XXXX-XXXX-XXXX。
//   - 绑住两把公钥：设备要是被人塞了一把假的 Mac 公钥（伪造的看板），它算出来的码在真的 Mac 上对不上任何请求；
//   - 60 位：要造一把“码和 Zoe 设备一样”的钥匙，得在 30 分钟内做约 2^60 次带椭圆曲线运算的尝试；
//   - 码由 Zoe 从设备屏幕抄到 Mac 上（不是 Mac 列出来让她核对），所以别人刷再多配对请求也挤不掉她那一条。
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LEN = 12;

function crockford(bytes, n) {
  let out = ''; let buf = 0; let bits = 0;
  for (const b of bytes) {
    buf = ((buf << 8) | b) & 0xffff; bits += 8;
    while (bits >= 5 && out.length < n) { bits -= 5; out += CROCKFORD[(buf >> bits) & 31]; }
    if (out.length >= n) break;
  }
  return out;
}
const groupCode = (s) => `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;

export async function pairingCode(devicePub, macPub) {
  const d = pubOf(devicePub); const m = pubOf(macPub);
  if (!d || !m) throw new TypeError('不是 P-256 公钥');
  return groupCode(crockford(await sha256(canon({ d, m })), CODE_LEN));
}

// ---- 配对码的反方向确认（终审 F1d）----
// 配对码只证明了“Mac 认得这台设备的公钥”。反过来，设备钉住的 Mac 公钥是从看板的自签名里取的（先信后验），
// 共用账号上的人可以先让设备钉住一把假的 Mac 公钥，再贴一份列着这台设备的假看板——以前设备看到自己在名单里就算配好了。
// 所以配对码配对要两个方向都确认：Zoe 在 Mac 上敲对了码之后，Mac 本机页面显示 pairingConfirm(设备公钥, Mac 公钥)，
// 她把这 6 位数字敲回设备上；设备用自己的公钥和**钉住的** Mac 公钥算一遍，对得上才算配好、才开始显示内容。
// 为什么这挡得住：骗设备钉住假 Mac 公钥的人，没法让**真的** Mac 显示和假公钥对得上的数字——
// 真的 Mac 只会用它自己的公钥算；码对不上的时候（设备钉的是假公钥，算出来的配对码在真的 Mac 上一条都对不上），
// 真的 Mac 什么数字都不显示（“没找到这个配对码”）。共用账号上的人也看不到 Mac 本机页面。
// 6 位十进制 = SHA-256(canon({c:'confirm', d: 设备公钥, m: Mac 公钥})) 的前 6 个字节（48 位）当成整数，模 10^6，前面补 0。
// c:'confirm' 让它和 pairingCode（canon({d, m})）分开：两个值互相推不出来。设备上最多试 5 次（随机猜中的机会 5/10^6）。
export async function pairingConfirm(devicePub, macPub) {
  const d = pubOf(devicePub); const m = pubOf(macPub);
  if (!d || !m) throw new TypeError('不是 P-256 公钥');
  const h = await sha256(canon({ c: 'confirm', d, m }));
  let n = 0;
  for (let i = 0; i < 6; i++) n = n * 256 + h[i]; // < 2^48，安全整数
  return String(n % 1000000).padStart(6, '0');
}
// Zoe 敲进来的 6 位数字：全角、空格、横线都不算。不合法返回 null
export function normalizePairingConfirm(input) {
  if (typeof input !== 'string' || input.length > 32) return null;
  const s = input.normalize('NFKC').replace(/[\s\-‐‑‒–—―_]/g, '');
  return /^[0-9]{6}$/.test(s) ? s : null;
}
// 显示成“NNN NNN”
export const groupConfirm = (s) => (typeof s === 'string' && /^[0-9]{6}$/.test(s) ? `${s.slice(0, 3)} ${s.slice(3)}` : '');

// Zoe 敲进来的码：大小写、空格、各种横线都不算；Crockford 里容易看错的 O→0、I/L→1。不合法返回 null
export function normalizePairingCode(input) {
  if (typeof input !== 'string' || input.length > 64) return null;
  const s = input.normalize('NFKC').toUpperCase().replace(/[\s\-‐‑‒–—―_]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!new RegExp(`^[${CROCKFORD}]{${CODE_LEN}}$`).test(s)) return null;
  return groupCode(s);
}

// 新设备的密钥。私钥不可导出（extractable:false），存 IndexedDB 时存的是 CryptoKey 本身；
// 公钥总是可导出的。Safari 存不了 CryptoKeyPair，所以调用方把 privateKey 和 pub 分开存。
export async function generateDeviceKey() {
  const pair = await subtle().generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const pub = pubOf(await subtle().exportKey('jwk', pair.publicKey));
  return { privateKey: pair.privateKey, publicKey: pair.publicKey, pub, deviceId: await deviceIdOf(pub) };
}

export async function importPub(pubJwk) {
  const pub = pubOf(pubJwk);
  if (!pub) throw new TypeError('不是 P-256 公钥');
  return subtle().importKey('jwk', { ...pub, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, true, ['verify']);
}

// ---- 签名 ----

// 签名串：
//   "concierge-v1\n" + kind + "\n" + device + "\n" + ts + "\n" + id + "\n" + hex(SHA-256(canon(payload)))
// 每一段都先过字符集检查（不能带换行），否则抛错：不会因为某一段里藏了换行而让两条不同的动作签名串一样。
export async function signingInput({ kind, device, ts, id, payload }) {
  if (!KIND.test(String(kind))) throw new TypeError('kind 不对');
  if (!DEVICE.test(String(device))) throw new TypeError('device 不对');
  if (!TS.test(String(ts)) || Number.isNaN(Date.parse(ts))) throw new TypeError('ts 不对');
  if (!ID.test(String(id))) throw new TypeError('id 不对');
  return `${PROTO}\n${kind}\n${device}\n${ts}\n${id}\n${hex(await sha256(canon(payload)))}`;
}

// ECDSA P-256 + SHA-256。WebCrypto 出的签名本来就是 IEEE-P1363（r‖s，64 字节）
export async function signAction(privateKey, fields) {
  const sig = await subtle().sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, enc.encode(await signingInput(fields)));
  return b64url(sig);
}

// 验签。任何异常（公钥不合法、签名长度不对、字段不合规）都当成“没验过”，返回 false，不抛。
export async function verifyAction(pubJwk, fields, sig) {
  try {
    if (!SIG.test(String(sig))) return false;
    const raw = fromB64url(sig);
    if (!raw || raw.length !== 64) return false;
    const key = await importPub(pubJwk);
    return await subtle().verify({ name: 'ECDSA', hash: 'SHA-256' }, key, raw, enc.encode(await signingInput(fields)));
  } catch { return false; }
}

// 配对链接的校验码：base64url(HMAC-SHA256(secret, canon({pairId, device, pub})))。secret 是 32 字节的 base64url。
export async function pairingMac(secret, { pairId, device, pub }) {
  const k = fromB64url(secret);
  if (!k || k.length !== 32) throw new TypeError('配对密钥不对');
  const p = pubOf(pub);
  if (!p) throw new TypeError('不是 P-256 公钥');
  const key = await subtle().importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await subtle().sign('HMAC', key, enc.encode(canon({ pairId: String(pairId), device: String(device), pub: p }))));
}

// ---- 评论里的标记 ----

// JSON 里不能出现 "-->"，否则 HTML 注释会提前结束；< > 和连续的 - 都转义掉，JSON.parse 会还原（和 lib/protocol.mjs 同一套）
export function safeJson(data) {
  return JSON.stringify(data ?? {}).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/--/g, '-\\u002d');
}

export const marker = (kind, data) => `<!-- concierge:${kind} ${safeJson(data)} -->`;

const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n');

// 只认评论**开头**的标记（和 lib/protocol.mjs 一样）。kinds：认哪几种。返回 {kind, data} 或 null；JSON 坏了也是 null。
export function readMarker(body, kinds) {
  if (typeof body !== 'string') return null;
  const m = norm(body).match(/^\s*<!-- concierge:([a-z]{1,16}) (\{[^\n]*?\}) -->/);
  if (!m || !kinds.includes(m[1])) return null;
  try {
    const data = JSON.parse(m[2]);
    return isPlain(data) ? { kind: m[1], data } : null;
  } catch { return null; }
}

// ---- 状态 Issue 上入口写的评论（board 一条，每个任务一条 tv）----
// 共用账号谁都能改这些评论，所以入口给每一条签名（“Mac 钥匙”，私钥只在 Mac 的运行目录里）：
//   <!-- concierge:board {"v":1,"mac":<macId>,"seq":<整数>,"ts":<ISO>,"sig":…,"view":<和 GET /api/view 一样的 board>} -->
//   <!-- concierge:tv    {"v":1,"mac":<macId>,"seq":<整数>,"ts":<ISO>,"sig":…,"view":<和 GET /api/view 一样的 taskView>} -->
// 签名串就是 signingInput({kind:'board'|'tv', device:macId, ts, id:String(seq), payload:view})。
// seq 在入口那边严格递增（跨重启也不回退）。设备的规矩（下面几个函数就是它）：
//   - 只显示用配对时钉住的 Mac 公钥验得过的；
//   - 每个 board / 每个任务记住见过的最大 seq，更小的不认（旧视图被人重新贴回来也没用）；
//   - 几条评论自称同一个 board / 任务时，取验得过的里 seq 最大的那条。

const isSeq = (n) => Number.isSafeInteger(n) && n >= MIN_SEQ;

export const stateSigningFields = ({ kind, mac, seq, ts, view }) => ({ kind, device: mac, ts, id: String(seq), payload: view });

// 入口用：签一条 board / tv。返回信封（放进标记里的那个对象）
export async function signState(privateKey, { kind, mac, seq, ts, view }) {
  if (!STATE_KINDS.includes(kind)) throw new TypeError('kind 不对');
  if (!isSeq(seq)) throw new TypeError('seq 不对');
  const sig = await signAction(privateKey, stateSigningFields({ kind, mac, seq, ts, view }));
  return { v: V, mac, seq, ts, sig, view };
}

// 只看形状。返回 { kind, key, mac, seq, ts, sig, view } 或 null（key：'board' 或 'tv:<ref>'）
export function parseStateComment(body) {
  if (typeof body !== 'string' || body.length > LIMITS.stateBody) return null;
  const mk = readMarker(body, STATE_KINDS);
  if (!mk) return null;
  const e = mk.data;
  if (Object.keys(e).length !== 6 || !hasOnly(e, ['v', 'mac', 'seq', 'ts', 'sig', 'view'])) return null;
  if (e.v !== V || !DEVICE.test(String(e.mac)) || !isSeq(e.seq) || !TS.test(String(e.ts)) || Number.isNaN(Date.parse(e.ts)) || !SIG.test(String(e.sig))) return null;
  if (!isPlain(e.view)) return null;
  if (mk.kind === 'tv' && !(typeof e.view.ref === 'string' && REF.test(e.view.ref) && e.view.ref.length <= LIMITS.ref)) return null;
  if (mk.kind === 'board' && !isPlain(e.view.mac)) return null;
  return { kind: mk.kind, key: mk.kind === 'board' ? 'board' : `tv:${e.view.ref}`, mac: e.mac, seq: e.seq, ts: e.ts, sig: e.sig, view: e.view };
}

// 验一条解析过的 board / tv：签名对得上这把 Mac 公钥，信封里的 macId 就是它算出来的；board 里写的 Mac 身份也得是它。
// 任何异常都当成“没验过”，返回 false，不抛。
export async function verifyStateComment(macPub, parsed) {
  try {
    if (!parsed || !STATE_KINDS.includes(parsed.kind)) return false;
    const pub = pubOf(macPub);
    if (!pub || (await deviceIdOf(pub)) !== parsed.mac) return false;
    if (parsed.kind === 'board') {
      const m = parsed.view.mac;
      if (m.id !== parsed.mac || canon(pubOf(m.pub)) !== canon(pub)) return false;
    }
    return await verifyAction(pub, stateSigningFields(parsed), parsed.sig);
  } catch { return false; }
}

// 纯函数：把一批验过的视图并进设备本地的缓存 cache（{ key: parsed }）。同一个 key 取 seq 最大的；
// 只有比缓存里的 seq 大才替换。返回 { cache（新对象）, changed: [key…] }
export function newestStates(cache = {}, verified = []) {
  const best = new Map();
  for (const p of verified) {
    const cur = best.get(p.key);
    if (!cur || p.seq > cur.seq) best.set(p.key, p);
  }
  const out = { ...cache };
  const changed = [];
  for (const [k, p] of best) {
    if (!out[k] || !(out[k].seq >= p.seq)) { out[k] = p; changed.push(k); }
  }
  return { cache: out, changed };
}

// 设备读状态 Issue：bodies 是评论正文的数组（谁写的都有），macPub 是配对时钉住的 Mac 公钥。
// 只留验得过的，再按 seq 并进缓存。返回 { cache, changed, rejected:（形状对、签名不对的条数）}
export async function readStateViews(bodies, macPub, cache = {}) {
  const ok = []; let rejected = 0;
  for (const b of Array.isArray(bodies) ? bodies : []) {
    const p = parseStateComment(b);
    if (!p) continue;
    if (await verifyStateComment(macPub, p)) ok.push(p); else rejected += 1;
  }
  return { ...newestStates(cache, ok), rejected };
}

// 配对码配对时（设备还没有钉住的 Mac 公钥）：从看板的“自签名”里取 Mac 公钥。返回各不相同的候选 [{ id, pub, seq }]，
// 按 seq 从大到小。只有一个候选时才用它；有好几把（有人贴了自己签的假看板）就别配，等入口把假的清掉再试。
// 选错了也只是配不上：配对码绑着 Mac 公钥，用假公钥算的码在真的 Mac 上对不上任何请求。
export async function selfSignedMacs(bodies) {
  const found = new Map();
  for (const b of Array.isArray(bodies) ? bodies : []) {
    const p = parseStateComment(b);
    if (!p || p.kind !== 'board') continue;
    const pub = pubOf(p.view.mac?.pub);
    if (!pub || !(await verifyStateComment(pub, p))) continue;
    const cur = found.get(p.mac);
    if (!cur || p.seq > cur.seq) found.set(p.mac, { id: p.mac, pub, seq: p.seq });
  }
  return [...found.values()].sort((a, b) => b.seq - a.seq);
}

// ---- 动作绑定卡片 ----
// 设备回答、让后台继续、请咨询时，签名里带上“我看到的那张卡片”的指纹：入口用它自己现在的 taskView 再算一遍，
// 对不上就拒绝（“页面和 Mac 上的不一致，请刷新后再试”）。卡片 = 下面这几个字段，一个不多：
//   { ref, title, want, extra, state, decision: null | { fp, kind, question|what, options, recommend, why, impact, rollback } }
// 返回 SHA-256(canon(卡片)) 的 base64url（43 个字符）。
export function cardOf(tv) {
  const n = (x) => (x === undefined ? null : x);
  const d = tv?.decision;
  return {
    ref: n(tv?.ref), title: n(tv?.title), want: n(tv?.want), extra: n(tv?.extra), state: n(tv?.state),
    decision: d ? {
      fp: n(d.fp), kind: n(d.kind), ...(d.kind === 'sensitive' ? { what: n(d.what) } : { question: n(d.question) }),
      options: Array.isArray(d.options) ? d.options : [], recommend: n(d.recommend), why: n(d.why), impact: n(d.impact), rollback: n(d.rollback),
    } : null,
  };
}
export async function cardFp(tv) { return b64url(await sha256(canon(cardOf(tv)))); }

const str =(v, max, { min = 0 } = {}) => typeof v === 'string' && v.length >= min && v.length <= max;

// 每种动作的 payload 形状。字段必须一个不多、类型和长度都对，否则整条不认。
export function checkPayload(kind, p) {
  if (!isPlain(p)) return '内容不是对象';
  const exact = (keys) => Object.keys(p).length === keys.length && hasOnly(p, keys);
  switch (kind) {
    // answer / resume / consult 都带 card：设备渲染的那张卡片的 cardFp（见上），入口用自己的视图再算一遍比对
    case 'answer':
      if (!exact(['ref', 'decisionFp', 'choice', 'text', 'card'])) return '字段不对';
      if (!REF.test(String(p.ref)) || !str(p.ref, LIMITS.ref)) return '任务号不对';
      if (!str(p.decisionFp, LIMITS.fp, { min: 1 })) return '缺少决定的指纹';
      if (!CARD.test(String(p.card))) return '缺少卡片指纹';
      if (!str(p.choice, LIMITS.choice) || !str(p.text, LIMITS.text)) return '回答太长';
      if (!p.choice.trim() && !p.text.trim()) return '没有回答内容';
      return null;
    case 'resume':
      if (!exact(['ref', 'card']) || !REF.test(String(p.ref)) || !str(p.ref, LIMITS.ref)) return '任务号不对';
      if (!CARD.test(String(p.card))) return '缺少卡片指纹';
      return null;
    // 取消一个任务（#62）：和继续一样带卡片指纹；text 是她补的一句（可以空）
    case 'cancel':
      if (!exact(['ref', 'text', 'card']) || !REF.test(String(p.ref)) || !str(p.ref, LIMITS.ref)) return '任务号不对';
      if (!CARD.test(String(p.card))) return '缺少卡片指纹';
      if (!str(p.text, LIMITS.text)) return '内容太长';
      return null;
    case 'consult':
      if (!exact(['ref', 'question', 'smallWork', 'card'])) return '字段不对';
      if (!REF.test(String(p.ref)) || !str(p.ref, LIMITS.ref)) return '任务号不对';
      if (!CARD.test(String(p.card))) return '缺少卡片指纹';
      if (!str(p.question, LIMITS.question) || typeof p.smallWork !== 'boolean') return '内容不对';
      return null;
    case 'chip':
      if (!exact(['action', 'text']) || !CHIP_ACTIONS.includes(p.action) || !str(p.text, LIMITS.chipText, { min: 1 })) return '标签操作不对';
      return null;
    case 'quota':
      if (!exact(['pool']) || !QUOTA_POOLS.includes(p.pool)) return '额度池不对';
      return null;
    case 'caps': case 'ping':
      return exact([]) ? null : '字段不对';
    case SUBMIT: {
      if (!exact(['want', 'extra', 'prefs', 'chips'])) return '字段不对';
      if (!str(p.want, LIMITS.want) || !p.want.trim()) return '“我要什么”是空的或太长';
      if (!str(p.extra, LIMITS.extra)) return '额外要求太长';
      if (p.prefs !== null && !isPlain(p.prefs)) return '执行偏好不对';
      try { if (canon(p.prefs).length > LIMITS.prefsJson) return '执行偏好太长'; } catch { return '执行偏好不对'; }
      if (!Array.isArray(p.chips) || p.chips.length > LIMITS.chips || !p.chips.every((x) => str(x, LIMITS.chipText))) return '常用标签不对';
      return null;
    }
    default: return '不认识的动作';
  }
}

// ---- cmd（设备 → 状态 Issue 上的一条评论）----
// {v:1, id, device, ts, kind, payload, sig}；入口处理后删除

export async function buildCommand({ privateKey, device, kind, payload, id = newId(), ts = new Date().toISOString() }) {
  if (!CMD_KINDS.includes(kind)) throw new TypeError('不认识的动作');
  const bad = checkPayload(kind, payload);
  if (bad) throw new TypeError(bad);
  const sig = await signAction(privateKey, { kind, device, ts, id, payload });
  const cmd = { v: V, id, device, ts, kind, payload, sig };
  return { cmd, body: `${marker('cmd', cmd)}\n设备发来的动作（入口处理完会删掉这条）` };
}

// 只看形状，返回 { ok:true, cmd } 或 { ok:false, error }
export function parseCommand(body) {
  if (typeof body !== 'string' || body.length > LIMITS.cmdBody) return { ok: false, error: '太长' };
  const mk = readMarker(body, ['cmd']);
  if (!mk) return { ok: false, error: '没有动作标记' };
  const c = mk.data;
  if (Object.keys(c).length !== 7 || !hasOnly(c, ['v', 'id', 'device', 'ts', 'kind', 'payload', 'sig'])) return { ok: false, error: '字段不对' };
  if (c.v !== V) return { ok: false, error: '版本不对' };
  if (!ID.test(String(c.id)) || !DEVICE.test(String(c.device)) || !TS.test(String(c.ts)) || Number.isNaN(Date.parse(c.ts))) return { ok: false, error: '编号或时间不对' };
  if (!CMD_KINDS.includes(c.kind)) return { ok: false, error: '不认识的动作' };
  if (!SIG.test(String(c.sig))) return { ok: false, error: '签名格式不对' };
  const bad = checkPayload(c.kind, c.payload);
  if (bad) return { ok: false, error: bad };
  return { ok: true, cmd: c };
}

export const verifyCommand = (pub, c) => verifyAction(pub, { kind: c.kind, device: c.device, ts: c.ts, id: c.id, payload: c.payload }, c.sig);

// ---- enroll（配对请求）----
// 链接配对：{v:1, pairId, device:{id,label,pub}, mac}；配对码：{v:1, device:{id,label,pub}}
// 配对码这一种：设备先从看板的自签名里拿到 Mac 公钥（selfSignedMacs），贴出 enroll，再显示 pairingCode(自己的公钥, Mac 公钥)，
// Zoe 把码敲进 Mac 本机页面（POST /api/devices {action:'pair-code', code}）；Mac 显示 pairingConfirm(设备公钥, Mac 公钥) 的 6 位数字，
// 她敲回设备，设备核对得上才算配好（终审 F1d，见上面 pairingConfirm 的说明）。

export const cleanLabel = (s) => String(s ?? '').normalize('NFKC').replace(/[^\p{L}\p{N} ._()·-]+/gu, '').trim().slice(0, LIMITS.label);

export async function buildEnroll({ device, pair = null }) {
  const pub = pubOf(device?.pub);
  if (!pub) throw new TypeError('不是 P-256 公钥');
  const d = { id: device.id, label: cleanLabel(device.label) || '设备', pub };
  const enroll = pair
    ? { v: V, pairId: pair.pairId, device: d, mac: await pairingMac(pair.secret, { pairId: pair.pairId, device: d.id, pub }) }
    : { v: V, device: d };
  return { enroll, body: `${marker('enroll', enroll)}\n设备配对请求（入口处理完会删掉这条）` };
}

export function parseEnroll(body) {
  if (typeof body !== 'string' || body.length > LIMITS.enrollBody) return { ok: false, error: '太长' };
  const mk = readMarker(body, ['enroll']);
  if (!mk) return { ok: false, error: '没有配对标记' };
  const e = mk.data;
  const linked = 'pairId' in e || 'mac' in e;
  const keys = linked ? ['v', 'pairId', 'device', 'mac'] : ['v', 'device'];
  if (Object.keys(e).length !== keys.length || !hasOnly(e, keys)) return { ok: false, error: '字段不对' };
  if (e.v !== V) return { ok: false, error: '版本不对' };
  if (linked && (!ID.test(String(e.pairId)) || !MAC.test(String(e.mac)))) return { ok: false, error: '配对编号或校验码不对' };
  const d = e.device;
  if (!isPlain(d) || Object.keys(d).length !== 3 || !hasOnly(d, ['id', 'label', 'pub'])) return { ok: false, error: '设备字段不对' };
  if (!DEVICE.test(String(d.id)) || !str(d.label, LIMITS.label)) return { ok: false, error: '设备编号或名字不对' };
  const pub = pubOf(d.pub);
  if (!pub) return { ok: false, error: '公钥不对' };
  return { ok: true, enroll: { v: V, ...(linked ? { pairId: e.pairId, mac: e.mac } : {}), device: { id: d.id, label: cleanLabel(d.label) || '设备', pub } } };
}

// ---- 提交新任务（设备 → 收件 Issue）----
// 正文是和网页表单一样的栏目（给人看，也给“验签不过时按普通收件处理”用），末尾一行签名信封：
//   <!-- concierge:device {"v":1,"id":<clientId>,"device":<deviceId>,"ts":<ISO>,"payload":{want,extra,prefs,chips},"sig":…} -->
// 签名串里的 kind 是 'submit'。入口验签通过时只用 payload，不用正文里解析出来的文字。

// 偏好 → 表单栏目文字。options 是看板里的 board.options（有模型和咨询对象的显示名）；不给就只写两栏。
function prefSections(prefs, options) {
  if (!prefs || !options) return [];
  const model = (options.models || []).find((m) => m.id === prefs.model);
  const c = prefs.consult || {};
  const copt = c.mode === 'named' ? (options.consult || []).find((o) => o.target === c.target && (o.model ?? null) === (c.model ?? null)) : null;
  const consult = c.mode === 'none' ? FORM.noConsult : copt ? copt.label : FORM.auto;
  return [
    [FORM.model, model ? model.name : FORM.auto],
    [FORM.effort, typeof prefs.effort === 'string' && prefs.effort ? prefs.effort : FORM.auto],
    [FORM.subagents, Number.isInteger(prefs.maxSubagents) ? String(prefs.maxSubagents) : FORM.auto],
    [FORM.consult, consult],
    [FORM.consultEffort, copt && typeof c.effort === 'string' && c.effort ? c.effort : FORM.auto],
    [FORM.consultMax, copt && c.max === 2 ? '2' : '1'],
  ];
}

export function titleOf(want) {
  const first = norm(want).trim().split('\n')[0].trim();
  return [...first].slice(0, LIMITS.title).join('') || '新任务';
}

export async function buildSubmission({ privateKey, device, want, extra = '', prefs = null, chips = [], clientId = newId(), ts = new Date().toISOString(), options = null }) {
  const payload = { want: String(want ?? ''), extra: String(extra ?? ''), prefs: prefs ?? null, chips: Array.isArray(chips) ? chips : [] };
  const bad = checkPayload(SUBMIT, payload);
  if (bad) throw new TypeError(bad);
  const sig = await signAction(privateKey, { kind: SUBMIT, device, ts, id: clientId, payload });
  const envelope = { v: V, id: clientId, device, ts, payload, sig };
  const sections = [[FORM.want, payload.want.trim()], [FORM.extra, payload.extra.trim() || FORM.none], ...prefSections(payload.prefs, options)];
  const body = `${sections.map(([k, v]) => `### ${k}\n\n${v}`).join('\n\n')}\n\n${marker('device', envelope)}`;
  if (body.length > LIMITS.issueBody) throw new TypeError('太长了');
  return { clientId, title: titleOf(payload.want), body, envelope };
}

const DEVICE_TAIL = /\n?<!-- concierge:device (\{[^\n]*\}) -->\s*$/;

// 正文末尾的签名信封。没有返回 null；有但形状不对返回 { ok:false, error }；对的返回 { ok:true, envelope }
export function parseSubmission(body) {
  if (typeof body !== 'string') return null;
  const text = norm(body);
  const m = text.match(DEVICE_TAIL);
  if (!m) return null;
  if (text.length > LIMITS.issueBody || m[1].length > LIMITS.envelopeJson) return { ok: false, error: '太长' };
  let e;
  try { e = JSON.parse(m[1]); } catch { return { ok: false, error: '信封不是合法的 JSON' }; }
  if (!isPlain(e) || Object.keys(e).length !== 6 || !hasOnly(e, ['v', 'id', 'device', 'ts', 'payload', 'sig'])) return { ok: false, error: '字段不对' };
  if (e.v !== V || !ID.test(String(e.id)) || !DEVICE.test(String(e.device)) || !TS.test(String(e.ts)) || Number.isNaN(Date.parse(e.ts))) return { ok: false, error: '编号或时间不对' };
  if (!SIG.test(String(e.sig))) return { ok: false, error: '签名格式不对' };
  const bad = checkPayload(SUBMIT, e.payload);
  if (bad) return { ok: false, error: bad };
  return { ok: true, envelope: e };
}

// 去掉正文末尾的签名信封（按普通收件解析正文时用：信封不算“我要什么”的一部分）
export const stripSubmission = (body) => norm(body).replace(DEVICE_TAIL, '');

export const verifySubmission = (pub, e) => verifyAction(pub, { kind: SUBMIT, device: e.device, ts: e.ts, id: e.id, payload: e.payload }, e.sig);

// ---- 配对链接 ----
// appUrl#pair=<base64url(canon({v:1,o,r,i,p,k,m,t?}))>
//   o 仓库所有者、r 仓库、i 状态 Issue 号、p 配对编号、k 配对密钥、m Mac 公钥（JWK，设备钉住它，之后只认它签的视图）、
//   t 令牌（可选，Zoe 当场粘贴，只在页面内存里）

export function encodePairFragment({ o, r, i, p, k, m, t }) {
  const mac = pubOf(m);
  if (!mac) throw new TypeError('缺少 Mac 公钥');
  const d = { v: V, o: String(o), r: String(r), i: Number(i), p: String(p), k: String(k), m: mac };
  if (t) d.t = String(t);
  return `pair=${b64url(canon(d))}`;
}

export function decodePairFragment(hash) {
  const m = String(hash ?? '').replace(/^#/, '').match(/^pair=([A-Za-z0-9_-]{1,4000})$/);
  if (!m) return null;
  const raw = fromB64url(m[1]);
  if (!raw) return null;
  let d;
  try { d = JSON.parse(new TextDecoder().decode(raw)); } catch { return null; }
  if (!isPlain(d) || d.v !== V || !hasOnly(d, ['v', 'o', 'r', 'i', 'p', 'k', 'm', 't'])) return null;
  if (!/^[A-Za-z0-9-]{1,39}$/.test(String(d.o)) || !/^[A-Za-z0-9_.-]{1,100}$/.test(String(d.r))) return null;
  if (!Number.isInteger(d.i) || d.i <= 0 || !ID.test(String(d.p)) || fromB64url(String(d.k))?.length !== 32) return null;
  if (d.t !== undefined && (typeof d.t !== 'string' || d.t.length > 400)) return null;
  const mac = pubOf(d.m);
  if (!mac) return null;
  return { ...d, m: mac };
}
