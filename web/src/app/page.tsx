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
    title: "Automatic rep counting",
    text: "The camera follows the movement and counts each repetition by itself, so patients can focus on moving instead of counting.",
    icon: <Icon><path d="M4 12h3l2-6 4 12 2-6h5" /></Icon>,
  },
  {
    title: "Timed holds",
    text: "Isometric exercises such as the arm hold are timed per side, and the clock only runs while the position is held.",
    icon: <Icon><circle cx="12" cy="13" r="7" /><path d="M12 9v4l2.5 2M9 3h6" /></Icon>,
  },
  {
    title: "Live form cues",
    text: "Short on-screen prompts appear when a movement drifts from the target, such as a shrugged shoulder or a leaning trunk.",
    icon: <Icon><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" /><path d="M9 11h6M9 14h4" /></Icon>,
  },
  {
    title: "Session reports",
    text: "Reps, holds, range of motion per side, form quality and any reported pain are saved after every session for the therapist.",
    icon: <Icon><path d="M7 3h8l4 4v14H7z" /><path d="M14 3v5h5M10 13h6M10 17h6" /></Icon>,
  },
];

const THERAPIST_POINTS = [
  "See what was actually done, not only what was reported",
  "Prescribe sets, reps, rest, side, resistance and a schedule",
  "Follow range-of-motion and repetition trends across sessions",
  "Review sessions, pain reports and form warnings",
  "Get a daily email of completed and missed exercises",
];

const PATIENT_POINTS = [
  "Follow the on-screen guide, with no counting or buttons mid-set",
  "See each day's exercises, with make-up days when you miss one",
  "Track your streak and your progress over time",
  "Pause and report pain at any moment",
  "Download your progress report as a PDF",
];

const STEPS = [
  {
    title: "The camera sees the movement",
    text: "A pose model running in the browser tracks the main joints from the webcam and turns them into angles, a stick-figure skeleton rather than a picture.",
  },
  {
    title: "The app counts and coaches",
    text: "Each exercise has its own rules for when a repetition starts and finishes, and which movement patterns to flag. Cues appear one at a time.",
  },
  {
    title: "The therapist gets the data",
    text: "After the session the numbers go to the assigned therapist's dashboard: repetitions, holds, range of motion, form and pain reports.",
  },
];

const DOES = [
  "Counts repetitions and times holds",
  "Estimates joint angles from a single camera",
  "Shows on-screen form cues",
  "Reports session data to the therapist",
  "Shows trends across sessions",
];

const DOES_NOT = [
  "Diagnose any condition",
  "Change or recommend a treatment",
  "Decide what is clinically significant",
  "Predict outcomes",
  "Replace a therapist's judgement",
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
                <p className="font-bold">ACC Bacoor</p>
                <p className="text-xs text-green-100">Orthopaedic and Physical Therapy Clinic</p>
              </div>
            </div>
          </nav>

          <div className="py-16 lg:py-28">
            <div>
              <p className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide text-green-50">
                Machine Learning-assisted posture and movement analysis
              </p>
              <h1 className="mt-5 text-4xl font-bold leading-tight sm:text-5xl">Postural Monitoring System</h1>
              <p className="mt-5 max-w-xl text-lg text-green-50/90">
                Your webcam becomes a hands-free exercise coach: it counts repetitions, times holds and shows form cues
                as you move, then sends your therapist objective data after every session.
              </p>
              <div className="mt-8">
                <Link href="/login" className={LOGIN_BUTTON}>Log In</Link>
              </div>
              <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-green-100">
                {["Runs in the browser", "Pose tracking on your device", "Descriptive data, not a diagnosis"].map((badge) => (
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
            eyebrow="What the system does"
            title="Four things in every session"
            text="During each prescribed exercise the system does four jobs and sends the results to the therapist."
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
          <SectionTitle eyebrow="Built for both sides of the program" title="One system, two experiences" />
          <div className="mx-auto mt-12 grid max-w-5xl gap-6 md:grid-cols-2">
            <div className="rounded-2xl border border-green-100 bg-white p-8 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-green-600">For therapists</p>
              <h3 className="mt-2 text-2xl font-bold">Stop relying on self-reported reps</h3>
              <div className="mt-6"><List items={THERAPIST_POINTS} /></div>
            </div>
            <div className="rounded-2xl bg-green-700 p-8 text-white shadow-sm">
              <p className="text-xs font-bold uppercase tracking-widest text-green-200">For patients</p>
              <h3 className="mt-2 text-2xl font-bold">Just set up the camera and move</h3>
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
          <SectionTitle eyebrow="How it works" title="From camera frame to therapist report" />
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
            eyebrow="Clear about its limits"
            title="What the software is, and what it isn't"
            text="It is a measurement and reporting tool, not a decision-making tool."
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
            Supplementary monitoring output, not a medical device and not clinically validated. Angles are estimated from a
            single front-facing camera, and the therapist independently reviews all data.
          </p>
        </section>

        <section className="bg-[#f3f8f4] px-6 py-20 text-center">
          <h2 className="text-3xl font-bold text-gray-900">Ready to start your session?</h2>
          <p className="mx-auto mt-3 max-w-lg text-gray-600">Log in with the account your clinic created for you.</p>
          <Link href="/login" className={`${LOGIN_BUTTON} mt-8`}>Log In</Link>
        </section>
      </main>

      <footer className="bg-green-950 px-6 py-10 text-sm text-green-100">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Image src={logo} alt="" width={88} height={88} className="h-10 w-10 rounded-full" />
            <div className="leading-tight">
              <p className="font-bold text-white">ACC Bacoor</p>
              <p className="text-xs">Orthopaedic and Physical Therapy Clinic, Accelerate and Comprehensive Care</p>
            </div>
          </div>
          <div className="space-y-1 md:text-right">
            <p>(046) 416 7479 / 0939-719-1892</p>
            <p>accptclinic_2019@yahoo.com</p>
            <p>Ground Floor GPI Bldg. Tirona Highway Habay I, Bacoor City, Cavite</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
