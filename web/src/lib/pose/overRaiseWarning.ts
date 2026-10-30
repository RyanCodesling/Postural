/**
 * Live, display-only past-shoulder-height guidance for lateral raises.
 * A prescribed arm must stay above the existing line for persistMs. The cue
 * clears at its existing hysteresis clear level, including when corrected to
 * shoulder height during the same repetition. With both arms flagged, the
 * higher arm is the warning first, and the warning then stays on that arm
 * while it is still flagged, so the label does not jump between wrists as two
 * arms over the line trade the higher reading. It never changes rep counting.
 */
export type OverRaiseCheck = {
    persistMs: number;
    clearBelow: number;
};
type ArmState = {
    active: boolean;
    overSinceMs: number | null;
};
export type OverRaiseState = {
    left: ArmState;
    right: ArmState;
    /** The arm reported on the previous update, if any. */
    side: "left" | "right" | null;
};
const AT_REST: ArmState = { active: false, overSinceMs: null };
export function newOverRaiseState(): OverRaiseState {
    return { left: { ...AT_REST }, right: { ...AT_REST }, side: null };
}
function updateArm(arm: ArmState, primary: number | null, nowMs: number, check: OverRaiseCheck, level: number) {
    if (typeof primary !== "number" || !Number.isFinite(primary) || primary <= check.clearBelow) {
        return { state: { ...AT_REST }, value: null };
    }
    if (primary < level && !arm.active)
        return { state: { ...AT_REST }, value: null };
    const overSinceMs = arm.overSinceMs ?? nowMs;
    const active = arm.active || nowMs - overSinceMs >= check.persistMs;
    // Keep the latch active only within its already-declared hysteresis band,
    // rather than retaining the repetition's old maximum after a correction.
    return { state: { active, overSinceMs }, value: active ? Math.max(level, primary) : null };
}
export function updateOverRaise(state: OverRaiseState, input: {
    left: number | null;
    right: number | null;
    sides: readonly ("left" | "right")[];
    nowMs: number;
}, check: OverRaiseCheck, level: number): {
    state: OverRaiseState;
    value: number | null;
    side: "left" | "right" | null;
} {
    const left = updateArm(state.left, input.left, input.nowMs, check, level);
    const right = updateArm(state.right, input.right, input.nowMs, check, level);
    let value: number | null = null;
    let side: "left" | "right" | null = null;
    let largest = -Infinity;
    for (const s of input.sides) {
        const v = s === "left" ? left.value : right.value;
        // The arm already reported outranks the other while it stays flagged.
        const rank = s === state.side ? Infinity : v ?? -Infinity;
        if (v !== null && rank > largest) {
            value = v;
            side = s;
            largest = rank;
        }
    }
    return { state: { left: left.state, right: right.state, side }, value, side };
}
