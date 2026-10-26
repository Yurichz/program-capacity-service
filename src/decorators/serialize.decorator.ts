import { SetMetadata, type Type } from '@nestjs/common';
export const SERIALIZE_ENTITY = 'app:serialize-entity';
export const Serialize = (entity: Type<unknown>) => SetMetadata(SERIALIZE_ENTITY, entity);
