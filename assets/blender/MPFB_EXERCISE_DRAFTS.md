# Additional exercise animation drafts

Five editable animations reuse the clothed MPFB figure. These are presentation
drafts for review; timing and ranges are authored display choices, not patient
prescriptions or scoring calibration. The side-bend, arm-hold, overhead-press and
wall-angels MP4s play in the camera page's Reference Guide as low-priority,
illustrative guides: each is copied unmodified into the gitignored
`web/public/demos/` folder and shown through the same crop as the lateral-raise
guide, set in `web/src/lib/exercises/demoClips.ts`. The neck exercise (`ex_004`)
is now active alternating neck tilts rather than the assisted stretch. Its
animation, the neck side bends, follows that version. Since 2026-10-11 it also
plays in the Reference Guide, by user decision ahead of the multi-person neck
counting test, as the resting-hand revision described in
[MPFB_PRESENTATION.md](MPFB_PRESENTATION.md). Deprecated exercises `ex_002` and
`ex_003` are not included.

| Exercise | Editable source | Preview | Timeline |
| --- | --- | --- | --- |
| Neck Side Bends | [Blender source](previews/neck_side_bends_2026_10_07/swing_40bpm_v2/ex_004_figure_mpfb.blend) | [MP4](previews/neck_side_bends_2026_10_07/swing_40bpm_v2/ex_004_mpfb/ex_004_figure_motion.mp4) | 270 frames / 9 s: three cycles of a 40 BPM swing |
| Standing Side Bends | [Blender source](ex_005_figure_mpfb.blend) | [MP4](previews/ex_005_mpfb/ex_005_figure_motion.mp4) | 360 frames / 12 s |
| Arm Abduction at 90 degrees | [Blender source](ex_006_figure_mpfb.blend) | [MP4](previews/ex_006_mpfb/ex_006_figure_motion.mp4) | 300 frames / 10 s |
| Overhead Shoulder Press | [Blender source](ex_007_figure_mpfb.blend) | [MP4](previews/ex_007_mpfb/ex_007_figure_motion.mp4) | 300 frames / 10 s |
| Wall Angels | [Blender source](ex_008_figure_mpfb.blend) | [MP4](previews/ex_008_mpfb/ex_008_figure_motion.mp4) | 468 frames / 15.6 s: one repetition from the front, one from the side |

All scenes use 30 fps and retain an editable 870 x 980 camera. Review videos
render at 522 x 588 with 24 EEVEE samples. The arm hold, overhead press and wall
angels play in the Reference Guide as full-size re-renders in the upgraded look
(see [MPFB_FIGURE.md](MPFB_FIGURE.md#upgraded-presentation-look)). Those are
870 x 980 at 64 samples, rebuilt by this builder from the upgraded figure into
`previews/slate_2026_09_25/`, with the same motion and the same checks passed.
Since 2026-10-11 the guide's overhead press is instead the deep-start revision
in `previews/press_depth_hands_2026_10_11/` (see [MPFB_PRESENTATION.md](MPFB_PRESENTATION.md));
the slate press remains archived.
The side bend plays a one-sided version at the same size and look, rebuilt by
this builder from the upgraded figure into `previews/side_bend_one_side_2026_09_25/`:
180 frames (6 s), one bend per loop. The table's 360-frame alternating side bend
remains the archived earlier draft. The neck side bends were built by this
builder from the upgraded figure and rendered at full size, as a 40 BPM swing
in `previews/neck_side_bends_2026_10_07/swing_40bpm_v2/`. Three earlier neck
drafts remain beside it: the first, with pauses at each side and at the centre;
a faster 50 BPM swing in `continuous_50bpm/`; and the 40 BPM swing in
`swing_40bpm/`, whose far shoulder visibly rose with the tilt (see below). The whole figure, including overhead
fingertips, stays below the title area. The body and garments retain their
original mesh coordinates and topology. The original lateral-raise scene and
video remain unchanged. Source provenance is in [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md).

## Motion and clothing

The active exercise definitions remain in [registry.ts](../../web/src/lib/exercises/registry.ts).

- Neck side bends swing the head ear toward shoulder from side to side, by user
  direction at 40 beats per minute, like a metronome's pendulum. The head
  arrives at one side on each beat (every 1.5 s), first the figure's left, and
  holds there for 8 frames (0.27 s). It then eases across to the other side in
  the rest of the beat, fastest through the centre, and never stops there. The
  user asked for a hold of about 0.3 s; at 45 frames per beat a 9-frame hold
  would put the centre between two frames. Each arrival at a side is one bend,
  as the app counts this exercise (one count per side). The clip holds three
  whole cycles (9 s) and starts at the centre, so its loop is seamless. Each
  side is 35 degrees of head tilt relative to the
  trunk, a display choice rather than a measured or prescribed range. Of that, 0.65 turns at the base of
  the neck and the rest at the head, both about the camera's axis, so the head
  moves only in the frontal plane and the face keeps looking forward. The head's
  skin weights reach down the neck, and a larger head share kinks the neck under
  the jaw instead of bending it. The trunk, shoulders and arms hold the source's
  first-frame pose throughout, so the shoulders stay level and still. The
  figure's neck weights also reached across the top of the shoulders, so
  bending the neck lifted the far shoulder's skin by about 12 mm and lowered
  the near one's, although no shoulder bone moved; the user saw it as an
  uncanny shoulder rise. The builder therefore fades the neck bone's weight
  out between 5 and 8 cm from the midline, handing it to the upper-spine bone,
  which does not move. This changes only the built scene's copy of the body and
  top weights (584 and 126 vertices), keeps each vertex's weight sum, and leaves
  the neutral pose's skin where it was.
- Side bends distribute a 42-degree driver across three spine controls, with
  about 24% more measured excursion than the draft before them. The pelvis and
  feet stay planted, and the head keeps its neutral relation to the upper torso.
  By user direction on 2026-09-25, the version in the Reference Guide bends to
  one side only, so that it does not suggest alternating. The trunk bends
  toward the figure's left, and the left arm hangs under gravity with a soft
  elbow. The right hand rests on the right hip from the first frame to the last:
  palm on the waist, fingers forward along it, thumb laid back, elbow out.
  The builder places that hand against the rendered garments. The palm faces
  the waist's mean surface normal over the hand's footprint. Its distance out
  is solved at five bend shares, so the nearest hand or forearm skin stays
  2 mm outside the clothing while the waist moves with the trunk. The earlier
  alternating draft in the table hangs both arms instead.
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
- Wall angels stand the figure against a wall object placed 3 mm behind its
  rearmost garment point, feet about 75 mm out. Both arms slide in the wall's
  plane from a W (upper arms 60 degrees from the sides, elbows 90 degrees) up to a
  Y (140 degrees, straight elbows) and back; the elbows straighten slightly ahead
  of the rise, and each elbow is a pure hinge whose axis faces the camera, so the
  palms face forward. As physiotherapy guides describe, the upper back and the
  back of the head rest against the wall: a small thoracic extension and a chin
  tuck, solved to a 5 mm gap, put them there. One arm lean per slide position is
  solved so the nearest arm or hand skin sits 6 mm from the wall. The girdle
  rises to the press's 22 degrees with a constant 15-degree retraction, and the
  press's clavicle reweighting of the top is reused. The W is lower than a 90/90
  goal post on purpose: the app re-arms its counter below 70 on this metric. The
  clip shows one repetition from the front and the next from a side camera; the
  view switches at the rest through camera-bound timeline markers, each camera
  carries its own labels, and a room-corner wall closes the side view's
  background. Short rests keep the loop at 15.6 s; the slides keep the press's
  95-frame pace.

The `exercise_draft` scene property and adjacent JSON file describe the new
timeline, pose choices, camera fit and garment adjustment. In the revised side-bend
and press scenes, `figure_source_girdle_scale` records the inherited source preset;
the misleading inherited `figure_girdle_scale` property is removed and
`figure_hand_pose` describes the current hand pose. These are authoring metadata,
not clinical controls.
The rig has no scapula bone and does not model clinical shoulder rhythm.

Movement descriptions were checked against the registry and primary references:
[CUH spinal exercises](https://www.cuh.nhs.uk/patient-information/spinal-range-of-movementstretching-exercises/)
for a hand sliding beside the outer leg (the one-sided version's hand on the
hip follows the user's direction rather than that reference), and the arm-extension sequence in
[Gloucestershire Hospitals exercise guidance](https://www.gloshospitals.nhs.uk/your-visit/patient-information-leaflets/simple-exercises-encourage-weight-loss/)
for a shoulder-to-overhead movement. The latter is a seated, weighted example;
the existing registry supplies this draft's standing, bilateral bodyweight
context. The CUH page also describes the neck side bend: the ear tilts toward
the shoulder, sitting or standing. It presents that as a stretch; the neck
draft's active repetitions to each side follow the registry instead. Reference
loads, repetitions and durations were not imported.

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

The one-sided side bend passed all 180 frame checks. The trunk bends from 0 to
33.18 degrees toward the hanging arm and never the other way (the inspector
requires at least 24 degrees and allows 0.1 degrees back). The hanging forearm
stays within 9.9 degrees of downward, with a neutral wrist. On every frame the
hip hand's nearest skin sits 1.8 to 2.4 mm from the clothing (the inspector
allows up to 10 mm). No hand or forearm skin passes into the garments on any
frame; hand skin is chosen by its bone weights, and a point beside an open hem
counts at its plain distance. Joints move at most 14.9 mm between frames. The
resting wrist bends up to 80 degrees, as a hand on the hip needs. Bending the
hanging wrist, narrowing the camera and adding head rotation must be rejected.

The neck side bends passed all 270 frame checks. The inspector measures the
tilt as the head's rotation about the camera's axis since the first frame,
which is level. The head reaches 35.00 degrees to each side and holds there for
exactly 8 frames, six times, alternating and starting with the figure's left.
The holds begin every 45 frames (1.5 s, 40 beats per minute). Between holds the
head never stops: the only frames without movement are the 42 inside the holds,
and it changes direction only at them. The swing is fastest through the centre,
about 87 degrees per second. The clip holds whole cycles, and the loop's seam
(10.8 mm at the fastest joint) equals the step from the first cycle into the
second. At both sides 0.65 of the tilt is at the base of the neck, as declared.
What remains of the head's rotation once the tilt is taken out (a turn or a
nod) is at most 0.00002 degrees, and no bone below the neck moves at all.
Still bones do not guarantee still skin, so the inspector also follows the
rendered skin that forms the top 2 cm of each shoulder's outline at rest, 8 to
17 cm from the midline (34 vertices a side). It allows 2 mm of movement either
way. It measures -0.2 to +0.4 mm on each side; on the earlier 40 BPM draft,
before the neck weights were faded, it measured -11.0 to +12.1 mm and failed.
Joints move at most 10.8 mm between frames; the feet and pelvis do not move,
and both wrists stay neutral. A 10-degree head turn, a 5-degree shrug of one
shoulder, a 3-degree trunk lean and a 5-degree rise of the far shoulder at the
held tilt must each be rejected, as must a narrowed camera and a bent wrist.

The saved wall-angel scene passed all 468 frame checks. The W measures 60.0 degrees
with 90.0-degree elbows and the Y 140.0 degrees with straight elbows; once the upper
arm passes 120 degrees the elbows stay at or above 162.4 degrees. No body or garment
point comes within 3.0 mm of the wall. Each arm's nearest skin sits about 6 mm from
it at the W, mid-slide and Y; each side is checked separately. The upper back sits
5.9 mm from the wall and the head 5.0 mm, and the palms stay within 9 degrees of
facing forward. That nearest skin is not everywhere wall-angel guides ask for
contact. The inspector also reports each side's skin within 35 mm of the elbow,
wrist and middle knuckle. At the W the elbows sit 9.9 mm off the wall, the wrists
20.2 mm and the knuckles 24.9 mm; at the Y they sit 15.4, 8.1 and 7.0 mm. A 30 mm
limit on these guards against regression and does not claim contact. The inspector
also confirms that the front and side views alternate at frame 235, that the side
repetition repeats the front one exactly, and that the figure stays inside the
framing limits in both views. It must reject three changes: the wall pushed 20 mm
into the figure, an elbow bent at the top, and one whole arm carried about 50 mm
off the wall while the other stays.

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

The one-sided side bend was replayed the same way. The pose model found the
figure in all 180 frames and capture readiness passed on each. It counts one
partial repetition to the left, peaking at 18.8 against the minimum of 15, as
the alternating draft's left bend did. The coupled neck-tilt warning latches on
171 of 180 frames, as before. The shoulder-elevation warning latches on 106
frames (59%), against 35% for the arms-down draft, because the hand on the hip
moves that shoulder's landmark. A latched warning is not a displayed cue: the
camera page shows one cue at a time, chosen on its 150 ms tick by priority, and
the neck cue outranks the shoulder cue. Replayed with that cadence and selector,
the neck cue is shown on 145 of 180 frames and the shoulder cue on none, as with
the arms-down draft (325 of 360, and none). The asymmetric neutral pose also
lowers the frozen camera tilt estimate to 3.7 degrees at low confidence; the
counted peak is unchanged, because the side bend measures from its own neutral
baseline.

The wall-angel clip's front repetition was replayed the same way, following the
camera page's per-limb path (per-side smoothing, counters and warning signals,
and the near-peak gate). The pose model found the figure in all 234 frames and
capture readiness passed on each. The W reads 44.8-52.1 in the pipeline's units,
under the 70 re-arm threshold. The top peaks at 154.1 and 154.4 against the 150
target, so each side counts one complete repetition. Across the 87 frames near the
top, the lowest elbow reading is 161.6 against the 150 warning, trunk lean stays
at or under 0.3 against 5, and no warning latches. The side repetition is a
demonstration angle only; a patient's front camera does not measure it.

The neck swing's 270 full-size frames were replayed through the current camera
loop itself: its metrics, filters, per-side counters, cue checks and cue
drawing, with capture readiness assumed to pass. The pose model found the
figure in every frame. The swing never rests, so the frozen camera tilt came
from the first neck draft's still Ready frames (the same figure and camera), as
the camera's neutral calibration takes it. It read 1.9 degrees although the
render camera is level. The clip was played three times in a row, plus the next
loop's first 18 frames, at each of the four 150 ms coaching-tick alignments. It
counts 9 bends to each side, all complete: one per side per cycle. A bend is
counted as the head comes back past the centre, so the tail is needed to close
the last right bend. The peaks read 41.8-42.1 to the left and 49.8-50.1 to the
right in the pipeline's units, against the 30 target. The tilt estimate
explains about half of that difference: with the level camera's true tilt of
zero, the raw peaks read 45.0 and 48.5. No cue is drawn. Trunk lean reads
1.8-2.6 throughout, under the cue's switch-on level of 6. The shoulder-level
reading is 0.0-1.2 near the centre and reaches 4.5 while the head is tilted,
under its switch-on level of 7. The skin's outline stays level, so that rise
comes from the pose model, whose shoulder points shift as the head tilts.
Before the neck weights were faded, the same replay read up to 5.7: the rising
skin had added about 1.2. The earlier neck drafts, replayed the same way, also
counted one complete bend per side per cycle and drew no cue. This uses a
rendered avatar and synthetic 30 fps timestamps; it is not a live or clinical
validation.

The neck swing was also checked against the Reference Guide's shared crop in
the same way as the other clips, in three 90-frame segments. Every frame fits
the crop with at least 40 px above the hair, 54 px below the feet and 254 px at
the sides. The only changed pixels outside the crop are the baked caption's
descenders above the crop's top edge.

Each garment remains one connected surface, with four intended openings in the
top and three in the shorts. Every evaluated garment vertex is checked against
the body at eleven standard poses per animation. The alternating side-bend draft
also passed eight intermediate checks near the hand/waist interaction, for
nineteen sampled poses in total. Minimum sampled clearances:

| Exercise | Top | Shorts |
| --- | ---: | ---: |
| Neck side bends | 1.973 mm | 3.036 mm |
| Side bends, alternating draft | 1.360 mm | 1.556 mm |
| Side bend, one-sided | 1.623 mm | 2.227 mm |
| Arm hold | 1.116 mm | 3.036 mm |
| Overhead press | 1.453 mm | 3.036 mm |
| Wall angels | 1.056 mm | 3.027 mm |

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
