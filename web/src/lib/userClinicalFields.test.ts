/** Real DB writers/API handlers, with query boundaries replaced in the default suite.
 * --database additionally verifies SQL on a private temporary users table, then rolls back.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { Client } from "pg";
import { decryptEmail, encryptEmail, hashEmail } from "./emailProtection";

const clinicalKeys = ["diagnosis", "prescription", "condition"];
process.env.EMAIL_ENCRYPTION_KEY ??= "fixture-email-encryption-key-of-32-bytes-or-more";
function extract(file: URL, names: string[]) {
  const source = readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file.pathname, source, ts.ScriptTarget.Latest, true);
  const nodes = ast.statements.filter(node =>
    (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      ? names.includes(node.name?.text ?? "")
      : ts.isVariableStatement(node) && node.declarationList.declarations.some(d => names.includes(d.name.getText(ast))),
  );
  assert.equal(nodes.length, names.length);
  return ts.transpileModule(nodes.map(node => node.getText(ast)).join("\n") + `\nglobalThis.subject = {${names.join(",")}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const dbCode = extract(new URL("./db.ts", import.meta.url), [
  "userClinicalKeys", "UserClinicalFieldsUnavailableError", "userDataForSchema", "mapUser", "getUserById", "createUser", "updateUser",
]);
type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
type Subject = {
  createUser(data: Record<string, unknown>): Promise<Record<string, unknown>>;
  updateUser(id: string, data: Record<string, unknown>): Promise<Record<string, unknown> | null>;
  UserClinicalFieldsUnavailableError: new () => Error;
};
function loadDb(query: Query): Subject {
  const context = vm.createContext({ exports: {}, pool: { query }, hashPassword: () => "fixture-hash", decryptEmail, encryptEmail, hashEmail });
  vm.runInContext(dbCode, context);
  return context.subject;
}
const person = { id: "clinical_fixture", name: "Fictional fixture", firstName: "Fictional", lastName: "Fixture", email: "fixture@example.invalid", role: "patient", password: "not-a-real-account" };
const blank = { diagnosis: "", prescription: null, condition: "  " };

async function unitChecks() {
  const queries: { sql: string; params: unknown[] }[] = [];
  let available: string[] = [];
  const db = loadDb(async (sql, params = []) => {
    queries.push({ sql, params });
    return { rows: sql.includes("pg_attribute") ? available.map(attname => ({ attname })) : [{ id: person.id, name: person.name }] };
  });
  await db.createUser({ ...person, ...blank });
  assert.equal(queries.at(-1)!.params.length, 14);
  assert.match(String(queries.at(-1)!.params[1]), /^enc:v1:/, "the address is stored encrypted");
  assert.equal(decryptEmail(queries.at(-1)!.params[1]), person.email);
  assert.equal(queries.at(-1)!.params[13], hashEmail(person.email), "and looked up by its SHA-256 hash");
  assert.doesNotMatch(queries.at(-1)!.sql, /diagnosis|prescription|condition/);
  const input = { name: "Updated", ...blank };
  await db.updateUser(person.id, input);
  assert.match(queries.at(-1)!.sql, /SET name = \$1 WHERE id = \$2/);
  assert.equal(input.diagnosis, "", "caller data is not mutated");
  await db.updateUser(person.id, blank);
  assert.match(queries.at(-1)!.sql, /SELECT u\.\*/, "blank-only legacy update is a successful no-op read");
  for (const key of clinicalKeys) {
    for (const write of [() => db.createUser({ ...person, [key]: "Fictional entry" }), () => db.updateUser(person.id, { name: "Do not save", [key]: "Fictional entry" })]) {
      const start = queries.length;
      await assert.rejects(write, db.UserClinicalFieldsUnavailableError);
      assert.equal(queries.length, start + 1, "unsupported nonempty field fails before any write");
      assert.match(queries.at(-1)!.sql, /pg_attribute/);
    }
  }
  available = ["diagnosis"]; // partial migration supports only the column that exists
  await db.createUser({ ...person, diagnosis: "Fictional entry", condition: "" });
  assert.equal(queries.at(-1)!.params.length, 15);
  assert.match(queries.at(-1)!.sql, /"diagnosis"/);
  assert.doesNotMatch(queries.at(-1)!.sql, /"condition"/);
  available = clinicalKeys;
  await db.createUser({ ...person, diagnosis: "D", prescription: "P", condition: "C" });
  assert.deepEqual(Array.from(queries.at(-1)!.params.slice(14)), ["D", "P", "C"]);
  await db.updateUser(person.id, { condition: null });
  assert.match(queries.at(-1)!.sql, /"condition" = \$1/);
  assert.equal(queries.at(-1)!.params[0], null, "migrated fields can be cleared");
  const before = queries.length;
  await db.updateUser(person.id, { name: "Core fields only" });
  assert.equal(queries.length, before + 1, "unrelated updates do not need a metadata query");
  await db.updateUser(person.id, { email: " New.Address@Example.invalid " });
  assert.match(queries.at(-1)!.sql, /SET email = \$1, email_hash = \$2 WHERE id = \$3/);
  assert.equal(decryptEmail(queries.at(-1)!.params[0]), "New.Address@Example.invalid");
  assert.equal(queries.at(-1)!.params[1], hashEmail("new.address@example.invalid"));

  // Rejected create/update must not reach downstream mail or notification effects.
  for (const [name, file] of [["POST", "../app/api/users/route.ts"], ["PUT", "../app/api/users/[id]/route.ts"]]) {
    let effects = 0;
    let auth: { role: string; email: string } | null = { role: "admin", email: "admin@example.invalid" };
    const sideEffect = async () => { effects++; };
    const context = vm.createContext({
      exports: {}, console: { error() {} },
      UserClinicalFieldsUnavailableError: db.UserClinicalFieldsUnavailableError,
      NextResponse: { json: (body: unknown, options?: { status: number }) => ({ body, status: options?.status ?? 200 }) },
      getAuthenticatedUser: async () => auth,
      isEmailTaken: async () => false, getNextUserId: async () => person.id,
      getUserById: async () => person,
      createUser: async () => { throw new db.UserClinicalFieldsUnavailableError(); },
      updateUser: async () => { throw new db.UserClinicalFieldsUnavailableError(); },
      setMustChangePassword: sideEffect, createNotification: sideEffect,
      sendAccountCreationEmail: sideEffect, sendAccountCreatedAdminEmail: sideEffect,
      sendEmailChangedToOldAddress: sideEffect, sendEmailChangedToNewAddress: sideEffect, sendEmailChangedAdminNotification: sideEffect,
    });
    vm.runInContext(extract(new URL(file, import.meta.url), [name]), context);
    const call = () => context.subject[name]({ json: async () => ({ ...person, diagnosis: "Fictional entry", therapistId: "fixture-therapist" }) }, { params: Promise.resolve({ id: person.id }) });
    const response = await call();
    assert.equal(response.status, 409);
    assert.equal(response.body.code, "clinical_fields_unavailable");
    assert.match(response.body.error, /leave Diagnosis, Condition and Prescription blank/);
    assert.equal(effects, 0);
    auth = { role: "therapist", email: "fixture@example.invalid" };
    assert.equal((await call()).status, 403);
    auth = null;
    assert.equal((await call()).status, 401);
  }
}

async function databaseChecks() {
  const connectionString = process.env.DATABASE_URL || readFileSync(new URL("../../.env.local", import.meta.url), "utf8")
    .match(/^DATABASE_URL\s*=\s*(.+)$/m)?.[1].trim().replace(/^["']|["']$/g, "");
  assert(connectionString, "DATABASE_URL is required for the explicit --database check");
  const client = new Client({ connectionString, connectionTimeoutMillis: 5000, statement_timeout: 5000 });
  try {
    await client.connect();
    await client.query("BEGIN");
    // Copy structure/defaults only, never public rows. users has no sequence ID.
    await client.query("CREATE TEMP TABLE users (LIKE public.users INCLUDING DEFAULTS) ON COMMIT DROP");
    const resolution = await client.query("SELECT 'users'::regclass = 'pg_temp.users'::regclass AS isolated");
    assert.equal(resolution.rows[0].isolated, true);
    for (const key of clinicalKeys) await client.query(`ALTER TABLE pg_temp.users DROP COLUMN IF EXISTS "${key}"`);
    const db = loadDb((sql, params) => client.query(sql, params));
    const created = await db.createUser({ ...person, ...blank });
    assert.equal(created.id, person.id);
    assert.equal(created.diagnosis, null);
    assert.equal((await db.updateUser(person.id, { name: "Updated fixture", ...blank }))?.name, "Updated fixture");
    await assert.rejects(() => db.updateUser(person.id, { name: "Must not persist", diagnosis: "Demo" }), db.UserClinicalFieldsUnavailableError);
    assert.equal((await db.updateUser(person.id, blank))?.name, "Updated fixture");
    // Run the owner migration's exact DDL twice, qualified to the private temp table.
    const migration = readFileSync(new URL("../../../scripts/user_clinical_fields_pg.sql", import.meta.url), "utf8");
    const ddl = migration.match(/ALTER TABLE users[\s\S]+?;/)?.[0];
    assert(ddl);
    for (let i = 0; i < 2; i++) await client.query(ddl.replace("ALTER TABLE users", "ALTER TABLE pg_temp.users"));
    const saved = await db.updateUser(person.id, { diagnosis: "D", prescription: "P", condition: "C" });
    assert.equal(saved?.diagnosis, "D");
    assert.equal(saved?.prescription, "P");
    assert.equal(saved?.condition, "C");
    assert.equal((await db.updateUser(person.id, { diagnosis: null }))?.diagnosis, null);
    const second = await db.createUser({ ...person, id: "clinical_fixture_two", email: "fixture-two@example.invalid", diagnosis: "D2", prescription: "P2", condition: "C2" });
    assert.equal(second.condition, "C2");
    console.log("Private PostgreSQL table: legacy writes, rejected nonempty fields, idempotent migration, migrated create/update/clear passed; rollback follows.");
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}
async function run() {
  await unitChecks();
  console.log("Clinical-field compatibility and API rejection/auth boundaries passed.");
  if (process.argv.includes("--database")) await databaseChecks();
}
run().catch(error => {
  // Do not print connection details from a failed explicit database check.
  console.error(process.argv.includes("--database") ? { name: error.name, code: error.code ?? "verification_failed", message: "Private-table verification failed; inspect the failing assertion locally." } : error);
  process.exitCode = 1;
});
