import { Injectable } from '@nestjs/common';
import { UserRepository } from '../user-da/user.repository.js';
import type { UpdateUserDto } from '../../dto/update-user.dto.js';
@Injectable()
export class UserService {
  constructor(private readonly users: UserRepository) {}
  me(id: number) { return this.users.findByIdOrThrow(id); }
  updateMe(id: number, input: UpdateUserDto) { return this.users.updateProfile(id, input); }
}
