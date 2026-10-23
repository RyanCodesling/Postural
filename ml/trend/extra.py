"""Amendment v3: extra measures shown with the model's band (never labelled).

    .venv/Scripts/python.exe -m trend.extra --base-config <v2.1 run>/trendModelConfig.json

Learns each extra measure's variation from the exported sessions (v2.1 data rules,
fault-test sessions excluded), checks that its 95 % range is honest in simulation
(G1 at p* = 0.975 with variant V2), borrows values where a measure cannot be
learned, and writes the merged app configuration and parity fixtures to a new
folder under trend/out/.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np

from .evaluate import SETTINGS, rules_for
from .learn import (FAULT_TEST_SESSIONS, SESSION_LEVEL_MEASURES, learn, load_sessions, pooled_unit_sd,
                    sessions_with_units)
from .model import VARIANTS, batch_posterior, labels, series_posterior
from .simulate import CONDITIONS, SESSION_COUNTS, Config, simulate

HERE = Path(__file__).resolve().parent
ML_ROOT = HERE.parent
PROTOCOL = HERE / "EVALUATION_PROTOCOL.md"
SEED_EXTRA = 700_000
SERIES = 2000
CHECK_CONDITIONS = ("base", "tau_0.5", "tau_1.5", "tau_2")

REP_MEASURES = ("loweringS", "raisingS", "completionPct", "peakSpread")
HOLD_MEASURES = ("holdSteadiness", "holdError", "holdDroop")
EXPOSURE_METRICS = {
    "ex_001": ("trunkLean", "scapularElevation", "shoulderSymmetry"),
    "ex_004": ("trunkLean", "shoulderSymmetry"),
    "ex_005": ("neckTilt", "scapularElevation"),
    "ex_007": ("trunkLean",),
    "ex_008": ("trunkLean",),
}
REP_EXERCISES = ("ex_001", "ex_004", "ex_005", "ex_007", "ex_008")
HOLD_EXERCISES = ("ex_006", "ex_004")


def measure_type(measure: str) -> str:
    if measure in ("loweringS", "raisingS"):
        return "timing"
    if measure == "completionPct":
        return "completion"
    if measure == "peakSpread":
        return "spread"
    if measure.startswith("exposure:"):
        return "exposure"
    return "holdQuality"


def extra_measure_list() -> list[tuple[str, str, float, bool]]:
    """(exercise, measure, typical units per session, is_hold)."""
    items = []
    for exercise in REP_EXERCISES:
        for measure in REP_MEASURES:
            items.append((exercise, measure, 10.0, False))
        for metric in EXPOSURE_METRICS[exercise]:
            items.append((exercise, f"exposure:{metric}", 10.0, False))
    for exercise in HOLD_EXERCISES:
        for measure in HOLD_MEASURES:
            items.append((exercise, measure, 2.0, True))
    return items


def rules_for_extra(measure: str, is_hold: bool):
    return rules_for("v2.1", "inBandPct" if is_hold else "peak")


def check_band(level: float, sigma_u: float, tau_hat: float, units: float, first_seed: int) -> dict:
    variant = VARIANTS["V2"]
    config = Config(cid="x", exercise="x", measure="x", is_angle=False, delta_min=0.0, level=level,
                    sigma_u=sigma_u, tau_hat=tau_hat, units_base=units, units_stress=(units, units))
    worst = {}
    k = first_seed
    for condition in (c for c in CONDITIONS if c.name in CHECK_CONDITIONS):
        rates = []
        for n in SESSION_COUNTS:
            rng = np.random.default_rng(k)
            k += 1
            values, w = simulate(config, condition, "flat", 0.0, n, SERIES, rng)
            p_up, mean_delta = batch_posterior(values, w, tau_hat, variant)
            calls = labels(p_up, mean_delta, n, 0.975, 0.0, variant.min_sessions)
            rates.append(float(np.mean(calls != 0)))
        worst[condition.name] = max(rates)
    passed = worst["base"] <= 0.075 and all(worst[c] <= 0.125 for c in CHECK_CONDITIONS if c != "base")
    return {"worst_false_call": worst, "pass": passed}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions", default=str(ML_ROOT / "data" / "trend" / "tier1_sessions.json"))
    parser.add_argument("--base-config", required=True)
    parser.add_argument("--base-fixtures", required=True)
    # v2.1 reproduces amendment v3; v4 is amendment v4 (the corrected unit and
    # the neck sessions, session 226 excluded).
    parser.add_argument("--rules", choices=("v2.1", "v4"), default="v2.1")
    args = parser.parse_args()

    protocol_hash = hashlib.sha256(PROTOCOL.read_bytes()).hexdigest().upper()
    run_name = "protocol_v3" if args.rules == "v2.1" else "protocol_v4_extra"
    out_dir = HERE / "out" / time.strftime(f"{run_name}_%Y%m%d-%H%M%S")
    out_dir.mkdir(parents=True, exist_ok=False)
    sessions = load_sessions(Path(args.sessions))
    exclude = SETTINGS[args.rules].exclude
    assert FAULT_TEST_SESSIONS <= exclude

    learned: dict[str, dict] = {}
    pending: list[tuple[str, str, float, bool]] = []
    seed = SEED_EXTRA
    for exercise, measure, units, is_hold in extra_measure_list():
        rules = rules_for_extra(measure, is_hold)
        key = f"{exercise}:{measure}"
        try:
            fit = learn(sessions, exercise, measure, units, exclude=exclude, rules=rules)
        except ValueError:
            pending.append((exercise, measure, units, is_hold))
            continue
        check = check_band(fit.level, fit.sigma_u, fit.tau_hat, units, seed)
        seed += len(CHECK_CONDITIONS) * len(SESSION_COUNTS)
        learned[key] = {"exercise": exercise, "measure": measure, "type": measure_type(measure),
                        "level": fit.level, "sigmaU": fit.sigma_u, "tauHat": fit.tau_hat, "tauMle": fit.tau_mle,
                        "series": [(s.side, s.session_ids) for s in fit.series], "units": units,
                        "isHold": is_hold, "check": check}
        print(f"learned {key}: tau {fit.tau_hat:.4g}, sigma {fit.sigma_u:.4g}, check {check}")

    # Borrowing for measures without a learnable series.
    by_type: dict[str, list[dict]] = {}
    for item in learned.values():
        by_type.setdefault(item["type"], []).append(item)
    borrowed: dict[str, dict] = {}
    for exercise, measure, units, is_hold in pending:
        key = f"{exercise}:{measure}"
        kind = measure_type(measure)
        members = by_type.get(kind, [])
        if not members:
            borrowed[key] = {"exercise": exercise, "measure": measure, "type": kind, "band": False,
                             "reason": "no learned measure of this type"}
            continue
        rules = rules_for_extra(measure, is_hold)
        if measure in SESSION_LEVEL_MEASURES:
            sigma_u, sigma_source = 0.0, "session level"
            tau_hat = float(np.median([m["tauHat"] for m in members]))
        else:
            if sessions_with_units(sessions, exercise, measure, 2, exclude, rules) >= 2:
                sigma_u, _ = pooled_unit_sd(sessions, exercise, measure, exclude, rules)
                sigma_source = "own"
            else:
                donor = "ex_006" if is_hold else "ex_001"
                try:
                    # The same measure of the donor (for exposure: the same compensation metric).
                    sigma_u, _ = pooled_unit_sd(sessions, donor, measure, exclude, rules)
                    sigma_source = f"donor {donor}/{measure}"
                except ValueError:
                    if sessions_with_units(sessions, exercise, measure, 2, exclude, rules) >= 1:
                        sigma_u, _ = pooled_unit_sd(sessions, exercise, measure, exclude, rules)
                        sigma_source = "own, single session"
                    else:
                        borrowed[key] = {"exercise": exercise, "measure": measure, "type": kind, "band": False,
                                         "reason": "no unit SD available"}
                        continue
            ratio = float(np.median([m["tauHat"] / m["sigmaU"] for m in members if m["sigmaU"] > 0]))
            tau_hat = max(ratio * sigma_u, 0.5 * sigma_u / np.sqrt(units))
        type_ok = all(m["check"]["pass"] for m in members)
        reason = f"borrowed from {kind} ({len(members)} learned)"
        if tau_hat <= 0 or (sigma_u <= 0 and measure not in SESSION_LEVEL_MEASURES):
            # Deviation 3: no observed variation, so the model cannot run.
            type_ok = False
            reason += "; no observed variation (deviation 3)"
        borrowed[key] = {"exercise": exercise, "measure": measure, "type": kind, "tauHat": tau_hat,
                         "sigmaU": sigma_u, "sigmaSource": sigma_source, "units": units, "isHold": is_hold,
                         "band": type_ok, "reason": reason}

    base = json.loads(Path(args.base_config).read_text(encoding="utf-8"))
    base.pop("version", None)
    measures = dict(base["measures"])
    for key, item in {**learned, **borrowed}.items():
        if "tauHat" not in item:
            measures[key] = {"exercise": item["exercise"], "measure": item["measure"], "tauHat": 0.0, "sigmaU": 0.0,
                             "deltaMin": 0.0, "labelled": False, "band": False,
                             "minUnits": 1 if item.get("isHold") else 3, "sigmaSource": "none",
                             "tauSource": item["reason"], "sessionLevel": item["measure"] in SESSION_LEVEL_MEASURES}
            continue
        is_learned = key in learned
        measures[key] = {
            "exercise": item["exercise"], "measure": item["measure"],
            "tauHat": round(float(item["tauHat"]), 6), "sigmaU": round(float(item["sigmaU"]), 6),
            "deltaMin": 0.0, "labelled": False,
            "band": bool(item["check"]["pass"]) if is_learned else bool(item["band"]),
            "minUnits": 1 if item["isHold"] else 3,
            "sessionLevel": item["measure"] in SESSION_LEVEL_MEASURES,
            "sigmaSource": "own" if is_learned else item["sigmaSource"],
            "tauSource": (f"learned (MLE {item['tauMle']:.4g} from {len(item['series'])} series)"
                          if is_learned else item["reason"]),
        }
    for spec in measures.values():
        spec.setdefault("band", True)
        spec.setdefault("sessionLevel", False)
    amendments = "v2, v2.1 and v3" if args.rules == "v2.1" else "v2, v2.1, v3 and v4"
    config = {**base, "measures": measures, "protocolSha256": protocol_hash,
              "protocol": f"trend evaluation protocol v1, deviations 1-3, amendments {amendments}"}
    body = json.dumps(config, sort_keys=True, separators=(",", ":"))
    config["version"] = "trend-model-" + hashlib.sha256(body.encode()).hexdigest()[:12]
    (out_dir / "trendModelConfig.json").write_text(json.dumps(config, indent=1, sort_keys=True) + "\n", encoding="utf-8")

    # Fixtures: the v2.1 cases (main measures unchanged) plus real series of new measures.
    fixtures = json.loads(Path(args.base_fixtures).read_text(encoding="utf-8"))["cases"]
    variant = VARIANTS[config["variant"]]
    for key in ("ex_001:loweringS", "ex_001:completionPct", "ex_001:peakSpread", "ex_001:exposure:trunkLean",
                "ex_005:raisingS", "ex_006:holdSteadiness"):
        if key not in learned:
            continue
        spec = measures[key]
        exercise, measure = key.split(":", 1)
        fit = learn(sessions, exercise, measure, learned[key]["units"], exclude=exclude,
                    rules=rules_for_extra(measure, learned[key]["isHold"]))
        for i, s in enumerate(fit.series):
            units = np.ones_like(s.unit_counts) if spec["sessionLevel"] else s.unit_counts
            w = (spec["sigmaU"] ** 2) / units
            post = series_posterior(s.means, w, spec["tauHat"], variant)
            label = int(labels(np.array([post.p_up]), np.array([post.mean_delta]), s.means.size,
                               config["pStar"], spec["deltaMin"], variant.min_sessions)[0])
            fixtures.append({"name": f"v3 {key} series {i + 1} ({s.side})", "measure": key,
                             "values": s.means.tolist(), "units": units.tolist(),
                             "pRising": post.p_up, "meanChange": post.mean_delta,
                             "changeLow": post.delta_low, "changeHigh": post.delta_high,
                             "levelMean": post.level_mean.tolist(), "levelLow": post.level_low.tolist(),
                             "levelHigh": post.level_high.tolist(), "label": label})
    (out_dir / "trendModelFixtures.json").write_text(
        json.dumps({"configVersion": config["version"], "cases": fixtures}, indent=1) + "\n", encoding="utf-8")

    lines = ["# Trend model, amendment v3: extra measures (bands only)\n",
             f"Protocol SHA-256: `{protocol_hash}`  \nConfig version: `{config['version']}`\n",
             "| Measure | Source | tau-hat | unit SD | Band | Check: worst false-call base / 0.5x / 1.5x / 2x (%) |",
             "|---|---|---|---|---|---|"]
    for key in sorted({**learned, **borrowed}):
        spec = measures[key]
        if key in learned:
            w = learned[key]["check"]["worst_false_call"]
            check = " / ".join(f"{100 * w[c]:.1f}" for c in CHECK_CONDITIONS)
        else:
            check = "type check (borrowed)"
        lines.append(f"| {key} | {spec['tauSource']} | {spec['tauHat']:.4g} | {spec['sigmaU']:.4g} | "
                     f"{'yes' if spec['band'] else 'no'} | {check} |")
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    (out_dir / "extra_measures.json").write_text(json.dumps({"learned": learned, "borrowed": borrowed}, indent=1,
                                                            default=str), encoding="utf-8")
    print("wrote", out_dir, "version", config["version"])


if __name__ == "__main__":
    main()
