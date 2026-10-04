import numpy as np
import pandas as pd
import pytest

from features.extract import _smoothness, _rep_features_one, require_current_feature_definition, FEATURE_DEFINITION


def curve(seconds):
    return 50 * (1 - np.cos(2 * np.pi * np.arange(seconds * 30 + 1) / (seconds * 30)))


def test_jerk_has_correct_dimensions_and_matches_analytic_curve():
    a, _ = _smoothness(curve(2), 30)
    b, _ = _smoothness(curve(4), 30)
    scaled, _ = _smoothness(curve(2) * 3 + 15, 30)
    assert abs(a - b) < .01
    assert abs(a - scaled) < 1e-8
    assert abs(a + np.log(8 * np.pi ** 6)) < .03


def test_no_motion_is_not_a_perfect_smoothness_measurement():
    assert np.isnan(_smoothness(np.ones(61), 30)[0])


def test_gap_cannot_be_compressed_into_a_regular_series():
    df = pd.DataFrame({"frame": [0, 1, 8, 9], "primary": [0, 1, 2, 0]})
    with pytest.raises(ValueError, match="contiguous"):
        _rep_features_one(df, 90, [])


def test_old_or_mixed_feature_tables_cannot_train_as_v2():
    with pytest.raises(ValueError, match="regenerate"):
        require_current_feature_definition(pd.DataFrame({"neg_log_djerk": [1]}))
    with pytest.raises(ValueError, match="regenerate"):
        require_current_feature_definition(pd.DataFrame({"feature_definition": [FEATURE_DEFINITION, "rep-v1"]}))
    require_current_feature_definition(pd.DataFrame({"feature_definition": [FEATURE_DEFINITION]}))
