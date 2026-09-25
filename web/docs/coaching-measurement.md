# Coaching measurement foundation

This contract records existing behavior. It does not enable new coaching text,
phase gating, thresholds, aspect correction, or model inference.

## Storage and compatibility

- New sessions use context V3. `versions.coachingConfig` is a SHA-256 fingerprint
  of effective cue IDs, wording, priorities, timing defaults/overrides, rendered
  labels, and an explicit coaching algorithm version. The snapshot travels with
  it. Bump `COACHING_ALGORITHM_VERSION` for selector/latch/suppression/drawing
  semantic changes. Thresholds and metric geometry remain in the independent
  exercise measurement snapshot/version.
- The browser sends its executing configuration at Start. Legacy clients are
  accepted, with `source: server-default-unverified`. Each set stores the actual
  runtime snapshot, including when Resume uses a newer bundle than session creation.
- Context V1/V2, dynamic repetition quality V1/V2 and unversioned hold readers
  remain supported. Cue changes never enter `exerciseConfigVersion` or the
  therapist's comparable-session key.
- Isometric writers use `hold_quality_v2`. Existing fields remain at the root
  for SQL/UI compatibility. `primaryUnits: pipeline-units` disambiguates legacy
  `*Deg` names; `compensationScoreSource: smoothed-live-rule` describes the
  existing score aggregation honestly. Per-side angle statistics remain raw.
  `streakMode` distinguishes simultaneous-arm from either-side hold bookkeeping.
- Dynamic sets use `{version: "coaching_set_v1", coaching: ...}` in the same
  `set_events.hold_quality` JSONB. They have no hold-statistic fields. This avoids
  another table/migration/delivery channel for a set-scoped audit. Session detail
  returns outcome envelopes unchanged. A zero-credit audit attempt carries
  `auditOnly: true`; it is returned in `auditAttempts`, not `sets`. Session
  aggregates, calendar/trend eligibility, therapist roster activity and review
  scores exclude these attempts. Legacy unmarked sets and genuine one-sided
  partial holds still count as outcomes.
- The API validates finite numbers, ranges, tags, timing/order, movement and
  render context, and snapshot fingerprints. An otherwise valid set with an
  invalid envelope retains that exact envelope inside
  `quarantined_measurement_v1`, with its validation reason and audit-only marker.
  Its invalid quality fields are not available to quality aggregates. The API
  reports `quarantined` row indices; successful durable insertion lets the
  outbox acknowledge that evidence and continue delivering later sets. Invalid
  core set fields still use the existing row-rejection policy. No table,
  migration or new delivery channel is added.
  Provenance validates `messageRendered` as a boolean; the current configuration
  remains false. Accepting a future snapshot does not enable message rendering.

## What an observation establishes

`getMovementSnapshot()` reads current counter state, start/running maximum and
rest evidence without modifying counters. A plateau remains `ASCENDING`; there
is no invented peak phase. Bidirectional snapshots retain peak-sign attribution
and settle state. Isometric observations expose independent per-side eligibility.
The 300 ms counter continuity rule and 250 ms hold-time cap are unchanged.

The bounded `coaching_audit_v1` timeline records capture availability, movement,
suppression, selector time/reason/side, smoothed warning inputs and active latches,
and the labels returned **after actual canvas draw calls**. `declaredMessage` is
separate and remains unrendered. Raw analytical/ML inputs remain in the existing
raw trace and repetition-quality branches; warning inputs are not ML features.

Times use the browser performance clock plus a wall-clock origin. Equal adjacent
observations are coalesced, but intervals over 300 ms are explicit unknown gaps.
No absent cue is called a correction. Canvas-cleared capture loss, suppression,
no selection and inability to draw are distinct. A stopped camera is
`renderEvidence: unobserved`: a stale canvas may remain on screen, so a stop is
not evidence that a label disappeared. Draw calls alone do not prove that a
patient attended to or acted on a cue.

Coverage is explicitly `observed-portion-of-set`. At most 600 records are retained
per set; `droppedRecords` reports overflow. First/last sample timestamps and
`closedAtMs` expose unobserved head/tail intervals, including the final completion
frame (set finalization precedes that frame's draw). This is not a frame archive
or a complete-exposure/correction-latency estimator. In-flight observations are
memory-only until a set closes; reload can lose that portion. Once enqueued, the
existing durable outbox applies. End also saves an audit-only zero-credit attempt
without changing live counters or persisted outcome counts. Resume begins a new
observed portion and does not fabricate the pre-reload history.

## Automated verification and replay

From `web`:

```sh
npm run verify:coaching
npx tsc --noEmit --incremental false
npm run lint
npm run build
npm run replay:coaching -- --manifest pilot-manifest.json --out new-replay-directory
```

The verification command runs all existing TypeScript suites and the camera/API/
outbox/SQL writer-reader integration fixtures. It does not use a real camera or
database. Signed-in Start/Resume/End, permission/device behavior, trace export
and database readback still need a separate disposable occurrence.

`npm run verify:coaching:db` is a separate opt-in PostgreSQL check using the
configured `DATABASE_URL`. It executes production set writes/routes, aggregate,
detail, review and roster queries against connection-private temporary tables,
then checks trend grouping and the rendered consistency calendar. No public
rows or sequences are changed; temporary fixtures disappear on disconnect.
Authentication is a fixture here, so this is not signed-in browser acceptance.

The replay manifest declares `evidenceUse: "pilot-tuning"`, `tickOffsetsMs` and
`recordings`. Each recording supplies `id`, `sessionId`, `exerciseId`, `snapshot`
and `labels` paths relative to the manifest. Snapshots contain `sessions`, `rows`
(raw-frame database field names), and optional `reps`/`sets`. Label formats are
`source-windows` (analysis-frame/elapsed windows or core hold windows), `rep-events`
(intent joined to stored event windows, not exact physical boundaries), or
`windows` (explicit `startMs`, `endMs`, `intent`, with the original label source).
Optional `expectedRepCounts` pins independent side counts. Optional `baselineCamera`
compares against a preserved prior CameraClient source.

Replay executes the current camera loop and actual metric, filter, counter,
warning, selector, quality writer and overlay modules. Browser delivery, UI sinks,
prescription completion and persistence transport are fixtures. Historical traces
omit readiness-rejected frames and nose/knees: readiness cannot be independently
recomputed. Timing, missing indices, rejected rows, known baseline boundaries,
unknown pre-trace filter history and tick-phase sensitivity are reported explicitly.
All source/input hashes and verbatim labels are saved. Output requires a new
directory. The adapter never changes source recordings or fits a model/threshold.
These are tuning regressions and reconstructed draw calls, not held-out clinical
ground truth or measured historical cue exposure.
