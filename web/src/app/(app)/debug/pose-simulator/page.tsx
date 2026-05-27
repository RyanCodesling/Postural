import { getExerciseDefinition } from "@/lib/exercises/registry";

export default function PoseSimulatorPage() {
  const ex005 = getExerciseDefinition("ex_005");
  const ex006 = getExerciseDefinition("ex_006");

  if (!ex005 || ex005.kind !== "dynamic") {
    throw new Error("ex_005 dynamic registry definition is missing.");
  }
  if (!ex006 || ex006.kind !== "isometric") {
    throw new Error("ex_006 isometric registry definition is missing.");
  }

  const config = {
    ex005: {
      thresholds: ex005.primaryMetric.thresholds,
    },
    ex006: {
      band: ex006.isometric.targetBand,
    },
  };

  return (
    <main className="min-h-screen bg-slate-950 px-5 py-5 text-slate-100">
      <div className="mx-auto flex max-w-7xl flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-300">
              Postural Debug
            </p>
            <h1 className="text-2xl font-semibold tracking-tight">
              Pose Threshold Simulator
            </h1>
          </div>
          <div className="text-right text-xs text-slate-400">
            <p id="sim-ready" className="font-semibold text-orange-300">
              Controls: loading inline simulator
            </p>
            <p>Route: /debug/pose-simulator</p>
            <p>Standalone controls, no React hydration required.</p>
          </div>
        </header>

        <section className="grid grid-cols-1 gap-5 xl:grid-cols-2">
          <Exercise005Panel />
          <Exercise006Panel />
        </section>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `window.__POSE_SIM_CONFIG__ = ${JSON.stringify(config)};`,
        }}
      />
      <script dangerouslySetInnerHTML={{ __html: simulatorScript }} />
    </main>
  );
}

function Exercise005Panel() {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-slate-900">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">ex_005 Standing Side Bends</h2>
            <p className="text-sm text-slate-400">Head lateral displacement, bidirectional rep counting</p>
          </div>
          <div id="ex005-state" className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-200">
            WAITING_FOR_REP_START
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-slate-950">
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <rect width="100" height="100" fill="#0f172a" />
            <line x1="50" y1="10" x2="50" y2="82" stroke="#334155" strokeDasharray="2 3" />
            <path id="ex005-trunk-shape" fill="rgba(16,185,129,0.12)" stroke="#10b981" strokeWidth="1.2" />
            <path id="ex005-left-side-curve" fill="none" stroke="#10b981" strokeWidth="1.6" strokeLinecap="round" />
            <path id="ex005-right-side-curve" fill="none" stroke="#10b981" strokeWidth="1.6" strokeLinecap="round" />
            <path id="ex005-trunk-line" fill="none" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
            <line id="ex005-head-line" stroke="#c084fc" strokeWidth="1.8" strokeLinecap="round" />
            <circle id="ex005-head-circle" fill="rgba(192,132,252,0.16)" stroke="#c084fc" strokeWidth="1.1" />
            <line id="ex005-ear-line" stroke="#c084fc" strokeWidth="1.1" strokeLinecap="round" />
            <line id="ex005-shoulder-line" stroke="#f59e0b" strokeWidth="1.3" strokeLinecap="round" />
            <line id="ex005-hip-line" stroke="#38bdf8" strokeWidth="1.3" strokeLinecap="round" />
            <g id="ex005-points" />
            <text x="6" y="94" fill="#94a3b8" fontSize="4">Purple line = baseline-corrected hip-to-head lean</text>
          </svg>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <MetricBox label="baseline head lean" id="ex005-signed" />
            <MetricBox label="head offset" id="ex005-display-side" />
            <MetricBox label="rep tag side" id="ex005-rep-side" />
            <MetricBox label="counts" id="ex005-counts" />
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-950 p-4">
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-medium text-slate-300">Baseline head lean vs thresholds</span>
              <span id="ex005-abs" className="font-mono text-slate-400">0.0 deg</span>
            </div>
            <div className="relative h-4 rounded-full bg-white/10">
              <div id="ex005-fill" className="absolute left-0 top-0 h-4 rounded-full bg-emerald-500/60" />
              <div id="ex005-thresholds" />
            </div>
            <div id="ex005-threshold-labels" className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-400" />
          </div>

          <div className="space-y-3 rounded-lg border border-white/10 bg-slate-950 p-4">
            <ControlRow label="Manual head lean" id="ex005-angle" min="-35" max="35" value="0" unit="deg" />
            <ControlRow label="Shoulder-only tilt" id="ex005-shoulder-tilt" min="-30" max="30" value="0" unit="deg" />
            <ControlRow label="Playback peak" id="ex005-peak" min="8" max="32" value="25" unit="deg" />
            <div className="grid grid-cols-2 gap-2">
              <button id="ex005-left" type="button" className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950">Left rep</button>
              <button id="ex005-right" type="button" className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white">Right rep</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button id="ex005-cheat-demo" type="button" className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white">Shoulder cheat</button>
              <button id="ex005-head-demo" type="button" className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white">Head shift</button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button id="ex005-play" type="button" className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950">Play sequence</button>
              <button id="ex005-reset" type="button" className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white">Reset</button>
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-slate-950 p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Rep events</p>
            <div id="ex005-events" className="space-y-2 text-sm text-slate-500">No counted reps yet.</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Exercise006Panel() {
  return (
    <section className="overflow-hidden rounded-lg border border-white/10 bg-slate-900">
      <div className="border-b border-white/10 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">ex_006 Arm Abduction at 90 deg</h2>
            <p className="text-sm text-slate-400">Isometric T-pose, paired hold while both arms are in band</p>
          </div>
          <div id="ex006-state" className="rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-200">
            PAUSED
          </div>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="aspect-square overflow-hidden rounded-lg border border-white/10 bg-slate-950">
          <svg viewBox="0 0 100 100" className="h-full w-full">
            <rect width="100" height="100" fill="#0f172a" />
            <line x1="50" y1="14" x2="50" y2="78" stroke="#334155" strokeDasharray="2 3" />
            <line x1="42" y1="36" x2="58" y2="36" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
            <line x1="50" y1="36" x2="50" y2="66" stroke="#f8fafc" strokeWidth="2" strokeLinecap="round" />
            <polyline id="ex006-arm-poly" fill="none" stroke="#10b981" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
            <line x1="20" y1="36" x2="80" y2="36" stroke="#f59e0b" strokeDasharray="2 2" strokeWidth="0.8" />
            <g id="ex006-points" />
            <text x="6" y="94" fill="#94a3b8" fontSize="4">Orange line = 90 deg target height</text>
          </svg>
        </div>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2">
            <MetricBox label="left angle" id="ex006-left-metric" />
            <MetricBox label="right angle" id="ex006-right-metric" />
            <MetricBox label="band" id="ex006-band" />
            <MetricBox label="complete rule" id="ex006-complete" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <ArmStatusBox id="ex006-arms" />
            <PairedHoldBox id="ex006-paired-hold" />
          </div>

          <BandRow label="Left band check" id="ex006-left-band" />
          <BandRow label="Right band check" id="ex006-right-band" />

          <div className="space-y-3 rounded-lg border border-white/10 bg-slate-950 p-4">
            <ControlRow label="Left arm angle" id="ex006-left-angle" min="0" max="140" value="90" unit="deg" />
            <ControlRow label="Right arm angle" id="ex006-right-angle" min="0" max="140" value="90" unit="deg" />
            <ControlRow label="Hold target" id="ex006-target" min="5" max="60" value="30" unit="s" />
            <div className="grid grid-cols-3 gap-2">
              <button id="ex006-start" type="button" className="rounded-md bg-emerald-500 px-3 py-2 text-sm font-semibold text-slate-950">Start</button>
              <button id="ex006-pause" type="button" className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white">Pause</button>
              <button id="ex006-reset" type="button" className="rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white">Reset</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function MetricBox({ label, id }: { label: string; id: string }) {
  return (
    <div className="rounded-md border border-white/10 bg-slate-950 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p id={id} className="mt-1 text-lg font-semibold text-slate-100">--</p>
    </div>
  );
}

function ControlRow({
  label,
  id,
  min,
  max,
  value,
  unit,
}: {
  label: string;
  id: string;
  min: string;
  max: string;
  value: string;
  unit: string;
}) {
  return (
    <div className="block">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-300">{label}</span>
        <span id={`${id}-label`} className="font-mono text-slate-400">{value}{unit}</span>
      </div>
      <div className="grid grid-cols-[2.25rem_1fr_4.75rem_2.25rem] items-center gap-2">
        <button id={`${id}-minus`} type="button" className="rounded-md bg-white/10 px-2 py-1.5 text-sm font-semibold text-white">-</button>
        <input id={id} type="range" min={min} max={max} step="1" defaultValue={value} data-unit={unit} className="w-full accent-emerald-400" />
        <input id={`${id}-number`} type="number" min={min} max={max} step="1" defaultValue={value} data-unit={unit} className="w-full rounded-md border border-white/10 bg-slate-900 px-2 py-1.5 text-right text-sm text-white outline-none focus:border-emerald-400" />
        <button id={`${id}-plus`} type="button" className="rounded-md bg-white/10 px-2 py-1.5 text-sm font-semibold text-white">+</button>
      </div>
    </div>
  );
}

function ArmStatusBox({ id }: { id: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Arms</p>
        <p id={`${id}-status`} className="text-xs font-semibold text-emerald-300">both ready</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div id={`${id}-left`} className="rounded-md bg-emerald-400/15 px-3 py-2 text-center text-lg font-bold text-emerald-300">L</div>
        <div id={`${id}-right`} className="rounded-md bg-emerald-400/15 px-3 py-2 text-center text-lg font-bold text-emerald-300">R</div>
      </div>
    </div>
  );
}

function PairedHoldBox({ id }: { id: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950 p-3">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Paired hold</p>
        <p id={`${id}-status`} className="text-xs font-semibold text-emerald-300">holding</p>
      </div>
      <p id={`${id}-seconds`} className="text-2xl font-bold">0s</p>
      <div className="mt-2 h-2 rounded-full bg-white/10">
        <div id={`${id}-fill`} className="h-2 rounded-full bg-emerald-400" />
      </div>
    </div>
  );
}

function BandRow({ label, id }: { label: string; id: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-950 p-3">
      <div className="mb-2 flex items-center justify-between text-xs">
        <span className="font-medium text-slate-300">{label}</span>
        <span id={`${id}-status`} className="text-emerald-300">in band</span>
      </div>
      <div className="relative h-4 rounded-full bg-white/10">
        <div id={`${id}-zone`} className="absolute top-0 h-4 bg-emerald-500/35" />
        <div id={`${id}-marker`} className="absolute top-[-4px] h-6 w-1 rounded-full bg-white" />
      </div>
    </div>
  );
}

const simulatorScript = String.raw`
(function () {
  var config = window.__POSE_SIM_CONFIG__;
  var ex005T = config.ex005.thresholds;
  var ex006Band = config.ex006.band;
  var EX005_SEQUENCE_MS = 3200;
  var EX005_FRAME_MS = 50;
  var ISO_TICK_CLAMP_MS = 250;
  var state005 = {
    angle: 0,
    shoulderTilt: 0,
    peak: 25,
    direction: "left",
    playing: false,
    counts: { left: 0, right: 0 },
    events: [],
    counter: makeRepCounter(ex005T),
    sequenceMs: 0
  };
  var state006 = {
    leftAngle: 90,
    rightAngle: 90,
    targetSec: 30,
    running: false,
    pairedMs: 0,
    lastTick: null,
    raf: 0
  };

  function byId(id) { return document.getElementById(id); }
  function setText(id, text) { var el = byId(id); if (el) el.textContent = text; }
  function setAttr(id, name, value) { var el = byId(id); if (el) el.setAttribute(name, value); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function fmt(n, d) { return typeof n === "number" ? n.toFixed(d || 1) : "--"; }
  function pointAt(origin, angleDeg, length) {
    var rad = angleDeg * Math.PI / 180;
    return { x: origin.x + Math.cos(rad) * length, y: origin.y + Math.sin(rad) * length };
  }
  function pointsAttr(points) {
    return points.map(function (p) { return (p.x * 100) + "," + (p.y * 100); }).join(" ");
  }
  function pathPoint(p) {
    return (p.x * 100) + " " + (p.y * 100);
  }
  function curvePath(from, c1, c2, to) {
    return "M " + pathPoint(from) + " C " + pathPoint(c1) + ", " + pathPoint(c2) + ", " + pathPoint(to);
  }
  function drawPoints(groupId, points) {
    var group = byId(groupId);
    if (!group) return;
    group.innerHTML = points.map(function (p) {
      return '<circle cx="' + (p.x * 100) + '" cy="' + (p.y * 100) + '" r="1.8" fill="#f8fafc" />';
    }).join("");
  }
  function signedToHeadOffset(signed) {
    if (Math.abs(signed) < 2) return "center";
    return signed > 0 ? "image-right" : "image-left";
  }
  function signedToRepSide(signed) {
    if (Math.abs(signed) < ex005T.startThreshold) return "neutral";
    return signed > 0 ? "left" : "right";
  }
  function makeTrunkPoints(headLeanDeg, shoulderTiltDeg) {
    var bend = Math.abs(headLeanDeg);
    var bendNorm = clamp(bend / 35, 0, 1);
    var bendSign = headLeanDeg === 0 ? 0 : headLeanDeg > 0 ? 1 : -1;
    var hipMid = { x: 0.5, y: 0.70 };
    var headMid = pointAt(hipMid, -90 + headLeanDeg, 0.50);
    var shoulderMid = pointAt(hipMid, -90 + headLeanDeg * 0.68, 0.33);
    var shoulderRad = shoulderTiltDeg * Math.PI / 180;
    var shoulderHalf = 0.095;
    var shoulderDx = Math.cos(shoulderRad) * shoulderHalf;
    var shoulderDy = Math.sin(shoulderRad) * shoulderHalf;
    var curve = -bendSign * bendNorm * 0.09;
    var leftShoulder = { x: shoulderMid.x + shoulderDx, y: shoulderMid.y + shoulderDy };
    var rightShoulder = { x: shoulderMid.x - shoulderDx, y: shoulderMid.y - shoulderDy };
    var leftHip = { x: hipMid.x + 0.09, y: hipMid.y };
    var rightHip = { x: hipMid.x - 0.09, y: hipMid.y };
    var leftEar = { x: headMid.x + 0.04, y: headMid.y };
    var rightEar = { x: headMid.x - 0.04, y: headMid.y };
    return {
      leftEar: leftEar,
      rightEar: rightEar,
      headMid: headMid,
      leftShoulder: leftShoulder,
      rightShoulder: rightShoulder,
      leftHip: leftHip,
      rightHip: rightHip,
      shoulderMid: shoulderMid,
      hipMid: hipMid,
      leftCurve1: { x: leftHip.x + curve * 0.55, y: 0.57 },
      leftCurve2: { x: leftShoulder.x + curve * 0.35, y: 0.45 },
      rightCurve1: { x: rightHip.x + curve * 0.95, y: 0.57 },
      rightCurve2: { x: rightShoulder.x + curve * 0.75, y: 0.43 },
      centerCurve1: { x: hipMid.x + curve * 0.45, y: 0.57 },
      centerCurve2: { x: shoulderMid.x + curve * 0.45, y: 0.45 }
    };
  }
  function makeArmPoints(leftAngle, rightAngle) {
    var ls = { x: 0.6, y: 0.36 };
    var rs = { x: 0.4, y: 0.36 };
    var le = pointAt(ls, 90 - leftAngle, 0.18);
    var re = pointAt(rs, 90 + rightAngle, 0.18);
    var lw = pointAt(le, 90 - leftAngle, 0.15);
    var rw = pointAt(re, 90 + rightAngle, 0.15);
    return { ls: ls, rs: rs, le: le, re: re, lw: lw, rw: rw, lh: { x: 0.57, y: 0.66 }, rh: { x: 0.43, y: 0.66 } };
  }
  function makeRepCounter(thresholds) {
    return {
      state: "WAITING_FOR_REP_START",
      thresholds: thresholds,
      descentEpsilon: 0.5,
      armAtRest: true,
      repIndex: 0,
      peakValue: -Infinity,
      peakSign: 0,
      startMs: 0,
      peakMs: 0,
      descentMs: 0,
      update: function (signed, tMs) {
        var angle = Math.abs(signed);
        if (angle < thresholds.startThreshold) this.armAtRest = true;
        if (this.state === "WAITING_FOR_REP_START") {
          if (angle >= thresholds.startThreshold && this.armAtRest) {
            this.state = "ASCENDING";
            this.startMs = tMs;
            this.peakMs = tMs;
            this.peakValue = angle;
            this.peakSign = signed >= 0 ? 1 : -1;
            this.armAtRest = false;
          }
          return null;
        }
        if (this.state === "ASCENDING") {
          if (angle > this.peakValue) {
            this.peakValue = angle;
            this.peakMs = tMs;
            this.peakSign = signed >= 0 ? 1 : -1;
          }
          if (angle < thresholds.startThreshold && this.peakValue < thresholds.minimumPeakThreshold) {
            this.state = "WAITING_FOR_REP_START";
            this.peakValue = -Infinity;
            return null;
          }
          if (this.peakValue >= thresholds.minimumPeakThreshold && angle < this.peakValue - this.descentEpsilon) {
            this.state = "DESCENDING";
            this.descentMs = tMs;
          }
          return null;
        }
        if (this.state === "DESCENDING") {
          if (angle > this.peakValue) {
            this.state = "ASCENDING";
            this.peakValue = angle;
            this.peakMs = tMs;
            this.peakSign = signed >= 0 ? 1 : -1;
            return null;
          }
          if (angle <= thresholds.repCompleteThreshold) {
            this.repIndex += 1;
            var side = this.peakSign > 0 ? "left" : "right";
            var event = {
              index: this.repIndex,
              side: side,
              peakValue: this.peakValue,
              classification: this.peakValue >= thresholds.targetROM ? "complete" : "partial"
            };
            this.state = "WAITING_FOR_REP_START";
            this.peakValue = -Infinity;
            this.armAtRest = true;
            return event;
          }
        }
        return null;
      },
      reset: function () {
        this.state = "WAITING_FOR_REP_START";
        this.armAtRest = true;
        this.repIndex = 0;
        this.peakValue = -Infinity;
        this.peakSign = 0;
      }
    };
  }
  function phaseAngle(progress, direction, peak) {
    var sign = direction === "left" ? 1 : -1;
    if (progress < 0.15) return 0;
    if (progress < 0.5) return sign * peak * ((progress - 0.15) / 0.35);
    if (progress < 0.65) return sign * peak;
    if (progress < 0.95) return sign * peak * (1 - (progress - 0.65) / 0.3);
    return 0;
  }
  function bindControl(id, min, max, onValue) {
    var range = byId(id);
    var number = byId(id + "-number");
    var label = byId(id + "-label");
    var minus = byId(id + "-minus");
    var plus = byId(id + "-plus");
    function unit() { return range.getAttribute("data-unit") || ""; }
    function commit(raw) {
      var value = clamp(Number(raw), min, max);
      if (!Number.isFinite(value)) return;
      range.value = String(value);
      number.value = String(value);
      if (label) label.textContent = value + unit();
      onValue(value);
    }
    range.addEventListener("input", function () { commit(range.value); });
    range.addEventListener("change", function () { commit(range.value); });
    number.addEventListener("input", function () { commit(number.value); });
    number.addEventListener("change", function () { commit(number.value); });
    minus.addEventListener("click", function () { commit(Number(range.value) - 1); });
    plus.addEventListener("click", function () { commit(Number(range.value) + 1); });
  }
  function setControlValue(id, value) {
    var range = byId(id);
    var number = byId(id + "-number");
    var label = byId(id + "-label");
    var unit = range ? range.getAttribute("data-unit") || "" : "";
    if (range) range.value = String(value);
    if (number) number.value = String(value);
    if (label) label.textContent = value + unit;
  }
  function updateEx005Thresholds() {
    var max = 35;
    var markers = [
      ["complete", ex005T.repCompleteThreshold, "#cbd5e1"],
      ["start", ex005T.startThreshold, "#fde047"],
      ["min peak", ex005T.minimumPeakThreshold, "#fdba74"],
      ["target", ex005T.targetROM, "#6ee7b7"]
    ];
    byId("ex005-thresholds").innerHTML = markers.map(function (m) {
      return '<div class="absolute top-[-4px] h-6 w-0.5 bg-white" style="left:' + ((m[1] / max) * 100) + '%"></div>';
    }).join("");
    byId("ex005-threshold-labels").innerHTML = markers.map(function (m) {
      return '<div class="flex items-center gap-2"><span style="background:' + m[2] + '" class="h-2 w-2 rounded-full"></span><span>' + m[0] + ': ' + m[1] + ' deg</span></div>';
    }).join("");
  }
  function updateEx005() {
    var signed = state005.angle;
    var abs = Math.abs(signed);
    var p = makeTrunkPoints(signed, state005.shoulderTilt);
    setAttr(
      "ex005-trunk-shape",
      "d",
      curvePath(p.leftHip, p.leftCurve1, p.leftCurve2, p.leftShoulder) +
        " L " + pathPoint(p.rightShoulder) +
        " C " + pathPoint(p.rightCurve2) + ", " + pathPoint(p.rightCurve1) + ", " + pathPoint(p.rightHip) +
        " L " + pathPoint(p.leftHip) + " Z"
    );
    setAttr("ex005-left-side-curve", "d", curvePath(p.leftHip, p.leftCurve1, p.leftCurve2, p.leftShoulder));
    setAttr("ex005-right-side-curve", "d", curvePath(p.rightHip, p.rightCurve1, p.rightCurve2, p.rightShoulder));
    setAttr("ex005-trunk-line", "d", curvePath(p.hipMid, p.centerCurve1, p.centerCurve2, p.shoulderMid));
    setAttr("ex005-head-line", "x1", p.hipMid.x * 100);
    setAttr("ex005-head-line", "y1", p.hipMid.y * 100);
    setAttr("ex005-head-line", "x2", p.headMid.x * 100);
    setAttr("ex005-head-line", "y2", p.headMid.y * 100);
    setAttr("ex005-head-circle", "cx", p.headMid.x * 100);
    setAttr("ex005-head-circle", "cy", p.headMid.y * 100);
    setAttr("ex005-head-circle", "r", 4.8);
    setAttr("ex005-ear-line", "x1", p.rightEar.x * 100);
    setAttr("ex005-ear-line", "y1", p.rightEar.y * 100);
    setAttr("ex005-ear-line", "x2", p.leftEar.x * 100);
    setAttr("ex005-ear-line", "y2", p.leftEar.y * 100);
    setAttr("ex005-shoulder-line", "x1", p.rightShoulder.x * 100);
    setAttr("ex005-shoulder-line", "y1", p.rightShoulder.y * 100);
    setAttr("ex005-shoulder-line", "x2", p.leftShoulder.x * 100);
    setAttr("ex005-shoulder-line", "y2", p.leftShoulder.y * 100);
    setAttr("ex005-hip-line", "x1", p.rightHip.x * 100);
    setAttr("ex005-hip-line", "y1", p.rightHip.y * 100);
    setAttr("ex005-hip-line", "x2", p.leftHip.x * 100);
    setAttr("ex005-hip-line", "y2", p.leftHip.y * 100);
    drawPoints("ex005-points", [p.leftEar, p.rightEar, p.leftShoulder, p.rightShoulder, p.leftHip, p.rightHip]);
    setText("ex005-signed", fmt(signed, 1) + " deg");
    setText("ex005-display-side", signedToHeadOffset(signed));
    setText("ex005-rep-side", signedToRepSide(signed));
    setText("ex005-counts", "L " + state005.counts.left + " / R " + state005.counts.right);
    setText("ex005-abs", fmt(abs, 1) + " deg");
    byId("ex005-fill").style.width = clamp(abs / 35 * 100, 0, 100) + "%";
    setText("ex005-state", state005.counter.state);
  }
  function renderEx005Events() {
    var el = byId("ex005-events");
    if (!state005.events.length) {
      el.textContent = "No counted reps yet.";
      el.className = "space-y-2 text-sm text-slate-500";
      return;
    }
    el.className = "space-y-2 text-sm";
    el.innerHTML = state005.events.map(function (event) {
      var color = event.classification === "complete" ? "text-emerald-300" : "text-orange-300";
      return '<div class="rounded-md bg-white/5 px-3 py-2"><div class="flex items-center justify-between gap-2"><span class="font-medium text-slate-100">' +
        event.side + ' rep ' + event.index + '</span><span class="' + color + '">' + event.classification +
        '</span></div><p class="mt-1 text-xs text-slate-400">peak ' + fmt(event.peakValue, 1) + ' deg</p></div>';
    }).join("");
  }
  function playEx005() {
    state005.playing = true;
    state005.sequenceMs = 0;
    state005.counter.reset();
    state005.counts = { left: 0, right: 0 };
    state005.events = [];
    renderEx005Events();
    var timer = window.setInterval(function () {
      var progress = state005.sequenceMs / EX005_SEQUENCE_MS;
      state005.angle = Math.round(phaseAngle(progress, state005.direction, state005.peak) * 10) / 10;
      state005.shoulderTilt = state005.angle;
      var event = state005.counter.update(state005.angle, state005.sequenceMs);
      if (event) {
        state005.counts[event.side] += 1;
        state005.events.unshift(event);
        state005.events = state005.events.slice(0, 5);
        renderEx005Events();
      }
      setControlValue("ex005-angle", state005.angle);
      setControlValue("ex005-shoulder-tilt", state005.shoulderTilt);
      updateEx005();
      state005.sequenceMs += EX005_FRAME_MS;
      if (progress >= 1) {
        state005.playing = false;
        window.clearInterval(timer);
      }
    }, EX005_FRAME_MS);
  }
  function updateEx006Bands() {
    var lo = ex006Band.center - ex006Band.tolerance;
    var hi = ex006Band.center + ex006Band.tolerance;
    setText("ex006-band", lo + " to " + hi + " deg");
    ["ex006-left-band", "ex006-right-band"].forEach(function (id) {
      byId(id + "-zone").style.left = (lo / 140 * 100) + "%";
      byId(id + "-zone").style.width = ((hi - lo) / 140 * 100) + "%";
    });
  }
  function updateEx006() {
    var lo = ex006Band.center - ex006Band.tolerance;
    var hi = ex006Band.center + ex006Band.tolerance;
    var leftIn = state006.leftAngle >= lo && state006.leftAngle <= hi;
    var rightIn = state006.rightAngle >= lo && state006.rightAngle <= hi;
    var targetMs = state006.targetSec * 1000;
    var complete = state006.pairedMs >= targetMs;
    var p = makeArmPoints(state006.leftAngle, state006.rightAngle);
    setAttr("ex006-arm-poly", "points", pointsAttr([p.lw, p.le, p.ls, p.rs, p.re, p.rw]));
    drawPoints("ex006-points", [p.ls, p.rs, p.le, p.re, p.lw, p.rw, p.lh, p.rh]);
    setText("ex006-left-metric", fmt(state006.leftAngle, 1) + " deg");
    setText("ex006-right-metric", fmt(state006.rightAngle, 1) + " deg");
    setText("ex006-complete", Math.floor(state006.pairedMs / 1000) + " / " + state006.targetSec + "s");
    setText("ex006-state", complete ? "SET COMPLETE" : state006.running ? "ACCUMULATING" : "PAUSED");
    updateArmStatus("ex006-arms", leftIn, rightIn);
    updatePairedHold("ex006-paired-hold", state006.pairedMs, targetMs, leftIn && rightIn);
    updateBand("ex006-left-band", state006.leftAngle, leftIn);
    updateBand("ex006-right-band", state006.rightAngle, rightIn);
  }
  function updateArmStatus(id, leftIn, rightIn) {
    var both = leftIn && rightIn;
    setText(id + "-status", both ? "both ready" : "adjust");
    byId(id + "-status").className = both ? "text-xs font-semibold text-emerald-300" : "text-xs font-semibold text-orange-300";
    byId(id + "-left").className = leftIn
      ? "rounded-md bg-emerald-400/15 px-3 py-2 text-center text-lg font-bold text-emerald-300"
      : "rounded-md bg-white/5 px-3 py-2 text-center text-lg font-bold text-white/30";
    byId(id + "-right").className = rightIn
      ? "rounded-md bg-emerald-400/15 px-3 py-2 text-center text-lg font-bold text-emerald-300"
      : "rounded-md bg-white/5 px-3 py-2 text-center text-lg font-bold text-white/30";
  }
  function updatePairedHold(id, ms, targetMs, bothInBand) {
    var complete = ms >= targetMs;
    setText(id + "-status", complete ? "complete" : bothInBand ? "holding" : "paused");
    byId(id + "-status").className = complete || bothInBand ? "text-xs font-semibold text-emerald-300" : "text-xs font-semibold text-orange-300";
    setText(id + "-seconds", Math.floor(ms / 1000) + "s");
    byId(id + "-fill").style.width = clamp(ms / targetMs * 100, 0, 100) + "%";
  }
  function updateBand(id, value, inBand) {
    setText(id + "-status", inBand ? "in band" : "out of band");
    byId(id + "-status").className = inBand ? "text-emerald-300" : "text-slate-400";
    byId(id + "-marker").style.left = clamp(value / 140 * 100, 0, 100) + "%";
  }
  function tickEx006(now) {
    if (!state006.running) return;
    var targetMs = state006.targetSec * 1000;
    if (state006.pairedMs >= targetMs) {
      state006.running = false;
      state006.lastTick = null;
      updateEx006();
      return;
    }
    var lo = ex006Band.center - ex006Band.tolerance;
    var hi = ex006Band.center + ex006Band.tolerance;
    var dt = state006.lastTick === null ? 0 : Math.min(now - state006.lastTick, ISO_TICK_CLAMP_MS);
    state006.lastTick = now;
    var leftIn = state006.leftAngle >= lo && state006.leftAngle <= hi;
    var rightIn = state006.rightAngle >= lo && state006.rightAngle <= hi;
    if (leftIn && rightIn) state006.pairedMs += dt;
    updateEx006();
    state006.raf = window.requestAnimationFrame(tickEx006);
  }
  function init() {
    var ready = byId("sim-ready");
    ready.textContent = "Controls: ready";
    ready.className = "font-semibold text-emerald-300";
    updateEx005Thresholds();
    updateEx006Bands();
    bindControl("ex005-angle", -35, 35, function (v) { state005.playing = false; state005.angle = v; state005.shoulderTilt = v; setControlValue("ex005-shoulder-tilt", v); updateEx005(); });
    bindControl("ex005-shoulder-tilt", -30, 30, function (v) { state005.playing = false; state005.shoulderTilt = v; updateEx005(); });
    bindControl("ex005-peak", 8, 32, function (v) { state005.peak = v; });
    bindControl("ex006-left-angle", 0, 140, function (v) { state006.leftAngle = v; updateEx006(); });
    bindControl("ex006-right-angle", 0, 140, function (v) { state006.rightAngle = v; updateEx006(); });
    bindControl("ex006-target", 5, 60, function (v) { state006.targetSec = v; updateEx006(); });
    byId("ex005-left").addEventListener("click", function () {
      state005.direction = "left";
      byId("ex005-left").className = "rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950";
      byId("ex005-right").className = "rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white";
    });
    byId("ex005-right").addEventListener("click", function () {
      state005.direction = "right";
      byId("ex005-right").className = "rounded-md bg-emerald-500 px-3 py-2 text-sm font-medium text-slate-950";
      byId("ex005-left").className = "rounded-md bg-white/10 px-3 py-2 text-sm font-medium text-white";
    });
    byId("ex005-cheat-demo").addEventListener("click", function () {
      state005.playing = false;
      state005.angle = 0;
      state005.shoulderTilt = state005.direction === "left" ? 24 : -24;
      setControlValue("ex005-angle", 0);
      setControlValue("ex005-shoulder-tilt", state005.shoulderTilt);
      updateEx005();
    });
    byId("ex005-head-demo").addEventListener("click", function () {
      state005.playing = false;
      state005.angle = state005.direction === "left" ? state005.peak : -state005.peak;
      state005.shoulderTilt = 0;
      setControlValue("ex005-angle", state005.angle);
      setControlValue("ex005-shoulder-tilt", 0);
      updateEx005();
    });
    byId("ex005-play").addEventListener("click", playEx005);
    byId("ex005-reset").addEventListener("click", function () {
      state005.angle = 0;
      state005.shoulderTilt = 0;
      state005.counts = { left: 0, right: 0 };
      state005.events = [];
      state005.counter.reset();
      setControlValue("ex005-angle", 0);
      setControlValue("ex005-shoulder-tilt", 0);
      renderEx005Events();
      updateEx005();
    });
    byId("ex006-start").addEventListener("click", function () {
      if (!state006.running) {
        state006.running = true;
        state006.lastTick = null;
        state006.raf = window.requestAnimationFrame(tickEx006);
        updateEx006();
      }
    });
    byId("ex006-pause").addEventListener("click", function () {
      state006.running = false;
      state006.lastTick = null;
      if (state006.raf) window.cancelAnimationFrame(state006.raf);
      updateEx006();
    });
    byId("ex006-reset").addEventListener("click", function () {
      state006.running = false;
      state006.lastTick = null;
      state006.pairedMs = 0;
      if (state006.raf) window.cancelAnimationFrame(state006.raf);
      updateEx006();
    });
    updateEx005();
    updateEx006();
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
}());
`;
