// node test/check.js [DATA_DIR] — checks zd.wasm against libzstd via Python.
// DATA_DIR holds GH Archive hours (*.json.gz) and pydict.txt from pydict.py.
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { load, analyze } from "../public/zd.js";

const here = new URL("..", import.meta.url).pathname;
const zd = await load(readFileSync(here + "public/zd.wasm"));
const enc = new TextEncoder();
let fails = 0;
const ok = (c, msg) => { console.log((c ? "ok   " : "FAIL ") + msg); if (!c) fails++; };

// 1. Round trip with a dict on synthetic messages.
const synth = Array.from({ length: 400 }, (_, i) =>
  enc.encode(JSON.stringify({ id: i, user: "u" + (i % 37), kind: ["push", "pull", "issue"][i % 3], at: 1e9 + i * 17 })));
const P = zd.pack(synth.slice(0, 300));
const d = zd.train(P, 4096);
ok(d && d.size > 0, `train synthetic: dict ${d && d.size} B`);
const m = synth[350], src = zd.alloc(m.length), cap = zd.x.zd_bound(m.length), dst = zd.alloc(cap), back = zd.alloc(m.length);
zd.mem.set(m, src);
const c = zd.x.zd_compress_one(dst, cap, src, m.length, d.ptr, d.size, 3);
const n = zd.x.zd_decompress(back, m.length, dst, c, d.ptr, d.size);
ok(n === m.length && Buffer.compare(Buffer.from(zd.mem.slice(back, back + n)), Buffer.from(m)) === 0,
  `round trip ${m.length} B -> ${c} B -> ${n} B`);

// 2. Same samples, same size -> byte-identical dict to Python's libzstd train_dict.
const dir = process.argv[2];
if (dir && existsSync(dir + "/pydict.txt")) {
  for (const line of readFileSync(dir + "/pydict.txt", "utf8").trim().split("\n")) {
    const [hour, nS, size, sha] = line.split(" ");
    const lines = gunzipSync(readFileSync(`${dir}/${hour}.json.gz`)).toString("utf8").split("\n").filter((s) => s.trim());
    const S = zd.pack(lines.slice(0, +nS).map((s) => enc.encode(s)));
    const dd = zd.train(S, +size);
    const got = createHash("sha256").update(dd.bytes()).digest("hex");
    ok(got === sha, `${hour} ${nS} samples ${size} B dict matches Python (${got.slice(0, 12)})`);
  }

  // 3. Whole analysis on 20k events of the hour the post tested: none ~1.88, dict ~4.1.
  const lines = gunzipSync(readFileSync(`${dir}/2026-10-12-15.json.gz`)).toString("utf8").split("\n").filter((s) => s.trim());
  const t0 = Date.now();
  const r = analyze(zd, lines.slice(0, 20000).map((s) => enc.encode(s)));
  const row = (x) => `${x.cap / 1024}K ${x.ratio.toFixed(2)}`;
  console.log(`     none ${r.ratioNone.toFixed(2)} whole ${r.ratioWhole.toFixed(2)} | ${r.rows.map(row).join(" | ")} | ${Date.now() - t0} ms`);
  ok(Math.abs(r.ratioNone - 1.88) < 0.06, `no-dict ratio ${r.ratioNone.toFixed(2)} ~ post's 1.88`);
  ok(r.best.ratio > 3.9 && r.best.ratio < 4.4, `best dict ratio ${r.best.ratio.toFixed(2)} ~ post's 4.1`);
  ok(r.call === "yes", `call ${r.call}, pick ${r.pick.cap / 1024}K`);
} else console.log("skip   libzstd comparison (no DATA_DIR/pydict.txt)");

// 4. Random bytes: a dict must not be recommended.
// (Not an LCG's high byte: that repeats enough to compress 6.5x as a stream.)
const rnd = Array.from({ length: 300 }, (_, i) => new Uint8Array(Array.from({ length: 7 }, (_, j) =>
  [...createHash("sha256").update(`${i}.${j}`).digest()]).flat().slice(0, 200)));
const rr = analyze(zd, rnd);
ok(rr.call === "no", `random bytes: call ${rr.call} (none ${rr.ratioNone.toFixed(2)})`);
process.exit(fails ? 1 : 0);
