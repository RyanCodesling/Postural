// Sets one account's password on the evaluation server without showing it.
//
//   node set-password.mjs <user id>          asks twice for a new password (not echoed),
//                                             stores a bcrypt hash (the app's scheme, cost 10)
//                                             and clears the first-sign-in change flag
//   node set-password.mjs <user id> --lock   sets a random password nobody knows and archives
//                                             the account (used for the seeded demo accounts)
//
// Reads DATABASE_URL from the environment; run it through the service's settings file:
//   sudo -u postural bash -c 'set -a; . /etc/postural/env; set +a; node /opt/postural/tools/set-password.mjs admin_001'
// It never prints a password.
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import readline from "node:readline";

const require = createRequire("/opt/postural/app/web/package.json");
const bcrypt = require("bcryptjs");
const { Client } = require("pg");

const [userId, flag] = process.argv.slice(2);
if (!userId || (flag && flag !== "--lock")) {
  console.error("Usage: node set-password.mjs <user id> [--lock]");
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set; run through /etc/postural/env.");
  process.exit(2);
}

function askHidden(prompt) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (text) => {
      if (text.includes(prompt)) rl.output.write(prompt);
    };
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  const { rows } = await client.query("SELECT id, role FROM users WHERE id = $1", [userId]);
  if (rows.length === 0) throw new Error(`No account ${userId}.`);
  if (flag === "--lock") {
    const hash = bcrypt.hashSync(randomBytes(32).toString("hex"), 10);
    await client.query(
      "UPDATE users SET password = $1, is_archived = TRUE, archived_at = COALESCE(archived_at, now()) WHERE id = $2",
      [hash, userId],
    );
    console.log(`${userId} (${rows[0].role}) locked with an unknown password and archived.`);
  } else {
    if (!process.stdin.isTTY) throw new Error("Run this in an interactive terminal (ssh -t).");
    const first = await askHidden(`New password for ${userId} (at least 12 characters): `);
    const second = await askHidden("Type it again: ");
    if (first !== second) throw new Error("The two entries differ; nothing changed.");
    if (first.length < 12) throw new Error("Too short; nothing changed.");
    await client.query(
      "UPDATE users SET password = $1, must_change_password = FALSE WHERE id = $2",
      [bcrypt.hashSync(first, 10), userId],
    );
    console.log(`Password set for ${userId} (${rows[0].role}).`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await client.end();
}
