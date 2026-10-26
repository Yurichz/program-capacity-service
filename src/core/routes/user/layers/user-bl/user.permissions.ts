import { Actions } from '#core/providers/casl/actions.enum.js';
import type { Permissions } from '#core/providers/casl/interfaces/access.interface.js';
import { UserEntity } from '../../entities/user.entity.js';
export const userPermissions: Permissions = {
  everyone({ can, user }) {
    if (user.roles.some(role => ['USER', 'READ_ONLY', 'TREASURY'].includes(role))) can(Actions.read, UserEntity, { id: user.id });
  },
  USER({ can, user }) { can(Actions.update, UserEntity, { id: user.id }); },
};
