// The duration of an MP4 file, read from its own header (INST-02; D-70).
//
// An MP4 file is a row of boxes. Each box starts with its size and a four-letter type. The movie
// header box, `mvhd`, sits inside the `moov` box and holds the movie's duration and its timescale
// (ticks per second). This module walks the top-level boxes to `moov`, finds `mvhd` inside it, and
// returns duration divided by timescale.
//
// It works only on the bytes it is given. It has no imports, reads no file and starts no outside
// tool, so the test of D-70 measures the rendered video without trusting the tool that rendered it.
//
// The sizes in a file decide where the reader looks next (threat T-01.1-36). Every size is checked
// against the end of the bytes, and against the smallest size a box can have, before it is used. A
// broken file ends in Mp4ReadError: it cannot make the reader loop or read outside the bytes.

/** Thrown when the bytes are not an MP4 file this reader can take a duration from. */
export class Mp4ReadError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'Mp4ReadError';
  }
}

/** A box header: a 32-bit size and a four-letter type. */
const HEADER_BYTES = 8;
/** A box header in the 64-bit form: the size field holds 1 and the real size follows in 8 bytes. */
const BIG_HEADER_BYTES = 16;

/**
 * @param {unknown} buffer
 * @returns {DataView} a view of exactly the bytes given
 */
function viewOf(buffer) {
  if (buffer instanceof ArrayBuffer) return new DataView(buffer);
  if (ArrayBuffer.isView(buffer)) return new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  throw new Mp4ReadError('mp4Duration needs the bytes of an MP4 file (a Buffer, a Uint8Array or an ArrayBuffer)');
}

/**
 * Read one box header at `at`. The box must lie wholly before `end`.
 * @param {DataView} view
 * @param {number} at
 * @param {number} end where the enclosing box (or the file) ends
 * @param {boolean} topLevel a size of 0 means "to the end of the file", and only a top-level box may say so
 * @returns {{ type: string, body: number, next: number }} where its contents start and where the next box starts
 */
function readBox(view, at, end, topLevel) {
  if (at + HEADER_BYTES > end) throw new Mp4ReadError(`not an MP4 file: the box at byte ${at} is cut off`);
  let size = view.getUint32(at);
  const type = String.fromCharCode(view.getUint8(at + 4), view.getUint8(at + 5), view.getUint8(at + 6), view.getUint8(at + 7));
  let header = HEADER_BYTES;
  if (size === 1) {
    if (at + BIG_HEADER_BYTES > end) throw new Mp4ReadError(`not an MP4 file: the 64-bit size of the box at byte ${at} is cut off`);
    const big = view.getBigUint64(at + 8);
    if (big > BigInt(end - at)) throw new Mp4ReadError(`not an MP4 file: the box at byte ${at} says it runs past the end`);
    size = Number(big);
    header = BIG_HEADER_BYTES;
  } else if (size === 0) {
    if (!topLevel) throw new Mp4ReadError(`not an MP4 file: the box at byte ${at} inside moov has size 0`);
    size = end - at;
  }
  if (size < header) throw new Mp4ReadError(`not an MP4 file: the box at byte ${at} is smaller than its own header`);
  if (size > end - at) throw new Mp4ReadError(`not an MP4 file: the box at byte ${at} says it runs past the end`);
  return { type, body: at + header, next: at + size };
}

/**
 * Duration divided by timescale, from the contents of an `mvhd` box.
 * Version 0 holds 32-bit times, version 1 holds 64-bit times.
 * @param {DataView} view
 * @param {number} body where the box's contents start
 * @param {number} end where the box ends
 * @param {string} [label] how errors name the box (mdhd has the same layout as mvhd)
 * @returns {number} seconds
 */
function readMovieHeader(view, body, end, label = 'movie header (mvhd)') {
  if (body + 1 > end) throw new Mp4ReadError(`the ${label} is empty`);
  const version = view.getUint8(body);
  let timescale;
  let duration;
  if (version === 0) {
    // version and flags (4), created (4), modified (4), timescale (4), duration (4)
    if (body + 20 > end) throw new Mp4ReadError(`the ${label} is too short for its fields`);
    timescale = view.getUint32(body + 12);
    const ticks = view.getUint32(body + 16);
    if (ticks === 0xffffffff) throw new Mp4ReadError(`the ${label} does not state a duration`);
    duration = ticks;
  } else if (version === 1) {
    // version and flags (4), created (8), modified (8), timescale (4), duration (8)
    if (body + 32 > end) throw new Mp4ReadError(`the ${label} is too short for its fields`);
    timescale = view.getUint32(body + 20);
    const ticks = view.getBigUint64(body + 24);
    if (ticks === 0xffffffffffffffffn) throw new Mp4ReadError(`the ${label} does not state a duration`);
    duration = Number(ticks);
  } else {
    throw new Mp4ReadError(`the ${label} has version ${version}; this reader takes 0 and 1`);
  }
  if (timescale === 0) throw new Mp4ReadError(`the ${label} has a timescale of 0`);
  return duration / timescale;
}

/**
 * The duration of an MP4 file in seconds, read from its `mvhd` box.
 * @param {Buffer | Uint8Array | ArrayBuffer} buffer the file's bytes; never changed
 * @returns {number} seconds
 * @throws {Mp4ReadError} when the bytes are not an MP4, hold no `moov` or no `mvhd`, or state a size that cannot be right
 */
export function mp4Duration(buffer) {
  const view = viewOf(buffer);
  const fileEnd = view.byteLength;
  let at = 0;
  while (at < fileEnd) {
    const top = readBox(view, at, fileEnd, true);
    if (top.type === 'moov') {
      let inner = top.body;
      while (inner < top.next) {
        const child = readBox(view, inner, top.next, false);
        if (child.type === 'mvhd') return readMovieHeader(view, child.body, child.next);
        inner = child.next;
      }
      throw new Mp4ReadError('not an MP4 file this reader can time: its moov box holds no movie header (mvhd)');
    }
    at = top.next;
  }
  throw new Mp4ReadError('not an MP4 file: no moov box was found');
}

/**
 * The handler type in a `hdlr` box's contents: version and flags (4), pre_defined (4), then the type.
 * @returns {string} four letters, such as 'vide' or 'soun'
 */
function readHandlerType(view, body, end) {
  if (body + 12 > end) throw new Mp4ReadError('a handler box (hdlr) is too short for its fields');
  return String.fromCharCode(view.getUint8(body + 8), view.getUint8(body + 9), view.getUint8(body + 10), view.getUint8(body + 11));
}

/**
 * The duration of one track's media, if it is a video track. Null for any other kind of track.
 * @returns {number | null} seconds
 */
function videoTrackDuration(view, trak) {
  let mdia = null;
  for (let at = trak.body; at < trak.next;) {
    const child = readBox(view, at, trak.next, false);
    if (child.type === 'mdia') mdia = child;
    at = child.next;
  }
  if (!mdia) throw new Mp4ReadError('a track (trak) holds no media box (mdia)');
  let handler = null;
  let header = null;
  for (let at = mdia.body; at < mdia.next;) {
    const child = readBox(view, at, mdia.next, false);
    if (child.type === 'hdlr') handler = readHandlerType(view, child.body, child.next);
    else if (child.type === 'mdhd') header = child;
    at = child.next;
  }
  if (handler === null) throw new Mp4ReadError('a track (trak) holds no handler box (hdlr)');
  if (handler !== 'vide') return null;
  if (!header) throw new Mp4ReadError('the video track holds no media header (mdhd)');
  return readMovieHeader(view, header.body, header.next, 'video media header (mdhd)');
}

/**
 * The duration of the VIDEO track in seconds, read from the track's own media header (`mdhd`).
 * `mp4Duration` reads the whole movie, which is the longest track: a file whose audio runs an hour
 * and whose video stops at fifteen minutes reports an hour there. This reads the video alone.
 * A file with no video track, or with more than one, is refused rather than guessed at.
 * @param {Buffer | Uint8Array | ArrayBuffer} buffer the file's bytes (or just its `moov` box); never changed
 * @returns {number} seconds
 * @throws {Mp4ReadError} when the bytes are not an MP4, or hold no video track, or more than one, or a malformed one
 */
export function mp4VideoDuration(buffer) {
  const view = viewOf(buffer);
  const fileEnd = view.byteLength;
  for (let at = 0; at < fileEnd;) {
    const top = readBox(view, at, fileEnd, true);
    if (top.type === 'moov') {
      const durations = [];
      for (let inner = top.body; inner < top.next;) {
        const child = readBox(view, inner, top.next, false);
        if (child.type === 'trak') {
          const seconds = videoTrackDuration(view, child);
          if (seconds !== null) durations.push(seconds);
        }
        inner = child.next;
      }
      if (durations.length === 0) throw new Mp4ReadError('the MP4 file holds no video track');
      if (durations.length > 1) throw new Mp4ReadError(`the MP4 file holds ${durations.length} video tracks; this reader times exactly one`);
      return durations[0];
    }
    at = top.next;
  }
  throw new Mp4ReadError('not an MP4 file: no moov box was found');
}
