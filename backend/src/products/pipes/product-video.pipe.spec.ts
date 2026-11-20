import { BadRequestException } from '@nestjs/common';
import { ProductVideoPipe, MAX_VIDEO_SIZE_BYTES } from './product-video.pipe';
import * as videoFile from '../utils/video-file';

describe('ProductVideoPipe', () => {
  const pipe = new ProductVideoPipe();
  const file = (bytes = 1000) =>
    ({ buffer: Buffer.alloc(bytes, 1) }) as Express.Multer.File;
  const inspected = (durationSeconds: number, codec = 'avc1') =>
    jest.spyOn(videoFile, 'inspectVideo').mockReturnValue({
      ok: true,
      video: { durationSeconds, videoCodecs: [codec] },
    });

  afterEach(() => jest.restoreAllMocks());

  const thrownBy = (run: () => unknown): Record<string, unknown> => {
    try {
      run();
    } catch (error) {
      return error as Record<string, unknown>;
    }
    throw new Error('expected the pipe to refuse the file');
  };

  it('accepts 30 seconds of H.264 and keeps its length', () => {
    inspected(30);

    expect(pipe.transform(file(2048))).toEqual({
      buffer: expect.any(Buffer),
      durationMs: 30_000,
      size: 2048,
    });
  });

  // Phones and editors round: a "30 second" clip is often 30.03.
  it('allows the half second a 30-second export runs over', () => {
    inspected(30.4);

    expect(pipe.transform(file()).durationMs).toBe(30_400);
  });

  it('refuses anything longer, saying how long it is', () => {
    inspected(31);

    expect(thrownBy(() => pipe.transform(file()))).toMatchObject({
      code: 'VIDEO_TOO_LONG',
      details: { seconds: 31, max: 30 },
    });
  });

  it('refuses HEVC, which most computers cannot play in a browser', () => {
    inspected(5, 'hvc1');

    expect(thrownBy(() => pipe.transform(file()))).toMatchObject({
      code: 'VIDEO_CODEC_UNSUPPORTED',
    });
  });

  it('refuses a file that is not a video', () => {
    jest
      .spyOn(videoFile, 'inspectVideo')
      .mockReturnValue({ ok: false, problem: 'not_mp4' });

    expect(thrownBy(() => pipe.transform(file()))).toMatchObject({
      code: 'VIDEO_INVALID',
    });
  });

  it('asks for a file when none came', () => {
    expect(() => pipe.transform(undefined)).toThrow(BadRequestException);
  });

  it('refuses a file over the size limit before reading it', () => {
    const spy = jest.spyOn(videoFile, 'inspectVideo');

    expect(() => pipe.transform(file(MAX_VIDEO_SIZE_BYTES + 1))).toThrow(
      BadRequestException,
    );
    expect(spy).not.toHaveBeenCalled();
  });
});
