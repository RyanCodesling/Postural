"""
Generate a synthetic dataset for one exercise and write it to ml/data/.

Outputs (long format, so the feature extractor can also run unchanged on real
per-frame capture logs later):

  <ex>_frames.parquet    one row per frame: ids + primary + compensation channels
  <ex>_sets.parquet      one row per set:   session_id, set_index, target_reps
  <ex>_sessions.parquet  one row per session: session_id, subject_id, label

For isometric exercises target_reps carries the prescribed hold SECONDS per side
(there are no counted reps), and every hold row has rep_index = 1.

Labels are drawn per session (not per subject), so subject identity does not
predict the label and leave-one-subject-out evaluation is meaningful.

Run from the ml/ directory:
  python -m generators.ex_generator --exercise ex_001 --subjects 80 --sessions 3
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import numpy as np
import pandas as pd

# Allow `python generators/ex_generator.py` as well as `-m generators.ex_generator`.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from generators.base import sample_subject
from generators.framings import generate_session
from generators.registry import get_exercise

DATA_DIR = Path(__file__).resolve().parents[1] / "data"


def generate_dataset(
    exercise_id: str,
    *,
    n_subjects: int,
    sessions_per_subject: int,
    seed: int,
    out_dir: Path = DATA_DIR,
) -> dict[str, Path]:
    params = get_exercise(exercise_id)
    # Warning-only (scoring:off) metrics are not synthesized — see
    # ExerciseParams.scored_compensations.
    comp_metrics = tuple(c.name for c in params.scored_compensations)
    rng = np.random.default_rng(seed)

    fixed_cols = ("session_id", "subject_id", "label", "set_index", "side",
                  "rep_index", "frame", "primary")
    frame_chunks: dict[str, list[np.ndarray]] = {k: [] for k in fixed_cols + comp_metrics}
    set_rows: list[dict] = []
    session_rows: list[dict] = []

    session_id = 0
    for subject_id in range(n_subjects):
        subject = sample_subject(rng)
        for _ in range(sessions_per_subject):
            label = int(rng.integers(0, 2))
            sess = generate_session(
                params, subject=subject, subject_id=subject_id,
                session_id=session_id, label=label, rng=rng,
            )
            session_rows.append(
                {"session_id": session_id, "subject_id": subject_id, "label": label}
            )
            for set_index, target in sess.set_targets.items():
                set_rows.append(
                    {"session_id": session_id, "set_index": set_index, "target_reps": target}
                )
            for rep in sess.reps:
                n = rep.primary.size
                frame_chunks["session_id"].append(np.full(n, session_id, dtype=np.int32))
                frame_chunks["subject_id"].append(np.full(n, subject_id, dtype=np.int32))
                frame_chunks["label"].append(np.full(n, label, dtype=np.int8))
                frame_chunks["set_index"].append(np.full(n, rep.set_index, dtype=np.int16))
                frame_chunks["side"].append(np.full(n, rep.side, dtype=object))
                frame_chunks["rep_index"].append(np.full(n, rep.rep_index, dtype=np.int16))
                frame_chunks["frame"].append(np.arange(n, dtype=np.int16))
                frame_chunks["primary"].append(rep.primary)
                for m in comp_metrics:
                    frame_chunks[m].append(rep.channels[m])
            session_id += 1

    frames = pd.DataFrame({k: np.concatenate(v) for k, v in frame_chunks.items()})
    sets = pd.DataFrame(set_rows)
    sessions = pd.DataFrame(session_rows)

    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {
        "frames": out_dir / f"{exercise_id}_frames.parquet",
        "sets": out_dir / f"{exercise_id}_sets.parquet",
        "sessions": out_dir / f"{exercise_id}_sessions.parquet",
    }
    frames.to_parquet(paths["frames"], index=False)
    sets.to_parquet(paths["sets"], index=False)
    sessions.to_parquet(paths["sessions"], index=False)

    pos = int(sessions["label"].sum())
    print(
        f"{exercise_id}: {len(sessions)} sessions "
        f"({pos} compensated / {len(sessions) - pos} good) "
        f"from {n_subjects} subjects, {len(frames):,} frames -> {out_dir}"
    )
    return paths


def main() -> None:
    p = argparse.ArgumentParser(description="Generate synthetic data for one exercise.")
    p.add_argument("--exercise", default="ex_001")
    p.add_argument("--subjects", type=int, default=80)
    p.add_argument("--sessions", type=int, default=3, help="sessions per subject")
    p.add_argument("--seed", type=int, default=20260601)
    args = p.parse_args()
    generate_dataset(
        args.exercise,
        n_subjects=args.subjects,
        sessions_per_subject=args.sessions,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
