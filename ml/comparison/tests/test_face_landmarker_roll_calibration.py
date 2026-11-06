import math

import numpy as np

from comparison.face_landmarker_roll_calibration import (
    angle_diff_deg,
    best_lag_summary,
    rotation_matrix_for_image_roll,
    summarize_records,
)


def test_rotation_matrix_injects_postural_y_down_roll():
    matrix = rotation_matrix_for_image_roll(200, 200, 23.0)
    transformed_x_axis_angle = math.degrees(math.atan2(matrix[1, 0], matrix[0, 0]))
    assert math.isclose(transformed_x_axis_angle, 23.0, abs_tol=1e-9)


def test_angle_diff_wraps_across_180_boundary():
    assert math.isclose(angle_diff_deg(-179.0, 179.0), 2.0)
    assert math.isclose(angle_diff_deg(179.0, -179.0), -2.0)


def test_summarize_records_recovers_perfect_scale():
    records = [
        {"injected_deg": angle, "predicted_delta_deg": angle}
        for angle in (-40.0, -20.0, 0.0, 20.0, 40.0)
    ]
    summary = summarize_records(records)
    assert summary["coverage"] == 1.0
    assert math.isclose(summary["slope"], 1.0, abs_tol=1e-12)
    assert math.isclose(summary["mae_deg"], 0.0, abs_tol=1e-12)


def test_best_lag_detects_two_frame_prediction_delay():
    expected = np.sin(np.linspace(0.0, 5.0, 100))
    predicted = np.concatenate([np.full(2, np.nan), expected[:-2]])
    result = best_lag_summary(expected, predicted, max_lag_frames=5)
    assert result["lag_frames"] == 2
    assert result["pearson_r"] > 0.999999
    assert result["aligned_mae_deg"] < 1e-12
