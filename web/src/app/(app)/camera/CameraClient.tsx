"use client";

import { useEffect, useRef, useState } from "react";

type CamDevice = MediaDeviceInfo;

export default function CameraClient() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [mounted, setMounted] = useState(false); // ✅ add
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [devices, setDevices] = useState<CamDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const [useFrontCameraHint, setUseFrontCameraHint] = useState(true);
  const [mirror, setMirror] = useState(true);

  const canUseMediaDevices =
    mounted &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia;

  async function stopCamera() {
    try {
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    } catch {
      // ignore
    }
  }

  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    const cams = all.filter((d) => d.kind === "videoinput");
    setDevices(cams);
    if (!selectedDeviceId && cams[0]?.deviceId) setSelectedDeviceId(cams[0].deviceId);
  }

  async function startCamera(deviceId?: string) {
    if (!canUseMediaDevices) {
      setError("Camera API not available in this browser/environment.");
      return;
    }

    setIsStarting(true);
    setError(null);
    await stopCamera();

    try {
      const constraints: MediaStreamConstraints = {
        video: deviceId
          ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
          : {
              facingMode: useFrontCameraHint ? "user" : "environment",
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      await listCameras();
    } catch (e: any) {
      const name = e?.name || "Error";
      if (name === "NotAllowedError") setError("Permission denied. Please allow camera access.");
      else if (name === "NotFoundError") setError("No camera found on this device.");
      else if (name === "NotReadableError")
        setError("Camera is already in use by another app (Zoom/Meet/OBS).");
      else setError(`Failed to start camera: ${name}`);
    } finally {
      setIsStarting(false);
    }
  }

  // ✅ Mount gate: server + first client render match
  useEffect(() => {
    setMounted(true);
  }, []);

  // ✅ Start camera only after mounted
  useEffect(() => {
    if (!mounted) return;
    startCamera();
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // ✅ Restart when device changes (after we have device list)
  useEffect(() => {
    if (!mounted) return;
    if (!selectedDeviceId) return;
    if (devices.length > 0) startCamera(selectedDeviceId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, selectedDeviceId]);

  // ✅ IMPORTANT: show a stable “Loading…” UI until mounted
  if (!mounted) {
    return (
      <main className="min-h-screen p-6 bg-gray-50">
        <div className="max-w-5xl mx-auto">
          <div className="p-4 rounded border bg-white">Loading camera…</div>
        </div>
      </main>
    );
  }


  return (
    <main className="min-h-screen p-6 bg-gray-50">
      <div className="max-w-5xl mx-auto space-y-4">
        <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold">Camera</h1>
            <p className="text-gray-600">Webcam preview (foundation for pose estimation).</p>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => startCamera(selectedDeviceId || undefined)}
              disabled={isStarting}
              className="px-4 py-2 rounded bg-black text-white disabled:opacity-50"
            >
              {isStarting ? "Starting..." : "Start"}
            </button>
            <button
              onClick={stopCamera}
              className="px-4 py-2 rounded border border-gray-300 bg-white"
            >
              Stop
            </button>
          </div>
        </header>

        {!canUseMediaDevices && (
          <div className="p-4 rounded border bg-white">
            <p className="text-sm text-gray-700">
              Your browser/environment does not support camera access. Try Chrome/Edge.
            </p>
          </div>
        )}

        {error && (
          <div className="p-4 rounded border border-red-200 bg-red-50 text-red-800">
            {error}
          </div>
        )}

        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="lg:col-span-2">
            <div className="relative rounded-2xl overflow-hidden bg-black shadow">
              <video
                ref={videoRef}
                playsInline
                muted
                className={`w-full h-[420px] object-cover ${mirror ? "-scale-x-100" : ""}`}
              />
              <div className="absolute bottom-3 left-3 text-xs bg-black/60 text-white px-2 py-1 rounded">
                Tip: Stand ~2–3 meters away for full-body capture.
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="p-4 rounded-2xl bg-white shadow-sm border">
              <h2 className="font-semibold mb-3">Controls</h2>

              <label className="block text-sm font-medium mb-1">Camera device</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="w-full border rounded px-3 py-2 bg-white"
              >
                {devices.length === 0 ? (
                  <option value="">(Allow camera access to list devices)</option>
                ) : (
                  devices.map((d) => (
                    <option key={d.deviceId} value={d.deviceId}>
                      {d.label || `Camera ${d.deviceId.slice(0, 6)}…`}
                    </option>
                  ))
                )}
              </select>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Mirror preview</p>
                  <p className="text-xs text-gray-500">Useful for front camera UX</p>
                </div>
                <input
                  type="checkbox"
                  checked={mirror}
                  onChange={(e) => setMirror(e.target.checked)}
                  className="h-5 w-5"
                />
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Prefer front camera</p>
                  <p className="text-xs text-gray-500">Used when no device selected</p>
                </div>
                <input
                  type="checkbox"
                  checked={useFrontCameraHint}
                  onChange={(e) => setUseFrontCameraHint(e.target.checked)}
                  className="h-5 w-5"
                />
              </div>

              <button
                onClick={() => startCamera()}
                className="mt-4 w-full px-4 py-2 rounded bg-gray-900 text-white"
              >
                Restart with preference
              </button>
            </div>

            <div className="p-4 rounded-2xl bg-white shadow-sm border">
              <h2 className="font-semibold mb-2">Production notes</h2>
              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                <li>Camera access requires HTTPS on real websites (localhost is OK).</li>
                <li>If it says “in use,” close Zoom/Meet/OBS then restart.</li>
              </ul>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
