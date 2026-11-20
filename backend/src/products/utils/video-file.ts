// Reads what the shop needs to know about an uploaded product video
// straight from the file - its length and how its picture is encoded -
// without ffmpeg on the server and without trusting what the browser said.
//
// MP4 (and QuickTime .mov, the same container) is a tree of "boxes": a
// 4-byte size, a 4-byte type, then the content. The length is in
// moov/mvhd; each track's encoding is the first sample entry in
// moov/trak/mdia/minf/stbl/stsd, and moov/trak/mdia/hdlr says whether the
// track is picture or sound. moov can sit at the start or the end of the
// file; both are fine.

export interface InspectedVideo {
  durationSeconds: number;
  // Sample-entry types of the picture tracks: 'avc1', 'hvc1', ...
  videoCodecs: string[];
}

export type VideoProblem =
  | 'not_mp4' // not an MP4/MOV file at all
  | 'unreadable' // looks like one, but the parts that matter are missing
  | 'no_video'; // only sound

export type InspectionResult =
  { ok: true; video: InspectedVideo } | { ok: false; problem: VideoProblem };

// H.264: plays in every browser, Safari on iPhone included. HEVC (hvc1 /
// hev1), what iPhones record by default, does not play in Chrome or
// Firefox on most computers - a video customers could not watch.
export const PLAYABLE_VIDEO_CODECS = ['avc1', 'avc3'];

interface Box {
  type: string;
  start: number; // where the content begins (after the header)
  end: number; // one past the last byte
}

// The boxes directly inside [from, to). Stops quietly at anything that does
// not add up, rather than reading past the end.
function childBoxes(buffer: Buffer, from: number, to: number): Box[] {
  const boxes: Box[] = [];
  let offset = from;
  while (offset + 8 <= to) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    let header = 8;
    if (size === 1) {
      if (offset + 16 > to) break;
      const large = buffer.readBigUInt64BE(offset + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = to - offset; // runs to the end of its parent
    }
    if (size < header || offset + size > to) break;
    boxes.push({ type, start: offset + header, end: offset + size });
    offset += size;
  }
  return boxes;
}

function child(buffer: Buffer, box: Box, type: string): Box | undefined {
  return childBoxes(buffer, box.start, box.end).find((b) => b.type === type);
}

// mvhd and mehd: version 1 uses 64-bit times.
function readMovieDuration(buffer: Buffer, mvhd: Box): number | null {
  if (mvhd.end - mvhd.start < 20) return null;
  const version = buffer[mvhd.start];
  let timescale: number;
  let duration: number;
  if (version === 1) {
    if (mvhd.end - mvhd.start < 32) return null;
    timescale = buffer.readUInt32BE(mvhd.start + 20);
    duration = Number(buffer.readBigUInt64BE(mvhd.start + 24));
  } else {
    timescale = buffer.readUInt32BE(mvhd.start + 12);
    duration = buffer.readUInt32BE(mvhd.start + 16);
  }
  if (!timescale || duration === 0xffffffff) return null;
  return duration / timescale;
}

// A fragmented MP4 (what some apps and screen recorders write) often
// leaves mvhd at zero and states the length in moov/mvex/mehd instead.
function readFragmentDuration(
  buffer: Buffer,
  moov: Box,
  timescale: number,
): number | null {
  const mvex = child(buffer, moov, 'mvex');
  const mehd = mvex && child(buffer, mvex, 'mehd');
  if (!mehd || !timescale) return null;
  const version = buffer[mehd.start];
  const duration =
    version === 1
      ? Number(buffer.readBigUInt64BE(mehd.start + 4))
      : buffer.readUInt32BE(mehd.start + 4);
  return duration ? duration / timescale : null;
}

function movieTimescale(buffer: Buffer, mvhd: Box): number {
  const version = buffer[mvhd.start];
  return buffer.readUInt32BE(mvhd.start + (version === 1 ? 20 : 12));
}

// The last resort for a fragmented file with no stated length (ffmpeg's
// empty_moov, many screen recorders): add up the sample durations of one
// track across every fragment (moof/traf/trun), in that track's own
// timescale (mdia/mdhd).
function summedFragmentDuration(
  buffer: Buffer,
  top: Box[],
  moov: Box,
): number | null {
  const traks = childBoxes(buffer, moov.start, moov.end).filter(
    (box) => box.type === 'trak',
  );
  const trak = traks.find((t) => trackCodec(buffer, t)?.handler === 'vide');
  const tkhd = trak && child(buffer, trak, 'tkhd');
  const mdia = trak && child(buffer, trak, 'mdia');
  const mdhd = mdia && child(buffer, mdia, 'mdhd');
  if (!tkhd || !mdhd) return null;

  const trackId = buffer.readUInt32BE(
    tkhd.start + (buffer[tkhd.start] === 1 ? 20 : 12),
  );
  const timescale = buffer.readUInt32BE(
    mdhd.start + (buffer[mdhd.start] === 1 ? 20 : 12),
  );
  if (!timescale) return null;

  // moov/mvex/trex: the default sample duration for this track.
  let trexDefault = 0;
  const mvex = child(buffer, moov, 'mvex');
  for (const trex of mvex ? childBoxes(buffer, mvex.start, mvex.end) : []) {
    if (
      trex.type === 'trex' &&
      buffer.readUInt32BE(trex.start + 4) === trackId
    ) {
      trexDefault = buffer.readUInt32BE(trex.start + 12);
    }
  }

  let total = 0;
  for (const moof of top.filter((box) => box.type === 'moof')) {
    for (const traf of childBoxes(buffer, moof.start, moof.end)) {
      if (traf.type !== 'traf') continue;
      const tfhd = child(buffer, traf, 'tfhd');
      if (!tfhd || buffer.readUInt32BE(tfhd.start + 4) !== trackId) continue;

      // tfhd: optional fields follow the track id, in this order.
      const tfhdFlags = buffer.readUInt32BE(tfhd.start) & 0xffffff;
      let at = tfhd.start + 8;
      if (tfhdFlags & 0x01) at += 8; // base-data-offset
      if (tfhdFlags & 0x02) at += 4; // sample-description-index
      const defaultDuration =
        tfhdFlags & 0x08 ? buffer.readUInt32BE(at) : trexDefault;

      for (const trun of childBoxes(buffer, traf.start, traf.end)) {
        if (trun.type !== 'trun') continue;
        const flags = buffer.readUInt32BE(trun.start) & 0xffffff;
        const count = buffer.readUInt32BE(trun.start + 4);
        let pos = trun.start + 8;
        if (flags & 0x01) pos += 4; // data-offset
        if (flags & 0x04) pos += 4; // first-sample-flags
        if (!(flags & 0x100)) {
          total += count * defaultDuration;
          continue;
        }
        const perSample =
          4 +
          (flags & 0x200 ? 4 : 0) +
          (flags & 0x400 ? 4 : 0) +
          (flags & 0x800 ? 4 : 0);
        for (let i = 0; i < count; i += 1) {
          if (pos + 4 > trun.end) return null;
          total += buffer.readUInt32BE(pos);
          pos += perSample;
        }
      }
    }
  }
  return total ? total / timescale : null;
}

function trackCodec(
  buffer: Buffer,
  trak: Box,
): { handler: string; codec: string } | null {
  const mdia = child(buffer, trak, 'mdia');
  const hdlr = mdia && child(buffer, mdia, 'hdlr');
  const minf = mdia && child(buffer, mdia, 'minf');
  const stbl = minf && child(buffer, minf, 'stbl');
  const stsd = stbl && child(buffer, stbl, 'stsd');
  if (!hdlr || !stsd || hdlr.end - hdlr.start < 12) return null;
  // hdlr: version/flags (4), pre_defined (4), handler_type (4)
  const handler = buffer.toString('latin1', hdlr.start + 8, hdlr.start + 12);
  // stsd: version/flags (4), entry_count (4), then the sample entries
  const entries = childBoxes(buffer, stsd.start + 8, stsd.end);
  if (entries.length === 0) return null;
  return { handler, codec: entries[0].type };
}

export function inspectVideo(buffer: Buffer): InspectionResult {
  if (buffer.length < 16) return { ok: false, problem: 'not_mp4' };

  const top = childBoxes(buffer, 0, buffer.length);
  // Every MP4/MOV a camera, phone or editor writes opens with ftyp.
  if (top[0]?.type !== 'ftyp') return { ok: false, problem: 'not_mp4' };

  const moov = top.find((box) => box.type === 'moov');
  const mvhd = moov && child(buffer, moov, 'mvhd');
  if (!moov || !mvhd) return { ok: false, problem: 'unreadable' };

  let durationSeconds = readMovieDuration(buffer, mvhd);
  if (!durationSeconds) {
    durationSeconds = readFragmentDuration(
      buffer,
      moov,
      movieTimescale(buffer, mvhd),
    );
  }
  if (!durationSeconds) {
    durationSeconds = summedFragmentDuration(buffer, top, moov);
  }
  if (!durationSeconds || !Number.isFinite(durationSeconds)) {
    return { ok: false, problem: 'unreadable' };
  }

  const videoCodecs = childBoxes(buffer, moov.start, moov.end)
    .filter((box) => box.type === 'trak')
    .map((trak) => trackCodec(buffer, trak))
    .filter((track) => track?.handler === 'vide')
    .map((track) => track!.codec);
  if (videoCodecs.length === 0) return { ok: false, problem: 'no_video' };

  return { ok: true, video: { durationSeconds, videoCodecs } };
}
