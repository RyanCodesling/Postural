# Browser vision models

These MediaPipe task bundles are served locally so exercise frames remain in
the browser inference path.

| File | Use | Source |
|---|---|---|
| `pose_landmarker_full.task` | Authoritative whole-body tracking | Existing Postural Pose Landmarker asset |
| `face_landmarker.task` | Opt-in staff-only `ex_004` shadow diagnostic | Google MediaPipe Face Landmarker float16 latest bundle |

`face_landmarker.task` was retrieved from Google's official model bucket:

`https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task`

SHA-256:

`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`

The Face model does not control feedback, hold timing, scoring, persistence,
or ML inputs. Its browser output is diagnostic until separately validated.
