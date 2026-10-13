// Thin wasm surface over libzstd 1.5.7: train a dictionary, then compress
// each message on its own with and without it. JS owns the buffers.
#include <stdlib.h>
#define ZSTD_STATIC_LINKING_ONLY
#define ZDICT_STATIC_LINKING_ONLY
#include "zstd.h"
#include "zdict.h"

#define EXPORT(name) __attribute__((export_name(#name)))

EXPORT(zd_malloc) void *zd_malloc(size_t n) { return malloc(n); }
EXPORT(zd_free) void zd_free(void *p) { free(p); }

// Returns dict size, or 0 on failure (too few/too small samples).
EXPORT(zd_train)
size_t zd_train(void *dict, size_t cap, const void *samples,
                const size_t *sizes, unsigned n) {
  size_t r = ZDICT_trainFromBuffer(dict, cap, samples, sizes, n);
  return ZDICT_isError(r) ? 0 : r;
}

// Compress messages [0,n) one at a time; write each compressed size into
// out[i] and return the total, or (size_t)-1 on error. dictSize 0 = no dict.
// scratch must hold ZSTD_compressBound(largest message).
EXPORT(zd_compress_each)
size_t zd_compress_each(const void *msgs, const size_t *sizes, unsigned n,
                        const void *dict, size_t dictSize, int level,
                        void *scratch, size_t scratchCap, size_t *out) {
  ZSTD_CCtx *cctx = ZSTD_createCCtx();
  ZSTD_CDict *cdict = dictSize ? ZSTD_createCDict(dict, dictSize, level) : NULL;
  if (!cctx || (dictSize && !cdict)) return (size_t)-1;
  const char *p = msgs;
  size_t total = 0;
  for (unsigned i = 0; i < n; i++) {
    size_t r = cdict
      ? ZSTD_compress_usingCDict(cctx, scratch, scratchCap, p, sizes[i], cdict)
      : ZSTD_compressCCtx(cctx, scratch, scratchCap, p, sizes[i], level);
    if (ZSTD_isError(r)) { total = (size_t)-1; break; }
    if (out) out[i] = r;
    total += r;
    p += sizes[i];
  }
  ZSTD_freeCDict(cdict);
  ZSTD_freeCCtx(cctx);
  return total;
}

// Whole buffer as one frame: the ceiling a dictionary is chasing.
EXPORT(zd_compress_all)
size_t zd_compress_all(const void *src, size_t n, int level, void *dst, size_t cap) {
  size_t r = ZSTD_compress(dst, cap, src, n, level);
  return ZSTD_isError(r) ? (size_t)-1 : r;
}

EXPORT(zd_bound) size_t zd_bound(size_t n) { return ZSTD_compressBound(n); }

// Round-trip check used by the test: decompress with the dict.
EXPORT(zd_decompress)
size_t zd_decompress(void *dst, size_t cap, const void *src, size_t n,
                     const void *dict, size_t dictSize) {
  ZSTD_DCtx *d = ZSTD_createDCtx();
  size_t r = ZSTD_decompress_usingDict(d, dst, cap, src, n, dict, dictSize);
  ZSTD_freeDCtx(d);
  return ZSTD_isError(r) ? (size_t)-1 : r;
}

EXPORT(zd_compress_one)
size_t zd_compress_one(void *dst, size_t cap, const void *src, size_t n,
                       const void *dict, size_t dictSize, int level) {
  ZSTD_CCtx *c = ZSTD_createCCtx();
  size_t r = ZSTD_compress_usingDict(c, dst, cap, src, n, dict, dictSize, level);
  ZSTD_freeCCtx(c);
  return ZSTD_isError(r) ? (size_t)-1 : r;
}
