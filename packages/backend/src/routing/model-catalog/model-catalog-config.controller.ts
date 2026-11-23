import { Body, Controller, Get, Patch } from '@nestjs/common';
import { TenantCtx, TenantContext } from '../../common/decorators/tenant-context.decorator';
import type { ModelCatalogResponse } from 'manifest-shared';
import { ModelCatalogConfigService } from './model-catalog-config.service';
import { UpdateModelCatalogConfigDto } from './model-catalog-config.dto';

/** Dashboard-side editor for the tenant-wide scoped catalog selection. */
@Controller('api/v1/model-catalog')
export class ModelCatalogConfigController {
  constructor(private readonly config: ModelCatalogConfigService) {}

  @Get()
  async get(@TenantCtx() ctx: TenantContext): Promise<ModelCatalogResponse> {
    return this.config.getResponse(ctx.tenantId ?? '');
  }

  @Patch()
  async update(
    @TenantCtx() ctx: TenantContext,
    @Body() body: UpdateModelCatalogConfigDto,
  ): Promise<ModelCatalogResponse> {
    const config = await this.config.update(ctx.tenantId ?? '', body);
    return { ...config, options: await this.config.getOptions(ctx.tenantId ?? '') };
  }
}
