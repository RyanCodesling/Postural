"""Run the trend model's evaluation protocol and write a report.

    .venv/Scripts/python.exe -m trend.evaluate [--rules v2] [--sessions data/trend/tier1_sessions.json]

--rules v1    protocol v1 as first registered
--rules v1.1  protocol v1 with deviation 1 (data rules)
--rules v2    amendment v2 (labels on the main measure only, fault-test sessions
              excluded from learning); on GO it also writes the app configuration
              and parity fixtures.

Outputs go to a new folder under trend/out/ (gitignored). The protocol text is in
EVALUATION_PROTOCOL.md; its SHA-256 is written into the report.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .baselines import b0_current_rule, b1_slope_t_test, b2_fixed_cutoff, tune_b2_cutoff
from .learn import (FAULT_TEST_SESSIONS, RULES_V1, RULES_V1_1_HOLDS, RULES_V1_1_REPS, DataRules,
                    Learned, learn, load_sessions, pooled_unit_sd, sessions_with_units)
from .model import (GRID_POINTS, RBF_LENGTH, SMOOTH_FRACTION, VAGUE, VARIANTS, batch_posterior,
                    labels, series_posterior)
from .simulate import CONDITIONS, SESSION_COUNTS, TRUTHS, Config, simulate, truth_direction

HERE = Path(__file__).resolve().parent
ML_ROOT = HERE.parent
PROTOCOL = HERE / "EVALUATION_PROTOCOL.md"
SERIES_PER_CELL = 2000
B2_TUNING_SERIES = 50_000
SEED_A = 1_000
SEED_B = 500_000
SEED_B2 = 900_000
SENSITIVITY_SESSION = 199
TIE_ORDER = ("V4", "V1", "V3", "V2")
HOLD_MEASURES = frozenset({"inBandPct", "holdFormScore"})
LINEAR_BIG = (-4.0, -3.0, -2.0, 2.0, 3.0, 4.0)

CONFIG_SPECS = (
    # cid, exercise, measure, is_angle, delta_min, units_base, units_stress
    ("A", "ex_001", "peak", True, 3.0, 10.0, (4.0, 20.0)),
    ("B", "ex_001", "formScore", False, 0.0, 10.0, (4.0, 20.0)),
    ("C", "ex_005", "peak", True, 3.0, 10.0, (4.0, 20.0)),
    ("D", "ex_006", "inBandPct", False, 0.0, 2.0, (1.0, 4.0)),
)


@dataclass(frozen=True)
class RunSettings:
    rules_version: str
    p_stars: tuple[float, ...]
    card_series: int
    labelled_configs: tuple[str, ...]
    exclude: frozenset[int]
    # Amendment v2.1: choose p* only among thresholds that also pass G1 and G2.
    gate_aware_p_star: bool = False


SETTINGS = {
    "v1": RunSettings("v1", (0.975, 0.99, 0.995), 4, ("A", "B", "C", "D"), frozenset()),
    "v1.1": RunSettings("v1.1", (0.975, 0.99, 0.995), 4, ("A", "B", "C", "D"), frozenset()),
    "v2": RunSettings("v2", (0.975, 0.98, 0.985, 0.99, 0.995), 2, ("A", "C", "D"), FAULT_TEST_SESSIONS),
    "v2.1": RunSettings("v2.1", (0.975, 0.98, 0.985, 0.99, 0.995), 2, ("A", "C", "D"), FAULT_TEST_SESSIONS,
                        gate_aware_p_star=True),
}
APP_CONFIG_RULES = frozenset({"v2", "v2.1"})


def rules_for(rules_version: str, measure: str) -> DataRules:
    if rules_version == "v1":
        return RULES_V1
    return RULES_V1_1_HOLDS if measure in HOLD_MEASURES else RULES_V1_1_REPS


def learn_configs(sessions: list[dict], settings: RunSettings) -> tuple[list[Config], dict[str, Learned], dict[str, dict]]:
    configs: list[Config] = []
    learned: dict[str, Learned] = {}
    sensitivity: dict[str, dict] = {}
    for cid, exercise, measure, is_angle, delta_min, units_base, units_stress in CONFIG_SPECS:
        rules = rules_for(settings.rules_version, measure)
        fit = learn(sessions, exercise, measure, units_base, exclude=settings.exclude, rules=rules)
        learned[cid] = fit
        try:
            alt = learn(sessions, exercise, measure, units_base,
                        exclude=settings.exclude | {SENSITIVITY_SESSION}, rules=rules)
            sensitivity[cid] = {"tau_mle_without_199": alt.tau_mle, "tau_hat_without_199": alt.tau_hat,
                                "series_without_199": len(alt.series)}
        except ValueError as error:
            sensitivity[cid] = {"error": str(error)}
        configs.append(Config(cid=cid, exercise=exercise, measure=measure, is_angle=is_angle,
                              delta_min=delta_min, level=fit.level, sigma_u=fit.sigma_u,
                              tau_hat=fit.tau_hat, units_base=units_base, units_stress=units_stress))
    return configs, learned, sensitivity


def tune_b2(configs: list[Config], p_stars: tuple[float, ...]) -> dict[tuple[str, float], float]:
    cutoffs: dict[tuple[str, float], float] = {}
    base = CONDITIONS[0]
    for ci, config in enumerate(configs):
        for pi, p_star in enumerate(p_stars):
            rng = np.random.default_rng(SEED_B2 + 10 * ci + pi)
            flat, _ = simulate(config, base, "flat", 0.0, 5, B2_TUNING_SERIES, rng)
            cutoffs[(config.cid, p_star)] = tune_b2_cutoff(flat, 2 * (1 - p_star), config.delta_min)
    return cutoffs


CELLS_PER_CONFIG = len(CONDITIONS) * len(TRUTHS) * len(SESSION_COUNTS)


def run_cells(configs: list[Config], seed_base: int, variants: list[str],
              b2_cutoffs: dict[tuple[str, float], float], p_stars: tuple[float, ...]) -> list[dict]:
    """All cells; configurations run in parallel processes with the same seeds as a
    sequential run (cell k of configuration i uses seed_base + i * CELLS_PER_CONFIG + k)."""
    jobs = [(config, index, seed_base, variants, b2_cutoffs, p_stars) for index, config in enumerate(configs)]
    with ProcessPoolExecutor(max_workers=len(jobs)) as pool:
        parts = list(pool.map(_run_config_job, jobs))
    return [row for part in parts for row in part]


def _run_config_job(job: tuple) -> list[dict]:
    return run_config_cells(*job)


def run_config_cells(config: Config, config_index: int, seed_base: int, variants: list[str],
                     b2_cutoffs: dict[tuple[str, float], float], p_stars: tuple[float, ...]) -> list[dict]:
    rows: list[dict] = []
    k = config_index * CELLS_PER_CONFIG
    for condition in CONDITIONS:
        for truth, multiple in TRUTHS:
            direction = truth_direction(truth, multiple)
            for n in SESSION_COUNTS:
                rng = np.random.default_rng(seed_base + k)
                k += 1
                values, w = simulate(config, condition, truth, multiple, n, SERIES_PER_CELL, rng)
                cell = dict(config=config.cid, condition=condition.name, truth=truth,
                            multiple=multiple, direction=direction, n=n, count=SERIES_PER_CELL)

                def record(method: str, p_star: float | None, calls: np.ndarray) -> None:
                    rows.append({**cell, "method": method, "p_star": p_star,
                                 "rising": int(np.sum(calls == 1)),
                                 "falling": int(np.sum(calls == -1))})

                record("B0", None, b0_current_rule(values, config.is_angle))
                for p_star in p_stars:
                    record("B1", p_star, b1_slope_t_test(values, 2 * (1 - p_star), config.delta_min))
                    record("B2", p_star, b2_fixed_cutoff(values, b2_cutoffs[(config.cid, p_star)]))
                for name in variants:
                    variant = VARIANTS[name]
                    p_up, mean_delta = batch_posterior(values, w, config.tau_hat, variant)
                    for p_star in p_stars:
                        record(name, p_star, labels(p_up, mean_delta, n, p_star,
                                                    config.delta_min, variant.min_sessions))
    return rows


def rate(row: dict) -> float:
    """False-call rate for no-change truths, correct-direction rate otherwise."""
    if row["direction"] == 0:
        return (row["rising"] + row["falling"]) / row["count"]
    hits = row["rising"] if row["direction"] > 0 else row["falling"]
    return hits / row["count"]


def index_rows(rows: list[dict]) -> dict[tuple, dict]:
    return {(r["config"], r["condition"], r["truth"], r["multiple"], r["n"], r["method"], r["p_star"]): r
            for r in rows}


def decide(rows: list[dict], configs: list[Config], settings: RunSettings) -> dict:
    table = index_rows(rows)
    cids = [c.cid for c in configs]
    labelled = list(settings.labelled_configs)
    result: dict = {"variants": {}, "card_series": settings.card_series, "labelled_configs": labelled,
                    "p_star_candidates": list(settings.p_stars)}

    def r(cid, cond, truth, mult, n, method, p):
        return rate(table[(cid, cond, truth, mult, n, method, p)])

    def g2_failures(name: str, p_star: float) -> list[str]:
        failures = []
        for cid in cids:
            for cond in (c.name for c in CONDITIONS):
                for truth in ("flat", "outlier"):
                    for n in SESSION_COUNTS:
                        b0 = r(cid, cond, truth, 0.0, n, "B0", None)
                        model = r(cid, cond, truth, 0.0, n, name, p_star)
                        if b0 > 0.10 and not model < b0:
                            failures.append(f"{cid}/{cond}/{truth}/n={n}: model {model:.3f} vs B0 {b0:.3f}")
        return failures

    for name, variant in VARIANTS.items():
        ns = [n for n in SESSION_COUNTS if n >= variant.min_sessions]
        g1_base = {cid: max(r(cid, "base", "flat", 0.0, n, name, 0.975) for n in ns) for cid in cids}
        g1_stress = {cid: max(r(cid, cond, "flat", 0.0, n, name, 0.975)
                              for cond in ("tau_0.5", "tau_1.5", "tau_2") for n in ns) for cid in cids}
        g1 = all(g1_base[c] <= 0.075 and g1_stress[c] <= 0.125 for c in cids)
        chosen = None
        rejected: dict[str, int] = {}
        for p_star in settings.p_stars:
            worst = max(1 - (1 - r(cid, "base", "flat", 0.0, n, name, p_star)) ** settings.card_series
                        for cid in labelled for n in ns)
            if worst > 0.10:
                continue
            if settings.gate_aware_p_star:
                count = len(g2_failures(name, p_star))
                if not g1 or count:
                    rejected[str(p_star)] = count
                    continue
            chosen = p_star
            break
        entry = {"p_star": chosen, "G1_pass": g1, "G1_worst_base": g1_base, "G1_worst_stress": g1_stress}
        if rejected:
            entry["p_star_rejected_for_G2_failures"] = rejected
        if chosen is None:
            entry.update(G2_pass=False, G2_failures=["no p* meets the card-level cap (and, under v2.1, G1-G2)"], G3={})
            result["variants"][name] = entry
            continue
        failures = g2_failures(name, chosen)
        g3 = {}
        for cid in cids:
            vs_b1 = all(r(cid, "base", "linear", m, n, name, chosen) >= r(cid, "base", "linear", m, n, "B1", chosen)
                        for m in LINEAR_BIG for n in SESSION_COUNTS if variant.min_sessions <= n <= 5)
            vs_b2 = all(r(cid, "base", "linear", m, n, name, chosen) >= r(cid, "base", "linear", m, n, "B2", chosen) - 0.05
                        for m in LINEAR_BIG for n in SESSION_COUNTS if n >= variant.min_sessions)
            g3[cid] = {"vs_B1_small_n": vs_b1, "vs_B2_minus_5pts": vs_b2}
        detection = float(np.mean([r(cid, "base", "linear", m, n, name, chosen)
                                   for cid in labelled for m in LINEAR_BIG for n in SESSION_COUNTS if n <= 6]))
        entry.update(G2_pass=not failures, G2_failures=failures[:20], G2_failure_count=len(failures),
                     G3=g3, mean_detection_small_n=detection)
        result["variants"][name] = entry

    eligible = [n for n, e in result["variants"].items() if e["G1_pass"] and e.get("G2_pass")]
    if eligible:
        best = max(result["variants"][n]["mean_detection_small_n"] for n in eligible)
        tied = [n for n in eligible if abs(result["variants"][n]["mean_detection_small_n"] - best) < 1e-12]
        selected = sorted(tied, key=TIE_ORDER.index)[0]
        result.update(decision="GO", selected=selected, selected_p_star=result["variants"][selected]["p_star"])
    else:
        result.update(decision="NO-GO", selected=None, selected_p_star=None)
    return result


# ---- App configuration (amendment v2) ---------------------------------------------

APP_MEASURES = (
    # exercise, measure, type, is_angle, typical units per session
    ("ex_001", "peak", "peak", True, 10.0), ("ex_001", "formScore", "form", False, 10.0),
    ("ex_004", "peak", "peak", True, 10.0), ("ex_004", "formScore", "form", False, 10.0),
    ("ex_004", "inBandPct", "band", False, 2.0), ("ex_004", "holdFormScore", "form", False, 2.0),
    ("ex_005", "peak", "peak", True, 10.0), ("ex_005", "formScore", "form", False, 10.0),
    ("ex_006", "inBandPct", "band", False, 2.0), ("ex_006", "holdFormScore", "form", False, 2.0),
    ("ex_007", "peak", "peak", False, 10.0), ("ex_007", "formScore", "form", False, 10.0),
    ("ex_008", "peak", "peak", True, 10.0), ("ex_008", "formScore", "form", False, 10.0),
)
TYPE_CONFIGS = {"peak": ("A", "C"), "form": ("B",), "band": ("D",)}
UNIT_DONOR = {("ex_004", "peak"): ("ex_005", "peak"), ("ex_004", "inBandPct"): ("ex_006", "inBandPct")}
FORM_DONOR = ("ex_001", "formScore")
BADGED_MEASURES = frozenset({"peak", "inBandPct"})


def build_app_config(sessions: list[dict], settings: RunSettings, configs: list[Config], decision: dict,
                     protocol_hash: str) -> dict:
    by_cid = {c.cid: c for c in configs}
    ratios = {kind: float(np.median([by_cid[c].tau_hat / by_cid[c].sigma_u for c in cids]))
              for kind, cids in TYPE_CONFIGS.items()}
    variant = VARIANTS[decision["selected"]]
    measures = {}
    for exercise, measure, kind, is_angle, units_typ in APP_MEASURES:
        rules = rules_for(settings.rules_version, measure)
        own_sessions = sessions_with_units(sessions, exercise, measure, 2, settings.exclude, rules)
        donor = UNIT_DONOR.get((exercise, measure), FORM_DONOR if kind == "form" else None)
        if own_sessions >= 2:
            sigma_u, _ = pooled_unit_sd(sessions, exercise, measure, settings.exclude, rules)
            sigma_source = f"own ({own_sessions} sessions with >= 2 units)"
        elif donor is not None:
            donor_rules = rules_for(settings.rules_version, donor[1])
            sigma_u, _ = pooled_unit_sd(sessions, donor[0], donor[1], settings.exclude, donor_rules)
            sigma_source = f"donor {donor[0]}/{donor[1]}"
        elif own_sessions >= 1:
            # Deviation 2: no donor in the same units, so the exercise's own single session.
            sigma_u, _ = pooled_unit_sd(sessions, exercise, measure, settings.exclude, rules)
            sigma_source = "own, single session (deviation 2)"
        else:
            raise ValueError(f"no unit SD and no donor for {exercise}/{measure}")
        floor = 0.5 * sigma_u / np.sqrt(units_typ)
        try:
            fit = learn(sessions, exercise, measure, units_typ, exclude=settings.exclude, rules=rules,
                        sigma_u=sigma_u)
            tau_hat = fit.tau_hat
            tau_source = f"learned (MLE {fit.tau_mle:.4g} from {len(fit.series)} series)"
        except ValueError:
            tau_hat = max(ratios[kind] * sigma_u, floor)
            tau_source = f"borrowed (median tau/sigma_u {ratios[kind]:.4g} of {'/'.join(TYPE_CONFIGS[kind])})"
        measures[f"{exercise}:{measure}"] = {
            "exercise": exercise, "measure": measure, "tauHat": round(float(tau_hat), 6),
            "sigmaU": round(float(sigma_u), 6), "deltaMin": 3.0 if (kind == "peak" and is_angle) else 0.0,
            "labelled": measure in BADGED_MEASURES and not (exercise == "ex_005" and measure == "formScore"),
            "minUnits": 1 if measure in ("inBandPct", "holdFormScore") else 3,
            "sigmaSource": sigma_source, "tauSource": tau_source,
        }
    config = {
        "model": "gaussian-process-trend",
        "protocol": f"trend evaluation protocol v1, deviation 1, amendment {settings.rules_version}",
        "protocolSha256": protocol_hash,
        "variant": variant.name,
        "tauLogSd": variant.log_sd,
        "minSessions": variant.min_sessions,
        "smooth": variant.smooth,
        "smoothFraction": SMOOTH_FRACTION,
        "rbfLength": RBF_LENGTH,
        "vague": VAGUE,
        "gridPoints": GRID_POINTS,
        "pStar": decision["selected_p_star"],
        "measures": measures,
    }
    body = json.dumps(config, sort_keys=True, separators=(",", ":"))
    config["version"] = "trend-model-" + hashlib.sha256(body.encode()).hexdigest()[:12]
    return config


def build_fixtures(config: dict, learned: dict[str, Learned], configs: list[Config]) -> list[dict]:
    variant = VARIANTS[config["variant"]]
    cases = []

    def add(name: str, key: str, values, units) -> None:
        spec = config["measures"][key]
        values = np.asarray(values, dtype=float)
        units = np.asarray(units, dtype=float)
        post = series_posterior(values, spec["sigmaU"] ** 2 / units, spec["tauHat"], variant)
        label = int(labels(np.array([post.p_up]), np.array([post.mean_delta]), values.size,
                           config["pStar"], spec["deltaMin"], variant.min_sessions)[0])
        cases.append({"name": name, "measure": key, "values": values.tolist(), "units": units.tolist(),
                      "pRising": post.p_up, "meanChange": post.mean_delta,
                      "changeLow": post.delta_low, "changeHigh": post.delta_high,
                      "levelMean": post.level_mean.tolist(), "levelLow": post.level_low.tolist(),
                      "levelHigh": post.level_high.tolist(), "label": label})

    for config_obj in configs:
        key = f"{config_obj.exercise}:{config_obj.measure}"
        for i, s in enumerate(learned[config_obj.cid].series):
            add(f"real {config_obj.cid} series {i + 1} ({s.side})", key, s.means, s.unit_counts)
    add("flat three sessions", "ex_001:peak", [95.0, 94.0, 96.0], [10, 10, 10])
    add("clear rise six sessions", "ex_001:peak", [80, 84, 88, 92, 97, 101], [10, 12, 10, 8, 10, 10])
    add("clear fall eight sessions", "ex_006:inBandPct", [100, 96, 90, 85, 80, 74, 70, 65], [2, 2, 2, 1, 2, 2, 2, 2])
    add("noisy ten sessions", "ex_005:peak", [21.5, 20.2, 22.8, 21.0, 23.1, 20.4, 21.9, 22.6, 20.8, 22.0],
        [8, 10, 6, 12, 9, 10, 7, 10, 11, 8])
    add("form score small drift", "ex_001:formScore", [96, 95.5, 95, 94.2, 93.8], [10, 10, 10, 10, 10])
    add("borrowed wall angels", "ex_008:peak", [150, 152, 155, 158], [10, 10, 10, 10])
    add("normalized reach", "ex_007:peak", [0.88, 0.9, 0.93, 0.95, 0.96], [10, 10, 10, 10, 10])
    add("two sessions only", "ex_001:peak", [90.0, 99.0], [10, 10])
    return cases


def illustrate(configs: list[Config], learned: dict[str, Learned], variant_name: str, p_star: float) -> list[dict]:
    variant = VARIANTS[variant_name]
    aliases: dict[str, str] = {}
    out = []
    for config in configs:
        fit = learned[config.cid]
        for series in fit.series:
            patient = aliases.setdefault(series.key[0], f"test account {len(aliases) + 1}")
            w = config.sigma_u**2 / series.unit_counts
            post = series_posterior(series.means, w, config.tau_hat, variant)
            model_label = int(labels(np.array([post.p_up]), np.array([post.mean_delta]), series.means.size,
                                     p_star, config.delta_min, variant.min_sessions)[0])
            b0 = int(b0_current_rule(series.means[None, :], config.is_angle)[0])
            name = {1: "Rising", 0: "No clear change", -1: "Falling"}
            b0_name = {1: "Improving", 0: "Plateau", -1: "Regressing"}
            out.append({
                "config": config.cid, "exercise": config.exercise, "measure": config.measure,
                "account": patient, "side": series.side, "sessions": series.means.size,
                "session_ids": series.session_ids,
                "session_means": [round(float(v), 2) for v in series.means],
                "current_label": b0_name[b0],
                "model_label": name[model_label],
                "model_change": round(post.mean_delta, 2),
                "model_change_95": [round(post.delta_low, 2), round(post.delta_high, 2)],
                "model_p_rising": round(post.p_up, 4),
                "model_tau_posterior_median": round(post.tau_posterior_median, 3),
            })
    return out


def write_csv(path: Path, rows: list[dict]) -> None:
    if not rows:
        return
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def summary_tables(rows: list[dict], configs: list[Config], method: str, p_star: float) -> str:
    table = index_rows(rows)
    lines: list[str] = []

    def fmt(row: dict) -> str:
        return f"{100 * rate(row):.1f}"

    methods = (("Model " + method, method, p_star), ("Current rule (B0)", "B0", None),
               ("Slope t-test (B1)", "B1", p_star), ("Tuned cutoff (B2)", "B2", p_star))
    header = "| Method | " + " | ".join(f"n={n}" for n in SESSION_COUNTS) + " |"
    sep = "|---|" + "---|" * len(SESSION_COUNTS)
    for config in configs:
        cid = config.cid
        lines.append(f"\n### Configuration {cid}: {config.exercise} {config.measure} "
                     f"(level {config.level:.1f}, unit SD {config.sigma_u:.2f}, tau-hat {config.tau_hat:.2f})\n")
        lines.append("False calls on no-change series, base case (%):\n")
        lines += [header, sep]
        for label, key_method, key_p in methods:
            cells = [fmt(table[(cid, "base", "flat", 0.0, n, key_method, key_p)]) for n in SESSION_COUNTS]
            lines.append(f"| {label} | " + " | ".join(cells) + " |")
        lines.append("\nFalse calls under stress, worst over n (%):\n")
        lines.append("| Condition | Truth | Model | Current rule | Tuned cutoff |")
        lines.append("|---|---|---|---|---|")
        for cond in (c.name for c in CONDITIONS):
            for truth in ("flat", "outlier"):
                worst = [max(rate(table[(cid, cond, truth, 0.0, n, m, p)]) for n in SESSION_COUNTS)
                         for m, p in ((method, p_star), ("B0", None), ("B2", p_star))]
                lines.append(f"| {cond} | {truth} | " + " | ".join(f"{100 * v:.1f}" for v in worst) + " |")
        for multiple in (2.0, 4.0, -3.0):
            truth = "step" if multiple == -3.0 else "linear"
            title = ("Detection of a step drop of 3 tau-hat" if truth == "step"
                     else f"Detection of a linear rise of {multiple:g} tau-hat")
            lines.append(f"\n{title}, base case (%):\n")
            lines += [header, sep]
            for label, key_method, key_p in methods:
                cells = [fmt(table[(cid, "base", truth, multiple, n, key_method, key_p)]) for n in SESSION_COUNTS]
                lines.append(f"| {label} | " + " | ".join(cells) + " |")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sessions", default=str(ML_ROOT / "data" / "trend" / "tier1_sessions.json"))
    parser.add_argument("--rules", choices=tuple(SETTINGS), default="v2")
    args = parser.parse_args()
    settings = SETTINGS[args.rules]

    protocol_hash = hashlib.sha256(PROTOCOL.read_bytes()).hexdigest().upper()
    out_dir = HERE / "out" / time.strftime(f"protocol_{args.rules}_%Y%m%d-%H%M%S")
    out_dir.mkdir(parents=True, exist_ok=False)
    sessions = load_sessions(Path(args.sessions))

    configs, learned, sensitivity = learn_configs(sessions, settings)
    learned_json = {
        cid: {"exercise": fit.exercise, "measure": fit.measure, "level": fit.level, "sigma_u": fit.sigma_u,
              "pooled_series_sd": fit.pooled_series_sd, "tau_mle": fit.tau_mle, "tau_floor": fit.floor,
              "tau_hat": fit.tau_hat, "series": [{"side": s.side, "sessions": int(s.means.size),
                                                   "session_ids": s.session_ids} for s in fit.series],
              "unit_sessions_for_sigma_u": fit.unit_sessions, **sensitivity[cid]}
        for cid, fit in learned.items()
    }
    (out_dir / "learned.json").write_text(json.dumps(learned_json, indent=1), encoding="utf-8")
    print("learned:", json.dumps({c: {k: round(v, 3) if isinstance(v, float) else v
                                      for k, v in d.items() if k != "series"} for c, d in learned_json.items()}, indent=1))

    started = time.time()
    b2_cutoffs = tune_b2(configs, settings.p_stars)
    rows_a = run_cells(configs, SEED_A, list(VARIANTS), b2_cutoffs, settings.p_stars)
    write_csv(out_dir / "seedA_rates.csv", rows_a)
    decision = decide(rows_a, configs, settings)
    print("seed set A done in", round(time.time() - started, 1), "s; decision:", decision["decision"],
          "selected:", decision["selected"], "p*:", decision["selected_p_star"])

    report = [f"# Trend model evaluation (rules {args.rules})\n",
              f"Protocol SHA-256: `{protocol_hash}`  \nRun folder: `{out_dir.name}`  \n"
              f"Labelled series per card: {settings.card_series}; labelled configurations: "
              f"{', '.join(settings.labelled_configs)}; excluded from learning: "
              f"{sorted(settings.exclude) if settings.exclude else 'none'}\n",
              "## Learned parameters\n",
              "| Config | Exercise / measure | Level | Unit SD | Series (sessions) | tau MLE | tau floor | tau-hat | tau MLE without 199 |",
              "|---|---|---|---|---|---|---|---|---|"]
    for cid, d in learned_json.items():
        series_desc = ", ".join(f"{s['side']} ({s['sessions']})" for s in d["series"])
        report.append(f"| {cid} | {d['exercise']} {d['measure']} | {d['level']:.2f} | {d['sigma_u']:.3f} | "
                      f"{series_desc} | {d['tau_mle']:.3f} | {d['tau_floor']:.3f} | {d['tau_hat']:.3f} | "
                      f"{d.get('tau_mle_without_199', float('nan')):.3f} |")
    report.append("\n## Decision (seed set A)\n")
    report.append("| Variant | p* | G1 | G2 | G2 failures | G3 vs B1 (n<=5) | G3 vs B2-5pts | Mean detection n<=6 |")
    report.append("|---|---|---|---|---|---|---|---|")
    for name, entry in decision["variants"].items():
        g3 = entry.get("G3", {})
        vs_b1 = ", ".join(f"{c}:{'pass' if v['vs_B1_small_n'] else 'fail'}" for c, v in g3.items())
        vs_b2 = ", ".join(f"{c}:{'pass' if v['vs_B2_minus_5pts'] else 'fail'}" for c, v in g3.items())
        report.append(f"| {name} | {entry['p_star']} | {'pass' if entry['G1_pass'] else 'fail'} | "
                      f"{'pass' if entry.get('G2_pass') else 'fail'} | {entry.get('G2_failure_count', '-')} | "
                      f"{vs_b1} | {vs_b2} | {entry.get('mean_detection_small_n', float('nan')):.3f} |")
    report.append(f"\n**Result: {decision['decision']}**"
                  + (f"; selected {decision['selected']} at p* = {decision['selected_p_star']}." if decision["selected"] else "."))
    report.append("\nWorst G1 false-call rates at p* = 0.975 (base / stress):\n")
    for name, entry in decision["variants"].items():
        worst = ", ".join(f"{c}: {100 * entry['G1_worst_base'][c]:.1f} / {100 * entry['G1_worst_stress'][c]:.1f}"
                          for c in entry["G1_worst_base"])
        report.append(f"- {name}: {worst}")

    if decision["selected"]:
        name, p_star = decision["selected"], decision["selected_p_star"]
        started = time.time()
        rows_b = run_cells(configs, SEED_B, [name], b2_cutoffs, settings.p_stars)
        write_csv(out_dir / "seedB_rates.csv", rows_b)
        print("seed set B done in", round(time.time() - started, 1), "s")
        report.append(f"\n## Confirmation results (seed set B), {name} at p* = {p_star}")
        report.append(summary_tables(rows_b, configs, name, p_star))
        illustration = illustrate(configs, learned, name, p_star)
        (out_dir / "real_illustration.json").write_text(json.dumps(illustration, indent=1), encoding="utf-8")
        report.append("\n## Real sessions: illustration only (tuning data, not evidence)\n")
        report.append("| Config | Account | Side | Sessions | Current label | Model label | Model change (95 %) |")
        report.append("|---|---|---|---|---|---|---|")
        for item in illustration:
            low, high = item["model_change_95"]
            report.append(f"| {item['config']} | {item['account']} | {item['side']} | {item['sessions']} | "
                          f"{item['current_label']} | {item['model_label']} | {item['model_change']} ({low} to {high}) |")
        if args.rules in APP_CONFIG_RULES:
            app_config = build_app_config(sessions, settings, configs, decision, protocol_hash)
            config_text = json.dumps(app_config, indent=1, sort_keys=True) + "\n"
            (out_dir / "trendModelConfig.json").write_text(config_text, encoding="utf-8")
            fixtures = build_fixtures(app_config, learned, configs)
            (out_dir / "trendModelFixtures.json").write_text(
                json.dumps({"configVersion": app_config["version"], "cases": fixtures}, indent=1) + "\n",
                encoding="utf-8")
            report.append("\n## App configuration\n")
            report.append(f"Version `{app_config['version']}`, variant {app_config['variant']}, p* {app_config['pStar']}.\n")
            report.append("| Measure | tau-hat | unit SD | min change | labelled | unit SD source | tau source |")
            report.append("|---|---|---|---|---|---|---|")
            for key, spec in app_config["measures"].items():
                report.append(f"| {key} | {spec['tauHat']:.4g} | {spec['sigmaU']:.4g} | {spec['deltaMin']:g} | "
                              f"{'yes' if spec['labelled'] else 'no'} | {spec['sigmaSource']} | {spec['tauSource']} |")

    (out_dir / "decision.json").write_text(json.dumps({**decision, "protocol_sha256": protocol_hash,
                                                       "rules": args.rules,
                                                       "b2_cutoffs": {f"{k[0]}@{k[1]}": v for k, v in b2_cutoffs.items()}},
                                                      indent=1), encoding="utf-8")
    (out_dir / "report.md").write_text("\n".join(report) + "\n", encoding="utf-8")
    print("wrote", out_dir)


if __name__ == "__main__":
    main()
