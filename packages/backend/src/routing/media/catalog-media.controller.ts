import { Controller, Get, Param, Post, Req, Res, UseFilters, UseGuards } from '@nestjs/common';
import { Request, Response as ExpressResponse } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AgentKeyAuthGuard } from '../../otlp/guards/agent-key-auth.guard';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { ProxyExceptionFilter } from '../proxy/proxy-exception.filter';
import { MediaController } from './media.controller';

/** Media counterpart of `/catalog/:variant/v1` — routing stays identical. */
@Controller('catalog/:variant/v1')
@Public()
@UseGuards(AgentKeyAuthGuard)
@UseFilters(ProxyExceptionFilter)
@SkipThrottle()
export class CatalogMediaController {
  constructor(private readonly media: MediaController) {}

  @Post('images/generations')
  async images(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant: string,
  ): Promise<void> {
    return this.media.catalogImages(req, res, variant);
  }

  @Post('videos')
  async videos(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant: string,
  ): Promise<void> {
    return this.media.catalogVideos(req, res, variant);
  }

  @Get('videos/:id')
  async videoStatus(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant: string,
    @Param('id') id: string,
  ): Promise<void> {
    return this.media.catalogVideoStatus(req, res, variant, id);
  }
}
