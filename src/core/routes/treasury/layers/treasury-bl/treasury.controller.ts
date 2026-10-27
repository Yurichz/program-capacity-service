import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '#decorators/current-user.decorator.js';
import { Serialize } from '#decorators/serialize.decorator.js';
import { ApiDefaultResponse } from '#decorators/api-default-response.decorator.js';
import { UseAccessAbility } from '#core/providers/casl/use-access-ability.decorator.js';
import { Actions } from '#core/providers/casl/actions.enum.js';
import type { AuthorizableUser } from '#core/providers/casl/interfaces/access.interface.js';
import { CapacityEntity } from '#core/routes/capacity/entities/capacity.entity.js';
import { CapacitySubjectHook } from '#core/routes/capacity/layers/capacity-bl/capacity.hook.js';
import { TreasuryService } from './treasury.service.js';
import { ProgramParamsDto } from '#core/routes/capacity/dto/program-params.dto.js';
import { principalFor } from '#helpers/principal.helpers.js';
import { ReconciliationViewEntity } from '../../entities/reconciliation-view.entity.js';
import { TreasuryEventEntity } from '../../entities/treasury-event.entity.js';
import { TreasuryEventListQueryDto } from '#core/routes/capacity/dto/list-query.dto.js';

@ApiTags('Treasury')
@ApiBearerAuth()
@Controller('internal/programs/:programId')
export class TreasuryController {
  constructor(private readonly service: TreasuryService) {}

  @Get('treasury-events')
  @Serialize(TreasuryEventEntity)
  @ApiDefaultResponse(TreasuryEventEntity, { array: true, paginated: true })
  @UseAccessAbility(Actions.export, CapacityEntity, CapacitySubjectHook)
  events(
    @CurrentUser() user: AuthorizableUser,
    @Param() params: ProgramParamsDto,
    @Query() query: TreasuryEventListQueryDto,
  ) {
    return this.service.events(principalFor(user), params.programId, query);
  }

  @Get('reconciliation-view')
  @Serialize(ReconciliationViewEntity)
  @ApiDefaultResponse(ReconciliationViewEntity)
  @UseAccessAbility(Actions.export, CapacityEntity, CapacitySubjectHook)
  view(@CurrentUser() user: AuthorizableUser, @Param() params: ProgramParamsDto) {
    return this.service.view(principalFor(user), params.programId);
  }
}
