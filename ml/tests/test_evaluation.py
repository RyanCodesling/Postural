import json

import numpy as np
import pandas as pd
import pytest
from sklearn.linear_model import LogisticRegression

from training import train
from training.evaluation import calibration_splits, cluster_bootstrap, metrics


def fixture():
    groups = np.repeat(np.arange(8), 4)
    y = np.tile([0, 1, 0, 1], 8)
    return pd.DataFrame({"signal": y + np.random.default_rng(7).normal(0, .5, len(y))}), y, groups


def test_actual_nested_calibrator_is_subject_disjoint_and_oof():
    x, y, groups = fixture()
    audit = []
    p = train.loso_oof(LogisticRegression, x, y, groups, ["signal"], True, audit)
    assert p.shape == y.shape and np.isfinite(p).all()
    assert ((p >= 0) & (p <= 1)).all()
    tested = []
    for fold in audit:
        outer_train, outer_test = fold["trainRows"], fold["testRows"]
        tested.extend(outer_test)
        assert not set(groups[outer_train]) & set(groups[outer_test])
        calibrated = []
        for split in fold["calibration"]:
            a, b = split["trainRows"], split["testRows"]
            assert not set(groups[a]) & set(groups[b])
            assert set(a) | set(b) == set(outer_train)
            assert not (set(a) | set(b)) & set(outer_test)
            calibrated.extend(b)
        assert sorted(calibrated) == sorted(outer_train)
    assert sorted(tested) == list(range(len(y)))


def test_calibration_fails_closed_for_inadequate_subjects_or_classes():
    with pytest.raises(ValueError, match="three"):
        calibration_splits([0, 1], [0, 1])
    with pytest.raises(ValueError, match="both classes"):
        calibration_splits([0, 0, 1], [0, 1, 2])


def test_prior_never_uses_held_out_subject_labels():
    y = np.array([0, 0, 1, 1, 1, 0])
    g = np.repeat([0, 1, 2], 2)
    a = train.loso_majority(y, g)
    changed = y.copy()
    changed[:2] = 1
    b = train.loso_majority(changed, g)
    np.testing.assert_array_equal(a[:2], b[:2])
    assert a[0] == .75 and a[2] == .25


def test_metrics_hand_computed_and_rule_is_not_probability():
    y = np.array([0, 0, 1, 1])
    p = np.array([.1, .8, .7, .6])
    m = metrics(y, p)
    assert m["sensitivity"] == 1 and m["specificity"] == .5
    assert m["accuracy"] == .75 and m["brier"] == pytest.approx(.225)
    rank = metrics(y, p, probability=False)
    assert rank["roc_auc"] == .5 and rank["brier"] is None and rank["accuracy"] is None
    with pytest.raises(ValueError, match="finite"):
        metrics(y, np.array([.1, np.nan, .7, .6]))


def test_bootstrap_is_paired_reproducible_and_json_safe():
    _, y, g = fixture()
    same = np.linspace(.1, .9, len(y))
    scores = {"RandomForest (calibrated)": same, "Rule-based score": same}
    a = cluster_bootstrap(y, scores, g, draws=50)
    assert a == cluster_bootstrap(y, scores, g, draws=50)
    assert a["rfMinusRuleAuc95"] == [0, 0] and a["validDraws"] == 50
    json.dumps(a, allow_nan=False)


def test_bootstrap_samples_whole_subjects_and_counts_single_class_draws():
    y = np.array([0, 0, 1, 1])
    groups = np.array([0, 0, 1, 1])
    scores = {"RandomForest (calibrated)": np.array([.1, .2, .8, .9]),
              "Rule-based score": np.array([.9, .8, .2, .1])}
    a = cluster_bootstrap(y, scores, groups, draws=100, seed=12)
    selections = np.random.default_rng(12).integers(0, 2, (100, 2))
    assert a["validDraws"] == int((selections[:, 0] != selections[:, 1]).sum())
    assert a["rfMinusRuleAuc95"] == [1, 1]
