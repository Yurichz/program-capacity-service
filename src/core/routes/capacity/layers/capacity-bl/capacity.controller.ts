import { Body, Controller, Get, Headers, Param, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '#decorators/current-user.decorator.js';
import { CurrentOperationId } from '#decorators/current-operation-id.decorator.js';
import { Serialize } from '#decorators/serialize.decorator.js';
import { ApiDefaultResponse } from '#decorators/api-default-response.decorator.js';
import { UseAccessAbility } from '#core/providers/casl/use-access-ability.decorator.js';
import { Actions } from '#core/providers/casl/actions.enum.js';
import type { AuthorizableUser } from '#core/providers/casl/interfaces/access.interface.js';
import { principalFor } from '#helpers/principal.helpers.js';
import { AppError, type Outcome } from '#helpers/capacity.helpers.js';
import { ValidationException } from '#filters/validation.exception.js';
import { CreateReservationDto } from '../../dto/create-reservation.dto.js';
import { ReleaseReservationDto } from '../../dto/release-reservation.dto.js';
import { ProgramParamsDto, ReservationParamsDto } from '../../dto/program-params.dto.js';
import { CapacityEntity } from '../../entities/capacity.entity.js';
import { ReservationEntity } from '../../entities/reservation.entity.js';
import { CapacitySubjectHook, ProgramListHook } from './capacity.hook.js';
import { CapacityService } from './capacity.service.js';
import { ListQueryDto, ReservationListQueryDto } from '../../dto/list-query.dto.js';
import { ProgramSummaryEntity } from '../../entities/program-summary.entity.js';
import { MovementEntity } from '../../entities/movement.entity.js';

@ApiTags('Capacity')
@ApiBearerAuth()
@Controller('programs')
export class ProgramsController {
  constructor(private readonly service: CapacityService) {}

  @Get()
  @Serialize(ProgramSummaryEntity)
  @ApiDefaultResponse(ProgramSummaryEntity, { array: true, paginated: true })
  @UseAccessAbility(Actions.read, CapacityEntity, ProgramListHook)
  programs(@CurrentUser() user: AuthorizableUser, @Query() query: ListQueryDto) {
    return this.service.programs(principalFor(user), query);
  }
}

function idempotencyKey(key: string): string {
  if (typeof key !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(key))
    throw new ValidationException([
      {
        property: 'Idempotency-Key',
        constraints: { format: 'A 1–128 character idempotency key is required' },
      },
    ]);

  return key;
}
function respond(result: Outcome, response: Response) {
  if (result.status >= 400)
    throw new AppError(
      result.status,
      String(result.body.code),
      String(result.body.message),
      String(result.body.requestId),
    );

  response.status(result.status);

  return result.body;
}

@ApiTags('Capacity')
@ApiBearerAuth()
@Controller('programs/:programId')
export class CapacityController {
  constructor(private readonly service: CapacityService) {}

  @Get('reservations')
  @Serialize(ReservationEntity)
  @ApiDefaultResponse(ReservationEntity, { array: true, paginated: true })
  @UseAccessAbility(Actions.read, CapacityEntity, CapacitySubjectHook)
  reservations(
    @CurrentUser() user: AuthorizableUser,
    @Param() params: ProgramParamsDto,
    @Query() query: ReservationListQueryDto,
  ) {
    return this.service.reservations(principalFor(user), params.programId, query);
  }

  @Get('movements')
  @Serialize(MovementEntity)
  @ApiDefaultResponse(MovementEntity, { array: true, paginated: true })
  @UseAccessAbility(Actions.read, CapacityEntity, CapacitySubjectHook)
  movements(
    @CurrentUser() user: AuthorizableUser,
    @Param() params: ProgramParamsDto,
    @Query() query: ListQueryDto,
  ) {
    return this.service.movements(principalFor(user), params.programId, query);
  }

  @Get('capacity')
  @Serialize(CapacityEntity)
  @ApiDefaultResponse(CapacityEntity)
  @UseAccessAbility(Actions.read, CapacityEntity, CapacitySubjectHook)
  capacity(@CurrentUser() user: AuthorizableUser, @Param() params: ProgramParamsDto) {
    return this.service.capacity(principalFor(user), params.programId);
  }

  @Get('reservations/:reservationId')
  @Serialize(ReservationEntity)
  @ApiDefaultResponse(ReservationEntity)
  @UseAccessAbility(Actions.read, CapacityEntity, CapacitySubjectHook)
  reservation(@CurrentUser() user: AuthorizableUser, @Param() params: ReservationParamsDto) {
    return this.service.reservation(principalFor(user), params.programId, params.reservationId);
  }

  @Post('reservations')
  @Serialize(ReservationEntity)
  @ApiDefaultResponse(ReservationEntity, { status: 201 })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseAccessAbility(Actions.create, CapacityEntity, CapacitySubjectHook)
  async reserve(
    @CurrentUser() user: AuthorizableUser,
    @Param() params: ProgramParamsDto,
    @Headers('idempotency-key') key: string,
    @Body() body: CreateReservationDto,
    @CurrentOperationId() operationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return respond(
      await this.service.reserve(
        principalFor(user),
        params.programId,
        body,
        idempotencyKey(key),
        operationId,
      ),
      response,
    );
  }

  @Post('reservations/:reservationId/release')
  @Serialize(ReservationEntity)
  @ApiDefaultResponse(ReservationEntity)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @UseAccessAbility(Actions.update, CapacityEntity, CapacitySubjectHook)
  async release(
    @CurrentUser() user: AuthorizableUser,
    @Param() params: ReservationParamsDto,
    @Headers('idempotency-key') key: string,
    @Body() _body: ReleaseReservationDto,
    @CurrentOperationId() operationId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return respond(
      await this.service.release(
        principalFor(user),
        params.programId,
        params.reservationId,
        idempotencyKey(key),
        operationId,
      ),
      response,
    );
  }
}
