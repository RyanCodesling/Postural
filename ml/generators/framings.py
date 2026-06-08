"""
Structural framings that turn per-rep synthesis into a full session.

Three families mirror how the live camera loop wires angles into rep counters:

- dynamic_per_limb        : two limbs tracked independently (e.g. lateral raises)
- bidirectional           : one alternating signed motion (e.g. side bends, neck tilt)
- isometric               : a timed hold, no rep state machine

dynamic_per_limb and bidirectional are implemented; isometric remains a stub with
the same interface so adding it later is a fill-in, not a redesign.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from generators.base import RepResult, SubjectLatents, sample_session_severity, synthesize_rep
from generators.registry import ExerciseParams


@dataclass
class SessionData:
    exercise_id: str
    subject_id: int
    session_id: int
    label: int
    reps: list[RepResult]
    set_targets: dict[int, int]  # set_index -> prescribed reps


def _comp_metrics(params: ExerciseParams) -> tuple[str, ...]:
    return tuple(c.name for c in params.compensations)


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
    else:
        raise NotImplementedError(
            f"Framing {framing!r} (exercise {params.id}) is not implemented yet. "
            f"Implemented: dynamic_per_limb, bidirectional. Isometric is next."
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
            )
            if float(rep.primary.max()) >= min_peak:
                counted += 1
                rep.rep_index = counted
                reps.append(rep)

    return SessionData(
        exercise_id=params.id, subject_id=subject_id, session_id=session_id,
        label=label, reps=reps, set_targets=set_targets,
    )
