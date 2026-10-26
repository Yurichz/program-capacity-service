import { Controller, Get } from '@nestjs/common';
import { ApiDefaultResponse } from '#decorators/api-default-response.decorator.js';
@Controller('health')
export class AppController {
  @Get() @ApiDefaultResponse()
  health() { return { status: 'ok' }; }
}
