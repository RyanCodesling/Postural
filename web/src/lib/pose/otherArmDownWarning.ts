/**
 * Display-only arm-height guidance during a timed bilateral hold.
 * Each unfinished arm is compared with the hold's existing band independently:
 * a slightly low opposite arm must not hide a substantially lowered arm.
 * Per-arm waits prevent side changes from restarting the other arm's wait.
 * Among qualified arms the one furthest outside the band is drawn first, and
 * the cue then stays on that arm while it still qualifies, so two arms about
 * equally far out do not pass it back and forth on reading noise.
 * Neither this check nor its upper-band counterpart affects hold credit.
 */
export type OtherArmDownCheck = {
    persistMs: number;
    low: number;
    high: number;
};
export type OtherArmDownState = {
    leftSinceMs: number | null;
    rightSinceMs: number | null;
    /** The arm cued on the previous update, if any. */
    side: "left" | "right" | null;
};
type Arm = {
    value: number | null;
    unsteady: boolean;
    done: boolean;
};
type Input = {
    left: Arm;
    right: Arm;
    timed: boolean;
    nowMs: number;
};
export function newOtherArmDownState(): OtherArmDownState {
    return { leftSinceMs: null, rightSinceMs: null, side: null };
}
function updateHoldHeight(state: OtherArmDownState, input: Input, check: OtherArmDownCheck, direction: "below" | "above") {
    const finite = (value: number | null): value is number => typeof value === "number" && Number.isFinite(value);
    if (!input.timed || input.left.unsteady || input.right.unsteady || !finite(input.left.value) || !finite(input.right.value)) {
        return { state: newOtherArmDownState(), value: null, side: null };
    }
    let value: number | null = null;
    let side: "left" | "right" | null = null;
    let largestError = -Infinity;
    const next: OtherArmDownState = newOtherArmDownState();
    for (const s of ["left", "right"] as const) {
        const arm = input[s];
        const v = arm.value!;
        const error = direction === "below" ? check.low - v : v - check.high;
        const key = s === "left" ? "leftSinceMs" : "rightSinceMs";
        if (arm.done || error <= 0)
            continue;
        const sinceMs = state[key] ?? input.nowMs;
        next[key] = sinceMs;
        // The arm already cued outranks the other while it still qualifies.
        const rank = s === state.side ? Infinity : error;
        if (input.nowMs - sinceMs >= check.persistMs && rank > largestError) {
            value = v;
            side = s;
            largestError = rank;
        }
    }
    next.side = side;
    return { state: next, value, side };
}
export function updateOtherArmDown(state: OtherArmDownState, input: Input, check: OtherArmDownCheck) {
    return updateHoldHeight(state, input, check, "below");
}
export function updateArmAboveHold(state: OtherArmDownState, input: Input, check: OtherArmDownCheck) {
    return updateHoldHeight(state, input, check, "above");
}
