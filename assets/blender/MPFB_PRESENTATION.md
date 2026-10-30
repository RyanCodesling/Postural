# Figure presentation and Reference Guide controls

The guide player supports full-body and optional detail framing, synchronized
movement labels, front/side labels, pause, half speed and full screen. These
are presentation controls. They do not change exercise definitions, scoring,
prescriptions or recorded session values. The default crop remains
`x=43, y=108, w=784, h=847` within an `870 x 980` frame.

`web/src/lib/exercises/demoClips.ts` holds each accepted video's frame-based
phase/view boundaries and detail crop. `DemoClipPlayer.tsx` reads decoded media
time, so labels follow pauses, speed changes, seeks and loop restarts. The same
video element stays mounted across framing and full-screen changes. A missing
media file still uses the camera page's existing no-video fallback. The videos
remain ignored local assets.

## Appearance candidates

The separately saved `previews/presentation_2026_10_09/` scenes add restrained
brown-eye detail and subtle rest-space skin colour variation to the accepted
slate figure. Wall angels also receive a broader key light and softer fill;
both authored cameras and wall contact stay fixed. These are candidates, not
replacement canonical clips. Replacing an accepted clip requires visual
acceptance of that render and a complete shared-crop check.

The input scenes are the accepted slate renders for `ex_001`, `ex_006`,
`ex_007` and `ex_008`, the accepted one-sided `ex_005` scene, and the corrected
`neck_side_bends_2026_10_07/swing_40bpm_v2` neck scene. The neck candidate
stayed outside the guide; a later neck revision joined it on 2026-10-11 (see
the last section). The side bend stays one-sided with one hand on the hip. The lateral
raise's girdle scale remains `0.475`.

Example authoring command, after verifying the installed CC0 assets:

```text
blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python tools/blender/polish_mpfb_presentation.py -- \
  --source <accepted-scene.blend> --output <fresh-candidate.blend> \
  --eyes-dir <installed-mpfb-data/eyes>
```

The builder checks all original mesh coordinates and vertex-group weights,
every frame's rig pose, and the girdle setting before saving. Its adjacent
`.presentation.json` records source/output hashes, asset hashes, material and
lighting settings, and the preserved motion digest. It never overwrites a
source or an existing output. The eyes use the existing MakeHuman body vertex
bindings and follow the head bone. Skin variation is baked to rest vertices
so the colour does not slide over the skin during movement.

Render and encode into fresh destinations:

```text
blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python tools/blender/render_mpfb_exercise_draft.py -- \
  --source <candidate.blend> --output-dir <fresh-frames> \
  --samples 32 --scale 1 --hide-phase-labels
python tools/blender/encode_mpfb_exercise_draft.py \
  --frames-dir <fresh-frames> --output <candidate.mp4> \
  --qa-dir <fresh-qa> --ffmpeg <ffmpeg> --ffprobe <ffprobe>
```

`--hide-phase-labels` removes only the in-memory baked phase text when the
player supplies those labels. It never saves the scene, and omitting the flag
retains the old renderer behavior. Titles and captions remain. Frame reuse
requires bit-identical rig matrices, camera identity and remaining visible
text; copied frames are listed in the render manifest. Encoding checks the
complete timeline, dimensions, 30 fps, faststart, full decoding, and colour
readback against source frames. Rendering and encoding do not promote media
into `web/public/demos`.

The candidates use 32 EEVEE samples at the full `870 x 980` resolution. Three
neck checkpoints compared with 64 samples had mean absolute RGB differences
of 0.171-0.178 on the 0-255 scale and PSNR of 54.79-54.96 dB. Those sampled
comparisons do not establish quality over every exercise; decoded motion and
shared framing still need review for each finished clip.

### Verification completed 2026-10-10

All six candidates are encoded: 1,728 frames, 57.6 seconds in total. Every
decoded frame passed the shared-crop check; the tightest margin is the lateral
raise's existing 6 pixels above the hair. The wall side view was checked
against a matching clean background plate. All original mesh coordinates,
weights, transforms, camera parameters/markers, bone motion and timelines were
independently compared with the input scenes and matched.

The guide's 12 tests, TypeScript check and zero-warning lint check passed.
Browser checks covered actual playback, phase/view timing, framing and
full-screen continuity, keyboard focus/Escape, half speed and narrow widths.
All six candidate videos also loaded and played in the review page. See the
[validation record](reference/presentation_2026_10_09_validation.json) for
candidate hashes, crop margins, encoding checks and evidence limits. These
checks do not replace visual acceptance or the neck exercise's separate gate.

## Arm and hand refinements, 2026-10-11

The resting-arm candidates are separate scenes in
`previews/resting_arms_2026_10_11/`; the press-depth and resting-hand
candidates below replace them for review. The user clarified that relaxed neck-demo
hands mean **arms hanging at the sides** and that the press's starting
forearms must also be vertical.

`neck_v2/ex_004_figure_mpfb.blend` keeps both arms beside the body, with soft
elbows, inward-facing palms and loosely curved fingers. A slight outward
forearm angle lets the fingertips clear the shorts. The arms remain still;
the corrected neck weights, head movement and continuous 40-beat-per-minute
swing are retained.

`ex_007_figure_mpfb.blend` starts with vertical forearms and wrists directly
over elbows. Forearms remain vertical during the lift. At the top, the upper
arms are also vertical, the elbows are straight, and the wrists are directly
above the shoulders. The checked overhead pose from `press_v8_vertical` is
preserved, including its shoulder roll that reduces collar pinching. The
upper arms start modestly anterior to the frontal plane and 20 degrees below
horizontal; the hands now start above shoulder height. The 10-second timing,
meshes and skin weights are unchanged.

The earlier hands-on-hips neck candidate and press trials in
`previews/form_2026_10_10/` are retained as superseded previews. This includes
the straight but outward-angled `press_v4_straight` and the vertical-finish
`press_v8_vertical`, whose starting forearms still spread outward.

The distinction between upper-arm plane and forearm tilt matters: overhead
presses need not place the entire arm exactly in the frontal plane. See
[ACE's shoulder mechanics guide](https://www.acefitness.org/continuing-education/certified/september-2025/8951/a-pro-s-guide-to-muscle-mechanics-the-shoulders/)
for its discussion of the scapular plane. These authored poses are illustrative
choices, not clinical target angles or a model of scapulohumeral rhythm.

`tools/blender/refine_mpfb_form.py` builds fresh scenes from the appearance
candidates. It preserves mesh coordinates and weights, camera and timing, and
checks every frame's bones outside the arm/hand controls. The scene's
`form_refinement_note` and adjacent `.form.json` describe the current pose;
the inherited `exercise_draft` metadata documents the older motion source.

```text
blender --background --factory-startup --disable-autoexec --python-exit-code 1 \
  --python tools/blender/refine_mpfb_form.py -- \
  --exercise ex_007 --source <presentation-candidate.blend> \
  --output <fresh-form-candidate.blend> \
  --press-finish-source assets/blender/previews/form_2026_10_10/press_v8_vertical/ex_007_figure_mpfb.blend
```

Use `--exercise ex_004 --neck-rest sides` without `--press-finish-source` for
the neck revision, and add `--press-start raised` to the press command above to
rebuild this press; both are no longer the defaults. `--neck-rest hips` remains
available for the older pose. The same render/encode commands above apply. These
candidates still require visual acceptance before replacing the current guide
clips, and the neck draft retains its separate counting gate.

The [original form validation record](reference/form_2026_10_10_validation.json)
records the superseded hands-on-hips neck candidate and straight-arm press.
The [vertical press validation record](reference/vertical_press_2026_10_10_validation.json)
records the earlier vertical finish, alignment, motion continuity, garment
clearance, media hashes and full-frame crop checks. The installed Blender MCP
bridge was also used for front and angled viewport inspection of the shoulder
at the start, middle and top; external asset integrations stayed disabled.

The [resting-arm validation record](reference/resting_arms_2026_10_11_validation.json)
records this pair. All 570 frames pass the saved-pose, garment and
decoded shared-crop checks. The press retains its checked overhead pose and
keeps the wrists over the elbows from the start. The neck hands clear the
garments by at least 9.18 mm. Both videos pass full decoding, colour readback
and browser playback checks; rendered storyboards and front/angled Blender
MCP views were inspected. These checks support local review and do not promote
the candidates or replace the neck counting gate.

## Press depth and resting hands, later 2026-10-11

The accepted press and neck renders are in `previews/press_depth_hands_2026_10_11/`.
The user asked for a deeper press start, with the hands slightly above the
shoulders in line with the neck, and found the resting-arm neck hands
unnatural.

`ex_007_figure_mpfb.blend` starts with the fists beside the neck: the wrists
15 mm above the shoulder joints and the elbows bent 144 degrees, in a plane
turned 20 degrees forward of the frontal plane. This figure's forearm and fist
reach about 335 mm from the elbow against a 242 mm upper arm, so upright
forearms could reach this depth only with the elbows folded past about
150 degrees. The starting forearms therefore lean about 11 degrees from
vertical, mostly outward. The lift and the checked `press_v8_vertical` finish
are otherwise unchanged.

The start also decides whether the press counter can re-arm: it completes a
repetition only when the wrist returns below 0.05 trunk lengths above the
shoulder. With the rendered frames run through the pose model and the camera
page's processing loop, the resting-arm press started at 0.29-0.34 and was
never counted. This start reads -0.002 to 0.014 and counts one complete
repetition per side per loop, with no coaching message. A first build with the
wrists 25 mm up also counted but read up to 0.047 on one side; it is kept in
`trial_wrist25mm/`.

`ex_004_figure_mpfb.blend` hangs both arms close to the body: upper arms
9 degrees out and 3 degrees forward, soft elbows, and forearms angled out just
far enough to keep the hands 4 mm outside the shorts. The palms face the
thighs, turned 15 degrees back. The fingers curve in a soft cascade, more
toward the little finger, and the thumbs lie along the index fingers. The
earlier open hand kept the rig's rest thumb, which stood away from the palm and
pointed into the thigh. The neck swing, timing and corrected weights are
unchanged; in the same replay the clip still counts 9 bends a side with no
coaching message.

`--press-start deep` and `--neck-rest relaxed` are the builder's defaults now;
`--press-start raised` and `--neck-rest sides` rebuild the resting-arm pair.
The build, render and encode commands above apply unchanged.

The [press-depth validation record](reference/press_depth_hands_2026_10_11_validation.json)
lists the hashes and the saved-scene, every-frame clothing, decoded shared-crop
and replay results. The replays use the rendered figure, not people.

The user accepted both renders the same day. The press replaced the guide's
`ex_007` clip, and the neck clip joined the guide as `ex_004`, by user decision
before the multi-person neck counting test; if that test returns the exercise
to the assisted stretch, the neck clip comes out. Both are copied unmodified
into the ignored `web/public/demos/` on the development machine only. The neck
clip's optional detail framing is head and shoulders (`x=285, y=116, w=300,
h=324`), which holds the head and shoulders with at least 32 px to spare on
every decoded frame.

See [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) for eye provenance and
[MPFB_EXERCISE_DRAFTS.md](MPFB_EXERCISE_DRAFTS.md) for the motion sources and
their existing limitations. These remain illustrative animations without a
claim of clinical accuracy.
