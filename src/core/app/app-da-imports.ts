import { UserDaModule } from '#core/routes/user/layers/user-da/user-da.module.js';
import { AuthDaModule } from '#core/routes/auth/layers/auth-da/auth-da.module.js';
import { CapacityDaModule } from '#core/routes/capacity/layers/capacity-da/capacity-da.module.js';
import { TreasuryDaModule } from '#core/routes/treasury/layers/treasury-da/treasury-da.module.js';

export const AppDaImports = [UserDaModule, AuthDaModule, CapacityDaModule, TreasuryDaModule];
