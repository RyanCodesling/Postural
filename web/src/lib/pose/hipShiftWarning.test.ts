/**
 * hipShiftWarning.test.ts
 *
 * Pins the side-bend hip check: the hips' sideways movement away from the bend
 * side, in hip widths, against the stance just before the bend; judged once
 * per bend, flagged only after it persists, held until upright, and the same
 * on a mirrored image.
 *
 * USAGE
 *   npx tsx src/lib/pose/hipShiftWarning.test.ts
 */

import {
  hipShiftGeometry,
  newHipShiftState,
  updateHipShift,
  type HipShiftGeometry,
  type HipShiftState,
} from "./hipShiftWarning";

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

function assertClose(actual: number | null, expected: number, label: string): void {
  if (actual === null || Math.abs(actual - expected) > 1e-9) {
    throw new Error(`${label}: expected ${expected}, got ${JSON.stringify(actual)}`);
  }
}

const CHECK = { stanceMs: 1500, from: 10, persistMs: 100, restBelow: 5 };
const LEVEL = 0.45;

type Frame = { lean: number | null; hipX: number; earOffset: number; hipWidth?: number } | { lean: number; missing: true };

/** Feeds frames 50 ms apart; returns each frame's value and the final state. */
function run(frames: Frame[], check = CHECK, start: HipShiftState = newHipShiftState()) {
  let state = start;
  const values: (number | null)[] = [];
  frames.forEach((frame, i) => {
    const geometry: HipShiftGeometry | null = "missing" in frame ? null
      : { hipX: frame.hipX, hipWidth: frame.hipWidth ?? 0.1, earOffset: frame.earOffset };
    const step = updateHipShift(state, { geometry, lean: frame.lean, nowMs: i * 50 }, check, LEVEL);
    state = step.state;
    values.push(step.value);
  });
  return { values, state };
}

// Upright at hip x 0.5 (hip width 0.1), ears above the hips.
const STAND = { lean: 0, hipX: 0.5, earOffset: 0 };
const standing = (n: number): Frame[] => Array.from({ length: n }, () => STAND);
// A bend whose head moves toward larger image x; `push` moves the hips the
// other way, in hip widths.
const bend = (lean: number, push: number): Frame => ({ lean, hipX: 0.5 - push * 0.1, earOffset: 0.08 });

console.log("\nside-bend hip check\n");

test("geometry: midpoints and widths from ears and hips; null when unusable", () => {
  const lm: { x: number; y: number; visibility?: number }[] = [];
  lm[7] = { x: 0.55, y: 0.2 }; lm[8] = { x: 0.45, y: 0.2 };
  lm[23] = { x: 0.56, y: 0.6, visibility: 0.9 }; lm[24] = { x: 0.44, y: 0.6, visibility: 0.9 };
  const g = hipShiftGeometry(lm);
  assertClose(g?.hipX ?? null, 0.5, "hip midpoint");
  assertClose(g?.hipWidth ?? null, 0.12, "hip width");
  assertClose(g?.earOffset ?? null, 0, "ear offset");
  assertEq(hipShiftGeometry([...lm.slice(0, 23), { x: 0.56, y: 0.6, visibility: 0.3 }, lm[24]]), null, "occluded hip");
  assertEq(hipShiftGeometry([...lm.slice(0, 23), { x: 1.2, y: 0.6 }, lm[24]]), null, "off-frame hip");
  assertEq(hipShiftGeometry([...lm.slice(0, 23), { x: 0.445, y: 0.6 }, lm[24]]), null, "hips nearly coincide");
  const noEar = [...lm]; noEar[8] = undefined as never;
  assertEq(hipShiftGeometry(noEar), null, "missing ear");
});

test("upright there is no value", () => {
  const { values } = run(standing(5));
  assertEq(values.every((v) => v === null), true, "no value while standing");
});

test("hips pushed away for the persistence time are flagged and held until upright", () => {
  const { values } = run([
    ...standing(4),
    bend(7, 0.5),   // 200 ms: bending, below `from`: not judged yet
    bend(12, 0.5),  // 250 ms: over the line, run starts
    bend(15, 0.5),  // 300 ms
    bend(18, 0.6),  // 350 ms: 100 ms over: flagged at 0.6
    bend(20, 0.1),  // hips back over the feet: still held
    bend(8, 0.0),   // returning, below `from`: still held
    STAND,          // upright: released
  ]);
  assertEq(values[4], null, "below `from`");
  assertClose(values[5], 0.5, "live value before the flag");
  assertClose(values[7], 0.6, "flagged");
  assertClose(values[8], 0.6, "held at the bottom");
  assertClose(values[9], 0.6, "held on the way up");
  assertEq(values[10], null, "released upright");
});

test("an ordinary counter-shift passes through below the line and is never held", () => {
  const { values } = run([...standing(4), bend(12, 0.2), bend(18, 0.3), bend(12, 0.1), STAND]);
  assertClose(values[4], 0.2, "live");
  assertClose(values[5], 0.3, "live");
  assertClose(values[6], 0.1, "live, not held");
});

test("a spike shorter than the persistence time is not held", () => {
  const { values } = run([...standing(4), bend(12, 0.6), bend(15, 0.2), bend(18, 0.2)]);
  assertClose(values[6], 0.2, "back to the live value after a 50 ms spike");
});

test("a run broken by a frame that is not judged, or has no reading, is not flagged", () => {
  // Two 50 ms pushes over the line, separated by a frame below `from` (or a
  // missing reading): neither run lasts the 100 ms persistence time.
  const belowFrom = run([
    ...standing(2), bend(12, 0.6), bend(8, 0), bend(12, 0.6), bend(12, 0.2),
  ]);
  assertEq(belowFrom.state.heldValue, null, "no flag across a frame below `from`");
  assertClose(belowFrom.values[5], 0.2, "back to the live value");
  const missing = run([
    ...standing(2), bend(12, 0.6), { lean: 12, missing: true }, bend(12, 0.6), bend(12, 0.2),
  ]);
  assertEq(missing.state.heldValue, null, "no flag across a missing reading");
  // An unbroken run of the same pushes still flags.
  const unbroken = run([...standing(2), bend(12, 0.6), bend(12, 0.6), bend(12, 0.6)]);
  assertClose(unbroken.state.heldValue, 0.6, "an unbroken 100 ms run flags");
});

test("hips moving toward the bend side read 0", () => {
  const { values } = run([...standing(4), bend(15, -0.6)]);
  assertEq(values[4], 0, "toward the bend");
});

test("the same bend on a mirrored image gives the same value", () => {
  // Mirror every x about 0.5: the head now moves toward smaller x and the
  // pushed hips toward larger x.
  const mirror = (f: Frame): Frame => ("missing" in f ? f : { ...f, hipX: 1 - f.hipX, earOffset: -f.earOffset });
  const frames = [...standing(4), bend(12, 0.5), bend(15, 0.5), bend(18, 0.6)];
  const plain = run(frames).values;
  const mirrored = run(frames.map(mirror)).values;
  for (let i = 0; i < frames.length; i++) {
    const [a, b] = [plain[i], mirrored[i]];
    if (a === null || b === null ? a !== b : Math.abs(a - b) > 1e-9) {
      throw new Error(`frame ${i}: plain ${a}, mirrored ${b}`);
    }
  }
});

test("the stance is the median of recent upright frames since the previous bend", () => {
  // Upright frames older than stanceMs, and those before the previous bend,
  // do not count; the patient stepped 0.3 hip widths toward smaller x after
  // the first bend, so judging the second bend against the old stance would
  // read a large push.
  const stepped = { lean: 0, hipX: 0.47, earOffset: 0 };
  const { values } = run([
    ...standing(4),
    bend(15, 0),
    ...Array.from({ length: 6 }, () => stepped),
    { lean: 15, hipX: 0.47 - 0.02, earOffset: 0.08 }, // 0.2 hip widths from the new stance
  ]);
  assertClose(values.at(-1) ?? null, 0.2, "judged against the stance after the step");
});

test("a bend that starts without two stance frames is not judged", () => {
  const { values } = run([STAND, bend(15, 0.9), bend(18, 0.9), bend(20, 0.9)]);
  assertEq(values.every((v) => v === null), true, "one stance frame only");
});

test("a frame without landmarks keeps a flagged bend's warning", () => {
  const { values } = run([
    ...standing(4), bend(12, 0.5), bend(15, 0.5), bend(18, 0.5), { lean: 18, missing: true }, bend(18, 0.5),
  ]);
  assertClose(values[7], 0.5, "held through the missing frame");
  const unflagged = run([...standing(4), bend(12, 0.2), { lean: 15, missing: true }]).values;
  assertEq(unflagged[5], null, "nothing to hold before a flag");
});

console.log(`\n  ${testsPassed} passed, ${testsFailed} failed\n`);
process.exit(testsFailed === 0 ? 0 : 1);
