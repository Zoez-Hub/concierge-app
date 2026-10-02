// 设备本地存储（docs/REMOTE.md §3）：IndexedDB 数据库 concierge。
//   kv      配置、令牌、私钥（CryptoKey，不可导出）、公钥 JWK、设备编号、名字、上一次的视图……每样一条记录。
//           私钥和公钥分开存（Safari 存不了 CryptoKeyPair）。
//   outbox  还没确认送到的提交和动作（先落这里再发，可重试、不重复）
// memoryStore() 是同一个接口的内存版：Node 单元测试用，浏览器里 IndexedDB 打不开时（比如某些隐私模式）也退到它。

const DB = 'concierge';
const VERSION = 1;

const req = (r) => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
const done = (tx) => new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });

export async function openStore(idb = globalThis.indexedDB) {
  if (!idb) throw new Error('这个浏览器没有 IndexedDB');
  const open = idb.open(DB, VERSION);
  open.onupgradeneeded = () => {
    const db = open.result;
    if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'id' });
  };
  const db = await req(open);
  const run = async (name, mode, fn) => {
    const tx = db.transaction(name, mode);
    const out = fn(tx.objectStore(name));
    const value = out instanceof IDBRequest ? await req(out) : out;
    await done(tx);
    return value;
  };
  return {
    kind: 'indexeddb',
    get: (k) => run('kv', 'readonly', (s) => s.get(k)),
    set: (k, v) => run('kv', 'readwrite', (s) => s.put(v, k)),
    del: (k) => run('kv', 'readwrite', (s) => s.delete(k)),
    putItem: (rec) => run('outbox', 'readwrite', (s) => s.put(rec)),
    getItem: (id) => run('outbox', 'readonly', (s) => s.get(id)),
    delItem: (id) => run('outbox', 'readwrite', (s) => s.delete(id)),
    items: () => run('outbox', 'readonly', (s) => s.getAll()),
    async clear() { await run('kv', 'readwrite', (s) => s.clear()); await run('outbox', 'readwrite', (s) => s.clear()); },
  };
}

// 普通对象复制一份（模拟 IndexedDB 的结构化克隆）；CryptoKey 原样放（它本来就不可变）
const copy = (v) => (v && typeof v === 'object' && !(globalThis.CryptoKey && v instanceof globalThis.CryptoKey) ? structuredClone(v) : v);

export function memoryStore() {
  const kv = new Map();
  const outbox = new Map();
  return {
    kind: 'memory',
    async get(k) { return copy(kv.get(k)); },
    async set(k, v) { kv.set(k, copy(v)); },
    async del(k) { kv.delete(k); },
    async putItem(rec) { outbox.set(rec.id, copy(rec)); },
    async getItem(id) { return copy(outbox.get(id)); },
    async delItem(id) { outbox.delete(id); },
    async items() { return [...outbox.values()].map(copy); },
    async clear() { kv.clear(); outbox.clear(); },
  };
}
