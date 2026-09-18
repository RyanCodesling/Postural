# Exercise demonstration source assets

This directory contains the editable Blender source and reproducible export
pipeline for the built-in exercise demonstrations.

The active patient-facing figure is the CC0-based MPFB presentation in
`ex_001_figure_mpfb.blend`. See [MPFB_FIGURE.md](MPFB_FIGURE.md) for its current
build, inspection and preview workflow. Additional active-exercise animation
drafts are documented in [MPFB_EXERCISE_DRAFTS.md](MPFB_EXERCISE_DRAFTS.md).
The earlier variants below are retained as historical assets.

## ex_001 Lateral Arm Raises

`ex_001_lateral_arm_raise.blend` is the editable source of truth. It contains a
fully textured adult woman named Maya, a 53-bone exercise rig, the complete
raise/hold/return animation, camera, lights, studio floor, timeline markers,
and packed textures. The file remains self-contained after it is moved to a
different machine.

The character uses a polished life-simulation-game aesthetic rather than the
earlier primitive mannequin design. The model includes:

- a 19,158-vertex human body with continuous shoulders, elbows, hands, and feet;
- brown eyes, eyebrows, eyelashes, teeth, tongue, and a shaped face;
- side-swept auburn hair;
- a fitted short-sleeve athletic shirt, textured jeans, and white trainers;
- articulated fingers and independently poseable arm, hand, and body bones; and
- texture-based skin, hair, clothing, eye, and shoe materials.

The character was authored from CC0 MakeHuman system assets. The packed Blender
file and generated GLB do not require MakeHuman or MPFB at runtime. See
`THIRD_PARTY_ASSETS.md` for the exact components and provenance.

### Model and motion checks

Blender units are meters. The current build reports:

| Check | Result |
| --- | ---: |
| Rendered stature | 1.828 m |
| Peak arm span | 1.736 m |
| Rest abduction | 4.16 degrees per side |
| Peak abduction | 90.57 degrees per side |
| Body topology | 19,158 vertices |
| Character meshes | 9 |
| Exercise rig | 53 bones |

The 7-second, 30 fps demonstration uses these phases:

- Frames 1-25: neutral standing start
- Frames 25-85: controlled bilateral raise
- Frames 85-115: hold at shoulder height
- Frames 115-175: controlled return
- Frames 175-210: neutral finish for a clean loop

The left and right arms are animated independently but use mirrored target
directions. The build fails if the rest pose exceeds 8 degrees, either peak
leaves the 88-92 degree shoulder-height band, bilateral peak symmetry differs
by more than 0.5 degrees, or the peak wrists no longer align with the arms.

### Rebuild exports and previews

From the repository root on Windows:

```powershell
blender `
  --background `
  --python-exit-code 1 `
  --python tools/blender/build_ex001_demo.py
```

For a modeling review without encoding videos:

```powershell
blender `
  --background `
  --python-exit-code 1 `
  --python tools/blender/build_ex001_demo.py `
  -- --skip-video
```

After a verified still build, render only the browser videos with:

```powershell
blender `
  --background `
  --python-exit-code 1 `
  --python tools/blender/build_ex001_demo.py `
  -- --video-only
```

To refresh only the compact web GLB, use `-- --export-only`. The GLB omits
authoring-only morph targets and uses temporary web-sized texture copies; the
packed editable source keeps its original texture resolution.

The script automatically opens the packed source file, reapplies and validates
the animation, and writes:

- `assets/blender/ex_001_lateral_arm_raise.blend`
- `assets/blender/previews/ex_001/*.png`
- `web/public/demos/ex_001-lateral-arm-raise.glb`
- `web/public/demos/ex_001-lateral-arm-raise-poster.png`
- `web/public/demos/ex_001-lateral-arm-raise.webm`
- `web/public/demos/ex_001-lateral-arm-raise.mp4`

Video encoding looks for `ffmpeg` on `PATH` and in common Windows application
locations. An explicit executable can be passed as `--ffmpeg` after Blender's
`--` separator. The production assets were generated with Blender 5.1.

The rendered movement is reference guidance for the prototype. It is not a
clinically validated prescription and does not replace therapist instructions.

## ex_001 anatomy variant

`ex_001_lateral_arm_raise_anatomy.blend` is a separate, opaque
musculoskeletal demonstration. It does not replace Maya. The anatomy pipeline
never opens or overwrites `ex_001_lateral_arm_raise.blend` or Maya's existing
GLB, poster, or videos.

The anatomy source contains:

- 279 rendered skeletal, cartilage, and teeth meshes;
- 482 muscle and tendon meshes with 976,969 vertices;
- a 237-bone Z-Biomechanics rig;
- 34 continuously deforming shoulder-spanning meshes, 14 compact
  shoulder-to-arm meshes that move with the upper arm, and 78 other rigid
  upper-limb muscle meshes (6 upper-arm, 64 radius-side, and 8 ulna-side);
- 48 bilateral shoulder-girdle muscle meshes with data-driven activation and
  muscle-tendon-length display cues; and
- opaque bone, cartilage, tendon, and muscle materials on a clinical stage.

The geometry comes from Z-Anatomy and BodyParts3D. The shoulder motion and
muscle signals come from the pinned no-load `ABD01` trial distributed with the
RMR solver and the thoracoscapular shoulder model. See
`THIRD_PARTY_ASSETS.md` for licenses, attribution, source checksums, and papers.

The authoring step registers the muscle atlas against 92 same-named,
same-topology skeletal landmarks from the same Z-Anatomy source after the
Z-Biomechanics rig is reset. The current sources resolve to an identity
translation. The pipeline rejects a global translation above 1 mm instead of
reusing a manually inferred source-file offset.

### Motion and muscle-signal contract

The checked-in JSON preserves the 265-frame research reference, including its
laboratory trial clock. The generated presentation re-parameterizes that
reference by arm elevation into a controlled 7.0-second, 30 fps demonstration
with 210 frames:

- Frames 1-24: anatomical rest
- Frames 25-96: 2.4-second raise to shoulder height
- Frames 97-120: 0.8-second shoulder-height hold without pose drift
- Frames 121-192: 2.4-second controlled lowering
- Frames 193-210: 0.6-second settle at anatomical rest

The published trial records one right arm. The left arm is a sagittal mirror
for bilateral instruction. The recorded overhead portion is deliberately
omitted because ex_001 ends at shoulder height. Raising follows the recorded
upward branch sampled by elevation with quintic ease-in/ease-out. Lowering
reverses that same spatial path to prevent a forward/back sweep at shoulder
height, while its activation cue still uses the recorded lowering branch at
the matched elevation. This presentation timing is instructional and does not
preserve the laboratory trial clock.

The distal arm has a separate mirrored presentation constraint so the palm
faces the thigh at rest, then faces mostly downward at shoulder height while
the wrist and middle-hand axis remain nearly level. The correction is sampled
from the same elevation progress on raising and lowering, so it retraces
exactly and does not alter the validated clavicle, scapula, or humerus path.

Compact deltoid, coracobrachialis, biceps, and long-head triceps meshes use a
segment-stable upper-arm attachment so their bellies do not collapse into
cables during elevation. Rotator-cuff, teres, pectoral, and latissimus
attachments retain continuous proximal-to-distal deformation so their origins
remain with the scapula or torso. Remaining upper-limb meshes move rigidly with
their nearest anatomical segment: 6 with the upper arm, 64 with the radius,
and 8 with the ulna. The radius and ulna receive the same distal presentation
rotation around their proximal attachments, while the hand chain follows the
radius. This keeps each atlas surface registered to its assigned bone but
deliberately simplifies true radioulnar motion. These are
visualization-specific deformation rules, not a finite-element tissue model.

The muscle display separates activation from geometric thickness:

- Dark red to orange-red maps the RMR solver's predicted activation from
  0.00 to 0.30, clamped at the upper display limit. It is not EMG, webcam, or
  patient-specific activation.
- Mid-belly thickness follows the OpenSim muscle-tendon length divided by its
  rest length. The visual uses inverse-square-root radial scaling as a
  constant-volume instructional approximation; it is not finite-element soft
  tissue simulation.
- When one atlas mesh represents several model compartments, activation and
  length are combined with a maximum-isometric-force-weighted mean.

This is a research-grounded thesis visualization, not a clinically validated
medical device or patient-specific prescription. A clinician should review its
use in any patient-facing workflow.

### Anatomy validation summary

The authoring script validates the complete 210-frame presentation, not only
the key stills. The current build reports:

| Check | Result |
| --- | ---: |
| Rendered stature | 1.701 m |
| Rest abduction | 10.44 degrees per side |
| Peak abduction | 90.29 degrees per side |
| Peak presentation velocity | 61.164 degrees/second |
| Shoulder-height hold direction drift | 0.0 degrees |
| Scapular motion | 37.16 degrees |
| Clavicular motion | 17.30 degrees |
| Direction tracking error | 0.0 degrees |
| Maximum hand-direction tracking error | 0.0 degrees |
| Maximum palm-facing tracking error | 0.0 degrees |
| Maximum hand angular step | 2.7766 degrees/frame |
| Final wrist return error | 0.0000198 m |
| Same-source registration landmarks | 92 |
| Applied global muscle translation | 0.0 m |
| Median skeletal landmark residual | 0.00000042 m |
| 95th-percentile local atlas residual | 0.00298215 m |
| Maximum base-muscle registration error | 0.00000045 m |
| Rest shoulder-insertion maximum p95 | 0.06014 m |
| Peak shoulder-insertion maximum p95 | 0.059978 m |
| Skeleton meshes | 279 |
| Muscle/tendon meshes | 482 |
| Muscle/tendon vertices | 976,969 |
| Rig bones | 237 |
| Continuously deforming shoulder-spanning meshes | 34 |
| Segment-stable shoulder-to-arm meshes | 14 |
| Other rigid upper-limb meshes: upper arm / radius / ulna | 6 / 64 / 8 |
| Model-cued muscle meshes | 48 |
| Opacity | Fully opaque |

The portable GLB is also imported into a factory-clean Blender process. That
round-trip check verifies the 237-bone rig, 48 animated length morphs, all 48
activation materials, the 42 non-constant activation-color channels, return to
rest, the rest/peak/final hand and palm targets, and Draco compression. Six
pectoral color materials remain static because their source activation is zero
on the retained shoulder-height branches.

### Rebuild the anatomy variant

The checked-in reference JSON means normal builds do not need OpenSim. To
recreate that JSON from the pinned research files, install OpenSim 4.6 and
SciPy 1.16.1 in a disposable authoring environment, then run:

```powershell
python tools/blender/extract_ex001_thoracoscapular_reference.py
```

To author the editable anatomy source for the first time from vetted atlas
files:

```powershell
blender `
  --background `
  --factory-startup `
  --python-exit-code 1 `
  --python tools/blender/build_ex001_anatomy.py `
  -- `
  --author-source `
  --z-anatomy C:\path\to\Z-Anatomy\Startup.blend `
  --z-biomechanics C:\path\to\Z-Biomechanics\Startup.blend `
  --source-only
```

After the editable source exists, rebuild the source, key stills, and GLB
without encoding videos:

```powershell
blender `
  --background `
  --factory-startup `
  --python-exit-code 1 `
  --python tools/blender/build_ex001_anatomy.py `
  -- --skip-video
```

Useful focused modes are `-- --preview-only`, `-- --preview-frame 108`,
`-- --export-only`, and `-- --video-only`. Pass an explicit FFmpeg executable
after Blender's `--` separator with `--ffmpeg C:\path\to\ffmpeg.exe` when
needed.

Render fast front, rear, side, shoulder close-up, and hand-focused registration
checks with:

```powershell
blender `
  --background `
  --factory-startup `
  --python-exit-code 1 `
  --python tools/blender/render_ex001_anatomy_qa.py `
  -- `
  --source assets/blender/ex_001_lateral_arm_raise_anatomy.blend `
  --output-dir assets/blender/previews/ex_001_anatomy/qa_biomechanics
```

Use `--views hands_front hands_rear hands_top` for the focused rest/peak palm
and wrist review.

`diagnose_anatomy_registration.py` compares the two pinned atlas sources or a
generated anatomy source directly and reports identity, fixed-offset, and
best-fit similarity errors for matching bone vertices.

Validate the portable GLB with:

```powershell
blender `
  --background `
  --factory-startup `
  --python-exit-code 1 `
  --python tools/blender/validate_ex001_anatomy_glb.py `
  -- `
  --glb web/public/demos/ex_001-lateral-arm-raise-anatomy.glb
```

The anatomy pipeline writes:

- `assets/blender/ex_001_lateral_arm_raise_anatomy.blend`
- `assets/blender/reference/ex_001_thoracoscapular_abduction.json`
- `assets/blender/previews/ex_001_anatomy/*.png`
- `assets/blender/previews/ex_001_anatomy/qa_biomechanics/*.png`
- `web/public/demos/ex_001-lateral-arm-raise-anatomy.glb`
- `web/public/demos/ex_001-lateral-arm-raise-anatomy-poster.png`
- `web/public/demos/ex_001-lateral-arm-raise-anatomy.webm`
- `web/public/demos/ex_001-lateral-arm-raise-anatomy.mp4`

The GLB uses Draco compression and the ratified `KHR_animation_pointer`
extension for activation-driven material colors. Viewers that do not implement
that optional extension ignore the color channels; the rig animation and
length morphs remain standard animation data. The MP4/WebM renders are the
compatibility fallback. The production anatomy assets were generated with
Blender 5.1.

## ex_001 ecorche V2 - Stage 1 static checkpoint

The user rejected this procedural visual direction on 2026-08-24. V2 remains
frozen as review evidence; do not extend it into motion or present its computed
static pass as visual acceptance. The separate V3 atlas-derived direction
below superseded the V2 approval.

The V2 ecorche is a separate, approval-gated asset family. It does not repair,
overwrite, append, or link the protected Maya, Z-Anatomy-derived anatomy, or
rejected 2026-08-20 ecorche surfaces. Stage 1 begins from a factory-empty
Blender scene and creates every visible support, muscle, tendon, and QA mesh
from code-authored section profiles. The pinned RMR/OpenSim model constrains
rest attachment coordinates and line-of-action paths only; it is not a source
of volumetric tissue surfaces.

Current Stage 1 scope is static and right-shoulder focused:

- 33 newly generated muscle objects and 23 separate tendon/aponeurosis objects
- 66 evaluated origin/insertion anchors from 33 OpenSim paths
- a continuous upper-torso support core and coherent
  `Thorax -> ShoulderGirdle -> Humerus -> ForearmGross -> ForearmPronation -> HandPalm`
  control hierarchy
- five muscle-only primary views plus a separate skeleton/attachment QA view
- no pose shapes, animation actions, encoded video, GLB, web integration, or
  patient-facing behavior

The opt-in path extraction extends the legacy extractor without changing its
default output. A no-flag reproduction after the extension remained
byte-identical to `ex_001_thoracoscapular_abduction.json` at SHA-256
`31AC3AE57FF320CE6352B373188D396C1D012008E5D03B05823C25777946ED37`.
The separate V2 path file contains six evaluated knots (`rest`, 30, 45, 60,
75, and shoulder height), 198 paths in total, and records the published trial's
measured rest/peak elevations as 12.03391 and 90.36418 degrees rather than
mislabeling rest as zero.

### Rebuild and inspect Stage 1

Install OpenSim 4.6 and SciPy 1.16.1 in a disposable authoring environment,
then generate the second reference without overwriting the legacy JSON:

```powershell
python tools/blender/extract_ex001_thoracoscapular_reference.py `
  --output C:\path\to\temporary-legacy-regression.json `
  --geometry-path-output assets/blender/reference/ex_001_ecorche_v2_paths.json
```

Build the original static source:

```powershell
blender `
  --background `
  --factory-startup `
  --python tools/blender/build_ex001_ecorche_v2.py `
  -- `
  --paths assets/blender/reference/ex_001_ecorche_v2_paths.json `
  --output assets/blender/ex_001_lateral_arm_raise_ecorche_v2.blend
```

Inspect the saved scene independently:

```powershell
blender `
  --background assets/blender/ex_001_lateral_arm_raise_ecorche_v2.blend `
  --python tools/blender/inspect_ex001_ecorche_v2.py `
  -- `
  --output assets/blender/reference/ex_001_ecorche_v2_static_validation.json
```

The current computed report passes all static checks: 56/56 authored
muscle/tendon meshes are closed and nonzero-volume, all anchors land on their
reference and authored endpoint vertices, the control hierarchy is exact,
there are no animation actions, and fingerprints across 644 protected atlas
meshes plus 150 rejected-scene meshes produce zero exact V2 matches. Three
unsaved negative controls were also exercised: a 15 mm attachment shift, a 15%
muscle scale, and an extra muscle object each made the expected checks fail.

Render the static review set and compose the contact sheet with:

```powershell
blender `
  --background assets/blender/ex_001_lateral_arm_raise_ecorche_v2.blend `
  --python tools/blender/render_ex001_ecorche_v2_qa.py `
  -- --output-dir assets/blender/previews/ex_001_ecorche_v2/static_rest

python tools/blender/composite_ex001_ecorche_v2_proofs.py
```

Stage 1 writes:

- `assets/blender/reference/ex_001_ecorche_v2_paths.json`
- `assets/blender/reference/ex_001_ecorche_v2_static_validation.json`
- `assets/blender/ex_001_lateral_arm_raise_ecorche_v2.blend`
- `assets/blender/previews/ex_001_ecorche_v2/static_rest/*.png`
- `assets/blender/previews/ex_001_ecorche_v2/static_rest_contact_sheet.png`

Computed `PASS` is not visual acceptance. The geometry is an intentionally
simplified procedural anatomy checkpoint, not a studio anatomical sculpt or a
clinically validated model. V2 motion/deformation remains blocked unless the
user explicitly reopens that rejected direction; the V3 work below is a
separate asset family rather than a continuation of V2.

## ex_001 muscle-atlas V3 review proof

`ex_001_lateral_arm_raise_muscle_atlas_v3.blend` is the separate, user-approved
visual proof that replaces the rejected procedural V2 direction. It copies the 482
registered muscle/tendon Basis surfaces from the protected anatomy atlas into a
new file, discards the source armature, modifiers, actions, cameras, lights,
and skeleton, and presents muscle/tendon surfaces only. The editable V3 source,
renders, and encoded video are CC BY-SA 4.0; the build, inspection, and render
scripts remain MIT. See `LICENSE-CC-BY-SA-4.0.md` and
`THIRD_PARTY_ASSETS.md`.

V3 uses six separately authored surface poses: measured 11.85-degree rest,
approximately 30, 45, 60, and 75 degrees, and 90.29-degree shoulder height.
The 48 bilateral shoulder meshes mapped to the evaluated OpenSim paths use
baked atlas surface poses with attachment-protected surface-normal volume
correction. Seventy-eight distal upper-limb meshes use rotation/translation-only
rigid segment transforms, and 356 meshes remain static. The saved asset has no
live armature; adjacent-only linear shape weights create the 210-frame,
30 fps, seven-second rest/raise/hold/lower/settle presentation.

### Build and independent inspection

Build from the protected atlas and pinned six-pose path reference:

```powershell
blender `
  --background `
  --factory-startup `
  --python tools/blender/build_ex001_muscle_atlas_v3.py
```

Inspect the saved scene without importing the builder:

```powershell
blender `
  --background assets/blender/ex_001_lateral_arm_raise_muscle_atlas_v3.blend `
  --python tools/blender/inspect_ex001_muscle_atlas_v3.py `
  -- `
  --output assets/blender/reference/ex_001_muscle_atlas_v3_validation.json
```

The current independent report is `PASS`:

| Check | Result |
| --- | ---: |
| Atlas/V3 muscle and tendon meshes | 482 / 482 exact names |
| Path-corrected / rigid / static meshes | 48 / 78 / 356 |
| Full-frame pose-weight checks | 26,460, zero failures |
| Maximum authored-pose volume drift | 0.985163% |
| Maximum atlas rest-registration error | 0.0 m |
| Maximum mapped attachment deviation | 0.001333 m |
| 95th-percentile mapped attachment deviation | 0.001027 m |
| Maximum authored elevation error | 0.775520 degrees |
| Maximum rigid absolute edge-length error | 0.000000506 m |
| Negative controls rejected | 6 / 6 |

The inspector deliberately rejects source-hash tampering, a missing mesh, 20%
volume scaling, a 50 mm attachment shift, three-way pose-weight overlap, and a
corrupted control parent. Its mapped-surface strain diagnostic still reports a
worst per-mesh p95 edge strain of 0.920446 at the left clavicular pectoralis at
shoulder height. That strain IS visible: from about 45 degrees of elevation
upward the clavicular pectoralis and the deltoid separate from the chest wall
on both sides, and background shows through the body at f0058, f0071, f0084 and
f0108. An earlier version of this file claimed the close render remained
visually continuous; that was wrong and is corrected here.

The tearing originates in the protected anatomy atlas's own armature
deformation, not in V3. Measured on the atlas directly: maximum edge strain
3.5224 on the left clavicular pectoralis and 19.8174 on the right latissimus
dorsi, identical at source frames 96 and 108 and identical with and without
non-armature modifiers. The anatomy variant looks clean only because its 279
opaque skeletal meshes sit behind the muscle layer; V3 discarded the skeleton
and so exposed a pre-existing defect rather than introducing one.

V3 is an anatomically grounded instructional model, not a finite-element tissue
simulation or clinically validated anatomy/motion claim.

### Render and decode the review media

Render the six-pose multi-view QA set:

```powershell
blender `
  --background `
  --python tools/blender/render_ex001_muscle_atlas_v3_qa.py `
  -- `
  --source assets/blender/ex_001_lateral_arm_raise_muscle_atlas_v3.blend `
  --output-dir assets/blender/previews/ex_001_muscle_atlas_v3/final `
  --frames 1 45 58 71 84 108 `
  --resolution 720
```

The local Blender build has no FFmpeg output module, so render a lossless frame
sequence and encode it separately:

```powershell
blender `
  --background `
  --python tools/blender/render_ex001_muscle_atlas_v3_motion.py `
  -- `
  --source assets/blender/ex_001_lateral_arm_raise_muscle_atlas_v3.blend `
  --output-dir assets/blender/previews/ex_001_muscle_atlas_v3/motion_frames `
  --resolution 512

ffmpeg -framerate 30 -start_number 1 `
  -i assets/blender/previews/ex_001_muscle_atlas_v3/motion_frames/frame_%04d.png `
  -frames:v 210 -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart `
  assets/blender/previews/ex_001_muscle_atlas_v3/ex_001_muscle_atlas_v3_motion.mp4
```

The encoded proof independently reads and decodes as H.264/yuv420p, 512x512,
210/210 frames, 30 fps, and exactly 7.0 seconds. A full decode-to-null exits
cleanly, black-frame detection reports no events, and decoded samples at rest,
raise, hold, lower, and final return were visually inspected.

V3 writes no GLB or file under `web/public/demos`. Stop at these review media;
visual approval is a separate user gate before any export or product work.
