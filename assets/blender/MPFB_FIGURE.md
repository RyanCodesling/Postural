# Patient-facing lateral arm raise figure

The active presentation source is `ex_001_figure_mpfb.blend`. Its preview is
`previews/ex_001_mpfb/ex_001_figure_motion.mp4`. This is an authored exercise
demonstration, not a clinical measurement model. Source provenance is recorded
in [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md#ex_001-patient-facing-figure-mpfb2--makehuman-cc0).

Additional side-bend, arm-hold, overhead-press and wall-angel drafts have
separate sources and previews in [MPFB_EXERCISE_DRAFTS.md](MPFB_EXERCISE_DRAFTS.md).

## Upgraded presentation look

The camera page's Reference Guide plays all five clips in an upgraded look: the
lateral raise, arm hold, overhead press and wall angels as re-renders, and the
side bend as a one-sided version with one hand on the hip, rebuilt from the
upgraded figure (see [MPFB_EXERCISE_DRAFTS.md](MPFB_EXERCISE_DRAFTS.md)).

`tools/blender/upgrade_mpfb_figure_look.py` builds the upgraded look from the
unchanged `ex_001_figure_mpfb.blend`:

- the CC0 MakeHuman `short02` hairstyle, fitted to the saved body (provenance
  in [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md));
- warmer skin with subsurface scattering, still matte so no highlight reads as
  a landmark;
- rebalanced key, fill and top lights;
- a seamless studio backdrop in place of the floor's hard horizon;
- the "slate" palette: dark backdrop, petrol-blue top and light shorts.

The palette was chosen from measured luminance contrast against the background:
skin 5.5 : 1, top 3.9 : 1 and shorts 6.5 : 1, with the green trunk guide 2.3 : 1
against the top. The earlier look measured 1.9, 1.9, 1.5 and 2.0.

The body, garment and rig coordinates are unchanged, as are the animation and
the approved `girdle_scale = 0.475`. The upgraded figure and the exercises
rebuilt from it are in `previews/slate_2026_09_25/`. The lateral-raise guide is
`previews/slate_2026_09_25/ex_001_mpfb/ex_001_figure_motion.mp4`: 870 x 980, 64
samples. The original preview named at the top of this file is kept unchanged.

```powershell
blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/blender/upgrade_mpfb_figure_look.py -- `
  --source assets/blender/ex_001_figure_mpfb.blend `
  --hair-dir <MPFB user data>/hair/short02 --palette slate `
  --output assets/blender/previews/<fresh folder>/ex_001_figure_mpfb.blend
```

The hair directory is MPFB2's installed copy of the MakeHuman system assets.
Pass the upgraded figure as `--source` to `build_mpfb_exercise_drafts.py` to
rebuild the exercises in the same look.

## Clothing revision

The presentation revision `mpfb-garments-2026-09-06` keeps the approved
`girdle_scale = 0.475` and the original body and shoulder animation. The hand
axis follows the forearm with the existing palm roll and finger pose retained.
The hand orientation remains an authored presentation choice pending clinician
review. The green marks are visual guides for arm level, torso alignment and
hip level, not anatomical landmark measurements.

Clothing is now separate editable geometry: `Figure_Top` and `Figure_Shorts`.
The athletic top has connected shoulder panels and a neck opening, and the
shorts have room around the thighs. Both have 1.8 mm fabric thickness, bound
edges, subtle stitch detail and a procedural fabric surface. The top overlaps
the shorts at the waist. The green guides are carried on the garment surfaces.
The builder imports `tools/blender/mpfb_clothing.py` to cut continuous openings,
interpolate the existing bone weights and add garment ease. It retains the
original body coordinates, rather than reshaping the person to fit the clothes.

The garments follow the existing rig. They do not run a cloth simulation.
An Outside-mode Shrinkwrap modifier maintains skin clearance while leaving
looser areas away from the skin, and a second clearance pass handles the
thickened hems. See the [Blender Shrinkwrap manual](https://docs.blender.org/manual/en/2.81/modeling/modifiers/deform/shrinkwrap.html)
for the distinction between the Outside and surface-conforming snap modes.

The scene contains editable title, guide and phase text. The phases are Ready
(frames 1-24), Raise (25-95), Pause (96-120), Lower (121-191) and Ready (192-210).
They describe the existing seven-second animation; they do not specify a
patient's prescribed hold duration or repetition count.

## Build and inspect

Run these commands from the repository root. Substitute the installed Blender,
Python, FFmpeg and FFprobe executable paths if they are not on PATH. Always use
`--python-exit-code 1` so Python errors fail the process.

Rebuild from the saved, baked MPFB body without loading the MPFB add-on:

```powershell
blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/blender/build_ex001_mpfb_figure.py -- `
  --source assets/blender/ex_001_figure_mpfb.blend `
  --output assets/blender/ex_001_figure_mpfb_candidate.blend
```

Omitting `--source` generates a new body and requires the installed/enabled
MPFB2 add-on; for that path, also omit `--factory-startup` so Blender loads the
profile that enables MPFB2. The default girdle scale is 0.475 in both paths. The value is
persisted in the saved scene along with the figure revision and hand-pose note.
The measured peak clavicle elevation is distinct from the animation driver's
angle; the builder reports both rather than presenting the input as a measurement.

The camera width is fitted from the evaluated visible mesh through every frame,
with at least 6.5% horizontal margin on each side and even pixel dimensions.
The original body mesh is preserved. Jittered area-light
shadows smooth the irregular hand-shadow patches over the shorts. See the
[Blender light-settings manual](https://docs.blender.org/manual/en/5.0/render/eevee/light_settings.html)
for the renderer's jitter control.

```powershell
blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/blender/inspect_ex001_mpfb_figure.py -- `
  --source assets/blender/ex_001_figure_mpfb_candidate.blend `
  --baseline assets/blender/ex_001_figure_mpfb.blend `
  --output assets/blender/previews/ex_001_mpfb/candidate_inspection.json
```

The independent inspector measures all 210 frames, including the clothing,
checks fingertip margins,
hand axes, text placement and exact phase changes, and rejects deliberately
narrow framing, a bent wrist and duplicate phase text. With `--baseline`, it
also compares the authored body vertices and all clavicle/upper-arm joint
positions. These checks do not establish clinical correctness.

Check the saved clothing separately:

```powershell
blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/blender/inspect_ex001_mpfb_clothing.py -- `
  --source assets/blender/ex_001_figure_mpfb_candidate.blend `
  --output assets/blender/previews/ex_001_mpfb/candidate_clothing_inspection.json
```

This inspector requires one connected surface per garment, four intended
openings in the top and three in the shorts, and no branching boundaries or
non-manifold edges. It measures every evaluated garment vertex against the
skinned body at eleven poses spanning the animation. This is a sampled vertex
clearance check, not proof of continuous collision-free cloth physics. Inspect
rendered rest, peak and lowering views as well, including the shoulder panels,
underarms, neckline, waistband, guide edges and leg hems.

## Render and encode

Use a fresh frame directory for each render. The renderer refuses existing
requested frames and writes a manifest only after all requested images exist.
Add `--frames 12 60 110 150 205` for a quick visual checkpoint; omit it for the
full animation. Render the saved candidate and inspect it before promoting it.

```powershell
blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/blender/render_ex001_mpfb_figure.py -- `
  --source assets/blender/ex_001_figure_mpfb_candidate.blend `
  --output-dir assets/blender/previews/ex_001_mpfb/candidate_motion_frames

python tools/blender/encode_ex001_mpfb_preview.py `
  --frames-dir assets/blender/previews/ex_001_mpfb/candidate_motion_frames `
  --output assets/blender/previews/ex_001_mpfb/candidate_motion.mp4 `
  --qa-dir assets/blender/previews/ex_001_mpfb/candidate_decoded
```

The encoder requires Pillow, FFmpeg and FFprobe. Use `--ffmpeg` and `--ffprobe`
to supply executable paths. It independently decodes every frame, checks
resolution/30 fps/7 seconds, compares seven decoded PNGs against their render
sources for colour drift, and checks that the MP4 has faststart metadata before
replacing its output. PNGs already contain the AgX view transform; the encoder
does not apply another Blender view transform.

Encoding and RGB readback both use FFmpeg's `accurate_rnd` and
`full_chroma_int` [scaler flags](https://ffmpeg.org/ffmpeg-scaler.html). The
fast default RGB readback was observed to darken channels by about 1-2 levels;
the accurate conversion agrees with an independent zscale comparison. The
validation report records the conversion method with its measured pixel drift.

These tools write only Blender presentation sources, reports, PNGs and MP4s.
They do not export GLB or integrate the figure into the application.
