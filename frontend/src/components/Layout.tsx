import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import {
  Activity,
  BarChart3,
  Boxes,
  CreditCard,
  GitCompare,
  LayoutDashboard,
  LineChart,
  LogOut,
  Mail,
  Scale,
  ScrollText,
  Send,
  SlidersHorizontal,
  UserCircle,
  type LucideIcon,
} from "lucide-react";
import { signOut } from "../hooks/useAuth";
import { usePlan } from "../hooks/usePlan";
import { useAuthStore } from "../store/auth";
import { cn } from "../lib/cn";
import { useT, type TranslationKey } from "../lib/i18n";
import { LangSwitch } from "./LangSwitch";

type NavItem = {
  to: string;
  labelKey: TranslationKey;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
};

type NavGroup = {
  id: string;
  labelKey: TranslationKey;
  items: NavItem[];
};

const navGroups: NavGroup[] = [
  {
    id: "strategies",
    labelKey: "nav.sectionStrategies",
    items: [
      { to: "/dashboard", labelKey: "nav.dashboard", icon: LayoutDashboard, end: true },
      { to: "/builder", labelKey: "nav.builder", icon: Boxes },
      { to: "/backtest", labelKey: "nav.backtest", icon: LineChart },
      { to: "/compare", labelKey: "nav.compare", icon: GitCompare },
      { to: "/trades", labelKey: "nav.trades", icon: ScrollText },
    ],
  },
  {
    id: "arbitrage",
    labelKey: "nav.sectionArbitrage",
    items: [{ to: "/arbitrage", labelKey: "nav.arbitrage", icon: Scale }],
  },
  {
    id: "account",
    labelKey: "nav.sectionAccount",
    items: [
      { to: "/settings", labelKey: "nav.exchange", icon: SlidersHorizontal },
      { to: "/subscription", labelKey: "nav.subscription", icon: CreditCard },
      { to: "/admin/analytics", labelKey: "nav.analytics", icon: BarChart3, adminOnly: true },
    ],
  },
];

const allNav = navGroups.flatMap((g) => g.items);

function Brand() {
  const t = useT();
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950 shadow-glow">
        <Activity className="h-5 w-5" strokeWidth={2.5} />
      </div>
      <div>
        <div className="text-sm font-bold tracking-tight text-white">AlgoDesk</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{t("layout.brandTagline")}</div>
      </div>
    </div>
  );
}

function NavItemLink({ item, compact }: { item: NavItem; compact?: boolean }) {
  const t = useT();
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        compact
          ? cn(
              "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition",
              isActive ? "bg-white/[0.07] text-white" : "text-slate-400 hover:bg-white/[0.04]"
            )
          : cn(
              "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
              isActive ? "bg-white/[0.06] text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
            )
      }
    >
      {({ isActive }) => (
        <>
          {!compact && isActive && (
            <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-500" />
          )}
          <item.icon className={compact ? "h-4 w-4" : "h-[18px] w-[18px]"} />
          {t(item.labelKey)}
        </>
      )}
    </NavLink>
  );
}

export function Layout() {
  const t = useT();
  const user = useAuthStore((s) => s.user);
  const { isAdmin } = usePlan();
  const handleLogout = () => {
    void signOut();
  };
  const location = useLocation();
  const initials = (user?.username ?? user?.email ?? "T").slice(0, 2).toUpperCase();
  const visibleGroups = navGroups.map((g) => ({
    ...g,
    items: g.items.filter((item) => !item.adminOnly || isAdmin),
  }));
  const visibleNav = visibleGroups.flatMap((g) => g.items);
  const currentLabelKey: TranslationKey =
    location.pathname.startsWith("/profile")
      ? "nav.profile"
      : (allNav.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))) ?? allNav[0])
          .labelKey;

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/40 p-4 lg:flex">
        <Brand />
        <nav className="mt-7 flex flex-1 flex-col gap-5">
          {visibleGroups.map((group) => (
            <div key={group.id}>
              <div className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                {t(group.labelKey)}
              </div>
              <div className="flex flex-col gap-1">
                {group.items.map((item) => (
                  <NavItemLink key={item.to} item={item} />
                ))}
              </div>
            </div>
          ))}
        </nav>
        <LangSwitch className="mb-2 self-start" />
        <a
          href="https://t.me/algoDeskk"
          target="_blank"
          rel="noopener noreferrer"
          title={t("nav.telegramChannelTitle")}
          className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
        >
          <Send className="h-[18px] w-[18px]" />
          {t("nav.telegramChannel")}
        </a>
        <a
          href="mailto:sokolovpeterdev@gmail.com"
          title={t("nav.supportTitle")}
          className="mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
        >
          <Mail className="h-[18px] w-[18px]" />
          {t("nav.support")}
        </a>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-md">
          <div className="flex items-center justify-between px-5 py-4 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="lg:hidden">
                <Brand />
              </div>
              <h2 className="hidden text-lg font-semibold text-white lg:block">{t(currentLabelKey)}</h2>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/profile"
                className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 transition hover:bg-white/[0.05]"
                title={t("nav.viewProfile")}
              >
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] text-xs font-semibold text-slate-200">
                  {initials}
                </div>
                <div className="hidden min-w-0 text-left sm:block">
                  <div className="max-w-36 truncate text-sm font-medium text-slate-200">
                    {user?.username ?? user?.email ?? t("nav.trader")}
                  </div>
                  <div className="max-w-36 truncate text-[11px] text-slate-500">{user?.email ?? "—"}</div>
                </div>
                <UserCircle className="hidden h-4 w-4 text-slate-500 sm:block" />
              </Link>
              <button
                onClick={handleLogout}
                title={t("nav.logout")}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-white/[0.06] hover:text-rose-300"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:hidden">
            {visibleNav.map((item) => (
              <NavItemLink key={item.to} item={item} compact />
            ))}
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-5 py-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
