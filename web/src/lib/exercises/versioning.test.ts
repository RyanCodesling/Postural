/**
 * versioning.test.ts
 *
 * Pins the boundary between MEASUREMENT configuration and COACHING
 * configuration in `exerciseConfigVersion`.
 *
 * Why this exists: `exerciseConfigVersion` is persisted on every session, and
 * `groupSessionsByExercise()` starts a NEW therapist trend group whenever it
 * changes — on the premise that a side, load, or threshold change makes earlier
 * sessions non-comparable. Coaching cues change none of that. When the `cue`
 * field was first added to `CompensationMetricSpec` it moved all eight hashes,
 * which would have split every patient's trend at that commit while implying a
 * measurement change that never happened.
 *
 * `exerciseVersionPayload()` therefore strips `cue` before hashing. Nothing
 * else enforced that, so this suite does: a cue-only edit must not move the
 * hash, and a real measurement edit must still move it.
 *
 * USAGE — must run from `web/`, unlike most suites here:
 *   npx tsx src/lib/exercises/versioning.test.ts
 *
 * `versioning.ts` imports `@/lib/pose/metricVersion` as a RUNTIME value, so the
 * path alias has to resolve at execution. Sibling suites only ever import `@/`
 * types, which are erased, so they also run from the repository root. This one
 * does not.
 */

import {
  EXERCISE_REGISTRY,
  type CompensationCueSpec,
  type CompensationMetricSpec,
  type ExerciseDefinition,
} from "./registry";
import {
  EXERCISE_CONFIG_VERSIONS,
  canonicalJson,
  effectiveCompensationBands,
  exerciseVersionPayload,
  sha256Version,
} from "./versioning";

let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS ${name}`);
    testsPassed += 1;
  } catch (err) {
    console.log(`  FAIL ${name}`);
    console.log(`      ${err instanceof Error ? err.message : String(err)}`);
    testsFailed += 1;
  }
}

function assertEq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertNotEq(actual: unknown, unexpected: unknown, label: string): void {
  if (actual === unexpected) {
    throw new Error(`${label}: expected a value different from ${JSON.stringify(unexpected)}`);
  }
}

const BASE = EXERCISE_REGISTRY.ex_001;

/** Deep clone that keeps the discriminated-union shape usable. */
function clone(definition: ExerciseDefinition): ExerciseDefinition {
  return JSON.parse(JSON.stringify(definition)) as ExerciseDefinition;
}

/** Applies `mutate` to the first compensation metric of a cloned ex_001. */
function withFirstComp(
  mutate: (comp: CompensationMetricSpec) => void,
): ExerciseDefinition {
  const next = clone(BASE);
  mutate(next.compensationMetrics[0]);
  return next;
}

const version = (definition: ExerciseDefinition) =>
  sha256Version(exerciseVersionPayload(definition));

const BASE_VERSION = version(BASE);

// ── The invariant ───────────────────────────────────────────────────────────

test("the fixture actually carries a cue, so these tests are not vacuous", () => {
  assertEq(typeof BASE.compensationMetrics[0].cue?.id, "string", "ex_001 first comp cue id");
  assertEq(
    BASE.compensationMetrics.every((comp) => comp.cue !== undefined),
    true,
    "every ex_001 compensation metric declares a cue",
  );
});

test("rewording a cue does not change the exercise config version", () => {
  const reworded = withFirstComp((comp) => {
    (comp.cue as CompensationCueSpec).message = "Completely different wording.";
  });
  assertEq(version(reworded), BASE_VERSION, "message change");
});

test("reordering cue priority does not change the exercise config version", () => {
  const reprioritised = withFirstComp((comp) => {
    (comp.cue as CompensationCueSpec).priority += 5;
  });
  assertEq(version(reprioritised), BASE_VERSION, "priority change");
});

test("cue timing overrides do not change the exercise config version", () => {
  const retimed = withFirstComp((comp) => {
    const cue = comp.cue as CompensationCueSpec;
    cue.minActiveMs = 1234;
    cue.minDisplayMs = 4321;
    cue.cooldownMs = 9876;
  });
  assertEq(version(retimed), BASE_VERSION, "timing override change");
});

test("renaming a cue id does not change the exercise config version", () => {
  const renamed = withFirstComp((comp) => {
    (comp.cue as CompensationCueSpec).id = "ex_001.renamed-for-this-test";
  });
  assertEq(version(renamed), BASE_VERSION, "cue id change");
});

test("removing every cue entirely does not change the exercise config version", () => {
  const stripped = clone(BASE);
  for (const comp of stripped.compensationMetrics) delete comp.cue;
  assertEq(version(stripped), BASE_VERSION, "all cues removed");
});

test("the hashed payload contains no cue data at all", () => {
  const json = canonicalJson(exerciseVersionPayload(BASE));
  assertEq(json.includes("\"cue\""), false, "payload has no cue key");
  assertEq(
    json.includes(BASE.compensationMetrics[0].cue!.id),
    false,
    "payload does not leak a cue id",
  );
  assertEq(
    json.includes(BASE.compensationMetrics[0].cue!.message),
    false,
    "payload does not leak cue wording",
  );
});

// ── The other half: real measurement changes must still register ────────────

test("a warning-threshold change DOES change the exercise config version", () => {
  const retuned = withFirstComp((comp) => {
    comp.warningThreshold += 1;
  });
  assertNotEq(version(retuned), BASE_VERSION, "warningThreshold change");
});

test("a deduction-band override change DOES change the exercise config version", () => {
  const rebanded = withFirstComp((comp) => {
    if (!comp.bandsOverride) throw new Error("fixture lost its bandsOverride");
    comp.bandsOverride[0].deductionMax += 1;
  });
  assertNotEq(version(rebanded), BASE_VERSION, "bandsOverride change");
});

test("a primary-threshold change DOES change the exercise config version", () => {
  const next = clone(BASE);
  if (next.kind !== "dynamic") throw new Error("fixture is not dynamic");
  next.primaryMetric.thresholds.targetROM += 1;
  assertNotEq(version(next), BASE_VERSION, "targetROM change");
});

test("dropping a compensation metric DOES change the exercise config version", () => {
  const next = clone(BASE);
  next.compensationMetrics = next.compensationMetrics.slice(1);
  assertNotEq(version(next), BASE_VERSION, "metric removed");
});

// ── Bands still resolve with cues present ───────────────────────────────────

test("effective bands still resolve through a spec that carries a cue", () => {
  const bands = effectiveCompensationBands(BASE);
  assertEq(
    Object.keys(bands).length,
    BASE.compensationMetrics.length,
    "one entry per compensation metric",
  );
  assertEq(Array.isArray(bands.trunkLean), true, "trunkLean override survived the cue field");
});

// ── The live registry ───────────────────────────────────────────────────────

test("every registry exercise resolves to a stable, distinct config version", () => {
  const ids = Object.keys(EXERCISE_REGISTRY);
  assertEq(ids.length > 0, true, "registry is non-empty");
  for (const id of ids) {
    const recomputed = sha256Version(exerciseVersionPayload(EXERCISE_REGISTRY[id]));
    assertEq(EXERCISE_CONFIG_VERSIONS[id], recomputed, `${id} recomputes to the exported value`);
    assertEq(recomputed.startsWith("sha256:"), true, `${id} is a sha256 label`);
  }
  assertEq(
    new Set(Object.values(EXERCISE_CONFIG_VERSIONS)).size,
    ids.length,
    "no two exercises share a config version",
  );
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
