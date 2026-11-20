import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/error-codes';
import { inspectVideo, PLAYABLE_VIDEO_CODECS } from '../utils/video-file';

// 30 seconds of 1080p from a phone is 20-60 MB; much past 50 is a file
// that would also take customers too long to load. nginx accepts 55 MB.
export const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;
export const MAX_VIDEO_SECONDS = 30;
// Editors and phones round: a "30 second" clip is often 30.03.
const DURATION_TOLERANCE_SECONDS = 0.5;

export interface ValidatedVideo {
  buffer: Buffer;
  durationMs: number;
  size: number;
}

@Injectable()
export class ProductVideoPipe implements PipeTransform<
  Express.Multer.File | undefined,
  ValidatedVideo
> {
  transform(file: Express.Multer.File | undefined): ValidatedVideo {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Upload a video in the "video" field');
    }
    if (file.buffer.length > MAX_VIDEO_SIZE_BYTES) {
      throw new BadRequestException('The video is larger than 50MB');
    }

    const result = inspectVideo(file.buffer);
    if (!result.ok) {
      throw AppError.badRequest(
        ErrorCodes.VIDEO_INVALID,
        result.problem === 'no_video'
          ? 'The file has sound but no picture'
          : 'The file is not an MP4 video, or it is damaged',
        { problem: result.problem },
      );
    }

    const { durationSeconds, videoCodecs } = result.video;
    if (!videoCodecs.some((codec) => PLAYABLE_VIDEO_CODECS.includes(codec))) {
      throw AppError.badRequest(
        ErrorCodes.VIDEO_CODEC_UNSUPPORTED,
        `The video is encoded as ${videoCodecs.join(', ')}, which not every browser plays - export it as H.264`,
        { codec: videoCodecs[0] },
      );
    }
    if (durationSeconds > MAX_VIDEO_SECONDS + DURATION_TOLERANCE_SECONDS) {
      throw AppError.badRequest(
        ErrorCodes.VIDEO_TOO_LONG,
        `The video is ${durationSeconds.toFixed(1)} seconds long; at most ${MAX_VIDEO_SECONDS} are allowed`,
        {
          seconds: Math.round(durationSeconds * 10) / 10,
          max: MAX_VIDEO_SECONDS,
        },
      );
    }

    return {
      buffer: file.buffer,
      durationMs: Math.round(durationSeconds * 1000),
      size: file.buffer.length,
    };
  }
}
