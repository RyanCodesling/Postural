"""Pose-backend comparison harness.

Measures the clinical-metric noise floor and processing speed of several pose
backends on identical recorded frames, for the two precision-sensitive
exercises (shoulder shrugs and neck lateral flexion). Reuses the existing
feature/noise tooling by emitting angle trajectories in the same schema the
synthetic pipeline produces. Does not touch the form-quality model.
"""
