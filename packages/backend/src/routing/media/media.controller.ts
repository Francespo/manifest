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
import { isModelCatalogVariant, MODEL_CATALOG_VARIANTS } from 'manifest-shared';
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
 * Routing, credentials, recording, and cost accounting are shared with the
 * text proxy; only the wire shapes differ. The same three routes are mirrored
 * under `/catalog/:variant/v1` (and the legacy `/v1/catalog/:variant` alias) so
 * a client can switch catalogs by changing only its base URL — media routing
 * itself is never scoped.
 */
@Controller('v1')
@Public()
@UseGuards(AgentKeyAuthGuard)
@UseFilters(ProxyExceptionFilter)
@SkipThrottle()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  private parseVariant(variant: string): void {
    if (!isModelCatalogVariant(variant)) {
      throw new NotFoundException(
        `Unknown model catalog "${variant}". Available: ${MODEL_CATALOG_VARIANTS.join(', ')}.`,
      );
    }
  }

  private async handleMedia(
    req: Request & { ingestionContext: IngestionContext },
    res: ExpressResponse,
    apiMode: 'images' | 'videos',
  ): Promise<void> {
    const clientAbort = new AbortController();
    res.once('close', () => clientAbort.abort());
    const result = await this.mediaService.handle({
      ctx: req.ingestionContext,
      body: (req.body ?? {}) as Record<string, unknown>,
      headers: req.headers,
      apiMode,
      ip: req.ip,
      signal: clientAbort.signal,
    });
    if (!res.writableEnded) res.status(result.status).json(result.body);
  }

  @Post('images/generations')
  async images(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    return this.handleMedia(req, res, 'images');
  }

  @Post('videos')
  async videos(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
  ): Promise<void> {
    return this.handleMedia(req, res, 'videos');
  }

  @Get('videos/:id')
  async videoStatus(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('id') id: string,
  ): Promise<void> {
    const result = await this.mediaService.videoStatus(req.ingestionContext, id);
    if (!res.writableEnded) res.status(result.status).json(result.body);
  }

  /* ── Scoped catalog mirrors ─────────────────────────────────────────────── */

  @Post('catalog/:variant/images/generations')
  async catalogImages(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant: string,
  ): Promise<void> {
    this.parseVariant(variant);
    return this.handleMedia(req, res, 'images');
  }

  @Post('catalog/:variant/videos')
  async catalogVideos(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant: string,
  ): Promise<void> {
    this.parseVariant(variant);
    return this.handleMedia(req, res, 'videos');
  }

  @Get('catalog/:variant/videos/:id')
  async catalogVideoStatus(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant: string,
    @Param('id') id: string,
  ): Promise<void> {
    this.parseVariant(variant);
    const result = await this.mediaService.videoStatus(req.ingestionContext, id);
    if (!res.writableEnded) res.status(result.status).json(result.body);
  }
}
