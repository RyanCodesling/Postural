# Exercise demonstration source assets

The Reference Guide uses six accepted MPFB figure animations. Their editable
Blender scenes, original CC0 hair/eye inputs and exact MP4s are versioned in
this repository. Start with [GUIDE_ASSETS.md](GUIDE_ASSETS.md) for the source
map, asset manifest, verification command and render instructions.

- [Published asset manifest](reference/guide_assets.json): paths, byte sizes,
  SHA-256 hashes, timelines and rendering settings.
- [MPFB_FIGURE.md](MPFB_FIGURE.md): base body, rig, garments and lateral-raise
  construction.
- [MPFB_EXERCISE_DRAFTS.md](MPFB_EXERCISE_DRAFTS.md): exercise animation
  construction and dated engineering checks.
- [MPFB_PRESENTATION.md](MPFB_PRESENTATION.md): appearance and arm/hand
  refinements, including earlier review candidates.
- [THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md): MakeHuman provenance and
  historical licensing notices.

The original base figure is `ex_001_figure_mpfb.blend`. Each accepted render
has its own saved scene, identified in the manifest. Images needed by those
scenes are packed, so rendering a saved source does not require MPFB.
The original CC0 hair and eye files are also available under
`vendor/makehuman/` for rebuilding the appearance.

The abandoned ecorche, anatomy and muscle-atlas builders, inspectors,
renderers and unused research-reference JSON have been removed. Earlier
versions remain in Git history. Their historical attribution and
[CC BY-SA notice](LICENSE-CC-BY-SA-4.0.md) are retained; no atlas-derived
model or media is part of the published guide asset set. The old Maya,
Ada and procedural-figure tools are separate legacy experiments and are
not used by the Reference Guide.

Generated PNG sequences, editor backups, superseded renders and legacy GLBs
remain ignored. Only the explicit saved-scene and accepted-video allowlists
in `.gitignore` are versioned.

These are illustrative exercise animations with authored motion and timing.
They are not clinically validated demonstrations or patient prescriptions.
Therapist instructions override the guide.
