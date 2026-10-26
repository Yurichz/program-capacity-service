import './runtime-env.mjs';
import { database } from '../dist/core/providers/prisma/create-database.js';
import { hash } from 'bcryptjs';
export const PROGRAM_ID = '11111111-1111-4111-8111-111111111111';
export const SECOND_PROGRAM_ID = '22222222-2222-4222-8222-222222222222';
const db = database(process.env.DATABASE_URL);
try {
    if (process.env.DEMO_EMAIL && process.env.DEMO_PASSWORD) {
        await db.user.upsert({ where: { tenantId_clientId: { tenantId: 'demo-tenant', clientId: 'demo-web-client' } },
            create: { email: process.env.DEMO_EMAIL.trim().toLowerCase(), passwordHash: await hash(process.env.DEMO_PASSWORD, 12),
                firstName: 'Alex', lastName: 'Morgan', tenantId: 'demo-tenant', clientId: 'demo-web-client', roles: ['USER', 'TREASURY'] }, update: {} });
    }
    for (const id of [PROGRAM_ID, SECOND_PROGRAM_ID])
        await db.program.upsert({ where: { id },
            create: { id, tenantId: 'demo-tenant', currency: 'USD', limitMinor: 1000000000n }, update: {} });
}
finally {
    await db.$disconnect();
}
