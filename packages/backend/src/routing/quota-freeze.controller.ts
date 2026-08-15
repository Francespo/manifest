import { Body, Controller, Get, Post, Param } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../common/decorators/tenant-context.decorator';
import { ResolveAgentService } from './routing-core/resolve-agent.service';
import { KeyQuotaService } from './proxy/key-quota.service';
import { AgentNameParamDto, ResumeQuotaFreezeDto } from './dto/routing.dto';

/**
 * Live view of quota freezes applied by the proxy (in-memory, per process).
 * Lets the dashboard show which provider keys are frozen until when, and lets
 * the user resume a key that was frozen by mistake.
 */
@Controller('api/v1/routing')
export class QuotaFreezeController {
  constructor(
    private readonly quota: KeyQuotaService,
    private readonly resolveAgentService: ResolveAgentService,
  ) {}

  @Get(':agentName/quota-freezes')
  async list(@TenantCtx() ctx: TenantContext, @Param() params: AgentNameParamDto) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    return { freezes: this.quota.listFreezes(agent.id) };
  }

  @Post(':agentName/quota-freezes/resume')
  async resume(
    @TenantCtx() ctx: TenantContext,
    @Param() params: AgentNameParamDto,
    @Body() body: ResumeQuotaFreezeDto,
  ) {
    const agent = await this.resolveAgentService.resolve(ctx.tenantId, params.agentName);
    this.quota.resume(agent.id, body.provider, body.authType, body.providerKeyLabel);
    return { ok: true };
  }
}
