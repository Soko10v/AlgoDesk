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
import { track } from "../lib/analytics";

const features = [
  {
    icon: Boxes,
    title: "Визуальный конструктор стратегий",
    text: "Собери торгового бота из готовых блоков: вход, фильтры, стоп-лосс и тейк-профит. Программировать не нужно.",
  },
  {
    icon: BarChart3,
    title: "Бэктест на реальных данных",
    text: "Проверь стратегию на настоящей истории котировок Bybit и Binance: кривая доходности, просадка, винрейт — до того, как рисковать деньгами.",
  },
  {
    icon: Sparkles,
    title: "Готовые стратегии",
    text: "Не разбираешься в индикаторах? Сервер сам перебирает тысячи вариантов на свежих данных и раз в пару дней публикует лучшие — выбери и запусти.",
  },
  {
    icon: Zap,
    title: "Paper и live торговля",
    text: "Обкатай бота в paper-режиме без риска, потом запусти автоматическую торговлю на бирже — бот работает 24/7 без эмоций.",
  },
];

const securityPoints = [
  {
    icon: Lock,
    title: "Шифрование ключей",
    text: "API-ключ и секрет шифруются до записи в базу. В открытом виде они никогда не хранятся.",
  },
  {
    icon: KeyRound,
    title: "Ключ нельзя прочитать",
    text: "После сохранения секретный ключ не возвращается в браузер — его можно только заменить или удалить.",
  },
  {
    icon: ShieldCheck,
    title: "Без права вывода",
    text: "AlgoDesk нужны только права Read и Trade. Право на вывод средств не запрашивается — платформа физически не может вывести деньги с биржи.",
  },
  {
    icon: Activity,
    title: "Контроль у тебя",
    text: "Отзови API-ключ на бирже в любой момент — AlgoDesk мгновенно теряет доступ. Никакой привязки.",
  },
];

const faq = [
  {
    q: "Что такое торговый бот и как он работает?",
    a: "Торговый бот — это программа, которая покупает и продаёт криптовалюту по заданной стратегии автоматически, 24/7, без эмоций. В AlgoDesk стратегия собирается из готовых блоков: условие входа, фильтры, стоп-лосс и тейк-профит.",
  },
  {
    q: "Нужно ли уметь программировать?",
    a: "Нет. Стратегия собирается в визуальном конструкторе из готовых блоков, а для новичков есть готовые стратегии, которые сервер подбирает автоматически на реальных данных.",
  },
  {
    q: "Это бесплатно?",
    a: "Конструктор, бэктесты на реальной истории, оптимизатор параметров и готовые стратегии — бесплатны и без ограничений. Платная подписка нужна только для запуска ботов в реальную торговлю (Pro от $7 в месяц).",
  },
  {
    q: "На каких биржах работают боты?",
    a: "Bybit и Binance — подключение через официальный API биржи с ключами без права вывода средств.",
  },
  {
    q: "Могут ли боты украсть или вывести мои деньги?",
    a: "Нет. AlgoDesk не хранит ваши средства — деньги остаются на вашей бирже. API-ключ создаётся без права вывода, шифруется при хранении и может быть отозван на бирже в любой момент.",
  },
  {
    q: "Гарантирован ли заработок на торговых ботах?",
    a: "Нет. Торговля криптовалютой сопряжена с риском, а прошлая доходность стратегии не гарантирует будущую. Поэтому в AlgoDesk каждая стратегия сначала проверяется бэктестом и paper-режимом без риска, и только потом запускается на реальные деньги.",
  },
];

export function LandingPage() {
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
              <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Trading bots</div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm font-medium text-slate-400 hover:text-white transition">
              Войти
            </Link>
            <Link to="/login?mode=signup" onClick={() => track("cta_click", { where: "nav" })}>
              <Button variant="primary" className="text-sm">Начать бесплатно</Button>
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 pb-16 pt-24 text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-brand-500/30 bg-brand-500/10 px-4 py-1.5 text-xs font-medium text-brand-300 mb-8">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-400 animate-pulse-soft" />
          Работает с Bybit и Binance
        </div>

        <h1 className="break-words text-3xl font-bold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl">
          Торговые боты для криптовалюты<br />
          <span className="text-brand-400">без программирования</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-slate-400">
          AlgoDesk — платформа алготрейдинга: собери стратегию в визуальном конструкторе,
          проверь её бэктестом на реальной истории и запусти автоматическую торговлю
          на Bybit или Binance — сначала без риска, потом вживую.
        </p>
        <p className="mx-auto mt-3 max-w-2xl text-sm font-medium text-brand-300">
          🎁 14 дней полного доступа бесплатно — включая live-торговлю и AI. Карта не нужна.
        </p>
        <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
          <Link to="/login?mode=signup" onClick={() => track("cta_click", { where: "hero" })}>
            <Button variant="primary" className="px-8 py-3 text-base">
              Попробовать бесплатно
            </Button>
          </Link>
          <a
            href="#how-it-works"
            className="text-sm font-medium text-slate-400 hover:text-white transition"
          >
            Как это работает ↓
          </a>
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section id="how-it-works" className="mx-auto max-w-6xl px-5 py-20">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold text-white">Всё для автоматической торговли</h2>
          <p className="mt-3 text-slate-400">От идеи до работающего бота за минуты — без единой строчки кода.</p>
        </div>
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {features.map((f) => (
            <div
              key={f.title}
              className="card p-6"
            >
              <div className="mb-4 grid h-10 w-10 place-items-center rounded-xl bg-brand-500/10 text-brand-400">
                <f.icon className="h-5 w-5" />
              </div>
              <div className="mb-2 font-semibold text-slate-100">{f.title}</div>
              <div className="text-sm leading-relaxed text-slate-400">{f.text}</div>
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
                <ShieldCheck className="h-4 w-4" /> Безопасность
              </div>
              <h2 className="text-3xl font-bold text-white">
                Твои деньги остаются на твоей бирже
              </h2>
              <p className="mt-4 text-slate-400 leading-relaxed">
                Чтобы торговать от твоего имени, AlgoDesk подключается к Bybit или Binance через
                их официальный API. Ты создаёшь на бирже ограниченный API-ключ и вставляешь его
                сюда. У платформы нет доступа к твоим средствам — только возможность открывать
                и закрывать позиции по правилам твоей стратегии.
              </p>
              <div className="mt-6 flex gap-4 text-sm text-slate-400">
                <a
                  href="https://www.bybit.com/app/user/api-management"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-brand-300 transition"
                >
                  API-ключи Bybit <ExternalLink className="h-3.5 w-3.5" />
                </a>
                <a
                  href="https://www.binance.com/en/my/settings/api-management"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 hover:text-brand-300 transition"
                >
                  API-ключи Binance <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              {securityPoints.map((p) => (
                <div key={p.title} className="card p-5">
                  <p.icon className="mb-3 h-5 w-5 text-brand-400" />
                  <div className="mb-1 text-sm font-semibold text-slate-100">{p.title}</div>
                  <div className="text-xs leading-relaxed text-slate-400">{p.text}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── FAQ ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-3xl px-5 py-20">
        <h2 className="text-center text-3xl font-bold text-white">Частые вопросы</h2>
        <div className="mt-10 space-y-3">
          {faq.map((item) => (
            <details key={item.q} className="card group p-5">
              <summary className="cursor-pointer list-none font-semibold text-slate-100 marker:content-none">
                <span className="mr-2 text-brand-400 transition-transform group-open:rotate-90 inline-block">›</span>
                {item.q}
              </summary>
              <p className="mt-3 pl-5 text-sm leading-relaxed text-slate-400">{item.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-5 py-24 text-center">
        <h2 className="text-3xl font-bold text-white">Готов автоматизировать торговлю?</h2>
        <p className="mt-4 text-slate-400">Бесплатный старт. Банковская карта не нужна.</p>
        <div className="mt-8">
          <Link to="/login?mode=signup" onClick={() => track("cta_click", { where: "footer" })}>
            <Button variant="primary" className="px-10 py-3 text-base">
              Создать бесплатный аккаунт
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
              <span>— платформа алготрейдинга</span>
            </div>
            <div className="flex items-center gap-5">
              <a href="https://t.me/algoDeskk" target="_blank" rel="noopener noreferrer" className="hover:text-slate-300 transition">Telegram</a>
              <a href="mailto:sokolovpeterdev@gmail.com" className="hover:text-slate-300 transition">Поддержка</a>
              <Link to="/privacy" className="hover:text-slate-300 transition">Конфиденциальность</Link>
              <Link to="/terms" className="hover:text-slate-300 transition">Условия</Link>
              <span>© {new Date().getFullYear()} AlgoDesk</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
