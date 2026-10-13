import { load, analyze } from "./zd.js";

const zdP = fetch("zd.wasm").then((r) => r.arrayBuffer()).then(load);

onmessage = async ({ data: { msgs, level } }) => {
  try {
    const zd = await zdP;
    const r = analyze(zd, msgs, {
      level,
      onStep: (i, n, cap) => postMessage({ step: `training dictionary ${i + 1} of ${n} (${cap / 1024} KB)…` }),
    });
    postMessage({ result: r });
  } catch (e) {
    postMessage({ error: String(e.message || e) });
  }
};
