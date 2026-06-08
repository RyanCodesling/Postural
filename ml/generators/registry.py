"""
Load exercise parameters from the registry JSON exported by the app.

The JSON is the single source of truth for thresholds, target ROM, and the
compensation metrics each exercise tracks; generators read it so synthetic data
stays consistent with what the live system measures. Regenerate it from the web
project with `npx tsx scripts/export-registry.ts`.
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


def load_registry(path: Path | None = None) -> dict[str, ExerciseParams]:
    raw = json.loads((path or _CONFIG_PATH).read_text(encoding="utf-8"))
    out: dict[str, ExerciseParams] = {}
    for ex_id, d in raw.items():
        thresholds = (d.get("primaryMetric") or {}).get("thresholds") or {}
        comps = tuple(
            CompensationSpec(
                name=c["name"],
                warning_threshold=float(c["warningThreshold"]),
                requires_baseline_capture=bool(c.get("requiresBaselineCapture", False)),
            )
            for c in d.get("compensationMetrics", [])
        )
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
