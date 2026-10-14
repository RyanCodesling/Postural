import Image from "next/image";
import type { ReactNode } from "react";
import bgImage from "../../../media/acc_bacoor_landing_page.png";
import logo from "../../../media/acc_bacoor_logo.png";

export const AUTH_INPUT =
  "peer w-full rounded-lg border border-green-200 bg-white px-4 pt-6 pb-2 text-base text-gray-900 focus:border-green-500 focus:outline-none focus:ring-2 focus:ring-green-200";
export const AUTH_INPUT_WITH_TOGGLE = `${AUTH_INPUT} pr-11`;
export const AUTH_LABEL =
  "pointer-events-none absolute left-4 top-3 text-xs text-green-700 transition-all duration-200 peer-placeholder-shown:top-1/2 peer-placeholder-shown:-translate-y-1/2 peer-placeholder-shown:text-base peer-placeholder-shown:text-gray-400 peer-focus:top-3 peer-focus:translate-y-0 peer-focus:text-xs peer-focus:text-green-700";
export const AUTH_BUTTON =
  "w-full rounded-lg bg-green-600 py-3 text-base font-semibold tracking-wide text-white transition-colors hover:bg-green-700 disabled:bg-green-300";
export const AUTH_ERROR =
  "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm text-red-700";
export const AUTH_TOGGLE =
  "absolute right-3 top-1/2 -translate-y-1/2 text-gray-600 transition-colors hover:text-green-700";
export const AUTH_LINK =
  "text-sm font-medium text-green-700 transition-colors hover:text-green-900";

const SERVICES = ["Orthopaedic Consultation", "Rehabilitation Medicine", "Physical Therapy Services"];

function Check() {
  return (
    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-white/20">
      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        <path d="m5 12 5 5 9-10" />
      </svg>
    </span>
  );
}

/**
 * The shared frame for the signed-out pages: a green brand panel (clinic photo
 * under a green wash, with the clinic details as live text) beside a clean
 * white form panel. On small screens only the form panel shows.
 */
export default function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <main className="grid min-h-screen bg-white text-gray-900 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]" style={{ colorScheme: "light" }}>
      <aside className="relative hidden overflow-hidden text-white lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <Image src={bgImage} alt="" fill unoptimized priority className="object-cover object-right" />
        <div className="absolute inset-0 bg-gradient-to-br from-green-950/95 via-green-900/85 to-green-700/55" />

        <div className="relative flex items-center gap-4">
          <Image src={logo} alt="ACC Bacoor" width={112} height={112} className="h-14 w-14 shrink-0 rounded-full ring-2 ring-white/40" />
          <div className="leading-tight">
            <p className="text-lg font-bold">ACC Bacoor</p>
            <p className="text-sm text-green-100">Orthopaedic and Physical Therapy Clinic</p>
          </div>
        </div>

        <div className="relative max-w-lg space-y-8">
          <div className="space-y-4">
            <h2 className="text-4xl font-bold leading-tight xl:text-5xl">Postural Monitoring System</h2>
            <p className="text-lg text-green-50/90">
              Accelerate and comprehensive care, with camera-assisted posture and movement analysis for every session.
            </p>
          </div>
          <ul className="space-y-3 text-base">
            {SERVICES.map((service) => (
              <li key={service} className="flex items-center gap-3">
                <Check />
                {service}
              </li>
            ))}
          </ul>
        </div>

        <div className="relative space-y-1 text-sm text-green-100">
          <p>(046) 416 7479 / 0939-719-1892</p>
          <p>accptclinic_2019@yahoo.com</p>
          <p>Ground Floor GPI Bldg. Tirona Highway Habay I, Bacoor City, Cavite</p>
        </div>
      </aside>

      <div className="flex items-center justify-center bg-[#f7fbf8] px-6 py-10 sm:px-12">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <div className="flex items-center gap-3 lg:hidden">
            <Image src={logo} alt="ACC Bacoor" width={88} height={88} className="h-11 w-11 shrink-0 rounded-full" />
            <div className="leading-tight">
              <p className="text-xl font-bold text-gray-900">ACC Bacoor</p>
              <p className="text-sm text-gray-600">Postural Monitoring System</p>
            </div>
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}
