"""
Core synthetic-trajectory machinery shared by all exercise framings.

The unit of generation is a single repetition rendered as multi-channel
per-frame trajectories (the primary joint angle plus each compensation channel),
sampled at the capture frame rate. Realism rests on three ideas:

1. Subject latent factors (strength, baseline asymmetry, steadiness, fatigue
   susceptibility, tempo) shift the *distributions* of every rep a subject
   produces, so reps within a subject are correlated. This is what makes
   leave-one-subject-out evaluation meaningful.

2. A "compensated" session spreads a severity budget across several deviation
   channels (reduced ROM, trunk lean, scapular elevation, tempo distortion,
   jerk, asymmetry, within-set fatigue) via a per-session style mix. Because the
   budget is distributed differently each session, no single channel cleanly
   separates good from compensated form -- some compensated sessions hide in
   tempo/jerk while staying quiet on trunk/scap, which is exactly where a
   threshold-on-each-metric rule misses them.

3. Deliberate overlap: good reps occasionally dip or wobble, compensated reps at
   low severity look nearly clean. The label is a noisy multi-feature function,
   not a disguised threshold.

Channels carry the units the live system uses: angles in degrees; scapular
elevation as the baseline-corrected elevation delta in trunk-length units
(~0 at rest, positive = shrug), matching the post-baseline value the app feeds.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

FPS = 30  # capture frame rate (matches the minimum hardware target)

# Primary-motion deviation channels every exercise shares. Each exercise also gets
# one channel PER compensation metric it tracks (named by the metric), so the
# severity budget can land on rule-visible (trunk/scap/...) or rule-blind
# (tempo/jerk/rom/...) channels. `rom` stays first and the comp channels follow it
# so an exercise's channel order is stable regardless of how many comps it has.
BASE_PRIMARY_CHANNELS = ("tempo", "jerk", "asym", "fatigue")


def deviation_channels(comp_metrics: tuple[str, ...]) -> tuple[str, ...]:
    return ("rom",) + tuple(comp_metrics) + BASE_PRIMARY_CHANNELS


@dataclass(frozen=True)
class CompProfile:
    """How a compensation metric reads at rest vs. under severity (its own units)."""

    resting_sd: float   # natural/resting magnitude, as abs(N(0, sd))
    gain: float         # peak increase per unit of this metric's severity
    frame_noise: float  # per-frame additive measurement noise sd


# Units match the live metrics: degrees, except scapularElevation (trunk-length).
# Resting/gain are set so values overlap the rule's warning bands -- strong cases
# trip the bands, mild ones hide. Starting points; tuned per exercise during eval.
COMP_PROFILES: dict[str, CompProfile] = {
    "trunkLean":         CompProfile(resting_sd=1.7,   gain=16.0,  frame_noise=0.6),
    "shoulderSymmetry":  CompProfile(resting_sd=1.5,   gain=14.0,  frame_noise=0.6),
    "neckTilt":          CompProfile(resting_sd=2.0,   gain=16.0,  frame_noise=0.7),
    "scapularElevation": CompProfile(resting_sd=0.013, gain=0.12,  frame_noise=0.006),
}


@dataclass(frozen=True)
class SubjectLatents:
    """Per-subject factors that bias every rep this subject performs."""

    strength: float        # [0,1] achievable ROM and resistance to fatigue
    asymmetry: float        # signed L-vs-R ROM-fraction offset (+ = right stronger)
    steadiness: float       # [0,1] higher = less tremor / fewer submovements
    fatigue_suscept: float  # [0,1] how much later reps in a set degrade
    tempo_base: float       # baseline ascent duration in seconds


def sample_subject(rng: np.random.Generator) -> SubjectLatents:
    return SubjectLatents(
        strength=float(rng.beta(4.0, 2.0)),
        asymmetry=float(rng.normal(0.0, 0.06)),
        steadiness=float(rng.beta(4.0, 2.0)),
        fatigue_suscept=float(rng.beta(2.0, 4.0)),
        tempo_base=float(np.clip(rng.normal(1.1, 0.18), 0.6, 1.8)),
    )


def sample_session_severity(
    label: int, comp_metrics: tuple[str, ...], rng: np.random.Generator
) -> dict[str, float]:
    """
    Per-channel severity for a session, each value in roughly [0, ~0.6].

    An overall severity `delta` is drawn from class-conditional distributions
    that deliberately OVERLAP: good sessions are usually mild but occasionally
    show real issues, and compensated sessions reach down into that same range.
    The overlap (plus measurement noise) is what keeps the task from being
    perfectly separable -- a borderline session is genuinely ambiguous.

    `delta` is then split across this exercise's channels (rom + one per
    compensation metric + tempo/jerk/asym/fatigue) with a Dirichlet mix that sums
    to `delta` (not inflated), so a session "spends its budget" on a few channels
    rather than degrading uniformly. Because the budget often lands on channels
    the rule-based score can't see (tempo, jerk, ROM consistency, asymmetry,
    fatigue) rather than on the compensation metrics, the learned model has room
    to beat the rule instead of merely re-deriving it.
    """
    channels = deviation_channels(comp_metrics)
    if label == 0:
        delta = float(rng.beta(1.5, 6.0))            # mean ~0.2, tail into the overlap
    else:
        delta = float(0.22 + 0.60 * rng.beta(2.0, 2.2))  # ~0.22..0.82, overlaps good's tail
    # Concentration ~1 gives a lumpy-but-not-degenerate split across channels.
    mix = rng.dirichlet(np.full(len(channels), 0.8))
    return {c: float(delta * w) for c, w in zip(channels, mix)}


@dataclass
class RepResult:
    """One synthesized repetition: raw channels plus identifying metadata."""

    exercise_id: str
    subject_id: int
    session_id: int
    session_label: int
    set_index: int
    rep_index: int       # 1-based within the session
    side: str            # "left" | "right" | "bidirectional"
    severity: float      # total session severity (0 for good)
    fps: int
    # Per-frame channels, all the same length.
    primary: np.ndarray              # primary metric trajectory (e.g. degrees)
    channels: dict[str, np.ndarray] = field(default_factory=dict)  # compensation channels


def _ease(n: int) -> np.ndarray:
    """Smooth 0->1 ramp (raised cosine) of length n; empty-safe."""
    if n <= 1:
        return np.ones(max(n, 0))
    t = np.linspace(0.0, 1.0, n)
    return 0.5 - 0.5 * np.cos(np.pi * t)


def _bump(length: int, center_frac: float, width_frac: float) -> np.ndarray:
    """A 0..1 raised-cosine bump over `length` frames, used for compensation channels."""
    if length <= 0:
        return np.zeros(0)
    idx = np.arange(length)
    center = center_frac * (length - 1)
    width = max(width_frac * length, 1.0)
    z = (idx - center) / width
    return np.exp(-0.5 * z * z)


def synthesize_rep(
    *,
    exercise_id: str,
    subject_id: int,
    session_id: int,
    session_label: int,
    set_index: int,
    rep_index: int,
    side: str,
    subject: SubjectLatents,
    severity: dict[str, float],
    comp_metrics: tuple[str, ...],  # compensation channels to emit (registry-driven)
    target_rom: float,
    rep_pos_in_set: float,        # 0..1 position within the set (drives fatigue)
    side_sign: float,             # +1 right, -1 left (applies subject asymmetry)
    rng: np.random.Generator,
    meas_noise_deg: float = 1.2,  # per-frame measurement noise (MediaPipe ~3 deg p2p)
) -> RepResult:
    """Render one rep's primary + compensation channels from its target spec."""
    total_sev = float(sum(severity.values()))

    # --- Peak ROM (degrees) -------------------------------------------------
    # Coefficients are intentionally modest and the per-rep noise is sizeable so
    # good and compensated ROM distributions overlap. A weak (left) side loses
    # extra ROM under the asymmetry channel, which the rule score cannot see.
    base_frac = 0.93 + 0.10 * subject.strength            # capable subjects reach past target
    base_frac += side_sign * 0.5 * subject.asymmetry       # baseline L/R difference
    base_frac -= 0.55 * severity["rom"]                    # ROM-loss compensation
    base_frac -= 0.60 * severity["asym"] * max(0.0, -side_sign)  # weak-side ROM loss
    base_frac -= 1.20 * severity["fatigue"] * subject.fatigue_suscept * rep_pos_in_set
    base_frac += rng.normal(0.0, 0.07)                     # per-rep variation (overlap)
    peak = float(np.clip(base_frac * target_rom, 0.05 * target_rom, 1.35 * target_rom))

    # --- Tempo (seconds) ----------------------------------------------------
    ascent_s = subject.tempo_base * (1.0 - 0.35 * severity["tempo"]) * rng.uniform(0.9, 1.1)
    # Good form controls the lowering (eccentric >= concentric); tempo
    # compensation drops the arm faster, distorting the ratio.
    descent_s = ascent_s * (1.25 - 0.80 * severity["tempo"]) * rng.uniform(0.9, 1.1)
    hold_s = max(0.06, rng.uniform(0.12, 0.30) - 0.20 * severity["tempo"])
    ascent_s = float(np.clip(ascent_s, 0.3, 3.0))
    descent_s = float(np.clip(descent_s, 0.3, 3.0))

    n_asc = max(int(round(ascent_s * FPS)), 2)
    n_hold = max(int(round(hold_s * FPS)), 1)
    n_desc = max(int(round(descent_s * FPS)), 2)

    rest = float(rng.uniform(3.0, 8.0))  # apparent resting abduction from landmark noise
    asc = rest + (peak - rest) * _ease(n_asc)
    hold = np.full(n_hold, peak)
    desc = peak + (rest - peak) * _ease(n_desc)
    primary = np.concatenate([asc, hold, desc])
    n = primary.size

    # --- Jerk / submovements ------------------------------------------------
    # Poisson count of extra submovements; more when jerky and unsteady. Each is
    # a small position bump that creates a velocity reversal during the ascent.
    lam = 0.4 + 6.0 * severity["jerk"] + 1.0 * (1.0 - subject.steadiness)
    n_sub = int(rng.poisson(lam))
    for _ in range(n_sub):
        amp = rng.uniform(0.02, 0.06) * peak * (0.4 + severity["jerk"])
        center = rng.uniform(0.1, 0.9)
        primary = primary + amp * _bump(n, center, rng.uniform(0.03, 0.08))

    # --- Tremor + measurement noise ----------------------------------------
    tremor_sd = meas_noise_deg * (0.6 + 1.2 * (1.0 - subject.steadiness)) + 1.5 * severity["jerk"]
    primary = primary + rng.normal(0.0, tremor_sd, size=n)
    primary = primary + rng.normal(0.0, meas_noise_deg, size=n)

    # --- Compensation channels (peak near the top of the movement) ----------
    # One channel per metric the exercise tracks. Magnitudes overlap the
    # resting/natural range so the rule's warning bands catch strong cases but
    # miss mild ones -- where the learned model can win.
    bump = _bump(n, center_frac=n_asc / max(n, 1), width_frac=0.22)
    channels: dict[str, np.ndarray] = {}
    for metric in comp_metrics:
        prof = COMP_PROFILES[metric]
        peak_c = abs(rng.normal(0.0, prof.resting_sd)) + severity[metric] * prof.gain
        chan = peak_c * bump + rng.normal(0.0, prof.frame_noise, size=n)
        channels[metric] = chan.astype(np.float32)

    return RepResult(
        exercise_id=exercise_id,
        subject_id=subject_id,
        session_id=session_id,
        session_label=session_label,
        set_index=set_index,
        rep_index=rep_index,
        side=side,
        severity=total_sev,
        fps=FPS,
        primary=primary.astype(np.float32),
        channels=channels,
    )
