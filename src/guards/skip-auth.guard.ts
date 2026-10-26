import { SetMetadata } from '@nestjs/common';
export const SKIP_AUTH = 'app:skip-auth';
export const SkipAuth = () => SetMetadata(SKIP_AUTH, true);
