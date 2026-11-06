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
remains outside the guide until its separate counting and acceptance gates
pass. The side bend stays one-sided with one hand on the hip. The lateral
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

## Arm and hand refinements, 2026-10-10

Separate candidates in `previews/form_2026_10_10/` address the neck demo's
hand placement and the press's forward forearm tilt. The neck scene puts both
relaxed hands on the hips, fitted against the evaluated clothing. Its corrected
neck weights and continuous 40-beat-per-minute swing are retained.

The current press scene is `press_v8_vertical/ex_007_figure_mpfb.blend`. Its
forearms start without the previous forward tilt, with wider hand spacing.
The upper arms start modestly anterior to the frontal plane. At the top,
both upper arms and forearms point vertically upward, with straight elbows
and the wrists directly above the shoulders. The hands converge during the
lift. Smooth arm rotations also reduce the shoulder and collar pinching
without changing mesh coordinates or skin weights. The wrists still start
at shoulder height and the 10-second timing remains. Earlier form trials,
including the straight but outward-angled `press_v4_straight`, are retained
as superseded previews.

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
  --output <fresh-form-candidate.blend>
```

Use `ex_004` for the hands-on-hips neck revision. The same render/encode commands
above apply. These candidates still require visual acceptance before replacing
the current guide clips, and the neck draft retains its separate counting gate.

The [original form validation record](reference/form_2026_10_10_validation.json)
records the unchanged neck candidate and the superseded straight-arm press.
The [vertical press validation record](reference/vertical_press_2026_10_10_validation.json)
records the current press, vertical alignment, motion continuity, garment
clearance, media hashes and full-frame crop checks. The installed Blender MCP
bridge was also used for front and angled viewport inspection of the shoulder
at the start, middle and top; external asset integrations stayed disabled.

See [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) for eye provenance and
[MPFB_EXERCISE_DRAFTS.md](MPFB_EXERCISE_DRAFTS.md) for the motion sources and
their existing limitations. These remain illustrative animations without a
claim of clinical accuracy.
