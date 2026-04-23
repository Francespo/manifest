import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { IsArray, IsIn, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { Request } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { AgentKeyAuthGuard } from '../../otlp/guards/agent-key-auth.guard';
import { IngestionContext } from '../../otlp/interfaces/ingestion-context.interface';
import { ResolveService } from './resolve.service';
import { ProviderService } from '../routing-core/provider.service';
import { ResolveRequestDto } from '../dto/resolve-request.dto';
import { ResolveResponse } from '../dto/resolve-response';
import { PROVIDER_BY_ID_OR_ALIAS } from '../../common/constants/providers';
import { isSupportedSubscriptionProvider } from '../../common/utils/subscription-support';

const KNOWN_PROVIDER_IDS: readonly string[] = Array.from(PROVIDER_BY_ID_OR_ALIAS.keys());

export class SubscriptionProviderItem {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsIn(KNOWN_PROVIDER_IDS, {
    message: `provider must be one of: ${KNOWN_PROVIDER_IDS.join(', ')}`,
  })
  provider!: string;

  @IsString()
  @IsOptional()
  token?: string;
}

export class RegisterSubscriptionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SubscriptionProviderItem)
  providers!: SubscriptionProviderItem[];
}

@Controller('api/v1/routing')
@Public()
@UseGuards(AgentKeyAuthGuard)
export class ResolveController {
  constructor(
    private readonly resolveService: ResolveService,
    private readonly providerService: ProviderService,
  ) {}

  @Post('resolve')
  @HttpCode(200)
  async resolve(
    @Body() body: ResolveRequestDto,
    @Req() req: Request & { ingestionContext: IngestionContext },
  ): Promise<ResolveResponse> {
    const { agentId } = req.ingestionContext;
    return this.resolveService.resolve(
      agentId,
      body.messages as { role: string; content?: unknown; [k: string]: unknown }[],
      body.tools,
      body.tool_choice,
      body.max_tokens,
      body.recentTiers,
      body.specificity,
    );
  }

  @Post('subscription-providers')
  @HttpCode(200)
  async registerSubscriptions(
    @Body() body: RegisterSubscriptionsDto,
    @Req() req: Request & { ingestionContext: IngestionContext },
  ): Promise<{ registered: number }> {
    const { agentId, userId } = req.ingestionContext;
    let registered = 0;

    for (const item of body.providers) {
      let isNew: boolean;
      if (item.token) {
        // The no-token branch (registerSubscriptionProvider) silently skips
        // unsupported providers. Mirror that behaviour on the token branch so
        // upsertProvider doesn't persist a subscription row for a provider
        // that can't actually carry one.
        if (!isSupportedSubscriptionProvider(item.provider)) continue;
        const result = await this.providerService.upsertProvider(
          agentId,
          userId,
          item.provider,
          item.token,
          'subscription',
        );
        isNew = result.isNew;
      } else {
        const result = await this.providerService.registerSubscriptionProvider(
          agentId,
          userId,
          item.provider,
        );
        isNew = result.isNew;
      }
      if (isNew) {
        registered++;
      }
    }

    return { registered };
  }
}
