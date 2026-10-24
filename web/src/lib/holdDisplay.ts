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
 * that arm is out of position.
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
};

export type PerArmHoldDisplay = {
  /** The credited hold in whole seconds: the number that ends the set. */
  seconds: number;
  done: boolean;
  arms: [HoldArmDisplay, HoldArmDisplay];
};

export function perArmHoldDisplay(
  hold: { leftSec: number; rightSec: number; leftInBand: boolean; rightInBand: boolean },
  prescription: { holdSeconds: number; prescribedSide: PrescribedSide },
): PerArmHoldDisplay {
  const credited =
    prescription.prescribedSide === "left"
      ? hold.leftSec
      : prescription.prescribedSide === "right"
        ? hold.rightSec
        : Math.min(hold.leftSec, hold.rightSec);
  const seconds = Math.floor(credited);
  const arm = (side: "left" | "right", sec: number, inBand: boolean): HoldArmDisplay => {
    const whole = Math.floor(sec);
    return {
      side,
      label: side === "left" ? "L" : "R",
      seconds: whole,
      tone: whole >= prescription.holdSeconds ? "done" : inBand ? "counting" : "paused",
      observation: prescription.prescribedSide !== "both" && prescription.prescribedSide !== side,
    };
  };
  return {
    seconds,
    done: seconds >= prescription.holdSeconds,
    arms: [arm("left", hold.leftSec, hold.leftInBand), arm("right", hold.rightSec, hold.rightInBand)],
  };
}
