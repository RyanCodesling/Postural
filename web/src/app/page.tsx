import Link from "next/link";
import Image from "next/image";
import bgImage from "../../media/acc_bacoor_landing_page.png";
import logoImage from "../../media/acc_bacoor_logo.png";

export default function HomePage() {
  return (
    <main className="relative min-h-screen flex items-center justify-end pr-56 overflow-hidden">

      {/* Background image — full opacity */}
      <Image
        src={bgImage}
        alt=""
        fill
        unoptimized
        className="object-cover object-center"
        priority
      />

      {/* Card */}
      <div className="relative z-10 flex flex-col items-center gap-7 px-12 py-14 rounded-3xl bg-green-800/55 backdrop-blur-sm border border-green-700/50 shadow-2xl text-center max-w-md w-11/12">

        {/* ACC Bacoor logo */}
        <div className="w-32 h-32 rounded-full overflow-hidden bg-green-600 shadow-lg ring-4 ring-white/30 flex items-center justify-center">
          <Image
            src={logoImage}
            alt="ACC Bacoor Logo"
            width={128}
            height={128}
            unoptimized
            priority
            className="w-full h-full object-cover"
          />
        </div>

        <div className="space-y-3">
          <h1 className="text-4xl font-bold text-white tracking-tight">
            ACC Bacoor
          </h1>
          <p className="text-lg font-medium text-white">
            Postural Monitoring System
          </p>
          <p className="text-base text-white leading-relaxed">
            Machine Learning-assisted posture and movement analysis
          </p>
        </div>

        <Link
          href="/login"
          className="w-full py-3.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-semibold shadow-lg transition-colors text-base tracking-wide"
        >
          Log In
        </Link>
      </div>

    </main>
  );
}
