import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// Email addresses are never stored readable. users.email_hash holds the SHA-256 of
// the normalized address and is what sign-in, password reset and duplicate checks
// look up; users.email holds the address encrypted with AES-256-GCM so the app can
// still send mail to it and show it to staff.
const ENCRYPTED_PREFIX = "enc:v1:";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const textEncoder = new TextEncoder();

export class EmailProtectionConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EmailProtectionConfigurationError";
  }
}

function encryptionKey(): Buffer {
  const secret = process.env.EMAIL_ENCRYPTION_KEY;
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new EmailProtectionConfigurationError("EMAIL_ENCRYPTION_KEY is required");
  }
  if (textEncoder.encode(secret).byteLength < 32) {
    throw new EmailProtectionConfigurationError(
      "EMAIL_ENCRYPTION_KEY must contain at least 32 UTF-8 bytes",
    );
  }
  return createHash("sha256").update(secret, "utf8").digest();
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** SHA-256 (hex) of the normalized address; matches the SQL scripts' digest(lower(trim(email)), 'sha256'). */
export function hashEmail(email: string): string {
  return createHash("sha256").update(normalizeEmail(email), "utf8").digest("hex");
}

export function isEncryptedEmail(value: unknown): value is string {
  return typeof value === "string" && value.startsWith(ENCRYPTED_PREFIX);
}

export function encryptEmail(email: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(email.trim(), "utf8"), cipher.final()]);
  return ENCRYPTED_PREFIX + Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

/**
 * Returns the readable address. A value without the encrypted prefix is a row the
 * startup migration (encryptStoredEmails) has not converted yet and is returned as is.
 */
export function decryptEmail(stored: unknown): string | null {
  if (typeof stored !== "string") return null;
  if (!isEncryptedEmail(stored)) return stored;
  const packed = Buffer.from(stored.slice(ENCRYPTED_PREFIX.length), "base64url");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), packed.subarray(0, IV_BYTES));
  decipher.setAuthTag(packed.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([
    decipher.update(packed.subarray(IV_BYTES + TAG_BYTES)),
    decipher.final(),
  ]).toString("utf8");
}
