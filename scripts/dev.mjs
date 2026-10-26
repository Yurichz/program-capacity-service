import './runtime-env.mjs';
import { mkdir, readFile, writeFile, access, appendFile } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { database, prismaFor } from '../dist/core/providers/prisma/create-database.js';
import { TokenService } from '../dist/core/providers/token/token.service.js';
import { SessionRepository } from '../dist/core/routes/auth/layers/auth-da/session.repository.js';
import { validateEnvironment } from '../dist/config/environment.config.js';
import { hash } from 'bcryptjs';
import { identifier } from '../dist/helpers/capacity.helpers.js';

export async function token(tenantId='demo-tenant', permissions=['capacity:read','reservations:write','treasury:reconcile'], clientId='demo-client') {
  identifier.parse(tenantId); identifier.parse(clientId);
  const settings=validateEnvironment(process.env);
  const roles=[];
  if(permissions.includes('reservations:write'))roles.push('USER');
  else if(permissions.includes('capacity:read'))roles.push('READ_ONLY');
  if(permissions.includes('treasury:reconcile'))roles.push('TREASURY');
  if(permissions.some(permission=>!['capacity:read','reservations:write','treasury:reconcile'].includes(permission)))throw new Error('Unknown development permission');
  const db=database(settings.DATABASE_URL);
  try {
    const email=createHash('sha256').update(`${tenantId}:${clientId}`).digest('hex')+'@dev.capacity.local';
    const user=await db.user.upsert({where:{email},create:{email,tenantId,clientId,roles,passwordHash:await hash(randomBytes(32).toString('hex'),12)},update:{roles}});
    const tokens=new TokenService(new JwtService(),new ConfigService(settings));
    const sid=randomUUID(),pair=await tokens.issue(user.id,sid);
    await new SessionRepository(prismaFor(db)).createSession({id:sid,userId:user.id,refreshTokenHash:tokens.hashRefresh(pair.refreshToken),expiresAt:tokens.refreshExpiresAt()});
    return pair.accessToken;
  } finally { await db.$disconnect(); }
}

if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(process.argv[2]==='prepare') {
    await mkdir('.dev',{recursive:true});
    try { await access('.dev/runtime.env'); }
    catch {
      await writeFile('.dev/runtime.env',`JWT_ACCESS_SECRET=${randomBytes(48).toString('base64url')}\nJWT_REFRESH_SECRET=${randomBytes(48).toString('base64url')}\n`,{mode:0o600});
    }
    const prepared=await readFile('.dev/runtime.env','utf8');
    if(!prepared.includes('JWT_ACCESS_SECRET=') || !prepared.includes('JWT_REFRESH_SECRET='))throw new Error('Existing runtime.env is incomplete; restore it explicitly');
    if (!prepared.endsWith('\n')) await appendFile('.dev/runtime.env', '\n');
    if (!prepared.includes('DEMO_EMAIL=')) await appendFile('.dev/runtime.env', 'DEMO_EMAIL=operator@capacity.local\n');
    if (!prepared.includes('DEMO_PASSWORD=')) await appendFile('.dev/runtime.env', `DEMO_PASSWORD=${randomBytes(24).toString('base64url')}\n`);
    console.log('Development signing secrets ready in ignored .dev/runtime.env');
    console.log('Demo credentials ready. Run npm run dev:credentials to display them locally.');
  } else if (process.argv[2] === 'credentials') {
    if (!process.env.DEMO_EMAIL || !process.env.DEMO_PASSWORD) throw new Error('Run dev:prepare first');
    console.log(`Email: ${process.env.DEMO_EMAIL}\nPassword: ${process.env.DEMO_PASSWORD}`);
  } else if(process.argv[2]==='token') console.log(await token(process.argv[3],process.argv[4]?.split(','),process.argv[5]));
}
