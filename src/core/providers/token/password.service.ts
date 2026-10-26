import { Injectable } from '@nestjs/common';
import { compare, hash } from 'bcryptjs';

@Injectable()
export class PasswordService {
  hash(password: string) { return hash(password, 12); }
  compare(password: string, hashed: string) { return compare(password, hashed); }
}
