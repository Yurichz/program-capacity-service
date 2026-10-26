import { Controller, Get } from '@nestjs/common';
import { ApiDefaultResponse } from '#decorators/api-default-response.decorator.js';
import { ReadinessService } from '#core/providers/health/readiness.service.js';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
@ApiTags('Health')
@ApiBearerAuth()
@Controller('health')
export class AppController {
  constructor(private readonly readiness: ReadinessService) {}
  @Get()
  @ApiDefaultResponse()
  health() {
    return { status: 'ok' };
  }
  @Get('ready')
  @ApiDefaultResponse()
  ready() {
    return this.readiness.check();
  }
}
