/**
 * Run with:
 *   npx tsx src/lib/pose/neutralCalibration.test.ts
 */
import {
  NEUTRAL_CALIBRATION_DURATION_MS,
  advanceNeutralCalibrationClock,
  frozenNeutralTiltReference,
  medianFinite,
  neutralCalibrationProgressPct,
  neutralCalibrationReady,
  newNeutralCalibrationClock,
  pauseNeutralCalibrationClock,
} from "./neutralCalibration";
import { computeShoulderSymmetry, type TiltReference } from "./poseMetrics";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function clockAtFps(fps: number) {
  let clock = newNeutralCalibrationClock();
  const tick = 1_000 / fps;
  for (let now = 0; now <= NEUTRAL_CALIBRATION_DURATION_MS + tick; now += tick) {
    clock = advanceNeutralCalibrationClock(clock, now);
  }
  return clock;
}

for (const fps of [5, 10, 30]) {
  const clock = clockAtFps(fps);
  assert(neutralCalibrationReady(clock), `${fps} FPS did not become ready`);
  assert(
    neutralCalibrationProgressPct(clock) === 100,
    `${fps} FPS progress did not reach 100`,
  );
}

{
  let clock = newNeutralCalibrationClock();
  clock = advanceNeutralCalibrationClock(clock, 0);
  clock = advanceNeutralCalibrationClock(clock, 100);
  clock = pauseNeutralCalibrationClock(clock);
  clock = advanceNeutralCalibrationClock(clock, 2_000);
  assert(
    clock.validElapsedMs === 100,
    "paused readiness gap was credited to calibration",
  );
}

{
  let clock = newNeutralCalibrationClock();
  clock = advanceNeutralCalibrationClock(clock, 0);
  clock = advanceNeutralCalibrationClock(clock, 5_000);
  assert(
    clock.validElapsedMs === 250,
    "single stalled frame exceeded the credited-dt cap",
  );
  assert(!neutralCalibrationReady(clock), "stalled frames completed calibration");
}

{
  let clock = newNeutralCalibrationClock();
  for (let index = 0; index < 14; index += 1) {
    clock = advanceNeutralCalibrationClock(clock, index * 250);
  }
  assert(
    clock.validElapsedMs >= NEUTRAL_CALIBRATION_DURATION_MS,
    "test setup did not satisfy duration",
  );
  assert(!neutralCalibrationReady(clock), "fewer than 15 samples were accepted");
}

assert(medianFinite([1, 2, 3, 100]) === 2.5, "even median is incorrect");
assert(medianFinite([1, 2, 100]) === 2, "odd median is incorrect");
assert(
  medianFinite([Number.NaN, 2, Number.POSITIVE_INFINITY]) === 2,
  "non-finite samples were not ignored",
);
assert(medianFinite([]) === null, "empty median must be null");

{
  const landmarks = Array.from({ length: 33 }, () => ({
    x: 0,
    y: 0,
    visibility: 0,
  }));
  landmarks[11] = { x: 0.6, y: 0.3, visibility: 1 };
  landmarks[12] = { x: 0.4, y: 0.3, visibility: 1 };
  const observedA: TiltReference = {
    cameraTiltDeg: 0,
    confidence: "high",
    divergenceDeg: 0,
  };
  const observedB: TiltReference = {
    cameraTiltDeg: 12,
    confidence: "high",
    divergenceDeg: 2,
  };
  const first = computeShoulderSymmetry(
    landmarks,
    frozenNeutralTiltReference(observedA, 4.5),
  );
  const second = computeShoulderSymmetry(
    landmarks,
    frozenNeutralTiltReference(observedB, 4.5),
  );
  assert(first?.angleDeg === 4.5, "frozen correction was not applied");
  assert(
    second?.angleDeg === first.angleDeg &&
      second.elevatedSide === first.elevatedSide,
    "a changing observed tilt altered a static landmark outcome",
  );
}

console.log("neutralCalibration tests passed");
