import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response as ExpressResponse } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AgentKeyAuthGuard } from '../../otlp/guards/agent-key-auth.guard';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { ProxyExceptionFilter } from '../proxy/proxy-exception.filter';
import { AudioService } from './audio.service';
import { maxAudioFileBytes, type AudioUpload } from './audio-validation';

/**
 * OpenAI-compatible speech-to-text surface.
 *
 *   POST /v1/audio/transcriptions     audio → text (multipart)
 *   POST /v1/audio/translations       audio → English text (multipart)
 *   GET  /v1/audio/transcriptions/{id}   poll a stored task (local transcript)
 *
 * `X-Manifest-Async: true` (or the `async` form field) makes POST return a
 * pollable task object instead of the transcript itself.
 */
@Controller('v1')
@Public()
@UseGuards(AgentKeyAuthGuard)
@UseFilters(ProxyExceptionFilter)
@SkipThrottle()
export class AudioController {
  constructor(private readonly audioService: AudioService) {}

  @Post('audio/transcriptions')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxAudioFileBytes() } }))
  async transcriptions(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @UploadedFile() file?: MulterFile,
  ): Promise<void> {
    await this.handlePost(req, res, file, 'transcriptions');
  }

  @Post('audio/translations')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maxAudioFileBytes() } }))
  async translations(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @UploadedFile() file?: MulterFile,
  ): Promise<void> {
    await this.handlePost(req, res, file, 'translations');
  }

  @Get('audio/transcriptions/:id')
  async transcriptionStatus(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('id') id: string,
  ): Promise<void> {
    await this.handleStatus(req, res, id);
  }

  @Get('audio/translations/:id')
  async translationStatus(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('id') id: string,
  ): Promise<void> {
    await this.handleStatus(req, res, id);
  }

  private async handlePost(
    req: Request & { ingestionContext: IngestionContext },
    res: ExpressResponse,
    file: AudioUpload | undefined,
    apiMode: 'transcriptions' | 'translations',
  ): Promise<void> {
    const clientAbort = new AbortController();
    res.once('close', () => clientAbort.abort());
    const header = req.headers['x-manifest-async'];
    const headerAsync = Array.isArray(header) ? header[0] : header;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const formAsync = body['async'];
    const isAsync =
      headerAsync === 'true' ||
      formAsync === true ||
      formAsync === 'true' ||
      (Array.isArray(formAsync) && formAsync.includes('true'));

    const result = await this.audioService.handle({
      ctx: req.ingestionContext,
      body,
      headers: req.headers,
      file: toUpload(file),
      apiMode,
      ip: req.ip,
      signal: clientAbort.signal,
      async: isAsync,
    });
    if (!res.writableEnded) res.status(result.status).json(result.body);
  }

  private async handleStatus(
    req: Request & { ingestionContext: IngestionContext },
    res: ExpressResponse,
    id: string,
  ): Promise<void> {
    const result = await this.audioService.taskStatus(req.ingestionContext, id);
    if (!res.writableEnded) res.status(result.status).json(result.body);
  }
}

/** Multer's file uses `originalname`/`mimetype`; keep only what we forward. */
type MulterFile = AudioUpload & { originalname?: string; mimetype?: string };

function toUpload(file: MulterFile | undefined): AudioUpload | undefined {
  if (!file?.buffer?.length) return undefined;
  return {
    buffer: file.buffer,
    size: file.size ?? file.buffer.length,
    filename: file.filename || file.originalname || 'audio',
    contentType: file.contentType || file.mimetype || 'application/octet-stream',
  };
}
