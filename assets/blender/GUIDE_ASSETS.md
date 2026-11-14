# Published Reference Guide assets

The six accepted Reference Guide videos and their editable Blender scenes are
versioned together. The [asset manifest](reference/guide_assets.json) records
their exact paths, byte sizes, SHA-256 hashes, timelines and render settings.
The videos are unchanged copies of the accepted renders. A normal checkout
contains the media used by `web/src/lib/exercises/demoClips.ts`.

| Exercise | Accepted scene under `assets/blender/previews/` | Video under `web/public/demos/` | Frames at 30 fps |
| --- | --- | --- | ---: |
| Lateral arm raise | `slate_2026_09_25/ex_001_figure_mpfb.blend` | `ex_001-figure-motion.mp4` | 210 |
| Neck side bends | `press_depth_hands_2026_10_11/ex_004_figure_mpfb.blend` | `ex_004-figure-motion.mp4` | 270 |
| Standing side bend | `side_bend_one_side_2026_09_25/ex_005_figure_mpfb.blend` | `ex_005-figure-motion.mp4` | 180 |
| Arm hold | `slate_2026_09_25/ex_006_figure_mpfb.blend` | `ex_006-figure-motion.mp4` | 300 |
| Overhead press | `press_depth_hands_2026_10_11/ex_007_figure_mpfb.blend` | `ex_007-figure-motion.mp4` | 300 |
| Wall angels | `slate_2026_09_25/ex_008_figure_mpfb.blend` | `ex_008-figure-motion.mp4` | 468 |

All six videos are 870 x 980. The player applies its existing shared full-body
crop and optional detail framing. Timings and poses are authored presentation
choices. These animations do not establish clinical accuracy or change a
therapist's prescription, scoring thresholds, calibration or repetition counts.
The lateral-raise shoulder-girdle scale remains 0.475; this rig has no scapula
bone and does not model anatomical scapulohumeral rhythm.

## Included source inputs

- `ex_001_figure_mpfb.blend` contains the baked base body, rig and garments.
- The four root-level exercise `.blend` files retain the earlier animation
  sources. The accepted slate sources, one-sided side bend, corrected neck
  swing, neck/press appearance candidates and vertical-press finish source
  preserve the inputs used to produce the accepted scenes.
- `vendor/makehuman/hair/short02/` contains the original CC0 hair mesh,
  bindings, material, diffuse map and normal map.
- `vendor/makehuman/eyes/` contains the original CC0 high-poly eye mesh,
  bindings, brown material and texture.
- `tools/blender/` retains the MPFB build, clothing, appearance, pose,
  inspection, rendering and encoding tools. The abandoned ecorche/anatomy
  tools and their unused reference data have been removed.

Saved scene textures are packed. Opening and rendering the scenes does not
require the MPFB add-on or a separate MakeHuman installation. Generating a
new body from scratch still requires MPFB. The MakeHuman inputs are CC0;
MPFB's add-on software is GPL and is not included. See
[THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md) for provenance and the retained
historical attribution notices.

Generated PNG sequences, duplicate video encodings, `.blend1` backups,
rejected experiments and legacy GLB exports stay ignored. Frame sequences
and encodings can be regenerated from the saved scenes and rendering scripts.

## Verify and render

Run from the repository root with Python and, for full video checks, FFmpeg
and FFprobe on PATH:

```powershell
python tools/blender/verify_guide_assets.py --ffmpeg ffmpeg --ffprobe ffprobe
```

Omit both optional flags to check the asset hashes and surviving Python
imports without decoding. The verifier fails on missing or changed files.

Use Blender 5.1.2, Python with Pillow, FFmpeg and FFprobe for the existing
render/encode workflow. For example, render the accepted press into a fresh
output directory (the source is never saved):

```powershell
blender --background --factory-startup --disable-autoexec --python-exit-code 1 `
  --python tools/blender/render_mpfb_exercise_draft.py -- `
  --source assets/blender/previews/press_depth_hands_2026_10_11/ex_007_figure_mpfb.blend `
  --output-dir assets/blender/previews/local_press_frames --samples 32 --scale 1
python tools/blender/encode_mpfb_exercise_draft.py `
  --frames-dir assets/blender/previews/local_press_frames `
  --output assets/blender/previews/local_press.mp4 `
  --qa-dir assets/blender/previews/local_press_qa
```

The manifest gives the saved frame count and samples for each accepted scene.
Keep baked phase labels when reproducing these clips. Separate future
presentation candidates can use the renderer's `--hide-phase-labels` option.
Regeneration can vary with Blender, graphics drivers and encoder versions;
the checked-in clips and their hashes identify the accepted output.

For appearance rebuilds, pass
`--hair-dir assets/blender/vendor/makehuman/hair/short02` to
`upgrade_mpfb_figure_look.py`, and
`--eyes-dir assets/blender/vendor/makehuman/eyes` to
`polish_mpfb_presentation.py`. The accepted press's pose refinement uses
`--press-start deep` and
`--press-finish-source assets/blender/previews/form_2026_10_10/press_v8_vertical/ex_007_figure_mpfb.blend`;
the neck uses `--neck-rest relaxed`.

The dated validation JSON and older MPFB documents retain review-stage
results, including rejected candidates. Their historical status text does
not supersede this manifest's accepted source/video mapping. Those results
are engineering checks on rendered figures, not live-human or clinical
validation.
