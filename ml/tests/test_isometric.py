"""
Deterministic checks for the isometric framing: hold generation, the hold
feature extraction, the per-limb paired/shared-timeline contract, and a
draw-order guard pinning the dynamic framings' RNG streams.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from features.extract import (aggregate_session_features, extract_rep_features)
from generators.base import sample_subject
from generators.ex_generator import generate_dataset
from generators.framings import generate_session
from generators.registry import get_exercise


def _seeded_session(exercise_id: str, seed: int = 0, label: int = 1):
    rng = np.random.default_rng(seed)
    return generate_session(
        get_exercise(exercise_id), subject=sample_subject(rng),
        subject_id=0, session_id=0, label=label, rng=rng,
    )


def _band(exercise_id: str) -> tuple[float, float]:
    band = (get_exercise(exercise_id).isometric or {})["targetBand"]
    return float(band["center"]), float(band["tolerance"])


def _hold_frames(exercise_id: str, segments: list[tuple[int, float]],
                 side: str = "right", channels: dict[str, float] | None = None) -> pd.DataFrame:
    """A hand-built hold: piecewise-constant primary from (n_frames, value) segments."""
    primary = np.concatenate([np.full(n, v, dtype=float) for n, v in segments])
    n = primary.size
    cols = {
        "session_id": 0, "subject_id": 0, "label": 0,
        "set_index": 1, "side": side, "rep_index": 1,
        "frame": np.arange(n), "primary": primary,
    }
    comp_names = [c.name for c in get_exercise(exercise_id).compensations]
    channels = channels or {}
    for name in comp_names:
        cols[name] = np.full(n, channels.get(name, 0.0))
    return pd.DataFrame(cols)


def test_isometric_dispatch_no_stub():
    for ex in ("ex_004", "ex_006"):
        params = get_exercise(ex)
        assert params.framing == "isometric"
        sess = _seeded_session(ex)
        assert sess.reps, ex
        assert all(r.rep_index == 1 for r in sess.reps)
        assert {r.side for r in sess.reps} == {"left", "right"}
        comp_names = {c.name for c in params.compensations}
        assert set(sess.reps[0].channels.keys()) == comp_names
        # set_targets carries hold seconds per side, from the prescription menu.
        assert set(sess.set_targets.values()) <= {20, 25, 30, 40}


def test_isometric_determinism():
    for ex in ("ex_004", "ex_006"):
        a, b = _seeded_session(ex), _seeded_session(ex)
        assert len(a.reps) == len(b.reps)
        for ra, rb in zip(a.reps, b.reps):
            assert np.array_equal(ra.primary, rb.primary)
            for m in ra.channels:
                assert np.array_equal(ra.channels[m], rb.channels[m])


def test_dynamic_framings_draw_order_unchanged():
    # Pinned from the code state BEFORE the isometric framing was added: the
    # isometric code path must not consume RNG draws in the dynamic framings.
    sess1 = _seeded_session("ex_001")
    assert len(sess1.reps) == 56
    assert sum(r.primary.size for r in sess1.reps) == 3626
    total1 = float(np.concatenate([r.primary for r in sess1.reps]).sum())
    assert total1 == pytest.approx(180340.40625, rel=1e-6)

    sess5 = _seeded_session("ex_005")
    assert len(sess5.reps) == 28
    assert sum(r.primary.size for r in sess5.reps) == 2155
    total5 = float(np.concatenate([r.primary for r in sess5.reps]).sum())
    assert total5 == pytest.approx(33806.8984375, rel=1e-6)


def test_hold_features_handbuilt():
    for ex in ("ex_004", "ex_006"):
        center, tol = _band(ex)
        below = center - tol - 4.0
        # 15 frames out, 30 in at center+2, 15 out: half in band, one exit.
        feats = extract_rep_features(
            _hold_frames(ex, [(15, below), (30, center + 2.0), (15, below)]), ex
        ).iloc[0]
        assert feats["in_band_frac"] == pytest.approx(0.5)
        assert feats["settle_ms"] == pytest.approx(500.0)
        assert feats["exit_count"] == 1
        assert feats["longest_in_band_frac"] == pytest.approx(0.5)
        assert feats["in_band_ms"] == pytest.approx(1000.0)

        # 15 frames out then 45 held exactly at center+2: clean post-settle stats.
        feats2 = extract_rep_features(
            _hold_frames(ex, [(15, below), (45, center + 2.0)]), ex
        ).iloc[0]
        assert feats2["mean_abs_dev"] == pytest.approx(2.0)
        assert feats2["hold_sd"] == pytest.approx(0.0, abs=1e-9)
        assert feats2["drift_slope_deg_s"] == pytest.approx(0.0, abs=1e-9)
        assert feats2["exit_count"] == 0

    # Compensation features against the registry warning thresholds.
    # ex_004 declares ONLY trunkLean (warn 3) since the assisted-stretch
    # decision removed shoulderSymmetry — a sloped shoulder line is
    # prescribed technique there. A stray shoulderSymmetry channel must not
    # produce comp features for it.
    center, tol = _band("ex_004")
    feats3 = extract_rep_features(
        _hold_frames("ex_004", [(60, center)],
                     channels={"trunkLean": 4.0, "shoulderSymmetry": 1.0}), "ex_004"
    ).iloc[0]
    assert feats3["comp_trunkLean_over_frac"] == pytest.approx(1.0)
    assert feats3["comp_trunkLean_mean"] == pytest.approx(4.0)
    assert "comp_shoulderSymmetry_over_frac" not in feats3.index
    # The under-threshold shoulderSymmetry pin moves to ex_006, which still
    # declares it (warn 5).
    center6, _tol6 = _band("ex_006")
    feats4 = extract_rep_features(
        _hold_frames("ex_006", [(60, center6)],
                     channels={"shoulderSymmetry": 1.0}), "ex_006"
    ).iloc[0]
    assert feats4["comp_shoulderSymmetry_over_frac"] == pytest.approx(0.0)


def test_severity_gradation():
    # Compensated sessions must hold less time in band than good ones, on
    # average, with both classes generated from the same subject pool.
    fracs = {0: [], 1: []}
    for label in (0, 1):
        rng = np.random.default_rng(20260611 + label)
        for i in range(30):
            sess = generate_session(
                get_exercise("ex_004"), subject=sample_subject(rng),
                subject_id=i, session_id=i, label=label, rng=rng,
            )
            center, tol = _band("ex_004")
            inb = [np.mean((r.primary >= center - tol) & (r.primary <= center + tol))
                   for r in sess.reps]
            fracs[label].append(float(np.mean(inb)))
    assert np.mean(fracs[1]) < np.mean(fracs[0]) - 0.05


def test_ex006_shared_timeline_and_paired(tmp_path):
    # Per-limb isometric: both sides of a set share one timeline, body-relative
    # comps are duplicated, and the paired fraction can never exceed a side's own.
    sess = _seeded_session("ex_006")
    by_set: dict[int, dict[str, object]] = {}
    for r in sess.reps:
        by_set.setdefault(r.set_index, {})[r.side] = r
    for set_index, sides in by_set.items():
        left, right = sides["left"], sides["right"]
        assert left.primary.size == right.primary.size
        assert np.array_equal(left.channels["trunkLean"], right.channels["trunkLean"])
        assert np.array_equal(left.channels["shoulderSymmetry"],
                              right.channels["shoulderSymmetry"])

    paths = generate_dataset("ex_006", n_subjects=4, sessions_per_subject=2,
                             seed=7, out_dir=tmp_path)
    frames = pd.read_parquet(paths["frames"])
    sets = pd.read_parquet(paths["sets"])
    sessions = pd.read_parquet(paths["sessions"])
    center, tol = _band("ex_006")
    inb = (frames["primary"] >= center - tol) & (frames["primary"] <= center + tol)
    f = frames.assign(inb=inb)
    for (sid, set_index), g in f.groupby(["session_id", "set_index"]):
        left = g[g["side"] == "left"]["inb"].to_numpy()
        right = g[g["side"] == "right"]["inb"].to_numpy()
        assert left.size == right.size
        paired = float(np.mean(left & right))
        assert paired <= float(np.mean(left)) + 1e-9
        assert paired <= float(np.mean(right)) + 1e-9

    rep = extract_rep_features(frames, "ex_006")
    sess_feats = aggregate_session_features(rep, sets, sessions, "ex_006", frames=frames)
    assert "paired_in_band_frac" in sess_feats.columns
    assert sess_feats["paired_in_band_frac"].between(0.0, 1.0).all()


def test_ex004_sequential_clean_and_nan_tolerant(tmp_path):
    paths = generate_dataset("ex_004", n_subjects=4, sessions_per_subject=2,
                             seed=7, out_dir=tmp_path)
    frames = pd.read_parquet(paths["frames"])
    assert frames["primary"].notna().all()

    rep = extract_rep_features(frames, "ex_004")
    # Each (session, set, side) is exactly one hold row.
    expected = frames.groupby(["session_id", "set_index", "side"]).ngroups
    assert len(rep) == expected

    # Real side-split captures interleave NaN-primary rows for the other side;
    # the extractor must drop them and produce the same hold rows.
    combined = pd.concat([frames, frames.head(50)], ignore_index=True)
    combined.loc[combined.index[-50:], "primary"] = np.nan
    rep2 = extract_rep_features(combined, "ex_004")
    assert len(rep2) == expected


def test_aggregate_isometric_columns_and_completion():
    # Hand-built: one session, one set prescribed 30 s/side; left holds the full
    # 30 s in band (plus extra that must be capped), right only 15 s.
    hold_cols = {
        "hold_total_ms": 40000.0, "in_band_frac": 0.8, "settle_ms": 1000.0,
        "longest_in_band_frac": 0.7, "exit_count": 1, "mean_abs_dev": 2.0,
        "hold_sd": 1.0, "drift_slope_deg_s": -0.1, "mean_speed": 5.0,
    }
    comp_cols = {
        "comp_trunkLean_mean": 1.0, "comp_trunkLean_peak": 2.0,
        "comp_trunkLean_over_frac": 0.0,
        "comp_shoulderSymmetry_mean": 1.0, "comp_shoulderSymmetry_peak": 2.0,
        "comp_shoulderSymmetry_over_frac": 0.0,
    }
    rep_feats = pd.DataFrame([
        {"session_id": 0, "subject_id": 0, "label": 0, "set_index": 1,
         "side": "left", "rep_index": 1, "in_band_ms": 35000.0,
         **hold_cols, **comp_cols},
        {"session_id": 0, "subject_id": 0, "label": 0, "set_index": 1,
         "side": "right", "rep_index": 1, "in_band_ms": 15000.0,
         **hold_cols, **comp_cols},
    ])
    sets = pd.DataFrame([{"session_id": 0, "set_index": 1, "target_reps": 30}])
    sessions = pd.DataFrame([{"session_id": 0, "subject_id": 0, "label": 0}])

    out = aggregate_session_features(rep_feats, sets, sessions, "ex_004").iloc[0]
    # Credited: min(35000, 30000) + min(15000, 30000) over 30000 * 2 sides.
    assert out["completion_rate"] == pytest.approx(45000.0 / 60000.0)
    assert out["n_holds"] == 2
    assert out["n_sets"] == 1
    # Sequential sides: no paired feature for the side-split isometric.
    assert "paired_in_band_frac" not in out.index
    for col in ("in_band_frac_mean", "in_band_frac_min", "settle_ms_mean",
                "exit_count_mean", "hold_asym", "dev_asym", "fatigue_drift",
                "comp_trunkLean_over_frac_mean"):
        assert col in out.index
