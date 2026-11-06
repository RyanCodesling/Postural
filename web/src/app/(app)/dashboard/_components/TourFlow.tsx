import type { ReactNode } from "react";

/**
 * One picture in a tour step's flow. The frames are drawn top to bottom with an
 * arrow between them, so a step reads as "press this, then this happens", the
 * same way the camera page's How to Use illustrations do.
 */
export type FlowFrame =
  /** A small caption that starts a new part of the flow. */
  | { kind: "heading"; text: string }
  /** A button with the pointer on it. */
  | { kind: "click"; label: string; tone?: "primary" | "outline" | "danger" }
  /** A row of options with one picked. */
  | { kind: "choose"; options: string[]; picked: number }
  /** Form fields, by label. */
  | { kind: "fields"; fields: string[] }
  /** A list of checkboxes, some ticked. */
  | { kind: "tick"; items: string[]; ticked: number[] }
  /** A list row that is clicked, with an optional button at its end. */
  | { kind: "row"; title: string; meta?: string; button?: string }
  /** A confirmation box. */
  | { kind: "dialog"; title: string; confirm: string; danger?: boolean }
  /** Tabs with one open. */
  | { kind: "tabs"; tabs: string[]; active: number }
  /** Coloured markers and what each means. */
  | { kind: "legend"; items: { tone: Tone; label: string; outline?: boolean }[] }
  /** A small line chart with one point per session. */
  | { kind: "chart" }
  /** An email that is sent. */
  | { kind: "email"; text: string }
  /** The outcome. */
  | { kind: "result"; text: string; tone?: "ok" | "warn" | "bad" }
  /** A screenshot of the real screen, from public/tour, with a short caption. */
  | { kind: "shot"; src: string; caption: string };

type Tone = "green" | "amber" | "red" | "gray" | "blue";

const DOT: Record<Tone, string> = {
  green: "bg-green-500 border-green-500",
  amber: "bg-amber-400 border-amber-400",
  red: "bg-red-500 border-red-500",
  gray: "bg-gray-300 border-gray-300",
  blue: "bg-blue-500 border-blue-500",
};

const OUTLINE: Record<Tone, string> = {
  green: "border-green-500",
  amber: "border-amber-400",
  red: "border-red-500",
  gray: "border-gray-300",
  blue: "border-blue-500",
};

const PANEL = "rounded-lg border border-gray-200 bg-gray-50 p-2";

/** Keyframes for the pointer and the pressed button. */
export const TOUR_FLOW_KEYFRAMES = `
  @keyframes dash-gfx-btn { 0%, 100% { box-shadow: 0 0 0 0 rgb(22 163 74 / 0.45); } 50% { box-shadow: 0 0 0 5px rgb(22 163 74 / 0); } }
  @keyframes dash-gfx-cursor { 0%, 100% { transform: translate(0, 0); } 50% { transform: translate(-2px, -2px); } }
  @media (prefers-reduced-motion: reduce) { .dash-tour-gfx * { animation: none !important; } }
`;

function Pointer() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="absolute -bottom-2.5 -right-2 h-3.5 w-3.5"
      fill="white"
      stroke="#1f2937"
      strokeWidth="1.6"
      style={{ animation: "dash-gfx-cursor 2.2s ease-in-out infinite" }}
      aria-hidden
    >
      <path d="M5 3l14 8-6 1.5L10 19z" />
    </svg>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center text-gray-300" aria-hidden>
      <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2.4">
        <path d="M12 4v15M6 13l6 6 6-6" />
      </svg>
    </div>
  );
}

function Frame({ frame }: { frame: FlowFrame }): ReactNode {
  switch (frame.kind) {
    case "heading":
      return <p className="text-[12px] font-semibold uppercase tracking-[.14em] text-gray-600">{frame.text}</p>;

    case "click": {
      const tone = {
        primary: "bg-green-600 text-white border-green-600",
        outline: "bg-white text-green-700 border-green-600",
        danger: "bg-white text-red-600 border-red-300",
      }[frame.tone ?? "primary"];
      return (
        <div className={`${PANEL} flex justify-center py-2.5`}>
          <span
            className={`relative inline-flex items-center rounded-md border px-2.5 py-1 text-[13px] font-semibold ${tone}`}
            style={{ animation: "dash-gfx-btn 2.2s ease-out infinite" }}
          >
            {frame.label}
            <Pointer />
          </span>
        </div>
      );
    }

    case "choose":
      return (
        <div className={`${PANEL} flex flex-wrap gap-1`}>
          {frame.options.map((option, i) => (
            <span
              key={option}
              className={`relative flex-1 whitespace-nowrap rounded border px-1.5 py-1 text-center text-[12px] ${
                i === frame.picked ? "border-green-600 bg-green-50 font-semibold text-green-800" : "border-gray-200 bg-white text-gray-500"
              }`}
            >
              {option}
              {i === frame.picked && <Pointer />}
            </span>
          ))}
        </div>
      );

    case "fields":
      return (
        <div className={`${PANEL} space-y-1.5`}>
          {frame.fields.map((field) => (
            <div key={field}>
              <p className="text-[11px] text-gray-500">{field}</p>
              <div className="mt-0.5 h-3.5 rounded border border-gray-200 bg-white" />
            </div>
          ))}
        </div>
      );

    case "tick":
      return (
        <div className={`${PANEL} space-y-1`}>
          {frame.items.map((item, i) => {
            const on = frame.ticked.includes(i);
            return (
              <div key={item} className="flex items-center gap-1.5 rounded bg-white px-1.5 py-1 text-[12px] text-gray-700">
                <span className={`grid h-2.5 w-2.5 place-items-center rounded-sm border ${on ? "border-green-600 bg-green-600" : "border-gray-300"}`}>
                  {on && (
                    <svg viewBox="0 0 24 24" className="h-2 w-2" fill="none" stroke="white" strokeWidth="4" aria-hidden>
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  )}
                </span>
                {item}
              </div>
            );
          })}
        </div>
      );

    case "row":
      return (
        <div className={PANEL}>
          <div className="relative flex items-center justify-between gap-2 rounded-md border border-green-200 bg-white px-2 py-1.5">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-gray-800">{frame.title}</p>
              {frame.meta && <p className="truncate text-[11px] text-gray-500">{frame.meta}</p>}
            </div>
            {frame.button ? (
              <span
                className="relative shrink-0 rounded border border-green-600 bg-green-600 px-1.5 py-0.5 text-[11px] font-semibold text-white"
                style={{ animation: "dash-gfx-btn 2.2s ease-out infinite" }}
              >
                {frame.button}
                <Pointer />
              </span>
            ) : (
              <Pointer />
            )}
          </div>
        </div>
      );

    case "dialog":
      return (
        <div className="rounded-md border border-gray-200 bg-white p-2 shadow-sm">
          <p className="text-[12px] font-semibold text-gray-800">{frame.title}</p>
          <div className="mt-1.5 flex gap-1">
            <span className="flex-1 rounded border border-gray-200 py-0.5 text-center text-[11px] text-gray-500">Cancel</span>
            <span
              className={`relative flex-1 rounded border py-0.5 text-center text-[11px] font-semibold text-white ${
                frame.danger ? "border-red-600 bg-red-600" : "border-green-600 bg-green-600"
              }`}
            >
              {frame.confirm}
              <Pointer />
            </span>
          </div>
        </div>
      );

    case "tabs":
      return (
        <div className={`${PANEL} flex gap-0.5`}>
          {frame.tabs.map((tab, i) => (
            <span
              key={tab}
              className={`flex-1 whitespace-nowrap border-b-2 px-1 pb-0.5 text-center text-[11px] ${
                i === frame.active ? "border-green-600 font-semibold text-green-800" : "border-transparent text-gray-500"
              }`}
            >
              {tab}
            </span>
          ))}
        </div>
      );

    case "legend":
      return (
        <div className={`${PANEL} space-y-1`}>
          {frame.items.map((item) => (
            <div key={item.label} className="flex items-center gap-1.5 text-[12px] text-gray-700">
              <span className={`h-3 w-3 shrink-0 rounded border-2 ${item.outline ? `bg-white ${OUTLINE[item.tone]}` : DOT[item.tone]}`} />
              {item.label}
            </div>
          ))}
        </div>
      );

    case "chart":
      return (
        <div className={PANEL}>
          <svg viewBox="0 0 180 54" className="block h-auto w-full" aria-hidden>
            <line x1="0" y1="50" x2="180" y2="50" stroke="#e5e7eb" />
            <polyline points="10,40 40,36 70,38 100,28 130,24 165,16" fill="none" stroke="#16a34a" strokeWidth="2" />
            {[[10, 40], [40, 36], [70, 38], [100, 28], [130, 24], [165, 16]].map(([x, y]) => (
              <circle key={x} cx={x} cy={y} r="3" fill="white" stroke="#16a34a" strokeWidth="1.6" />
            ))}
          </svg>
        </div>
      );

    case "email":
      return (
        <div className="flex items-center gap-2 rounded-md border border-blue-100 bg-blue-50 px-2.5 py-2 text-[14px] text-blue-800">
          <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <path d="m3 7 9 6 9-6" />
          </svg>
          {frame.text}
        </div>
      );

    case "shot":
      return (
        <figure className="space-y-1">
          <figcaption className="text-[14px] font-semibold text-gray-700">{frame.caption}</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element -- small static screenshots, no resizing needed */}
          <img
            src={`/tour/${frame.src}`}
            // Captured at twice the screen's resolution: half the file's width is its real on-screen size.
            // A cap rather than a fixed width, so a tall picture shrunk by max-height keeps its shape.
            onLoad={(event) => {
              event.currentTarget.style.maxWidth = `min(100%, ${event.currentTarget.naturalWidth / 2}px)`;
            }}
            alt=""
            className="block h-auto max-h-[34vh] w-auto max-w-full rounded-md border border-gray-200 object-contain object-left shadow-sm"
          />
        </figure>
      );

    case "result": {
      const tone = {
        ok: { box: "border-green-200 bg-green-50 text-green-800", mark: "✓" },
        warn: { box: "border-amber-200 bg-amber-50 text-amber-800", mark: "!" },
        bad: { box: "border-red-200 bg-red-50 text-red-700", mark: "✗" },
      }[frame.tone ?? "ok"];
      return (
        <div className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-[14px] font-semibold ${tone.box}`}>
          <span className="text-[15px]">{tone.mark}</span>
          {frame.text}
        </div>
      );
    }
  }
}

/**
 * The illustration beside a tour step. Decorative only; each point it shows is
 * also stated in the step's text.
 */
export default function TourFlow({ frames, wide = false }: { frames: FlowFrame[]; wide?: boolean }) {
  return (
    <div className={`dash-tour-gfx flex shrink-0 flex-col gap-1.5 ${wide ? "w-full" : "w-64"}`} aria-hidden>
      <p className="text-[12px] font-semibold uppercase tracking-[.14em] text-gray-600">How to do it</p>
      {frames.map((frame, i) => {
        // No arrow before the first frame, nor into or out of a heading.
        const prev = frames[i - 1];
        const arrow = i > 0 && frame.kind !== "heading" && prev?.kind !== "heading";
        return (
          <div key={i} className="flex flex-col gap-1.5">
            {arrow && <Arrow />}
            <Frame frame={frame} />
          </div>
        );
      })}
    </div>
  );
}
