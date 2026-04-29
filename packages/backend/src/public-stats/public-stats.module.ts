import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentMessage } from '../entities/agent-message.entity';
import { ModelPricesModule } from '../model-prices/model-prices.module';
import { FreeModelsModule } from '../free-models/free-models.module';
import { PublicStatsController } from './public-stats.controller';
import { PublicStatsService } from './public-stats.service';
import { SelfHostedUsageService } from './self-hosted-usage.service';

@Module({
  imports: [TypeOrmModule.forFeature([AgentMessage]), ModelPricesModule, FreeModelsModule],
  controllers: [PublicStatsController],
  providers: [PublicStatsService, SelfHostedUsageService],
})
export class PublicStatsModule {}
