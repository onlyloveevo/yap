// Test preload: any fetch or WebSocket use fails loudly. Load it with
//   node -r ./tools/no-net.cjs scripts/replay.js ...
// (`-r` works on Node 18 and 22). Each use writes one "NETWORK CALL <kind>"
// line to stderr and throws, so a test can prove a run never touched the
// network instead of trusting that it did not.
'use strict';

function blocked(kind) {
  return function networkCall() {
    process.stderr.write(`NETWORK CALL ${kind}\n`);
    throw new Error(`network use is blocked in this run (${kind})`);
  };
}

for (const kind of ['fetch', 'WebSocket']) {
  Object.defineProperty(globalThis, kind, {
    value: blocked(kind),
    writable: true,
    configurable: true,
    enumerable: false,
  });
}
