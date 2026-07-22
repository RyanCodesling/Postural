"""
MoveNet Thunder adapter via the TFLite interpreter (LiteRT) — the runtime
MoveNet is built to run in.

The TF-Hub SavedModel path ran at ~0.4 fps because each call went through the
full TensorFlow runtime (graph rebuild/eager overhead per frame). The TFLite
interpreter runs a pre-frozen model with no per-frame graph work, so it is far
faster on CPU. It is the SAME MoveNet Thunder model and weights (float16), so
keypoints/accuracy are unchanged — only speed improves.

MoveNet wants a square input whose dims are a multiple of 32; we letterbox
(aspect-preserving resize + center pad) to 256x256 so pose geometry is NOT
distorted, then invert the letterbox to recover ORIGINAL-image normalized
coordinates (x/width, y/height) — the convention every backend reports. Output
keypoints are COCO-17; only ears/shoulders/hips are mapped.
"""
from __future__ import annotations

import pathlib

import numpy as np

from comparison.backends.base import empty_frame
from comparison.landmark_map import COCO_17
from comparison.metrics import Point

_INPUT = 256
_MODEL = pathlib.Path(__file__).resolve().parents[1] / "models" / "movenet_thunder_f16.tflite"
_URL = ("https://tfhub.dev/google/lite-model/movenet/singlepose/thunder/"
        "tflite/float16/4?lite-format=tflite")


def _load_interpreter(model_path: str):
    """Return an allocated TFLite interpreter, trying LiteRT then TF's bundled one."""
    last = None
    for importer in (
        lambda: __import__("ai_edge_litert.interpreter", fromlist=["Interpreter"]).Interpreter,
        lambda: __import__("tensorflow", fromlist=["lite"]).lite.Interpreter,
        lambda: __import__("tflite_runtime.interpreter", fromlist=["Interpreter"]).Interpreter,
    ):
        try:
            Interpreter = importer()
        except Exception as e:  # noqa: BLE001
            last = e
            continue
        itp = Interpreter(model_path=model_path)
        itp.allocate_tensors()
        return itp
    raise RuntimeError(f"no TFLite interpreter available: {last}")


def _ensure_model() -> str:
    if not _MODEL.exists():
        import urllib.request
        _MODEL.parent.mkdir(parents=True, exist_ok=True)
        req = urllib.request.Request(_URL, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=120) as r, open(_MODEL, "wb") as f:
            f.write(r.read())
    return str(_MODEL)


class MoveNetBackend:
    name = "movenet_thunder"

    def __init__(self):
        self._itp = _load_interpreter(_ensure_model())
        self._in = self._itp.get_input_details()[0]
        self._out = self._itp.get_output_details()[0]
        self._in_dtype = self._in["dtype"]  # float32 for the float16 model

    def infer(self, frame_bgr) -> dict:
        import cv2

        h, w = frame_bgr.shape[:2]
        rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)

        # Aspect-preserving resize + center pad to a square canvas (pixels 0-255).
        scale = _INPUT / max(h, w)
        nh, nw = max(int(round(h * scale)), 1), max(int(round(w * scale)), 1)
        resized = cv2.resize(rgb, (nw, nh))
        pad_t = (_INPUT - nh) // 2
        pad_l = (_INPUT - nw) // 2
        canvas = np.zeros((_INPUT, _INPUT, 3), dtype=np.uint8)
        canvas[pad_t:pad_t + nh, pad_l:pad_l + nw] = resized

        # MoveNet expects values in [0, 255]; cast (not normalize) to the model's dtype.
        inp = np.expand_dims(canvas, axis=0).astype(self._in_dtype)
        self._itp.set_tensor(self._in["index"], inp)
        self._itp.invoke()
        out = self._itp.get_tensor(self._out["index"])[0, 0]  # (17, 3): y, x, score

        res = {}
        for name, idx in COCO_17.items():
            ky, kx, score = out[idx]
            # canvas-normalized -> canvas px -> remove pad -> original normalized
            ox = (kx * _INPUT - pad_l) / nw
            oy = (ky * _INPUT - pad_t) / nh
            res[name] = Point(float(ox), float(oy), float(score))
        return res if res else empty_frame()
