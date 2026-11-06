"""Gaussian-process trend model (evaluation protocol v1, section 3).

For one series of session means y_i (session index x_i = 0, 1, ...):

    y_i = f(x_i) + d_i + e_i,   e_i ~ N(0, w_i),   d_i ~ N(0, tau^2)

w_i is the within-session variance of the session mean (pooled unit variance divided
by the number of units) and tau the session-to-session variation. f is a Gaussian
process on the mean-centred series with kernel

    k(i, j) = V^2 + V^2 (i - c)(j - c) + a^2 exp(-(i - j)^2 / (2 * 3^2)),

with c the mean index, V = 10 * tau_hat (vague level and drift) and a = 0.5 * tau
(a = 0 for the linear-only variant). tau is integrated over a 25-point log grid
under a log-normal prior centred on the learned tau_hat. The label is decided from
the posterior of the change Delta = f(x_last) - f(x_first).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.linalg import cho_factor, cho_solve
from scipy.special import logsumexp, ndtr

RBF_LENGTH = 3.0
SMOOTH_FRACTION = 0.5
VAGUE = 10.0
GRID_POINTS = 25
LOG_2PI = float(np.log(2.0 * np.pi))

RISING, NO_CLEAR_CHANGE, FALLING = 1, 0, -1


@dataclass(frozen=True)
class Variant:
    name: str
    log_sd: float
    min_sessions: int
    smooth: bool = True


VARIANTS: dict[str, Variant] = {
    "V1": Variant("V1", 0.5, 3, True),
    "V2": Variant("V2", 0.75, 3, True),
    "V3": Variant("V3", 0.5, 4, True),
    "V4": Variant("V4", 0.5, 3, False),
}


def _structure(n: int) -> tuple[np.ndarray, np.ndarray]:
    x = np.arange(n, dtype=float)
    centred = x - x.mean()
    level_drift = 1.0 + np.outer(centred, centred)
    rbf = np.exp(-np.subtract.outer(x, x) ** 2 / (2.0 * RBF_LENGTH**2))
    return level_drift, rbf


def trend_kernel(n: int, vague: float, amplitude: float) -> np.ndarray:
    """Prior covariance of f at the n session indices (before noise)."""
    level_drift, rbf = _structure(n)
    return vague**2 * level_drift + amplitude**2 * rbf


def tau_grid(tau_hat: float, log_sd: float) -> np.ndarray:
    return tau_hat * np.exp(np.linspace(-3.0 * log_sd, 3.0 * log_sd, GRID_POINTS))


def _log_prior(taus: np.ndarray, tau_hat: float, log_sd: float) -> np.ndarray:
    z = np.log(taus / tau_hat) / log_sd
    return -0.5 * z**2


def _change_vector(n: int) -> np.ndarray:
    a = np.zeros(n)
    a[0] = -1.0
    a[-1] = 1.0
    return a


def log_marginal_likelihood(y: np.ndarray, w: np.ndarray | float, tau: float,
                            vague: float, amplitude: float) -> float:
    """log N(y_c | 0, K_f + diag(w + tau^2)) for the mean-centred series."""
    y = np.asarray(y, dtype=float)
    n = y.size
    yc = y - y.mean()
    ky = trend_kernel(n, vague, amplitude) + np.diag(np.broadcast_to(w, (n,)) + tau**2)
    factor = cho_factor(ky, lower=True)
    alpha = cho_solve(factor, yc)
    logdet = 2.0 * np.sum(np.log(np.diag(factor[0])))
    return float(-0.5 * yc @ alpha - 0.5 * logdet - 0.5 * n * LOG_2PI)


def _amplitude(variant: Variant, tau: float) -> float:
    return SMOOTH_FRACTION * tau if variant.smooth else 0.0


def batch_posterior(values: np.ndarray, w: float, tau_hat: float,
                    variant: Variant) -> tuple[np.ndarray, np.ndarray]:
    """P(Delta > 0) and E[Delta] for many series sharing n and a constant w."""
    y = np.asarray(values, dtype=float)
    m, n = y.shape
    yc = y - y.mean(axis=1, keepdims=True)
    taus = tau_grid(tau_hat, variant.log_sd)
    log_prior = _log_prior(taus, tau_hat, variant.log_sd)
    vague = VAGUE * tau_hat
    a = _change_vector(n)
    loglik = np.empty((m, taus.size))
    mu = np.empty((m, taus.size))
    sd = np.empty(taus.size)
    for j, tau in enumerate(taus):
        kf = trend_kernel(n, vague, _amplitude(variant, tau))
        ky = kf + np.eye(n) * (w + tau**2)
        factor = cho_factor(ky, lower=True)
        kinv = cho_solve(factor, np.eye(n))
        logdet = 2.0 * np.sum(np.log(np.diag(factor[0])))
        loglik[:, j] = (-0.5 * np.einsum("ij,jk,ik->i", yc, kinv, yc)
                        - 0.5 * logdet - 0.5 * n * LOG_2PI)
        kf_a = kf @ a
        mu[:, j] = yc @ (kinv @ kf_a)
        sd[j] = np.sqrt(max(float(a @ kf_a - kf_a @ kinv @ kf_a), 1e-300))
    logw = loglik + log_prior[None, :]
    weights = np.exp(logw - logsumexp(logw, axis=1, keepdims=True))
    p_up = np.sum(weights * ndtr(mu / sd[None, :]), axis=1)
    mean_delta = np.sum(weights * mu, axis=1)
    return p_up, mean_delta


@dataclass
class SeriesPosterior:
    p_up: float
    mean_delta: float
    delta_low: float
    delta_high: float
    level_mean: np.ndarray
    level_low: np.ndarray
    level_high: np.ndarray
    tau_posterior_median: float


def _mixture_quantile(weights: np.ndarray, mu: np.ndarray, sd: np.ndarray, q: float) -> float:
    lo = float(np.min(mu - 10 * sd))
    hi = float(np.max(mu + 10 * sd))
    for _ in range(200):
        mid = 0.5 * (lo + hi)
        if float(np.sum(weights * ndtr((mid - mu) / sd))) < q:
            lo = mid
        else:
            hi = mid
    return 0.5 * (lo + hi)


def series_posterior(values: np.ndarray, w: np.ndarray, tau_hat: float,
                     variant: Variant) -> SeriesPosterior:
    """Full posterior for one series with per-session within variances w."""
    y = np.asarray(values, dtype=float)
    n = y.size
    w = np.broadcast_to(np.asarray(w, dtype=float), (n,))
    ybar = y.mean()
    yc = y - ybar
    taus = tau_grid(tau_hat, variant.log_sd)
    log_prior = _log_prior(taus, tau_hat, variant.log_sd)
    vague = VAGUE * tau_hat
    a = _change_vector(n)
    loglik = np.empty(taus.size)
    mu = np.empty(taus.size)
    sd = np.empty(taus.size)
    f_mean = np.empty((taus.size, n))
    f_var = np.empty((taus.size, n))
    for j, tau in enumerate(taus):
        kf = trend_kernel(n, vague, _amplitude(variant, tau))
        ky = kf + np.diag(w + tau**2)
        factor = cho_factor(ky, lower=True)
        alpha = cho_solve(factor, yc)
        logdet = 2.0 * np.sum(np.log(np.diag(factor[0])))
        loglik[j] = -0.5 * yc @ alpha - 0.5 * logdet - 0.5 * n * LOG_2PI
        f_mean[j] = kf @ alpha + ybar
        cov = kf - kf @ cho_solve(factor, kf)
        f_var[j] = np.clip(np.diag(cov), 0.0, None)
        mu[j] = a @ (kf @ alpha)
        sd[j] = np.sqrt(max(float(a @ cov @ a), 1e-300))
    logw = loglik + log_prior
    weights = np.exp(logw - logsumexp(logw))
    p_up = float(np.sum(weights * ndtr(mu / sd)))
    mean_delta = float(np.sum(weights * mu))
    level_mean = weights @ f_mean
    level_var = weights @ (f_var + f_mean**2) - level_mean**2
    level_sd = np.sqrt(np.clip(level_var, 0.0, None))
    cumulative = np.cumsum(weights)
    tau_median = float(taus[np.searchsorted(cumulative, 0.5)])
    return SeriesPosterior(
        p_up=p_up,
        mean_delta=mean_delta,
        delta_low=_mixture_quantile(weights, mu, sd, 0.025),
        delta_high=_mixture_quantile(weights, mu, sd, 0.975),
        level_mean=level_mean,
        level_low=level_mean - 1.96 * level_sd,
        level_high=level_mean + 1.96 * level_sd,
        tau_posterior_median=tau_median,
    )


def labels(p_up: np.ndarray, mean_delta: np.ndarray, n: int, p_star: float,
           delta_min: float, min_sessions: int) -> np.ndarray:
    """+1 Rising, -1 Falling, 0 No clear change (also used while collecting data)."""
    p_up = np.asarray(p_up, dtype=float)
    mean_delta = np.asarray(mean_delta, dtype=float)
    if n < min_sessions:
        return np.zeros(p_up.shape, dtype=int)
    rising = (p_up >= p_star) & (mean_delta >= delta_min)
    falling = ((1.0 - p_up) >= p_star) & (mean_delta <= -delta_min)
    return np.where(rising, RISING, np.where(falling, FALLING, NO_CLEAR_CHANGE))
