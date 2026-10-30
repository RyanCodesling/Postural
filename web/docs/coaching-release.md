# Camera coaching update

The camera uses coaching_v21_trunk_lean_rest_reference. Lateral-raise
height guidance clears after correction in the same raise. Bilateral arm holds
guide each unfinished arm independently, with Raise this arm or Lower to
shoulder height. When both arms are below the band, or both above it, the cue
stays on the arm it went to first until that arm is corrected or finishes its
hold. Height cues and per-arm panel hints start only after a prescribed arm
earns time in the current set; restored in-set credit qualifies and a new set
must earn its own credit. Independent hold accrual is preserved.

Turn to face the camera now shows once the hip line has read 15 degrees or more
for half a second, and clears once it reads below 10. A hand or knee hidden
while the reading is 15 or more gets the same message in place of the capture
check's own. A latched warning that is not on screen appears on an empty
screen only once its reading is back at its switch-on level, and takes over
from a cue already shown only while its reading has not yet recovered past its
switch-off level; a cue already shown is unaffected. On a lateral raise,
Stop at shoulder height is boxed around the arm that is past shoulder height,
no longer across both wrists; with both arms too high, it stays on the arm it
went to first while that arm is still too high. Saved videos redraw it as it
was shown: around the arm from this update, across both wrists before it.

Keep your torso upright now measures the lean from the trunk line held during
the calibration, not from the camera tilt saved there, so a lean already
present at calibration no longer counts toward the cue; without a calibration
the cue reads as before. The cue no longer waits 3 s after it clears, so a
lean to the other side straight after the first is shown too. The score,
stored measurements and trends keep the earlier reading.

This update also includes dark-picture, named-hand and named-arm tracking
messages, prescribed-hand mapping, and a new-session freshness check. An older
camera page receives app_updated and must reload before starting a session.
The model, measurement thresholds, scoring and stored history are unchanged.

Model visibility can remain high for a physically hidden hand. The update
does not establish reliable occlusion detection. Shoulder-asymmetry sensitivity
is unchanged. The existing recovery badge can lag raw-ready hold credit;
the experimental badge-gated counting change is excluded.

Run npm run verify:coaching, TypeScript checking, relevant lint and npm run
build against the selected release. Automated transport fixtures and synthetic
pose tests do not establish live-camera or clinical acceptance. A release
rehearsal should hard-refresh, confirm current coaching provenance, and check
Start, Resume after a page reload, End, results and saved progress in a normal
signed-in run.

This package covers camera guidance, its tests and the existing camera setup
tour, including chest-height and facing-camera guidance. Separate demo-clock,
session-date correction, email and staff-report changes are not included. No database migration is required by the coaching changes.

Comments, one test name and two README lines in eight other files are
reworded without changing their code.
