import { Injectable } from '@nestjs/common';
import type { AuthorizableRequest, SubjectHook } from '#core/providers/casl/interfaces/access.interface.js';
import { UserRepository } from '../user-da/user.repository.js';

@Injectable()
export class UserSubjectHook implements SubjectHook {
  constructor(private readonly users: UserRepository) {}
  async run(request: AuthorizableRequest) { return request.user ? (await this.users.findById(request.user.id)) ?? undefined : undefined; }
}
