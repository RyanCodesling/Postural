"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/AuthContext";
import {
  PoseLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "@mediapipe/tasks-vision";

import { evaluateCaptureReadiness } from "@/lib/pose/captureReadiness";
import { drawCutoutOverlay } from "@/lib/pose/drawFramingOverlay";

type CamDevice = MediaDeviceInfo;

interface Exercise {
  id: string;
  name: string;
  description: string;
  duration: number;
  difficulty: "easy" | "medium" | "hard";
}

interface PatientExercise {
  exerciseId: string;
  patientId: string;
  assignedDate: string;
  status: "pending" | "in-progress" | "completed";
}

export default function CameraClient() {
  const { user } = useAuth();

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const requestRef = useRef<number | null>(null);
  const landmarkerRef = useRef<PoseLandmarker | null>(null);

  const [mounted, setMounted] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modelLoaded, setModelLoaded] = useState(false);

  // Capture readiness (HTML overlay, never mirrored)
  const [captureOk, setCaptureOk] = useState(true);
  const [captureMessage, setCaptureMessage] = useState("Captured");

  const lastBadCaptureAtRef = useRef<number>(0);
  const stableOkSinceRef = useRef<number>(0);

  const lastCaptureOkRef = useRef<boolean>(true);
  const lastCaptureMsgRef = useRef<string>("Captured");

  const [devices, setDevices] = useState<CamDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>("");

  const [useFrontCameraHint, setUseFrontCameraHint] = useState(true);
  const [mirror, setMirror] = useState(true);

  const [currentTime, setCurrentTime] = useState<string>("");
  const [currentDate, setCurrentDate] = useState<string>("");

  const [assignedExercises, setAssignedExercises] = useState<Exercise[]>([]);
  const [selectedExercise, setSelectedExercise] = useState<string>("");

  // Placeholder metrics (wire later)
  const neckAngle = "--";
  const spineCurve = "--";
  const postureScore = "--";
  const sets = 3;
  const reps = 12;
  const progressPct = 65;
  const timer = "05:32";

  // ---------------------------------------------------------
  // Init model
  // ---------------------------------------------------------
  useEffect(() => {
    const initLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm"
        );
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: "/models/pose_landmarker_lite.task",
            delegate: "GPU",
          },
          runningMode: "VIDEO",
          numPoses: 1,
        });
        landmarkerRef.current = landmarker;
        setModelLoaded(true);
      } catch (err) {
        console.error(err);
        setError("AI Model failed. Check public/models/pose_landmarker_lite.task");
      }
    };
    initLandmarker();
  }, []);

  // Load assigned exercises (localStorage)
  useEffect(() => {
    if (!user?.id) return;

    try {
      const storedExercises = localStorage.getItem("admin_exercises");
      const exercises: Exercise[] = storedExercises ? JSON.parse(storedExercises) : [];

      const storedAssignments = localStorage.getItem("patient_exercises");
      const assignments: PatientExercise[] = storedAssignments ? JSON.parse(storedAssignments) : [];
      const patientAssignments = assignments.filter((a) => a.patientId === user.id);

      const assigned = exercises.filter((e) =>
        patientAssignments.some((a) => a.exerciseId === e.id)
      );

      setAssignedExercises(assigned);
      if (assigned.length > 0 && !selectedExercise) setSelectedExercise(assigned[0].id);
    } catch (err) {
      console.error("Error loading exercises:", err);
    }
  }, [user?.id, selectedExercise]);

  const commitCaptureState = (ok: boolean, msg: string) => {
    if (lastCaptureOkRef.current !== ok) {
      lastCaptureOkRef.current = ok;
      setCaptureOk(ok);
    }
    if (lastCaptureMsgRef.current !== msg) {
      lastCaptureMsgRef.current = msg;
      setCaptureMessage(msg);
    }
  };

  // ---------------------------------------------------------
  // AI loop
  // ---------------------------------------------------------
  const predictWebcam = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const landmarker = landmarkerRef.current;
    if (!video || !canvas || !landmarker) return;

    if (video.readyState === 4 && video.videoWidth > 0) {
      if (canvas.width !== video.videoWidth) canvas.width = video.videoWidth;
      if (canvas.height !== video.videoHeight) canvas.height = video.videoHeight;

      const ctx = canvas.getContext("2d");
      if (ctx) {
        const results = landmarker.detectForVideo(video, performance.now());

        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const drawingUtils = new DrawingUtils(ctx);

        if (results.landmarks && results.landmarks.length > 0) {
          const landmarks = results.landmarks[0];

          drawingUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS, {
            color: "#00FF00",
            lineWidth: 3,
          });
          drawingUtils.drawLandmarks(landmarks, {
            color: "#FF0000",
            lineWidth: 1,
            radius: 3,
          });

          const r = evaluateCaptureReadiness(landmarks as any, canvas.width, canvas.height);

          const now = performance.now();
          if (!r.ok) {
            lastBadCaptureAtRef.current = now;
            stableOkSinceRef.current = 0;
            commitCaptureState(false, r.message);
          } else {
            if (stableOkSinceRef.current === 0) stableOkSinceRef.current = now;
            const okStable = now - stableOkSinceRef.current > 400;
            const badGone = now - lastBadCaptureAtRef.current > 400;
            if (okStable && badGone) commitCaptureState(true, "Captured");
          }

          if (!r.ok) {
            drawCutoutOverlay(ctx, canvas.width, canvas.height, r);
          }

          // Downstream logic later: only if (r.ok) { math engine + reps }
        } else {
          commitCaptureState(false, "No person detected. Step into the frame.");
        }

        ctx.restore();
      }
    }

    requestRef.current = requestAnimationFrame(predictWebcam);
  };

  // ---------------------------------------------------------
  // Camera helpers
  // ---------------------------------------------------------
  const canUseMediaDevices =
    mounted && typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

  async function stopCamera() {
    try {
      if (videoRef.current) videoRef.current.srcObject = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;

      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
        requestRef.current = null;
      }
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
          : { facingMode: useFrontCameraHint ? "user" : "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadeddata = () => {
          videoRef.current?.play();
          predictWebcam();
        };
      }

      await listCameras();
    } catch (e: any) {
      const name = e?.name || "Error";
      if (name === "NotAllowedError") setError("Permission denied. Please allow camera access.");
      else if (name === "NotFoundError") setError("No camera found on this device.");
      else if (name === "NotReadableError") setError("Camera is already in use by another app.");
      else setError(`Failed to start camera: ${name}`);
    } finally {
      setIsStarting(false);
    }
  }

  useEffect(() => {
    setMounted(true);
    return () => {
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  if (!mounted) {
    return (
      <main className="h-screen overflow-hidden bg-gray-50 p-4">
        <div className="w-full">
          <div className="p-4 rounded border bg-white">Loading camera…</div>
        </div>
      </main>
    );
  }

  const selectedExerciseObj = assignedExercises.find((e) => e.id === selectedExercise);

  return (
    <main className="h-screen overflow-hidden bg-gray-50">
      {/* Full-width container (no max-w) */}
      <div className="h-full w-full px-4 lg:px-6 py-4 flex flex-col gap-3">
        {/* Header stays compact so content fits */}
        <header className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-bold leading-tight">Camera</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1">
              <span className={`w-2 h-2 rounded-full ${modelLoaded ? "bg-green-500" : "bg-orange-500"}`} />
              <span className="text-xs text-gray-600">{modelLoaded ? "AI Ready" : "Loading Model..."}</span>
              <span
                className={`px-2 py-0.5 rounded text-xs font-semibold ${
                  captureOk ? "bg-green-100 text-green-800" : "bg-yellow-100 text-yellow-800"
                }`}
                title={captureMessage}
              >
                {captureOk ? "Capture OK" : "Paused"}
              </span>
              {!captureOk && <span className="text-xs text-gray-600 truncate">{captureMessage}</span>}
            </div>
          </div>

          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => startCamera(selectedDeviceId || undefined)}
              disabled={isStarting || !modelLoaded}
              className="px-3 py-2 rounded bg-black text-white text-sm disabled:opacity-50"
            >
              {isStarting ? "Starting..." : "Start"}
            </button>
            <button
              onClick={stopCamera}
              className="px-3 py-2 rounded border border-gray-300 bg-white text-sm"
            >
              Stop
            </button>
          </div>
        </header>

        {/* Errors (still no scrolling; keep compact) */}
        {error && (
          <div className="px-3 py-2 rounded border border-red-200 bg-red-50 text-red-800 text-sm">
            {error}
          </div>
        )}

        {/* Main content fills remaining height */}
        <section className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-3">
          {/* Camera panel */}
          <div className="lg:col-span-9 min-h-0">
            <div className="relative h-full rounded-2xl overflow-hidden bg-black shadow">
              {/* Mirrored visual layer only */}
              <div className={`absolute inset-0 ${mirror ? "-scale-x-100" : ""}`}>
                <video ref={videoRef} playsInline muted className="absolute inset-0 w-full h-full object-cover" />
                <canvas ref={canvasRef} className="absolute inset-0 w-full h-full object-cover" />
              </div>

              {/* Non-mirrored message overlay */}
              {!captureOk && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 px-6 py-3 rounded-xl bg-black/75 text-white text-lg font-semibold shadow-lg">
                  {captureMessage}
                </div>
              )}

              {/* Compact overlay metrics (no extra vertical space) */}
              <div className="absolute bottom-3 left-3 z-20 flex flex-wrap gap-2">
                <Chip label="Neck" value={`${neckAngle}°`} />
                <Chip label="Spine" value={`${spineCurve}°`} />
                <Chip label="Score" value={`${postureScore}/100`} />
              </div>

              {/* Compact overlay progress */}
              <div className="absolute bottom-3 right-3 z-20 flex flex-col gap-2 items-end">
                <div className="flex gap-2">
                  <Chip label="Sets" value={`${sets}`} />
                  <Chip label="Reps" value={`${reps}`} />
                  <Chip label="Time" value={timer} />
                </div>
                <div className="w-72 bg-black/70 rounded-xl px-5 py-4 shadow-lg">
                  <div className="flex items-center justify-between text-sm text-white/90">
                    <span>Progress</span>
                    <span className="font-bold">{progressPct}%</span>
                  </div>
                  <div className="mt-3 h-3 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-white/85" style={{ width: `${progressPct}%` }} />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar panel (must fit without scrolling) */}
          <aside className="lg:col-span-3 min-h-0 flex flex-col gap-3">
            <div className="p-3 rounded-2xl bg-white shadow-sm border">
              <h2 className="font-semibold text-sm mb-2">Controls</h2>

              <label className="block text-xs font-medium mb-1">Exercise</label>
              {assignedExercises.length === 0 ? (
                <div className="w-full p-2 rounded border border-yellow-200 bg-yellow-50 text-yellow-800 text-xs">
                  No exercises assigned yet.
                </div>
              ) : (
                <select
                  value={selectedExercise}
                  onChange={(e) => setSelectedExercise(e.target.value)}
                  className="w-full border rounded px-2 py-2 bg-white text-sm"
                >
                  {assignedExercises.map((exercise) => (
                    <option key={exercise.id} value={exercise.id}>
                      {exercise.name}
                    </option>
                  ))}
                </select>
              )}

              {selectedExerciseObj && (
                <div className="mt-2 p-2 rounded bg-blue-50 border border-blue-200 text-xs text-gray-700">
                  <div className="font-semibold text-gray-900">{selectedExerciseObj.name}</div>
                  <div className="line-clamp-3 mt-1">{selectedExerciseObj.description}</div>
                  <div className="mt-2 flex gap-2 text-[11px] text-gray-600">
                    <span>⏱ {selectedExerciseObj.duration}s</span>
                    <span>• {selectedExerciseObj.difficulty}</span>
                  </div>
                </div>
              )}

              <label className="block text-xs font-medium mt-3 mb-1">Camera device</label>
              <select
                value={selectedDeviceId}
                onChange={(e) => setSelectedDeviceId(e.target.value)}
                className="w-full border rounded px-2 py-2 bg-white text-sm"
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

              <div className="mt-3 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Mirror</p>
                  <p className="text-[11px] text-gray-500">Front cam feel</p>
                </div>
                <input
                  type="checkbox"
                  checked={mirror}
                  onChange={(e) => setMirror(e.target.checked)}
                  className="h-5 w-5"
                />
              </div>

              <div className="mt-2 flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium">Prefer front camera</p>
                  <p className="text-[11px] text-gray-500">When no device selected</p>
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
                className="mt-3 w-full px-3 py-2 rounded bg-gray-900 text-white text-sm"
              >
                Restart with preference
              </button>
            </div>

            {/* Reference + time/date compact, still no scrolling */}
            <div className="p-3 rounded-2xl bg-white shadow-sm border flex-1 min-h-0 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h2 className="font-semibold text-sm">Reference</h2>
                <div className="text-[11px] text-gray-600 text-right">
                  <div>{currentTime}</div>
                  <div>{currentDate}</div>
                </div>
              </div>

              <div className="rounded-lg overflow-hidden bg-gray-200 flex-1 min-h-0">
                <video className="w-full h-full object-cover bg-gray-300" controls controlsList="nodownload">
                  <source src="/sample-video.mp4" type="video/mp4" />
                  Your browser does not support the video tag.
                </video>
              </div>

              <div className="mt-2 flex gap-2">
                <button className="flex-1 px-3 py-2 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700">
                  Start
                </button>
                <button className="flex-1 px-3 py-2 rounded bg-red-600 text-white text-sm font-medium hover:bg-red-700">
                  End
                </button>
              </div>
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Chip({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-black/70 text-white rounded-xl px-5 py-3 shadow-lg">
      <div className="text-sm text-white/80">{label}</div>
      <div className="text-xl font-bold leading-tight">{value}</div>
    </div>
  );
}