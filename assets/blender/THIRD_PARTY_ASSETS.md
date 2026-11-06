# Third-party asset provenance

The ex_001 Maya character uses the following components from the official
MakeHuman system asset collection:

- MakeHuman base human mesh and game-engine skeleton/weights
- young Asian female skin
- high-poly brown eyes
- `eyebrow001`
- `eyelashes01`
- `teeth_base`
- `tongue01`
- `short03` hair
- `female_casualsuit01`
- `shoes05`

MakeHuman states that its core assets and bundled system assets are released
under CC0. The relevant official references are:

- https://static.makehumancommunity.org/about/license.html
- https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html

MPFB was used as the Blender authoring/import tool. No MPFB source code or
add-on package is redistributed in this repository; the final textures are
packed into the editable Blender file and embedded in the generated GLB.

MPFB project: https://github.com/makehumancommunity/mpfb2/

## ex_001 anatomy variant

The anatomy variant is a separate derivative asset. It does not modify or
replace the CC0-based Maya character described above.

### Z-Anatomy and BodyParts3D geometry

Repository: https://github.com/Z-Anatomy/Models-of-human-anatomy

Z-Anatomy states that its shared code and content use the Creative Commons
Attribution-ShareAlike 4.0 International license. Its required model
attributions are reproduced here:

- "BodyParts3D - The Database Center for Life Science - CC-BY-SA 2.1 Japan"
- "Z-Anatomy - The libre 3D atlas of anatomy - CC-BY-SA 4.0"

Project authors and model contributors named by Z-Anatomy include Kousaku
Okubo (original BodyParts3D model), Gauthier Kervyn (design, 3D, anatomy), and
Marcin Zielinski (Blender add-on).

The anatomy authoring run used the `Startup.blend` files contained in these
official repository archives:

| Archive | SHA-256 |
| --- | --- |
| `Z-Anatomy.zip` | `E029688545627BD0214B269E1063143ABB580AAD72B2C2445D6D8A9A0D9DA736` |
| `Z-Biomechanics.7z` | `0A74B2FA3C47DB925B06241FA38C89B0811E58A78EE28EC440CD460E279CF22B` |

The checked-in anatomy `.blend`, GLB, preview images, and videos contain
adapted Z-Anatomy geometry and are therefore distributed subject to CC BY-SA
4.0. The source-atlas names and clinical material categories are retained in
the editable Blender source where practical.

The repository-level MIT license now expressly excludes these atlas-derived
asset families. `LICENSE-CC-BY-SA-4.0.md` identifies their scope, repeats the
required attribution, links the canonical CC BY-SA 4.0 terms, and records the
types of modification made by Postural.

### Frozen 2026-08-20 ecorche draft

`ex_001_lateral_arm_raise_ecorche.blend` and its proof renders append and adapt
geometry from the atlas-derived anatomy source. They are therefore also CC
BY-SA 4.0 and require the Z-Anatomy and BodyParts3D attributions above. This
licensing record does not validate the draft: it remains frozen, rejected, and
governed by the hard-coded-validation warning documented elsewhere in this
file set.

### ex_001 V3 muscle-atlas family

The V3 family is a new derivative that copies registered muscle and tendon
surfaces from the frozen atlas into separate files, evaluates six atlas motion
poses in memory, removes the source armature/action/modifier stack from the
saved result, and adds attachment-protected volume correction, an armature-free
shape animation, materials, controls, and presentation work. Every V3 `.blend`,
rendered still, and encoded video whose name contains `muscle_atlas_v3` is CC
BY-SA 4.0. The V3 Python build, validation, and rendering scripts are original
software and remain MIT-licensed.

The evaluated OpenSim/RMR GeometryPaths below provide pose targets, muscle
correspondence, and attachment guidance; they are not treated as volumetric
tissue surfaces. V3 must not be described as medically or clinically validated
without independent expert review.

### Thoracoscapular kinematics and RMR activation estimates

Repository: https://github.com/ComputationalBiomechanicsLab/rmr-solver

Pinned commit: `d40ebd8ba658633993e531e408c0d96df30ff367`

The RMR repository licenses its code under Apache 2.0 and its data and
musculoskeletal models under CC BY 4.0. The anatomy variant redistributes only
a compact derived JSON reference, not the MATLAB solver or OpenSim model.

The reference is derived from the no-load right-arm abduction trial `ABD01`,
the `TSM_subject_noWeight.osim` model, and the 100 Hz RMR solution with the
glenohumeral stability constraint. The extractor downloads and verifies these
pinned files:

The distributed JSON retains the research reference and its original trial
clock. The rendered seven-second presentation samples the recorded upward
branch by arm elevation with eased timing. Its lowering animation reverses the
same spatial path to avoid blending between two different shoulder-height
crossings, while the muscle-activation display samples the recorded lowering
branch at the matched elevation. This presentation transform is an
instructional adaptation and is not part of the source dataset.

| Source file | SHA-256 |
| --- | --- |
| `TSM_subject_noWeight.osim` | `C357E61EB266558C0BFE9212462FBC1D621E0398C2EAFC4E1A4AA92FE5C7A9FF` |
| `ABD01.mot` | `1CB91D171EF55995137167B9E46EB9C352175883E0234F3DEE6D0E667037A88A` |
| `ABD01_activations_with_GH.mat` | `3CF6B917B6E7BEA0BC6C6C642F14EFACAA452F4A69735DCBC9CD4919D0AA7F59` |
| `LICENSE_data` | `4F75159F05AF4995FFFB302CA59BDBBC29AF6E1E6E309F933AC4A22D3D43AB1D` |

Relevant publications:

- Belli I, Joshi S, Prendergast JM, et al. "Does enforcing glenohumeral
  joint stability matter? A new rapid muscle redundancy solver highlights the
  importance of non-superficial shoulder muscles." PLOS ONE 18(11), 2023.
  https://doi.org/10.1371/journal.pone.0295003
- Seth A, Dong M, Matias R, Delp S. "Muscle Contributions to Upper-Extremity
  Movement and Work From a Musculoskeletal Model of the Human Shoulder."
  Frontiers in Neurorobotics 13:90, 2019.
  https://doi.org/10.3389/fnbot.2019.00090

The published activations are musculoskeletal-model estimates. They are not
the subject's EMG values, live measurements, or patient-specific predictions.
The left side is mirrored from the right-side trial, and the visualization is
not a clinically validated medical device.

### ex_001 ecorche V2 Stage 1 provenance boundary

The approval-gated V2 static checkpoint uses a second compact JSON derived
from the same pinned RMR/OpenSim source and therefore retains the RMR data and
model attribution above under CC BY 4.0. It stores evaluated rest-pose muscle
paths and attachment coordinates at six upward-raise knots. Those line and
point coordinates constrain authoring; they are not redistributed OpenSim
surface geometry.

Unlike the 2026-08-11 anatomy asset and rejected 2026-08-20 ecorche draft, the
V2 builder starts from a factory-empty scene and does not append, link, import,
or copy Z-Anatomy/BodyParts3D meshes. Its support, muscle, tendon, skeleton-QA,
and marker surfaces are generated from new code-authored profiles. The
independent static inspector found zero exact base-coordinate/topology matches
after fingerprinting 644 meshes in the protected atlas blend and 150 meshes in
the rejected draft blend.

This V2 boundary does not repair or relicense the older assets: their CC BY-SA
4.0 versus repository-MIT mismatch remains governed separately. V2 remains an
instructional, nonclinical visualization, and the RMR/OpenSim estimates must
never be described as patient-specific anatomy, EMG, or webcam measurement.

### Distal forearm and hand presentation boundary

The palm-facing correction is an authored instructional constraint layered on
the shoulder trial; it is not an additional result from `ABD01`. The radius
and ulna receive the same orientation delta around their proximal attachments,
the hand chain follows the radius, and rigid surfaces follow their nearest
assigned bone. This preserves bone-surface registration and makes the rest and
shoulder-height hand positions legible, but it does not reproduce the full
coupled motion of the proximal and distal radioulnar joints.

Primary kinematic and modeling references used to constrain that simplification:

- Tay SC, van Riet R, Kazunari T, et al. "In-vivo kinematic analysis of
  forearm rotation using helical axis analysis." Clinical Biomechanics 25(7),
  2010. https://doi.org/10.1016/j.clinbiomech.2010.03.010
- Nakamura T, Yabe Y, Horiuchi Y, Yamazaki N. "In vivo motion analysis of
  forearm rotation utilizing magnetic resonance imaging." Clinical
  Biomechanics 14(5), 1999.
  https://doi.org/10.1016/S0268-0033(98)90091-2
- Yough MG, Hardesty RL, Yakovenko S, Gritsenko V. "A segmented forearm model
  of hand pronation-supination approximates joint moments for real time
  applications." 2021 10th International IEEE/EMBS Conference on Neural
  Engineering, 2021. https://doi.org/10.1109/NER49283.2021.9441405
- Kozono N, Okada T, Takeuchi N, et al. "In vivo kinematic analysis of the
  glenohumeral joint during dynamic full axial rotation and scapular plane full
  abduction in healthy shoulders." Knee Surgery, Sports Traumatology,
  Arthroscopy 25(7), 2017. https://doi.org/10.1007/s00167-016-4263-2

## ex_001 patient-facing figure (MPFB2 / MakeHuman, CC0)

`assets/blender/ex_001_figure_mpfb.blend` is generated by
`tools/blender/build_ex001_mpfb_figure.py` from MPFB2 and the MakeHuman system
asset pack. Both are **CC0**, so this asset family carries no attribution
requirement, no share-alike obligation, and needs no carve-out from the
repository's MIT software licence. The CC BY-SA notice that governs the
atlas-derived families does NOT extend to it.

MPFB2 is a Blender add-on used at authoring time only. It is not redistributed
by this repository, and the generated `.blend` does not require it at runtime.

| Component | Source | Licence | Verified |
|---|---|---|---|
| MPFB2 add-on v2.0.17 | Blender extension platform, `add-on-mpfb-v2.0.17.zip`, 45,031,536 bytes | CC0 | SHA-256 `4f0a879d64a39bf646fbf5f53601ac678855da329d650617dca5737548239a87`, matching the hash published in the download URL |
| MakeHuman system assets | `files.makehumancommunity.org`, `makehuman_system_assets_cc0.zip`, 280,737,770 bytes | CC0 | 517 entries: 153 clothes, 92 skins, plus eyes, hair, teeth, tongue, eyebrows, eyelashes, proxymeshes |
| `short02` hair (from the system assets above, as installed with MPFB2) | `hair/short02/`: `short02.mhclo` 119,240 bytes, `short02.obj` 139,742, `short02_diffuse.png` 3,553,543, `short02_normal.png` 1,626,745, `short02.mhmat` 1,323 | CC0 | Each file's header records its explicit CC0 release (September 2020), and the pack manifest `makehuman_system_assets.json` lists `short02` with `"license": "CC0"`. SHA-256: `.mhclo` `625736cdb73e6d094df6e5a2df18f371781f1d2cd37b0ae15795c5d7051c3ec2`, `.obj` `48f979114adfa712165a69cc55c45a70831af1fb3cba8e2a89120f0c87407b64`, diffuse `47fe33831a3929567c733356dd66243116e05df2ace1f884ddca0080b728229f`, normal `2cfac7619f8eec77dd90df979d912415058f4f0fc16940cba40a8eb1ae6d74b5`, `.mhmat` `2ed04c8aad9c1a35d858ca72091525d32b1da3b61b5a031634dd528fd8530f6d` |

The base mesh is MakeHuman's, which every MakeHuman character shares by design,
so its 19,158-vertex topology matches the Maya demo's. The morphology is not
Maya's: the phenotype is neutral gender, universal race, average build, with
breast shaping disabled. The CC0 `female_sportsuit01` was used only as a fitting
reference during early development. The earlier figure painted clothing onto
the body. The current top and shorts are separate surfaces derived directly
from the saved CC0 body, with original cutting, fitting, hem and shader code in
`tools/blender/mpfb_clothing.py`; they introduce no additional external asset.
See [MPFB_FIGURE.md](MPFB_FIGURE.md) for construction and verification details.

Everything above the body - the landmark marks, the lighting, the
gate-derived camera framing, and the 210-frame action with authored shoulder
elevation - is original work under the repository's MIT licence. The rig has
no scapula bone and does not model anatomical scapulohumeral rhythm.

The upgraded presentation look (`tools/blender/upgrade_mpfb_figure_look.py`)
adds the CC0 `short02` hair above. It is fitted to the saved body the way MPFB
fits MakeHuman clothes, follows the head bone, and has its two textures packed
into the output `.blend`. The skin, garment colours, lights and seamless studio
backdrop of that look are original work under the MIT licence; it uses no other
external asset.

This is an instructional demonstration. It is not clinically validated, no
clinician has reviewed it, and it makes no claim of medical accuracy.

### Brown eyes in the 2026-10-09 presentation candidates

`tools/blender/polish_mpfb_presentation.py` adds MakeHuman's `high-poly` eyes
and `brown` eye material from the installed MPFB system assets. The `.mhclo`,
`.obj` and `.mhmat` headers explicitly release the mesh/material asset as CC0
(September 2020). The texture is named by that CC0 material. The eye texture
is packed into each candidate `.blend`; MPFB is not needed to open it.

| Source path within the installed `eyes` directory | SHA-256 |
| --- | --- |
| `high-poly/high-poly.mhclo` | `b183cfe37120ab726f9b3f2ea6cd3a64c44ce7b4bd91a77c841cf70c04f83a0d` |
| `high-poly/high-poly.obj` | `da2493215b708a344c33dc72f2a9a5b8fa985dcc5a70ad3b208995cf871da8e1` |
| `materials/brown.mhmat` | `4abad93ce50541c08127721e77bce035640c9f16bed16cd0f5524b1cd5908465` |
| `materials/brown_eye.png` | `4659691c7295ad6206c78b003e5fd0e5f91dcd53032fa914a229bb48cabe424b` |

Rest-space skin colour variation and wall-light adjustments introduce no
additional external assets. See [MPFB_PRESENTATION.md](MPFB_PRESENTATION.md)
for the candidate workflow and its acceptance boundary.
