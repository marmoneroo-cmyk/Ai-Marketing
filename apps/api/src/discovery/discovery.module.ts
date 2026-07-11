import { Module } from '@nestjs/common';
import { DiscoveryController } from './discovery.controller';

/** DATABASE (DbModule) and DISCOVERY_QUEUE (QueueModule) are global providers. */
@Module({ controllers: [DiscoveryController] })
export class DiscoveryModule {}
