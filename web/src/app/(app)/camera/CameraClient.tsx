"use client";

import { useEffect, useRef, useState } from "react";

type CamDevice = MediaDeviceInfo;

const EXERCISES = [
  "Lateral Arm Raises",
  "Overhead Arm Raises",
  "Shoulder Shrugs",
  "Neck Lateral Flexion",
  "Standing Side Bends",
  "Arm Abduction at 90°",
];

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
  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");
  const [selectedExercise, setSelectedExercise] = useState<string>(EXERCISES[0]);

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
  // ✅ Update current time and date
  useEffect(() => {
    const updateDateTime = () => {
      const now = new Date();
      setCurrentTime(now.toLocaleTimeString());
      setCurrentDate(now.toLocaleDateString());
    };
    updateDateTime();
    const interval = setInterval(updateDateTime, 1000);
    return () => clearInterval(interval);
  }, []);
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
            
            </div>

            <div className="mt-4 p-4 rounded-2xl bg-white shadow-sm border">
              <h2 className="font-semibold mb-3">Measurements</h2>
              <div className="grid grid-cols-3 gap-4">
                <div className="p-3 rounded bg-gray-50 border">
                  <p className="text-xs text-gray-600">Neck Angle</p>
                  <p className="text-lg font-bold text-gray-900">--°</p>
                </div>
                <div className="p-3 rounded bg-gray-50 border">
                  <p className="text-xs text-gray-600">Spine Curve</p>
                  <p className="text-lg font-bold text-gray-900">--°</p>
                </div>
                <div className="p-3 rounded bg-gray-50 border">
                  <p className="text-xs text-gray-600">Posture Score</p>
                  <p className="text-lg font-bold text-gray-900">--/100</p>
                </div>
              </div>
            </div>

            <div className="mt-4 p-4 rounded-2xl bg-white shadow-sm border">
              <h2 className="font-semibold mb-3">Session Progress</h2>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm text-gray-600">Sets</p>
                    <p className="text-2xl font-bold text-gray-900">3</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-gray-600">Reps</p>
                    <p className="text-2xl font-bold text-gray-900">12</p>
                  </div>
                </div>
                
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <p className="text-sm text-gray-600">Overall Progress</p>
                    <p className="text-sm font-semibold text-gray-900">65%</p>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
                    <div className="bg-gradient-to-r from-blue-500 to-purple-600 h-full rounded-full" style={{ width: '65%' }}></div>
                  </div>
                </div>

                <div className="p-3 rounded bg-blue-50 border border-blue-200 text-center">
                  <p className="text-xs text-gray-600 mb-1">Timer</p>
                  <p className="text-3xl font-bold text-blue-600">05:32</p>
                </div>
                <div className="p-3 rounded bg-green-50 border border-green-200">
                  <div className="flex justify-between items-center">
                    <div className="text-center flex-1">
                      <p className="text-xs text-gray-600 mb-1">Local Time</p>
                      <p className="text-lg font-semibold text-green-600">{currentTime}</p>
                    </div>
                    <div className="text-center flex-1">
                      <p className="text-xs text-gray-600 mb-1">Local Date</p>
                      <p className="text-lg font-semibold text-green-600">{currentDate}</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-4">
            <div className="p-4 rounded-2xl bg-white shadow-sm border">
              <h2 className="font-semibold mb-3">Controls</h2>

              <label className="block text-sm font-medium mb-1">Exercise</label>
              <select
                value={selectedExercise}
                onChange={(e) => setSelectedExercise(e.target.value)}
                className="w-full border rounded px-3 py-2 bg-white mb-4"
              >
                {EXERCISES.map((exercise) => (
                  <option key={exercise} value={exercise}>
                    {exercise}
                  </option>
                ))}
              </select>

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
              <h2 className="font-semibold mb-3">Video Reference</h2>
              <div className="bg-gray-100 rounded-lg p-6 text-center mb-4">
                <h3 className="text-xl font-semibold text-gray-800">{selectedExercise}</h3>
              </div>
              <div className="relative rounded-lg overflow-hidden bg-gray-200 shadow">
                <video
                  className="w-full h-[240px] object-cover bg-gray-300"
                  controls
                  controlsList="nodownload"
                >
                  <source src="/sample-video.mp4" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>
              <p className="text-xs text-gray-500 mt-2">
                Reference video for posture comparison
              </p>
              <div className="mt-4 flex gap-3">
                <button className="flex-1 px-4 py-2 rounded bg-green-600 text-white font-medium hover:bg-green-700">
                  Start Session
                </button>
                <button className="flex-1 px-4 py-2 rounded bg-red-600 text-white font-medium hover:bg-red-700">
                  End Session
                </button>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
