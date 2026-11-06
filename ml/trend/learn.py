"""Learn the trend model's variation parameters from exported sessions
(evaluation protocol v1, sections 2 and 4)."""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .model import SMOOTH_FRACTION, VAGUE, log_marginal_likelihood

MIN_SERIES_SESSIONS = 3
TAU_SEARCH_POINTS = 400


@dataclass
class Series:
    key: tuple
    side: str
    session_ids: list[int]
    means: np.ndarray
    unit_counts: np.ndarray


@dataclass
class Learned:
    exercise: str
    measure: str
    level: float
    sigma_u: float
    pooled_series_sd: float
    tau_mle: float
    tau_hat: float
    floor: float
    series: list[Series] = field(default_factory=list)
    unit_sessions: int = 0


def load_sessions(path: Path) -> list[dict]:
    return json.loads(Path(path).read_text(encoding="utf-8"))["sessions"]


@dataclass(frozen=True)
class DataRules:
    """Which exported values count as session measurements.

    v1 (as first registered): every side with at least one valid unit.
    v1.1 (deviation 1): only the prescribed side(s) count, and repetition
    measures need at least 3 valid repetitions on a side for that session.
    """
    respect_prescribed_side: bool = False
    min_units: int = 1


RULES_V1 = DataRules()
RULES_V1_1_REPS = DataRules(respect_prescribed_side=True, min_units=3)
RULES_V1_1_HOLDS = DataRules(respect_prescribed_side=True, min_units=1)

# Amendment v2: sessions recorded with deliberately performed faults (lean, slouch,
# head tilt, shoulder lift, bent endpoint) are excluded from learning.
FAULT_TEST_SESSIONS = frozenset({193, 194, 197, 199, 208, 212, 213, 214})

# Amendment v4: session 226 was replaced by the same-day redo 227, which has
# trace and video (decided 2026-10-17, by cause, before any v4 result).
REPLACED_SESSIONS = frozenset({226})


# Amendment v3: measures derived from exported units. peakSpread is session level
# (one value per session and side, the SD of that side's repetition peaks).
SESSION_LEVEL_MEASURES = frozenset({"peakSpread"})


def _derived_units(session: dict, measure: str) -> dict | None:
    units = session["units"]
    if measure == "completionPct":
        source = units.get("complete")
        return {side: [100.0 * v for v in values] for side, values in source.items()} if source else None
    if measure == "peakSpread":
        return units.get("peak")
    if measure.startswith("exposure:"):
        source = units.get(measure)
        return {side: [100.0 * v for v in values] for side, values in source.items()} if source else None
    return units.get(measure)


def _unit_lists(session: dict, measure: str, rules: DataRules = RULES_V1) -> dict[str, list[float]]:
    units = _derived_units(session, measure)
    if not units:
        return {}
    if measure in SESSION_LEVEL_MEASURES:
        spread = {}
        for side, values in units.items():
            if len(values) < max(rules.min_units, 3):
                continue
            prescribed = session.get("prescribedSide", "both")
            if rules.respect_prescribed_side and prescribed in ("left", "right") and side != prescribed:
                continue
            spread[side] = [float(np.std(values, ddof=1))]
        return spread
    if "card" in units:
        values = list(units["card"])
        return {"card": values} if len(values) >= rules.min_units else {}
    prescribed = session.get("prescribedSide", "both")
    out = {}
    for side, values in units.items():
        if not values or len(values) < rules.min_units:
            continue
        if rules.respect_prescribed_side and prescribed in ("left", "right") and side != prescribed:
            continue
        out[side] = list(values)
    return out


def collect_series(sessions: list[dict], exercise: str, measure: str,
                   exclude: set[int] | frozenset[int] = frozenset(),
                   rules: DataRules = RULES_V1) -> list[Series]:
    grouped: dict[tuple, list[tuple[str, int, list[float]]]] = {}
    for session in sessions:
        if session["exerciseId"] != exercise or session["sessionId"] in exclude:
            continue
        context = (session["patientId"], exercise, session["configVersion"],
                   session["prescribedSide"], json.dumps(session["resistance"], sort_keys=True))
        for side, values in _unit_lists(session, measure, rules).items():
            grouped.setdefault(context + (side,), []).append(
                (session["startedAt"], session["sessionId"], values))
    series: list[Series] = []
    for key, rows in grouped.items():
        rows.sort()
        if len(rows) < MIN_SERIES_SESSIONS:
            continue
        series.append(Series(
            key=key,
            side=key[-1],
            session_ids=[row[1] for row in rows],
            means=np.array([float(np.mean(row[2])) for row in rows]),
            unit_counts=np.array([len(row[2]) for row in rows], dtype=float),
        ))
    return series


def pooled_unit_sd(sessions: list[dict], exercise: str, measure: str,
                   exclude: set[int] | frozenset[int] = frozenset(),
                   rules: DataRules = RULES_V1) -> tuple[float, int]:
    ss = 0.0
    dof = 0
    cells = 0
    for session in sessions:
        if session["exerciseId"] != exercise or session["sessionId"] in exclude:
            continue
        for values in _unit_lists(session, measure, rules).values():
            if len(values) >= 2:
                ss += float(np.var(values, ddof=1)) * (len(values) - 1)
                dof += len(values) - 1
                cells += 1
    if dof == 0:
        raise ValueError(f"no within-session variation for {exercise}/{measure}")
    return float(np.sqrt(ss / dof)), cells


def sessions_with_units(sessions: list[dict], exercise: str, measure: str, minimum: int,
                        exclude: set[int] | frozenset[int] = frozenset(),
                        rules: DataRules = RULES_V1) -> int:
    """Number of sessions with at least `minimum` units on some counted side."""
    return sum(
        1 for session in sessions
        if session["exerciseId"] == exercise and session["sessionId"] not in exclude
        and any(len(values) >= minimum for values in _unit_lists(session, measure, rules).values())
    )


def pooled_series_sd(series: list[Series]) -> float:
    ss = sum(float(np.sum((s.means - s.means.mean()) ** 2)) for s in series)
    dof = sum(s.means.size - 1 for s in series)
    return float(np.sqrt(ss / dof))


def learn(sessions: list[dict], exercise: str, measure: str, typical_units: float,
          exclude: set[int] | frozenset[int] = frozenset(), rules: DataRules = RULES_V1,
          sigma_u: float | None = None) -> Learned:
    """Maximum-marginal-likelihood tau for one exercise and measure. sigma_u is the
    pooled within-session unit SD unless a (donor) value is supplied."""
    series = collect_series(sessions, exercise, measure, exclude, rules)
    if not series:
        raise ValueError(f"no series with >= {MIN_SERIES_SESSIONS} sessions for {exercise}/{measure}")
    if measure in SESSION_LEVEL_MEASURES:
        sigma_u, cells = 0.0, 0  # one value per session: all variation is session to session
    elif sigma_u is None:
        sigma_u, cells = pooled_unit_sd(sessions, exercise, measure, exclude, rules)
    else:
        cells = 0
    spread = pooled_series_sd(series)
    vague = VAGUE * spread
    scale = sigma_u if sigma_u > 0 else spread
    candidates = scale * np.logspace(-3.0, 1.0, TAU_SEARCH_POINTS)
    totals = np.array([
        sum(log_marginal_likelihood(s.means, sigma_u**2 / s.unit_counts, tau, vague,
                                    SMOOTH_FRACTION * tau) for s in series)
        for tau in candidates
    ])
    tau_mle = float(candidates[int(np.argmax(totals))])
    floor = 0.5 * sigma_u / np.sqrt(typical_units)
    level = float(np.mean(np.concatenate([s.means for s in series])))
    return Learned(exercise=exercise, measure=measure, level=level, sigma_u=sigma_u,
                   pooled_series_sd=spread, tau_mle=tau_mle, tau_hat=max(tau_mle, floor),
                   floor=float(floor), series=series, unit_sessions=cells)
