"""
Load exercise parameters from the registry JSON exported by the app.

The JSON is the single source of truth for thresholds, target ROM, the
compensation metrics each exercise tracks (including their scoring modes), and
the compensation-score deduction bands; generators and the rule baseline read
it so synthetic data and the baseline stay consistent with what the live
system measures. Regenerate it from the web project with
`npx tsx scripts/export-registry.ts`.

JSON shape: { "exercises": {...}, "compensationBands": {...} }.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

# ml/generators/registry.py -> ml/ -> ml/config/registry.json
_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "registry.json"


@dataclass(frozen=True)
class CompensationSpec:
    name: str
    warning_threshold: float
    requires_baseline_capture: bool = False
    # How the metric contributes to the rule-based compensation score:
    # "static" (banded deduction on |value|, the default), "off" (warning-only,
    # excluded from the score and its weighting), or "primary-coupled"
    # (deduction on the residual from an expected value driven by the primary
    # metric). Mirrors the app's CompensationScoring modes.
    scoring_mode: str = "static"
    # primary-coupled constants (None for static/off): the expected metric
    # value at primary p is `intercept + slope_per_primary_unit * |p|`. The
    # rule baseline deducts on |value - expected|; the synthetic generator adds
    # the same expectation to the clean channel so the two stay consistent.
    intercept: float | None = None
    slope_per_primary_unit: float | None = None
    # Per-exercise deduction-band override (interp knots, same shape as the
    # global bands), or None to use the metric's global COMPENSATION_BANDS.
    # Mirrors the app's CompensationMetricSpec.bandsOverride.
    bands_override: tuple[list[float], list[float]] | None = None


@dataclass(frozen=True)
class ExerciseParams:
    """Flat, generator-friendly view of one registry entry."""

    id: str
    name: str
    kind: str  # "dynamic" | "isometric"
    bilateral: bool
    bilateral_mode: str | None
    primary_metric: str | None
    # Dynamic thresholds (degrees, or trunk-length-normalized units for ex_007).
    start_threshold: float | None
    rep_complete_threshold: float | None
    minimum_peak_threshold: float | None
    target_rom: float | None
    # Isometric target band (present only for kind == "isometric").
    isometric: dict | None
    compensations: tuple[CompensationSpec, ...]

    @property
    def framing(self) -> str:
        """Structural family that selects the generator framing."""
        if self.kind == "isometric":
            return "isometric"
        if self.bilateral_mode == "bidirectional-alternating":
            return "bidirectional"
        return "dynamic_per_limb"

    @property
    def scored_compensations(self) -> tuple[CompensationSpec, ...]:
        """Compensation metrics the synthetic pipeline models and the rule
        scores: everything except warning-only (`scoring_mode == "off"`).
        Warning-only metrics (e.g. elbowFlexion on the overhead exercises) are
        live UI cues only — the rule excludes them and the generator has no
        channel model for them — so the synthetic data and the ML feature set
        exclude them too, keeping generator, baseline, and features consistent."""
        return tuple(c for c in self.compensations if c.scoring_mode != "off")


def _bands_to_knots(bands: list[dict], label: str) -> tuple[list[float], list[float]]:
    """
    Convert one app band list to np.interp knots, asserting the continuity that
    makes the knot form identical to the app's per-band interpolation. Shared by
    the global `compensationBands` loader and the per-exercise `bandsOverride`
    parsing so both enforce the same shape.
    """
    if not bands:
        raise ValueError(f"{label} is empty")
    xs: list[float] = [0.0]
    ys: list[float] = [float(bands[0]["deductionMin"])]
    if ys[0] != 0.0:
        raise ValueError(f"{label} must start at zero deduction")
    prev_deduction = ys[0]
    for b in bands:
        x = float(b["max"])
        y_min = float(b["deductionMin"])
        y_max = float(b["deductionMax"])
        if x <= xs[-1]:
            raise ValueError(
                f"{label}: band maxes must be strictly increasing "
                f"(got {x} after {xs[-1]})"
            )
        if y_min != prev_deduction:
            raise ValueError(
                f"{label}: discontinuous at max={x} "
                f"(deductionMin {y_min} != previous deductionMax {prev_deduction})"
            )
        xs.append(x)
        ys.append(y_max)
        prev_deduction = y_max
    return xs, ys


def _parse_comp(c: dict, ex_id: str) -> CompensationSpec:
    scoring = c.get("scoring") or {}
    bands_override = c.get("bandsOverride")
    return CompensationSpec(
        name=c["name"],
        warning_threshold=float(c["warningThreshold"]),
        requires_baseline_capture=bool(c.get("requiresBaselineCapture", False)),
        scoring_mode=scoring.get("mode", "static"),
        intercept=float(scoring["intercept"]) if "intercept" in scoring else None,
        slope_per_primary_unit=(
            float(scoring["slopePerPrimaryUnit"])
            if "slopePerPrimaryUnit" in scoring
            else None
        ),
        bands_override=(
            _bands_to_knots(bands_override, f"{ex_id} {c['name']} bandsOverride")
            if bands_override
            else None
        ),
    )


def load_registry(path: Path | None = None) -> dict[str, ExerciseParams]:
    raw = json.loads((path or _CONFIG_PATH).read_text(encoding="utf-8"))
    out: dict[str, ExerciseParams] = {}
    for ex_id, d in raw["exercises"].items():
        thresholds = (d.get("primaryMetric") or {}).get("thresholds") or {}
        comps = tuple(_parse_comp(c, ex_id) for c in d.get("compensationMetrics", []))
        out[ex_id] = ExerciseParams(
            id=d["id"],
            name=d["name"],
            kind=d["kind"],
            bilateral=bool(d.get("bilateral", False)),
            bilateral_mode=d.get("bilateralMode"),
            primary_metric=(d.get("primaryMetric") or {}).get("name"),
            start_threshold=thresholds.get("startThreshold"),
            rep_complete_threshold=thresholds.get("repCompleteThreshold"),
            minimum_peak_threshold=thresholds.get("minimumPeakThreshold"),
            target_rom=thresholds.get("targetROM"),
            isometric=d.get("isometric"),
            compensations=comps,
        )
    return out


def get_exercise(ex_id: str, path: Path | None = None) -> ExerciseParams:
    reg = load_registry(path)
    if ex_id not in reg:
        raise KeyError(f"{ex_id!r} not in registry ({', '.join(reg)})")
    return reg[ex_id]


def load_compensation_bands(path: Path | None = None) -> dict[str, tuple[list[float], list[float]]]:
    """
    Interp knots for the compensation-score deduction bands, converted from the
    exported band lists.

    App band semantics: values from the previous band's `max` (or 0) up to
    `max` interpolate linearly from `deductionMin` to `deductionMax`, clamped
    past the last band. Converted to knots, that is
    xs = [0, max_1, ..., max_n], ys = [deductionMin_1, deductionMax_1, ...,
    deductionMax_n] -- which `np.interp` evaluates identically ONLY when the
    curve is continuous (each band's deductionMin equals the previous band's
    deductionMax). The app's registry validation enforces that; it is
    re-asserted here so a hand-edited JSON cannot silently diverge from the
    app's per-band interpolation.
    """
    raw = json.loads((path or _CONFIG_PATH).read_text(encoding="utf-8"))
    return {
        metric: _bands_to_knots(bands, f"compensationBands[{metric!r}]")
        for metric, bands in raw["compensationBands"].items()
    }
