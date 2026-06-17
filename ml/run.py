"""
End-to-end driver for one exercise: generate -> extract -> train/evaluate.

Run from ml/ (with the venv active):
  python run.py --exercise ex_004
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from features.extract import (DATA_DIR, aggregate_session_features,
                              extract_rep_features, feature_columns)
from generators.ex_generator import generate_dataset
from training import train


def main() -> None:
    ap = argparse.ArgumentParser(description="Generate, extract, and train for one exercise.")
    ap.add_argument("--exercise", default="ex_001")
    ap.add_argument("--subjects", type=int, default=80)
    ap.add_argument("--sessions", type=int, default=3, help="sessions per subject")
    ap.add_argument("--seed", type=int, default=20260601)
    args = ap.parse_args()
    ex = args.exercise

    print("[1/3] generating synthetic data ...")
    generate_dataset(ex, n_subjects=args.subjects,
                     sessions_per_subject=args.sessions, seed=args.seed)

    print("[2/3] extracting features ...")
    frames = pd.read_parquet(DATA_DIR / f"{ex}_frames.parquet")
    sets = pd.read_parquet(DATA_DIR / f"{ex}_sets.parquet")
    sessions = pd.read_parquet(DATA_DIR / f"{ex}_sessions.parquet")
    rep = extract_rep_features(frames, ex)
    sess = aggregate_session_features(rep, sets, sessions, ex)
    rep.to_parquet(DATA_DIR / f"{ex}_rep_features.parquet", index=False)
    sess.to_parquet(DATA_DIR / f"{ex}_session_features.parquet", index=False)
    print(f"      {len(rep):,} reps -> {len(sess)} sessions, "
          f"{len(feature_columns(sess))} session features")

    print("[3/3] training + evaluating ...\n")
    train.main(exercise=ex)


if __name__ == "__main__":
    main()
