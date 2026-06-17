import bcrypt from "bcryptjs";

/**
 * Hashes a plaintext password using bcryptjs.
 */
export function hashPassword(password: string): string {
  const salt = bcrypt.genSaltSync(10);
  return bcrypt.hashSync(password, salt);
}

/**
 * Compares a plaintext password with a hash.
 * If the hash is a bcrypt hash (starts with $2), uses bcryptjs.
 * Otherwise, falls back to plaintext comparison (for demo credentials).
 */
export function comparePassword(password: string, hash: string): boolean {
  if (hash && (hash.startsWith("$2a$") || hash.startsWith("$2b$") || hash.startsWith("$2y$"))) {
    return bcrypt.compareSync(password, hash);
  }
  return password === hash;
}
