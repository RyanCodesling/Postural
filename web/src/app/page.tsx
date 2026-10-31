import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import bgImage from "../../media/acc_bacoor_landing_page.png";
import logo from "../../media/acc_bacoor_logo.png";

const LOGIN_BUTTON =
  "inline-flex items-center justify-center rounded-lg bg-green-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-green-500";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {children}
    </svg>
  );
}

const CAPABILITIES = [
  {
    title: "Counts your reps",
    text: "The camera watches you move and counts each repetition for you, so you can focus on the exercise.",
    icon: <Icon><path d="M4 12h3l2-6 4 12 2-6h5" /></Icon>,
  },
  {
    title: "Times your holds",
    text: "For exercises where you hold a position, each side is timed. The timer only runs while you are holding.",
    icon: <Icon><circle cx="12" cy="13" r="7" /><path d="M12 9v4l2.5 2M9 3h6" /></Icon>,
  },
  {
    title: "Posture tips",
    text: "If your posture slips, like uneven shoulders or leaning to one side, a short tip appears on the screen.",
    icon: <Icon><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /><path d="M9 11h6M9 14h4" /></Icon>,
  },
  {
    title: "Session reports",
    text: "After each session, your reps, holds, range of motion, posture and any pain you reported are saved for your therapist.",
    icon: <Icon><path d="M7 3h8l4 4v14H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></Icon>,
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

const STEPS = [
  {
    title: "The camera follows your movement",
    text: "The camera finds your main joints and measures their angles. It reads your body as a simple stick figure.",
  },
  {
    title: "The app counts and guides you",
    text: "It knows when each repetition starts and ends. If your form needs fixing, it shows one tip at a time.",
  },
  {
    title: "Your therapist sees the results",
    text: "After the session, your reps, holds, range of motion, posture and pain reports are sent to your therapist.",
  },
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

function SectionTitle({ eyebrow, title, text }: { eyebrow: string; title: string; text?: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs font-bold uppercase tracking-widest text-green-600">{eyebrow}</p>
      <h2 className="mt-2 text-3xl font-bold text-gray-900 sm:text-4xl">{title}</h2>
      {text && <p className="mt-3 text-gray-600">{text}</p>}
    </div>
  );
}

function Tick({ tone }: { tone: "yes" | "no" }) {
  return tone === "yes" ? (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-green-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
  ) : (
    <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
  );
}

function List({ items, tone = "yes" }: { items: string[]; tone?: "yes" | "no" }) {
  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-gray-700">
          <Tick tone={tone} />
          {item}
        </li>
      ))}
    </ul>
  );
}

export default function HomePage() {
  return (
    <div className="bg-white text-gray-900" style={{ colorScheme: "light" }}>
      <header className="relative overflow-hidden bg-green-950 text-white">
        {/* Only the photo's right side, which has no printed text, sits behind the hero. */}
        <div className="absolute inset-y-0 right-0 hidden w-2/5 lg:block">
          <Image src={bgImage} alt="" fill unoptimized priority className="object-cover object-right" />
          <div className="absolute inset-0 bg-gradient-to-r from-green-950 via-green-950/80 to-green-800/40" />
        </div>
        <div className="absolute inset-0 bg-gradient-to-br from-green-950/40 via-transparent to-green-700/30" />

        <div className="relative mx-auto max-w-6xl px-6">
          <nav className="flex items-center justify-between py-5">
            <div className="flex items-center gap-3">
              <Image src={logo} alt="ACC Bacoor" width={88} height={88} className="h-11 w-11 rounded-full ring-2 ring-white/40" />
              <div className="leading-tight">
                <p className="font-bold">ACC+ Bacoor</p>
                <p className="text-xs text-green-100">Orthopaedic and Physical Therapy Clinic</p>
              </div>
            </div>
          </nav>

          <div className="py-16 lg:py-28">
            <div>
              <p className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide text-green-50">
                Machine learning-assisted posture and exercise tracking
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-tight sm:text-5xl">Postural Monitoring System</h1>
              <p className="mt-5 max-w-xl text-lg text-green-50/90">
                Your camera works like an exercise coach. It counts your reps, times your holds and gives posture tips
                while you move. Then it sends a record of each session to your therapist.
              </p>
              <div className="mt-8">
                <Link href="/login" className={LOGIN_BUTTON}>Log In</Link>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-green-100">
                {["Works in your web browser", "Tracking happens on your device", "Records your exercise, does not diagnose"].map((badge) => (
                  <li key={badge} className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-green-300" />{badge}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="bg-[#f3f8f4] px-6 py-20">
          <SectionTitle
            eyebrow="What it does"
            title="Four things in every session"
            text="During each exercise, the system does four things and sends the results to your therapist."
          />
          <div className="mx-auto mt-12 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {CAPABILITIES.map((item) => (
              <div key={item.title} className="rounded-xl bg-white p-6 shadow-sm">
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-green-100 text-green-700">{item.icon}</span>
                <h3 className="mt-5 text-lg font-semibold text-gray-900">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{item.text}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="px-6 py-20">
          <SectionTitle eyebrow="For patients and therapists" title="One system for both" />
          <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-green-100 bg-white p-8 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-green-600">For therapists</p>
              <h3 className="mt-2 text-2xl font-bold">See real exercise data, not guesses</h3>
              <div className="mt-6"><List items={THERAPIST_POINTS} /></div>
            </div>
            <div className="rounded-2xl bg-green-700 p-8 text-white shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-green-200">For patients</p>
              <h3 className="mt-2 text-2xl font-bold">Set up the camera and start moving</h3>
              <ul className="mt-6 space-y-3">
                {PATIENT_POINTS.map((item) => (
                  <li key={item} className="flex gap-3 text-green-50">
                    <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-green-200" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m5 12 5 5 9-10" /></svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section id="how-it-works" className="scroll-mt-4 bg-[#f3f8f4] px-6 py-20">
          <SectionTitle eyebrow="How it works" title="From your camera to your therapist" />
          <ol className="mx-auto mt-12 grid max-w-6xl gap-6 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-xl bg-white p-6 shadow-sm">
                <span className="grid h-10 w-10 place-items-center rounded-full bg-green-600 text-lg font-bold text-white">{index + 1}</span>
                <h3 className="mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{step.text}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="px-6 py-20">
          <SectionTitle
            eyebrow="Know its limits"
            title="What it does, and what it doesn't"
            text="It measures and reports your exercise. It does not make medical decisions."
          />
          <div className="mx-auto mt-12 grid max-w-4xl gap-6 md:grid-cols-2">
            <div className="rounded-xl bg-white p-7 shadow-sm">
              <h3 className="mb-5 text-sm font-bold uppercase tracking-widest text-green-700">What it does</h3>
              <List items={DOES} />
            </div>
            <div className="rounded-xl bg-white p-7 shadow-sm">
              <h3 className="mb-5 text-sm font-bold uppercase tracking-widest text-gray-500">What it doesn&apos;t do</h3>
              <List items={DOES_NOT} tone="no" />
            </div>
          </div>
          <p className="mx-auto mt-6 max-w-3xl text-center text-xs text-gray-500">
            This is a support tool. It is not a medical device and has not been clinically validated. Angles are estimated
            from one front-facing camera, and your therapist reviews all results.
          </p>
        </section>

        <section className="bg-[#f3f8f4] px-6 py-20 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Ready to start your session?</h2>
          <p className="mx-auto mt-3 max-w-lg text-gray-600">Log in with the account your clinic gave you.</p>
          <Link href="/login" className={`${LOGIN_BUTTON} mt-8`}>Log In</Link>
        </section>
      </main>

      <footer className="bg-green-950 px-6 py-10 text-sm text-green-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Image src={logo} alt="" width={88} height={88} className="h-10 w-10 rounded-full" />
            <div className="leading-tight">
              <p className="font-bold text-white">ACC+ Bacoor</p>
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
