import Image from "next/image";
import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import logo from "../../media/acc_bacoor_logo.png";
import HeroPanel from "./_auth/HeroPanel";

// Palette: deep clinical green for ink, the clinic logo's green for marks, and
// the logo's orange cross as a sparing second accent.
const INK = "#10241a";
const ORANGE = "#ea580c";

const LOGIN_BUTTON =
  "inline-flex items-center justify-center gap-2 rounded-md bg-[#14532d] px-5 py-3 text-[15px] font-semibold text-white transition-colors hover:bg-[#166534] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14532d]";

function Label({ children }: { children: ReactNode }) {
  return (
    <p className={`flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#5b6b60]`}>
      <span className="text-[13px] font-bold leading-none" style={{ color: ORANGE }} aria-hidden>+</span>
      {children}
    </p>
  );
}

function Icon({ children, className = "h-5 w-5" }: { children: ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

function Arrow() {
  return (
    <Icon className="h-4 w-4">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

/* ---------- Small illustrations of what the patient sees on screen ---------- */

function Panel({ children }: { children: ReactNode }) {
  return (
    <div
      className="relative flex h-[156px] items-center justify-center overflow-hidden rounded-lg border border-[#dfe7db] bg-[#f3f7f1]"
      style={{ backgroundImage: "radial-gradient(#d3dfcf 1px, transparent 1px)", backgroundSize: "14px 14px" }}
      aria-hidden
    >
      {children}
    </div>
  );
}

function RepsPanel() {
  return (
    <Panel>
      <div className="w-[200px] rounded-md bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,36,26,0.08)]">
        <div className="flex items-baseline justify-between">
          <span className="font-mono text-[10px] uppercase tracking-widest text-[#5b6b60]">Reps</span>
          <span className="font-mono text-[10px] text-[#5b6b60]">Set 2 of 3</span>
        </div>
        <p className="mt-1 font-mono text-[30px] font-semibold leading-none" style={{ color: INK }}>
          7<span className="text-[16px] text-[#8a978e]"> / 10</span>
        </p>
        <div className="mt-3 grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => (
            <span key={i} className={`h-1.5 rounded-full ${i < 7 ? "bg-[#16a34a]" : "bg-[#e1e8de]"}`} />
          ))}
        </div>
      </div>
    </Panel>
  );
}

function HoldPanel() {
  const r = 26;
  const c = 2 * Math.PI * r;
  return (
    <Panel>
      <div className="flex items-center gap-4 rounded-md bg-white px-4 py-3 shadow-[0_1px_2px_rgba(16,36,26,0.08)]">
        <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
          <circle cx="32" cy="32" r={r} fill="none" stroke="#e1e8de" strokeWidth="6" />
          <circle cx="32" cy="32" r={r} fill="none" stroke="#16a34a" strokeWidth="6" strokeLinecap="round" strokeDasharray={`${c * 0.6} ${c}`} />
        </svg>
        <div>
          <p className="font-mono text-[22px] font-semibold leading-none" style={{ color: INK }}>0:12</p>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-widest text-[#5b6b60]">Left side</p>
          <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[#15803d]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />Holding
          </p>
        </div>
      </div>
    </Panel>
  );
}

function TipPanel() {
  return (
    <Panel>
      <svg viewBox="0 0 120 110" className="absolute left-1/2 top-3 h-[110px] -translate-x-1/2">
        <circle cx="60" cy="18" r="9" fill="none" stroke="#9fb3a5" strokeWidth="2.5" />
        <path d="M34 42 L86 34" stroke="#ea580c" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="4 4" />
        <path d="M34 42 L26 72 M86 34 L94 66 M60 38 L60 90" stroke="#9fb3a5" strokeWidth="2.5" strokeLinecap="round" />
        {[[34, 42], [86, 34]].map(([x, y]) => (
          <circle key={x} cx={x} cy={y} r="4" fill="#fff" stroke="#ea580c" strokeWidth="2" />
        ))}
      </svg>
      <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-2 whitespace-nowrap rounded-full bg-[#10241a] px-3 py-1.5 text-[12px] font-medium text-white shadow-md">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: ORANGE }} />
        Level your shoulders
      </div>
    </Panel>
  );
}

function ReportPanel() {
  const rows: [string, string][] = [
    ["Reps", "30 / 30"],
    ["Range of motion", "148°"],
    ["Posture warnings", "2"],
    ["Pain reported", "None"],
  ];
  return (
    <Panel>
      <div className="w-[210px] rounded-md bg-white px-3.5 py-2.5 shadow-[0_1px_2px_rgba(16,36,26,0.08)]">
        <p className="flex items-center justify-between border-b border-[#eef1eb] pb-1.5 font-mono text-[10px] uppercase tracking-widest text-[#5b6b60]">
          Session report
          <span className="h-1.5 w-1.5 rounded-full bg-[#16a34a]" />
        </p>
        {rows.map(([k, v]) => (
          <p key={k} className="flex justify-between py-[3px] text-[11.5px]">
            <span className="text-[#5b6b60]">{k}</span>
            <span className="font-mono font-semibold" style={{ color: INK }}>{v}</span>
          </p>
        ))}
      </div>
    </Panel>
  );
}

/* ---------- Content ---------- */

const CAPABILITIES = [
  {
    title: "Counts your reps",
    text: "The camera watches you move and counts each repetition for you, so you can focus on the exercise.",
    panel: <RepsPanel />,
  },
  {
    title: "Times your holds",
    text: "For exercises where you hold a position, each side is timed. The timer only runs while you are holding.",
    panel: <HoldPanel />,
  },
  {
    title: "Posture tips",
    text: "If your posture slips, like uneven shoulders or leaning to one side, a short tip appears on the screen.",
    panel: <TipPanel />,
  },
  {
    title: "Session reports",
    text: "After each session, your reps, holds, range of motion, posture and any pain you reported are saved for your therapist.",
    panel: <ReportPanel />,
  },
];

const THERAPIST_POINTS = [
  "See what patients really did, not just what they say they did",
  "Set the sets, reps, rest time, side, resistance and schedule",
  "Track range of motion and reps over time",
  "Review sessions, pain reports and posture warnings",
  "Download your patient's progress reports to PDF",
];

const PATIENT_POINTS = [
  "Just follow the guide on screen. No counting, no buttons during a set",
  "See today's exercises, and catch up on days you missed",
  "Keep your streak going and see your progress",
  "Pause and report pain at any time",
  "Get a daily email of your finished and missed exercises",
];

const DOES = [
  "Counts reps and times holds",
  "Measures joint angles using one camera",
  "Shows posture tips on screen",
  "Sends session results to your therapist",
  "Shows your progress over time",
];

const DOES_NOT = [
  "Diagnose any condition",
  "Change or suggest a treatment",
  "Decide what is medically important",
  "Predict your recovery",
  "Replace your therapist",
];

const HERO_FACTS = ["Works in your web browser", "Tracking happens on your device", "Records your exercise, does not diagnose"];

function SectionHead({ label, title, text }: { label: string; title: string; text?: string }) {
  return (
    <div className="max-w-xl">
      <Label>{label}</Label>
      <h2 className="mt-3 text-[28px] font-semibold leading-[1.15] tracking-[-0.02em] sm:text-[34px]" style={{ color: INK }}>{title}</h2>
      {text && <p className="mt-3 text-[16px] leading-relaxed text-[#4a5a50]">{text}</p>}
    </div>
  );
}

function AudienceCard({ label, title, items }: { label: string; title: string; items: string[] }) {
  return (
    <div className="rounded-xl border border-[#e3e7df] bg-white p-6 sm:p-8">
      <Label>{label}</Label>
      <h3 className="mt-2 text-[21px] font-semibold leading-snug tracking-[-0.01em]">{title}</h3>
      <ol className="mt-6 divide-y divide-[#eef1eb] border-t border-[#eef1eb]">
        {items.map((item, i) => (
          <li key={item} className="flex gap-4 py-3 text-[15px] leading-snug text-[#26362c]">
            <span className="w-5 shrink-0 pt-px font-mono text-[12px] text-[#8a978e]">{String(i + 1).padStart(2, "0")}</span>
            {item}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Mark({ tone }: { tone: "yes" | "no" }) {
  return tone === "yes" ? (
    <svg viewBox="0 0 24 24" className="mt-[3px] h-4 w-4 shrink-0 text-[#15803d]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m5 12 5 5 9-10" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" className="mt-[3px] h-4 w-4 shrink-0 text-[#9aa39c]" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
  );
}

function HeroVideo() {
  return (
    // Its edges are feathered so the video melts into the hero's tint instead of sitting in a box.
    <div
      className="relative aspect-video w-full overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_8%,black_92%,transparent),linear-gradient(to_right,transparent,black_6%,black_94%,transparent)] [mask-composite:intersect] [-webkit-mask-composite:source-in]"
      aria-hidden
    >
      {/* Phones and tablets crop the empty margins the video was framed with, so its app UI reads larger. */}
      <video
        className="h-full w-full scale-[1.12] object-cover motion-reduce:hidden md:scale-[1.06] lg:scale-100"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        poster="/landing/postural-hero-poster.jpg"
      >
        {/* One 720p file for every screen. */}
        <source src="/landing/postural-hero-720p.mp4" type="video/mp4" />
      </video>
      {/* eslint-disable-next-line @next/next/no-img-element -- static poster shown instead of motion */}
      <img src="/landing/postural-hero-poster.jpg" alt="" className="hidden h-full w-full scale-[1.12] object-cover motion-reduce:block md:scale-[1.06] lg:scale-100" />
    </div>
  );
}

export default function HomePage() {
  return (
    <div className="bg-[#fafaf7]" style={{ colorScheme: "light", color: INK }}>
      <header className="border-b border-[#e3e7df] bg-[#fafaf7]">
        <nav className="flex items-center justify-between gap-4 px-5 py-4 sm:px-8 lg:px-12 xl:px-20 2xl:px-28">
          <div className="flex min-w-0 items-center gap-3">
            <Image src={logo} alt="ACC Bacoor" width={88} height={88} className="h-10 w-10 shrink-0 rounded-full" />
            <div className="min-w-0 leading-tight">
              <p className="text-[15px] font-semibold">ACC+ Bacoor</p>
              <p className="truncate text-xs text-[#5b6b60]">Orthopaedic and Physical Therapy Clinic</p>
            </div>
          </div>
        </nav>
      </header>

      <main>
        {/* Hero: copy on the left, the video in its own clear space on the right (stacked below on smaller screens). */}
        <section className="overflow-hidden bg-[linear-gradient(to_right,#fafaf7_0%,#fafaf7_30%,#e8f5ec_62%)] max-lg:bg-[linear-gradient(to_bottom,#fafaf7_0%,#fafaf7_45%,#e8f5ec_75%)]">
          <div className="grid items-center gap-8 pb-10 pt-12 sm:pt-16 lg:min-h-[620px] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6 lg:py-16 lg:pl-12 xl:pl-20 2xl:pl-28">
            <div className="px-5 sm:px-8 lg:px-0">
              <Label>Machine learning-assisted posture and exercise tracking</Label>
              <h1 className="mt-4 text-[40px] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-[52px] xl:text-[56px]">
                Postural <span className="text-[#15803d]">Monitoring</span> System
              </h1>
              <p className="mt-5 max-w-md text-[17px] leading-relaxed text-[#2f3f35]">
                Your camera works like an exercise coach. It counts your reps, times your holds and gives posture tips
                while you move. Then it sends a record of each session to your therapist.
              </p>
              <div className="mt-8">
                <Link href="/?view=login" scroll={false} className={LOGIN_BUTTON}>Log In <Arrow /></Link>
              </div>
              <ul className="mt-10 grid max-w-[520px] gap-px overflow-hidden rounded-md border border-[#dfe5db] bg-[#dfe5db] text-[13px] shadow-sm sm:grid-cols-3">
                {HERO_FACTS.map((fact) => (
                  <li key={fact} className="flex gap-2 bg-white px-3 py-2.5 leading-snug text-[#3c4c42]">
                    <span className="mt-[6px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#16a34a]" aria-hidden />
                    {fact}
                  </li>
                ))}
              </ul>
            </div>
            <div className="mx-auto w-full max-w-[880px] lg:max-w-none">
              {/* Log In and Forgot Password open here, in place of the video. */}
              <Suspense fallback={<HeroVideo />}>
                <HeroPanel video={<HeroVideo />} />
              </Suspense>
            </div>
          </div>
        </section>

        {/* What it does */}
        <section className="border-t border-[#e3e7df] bg-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
            <SectionHead
              label="What it does"
              title="Four things in every session"
              text="During each exercise, the system does four things and sends the results to your therapist."
            />
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {CAPABILITIES.map((item) => (
                <div key={item.title} className="rounded-xl border border-[#e3e7df] bg-white p-3 pb-5 transition-shadow hover:shadow-[0_8px_24px_-16px_rgba(16,36,26,0.35)]">
                  {item.panel}
                  <h3 className="mt-4 px-2 text-[17px] font-semibold">{item.title}</h3>
                  <p className="mt-1.5 px-2 text-[14.5px] leading-relaxed text-[#4a5a50]">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Patients and therapists */}
        <section className="border-t border-[#e3e7df]">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
            <SectionHead label="For patients and therapists" title="One system for both" />
            <div className="mt-10 grid gap-5 md:grid-cols-2">
              <AudienceCard
                label="For therapists"
                title="See real exercise data, not guesses"
                items={THERAPIST_POINTS}
              />
              <AudienceCard
                label="For patients"
                title="Set up the camera and start moving"
                items={PATIENT_POINTS}
              />
            </div>
          </div>
        </section>

        {/* Limits */}
        <section className="border-t border-[#e3e7df] bg-white">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 lg:py-24">
            <SectionHead
              label="Know its limits"
              title="What it does, and what it doesn't"
              text="It measures and reports your exercise. It does not make medical decisions."
            />
            <div className="mt-10 grid overflow-hidden rounded-xl border border-[#d9dfd6] bg-white md:grid-cols-2 md:divide-x md:divide-[#e3e7df]">
              <div>
                <h3 className="flex items-center gap-2 border-b border-[#e3e7df] bg-[#ecf4e8] px-5 py-3 text-sm font-semibold text-[#14532d]">
                  <span className="h-2 w-2 rounded-full bg-[#16a34a]" aria-hidden />What it does
                </h3>
                <ul className="divide-y divide-[#eef1eb]">
                  {DOES.map((item) => (
                    <li key={item} className="flex gap-3 px-5 py-3 text-[15px] text-[#26362c]"><Mark tone="yes" />{item}</li>
                  ))}
                </ul>
              </div>
              <div className="border-t border-[#e3e7df] md:border-t-0">
                <h3 className="flex items-center gap-2 border-b border-[#e3e7df] bg-[#f4f4f1] px-5 py-3 text-sm font-semibold text-[#5b6b60]">
                  <span className="h-2 w-2 rounded-full bg-[#9aa39c]" aria-hidden />What it doesn&apos;t do
                </h3>
                <ul className="divide-y divide-[#eef1eb]">
                  {DOES_NOT.map((item) => (
                    <li key={item} className="flex gap-3 px-5 py-3 text-[15px] text-[#26362c]"><Mark tone="no" />{item}</li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mx-auto mt-6 max-w-3xl text-center text-[13px] italic leading-relaxed text-[#5b6b60]">
              This is a support tool. It is not a medical device and has not been clinically validated. Angles are estimated
              from one front-facing camera, and your therapist reviews all results.
            </p>
          </div>
        </section>

        {/* Log in */}
        <section className="px-5 pb-16 sm:px-8 lg:pb-24">
          <div className="relative mx-auto max-w-6xl overflow-hidden rounded-2xl bg-[#14532d] px-6 py-10 text-white sm:px-10 sm:py-12">
            {/* The clinic logo's cross, as a quiet pattern. */}
            <svg className="pointer-events-none absolute -right-6 -top-6 h-[220px] w-[300px] opacity-[0.12]" aria-hidden>
              <defs>
                <pattern id="cta-plus" width="44" height="44" patternUnits="userSpaceOnUse">
                  <path d="M22 14v16M14 22h16" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
                </pattern>
              </defs>
              <rect width="100%" height="100%" fill="url(#cta-plus)" />
            </svg>
            <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
              <div className="flex items-center gap-4">
                <svg viewBox="0 0 24 24" className="h-10 w-10 shrink-0" aria-hidden>
                  <path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z" fill={ORANGE} />
                </svg>
                <div>
                  <h2 className="text-[24px] font-semibold tracking-[-0.02em]">Ready to start your session?</h2>
                  <p className="mt-1 text-[15px] text-[#cfe3d4]">Log in with the account your clinic gave you.</p>
                </div>
              </div>
              <Link
                href="/?view=login"
                scroll={false}
                className="inline-flex items-center justify-center gap-2 self-start rounded-md bg-white px-5 py-3 text-[15px] font-semibold text-[#14532d] transition-colors hover:bg-[#ecf4e8] md:self-auto"
              >
                Log In <Arrow />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="bg-[#10241a] text-sm text-[#c9d8ce]">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 sm:px-8 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Image src={logo} alt="" width={88} height={88} className="h-10 w-10 shrink-0 rounded-full" />
            <div className="leading-tight">
              <p className="font-semibold text-white">ACC+ Bacoor</p>
              <p className="text-xs">Orthopaedic and Physical Therapy Clinic, Accelerate and Comprehensive Care</p>
            </div>
          </div>
          <div className="space-y-1 md:text-right">
            <p>(046) 416 7479 / 0939-719-1892</p>
            <p>accptclinic_2019@yahoo.com</p>
            <p>Unit 1, L-1F, Tirona Highway, Habay 1, Bacoor City, Cavite</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
