import type { Request } from 'express';
import type { AbilityBuilder, MongoAbility, Subject } from '@casl/ability';
import { Actions } from '../actions.enum.js';

export interface AuthorizableUser {
  id: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  roles: string[];
  tenantId: string;
  clientId: string;
  sessionId: string;
}
export interface AuthorizableRequest extends Request { user?: AuthorizableUser; }
export interface SubjectHook { run(request: AuthorizableRequest): object | undefined | Promise<object | undefined>; }
export type AppAbility = MongoAbility<[Actions, Subject]>;
export type PermissionBuilder = Pick<AbilityBuilder<AppAbility>, 'can' | 'cannot'> & { user: AuthorizableUser };
export type Permissions = Record<string, (builder: PermissionBuilder) => void>;
