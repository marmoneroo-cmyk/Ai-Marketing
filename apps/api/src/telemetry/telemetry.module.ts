import { Module } from '@nestjs/common';
import { TelemetryController } from './telemetry.controller';

/** Client-side error/telemetry ingest (see {@link TelemetryController}). */
@Module({
  controllers: [TelemetryController],
})
export class TelemetryModule {}
