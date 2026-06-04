import { Link, useParams } from "react-router-dom";
import { Activity, ArrowLeft } from "lucide-react";

const PRIVACY = {
  title: "Privacy Policy",
  updated: "June 4, 2026",
  sections: [
    {
      heading: "What we collect",
      body: `When you create an account, we store your email address or Telegram username and an encrypted copy of the exchange API key and secret you provide. We do not collect payment information, IP addresses, or browsing behaviour beyond what is necessary to operate the service.`,
    },
    {
      heading: "How we use your data",
      body: `Your email is used only for authentication and essential service notifications. Your exchange API key and secret are stored encrypted (Fernet symmetric encryption) and used exclusively to place and cancel trading orders on your behalf according to the strategies you configure. We never sell or share your data with third parties for marketing purposes.`,
    },
    {
      heading: "Exchange API keys",
      body: `AlgoDesk requests only Read and Trade permissions on your exchange API key. Withdrawal permission is never requested and should never be granted. The API secret is write-only: once saved it is never returned to the browser. You can revoke the key from your exchange at any time to immediately disconnect AlgoDesk.`,
    },
    {
      heading: "Data retention",
      body: `Your data is retained for as long as your account is active. You may request complete deletion of your account and all associated data by contacting us. Encrypted API keys are deleted immediately upon disconnecting an exchange.`,
    },
    {
      heading: "Security",
      body: `All data is transmitted over HTTPS. API keys are encrypted before storage and the encryption key is stored separately from the database. We follow industry-standard practices to protect your information.`,
    },
    {
      heading: "Contact",
      body: `If you have questions about this policy, please contact us via the support channel in the app.`,
    },
  ],
};

const TERMS = {
  title: "Terms of Service",
  updated: "June 4, 2026",
  sections: [
    {
      heading: "Service description",
      body: `AlgoDesk is an algorithmic trading platform that allows users to build, backtest, and execute automated trading strategies on supported cryptocurrency exchanges (currently Bybit and Binance). AlgoDesk is a tool — it executes trades according to your strategy configuration and is not a financial adviser.`,
    },
    {
      heading: "Risk disclaimer",
      body: `Cryptocurrency trading involves significant risk. Past performance of a backtested strategy does not guarantee future results. You may lose some or all of your invested capital. By using AlgoDesk you acknowledge that you are solely responsible for your trading decisions and any resulting gains or losses.`,
    },
    {
      heading: "API key usage",
      body: `You grant AlgoDesk permission to interact with your exchange account solely through the API key you provide, and only to perform actions required by your active strategies (placing orders, reading balances and positions). You must not grant withdrawal permissions to the API key used with AlgoDesk.`,
    },
    {
      heading: "Acceptable use",
      body: `You agree not to use AlgoDesk for market manipulation, wash trading, or any activity that violates the terms of service of the connected exchanges or applicable laws.`,
    },
    {
      heading: "Availability",
      body: `We aim for high availability but do not guarantee uninterrupted service. We are not liable for losses caused by platform downtime, API rate limiting, or exchange outages.`,
    },
    {
      heading: "Changes to terms",
      body: `We may update these terms. Continued use of the service after changes constitutes acceptance of the new terms.`,
    },
  ],
};

export function LegalPage() {
  const { page } = useParams<{ page: string }>();
  const doc = page === "terms" ? TERMS : PRIVACY;

  return (
    <div className="min-h-screen">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-ink-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950 shadow-glow">
              <Activity className="h-4 w-4" strokeWidth={2.5} />
            </div>
            <span className="text-sm font-bold text-white">AlgoDesk</span>
          </Link>
          <Link to="/" className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition">
            <ArrowLeft className="h-4 w-4" /> Back
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-16">
        <h1 className="text-4xl font-bold text-white">{doc.title}</h1>
        <p className="mt-2 text-sm text-slate-500">Last updated: {doc.updated}</p>

        <div className="mt-12 space-y-10">
          {doc.sections.map((s) => (
            <div key={s.heading}>
              <h2 className="mb-3 text-lg font-semibold text-slate-100">{s.heading}</h2>
              <p className="leading-relaxed text-slate-400">{s.body}</p>
            </div>
          ))}
        </div>

        <div className="mt-16 flex gap-4 text-sm text-slate-500">
          <Link to="/privacy" className="hover:text-slate-300 transition">Privacy Policy</Link>
          <Link to="/terms" className="hover:text-slate-300 transition">Terms of Service</Link>
          <Link to="/" className="hover:text-slate-300 transition">← Home</Link>
        </div>
      </main>
    </div>
  );
}
