import Image from "next/image";
import type { ReactNode } from "react";
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
/** The white card the log in, password reset and change password forms sit in. */
export const AUTH_CARD =
  "mx-auto flex w-full max-w-[440px] flex-col gap-6 rounded-2xl border border-[#dfe5db] bg-white p-6 text-gray-900 shadow-[0_18px_48px_-24px_rgba(16,36,26,0.35)] sm:p-8";

const INK = "#10241a";
const ORANGE = "#ea580c";

/**
 * The frame for the change-password and first-time password pages. It matches
 * the landing page, where log in and the password reset open: the same header,
 * the same tinted hero, and the form in the same white card on the right.
 */
export default function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-[#fafaf7]" style={{ colorScheme: "light", color: INK }}>
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

      <main className="flex flex-1 overflow-hidden bg-[linear-gradient(to_right,#fafaf7_0%,#fafaf7_30%,#e8f5ec_62%)] max-lg:bg-[linear-gradient(to_bottom,#fafaf7_0%,#fafaf7_35%,#e8f5ec_70%)]">
        <div className="grid w-full items-center gap-8 pb-10 pt-12 sm:pt-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6 lg:py-16 lg:pl-12 xl:pl-20 2xl:pl-28">
          <div className="px-5 sm:px-8 lg:px-0">
            <p className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-[#5b6b60]">
              <span className="text-[13px] font-bold leading-none" style={{ color: ORANGE }} aria-hidden>+</span>
              Machine learning-assisted posture and exercise tracking
            </p>
            <h1 className="mt-4 text-[40px] font-semibold leading-[1.04] tracking-[-0.03em] sm:text-[52px] xl:text-[56px]">
              Postural <span className="text-[#15803d]">Monitoring</span> System
            </h1>
            <p className="mt-5 max-w-md text-[17px] leading-relaxed text-[#2f3f35]">
              Set your own password to keep your exercise records private.
            </p>
          </div>
          <div className="px-5 sm:px-8 lg:pr-12 xl:pr-20 2xl:pr-28">
            <section className={AUTH_CARD}>{children}</section>
          </div>
        </div>
      </main>
    </div>
  );
}
