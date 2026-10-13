#!/bin/sh
# Build public/zd.wasm from vendored zstd 1.5.7 (fetched + checksum-checked).
set -eu
cd "$(dirname "$0")/.."
V=1.5.7
SHA=eb33e51f49a15e023950cd7825ca74a4a2b43db8354825ac24fc1b7ee09e6fa3
Z=vendor/zstd-$V
if [ ! -d "$Z" ]; then
  mkdir -p vendor
  curl -sSL -o vendor/zstd-$V.tar.gz https://github.com/facebook/zstd/releases/download/v$V/zstd-$V.tar.gz
  echo "$SHA  vendor/zstd-$V.tar.gz" | shasum -a 256 -c -
  tar -C vendor -xzf vendor/zstd-$V.tar.gz
fi
CC=/opt/homebrew/opt/llvm/bin/clang
SYS=/opt/homebrew/share/wasi-sysroot
SRCS=$(ls $Z/lib/common/*.c $Z/lib/compress/*.c $Z/lib/decompress/*.c $Z/lib/dictBuilder/*.c)
$CC --target=wasm32-wasip1 --sysroot=$SYS -O2 -flto -Wno-deprecated-declarations \
  -fuse-ld=/opt/homebrew/opt/lld/bin/wasm-ld \
  -DZSTD_DISABLE_ASM-DZSTD_NO_TRACE -DXXH_NAMESPACE=ZSTD_ \
  -DDEBUGLEVEL=0 -D_WASI_EMULATED_PROCESS_CLOCKS -DZDICT_QSORT=ZDICT_QSORT_C90 \
  -I$Z/lib -I$Z/lib/common -mexec-model=reactor \
  -Wl,--strip-all -Wl,-z,stack-size=1048576 \
  -o public/zd.wasm wasm/zd.c $SRCS -lwasi-emulated-process-clocks
ls -l public/zd.wasm
