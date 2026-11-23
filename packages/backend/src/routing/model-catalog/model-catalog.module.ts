import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ModelCatalogConfigEntity } from '../../entities/model-catalog-config.entity';
import { CustomProvider } from '../../entities/custom-provider.entity';
import { ModelDiscoveryModule } from '../../model-discovery/model-discovery.module';
import { ModelCatalogConfigController } from './model-catalog-config.controller';
import { ModelCatalogConfigService } from './model-catalog-config.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ModelCatalogConfigEntity, CustomProvider]),
    ModelDiscoveryModule,
  ],
  controllers: [ModelCatalogConfigController],
  providers: [ModelCatalogConfigService],
  exports: [ModelCatalogConfigService],
})
export class ModelCatalogModule {}
