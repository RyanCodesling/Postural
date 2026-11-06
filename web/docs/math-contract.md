# Pose math contracts

## Scalar compensation precision

Filtered normalized displacement channels retain three decimal places; angle
channels retain their existing one decimal place. In particular, the side-bend
shoulder/head-position residual must not be quantized in 0.1 increments before
comparison with a 0.04 warning threshold. The actual camera caller uses the same
precision helper covered by the regression test. Side-bend measurement hashes
include the new scalar precision version; other exercise hashes are unchanged.
Coaching provenance identifies the new processing version separately.

## Dynamic repetition quality V3

New writes identify `ml.features.extract.rep-v2`. V1 and V2 readers remain intact;
history is not recomputed. Raw-rule scoring and smoothed rep boundaries are unchanged.
The envelope itself is authoritative for its features, including when a new client
resumes a session whose start context recorded an older quality version.

For position samples, the dimensionless squared jerk is
`duration^5 / amplitude^2 * integral(jerk^2 dt)`, followed by negative natural log.
Duration is `(sampleCount - 1)/30`; amplitude is max minus min. This makes the
feature invariant to amplitude, position offset and time scaling in the continuous
limit. Tests include an independent analytic cosine reference, not just agreement
between the TypeScript and Python implementations.

The 30 Hz grid includes `targetSampleCount` and a temporal status. If any primary
target cannot be reconstructed under the existing 200 ms interpolation limit,
status is `gapped`: tempo, jerk, submovement count and phase-shape features are
null, and ML eligibility is false even if coverage exceeds 80%. Too-short or
constant series similarly use `insufficient-motion`. Observed compensation
summaries and coverage survive. No derivative is evaluated across a missing span.

## Coordinate migration remains incomplete

The live path still defaults to aspect 1. Optional aspect correction in the
geometry helpers is tested, but activation also requires coherent calibration,
all direct callers, threshold re-derivation, and replacement of the four coupled
fits in that coordinate system. The shoulder/head proxy changes with trunk and
ear-vector orientation, so its old slope cannot be converted by multiplying by
the frame aspect. Its corrected side-bend aggregation needs investigation before
adopting a replacement fit. Do not enable only the live geometry call or describe
current angles as anatomical measurements. Frame dimensions already exist in V4
traces; keep original normalized landmarks for in-frame checks.

Reference: [Hogan and Sternad, dimensionless jerk normalization](https://pmc.ncbi.nlm.nih.gov/articles/PMC3470860/).
