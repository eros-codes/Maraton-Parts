import { inspectVideo } from './video-file';

// A minimal MP4, box by box: just enough structure for the inspector.
const box = (type: string, ...content: Buffer[]): Buffer => {
  const body = Buffer.concat(content);
  const header = Buffer.alloc(8);
  header.writeUInt32BE(body.length + 8, 0);
  header.write(type, 4, 'latin1');
  return Buffer.concat([header, body]);
};
const u32 = (...values: number[]) => {
  const out = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => out.writeUInt32BE(value, index * 4));
  return out;
};

const ftyp = box('ftyp', Buffer.from('isom'), u32(0x200), Buffer.from('isom'));
// version 0: flags, created, modified, timescale, duration
const mvhd = (timescale: number, duration: number) =>
  box('mvhd', u32(0, 0, 0, timescale, duration), Buffer.alloc(80));
const track = (handler: string, codec: string, trackId = 1) =>
  box(
    'trak',
    box('tkhd', u32(0, 0, 0, trackId), Buffer.alloc(68)),
    box(
      'mdia',
      box('mdhd', u32(0, 0, 0, 1000, 0), Buffer.alloc(4)),
      box('hdlr', u32(0, 0), Buffer.from(handler), Buffer.alloc(12)),
      box(
        'minf',
        box('stbl', box('stsd', u32(0, 1), box(codec, Buffer.alloc(78)))),
      ),
    ),
  );
const mp4 = (...moovChildren: Buffer[]) =>
  Buffer.concat([
    ftyp,
    box('moov', ...moovChildren),
    box('mdat', Buffer.alloc(16)),
  ]);

describe('inspectVideo', () => {
  it('reads the length and the picture encoding', () => {
    const result = inspectVideo(
      mp4(mvhd(1000, 12_500), track('vide', 'avc1'), track('soun', 'mp4a', 2)),
    );

    expect(result).toEqual({
      ok: true,
      video: { durationSeconds: 12.5, videoCodecs: ['avc1'] },
    });
  });

  // Where the moov box sits depends on the program that wrote the file.
  it('finds the moov box after the media data too', () => {
    const file = Buffer.concat([
      ftyp,
      box('mdat', Buffer.alloc(32)),
      box('moov', mvhd(600, 1800), track('vide', 'avc1')),
    ]);

    expect(inspectVideo(file)).toMatchObject({
      ok: true,
      video: { durationSeconds: 3 },
    });
  });

  it('reports HEVC as what it is, so it can be refused by name', () => {
    expect(inspectVideo(mp4(mvhd(1000, 5000), track('vide', 'hvc1')))).toEqual({
      ok: true,
      video: { durationSeconds: 5, videoCodecs: ['hvc1'] },
    });
  });

  it('turns away a file that is not an MP4 at all', () => {
    expect(inspectVideo(Buffer.from('GIF89a' + ' '.repeat(40)))).toEqual({
      ok: false,
      problem: 'not_mp4',
    });
    // WebM starts with the EBML magic instead of an ftyp box.
    expect(
      inspectVideo(Buffer.concat([u32(0x1a45dfa3), Buffer.alloc(40)])),
    ).toEqual({ ok: false, problem: 'not_mp4' });
  });

  it('turns away sound with no picture', () => {
    expect(inspectVideo(mp4(mvhd(1000, 5000), track('soun', 'mp4a')))).toEqual({
      ok: false,
      problem: 'no_video',
    });
  });

  // Cut off mid-upload: the boxes claim more than is there.
  it('does not read past the end of a truncated file', () => {
    const whole = mp4(mvhd(1000, 5000), track('vide', 'avc1'));
    const cut = whole.subarray(0, ftyp.length + 20);

    expect(inspectVideo(cut)).toEqual({ ok: false, problem: 'unreadable' });
  });

  it('adds up the fragments of a fragmented MP4 that states no length', () => {
    const moof = (sampleCount: number, sampleDuration: number) =>
      box(
        'moof',
        box(
          'traf',
          // tfhd: flags 0x08 (default-sample-duration), track 1, duration
          box('tfhd', u32(0x08, 1, sampleDuration)),
          // trun: no per-sample durations, so each uses the default
          box('trun', u32(0, sampleCount)),
        ),
      );
    const file = Buffer.concat([
      ftyp,
      box('moov', mvhd(1000, 0), track('vide', 'avc1'), box('mvex')),
      moof(30, 100),
      box('mdat', Buffer.alloc(8)),
      moof(15, 100),
      box('mdat', Buffer.alloc(8)),
    ]);

    // 45 samples x 100 / 1000 (mdhd timescale) = 4.5 seconds
    expect(inspectVideo(file)).toMatchObject({
      ok: true,
      video: { durationSeconds: 4.5 },
    });
  });
});
