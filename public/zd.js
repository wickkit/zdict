// zstd dictionary checker core: loads zd.wasm (libzstd 1.5.7) and measures
// how much a trained dictionary helps messages compressed one at a time.
// Works in the browser (worker) and in Node (test/check.js).

const SIZES = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 112640];

const wasiStub = {
  fd_write: () => 0, fd_close: () => 0, fd_seek: () => 0,
  clock_time_get: () => 0,
};

export async function load(bytes) {
  const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1: wasiStub });
  instance.exports._initialize();
  return new Zd(instance.exports);
}

class Zd {
  constructor(x) { this.x = x; }
  get mem() { return new Uint8Array(this.x.memory.buffer); }
  u32() { return new Uint32Array(this.x.memory.buffer); }
  alloc(n) {
    const p = this.x.zd_malloc(Math.max(n, 1));
    if (!p) throw new Error("out of wasm memory");
    return p;
  }
  // Pack messages into one buffer + size_t[] (wasm32: size_t is u32).
  pack(msgs) {
    const total = msgs.reduce((s, m) => s + m.length, 0);
    const buf = this.alloc(total), sizes = this.alloc(4 * msgs.length);
    let off = 0;
    const mem = this.mem, u = this.u32();
    msgs.forEach((m, i) => { mem.set(m, buf + off); off += m.length; u[sizes / 4 + i] = m.length; });
    return { buf, sizes, n: msgs.length, total, max: Math.max(0, ...msgs.map((m) => m.length)) };
  }
  free(...ps) { ps.forEach((p) => this.x.zd_free(p)); }
  train(packed, cap) {
    const d = this.alloc(cap);
    const size = this.x.zd_train(d, cap, packed.buf, packed.sizes, packed.n);
    if (!size) { this.free(d); return null; }
    return { ptr: d, size, bytes: () => this.mem.slice(d, d + size) };
  }
  // Total compressed bytes, each message alone (dict null = none).
  each(packed, dict, level) {
    const cap = this.x.zd_bound(packed.max), scratch = this.alloc(cap);
    const r = this.x.zd_compress_each(packed.buf, packed.sizes, packed.n,
      dict ? dict.ptr : 0, dict ? dict.size : 0, level, scratch, cap, 0);
    this.free(scratch);
    if (r === 0xffffffff) throw new Error("compress failed");
    return r;
  }
  all(packed, level) {
    const cap = this.x.zd_bound(packed.total), dst = this.alloc(cap);
    const r = this.x.zd_compress_all(packed.buf, packed.total, level, dst, cap);
    this.free(dst);
    return r;
  }
}

// Deterministic shuffle so a rerun on the same input gives the same answer.
function shuffled(arr, seed) {
  const a = arr.slice();
  let s = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    const j = s % (i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function split(text, mode) {
  if (mode === "blank") return text.split(/\r?\n\s*\r?\n/).map((s) => s.trim()).filter(Boolean);
  return text.split(/\r?\n/).filter((s) => s.trim());
}

// msgs: Uint8Array[]. Holds out testFrac of them; trains on the rest.
export function analyze(zd, msgs, { level = 3, testFrac = 0.2, seed = 1, sizes = SIZES, onStep } = {}) {
  if (msgs.length < 10) throw new Error("need at least 10 messages (got " + msgs.length + ")");
  const sh = shuffled(msgs, seed);
  const nTest = Math.max(5, Math.round(sh.length * testFrac));
  const test = sh.slice(0, nTest), train = sh.slice(nTest);
  const T = zd.pack(test), S = zd.pack(train);
  const out = {
    level, nTrain: train.length, nTest: test.length, trainBytes: S.total, testBytes: T.total,
    medianSize: median(msgs.map((m) => m.length)),
    none: zd.each(T, null, level), whole: zd.all(T, level), rows: [],
  };
  const todo = sizes.filter((c) => c <= S.total);
  todo.forEach((cap, i) => {
    onStep && onStep(i, todo.length, cap);
    const d = zd.train(S, cap);
    if (!d) { out.rows.push({ cap, failed: true }); return; }
    const c = zd.each(T, d, level);
    out.rows.push({ cap, dictSize: d.size, compressed: c, samplesPerDict: S.total / d.size, dict: d.bytes() });
    zd.free(d.ptr);
  });
  zd.free(T.buf, T.sizes, S.buf, S.sizes);
  return verdict(out);
}

function median(a) {
  const s = a.slice().sort((x, y) => x - y);
  return s.length ? s[s.length >> 1] : 0;
}

// Ratios, the pick, and the plain-language call.
export function verdict(o) {
  const r = (c) => o.testBytes / c;
  o.ratioNone = r(o.none);
  o.ratioWhole = r(o.whole);
  const ok = o.rows.filter((x) => !x.failed);
  ok.forEach((x) => {
    x.ratio = r(x.compressed);
    x.savedPerMsg = (o.none - x.compressed) / o.nTest;
    // Share of the per-message-vs-whole-stream gap the dict closes.
    x.gapClosed = (o.none - x.compressed) / Math.max(1, o.none - o.whole);
    x.breakEven = x.savedPerMsg > 0 ? Math.ceil(x.dictSize / x.savedPerMsg) : Infinity;
  });
  const best = ok.reduce((b, x) => (!b || x.compressed < b.compressed ? x : b), null);
  // Smallest dict within 2% of the best: same win, less to ship and cache.
  o.pick = best && ok.filter((x) => x.compressed <= best.compressed * 1.02)
    .reduce((a, x) => (x.dictSize < a.dictSize ? x : a));
  o.best = best;
  const gain = o.pick ? o.pick.ratio / o.ratioNone : 1;
  o.gain = gain;
  o.call = !o.pick ? "no" : gain >= 1.5 ? "yes" : gain >= 1.15 ? "maybe" : "no";
  // My GitHub-events runs: dicts were only safe when sample bytes >= 4x dict size.
  o.thin = ok.filter((x) => x.samplesPerDict < 4).map((x) => x.cap);
  return o;
}

export { SIZES };
