/**
 * Attached files: an admin or the assigned therapist can bin one, only the
 * named patient's file is changed, the edit form's Delete asks
 * first, and the upload box asks for the patient's permission.
 *
 *   npx tsx src/lib/patientAttachmentDelete.test.ts
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { transpile } from "../../scripts/lib/cameraReplayHarness";

let passed = 0;
let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed += 1;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    failed += 1;
  }
}

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** The attachment route, run with a fake sign-in and a fake delete. */
function attachmentRoute(user: { id: string; role: string } | null, deletes: boolean) {
  const calls: unknown[][] = [];
  const context: any = vm.createContext({
    exports: {}, console: { error() {} },
    require: (name: string) => {
      if (name === "next/server") {
        return { NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), { status: init?.status ?? 200 }) } };
      }
      if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => user };
      if (name === "@/lib/db") {
        return {
          deletePatientAttachment: async (...args: unknown[]) => { calls.push(args); return deletes; },
          DeletedItemsBinUnavailableError: class extends Error {},
          getPatientAttachment: async () => null,
          getUserById: async () => ({ id: "patient_007", role: "patient", therapistId: "assigned_therapist" }),
          getUserRawById: async () => null,
        };
      }
      if (name === "@/lib/crypto") return { comparePassword: () => false };
      if (name === "@/lib/patientAttachments") return { isPatientImageMimeType: () => false };
      throw new Error(`Unexpected attachment route import ${name}`);
    },
  });
  vm.runInContext(transpile(read("../app/api/users/[id]/attachments/[attachmentId]/route.ts")), context);
  return { route: context.exports, calls };
}

const target = (id: string, attachmentId: string) => ({ params: Promise.resolve({ id, attachmentId }) });
const request = () => new Request("http://localhost/api/users/patient_007/attachments/5", { method: "DELETE" });

async function run() {
  console.log("\nPatient attachments: delete\n");

  await test("only an admin or the assigned therapist bins the named patient's file", async () => {
    for (const [user, status] of [
      [null, 401],
      [{ id: "therapist_001", role: "therapist" }, 403],
      [{ id: "patient_007", role: "patient" }, 403],
    ] as const) {
      const { route, calls } = attachmentRoute(user, true);
      assert.equal((await route.DELETE(request(), target("patient_007", "5"))).status, status, `${user?.role ?? "signed out"}`);
      assert.equal(calls.length, 0, "nothing is deleted");
    }
    const admin = { id: "admin_001", role: "admin" };
    const bad = attachmentRoute(admin, true);
    assert.equal((await bad.route.DELETE(request(), target("patient_007", "abc"))).status, 404, "a malformed id");
    assert.equal(bad.calls.length, 0);
    const missing = attachmentRoute(admin, false);
    assert.equal((await missing.route.DELETE(request(), target("patient_007", "5"))).status, 404, "not this patient's, or gone");
    const ok = attachmentRoute(admin, true);
    const response = await ok.route.DELETE(request(), target("patient_007", "5"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true });
    assert.deepEqual(ok.calls, [["patient_007", 5, admin.id]], "the patient, file and deleting actor are named");
    const therapist = attachmentRoute({ id: "assigned_therapist", role: "therapist" }, true);
    assert.equal((await therapist.route.DELETE(request(), target("patient_007", "5"))).status, 200);
    assert.deepEqual(therapist.calls, [["patient_007", 5, "assigned_therapist"]]);
  });

  await test("the database bins only the patient's matching live file, atomically", async () => {
    const source = read("./db.ts");
    const ast = ts.createSourceFile("db.ts", source, ts.ScriptTarget.Latest, true);
    const fn = ast.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "deletePatientAttachment")!;
    const queries: Array<[string, unknown[]]> = [];
    let matches = true;
    const query = async (sql: string, values: unknown[] = []) => {
      queries.push([sql, Array.from(values)]);
      return { rows: sql.includes("RETURNING file_name") && matches ? [{ file_name: "fixture.pdf" }] : [] };
    };
    const context: any = vm.createContext({
      exports: {}, hasDeletedItemsBin: async () => true,
      pool: { connect: async () => ({ query, release() {} }) },
    });
    vm.runInContext(transpile(fn.getText(ast)), context);
    assert.equal(await context.exports.deletePatientAttachment("patient_007", 5, "fixture-admin"), true);
    assert.match(queries[1][0], /WHERE id = \$1 AND patient_id = \$2 AND deleted_at IS NULL/);
    assert.deepEqual(queries[1][1], [5, "patient_007", "fixture-admin"]);
    assert.match(queries[2][0], /INSERT INTO deleted_items/);
    assert.deepEqual(queries[2][1], ["patient_007", 5, "fixture.pdf", "fixture-admin"]);
    assert.equal(queries[3][0], "COMMIT");
    matches = false;
    const before = queries.length;
    assert.equal(await context.exports.deletePatientAttachment("patient_008", 5, "fixture-admin"), false);
    assert.equal(queries.at(-1)![0], "ROLLBACK");
    assert.equal(queries.length - before, 3, "an unmatched file never receives a bin entry");
  });

  await test("the edit form lists the files with a Delete that asks first; the upload asks for permission (source)", () => {
    const admin = read("../app/(app)/dashboard/admin/page.tsx");
    assert.match(admin, /<PatientAttachmentList\s+files=\{editAttachments\.files\}/, "lists the loaded patient's files");
    assert.match(admin, /removedIds=\{editRemovedAttachmentIds\}/, "deletions stay staged until the edit is confirmed");
    assert.match(admin, /method: "DELETE"/);
    assert.match(admin, /Recently Deleted/, "explains recovery rather than claiming immediate erasure");
    assert.match(admin, /Upload a patient&apos;s documents only with their permission\./);
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exitCode = 1;
}

void run();
