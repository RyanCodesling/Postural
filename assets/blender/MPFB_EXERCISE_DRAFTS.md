# Additional exercise animation drafts

Three editable animations reuse the clothed MPFB figure. These are presentation
drafts for review; timing and ranges are authored display choices, not patient
prescriptions or scoring calibration. They are not integrated into the app.
Assisted neck stretch (`ex_004`) and wall angels (`ex_008`) are on hold.
Deprecated exercises `ex_002` and `ex_003` are not included.

| Exercise | Editable source | Preview | Timeline |
| --- | --- | --- | --- |
| Standing Side Bends | [Blender source](ex_005_figure_mpfb.blend) | [MP4](previews/ex_005_mpfb/ex_005_figure_motion.mp4) | 360 frames / 12 s |
| Arm Abduction at 90 degrees | [Blender source](ex_006_figure_mpfb.blend) | [MP4](previews/ex_006_mpfb/ex_006_figure_motion.mp4) | 300 frames / 10 s |
| Overhead Shoulder Press | [Blender source](ex_007_figure_mpfb.blend) | [MP4](previews/ex_007_mpfb/ex_007_figure_motion.mp4) | 300 frames / 10 s |

All scenes use 30 fps and retain an editable 870 x 980 camera. Review videos
render at 522 x 588 with 24 EEVEE samples. The whole figure, including overhead
fingertips, stays below the title area. The body and garments retain their
original mesh coordinates and topology. The original lateral-raise scene and
video remain unchanged. Source provenance is in [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md).

## Motion and clothing

The active exercise definitions remain in [registry.ts](../../web/src/lib/exercises/registry.ts).

- Side bends alternate through a neutral standing position. The latest draft
  distributes a 42-degree driver across three spine controls, with about 24%
  more measured excursion than the preceding draft. The pelvis and feet stay
  planted, and the head keeps its neutral relation to the upper torso.
  Soft elbows let the forearms hang downward; the fingers are gently
  curled. Arm clearance changes through the bend to keep the hands clear of the
  shirt and shorts.
- The arm hold raises both arms, pauses at shoulder height, and lowers them.
  The accepted shoulder pose is retained. Forearms are straightened: the source
  had a depth bend concealed by the front view. The therapist sets the actual
  hold duration; the preview's pause is illustrative.
- The bodyweight press starts with folded arms and wrists level with the shoulders,
  with the upper arms lowered beside the torso. The fists travel along straight
  vertical lines and return along those lines. The press stops overhead with about
  15 degrees of elbow bend. Closed fists and straight wrists are retained throughout;
  finger hinge axes follow the palm geometry, and the thumbs sit outside the curled
  fingers. The arm solver targets each fist's center, including its offset from the
  wrist, and derives the elbow position from the arm lengths. Upper-arm twist eases
  through the raise to avoid pinching the shoulder surface. The ten-second loop
  accommodates the movement from the folded start. The top's upper-arm weights
  transfer to the same-side clavicle so the straps follow the shoulder rather than
  being dragged with the humerus. Body weights and garment coordinates are unchanged.

The `exercise_draft` scene property and adjacent JSON file describe the new
timeline, pose choices, camera fit and garment adjustment. In the revised side-bend
and press scenes, `figure_source_girdle_scale` records the inherited source preset;
the misleading inherited `figure_girdle_scale` property is removed and
`figure_hand_pose` describes the current hand pose. These are authoring metadata,
not clinical controls.
The rig has no scapula bone and does not model clinical shoulder rhythm.

Movement descriptions were checked against the registry and primary references:
[CUH spinal exercises](https://www.cuh.nhs.uk/patient-information/spinal-range-of-movementstretching-exercises/)
for a hand sliding beside the outer leg, and the arm-extension sequence in
[Gloucestershire Hospitals exercise guidance](https://www.gloshospitals.nhs.uk/your-visit/patient-information-leaflets/simple-exercises-encourage-weight-loss/)
for a shoulder-to-overhead movement. The latter is a seated, weighted example;
the existing registry supplies this draft's standing, bilateral bodyweight
context. Reference loads, repetitions and durations were not imported.

## Rebuild and review

Run from the repository root with Blender 5.1, ordinary Python with Pillow,
FFmpeg and FFprobe. Substitute installed executable paths when necessary.
Use fresh destinations: existing scenes and frame folders are never overwritten.

```powershell
blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/blender/build_mpfb_exercise_drafts.py -- `
  --source assets/blender/ex_001_figure_mpfb.blend `
  --output-dir assets/blender/previews/new_drafts

blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/blender/inspect_mpfb_exercise_draft.py -- `
  --source assets/blender/previews/new_drafts/ex_007_figure_mpfb.blend `
  --baseline assets/blender/ex_001_figure_mpfb.blend `
  --output assets/blender/previews/new_drafts/ex_007_inspection.json

blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/blender/render_mpfb_exercise_draft.py -- `
  --source assets/blender/previews/new_drafts/ex_007_figure_mpfb.blend `
  --output-dir assets/blender/previews/new_drafts/ex_007_frames

python tools/blender/encode_mpfb_exercise_draft.py `
  --frames-dir assets/blender/previews/new_drafts/ex_007_frames `
  --output assets/blender/previews/new_drafts/ex_007.mp4 `
  --qa-dir assets/blender/previews/new_drafts/ex_007_video_qa
```

Select one build with `--exercise ex_007`. Repeat inspection, rendering and
encoding for each exercise. Renderer options include `--frames 1 72 120` for press
checkpoints or `--scale 1 --samples 64` for full resolution. Encoder options
`--ffmpeg` and `--ffprobe` accept executable paths.

For a side-bend comparison, pass the inspector `--previous` with the prior saved
side-bend scene. This measures the old and new trunk excursion independently.
`--minimum-peak-increase` declares the required measured ratio for that comparison;
the latest revision uses `1.20` against its immediate predecessor. The default
`1.35` retains the original first-draft comparison. These are authoring checks,
not exercise targets.

## Verification

The independent inspector measures every animation frame. The revised side bend
passed all 360 frame checks. The straight-path press and unchanged arm hold retain
their earlier 300-frame verification. It checks the
evaluated body and clothing against the camera, neutral wrists, planted feet
and pelvis, joint movement between adjacent frames, phase text and closed
loops. It checks straight elbows throughout the arm hold, compares that hold's
shoulder pose with the source, and checks the press's folded start, shoulder-level
wrists, closed fingers and soft-elbow overhead finish. The revised press starts
within 0.001 mm of shoulder height at both wrists. Side-bend head/pelvis segment
excursion is 33.179 degrees to each side, up from 26.796 degrees in the preceding
draft (23.8% more); the forearms stay within 12 degrees of downward in the frontal
view. Head rotation relative to the upper spine remains unchanged throughout.
These are measurements of authored 3D poses, not scoring or clinical targets.
Each press fist's center is measured from its four finger-base joints. The inspector
requires a vertical path with less than 0.5 mm sideways/depth drift, a monotonic
rise and return, 14-16 degrees of elbow bend at the top, and at least 12 degrees
throughout the loop. Deliberately narrowing the camera, bending a wrist, shifting
a hand sideways and straightening a press elbow must be rejected. For side bends,
an added head rotation must also be rejected. These tolerances
check the authored animation; they do not define exercise prescriptions.
The saved straight-path press has less than 0.002 mm of measured fist-center drift
and approximately 15 degrees of minimum elbow bend throughout the loop.

The revised side bend was also measured through MediaPipe and the current app's
metric, filter, counter, warning and cue modules. The old and new renders were
both freshly extracted in the same environment, letterboxed to 1280 x 720.
The earlier render peaks at +14.8/-14.4 and produces zero reps; the revision
peaks at +18.5/-18.1 and produces one partial rep per side. The minimum remains
15 and target remains 25. These are the current pipeline's units, not anatomical
angles. The existing neck/shoulder coupled warnings still occur, despite the
unchanged head-to-torso orientation; this revision addresses rep-floor
compatibility, not that warning-fit issue. See
[side-bend validation](ex_005_depth_validation.json) for hashes, measurements and
runtime details. The replay uses a rendered avatar, a pre-captured neutral window
and synthetic 30 fps timestamps; it is not a live or clinical validation.

Each garment remains one connected surface, with four intended openings in the
top and three in the shorts. Every evaluated garment vertex is checked against
the body at eleven standard poses per animation. The revised side bend also
passes eight intermediate checks near the hand/waist interaction, for nineteen
sampled poses in total. Minimum sampled clearances:

| Exercise | Top | Shorts |
| --- | ---: | ---: |
| Side bends | 1.360 mm | 1.556 mm |
| Arm hold | 1.116 mm | 3.036 mm |
| Overhead press | 1.453 mm | 3.036 mm |

These are sampled vertex checks, not proof of continuous collision-free cloth
or clinical correctness. The garments follow the rig without cloth physics.
Rendered poses must also be reviewed, especially underarms, neckline and hands.
Finger compactness and curl checks do not prove absence of hand self-intersection;
the revised press was also reviewed in front and oblique fist close-ups.

The renderer reuses only bit-identical rig poses with identical visible text
and records every copied frame; these scenes have no simulation or temporal
effects. The encoder rejects partial sequences, decodes every video frame,
verifies dimensions/duration/fps and faststart metadata, and compares seven
decoded images with their source renders for colour changes. Reports and hashes
are stored beside the frames and decoded images. Blender files, renders and
videos are local ignored artifacts; scripts, JSON manifests and this document
can be versioned separately. See [MPFB_FIGURE.md](MPFB_FIGURE.md) for the source
figure's workflow.
