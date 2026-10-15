"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export interface TourStep {
  /** The id of the element to outline. Without one, or if it is not on screen, the card is centred. */
  targetId?: string;
  title: string;
  lines: string[];
  placement?: "below" | "above" | "left" | "right";
  /** Skip the step when its target is not on the page (for example an empty list). */
  optional?: boolean;
}

const PAD = 8;
const EDGE = 12;
const GAP = 16;
const ARROW = 10;

type Rect = { left: number; top: number; width: number; height: number };

function measure(id: string | undefined): Rect | null {
  if (!id) return null;
  const el = document.getElementById(id);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const visible = r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
  return visible ? { left: r.left, top: r.top, width: r.width, height: r.height } : null;
}

/**
 * A step-by-step tour that dims the page, outlines one element at a time and
 * explains it in a card, the same way the camera page's "How to Use" does.
 */
export default function SpotlightTour({ steps, onClose }: { steps: TourStep[]; onClose: () => void }) {
  // Optional steps whose target is missing are dropped once, when the tour opens.
  const usable = useMemo(
    () => steps.filter((s) => !(s.optional && s.targetId && !document.getElementById(s.targetId))),
    [steps],
  );
  const [index, setIndex] = useState(0);
  const [target, setTarget] = useState<Rect | null>(null);
  const [cardSize, setCardSize] = useState({ w: 360, h: 220 });
  const [viewport, setViewport] = useState({ w: 1280, h: 720 });
  const cardRef = useRef<HTMLDivElement>(null);

  const step = usable[Math.min(index, usable.length - 1)];
  const total = usable.length;

  const refresh = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    setTarget(measure(step?.targetId));
  }, [step?.targetId]);

  // Bring the target into view, then outline it once the scroll has settled.
  useEffect(() => {
    const el = step?.targetId ? document.getElementById(step.targetId) : null;
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
    refresh();
    const settle = window.setTimeout(refresh, 350);
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, true);
    return () => {
      window.clearTimeout(settle);
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh, true);
    };
  }, [step?.targetId, refresh]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowRight") setIndex((i) => Math.min(i + 1, total - 1));
      if (event.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, total]);

  useLayoutEffect(() => {
    const r = cardRef.current?.getBoundingClientRect();
    if (r && (Math.abs(r.width - cardSize.w) > 1 || Math.abs(r.height - cardSize.h) > 1)) {
      setCardSize({ w: r.width, h: r.height });
    }
  }, [index, viewport.w, cardSize.w, cardSize.h]);

  if (!step) return null;

  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, Math.max(min, max)));
  const spot = target
    ? { x: target.left - PAD, y: target.top - PAD, w: target.width + PAD * 2, h: target.height + PAD * 2 }
    : null;

  let left = (viewport.w - cardSize.w) / 2;
  let top = (viewport.h - cardSize.h) / 2;
  let arrow: { side: "top" | "bottom" | "left" | "right"; at: number } | null = null;

  if (spot) {
    const roomBelow = viewport.h - (spot.y + spot.h) - GAP - EDGE;
    const roomAbove = spot.y - GAP - EDGE;
    const roomRight = viewport.w - (spot.x + spot.w) - GAP - EDGE;
    const roomLeft = spot.x - GAP - EDGE;
    const wanted = step.placement ?? "below";
    const fits = {
      below: roomBelow >= cardSize.h,
      above: roomAbove >= cardSize.h,
      right: roomRight >= cardSize.w,
      left: roomLeft >= cardSize.w,
    };
    const order: Array<"below" | "above" | "right" | "left"> = [wanted, "below", "above", "right", "left"];
    const side = order.find((s) => fits[s]) ?? null;
    const cx = spot.x + spot.w / 2;
    const cy = spot.y + spot.h / 2;
    if (side === "below" || side === "above") {
      left = clamp(cx - cardSize.w / 2, EDGE, viewport.w - cardSize.w - EDGE);
      top = side === "below" ? spot.y + spot.h + GAP : spot.y - GAP - cardSize.h;
      arrow = { side: side === "below" ? "top" : "bottom", at: clamp(cx - left, 22, cardSize.w - 22) };
    } else if (side === "right" || side === "left") {
      top = clamp(cy - cardSize.h / 2, EDGE, viewport.h - cardSize.h - EDGE);
      left = side === "right" ? spot.x + spot.w + GAP : spot.x - GAP - cardSize.w;
      arrow = { side: side === "right" ? "left" : "right", at: clamp(cy - top, 22, cardSize.h - 22) };
    } else {
      // The target is too large for any side, so the card overlays the lower part of the screen.
      left = clamp((viewport.w - cardSize.w) / 2, EDGE, viewport.w - cardSize.w - EDGE);
      top = viewport.h - cardSize.h - EDGE;
    }
  }
  left = clamp(left, EDGE, viewport.w - cardSize.w - EDGE);
  top = clamp(top, EDGE, viewport.h - cardSize.h - EDGE);

  const arrowStyle = arrow
    ? ({
        top: { top: -ARROW, left: arrow.at, transform: "translateX(-50%)", borderLeft: `${ARROW}px solid transparent`, borderRight: `${ARROW}px solid transparent`, borderBottom: `${ARROW}px solid #16a34a` },
        bottom: { bottom: -ARROW, left: arrow.at, transform: "translateX(-50%)", borderLeft: `${ARROW}px solid transparent`, borderRight: `${ARROW}px solid transparent`, borderTop: `${ARROW}px solid #16a34a` },
        left: { left: -ARROW, top: arrow.at, transform: "translateY(-50%)", borderTop: `${ARROW}px solid transparent`, borderBottom: `${ARROW}px solid transparent`, borderRight: `${ARROW}px solid #16a34a` },
        right: { right: -ARROW, top: arrow.at, transform: "translateY(-50%)", borderTop: `${ARROW}px solid transparent`, borderBottom: `${ARROW}px solid transparent`, borderLeft: `${ARROW}px solid #16a34a` },
      } as const)[arrow.side]
    : null;

  const last = index >= total - 1;

  return (
    <div className="print:hidden">
      <svg className="pointer-events-none fixed inset-0 z-[60]" width="100%" height="100%" aria-hidden>
        <defs>
          <mask id="dash-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {spot && <rect x={spot.x} y={spot.y} width={spot.w} height={spot.h} rx="10" fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" mask="url(#dash-tour-mask)" />
      </svg>

      {spot && (
        <div
          className="pointer-events-none fixed z-[61] animate-pulse rounded-[10px] border-2 border-green-500"
          style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h }}
        />
      )}

      <div className="fixed inset-0 z-[60]" onClick={onClose} aria-hidden />

      <div
        ref={cardRef}
        role="dialog"
        aria-labelledby="dash-tour-title"
        className="fixed z-[62] w-[min(26rem,calc(100vw-1.5rem))] rounded-2xl bg-white text-gray-900 shadow-2xl"
        style={{ left, top, colorScheme: "light" }}
      >
        {arrowStyle && <span className="absolute h-0 w-0" style={arrowStyle} />}

        <div className="flex items-start justify-between gap-3 rounded-t-2xl bg-green-600 px-4 py-3">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-green-100">
              Step {index + 1} of {total}
            </p>
            <h2 id="dash-tour-title" className="text-base font-bold leading-snug text-white">
              {step.title}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tour"
            className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-white/30 bg-white/10 text-white transition hover:bg-white/20"
          >
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <ul className="max-h-[45vh] space-y-2 overflow-y-auto px-4 pb-2 pt-3">
          {step.lines.map((line) => (
            <li key={line} className="flex gap-2.5 text-[13px] leading-relaxed text-gray-700">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-green-600" />
              {line}
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-3 px-4 pb-4 pt-2">
          <div className="flex gap-1.5">
            {usable.map((s, i) => (
              <button
                key={`${s.title}-${i}`}
                type="button"
                aria-label={`Go to step ${i + 1}`}
                onClick={() => setIndex(i)}
                className={`h-[7px] rounded-full transition-all ${i === index ? "w-[18px] bg-green-600" : "w-[7px] bg-gray-200 hover:bg-green-300"}`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {index > 0 && (
              <button
                type="button"
                onClick={() => setIndex(index - 1)}
                className="rounded-lg border border-gray-200 px-3.5 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50"
              >
                Back
              </button>
            )}
            <button
              type="button"
              onClick={() => (last ? onClose() : setIndex(index + 1))}
              className="rounded-lg bg-green-600 px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-green-700"
            >
              {last ? "Got it!" : "Next →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
