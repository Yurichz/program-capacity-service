import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '#generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';
export { PrismaClient };

/** Operational scripts use the same adapter and client settings as the API. */
export function database(url: string): PrismaClient {
  return new PrismaService(new ConfigService({ DATABASE_URL: url })).root;
}

export function prismaFor(client: PrismaClient): PrismaService {
  return new PrismaService(new ConfigService(), client);
}
