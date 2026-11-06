import math

import numpy as np

from comparison.face_landmarker_ex004 import (_roll_residual_axis_diagnostics,
                                               fixed_head_crop,
                                               matrix_orientation_deg,
                                               matrix_roll_image_deg,
                                               pose_ear_line_deg)
from comparison.metrics import Point


def test_matrix_roll_converts_metric_y_up_to_image_y_down():
    theta = math.radians(27.0)
    matrix = np.eye(4)
    matrix[:3, :3] = np.array([
        [math.cos(theta), -math.sin(theta), 0.0],
        [math.sin(theta), math.cos(theta), 0.0],
        [0.0, 0.0, 1.0],
    ])
    assert math.isclose(matrix_roll_image_deg(matrix), -27.0, abs_tol=1e-9)


def test_matrix_roll_ignores_uniform_transform_scale():
    theta = math.radians(-18.0)
    matrix = np.eye(4)
    matrix[:3, :3] = 2.5 * np.array([
        [math.cos(theta), -math.sin(theta), 0.0],
        [math.sin(theta), math.cos(theta), 0.0],
        [0.0, 0.0, 1.0],
    ])
    assert math.isclose(matrix_roll_image_deg(matrix), 18.0, abs_tol=1e-9)


def _orientation_matrix(
    pitch_deg: float,
    yaw_deg: float,
    roll_deg: float,
    scale: float = 1.0,
) -> np.ndarray:
    pitch = math.radians(pitch_deg)
    yaw = math.radians(yaw_deg)
    roll = math.radians(roll_deg)
    rx = np.array([
        [1.0, 0.0, 0.0],
        [0.0, math.cos(pitch), -math.sin(pitch)],
        [0.0, math.sin(pitch), math.cos(pitch)],
    ])
    ry = np.array([
        [math.cos(yaw), 0.0, math.sin(yaw)],
        [0.0, 1.0, 0.0],
        [-math.sin(yaw), 0.0, math.cos(yaw)],
    ])
    rz = np.array([
        [math.cos(roll), -math.sin(roll), 0.0],
        [math.sin(roll), math.cos(roll), 0.0],
        [0.0, 0.0, 1.0],
    ])
    matrix = np.eye(4)
    matrix[:3, :3] = scale * (rz @ ry @ rx)
    return matrix


def test_matrix_orientation_recovers_combined_roll_yaw_pitch():
    orientation = matrix_orientation_deg(_orientation_matrix(12.0, -23.0, 17.0, 2.5))
    assert orientation is not None
    assert math.isclose(orientation.roll_image_deg, -17.0, abs_tol=1e-9)
    assert math.isclose(orientation.yaw_deg, -23.0, abs_tol=1e-9)
    assert math.isclose(orientation.pitch_deg, 12.0, abs_tol=1e-9)


def test_matrix_orientation_rejects_degenerate_transform():
    assert matrix_orientation_deg(np.zeros((4, 4))) is None


def test_roll_residual_axis_diagnostics_recovers_linear_axis_effect():
    yaw = np.linspace(-8.0, 8.0, 31)
    pitch = np.sin(np.linspace(-math.pi, math.pi, 31)) * 5.0
    pose = np.linspace(-20.0, 20.0, 31)
    face = pose + 1.5 * yaw - 0.4 * pitch
    result = _roll_residual_axis_diagnostics(pose, face, yaw, pitch)
    assert result["overlap_frames"] == 31
    assert math.isclose(result["yaw_pitch_linear_r2"], 1.0, abs_tol=1e-12)


def test_fixed_head_crop_is_square_and_inside_frame():
    crop = fixed_head_crop(
        Point(0.47, 0.20, 0.9), Point(0.53, 0.20, 0.9), 1920, 1080)
    assert crop is not None
    x0, y0, x1, y1 = crop
    assert x1 - x0 == y1 - y0
    assert 0 <= x0 < x1 <= 1920
    assert 0 <= y0 < y1 <= 1080


def test_fixed_head_crop_requires_visible_ears():
    crop = fixed_head_crop(
        Point(0.47, 0.20, 0.2), Point(0.53, 0.20, 0.9), 1920, 1080)
    assert crop is None


def test_pose_ear_line_uses_raw_line_for_frozen_reference_equivalence():
    landmarks = {
        "left_ear": Point(0.7, 0.3, 0.9),
        "right_ear": Point(0.3, 0.2, 0.9),
    }
    expected = math.degrees(math.atan2(0.1, 0.4))
    assert math.isclose(pose_ear_line_deg(landmarks), expected, abs_tol=1e-9)
