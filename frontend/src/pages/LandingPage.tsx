import { useEffect } from "react";
import { Navigate, Link } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Boxes,
  ExternalLink,
  KeyRound,
  Lock,
  ShieldCheck,
  Sparkles,
  Zap,
} from "lucide-react";
import { useAuthStore } from "../store/auth";
import { Button } from "../components/ui";
import { LangSwitch } from "../components/LangSwitch";
import { track } from "../lib/analytics";
import { useT, type TranslationKey } from "../lib/i18n";

const features: { icon: typeof Boxes; titleKey: TranslationKey; textKey: TranslationKey }[] = [
  { icon: Boxes, titleKey: "landing.feature1Title", textKey: "landing.feature1Text" },
  { icon: BarChart3, titleKey: "landing.feature2Title", textKey: "landing.feature2Text" },
  { icon: Sparkles, titleKey: "landing.feature3Title", textKey: "landing.feature3Text" },
  { icon: Zap, titleKey: "landing.feature4Title", textKey: "landing.feature4Text" },
];

const securityPoints: { icon: typeof Lock; titleKey: TranslationKey; textKey: TranslationKey }[] = [
  { icon: Lock, titleKey: "landing.sec1Title", textKey: "landing.sec1Text" },
  { icon: KeyRound, titleKey: "landing.sec2Title", textKey: "landing.sec2Text" },
  { icon: ShieldCheck, titleKey: "landing.sec3Title", textKey: "landing.sec3Text" },
  { icon: Activity, titleKey: "landing.sec4Title", textKey: "landing.sec4Text" },
];

const faq: { qKey: TranslationKey; aKey: TranslationKey }[] = [
  { qKey: "landing.faq1Q", aKey: "landing.faq1A" },
  { qKey: "landing.faq2Q", aKey: "landing.faq2A" },
  { qKey: "landing.faq3Q", aKey: "landing.faq3A" },
  { qKey: "landing.faq4Q", aKey: "landing.faq4A" },
  { qKey: "landing.faq5Q", aKey: "landing.faq5A" },
  { qKey: "landing.faq6Q", aKey: "landing.faq6A" },
];

export function LandingPage() {
  const t = useT();
  const token = useAuthStore((s) => s.token);
  const ready = useAuthStore((s) => s.ready);

  useEffect(() => {
    track("page_view");
  }, []);

  // Redirect authenticated users straight to the app
  if (ready && token) return <Navigate to="/dashboard" replace />;

  return (
    <div className="min-h-screen">
      {/* ── Nav ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950 shadow-glow">
              <Activity className="h-5 w-5" strokeWidth={2.5} />
            </div>
            <div>
              <div className="text-sm font-bold tracking-tight text-white">AlgoDesk</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{t("layout.brandTagline")}</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <LangSwitch />
            <Link to="/login" className="text-sm font-medium text-slate-400 hover:text-white transition">
              {t("landing.signIn")}
            </Link>
            <Link to="/login?mode=signup" onClick={() => track("cta_click", { where: "nav" })}>
              <Button variant="primary" className="text-sm">{t("landing.getStarted")}</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 text-xs font-medium text-brand-300 mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse-soft" />
          {t("landing.badge")}
        </div>

        <h1 className="break-words text-3xl font-bold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
          {t("landing.h1Line1")}<br />
          <span className="text-brand-400">{t("landing.h1Line2")}</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          {t("landing.heroText")}
        </p>
        <p className="mx-auto mt-3 max-w-2xl text-sm font-medium text-brand-300">
          {t("landing.trialLine")}
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link to="/login?mode=signup" onClick={() => track("cta_click", { where: "hero" })}>
            <Button variant="primary" className="px-8 py-3 text-base">
              {t("landing.tryFree")}
            </Button>
          </Link>
          <a
            href="#how-it-works"
            className="text-sm font-medium text-slate-400 hover:text-white transition"
          >
            {t("landing.howItWorks")}
          </a>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-white">{t("landing.featuresHeading")}</h2>
          <p className="mt-3 text-slate-400">{t("landing.featuresSub")}</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.titleKey}
              className="card p-6"
            >
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-brand-500/10 text-brand-400">
                <f.icon className="h-5 w-5" />
              </div>
              <div className="mb-2 font-semibold text-slate-100">{t(f.titleKey)}</div>
              <div className="text-sm leading-relaxed text-slate-400">{t(f.textKey)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── How API keys work ────────────────────────────── */}
      <section className="border-y border-white/[0.06] bg-white/[0.02]">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-brand-300">
                <ShieldCheck className="h-4 w-4" /> {t("landing.securityLabel")}
              </div>
              <h2 className="text-3xl font-bold text-white">
                {t("landing.securityTitle")}
              </h2>
              <p className="mt-4 text-slate-400 leading-relaxed">
                {t("landing.securityText")}
              </p>
              <div className="mt-6 flex gap-4 text-sm text-slate-400">
                <a
                  href="https://www.bybit.com/app/user/api-management"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-brand-300 transition"
                >
                  {t("landing.bybitApiKeys")} <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a
                  href="https://www.binance.com/en/my/settings/api-management"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-brand-300 transition"
                >
                  {t("landing.binanceApiKeys")} <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {securityPoints.map((p) => (
                <div key={p.titleKey} className="card p-5">
                  <p.icon className="mb-3 h-5 w-5 text-brand-400" />
                  <div className="mb-1 text-sm font-semibold text-slate-100">{t(p.titleKey)}</div>
                  <div className="text-xs leading-relaxed text-slate-400">{t(p.textKey)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-5 py-20">
        <h2 className="text-center text-3xl font-bold text-white">{t("landing.faqHeading")}</h2>
        <div className="mt-10 space-y-3">
          {faq.map((item) => (
            <details key={item.qKey} className="card group p-5">
              <summary className="cursor-pointer list-none font-semibold text-slate-100 marker:content-none">
                <span className="mr-2 text-brand-400 transition-transform group-open:rotate-90 inline-block">›</span>
                {t(item.qKey)}
              </summary>
              <p className="mt-3 pl-5 text-sm leading-relaxed text-slate-400">{t(item.aKey)}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-24 text-center">
        <h2 className="text-3xl font-bold text-white">{t("landing.ctaHeading")}</h2>
        <p className="mt-4 text-slate-400">{t("landing.ctaSub")}</p>
        <div className="mt-8">
          <Link to="/login?mode=signup" onClick={() => track("cta_click", { where: "footer" })}>
            <Button variant="primary" className="px-10 py-3 text-base">
              {t("landing.createAccount")}
            </Button>
          </Link>
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────── */}
      <footer className="border-t border-white/[0.06] bg-ink-950/60">
        <div className="mx-auto max-w-6xl px-5 py-8">
          <div className="flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
            <div className="flex items-center gap-2">
              <div className="grid h-6 w-6 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950">
                <Activity className="h-3.5 w-3.5" strokeWidth={2.5} />
              </div>
              <span className="font-medium text-slate-400">AlgoDesk</span>
              <span>{t("landing.footerTagline")}</span>
            </div>
            <div className="flex items-center gap-5">
              <a href="https://t.me/algoDeskk" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition">{t("landing.telegram")}</a>
              <a href="mailto:sokolovpeterdev@gmail.com" className="hover:text-slate-300 transition">{t("landing.support")}</a>
              <Link to="/privacy" className="hover:text-slate-300 transition">{t("landing.privacy")}</Link>
              <Link to="/terms" className="hover:text-slate-300 transition">{t("landing.terms")}</Link>
              <span>© {new Date().getFullYear()} AlgoDesk</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
