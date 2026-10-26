import { Actions } from '#core/providers/casl/actions.enum.js';
import type { Permissions } from '#core/providers/casl/interfaces/access.interface.js';
import { permissionsForRoles } from '#helpers/principal.helpers.js';
import { CapacityEntity } from '../../entities/capacity.entity.js';

export const capacityPermissions: Permissions = {
  everyone({ can, user }) {
    const permissions = permissionsForRoles(user.roles);
    const scope = { tenantId: user.tenantId };
    if (permissions.includes('capacity:read')) can(Actions.read, CapacityEntity, scope);
    if (permissions.includes('reservations:write')) { can(Actions.create, CapacityEntity, scope); can(Actions.update, CapacityEntity, scope); }
    if (permissions.includes('treasury:reconcile')) can(Actions.export, CapacityEntity, scope);
  },
};
