import bcrypt from "bcryptjs";

const BCRYPT_COST = 10;
const BCRYPT_HASH = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

/**
 * Hashes a plaintext password using bcryptjs.
 */
export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

/**
 * Compares a plaintext password with a stored bcrypt hash.
 * Anything that is not a bcrypt hash never matches; stored plaintext passwords are
 * converted by scripts/user_credentials_pg.sql.
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  if (typeof password !== "string" || typeof hash !== "string" || !BCRYPT_HASH.test(hash)) {
    return false;
  }
  return bcrypt.compare(password, hash);
}
