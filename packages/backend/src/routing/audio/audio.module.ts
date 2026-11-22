import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AgentMessage } from '../../entities/agent-message.entity';
import { ManifestRequest } from '../../entities/request.entity';
import { BillingModule } from '../../billing/billing.module';
import { ModelDiscoveryModule } from '../../model-discovery/model-discovery.module';
import { OtlpModule } from '../../otlp/otlp.module';
import { OAuthModule } from '../oauth/oauth.module';
import { ProxyModule } from '../proxy/proxy.module';
import { ResolveModule } from '../resolve/resolve.module';
import { RoutingCoreModule } from '../routing-core/routing-core.module';
import { AudioController } from './audio.controller';
import { AudioProviderClient } from './audio-provider-client';
import { AudioService } from './audio.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ManifestRequest, AgentMessage]),
    RoutingCoreModule,
    ResolveModule,
    ModelDiscoveryModule,
    OAuthModule,
    BillingModule,
    // AgentKeyAuthGuard plus the shared rate limiter and recorder.
    OtlpModule,
    // Shares the proxy's limiter and recorder so audio traffic counts against
    // the same tenant limits and lands in the same fact tables as text/media.
    ProxyModule,
  ],
  controllers: [AudioController],
  providers: [AudioService, AudioProviderClient],
  exports: [AudioService],
})
export class AudioModule {}
