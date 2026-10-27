import { UserBlModule } from '#core/routes/user/layers/user-bl/user-bl.module.js';
import { AuthBlModule } from '#core/routes/auth/layers/auth-bl/auth-bl.module.js';
import { CapacityBlModule } from '#core/routes/capacity/layers/capacity-bl/capacity-bl.module.js';
import { TreasuryBlModule } from '#core/routes/treasury/layers/treasury-bl/treasury-bl.module.js';

export const AppBLImports = [UserBlModule, AuthBlModule, CapacityBlModule, TreasuryBlModule];
