import type { HoldHint } from "./pose/holdHint";
import type { PrescribedSide } from "./prescriptionContext";

/**
 * What the camera shows for a per-arm hold ("Arm Abduction at 90°", ex_006).
 *
 * Each arm keeps its own timer, which runs only while that arm is in the
 * target band, and the set ends when the credited arm reaches the hold: the
 * slower arm for a both-arms prescription, the prescribed arm otherwise. Shown
 * as two big numbers, the per-arm timers drift out of step whenever the arms
 * reach the band at different moments or one slips out briefly, which reads as
 * a counting fault. So the main number is the credited hold, the one that ends
 * the set, and each arm's own seconds stay on screen beneath it, greyed while
 * that arm is out of position. A paused arm that counts toward the set also says
 * which way to move once it has stayed out (`hint`, holdHint.ts).
 *
 * Display only: no timer, completion rule or stored value depends on this.
 */

/** "done": reached the hold. "counting": in position. "paused": out of position, so not counting. */
export type HoldArmTone = "done" | "counting" | "paused";

export type HoldArmDisplay = {
  side: "left" | "right";
  label: "L" | "R";
  /** Whole seconds held, as the timer shows them. */
  seconds: number;
  tone: HoldArmTone;
  /** The arm the prescription does not include: shown, but it does not end the set. */
  observation: boolean;
  /** Which way to move back into the band: only on a paused arm that counts toward the set. */
  hint: HoldHint | null;
};

export type PerArmHoldDisplay = {
  /** The credited hold in whole seconds: the number that ends the set. */
  seconds: number;
  done: boolean;
  arms: [HoldArmDisplay, HoldArmDisplay];
};

export function perArmHoldDisplay(
  hold: {
    leftSec: number;
    rightSec: number;
    leftInBand: boolean;
    rightInBand: boolean;
    leftHint?: HoldHint | null;
    rightHint?: HoldHint | null;
  },
  prescription: { holdSeconds: number; prescribedSide: PrescribedSide },
): PerArmHoldDisplay {
  const credited =
    prescription.prescribedSide === "left"
      ? hold.leftSec
      : prescription.prescribedSide === "right"
        ? hold.rightSec
        : Math.min(hold.leftSec, hold.rightSec);
  const seconds = Math.floor(credited);
  const arm = (side: "left" | "right", sec: number, inBand: boolean, hint: HoldHint | null | undefined): HoldArmDisplay => {
    const whole = Math.floor(sec);
    const tone: HoldArmTone = whole >= prescription.holdSeconds ? "done" : inBand ? "counting" : "paused";
    const observation = prescription.prescribedSide !== "both" && prescription.prescribedSide !== side;
    return {
      side,
      label: side === "left" ? "L" : "R",
      seconds: whole,
      tone,
      observation,
      hint: tone === "paused" && !observation ? hint ?? null : null,
    };
  };
  return {
    seconds,
    done: seconds >= prescription.holdSeconds,
    arms: [
      arm("left", hold.leftSec, hold.leftInBand, hold.leftHint),
      arm("right", hold.rightSec, hold.rightInBand, hold.rightHint),
    ],
  };
}
