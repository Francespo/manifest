import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response as ExpressResponse } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { MODEL_CATALOG_VARIANTS, isModelCatalogVariant } from 'manifest-shared';
import { Public } from '../../common/decorators/public.decorator';
import { AgentKeyAuthGuard } from '../../otlp/guards/agent-key-auth.guard';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { ProxyExceptionFilter } from '../proxy/proxy-exception.filter';
import { MediaService } from './media.service';

/**
 * OpenAI-compatible media generation surface.
 *
 *   POST /v1/images/generations   synchronous image generation
 *   POST /v1/videos               asynchronous video task creation
 *   GET  /v1/videos/{id}          video task status (and cost finalization)
 *
 * The same handlers are mounted under `/catalog/:variant/v1` so a client can
 * switch model catalogs by changing only its base URL. Media routing itself is
 * never scoped — `@Param('variant')` exists only to reject unknown catalogs.
 */
@Controller(['v1', 'catalog/:variant/v1'])
@Public()
@UseGuards(AgentKeyAuthGuard)
@UseFilters(ProxyExceptionFilter)
@SkipThrottle()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  private parseVariant(variant?: string): void {
    if (variant === undefined) return;
    if (!isModelCatalogVariant(variant)) {
      throw new NotFoundException(
        `Unknown model catalog "${variant}". Available: ${MODEL_CATALOG_VARIANTS.join(', ')}.`,
      );
    }
  }

  @Post('images/generations')
  async images(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant?: string,
  ): Promise<void> {
    this.parseVariant(variant);
    const clientAbort = new AbortController();
    res.once('close', () => clientAbort.abort());
    const result = await this.mediaService.handle({
      ctx: req.ingestionContext,
      body: (req.body ?? {}) as Record<string, unknown>,
      headers: req.headers,
      apiMode: 'images',
      ip: req.ip,
      signal: clientAbort.signal,
    });
    if (!res.writableEnded) res.status(result.status).json(result.body);
  }

  @Post('videos')
  async videos(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant?: string,
  ): Promise<void> {
    this.parseVariant(variant);
    const clientAbort = new AbortController();
    res.once('close', () => clientAbort.abort());
    const result = await this.mediaService.handle({
      ctx: req.ingestionContext,
      body: (req.body ?? {}) as Record<string, unknown>,
      headers: req.headers,
      apiMode: 'videos',
      ip: req.ip,
      signal: clientAbort.signal,
    });
    if (!res.writableEnded) res.status(result.status).json(result.body);
  }

  @Get('videos/:id')
  async videoStatus(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('id') id: string,
    @Param('variant') variant?: string,
  ): Promise<void> {
    this.parseVariant(variant);
    const result = await this.mediaService.videoStatus(req.ingestionContext, id);
    if (!res.writableEnded) res.status(result.status).json(result.body);
  }
}
