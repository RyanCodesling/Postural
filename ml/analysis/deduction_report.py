"""
Clean-rep deduction report: what does the rule-based compensation score deduct
while the movement is (deliberately) performed correctly?

Reads real recorded sessions (exported tuning traces mapped through
`analysis.real_frames`), scores frames EXACTLY as the app/baseline now does
(`baselines.frame_deduction` — primary-coupled residuals and per-exercise band
overrides applied, knots loaded from the exported registry), and reports per
compensation metric:

  1. Verdict table — per-rep EFFECTIVE deduction contributions on within-rep
     frames (mean / p95 / max, %% of frames deducting) plus rest-frame
     statistics (between-rep |value| mean and SD = the measured noise floor),
     and a `static_ded_mean` column = the raw-|value| deduction the same frames
     would get WITHOUT coupling/override. A STATIC metric that deducts heavily
     on clean reps fires intrinsically and is a candidate for primary-coupled
     scoring; an already-coupled metric should now read a low `ded_mean` while
     its `static_ded_mean` stays high (a verification that the coupling works).

  2. Coupling-fit inputs — channel value vs |primary| on within-rep frames:
     ~10 equal-width |primary| bins (median + count per bin), a provisional
     least-squares line (intercept + slope per primary unit), and the
     residual 5th-95th spread. These are the starting numbers for a
     `primary-coupled` registry entry; treat them as pilot-fit values that
     need review, not finished constants.

Usage (from ml/, after the web exporter has run):
    python -m analysis.deduction_report --exercise ex_001

Writes markdown + CSV to analysis/out/ and prints the verdict table.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from baselines import banded_deduction, frame_deduction, scored_metrics  # noqa: E402
from generators.registry import get_exercise  # noqa: E402
from analysis.real_frames import real_frames  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "out"

REP_KEYS = ["session_id", "set_index", "side", "rep_index"]


def _md_table(df: pd.DataFrame, ndigits: int = 3) -> str:
    """Minimal markdown table (pandas.to_markdown needs the tabulate extra)."""
    def fmt(v) -> str:
        if isinstance(v, float):
            return "nan" if pd.isna(v) else f"{v:.{ndigits}f}"
        return str(v)
    cols = list(df.columns)
    lines = [
        "| " + " | ".join(cols) + " |",
        "|" + "|".join("---" for _ in cols) + "|",
    ]
    for _, row in df.iterrows():
        lines.append("| " + " | ".join(fmt(row[c]) for c in cols) + " |")
    return "\n".join(lines)


def metric_verdicts(frames: pd.DataFrame, exercise_id: str) -> pd.DataFrame:
    """One row per compensation channel: deduction behavior on clean reps."""
    params = get_exercise(exercise_id)
    scored = set(scored_metrics(params))
    in_rep = frames[frames["rep_index"].notna()]
    rest = frames[frames["rep_index"].isna()]

    rows = []
    for comp in params.compensations:
        name = comp.name
        if name not in frames.columns:
            continue
        rep_vals = in_rep[name].to_numpy(dtype=float)
        rep_vals = rep_vals[np.isfinite(rep_vals)]
        rest_vals = rest[name].to_numpy(dtype=float)
        rest_vals = rest_vals[np.isfinite(rest_vals)]

        row: dict = {
            "metric": name,
            "scoring": (
                comp.scoring_mode + ("+override" if comp.bands_override is not None else "")
                if name in scored else f"({comp.scoring_mode})"
            ),
            "rep_frames": int(rep_vals.size),
            "rest_abs_mean": float(np.mean(np.abs(rest_vals))) if rest_vals.size else np.nan,
            "rest_sd": float(np.std(rest_vals)) if rest_vals.size else np.nan,
        }
        if name in scored and rep_vals.size:
            # EFFECTIVE deduction = exactly what the app/baseline scores now:
            # primary-coupled residual + per-exercise band override (frame_deduction).
            sub = in_rep[in_rep[name].notna()]
            ded = frame_deduction(sub, comp)
            ded = ded[np.isfinite(ded)]
            # Per-rep mean of the effective deduction, then summarized across
            # reps — so long reps don't dominate, mirroring the rule baseline.
            per_rep = (
                in_rep.assign(_ded=frame_deduction(in_rep, comp))
                .groupby(REP_KEYS, dropna=True)["_ded"].mean()
            )
            # Static reference: what raw-|value| scoring would deduct. For a
            # coupled/override metric this is the pre-retune "candidate" signal;
            # the gap from ded_mean shows the coupling/override at work. For a
            # plain-static metric it equals ded_mean.
            static_ded = banded_deduction(rep_vals, name)
            row.update({
                "pct_frames_deducting": float(np.mean(ded > 0) * 100.0),
                "ded_mean": float(np.mean(ded)),
                "ded_p95": float(np.percentile(ded, 95)),
                "ded_max": float(np.max(ded)),
                "per_rep_ded_mean": float(per_rep.mean()),
                "per_rep_ded_max": float(per_rep.max()),
                "static_ded_mean": float(np.mean(static_ded)),
            })
        rows.append(row)
    return pd.DataFrame(rows)


def coupling_fit(
    frames: pd.DataFrame, metric: str, n_bins: int = 10
) -> tuple[pd.DataFrame, dict]:
    """
    Channel value vs |primary| on within-rep frames: binned medians + a
    provisional least-squares line. The fit target is the channel value as
    the score consumes it, so `value - (intercept + slope*|primary|)` is the
    residual a primary-coupled registry entry would deduct on.
    """
    in_rep = frames[frames["rep_index"].notna()]
    x = np.abs(in_rep["primary"].to_numpy(dtype=float))
    y = in_rep[metric].to_numpy(dtype=float)
    ok = np.isfinite(x) & np.isfinite(y)
    x, y = x[ok], y[ok]
    if x.size < 20 or float(np.ptp(x)) == 0.0:
        return pd.DataFrame(), {}

    edges = np.linspace(x.min(), x.max(), n_bins + 1)
    which = np.clip(np.digitize(x, edges) - 1, 0, n_bins - 1)
    bins = pd.DataFrame({
        "bin_lo": edges[:-1],
        "bin_hi": edges[1:],
        "primary_mid": (edges[:-1] + edges[1:]) / 2,
        "value_median": [
            float(np.median(y[which == b])) if np.any(which == b) else np.nan
            for b in range(n_bins)
        ],
        "n": [int(np.sum(which == b)) for b in range(n_bins)],
    })

    slope, intercept = np.polyfit(x, y, 1)
    residuals = y - (intercept + slope * x)
    fit = {
        "intercept": float(intercept),
        "slope_per_primary_unit": float(slope),
        "residual_p5": float(np.percentile(residuals, 5)),
        "residual_p95": float(np.percentile(residuals, 95)),
        "n_frames": int(x.size),
    }
    return bins, fit


def build_report(exercise_id: str, data_dir: Path | None = None) -> str:
    params = get_exercise(exercise_id)
    frames = real_frames(exercise_id, params, data_dir)
    if frames.empty:
        raise SystemExit(f"No frames mapped for {exercise_id} — nothing to report.")

    n_sessions = frames["session_id"].nunique()
    n_reps = int(
        frames.loc[frames["rep_index"].notna()]
        .groupby(REP_KEYS, dropna=True).ngroups
    )
    verdicts = metric_verdicts(frames, exercise_id)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    lines = [
        f"# Deduction report — {exercise_id} ({params.name})",
        "",
        f"Real recorded sessions: {n_sessions}; rep groups: {n_reps}; "
        f"frames: {len(frames)} (rest frames: {int(frames['rep_index'].isna().sum())}).",
        "",
        "Reps recorded as DELIBERATELY CLEAN form. `ded_mean` is the EFFECTIVE",
        "deduction the app applies now (coupling + per-exercise overrides);",
        "`static_ded_mean` is the raw-|value| deduction. A STATIC metric with",
        "high deduction fires intrinsically (movement-consequence) and is a",
        "primary-coupled candidate; an already-coupled metric should read a low",
        "`ded_mean` with a still-high `static_ded_mean` (coupling verified).",
        "",
        "## Per-metric verdicts",
        "",
        _md_table(verdicts, ndigits=3),
        "",
    ]

    scored = scored_metrics(params)
    bin_frames = []
    for metric in scored:
        bins, fit = coupling_fit(frames, metric)
        if not fit:
            lines += [f"## {metric} vs |primary|", "", "Not enough data to fit.", ""]
            continue
        lines += [
            f"## {metric} vs |primary| (coupling-fit inputs)",
            "",
            f"Provisional least-squares: intercept = {fit['intercept']:.4f}, "
            f"slope = {fit['slope_per_primary_unit']:.5f} per primary unit "
            f"(n = {fit['n_frames']}).",
            f"Residual spread (5th-95th): [{fit['residual_p5']:.3f}, {fit['residual_p95']:.3f}] "
            "— compare against ~3x the rest-frame SD before trusting a band.",
            "",
            _md_table(bins, ndigits=4),
            "",
        ]
        bins.insert(0, "metric", metric)
        bin_frames.append(bins)

    report = "\n".join(lines)
    (OUT_DIR / f"{exercise_id}_deduction_report.md").write_text(report, encoding="utf-8")
    if bin_frames:
        pd.concat(bin_frames, ignore_index=True).to_csv(
            OUT_DIR / f"{exercise_id}_coupling_bins.csv", index=False
        )
    return report


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--exercise", required=True)
    ap.add_argument("--data-dir", type=Path, default=None,
                    help="Override data/real/ root (mainly for tests).")
    args = ap.parse_args()
    report = build_report(args.exercise, args.data_dir)
    print(report)
    print(f"\nWritten to {OUT_DIR}")


if __name__ == "__main__":
    main()
