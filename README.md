# zdict

Should I use a zstd dictionary? A static page at [zdict.wickkit.cc](https://zdict.wickkit.cc): paste or drop sample messages, and it trains zstd dictionaries of several sizes on most of them, then compresses the held-out rest one message at a time, with and without each dictionary. Everything runs in the browser.

- `wasm/zd.c`: a small C surface over libzstd (train, compress each, compress all).
- `wasm/build.sh`: fetches zstd 1.5.7 (checksum-checked) and builds `public/zd.wasm` with clang + wasi-libc. Needs Homebrew `llvm`, `lld`, `wasi-libc`, `wasi-runtimes`.
- `public/zd.js`: loads the wasm, splits train/test, measures, picks.
- `test/check.js`: round trip, random bytes get a "no", and (given GH Archive hours plus reference hashes from Python's `compression.zstd.train_dict`) byte-identical dictionaries to native libzstd.
- `test/browser.py`: runs the example in Chrome via Playwright.

MIT for this code. `public/zd.wasm` contains Zstandard, BSD-licensed (`public/zstd-LICENSE.txt`).
