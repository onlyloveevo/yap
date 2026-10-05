// Ratcliff/Obershelp similarity, written fresh from the published definition
// (find the longest matching block, recurse on the pieces left and right of it,
// ratio = 2·M / (len a + len b)). No code from Python's difflib is used.
// Browser-safe: no `node:` imports.

/**
 * Longest common contiguous block of a[alo:ahi] and b[blo:bhi]. Ties go to the block that
 * starts earliest in a, then earliest in b.
 * @param {ArrayLike<unknown>} a
 * @param {ArrayLike<unknown>} b
 * @returns {[number, number, number]} [i, j, size]
 */
function longestBlock(a, b, alo, ahi, blo, bhi) {
  let bestI = alo;
  let bestJ = blo;
  let best = 0;
  let prev = new Uint32Array(bhi - blo + 1);
  let cur = new Uint32Array(bhi - blo + 1);
  for (let i = alo; i < ahi; i++) {
    for (let j = blo; j < bhi; j++) {
      const k = a[i] === b[j] ? (j > blo ? prev[j - blo - 1] : 0) + 1 : 0;
      cur[j - blo] = k;
      if (k > best) {
        best = k;
        bestI = i - k + 1;
        bestJ = j - k + 1;
      }
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return [bestI, bestJ, best];
}

/**
 * Matching blocks of a and b in order of position, without the end sentinel.
 * @param {ArrayLike<unknown>} a
 * @param {ArrayLike<unknown>} b
 * @returns {Array<[number, number, number]>}
 */
export function matchingBlocks(a, b) {
  const blocks = [];
  const todo = [[0, a.length, 0, b.length]];
  while (todo.length) {
    const [alo, ahi, blo, bhi] = todo.pop();
    if (alo >= ahi || blo >= bhi) continue;
    const [i, j, k] = longestBlock(a, b, alo, ahi, blo, bhi);
    if (!k) continue;
    blocks.push([i, j, k]);
    todo.push([alo, i, blo, j], [i + k, ahi, j + k, bhi]);
  }
  return blocks.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
}

/**
 * Similarity of two strings or token arrays in [0, 1]; 1.0 when both are empty.
 * @param {string | ArrayLike<unknown>} a
 * @param {string | ArrayLike<unknown>} b
 */
export function sequenceRatio(a, b) {
  const total = a.length + b.length;
  if (!total) return 1.0;
  const matched = matchingBlocks(a, b).reduce((n, [, , k]) => n + k, 0);
  return (2 * matched) / total;
}
