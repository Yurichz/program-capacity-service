import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '#generated/prisma/client.js';
import { PrismaService } from '#core/providers/prisma/prisma.service.js';
import { TxScopeRepository } from '#core/providers/prisma/tx-scope-repository.js';
import { ERRORS } from '#constants/errors.constants.js';
import type { CreateUserInput } from '../../interfaces/create-user.interface.js';
import type { UpdateUserDto } from '../../dto/update-user.dto.js';

@Injectable()
export class UserRepository extends TxScopeRepository<Prisma.TransactionClient['user']> {
  constructor(prisma: PrismaService) {
    super(prisma, (client) => client.user);
  }

  async createAccount(input: CreateUserInput) {
    try {
      return await this.$.create({
        data: {
          email: input.email,
          passwordHash: input.passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException(ERRORS.USER_CONFLICT);
      throw error;
    }
  }
  findCredentials(email: string) {
    return this.$.findUnique({ where: { email } });
  }
  findById(id: number) {
    return this.$.findUnique({ where: { id } });
  }
  async findByIdOrThrow(id: number) {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException(ERRORS.USER_NOT_FOUND);
    return user;
  }
  updateProfile(id: number, input: UpdateUserDto) {
    return this.$.update({
      where: { id },
      data: { firstName: input.firstName, lastName: input.lastName },
    });
  }
}
