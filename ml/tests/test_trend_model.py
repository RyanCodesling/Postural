"""Behavioural tests for the Gaussian-process trend model and its baselines."""
from __future__ import annotations

import numpy as np
import pytest
from sklearn.gaussian_process import GaussianProcessRegressor
from sklearn.gaussian_process.kernels import RBF, ConstantKernel, DotProduct

from trend.baselines import b0_current_rule, b1_slope_t_test, ols_projection
from trend.learn import learn
from trend.model import (FALLING, NO_CLEAR_CHANGE, RISING, SMOOTH_FRACTION, VAGUE, Variant,
                         batch_posterior, labels, log_marginal_likelihood, series_posterior)
from trend.simulate import CONDITIONS, Config, simulate

FIXED_TAU = Variant("fixed", 1e-7, 3, True)
FIXED_TAU_LINEAR = Variant("fixed-linear", 1e-7, 3, False)


def _sklearn_gp(tau: float, w: np.ndarray, tau_hat: float, smooth: bool) -> GaussianProcessRegressor:
    vague = VAGUE * tau_hat
    kernel = (ConstantKernel(vague**2, "fixed")
              + ConstantKernel(vague**2, "fixed") * DotProduct(sigma_0=0.0, sigma_0_bounds="fixed"))
    if smooth:
        kernel = kernel + ConstantKernel((SMOOTH_FRACTION * tau) ** 2, "fixed") * RBF(3.0, "fixed")
    return GaussianProcessRegressor(kernel=kernel, alpha=w + tau**2, optimizer=None, normalize_y=False)


def test_marginal_likelihood_and_posterior_match_sklearn():
    y = np.array([92.3, 89.1, 82.2, 97.4, 93.9, 101.1, 93.4, 95.8])
    n = y.size
    w = np.array([3.4, 2.1, 2.8, 3.0, 1.9, 2.5, 3.3, 2.2])
    tau = 4.0
    x = (np.arange(n) - (n - 1) / 2.0)[:, None]
    yc = y - y.mean()
    gp = _sklearn_gp(tau, w, tau, smooth=True).fit(x, yc)
    ours = log_marginal_likelihood(y, w, tau, VAGUE * tau, SMOOTH_FRACTION * tau)
    assert ours == pytest.approx(gp.log_marginal_likelihood_value_, rel=1e-9)

    mean, cov = gp.predict(x, return_cov=True)
    post = series_posterior(y, w, tau, FIXED_TAU)
    np.testing.assert_allclose(post.level_mean, mean + y.mean(), rtol=1e-6)
    np.testing.assert_allclose((post.level_high - post.level_low) / (2 * 1.96), np.sqrt(np.diag(cov)), rtol=1e-5)
    change_sd = np.sqrt(cov[0, 0] + cov[-1, -1] - 2 * cov[0, -1])
    assert post.mean_delta == pytest.approx(mean[-1] - mean[0], rel=1e-6)
    assert post.delta_high == pytest.approx(post.mean_delta + 1.959964 * change_sd, rel=1e-4)


def test_batch_matches_single_series_with_constant_within_variance():
    rng = np.random.default_rng(3)
    values = 50 + rng.normal(0, 3, (6, 7))
    p_up, mean_delta = batch_posterior(values, 1.5, 2.5, Variant("V1", 0.5, 3, True))
    for row in range(values.shape[0]):
        single = series_posterior(values[row], np.full(7, 1.5), 2.5, Variant("V1", 0.5, 3, True))
        assert p_up[row] == pytest.approx(single.p_up, abs=1e-10)
        assert mean_delta[row] == pytest.approx(single.mean_delta, abs=1e-9)


def test_known_noise_linear_model_reduces_to_least_squares():
    rng = np.random.default_rng(11)
    values = 20 + rng.normal(0, 2, (5, 6))
    w = 0.5
    tau = 1.7
    p_up, mean_delta = batch_posterior(values, w, tau, FIXED_TAU_LINEAR)
    _, projected, sxx = ols_projection(values)
    np.testing.assert_allclose(mean_delta, projected, rtol=2e-3)
    sd = np.sqrt((tau**2 + w) * (values.shape[1] - 1) ** 2 / sxx)
    from scipy.stats import norm
    np.testing.assert_allclose(p_up, norm.cdf(projected / sd), atol=3e-3)


def test_current_rule_port_matches_dashboard_examples():
    series = np.array([
        [78, 84, 80, 86],      # projected +6 > max(3, 4.1): improving
        [92, 92, 92, 92],      # plateau
        [100, 90, 80, 70],     # regressing
        [21, 22, 23.5, 23.5],  # angle: projected 2.7 < 3 floor: plateau
    ], dtype=float)
    assert list(b0_current_rule(series, True)) == [1, 0, -1, 0]
    assert list(b0_current_rule(np.array([[50, 52, 55]], dtype=float), False)) == [1]
    assert list(b0_current_rule(np.array([[50, 60]], dtype=float), False)) == [0]


def test_slope_t_test_needs_three_sessions_and_respects_minimum_change():
    rising = np.array([[10, 11, 12.05, 13, 14]], dtype=float)
    assert list(b1_slope_t_test(rising, 0.05, 0.0)) == [1]
    assert list(b1_slope_t_test(rising, 0.05, 10.0)) == [0]
    assert list(b1_slope_t_test(np.array([[1, 2]], dtype=float), 0.05, 0.0)) == [0]


def test_labels_apply_threshold_minimum_change_and_minimum_sessions():
    p_up = np.array([0.999, 0.001, 0.6, 0.999])
    change = np.array([5.0, -5.0, 1.0, 1.0])
    assert list(labels(p_up, change, 5, 0.99, 3.0, 3)) == [RISING, FALLING, NO_CLEAR_CHANGE, NO_CLEAR_CHANGE]
    assert list(labels(p_up, change, 3, 0.99, 3.0, 4)) == [0, 0, 0, 0]


def test_simulation_is_reproducible():
    config = Config("T", "ex", "m", True, 3.0, 90.0, 5.0, 4.0, 10.0, (4.0, 20.0))
    a, wa = simulate(config, CONDITIONS[0], "linear", 2.0, 6, 50, np.random.default_rng(7))
    b, wb = simulate(config, CONDITIONS[0], "linear", 2.0, 6, 50, np.random.default_rng(7))
    np.testing.assert_array_equal(a, b)
    assert wa == wb == pytest.approx(2.5)


def test_learning_recovers_session_to_session_variation():
    rng = np.random.default_rng(21)
    sessions = []
    sid = 0
    for series in range(40):
        for day in range(8):
            level = 60 + rng.normal(0, 2.0)
            sessions.append({
                "sessionId": sid, "patientId": f"p{series}", "exerciseId": "ex_x",
                "configVersion": "v1", "prescribedSide": "both",
                "resistance": {"type": "none"}, "startedAt": f"2026-01-{day + 1:02d}T00:00:00Z",
                "units": {"peak": {"left": list(level + rng.normal(0, 1.0, 10)), "right": []}},
            })
            sid += 1
    fit = learn(sessions, "ex_x", "peak", 10.0)
    assert fit.sigma_u == pytest.approx(1.0, rel=0.1)
    assert fit.tau_mle == pytest.approx(2.0, rel=0.25)
