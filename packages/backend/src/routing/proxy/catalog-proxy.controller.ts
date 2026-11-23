import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import { Request, Response as ExpressResponse } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AgentKeyAuthGuard } from '../../otlp/guards/agent-key-auth.guard';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import type { OpenAiModelList, OpenAiModelObject } from './openai-model-list';
import { ProxyExceptionFilter } from './proxy-exception.filter';
import { ProxyController } from './proxy.controller';

/**
 * Public scoped-catalog surface: `/catalog/:variant/v1/...`.
 *
 * The variant sits before `/v1` so the URL still ends where every sdk expects
 * it to. All handlers delegate to ProxyController — only the model list is
 * scoped, never the routing behind it.
 */
@Controller('catalog/:variant/v1')
@Public()
@UseGuards(AgentKeyAuthGuard)
@UseFilters(ProxyExceptionFilter)
@SkipThrottle()
export class CatalogProxyController {
  constructor(private readonly proxy: ProxyController) {}

  @Get('models')
  async models(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Param('variant') variant: string,
    @Query('capabilities') capabilities?: string,
    @Query('cost') cost?: string,
    @Query('route_metadata') routeMetadata?: string,
    @Query('output') output?: string,
    @Query('classifiers') classifiers?: string,
  ): Promise<OpenAiModelList> {
    return this.proxy.catalogModels(
      req,
      variant,
      capabilities,
      cost,
      routeMetadata,
      output,
      classifiers,
    );
  }

  @Get('models/*splat')
  async model(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Param('variant') variant: string,
    @Param('splat') splat: string | string[] | undefined,
    @Query('capabilities') capabilities?: string,
    @Query('cost') cost?: string,
    @Query('route_metadata') routeMetadata?: string,
    @Query('classifiers') classifiers?: string,
  ): Promise<OpenAiModelObject> {
    return this.proxy.catalogModel(
      req,
      variant,
      splat,
      capabilities,
      cost,
      routeMetadata,
      classifiers,
    );
  }

  @Post('chat/completions')
  async chatCompletions(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant: string,
  ): Promise<void> {
    return this.proxy.catalogChatCompletions(req, res, variant);
  }

  @Post('responses')
  async responses(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant: string,
  ): Promise<void> {
    return this.proxy.catalogResponses(req, res, variant);
  }

  @Post('messages')
  async messages(
    @Req() req: Request & { ingestionContext: IngestionContext },
    @Res() res: ExpressResponse,
    @Param('variant') variant: string,
  ): Promise<void> {
    return this.proxy.catalogMessages(req, res, variant);
  }
}
