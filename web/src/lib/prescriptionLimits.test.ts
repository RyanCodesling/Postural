/** Exercise the real write routes with disposable auth, database and mail transports. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
type FixtureExercise = Record<string, unknown>;

function routeFixture(path: string) {
  const writes: unknown[] = [];
  class NotAllowedError extends Error {}
  const database = {
    DEFAULT_REST_SECONDS: 60,
    DEFAULT_HOLD_SECONDS: 30,
    ExerciseAssignmentNotAllowedError: NotAllowedError,
    ProgramExerciseNotAllowedError: NotAllowedError,
    getUsers: async () => [{ id: "fixture-patient" }],
    getUserById: async () => ({ id: "fixture-patient", role: "patient" }),
    getEffectiveNow: async () => new Date("2026-10-24T04:00:00Z"),
    getPatientExercises: async () => [],
    assignExercisesToPatient: async (_patient: string, exercises: unknown[]) => { writes.push(exercises); },
    createProgram: async (program: unknown) => { writes.push(program); return "fixture-program"; },
    updateProgram: async (_id: string, _therapist: string, program: unknown) => { writes.push(program); },
  };
  const context = vm.createContext({
    exports: {}, console, Error,
    require: (name: string) => {
      if (name === "next/server") return { NextResponse: { json: (body: unknown, init?: { status?: number }) => new Response(JSON.stringify(body), init) } };
      if (name === "@/lib/auth-server") return { getAuthenticatedUser: async () => ({ id: "fixture-therapist", role: "therapist", name: "Fixture therapist" }) };
      if (name === "@/lib/db") return database;
      if (name === "@/lib/email") return {};
      if (name.startsWith("@/lib/")) return require(fileURLToPath(new URL(`./${name.slice("@/lib/".length)}.ts`, import.meta.url)));
      throw new Error(`Unexpected route import: ${name}`);
    },
  });
  const source = readFileSync(new URL(path, import.meta.url), "utf8");
  vm.runInContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return {
    writes,
    submit: (exercises: FixtureExercise[]) => {
      const request = { json: async () => ({ patientId: "fixture-patient", name: "Fixture program", exercises }) };
      return (context.exports.POST ?? context.exports.PUT)(request, { params: Promise.resolve({ id: "fixture-program" }) }) as Promise<Response>;
    },
  };
}

const exercise = (sets: unknown, reps: unknown): FixtureExercise => ({
  exerciseId: "ex_001", name: "Lateral Arm Raises", sets, reps, sequenceIndex: 1,
  scheduledDate: "2026-10-24", endDate: "2026-10-25", recurrence: "interval", intervalDays: 1,
});

async function main() {
  for (const path of ["../app/api/patient-exercises/route.ts", "../app/api/programs/route.ts", "../app/api/programs/[id]/route.ts"]) {
    const fixture = routeFixture(path);
    for (const [sets, reps] of [[5, 10], [3, 21], [1.5, 10], [3, 10.5], [0, 10], [3, 0], ["3", 10], [3, "10"], [NaN, 10], [3, Infinity]]) {
      const response = await fixture.submit([exercise(sets, reps)]);
      assert.equal(response.status, 400, `${path} must reject ${sets} sets / ${reps} reps`);
      assert.match((await response.json()).error, /must be a whole number from 1 to (4|20)/);
      assert.equal(fixture.writes.length, 0, "invalid requests must never reach a writer");
    }
    const mixed = await fixture.submit([exercise(3, 10), { ...exercise(5, 10), exerciseId: "ex_008", sequenceIndex: 2 }]);
    assert.equal(mixed.status, 400, "one invalid dose must reject the entire submission");
    assert.equal(fixture.writes.length, 0);
    for (const [sets, reps] of [[1, 1], [4, 20]]) {
      const response = await fixture.submit([exercise(sets, reps)]);
      assert.equal(response.status, path.includes("patient-exercises") || path.includes("[id]") ? 200 : 201, await response.text());
      const write = JSON.parse(JSON.stringify(fixture.writes.at(-1)));
      const saved = Array.isArray(write) ? write[0] : write.exercises[0];
      assert.equal(saved.sets, sets);
      assert.equal(saved.reps, reps);
    }
    const blank = await fixture.submit([exercise(undefined, undefined)]);
    assert.equal(blank.status, path.includes("patient-exercises") ? 400 : path.includes("[id]") ? 200 : 201, "a dose is required on assignment, optional on templates");
    const hold = await fixture.submit([{ ...exercise(4, 1), exerciseId: "ex_006", holdSeconds: 30 }]);
    assert.equal(hold.status, path.includes("patient-exercises") || path.includes("[id]") ? 200 : 201, "hold prescriptions keep their independent duration target");
    // A hold does one hold per set, so it takes up to 10 sets; repetition exercises stay at 4 (above).
    const accepted = path.includes("patient-exercises") || path.includes("[id]") ? 200 : 201;
    const tenHolds = await fixture.submit([{ ...exercise(10, 1), exerciseId: "ex_006", holdSeconds: 10, restSeconds: 3 }]);
    assert.equal(tenHolds.status, accepted, "a hold exercise takes up to 10 sets, one hold each");
    const savedHolds = JSON.parse(JSON.stringify(fixture.writes.at(-1)));
    assert.equal((Array.isArray(savedHolds) ? savedHolds[0] : savedHolds.exercises[0]).sets, 10);
    const writesBefore = fixture.writes.length;
    const elevenHolds = await fixture.submit([{ ...exercise(11, 1), exerciseId: "ex_006", holdSeconds: 10 }]);
    assert.equal(elevenHolds.status, 400, "a hold exercise stops at 10 sets");
    assert.match((await elevenHolds.json()).error, /must be a whole number from 1 to 10/);
    assert.equal(fixture.writes.length, writesBefore, "a refused hold dose must never reach a writer");
    console.log(`PASS ${path}: invalid doses and mixed batches rejected before write; both bounds preserved`);
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
