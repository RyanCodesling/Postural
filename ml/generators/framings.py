"""
Structural framings that turn per-rep synthesis into a full session.

Three families mirror how the live camera loop wires angles into rep counters:

- dynamic_per_limb        : two limbs tracked independently (e.g. lateral raises)
- bidirectional           : one alternating signed motion (e.g. side bends, neck tilt)
- isometric               : a timed hold, no rep state machine

All three are implemented. Isometric "reps" are holds: one RepResult per
(set, side) with rep_index always 1, matching how the live system groups
isometric frames (per set, no rep counter).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from generators.base import (RepResult, SubjectLatents, sample_hold_severity,
                             sample_session_severity, synthesize_hold, synthesize_rep)
from generators.registry import ExerciseParams

# Compensation channels measured on the body, not a limb: both sides of a frame
# carry the same value (the real-capture mapping duplicates them the same way).
# scapularElevation stays per-side.
_BODY_RELATIVE_COMPS = frozenset({"trunkLean", "shoulderSymmetry", "neckTilt"})


@dataclass
class SessionData:
    exercise_id: str
    subject_id: int
    session_id: int
    label: int
    reps: list[RepResult]
    set_targets: dict[int, int]  # set_index -> prescribed reps (dynamic) or hold seconds per side (isometric)


def _comp_metrics(params: ExerciseParams) -> tuple[str, ...]:
    # Warning-only (scoring:off) metrics are not synthesized — see
    # ExerciseParams.scored_compensations.
    return tuple(c.name for c in params.scored_compensations)


# Per-exercise primary-trajectory scale (rest_range, meas_noise, jerk_tremor_gain),
# in the primary metric's OWN units. The degree-scale default fits the angle
# exercises; ex_007's primary is a body-normalized vertical hand displacement
# (wristShoulderVertical: real resting level ≈ -0.46 ± 0.49, per-frame noise
# ≈ 0.025, clean peaks ≈ 0.9-0.98 vs target 0.85), so it overrides to normalized
# values fitted from the real recording. Single-subject pilot values. NOT derived
# from target_rom — that would wrongly shrink ex_005 (degrees, small 25° target).
_DEGREE_PRIMARY_SCALE: tuple[tuple[float, float], float, float] = ((3.0, 8.0), 1.2, 1.5)
_PRIMARY_SCALE: dict[str, tuple[tuple[float, float], float, float]] = {
    "ex_007": ((-1.1, 0.1), 0.025, 0.03),
}


def _primary_scale(params: ExerciseParams) -> tuple[tuple[float, float], float, float]:
    return _PRIMARY_SCALE.get(params.id, _DEGREE_PRIMARY_SCALE)


def _coupling(params: ExerciseParams) -> dict[str, tuple[float, float]]:
    """metric -> (intercept, slope) for primary-coupled channels, so the
    generator can add the same primary-driven expectation the rule baseline
    subtracts (keeps the synthetic clean class consistent with coupled scoring)."""
    return {
        c.name: (c.intercept, c.slope_per_primary_unit)
        for c in params.compensations
        if c.scoring_mode == "primary-coupled" and c.intercept is not None
    }


def generate_session(
    params: ExerciseParams,
    *,
    subject: SubjectLatents,
    subject_id: int,
    session_id: int,
    label: int,
    rng: np.random.Generator,
) -> SessionData:
    """Dispatch to the framing implied by the exercise's structural family."""
    framing = params.framing
    if framing == "dynamic_per_limb":
        builder = _dynamic_per_limb
    elif framing == "bidirectional":
        builder = _bidirectional
    elif framing == "isometric":
        builder = _isometric
    else:
        raise NotImplementedError(
            f"Framing {framing!r} (exercise {params.id}) is not implemented. "
            f"Implemented: dynamic_per_limb, bidirectional, isometric."
        )
    return builder(
        params, subject=subject, subject_id=subject_id,
        session_id=session_id, label=label, rng=rng,
    )


def _dynamic_per_limb(
    params: ExerciseParams,
    *,
    subject: SubjectLatents,
    subject_id: int,
    session_id: int,
    label: int,
    rng: np.random.Generator,
) -> SessionData:
    """Two limbs in parallel: each set runs every rep for the right side, then the left."""
    target_rom = float(params.target_rom)
    min_peak = float(params.minimum_peak_threshold)
    comp_metrics = _comp_metrics(params)
    coupled = _coupling(params)
    rest_range, meas_noise, jerk_tremor_gain = _primary_scale(params)
    severity = sample_session_severity(label, comp_metrics, rng)

    n_sets = int(rng.choice([1, 2, 2, 3]))
    set_targets: dict[int, int] = {}
    reps: list[RepResult] = []
    counted = 0

    for set_index in range(1, n_sets + 1):
        target_reps = int(rng.choice([8, 10, 10, 12]))
        set_targets[set_index] = target_reps
        for side, side_sign in (("right", 1.0), ("left", -1.0)):
            for k in range(target_reps):
                rep_pos = k / (target_reps - 1) if target_reps > 1 else 0.0
                rep = synthesize_rep(
                    exercise_id=params.id, subject_id=subject_id,
                    session_id=session_id, session_label=label,
                    set_index=set_index, rep_index=0,  # assigned only if it counts
                    side=side, subject=subject, severity=severity,
                    comp_metrics=comp_metrics, target_rom=target_rom,
                    rep_pos_in_set=rep_pos, side_sign=side_sign, rng=rng,
                    meas_noise=meas_noise, rest_range=rest_range,
                    jerk_tremor_gain=jerk_tremor_gain, coupled=coupled,
                )
                # A peak below the discard floor is a false start the rep counter
                # would drop, so it never reaches rep_events.
                if float(rep.primary.max()) >= min_peak:
                    counted += 1
                    rep.rep_index = counted
                    reps.append(rep)

    return SessionData(
        exercise_id=params.id, subject_id=subject_id, session_id=session_id,
        label=label, reps=reps, set_targets=set_targets,
    )


def _bidirectional(
    params: ExerciseParams,
    *,
    subject: SubjectLatents,
    subject_id: int,
    session_id: int,
    label: int,
    rng: np.random.Generator,
) -> SessionData:
    """
    One signed alternating motion: the patient alternates sides each rep, so a set
    interleaves right/left reps (one state machine on the absolute value, with the
    sign at peak tagging the side). The primary trajectory is stored as the
    absolute value (0 -> peak -> 0) so the rep feature extraction runs unchanged;
    `side` carries the direction.
    """
    target_rom = float(params.target_rom)
    min_peak = float(params.minimum_peak_threshold)
    comp_metrics = _comp_metrics(params)
    coupled = _coupling(params)
    rest_range, meas_noise, jerk_tremor_gain = _primary_scale(params)
    severity = sample_session_severity(label, comp_metrics, rng)

    n_sets = int(rng.choice([1, 2, 2, 3]))
    set_targets: dict[int, int] = {}
    reps: list[RepResult] = []
    counted = 0

    for set_index in range(1, n_sets + 1):
        target_reps = int(rng.choice([8, 10, 10, 12]))
        set_targets[set_index] = target_reps
        for k in range(target_reps):
            # Strict alternation R, L, R, L ...; side_sign feeds subject asymmetry
            # and the weak-side ROM-loss term exactly as in the per-limb framing.
            side, side_sign = ("right", 1.0) if k % 2 == 0 else ("left", -1.0)
            rep_pos = k / (target_reps - 1) if target_reps > 1 else 0.0
            rep = synthesize_rep(
                exercise_id=params.id, subject_id=subject_id,
                session_id=session_id, session_label=label,
                set_index=set_index, rep_index=0,
                side=side, subject=subject, severity=severity,
                comp_metrics=comp_metrics, target_rom=target_rom,
                rep_pos_in_set=rep_pos, side_sign=side_sign, rng=rng,
                meas_noise=meas_noise, rest_range=rest_range,
                jerk_tremor_gain=jerk_tremor_gain, coupled=coupled,
            )
            if float(rep.primary.max()) >= min_peak:
                counted += 1
                rep.rep_index = counted
                reps.append(rep)

    return SessionData(
        exercise_id=params.id, subject_id=subject_id, session_id=session_id,
        label=label, reps=reps, set_targets=set_targets,
    )


def _isometric(
    params: ExerciseParams,
    *,
    subject: SubjectLatents,
    subject_id: int,
    session_id: int,
    label: int,
    rng: np.random.Generator,
) -> SessionData:
    """
    Timed holds, one RepResult per (set, side), rep_index always 1.
    set_targets carries the prescribed hold seconds per side.

    Two sub-shapes mirror the live time-in-band accumulation:
    - per-limb (e.g. a both-arms hold): both sides hold simultaneously, so the
      two sides of a set share one timeline (equal frame counts, frame indices
      aligned) and the body-relative compensation channels are drawn once and
      duplicated across sides, like the real-capture mapping.
    - bidirectional-alternating (e.g. a per-side neck hold): the patient holds
      one side then the other, so each side's hold is its own segment with its
      own frames and compensation channels.
    """
    iso = params.isometric or {}
    band = iso.get("targetBand") or {}
    center = float(band["center"])
    tol = float(band["tolerance"])
    comp_metrics = _comp_metrics(params)
    coupled = _coupling(params)
    severity = sample_hold_severity(label, comp_metrics, rng)

    per_limb = params.bilateral_mode != "bidirectional-alternating"
    # Per-limb holds start from a hanging-arm rest (small apparent angle from
    # landmark noise); a neck hold starts from neutral (~0).
    rest_range = (3.0, 8.0) if per_limb else (0.0, 3.0)

    n_sets = int(rng.choice([1, 2, 2, 3]))
    set_targets: dict[int, int] = {}
    reps: list[RepResult] = []

    for set_index in range(1, n_sets + 1):
        target_s = int(rng.choice([20, 25, 30, 30, 40]))
        set_targets[set_index] = target_s
        set_pos = (set_index - 1) / (n_sets - 1) if n_sets > 1 else 0.0

        def _hold(side: str, side_sign: float, plateau_s: float,
                  n_frames: int | None) -> RepResult:
            return synthesize_hold(
                exercise_id=params.id, subject_id=subject_id,
                session_id=session_id, session_label=label,
                set_index=set_index, side=side, subject=subject,
                severity=severity, comp_metrics=comp_metrics,
                band_center=center, band_tolerance=tol,
                plateau_s=plateau_s, set_pos=set_pos, side_sign=side_sign,
                rest_range=rest_range, rng=rng, n_frames=n_frames,
                coupled=coupled,
            )

        if per_limb:
            # Shared timeline: one plateau draw for the set, left forced to the
            # right side's frame count so frame indices align across sides.
            plateau_s = target_s * float(rng.uniform(1.0, 1.3))
            right = _hold("right", 1.0, plateau_s, None)
            left = _hold("left", -1.0, plateau_s, right.primary.size)
            for m in comp_metrics:
                if m in _BODY_RELATIVE_COMPS:
                    left.channels[m] = right.channels[m].copy()
            reps.extend([right, left])
        else:
            # Sequential per-side holds, each its own segment and duration.
            for side, side_sign in (("right", 1.0), ("left", -1.0)):
                plateau_s = target_s * float(rng.uniform(1.0, 1.3))
                reps.append(_hold(side, side_sign, plateau_s, None))

    return SessionData(
        exercise_id=params.id, subject_id=subject_id, session_id=session_id,
        label=label, reps=reps, set_targets=set_targets,
    )
