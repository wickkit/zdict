const $ = (id) => document.getElementById(id);
const enc = new TextEncoder();
const MAX = 64 << 20;
let worker, picked;

function kb(n) { return n < 1024 ? n + " B" : (n / 1024).toFixed(n < 10240 ? 1 : 0) + " KB"; }
function fmt(x, d = 2) { return x.toFixed(d); }
function show(id, on) { $(id).hidden = !on; }
function err(msg) { $("err").textContent = msg; show("err", !!msg); }

async function messages() {
  const files = [...$("files").files];
  const mode = $("split").value;
  if (files.length > 1) {
    if (files.reduce((s, f) => s + f.size, 0) > MAX) throw new Error("over 64 MB of input");
    return Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
  }
  let text = $("text").value;
  if (files.length === 1) {
    if (files[0].size > MAX) throw new Error("file is over 64 MB");
    text = await files[0].text();
  }
  if (text.length > MAX) throw new Error("over 64 MB of input");
  const parts = mode === "blank"
    ? text.split(/\r?\n\s*\r?\n/).map((s) => s.trim()).filter(Boolean)
    : text.split(/\r?\n/).filter((s) => s.trim());
  return parts.map((s) => enc.encode(s));
}

function render(r) {
  const tb = $("t").tBodies[0];
  tb.innerHTML = "";
  const perMsg = (c) => kb(Math.round(c / r.nTest));
  const top = r.ratioWhole;
  const row = (name, sub, ratio, c, gap, be, cls) => {
    const tr = tb.insertRow();
    if (cls) tr.className = cls;
    tr.innerHTML = `<td><span class="name"></span><span class="sub"></span></td><td class="num">${fmt(ratio)}×</td>`
      + `<td class="num">${c == null ? "–" : perMsg(c)}</td><td class="num">${gap}</td><td class="num">${be}</td>`
      + `<td class="barcell"><div class="track"><div class="bar"></div></div></td>`;
    tr.querySelector(".name").textContent = name;
    tr.querySelector(".sub").textContent = sub;
    tr.querySelector(".bar").style.width = Math.min(100, (100 * ratio) / top) + "%";
    return tr;
  };
  row("No dictionary", "each message alone", r.ratioNone, r.none, "0%", "–");
  for (const x of r.rows) {
    if (x.failed) {
      const tr = tb.insertRow();
      tr.className = "warn";
      tr.innerHTML = `<td colspan="6"></td>`;
      tr.cells[0].textContent = `${kb(x.cap)}: training failed (samples too small or too few for this size)`;
      continue;
    }
    const thin = x.samplesPerDict < 4;
    const sub = [x === r.pick && "picked", x.dictSize < x.cap && `trained ${kb(x.dictSize)}`,
      thin && `only ${fmt(x.samplesPerDict, 1)}× its size in samples`].filter(Boolean).join(" · ");
    const be = isFinite(x.breakEven) ? x.breakEven.toLocaleString() + " msgs" : "never";
    row(`${kb(x.cap)} dictionary`, sub, x.ratio, x.compressed, Math.round(100 * x.gapClosed) + "%", be,
      x === r.pick ? "pick" : thin ? "thin" : "");
  }
  row("Whole set as one stream", "ceiling, not per message", r.ratioWhole, r.whole, "100%", "–", "ceil");

  const p = r.pick;
  const head = {
    yes: `Yes. A ${p && kb(p.dictSize)} dictionary takes these messages from ${fmt(r.ratioNone)}× to ${fmt(p && p.ratio)}× (${fmt(r.gain)}× smaller).`,
    maybe: `Maybe. The best small dictionary only gets ${fmt(r.ratioNone)}× to ${fmt(p && p.ratio)}× (${fmt(r.gain)}× smaller); worth it if you send a lot of these.`,
    no: p ? `Probably not. A dictionary gets ${fmt(r.ratioNone)}× to ${fmt(p.ratio)}× at best.` : "No dictionary could be trained on this input.",
  }[r.call];
  $("verdict").textContent = head;
  $("verdict").className = "verdict " + r.call;
  $("foot").textContent = `Trained on ${r.nTrain.toLocaleString()} messages (${kb(r.trainBytes)}), tested on ${r.nTest.toLocaleString()} others; median message ${kb(r.medianSize)}; level ${r.level}.`
    + (r.ratioWhole < r.ratioNone * 1.15 ? " Even all together these barely compress: there's little shared structure for a dictionary to hold." : "")
    + (r.nTest < 50 ? " Small test set: treat the ratios as rough." : "");
  picked = p;
  show("dl", !!p);
  $("dlname").textContent = p ? `${kb(p.dictSize)}, use with ZSTD_createCDict / zstd -D` : "";
  show("out", true);
}

async function run() {
  err("");
  let msgs;
  try { msgs = await messages(); } catch (e) { return err(e.message); }
  if (msgs.length < 10) return err(`Need at least 10 messages; found ${msgs.length}. One per line, or switch "Split on".`);
  if (worker) worker.terminate();
  worker = new Worker("worker.js", { type: "module" });
  $("go").disabled = true;
  $("status").textContent = `${msgs.length.toLocaleString()} messages: measuring without a dictionary…`;
  worker.onmessage = ({ data }) => {
    if (data.step) { $("status").textContent = data.step; return; }
    $("go").disabled = false;
    $("status").textContent = "";
    if (data.error) return err(data.error);
    render(data.result);
  };
  worker.postMessage({ msgs, level: +$("level").value });
}

// A made-up API access log: the kind of small, repetitive JSON a dictionary is for.
function example() {
  let s = 42;
  const rnd = (n) => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) * n | 0;
  const pick = (a) => a[rnd(a.length)];
  const paths = ["/v1/orders", "/v1/orders/{id}", "/v1/users/{id}", "/v1/cart", "/v1/search", "/healthz", "/v1/payments/{id}/capture"];
  const ua = ["Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15", "okhttp/5.1.0", "python-requests/2.33.0", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/141.0"];
  const lines = [];
  for (let i = 0; i < 800; i++) {
    const path = pick(paths).replace("{id}", String(10000 + rnd(90000)));
    const st = pick([200, 200, 200, 200, 201, 204, 304, 400, 404, 500]);
    lines.push(JSON.stringify({
      ts: new Date(Date.UTC(2026, 9, 13, 14, 0, 0) + i * 731 + rnd(500)).toISOString(), level: st >= 500 ? "error" : "info",
      service: "api-gateway", method: path.includes("search") || path === "/healthz" ? "GET" : pick(["GET", "POST", "PUT"]),
      path, status: st, duration_ms: rnd(400) + 3, bytes: rnd(9000), request_id: rnd(2 ** 31).toString(16) + rnd(2 ** 31).toString(16),
      user_agent: pick(ua), region: pick(["us-east-1", "eu-west-1"]),
    }));
  }
  $("text").value = lines.join("\n");
  $("files").value = "";
  $("split").value = "line";
  run();
}

$("f").addEventListener("submit", (e) => { e.preventDefault(); run(); });
$("ex").addEventListener("click", example);
$("dl").addEventListener("click", () => {
  if (!picked) return;
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([picked.dict], { type: "application/octet-stream" }));
  a.download = `zstd-${Math.round(picked.dictSize / 1024)}k.dict`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
