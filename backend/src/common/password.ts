import { BadRequestException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

// BCRYPT_COST: for the suites only, which sign up hundreds of accounts.
export const BCRYPT_COST = Number(process.env.BCRYPT_COST) || 12;
// bcrypt reads no further: anything longer would be cut without a word.
const MAX_PASSWORD_BYTES = 72;

export function hashPassword(password: string) {
  if (Buffer.byteLength(password) > MAX_PASSWORD_BYTES) {
    throw new BadRequestException(`Parol juda uzun (ko'pi bilan ${MAX_PASSWORD_BYTES} bayt)`);
  }
  return bcrypt.hash(password, BCRYPT_COST);
}

/** A hash made at a lower cost than today's: replaced at the next sign-in, when the password is at hand. */
export function needsRehash(hash: string) {
  return bcrypt.getRounds(hash) < BCRYPT_COST;
}
