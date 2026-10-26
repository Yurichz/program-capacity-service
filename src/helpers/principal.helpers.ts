import type { AuthorizableUser } from '#core/providers/casl/interfaces/access.interface.js';
import type { Principal } from './capacity.helpers.js';

export function permissionsForRoles(roles: string[]): string[] {
  const permissions = new Set<string>();
  if (roles.some((role) => ['USER', 'READ_ONLY', 'TREASURY', 'APP_ADMIN'].includes(role)))
    permissions.add('capacity:read');
  if (roles.some((role) => ['USER', 'APP_ADMIN'].includes(role)))
    permissions.add('reservations:write');
  if (roles.some((role) => ['TREASURY', 'APP_ADMIN'].includes(role)))
    permissions.add('treasury:reconcile');
  return [...permissions];
}
export function principalFor(user: AuthorizableUser): Principal {
  return {
    tenantId: user.tenantId,
    clientId: user.clientId,
    permissions: permissionsForRoles(user.roles),
  };
}
