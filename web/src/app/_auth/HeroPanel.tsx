"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import LoginForm from "./LoginForm";
import ForgotPasswordForm from "./ForgotPasswordForm";

export type HeroView = "video" | "login" | "forgot";

/** The hero's right side for the page address: `?view=login` or `?view=forgot` shows that form. */
export function heroViewFor(view: string | null): HeroView {
  return view === "login" || view === "forgot" ? view : "video";
}

/**
 * The landing page hero's right side: the video, or in its place the log in
 * form or the password reset. Each is its own address, so the browser's Back
 * button steps back through them.
 */
export default function HeroPanel({ video }: { video: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = heroViewFor(searchParams.get("view"));
  const panelRef = useRef<HTMLDivElement>(null);

  const go = (next: HeroView, extra = "") => {
    const query = next === "video" ? "" : `?view=${next}${extra}`;
    router.push(`${pathname}${query}`, { scroll: false });
  };

  // When a form opens, bring it into view (it sits below the text on phones
  // and tablets, and the closing Log In button is far down the page) and put
  // the cursor in its first field.
  useEffect(() => {
    if (view === "video") return;
    const panel = panelRef.current;
    if (!panel) return;
    const box = panel.getBoundingClientRect();
    if (box.top < 0 || box.bottom > window.innerHeight) {
      panel.scrollIntoView({ behavior: "smooth", block: box.height > window.innerHeight ? "start" : "center" });
    }
    panel.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, [view]);

  if (view === "video") return <>{video}</>;

  return (
    <div ref={panelRef} className="scroll-mt-6 px-5 sm:px-8 lg:pr-12 xl:pr-20 2xl:pr-28">
      <section
        aria-label={view === "login" ? "Log in" : "Reset your password"}
        className="mx-auto flex w-full max-w-[440px] flex-col gap-6 rounded-2xl border border-[#dfe5db] bg-white p-6 text-gray-900 shadow-[0_18px_48px_-24px_rgba(16,36,26,0.35)] sm:p-8"
      >
        {view === "login" ? (
          <LoginForm resetSuccess={searchParams.get("reset") === "success"} onForgot={() => go("forgot")} />
        ) : (
          <ForgotPasswordForm onDone={() => go("login", "&reset=success")} />
        )}
        <button
          type="button"
          onClick={() => go(view === "login" ? "video" : "login")}
          className="self-start text-sm font-medium text-green-700 transition-colors hover:text-green-900"
        >
          {view === "login" ? "‹ Back" : "‹ Back to Login"}
        </button>
      </section>
    </div>
  );
}
