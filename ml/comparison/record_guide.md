# Recording guide — pose-backend comparison clips

> **Historical protocol only — do not use for new current-study recordings.**
> This guide reproduces the June 9 exploratory comparison. `ex_003` is now
> deprecated, and the `ex_004` instructions below describe its former unassisted
> dynamic movement, not the active assisted side-split isometric hold. Any renewed
> benchmark requires a new active-exercise question, a frozen current protocol,
> and updated processing/segmentation code.

These are short clips of **yourself** performing two exercises, used only to
benchmark pose backends offline. They stay on your machine (the `clips/` folder
is gitignored) and are **not** part of the deployed system — this does not change
the "no video leaves the device / log metrics only" stance of the live app.

## Camera setup (match the system's capture spec)

- Single front-facing webcam, **720p or better, 30 fps**.
- **2–3 m** from the camera, lens at roughly **chest height**, level (not tilted).
- Even, frontal lighting; plain background; snug top (loose fabric on the
  shoulders adds landmark noise).
- **Your hips must be in frame** along with head and shoulders — the tilt
  reference needs the hip line. Stand so head-to-hips are all visible.
- One person in frame. Landscape orientation. Save as `.mp4` (H.264 is ideal).

## What to record

Four clips per exercise. Keep the same position and lighting across an
exercise's clips so only the movement differs.

### ex_003 — Shoulder Shrugs (deprecated historical clip)

| Clip | Length | What to do |
|------|--------|------------|
| `static_hold.mp4` | ~30 s | Stand relaxed, arms at sides, shoulders **down and still**. Do **not** shrug. This is the pure noise floor. |
| `slow_reps.mp4` | ~10 reps | Shrug **both** shoulders straight up toward the ears, hold ~1 s, lower **fully**. ~5 s per rep. |
| `normal_reps.mp4` | ~10 reps | Same shrug at a natural pace. |
| `compensated.mp4` | ~10 reps | *(optional, recommended)* Deliberately poor form: partial/uneven shrugs, jerky tempo, head poking forward. |

### ex_004 — Neck Lateral Flexion (pre-conversion historical dynamic clip)

| Clip | Length | What to do |
|------|--------|------------|
| `static_hold.mp4` | ~30 s | Head **straight and still**, looking at the camera. This measures the ear-line noise floor. |
| `slow_reps.mp4` | ~10 reps | Tilt your head sideways toward one shoulder, return to center, then the other side — **alternating**. ~5 s per rep. Keep shoulders level. |
| `normal_reps.mp4` | ~10 reps | Same alternating side-bends at a natural pace. |
| `compensated.mp4` | ~10 reps | *(optional, recommended)* Hike the shoulder up to meet the head, or lean the trunk, instead of a clean neck bend. |

## Folder layout

Put the files exactly here (the processing script looks for these names):

```
comparison/clips/
  ex_003/
    static_hold.mp4
    slow_reps.mp4
    normal_reps.mp4
    compensated.mp4        # optional
  ex_004/
    static_hold.mp4
    slow_reps.mp4
    normal_reps.mp4
    compensated.mp4        # optional
```

## Tips

- A single continuous take per clip is fine — no editing needed.
- Start and end each rep clip from the resting position.
- If a clip looks shaky or you drift out of frame, just re-record it; consistency
  matters more than polish.
- Any recorder works (the OS Camera app, OBS, a phone on a tripod).
