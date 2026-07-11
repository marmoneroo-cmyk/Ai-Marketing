import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ok, type ApiResponse } from '@brandpilot/core';
import { Public } from '../auth/public.decorator';

interface HealthStatus {
  status: 'ok';
}

/** Public liveness probe. No authentication required. */
@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({ summary: 'Liveness check' })
  check(): ApiResponse<HealthStatus> {
    return ok({ status: 'ok' });
  }
}
