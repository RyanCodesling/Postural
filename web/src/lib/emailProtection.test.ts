/**
 * Email addresses are stored encrypted (AES-256-GCM) and looked up by their SHA-256 hash.
 *
 *   npx tsx src/lib/emailProtection.test.ts
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  decryptEmail,
  EmailProtectionConfigurationError,
  encryptEmail,
  hashEmail,
  isEncryptedEmail,
} from "./emailProtection";

process.env.EMAIL_ENCRYPTION_KEY = "fixture-email-encryption-key-of-32-bytes-or-more";

// The hash is SHA-256 of the lowercased, trimmed address, the same value the SQL
// scripts compute with encode(digest(lower(trim(email)), 'sha256'), 'hex').
const expected = createHash("sha256").update("patient@example.invalid").digest("hex");
assert.equal(hashEmail("patient@example.invalid"), expected);
assert.equal(hashEmail("  Patient@Example.INVALID "), expected, "case and surrounding spaces do not change the hash");
assert.match(hashEmail("other@example.invalid"), /^[0-9a-f]{64}$/);
assert.notEqual(hashEmail("other@example.invalid"), expected);

const stored = encryptEmail(" Patient@Example.invalid ");
assert.ok(isEncryptedEmail(stored));
assert.doesNotMatch(stored, /example/i, "the stored value does not contain the address");
assert.equal(decryptEmail(stored), "Patient@Example.invalid", "decrypts to the trimmed address as typed");
assert.notEqual(encryptEmail("patient@example.invalid"), encryptEmail("patient@example.invalid"), "each encryption uses a fresh IV");

// Rows not yet converted at server start read as they are; missing values stay null.
assert.equal(decryptEmail("legacy@example.invalid"), "legacy@example.invalid");
assert.equal(decryptEmail(null), null);
assert.equal(decryptEmail(undefined), null);

// A tampered value fails authentication instead of decrypting to something else.
const tampered = stored.slice(0, -2) + (stored.endsWith("AA") ? "BB" : "AA");
assert.throws(() => decryptEmail(tampered));

// The wrong key cannot read the address.
process.env.EMAIL_ENCRYPTION_KEY = "a-different-fixture-key-of-32-bytes-or-more";
assert.throws(() => decryptEmail(stored));

process.env.EMAIL_ENCRYPTION_KEY = "too-short";
assert.throws(() => encryptEmail("patient@example.invalid"), EmailProtectionConfigurationError);
delete process.env.EMAIL_ENCRYPTION_KEY;
assert.throws(() => encryptEmail("patient@example.invalid"), EmailProtectionConfigurationError);
assert.equal(hashEmail("patient@example.invalid"), expected, "hashing needs no key");

console.log("Email hashing and encryption passed.");
