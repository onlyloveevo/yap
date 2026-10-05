// PNG checks and a blank tile for caption export. The browser draws each cue as
// a transparent PNG tile; the server never trusts one. A tile is accepted only
// when it is a well-formed 8-bit RGBA PNG of exactly the tile size, small
// enough, with every chunk's length and checksum right.
//
// Node built-ins only. Nothing here touches the disk.

import zlib from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

/** @param {Uint8Array} bytes */
export function crc32(bytes, seed = 0) {
  let c = ~seed >>> 0;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export class CaptionTileError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'CaptionTileError';
  }
}

/**
 * Check one tile. Returns its size, or throws CaptionTileError saying what is wrong.
 * @param {Uint8Array} bytes
 * @param {{ width: number, height: number, maxBytes: number }} want
 */
export function checkTilePng(bytes, { width, height, maxBytes }) {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 57) throw new CaptionTileError('a caption picture is too small to be a PNG');
  if (buf.length > maxBytes) throw new CaptionTileError(`a caption picture is larger than ${Math.round(maxBytes / 1024)} KB`);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new CaptionTileError('a caption picture is not a PNG');
  let at = 8;
  let sawHeader = false;
  let sawData = false;
  let sawEnd = false;
  while (at + 12 <= buf.length) {
    const length = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    if (at + 12 + length > buf.length) throw new CaptionTileError('a caption picture is cut short');
    const body = buf.subarray(at + 8, at + 8 + length);
    const crc = buf.readUInt32BE(at + 8 + length);
    if (crc32(buf.subarray(at + 4, at + 8 + length)) !== crc) throw new CaptionTileError('a caption picture failed its checksum');
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new CaptionTileError('a caption picture has no header');
      const w = body.readUInt32BE(0);
      const h = body.readUInt32BE(4);
      if (w !== width || h !== height) throw new CaptionTileError(`a caption picture is ${w}x${h}, not ${width}x${height}`);
      if (body[8] !== 8 || body[9] !== 6) throw new CaptionTileError('a caption picture is not 8-bit RGBA');
      if (body[12] !== 0) throw new CaptionTileError('a caption picture is interlaced');
      sawHeader = true;
    } else if (type === 'IDAT') sawData = true;
    else if (type === 'IEND') { sawEnd = true; at += 12 + length; break; }
    at += 12 + length;
  }
  if (!sawHeader || !sawData || !sawEnd) throw new CaptionTileError('a caption picture is missing a part');
  if (at !== buf.length) throw new CaptionTileError('a caption picture has bytes after its end');
  return { width, height, bytes: buf.length };
}

function chunk(type, body) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
  return Buffer.concat([head, body, crc]);
}

/** A fully transparent RGBA PNG of the given size (the picture shown where no caption is). */
export function blankTilePng(width, height) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc(height * (1 + width * 4));
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
