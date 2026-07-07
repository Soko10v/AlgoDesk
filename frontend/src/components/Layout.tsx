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
  ScrollText,
  SlidersHorizontal,
  UserCircle,
} from "lucide-react";
import { signOut } from "../hooks/useAuth";
import { usePlan } from "../hooks/usePlan";
import { useAuthStore } from "../store/auth";
import { cn } from "../lib/cn";

const nav = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/builder", label: "Strategy Builder", icon: Boxes, end: false },
  { to: "/backtest", label: "Backtest", icon: LineChart, end: false },
  { to: "/compare", label: "Compare", icon: GitCompare, end: false },
  { to: "/trades", label: "Trade Log", icon: ScrollText, end: false, requiresSubscription: true },
  { to: "/settings", label: "Exchange", icon: SlidersHorizontal, end: false, requiresSubscription: true },
  { to: "/subscription", label: "Subscription", icon: CreditCard, end: false },
  { to: "/admin/analytics", label: "Analytics", icon: BarChart3, end: false, adminOnly: true },
];

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-ink-950 shadow-glow">
        <Activity className="h-5 w-5" strokeWidth={2.5} />
      </div>
      <div>
        <div className="text-sm font-bold tracking-tight text-white">AlgoDesk</div>
        <div className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Trading bots</div>
      </div>
    </div>
  );
}

export function Layout() {
  const user = useAuthStore((s) => s.user);
  const { plan, isAdmin } = usePlan();
  const handleLogout = () => {
    void signOut();
  };
  const location = useLocation();
  const initials = (user?.username ?? user?.email ?? "T").slice(0, 2).toUpperCase();
  const visibleNav = nav.filter(
    (item) => (!item.requiresSubscription || plan !== "free") && (!item.adminOnly || isAdmin)
  );
  const current =
    location.pathname.startsWith("/profile")
      ? { label: "Profile" }
      : nav.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to))) ?? nav[0];

  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-white/[0.06] bg-ink-950/40 p-4 lg:flex">
        <Brand />
        <nav className="mt-7 flex flex-1 flex-col gap-1">
          {visibleNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                cn(
                  "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition",
                  isActive ? "bg-white/[0.06] text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200"
                )
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-5 w-1 -translate-y-1/2 rounded-r-full bg-brand-500" />
                  )}
                  <item.icon className="h-[18px] w-[18px]" />
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <a
          href="mailto:sokolovpeterdev@gmail.com"
          title="Email support"
          className="mb-2 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-400 transition hover:bg-white/[0.04] hover:text-slate-200"
        >
          <Mail className="h-[18px] w-[18px]" />
          Support
        </a>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-md">
          <div className="flex items-center justify-between px-5 py-4 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="lg:hidden">
                <Brand />
              </div>
              <h2 className="hidden text-lg font-semibold text-white lg:block">{current.label}</h2>
            </div>
            <div className="flex items-center gap-3">
              <Link
                to="/profile"
                className="flex min-w-0 items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 transition hover:bg-white/[0.05]"
                title="View profile"
              >
                <div className="grid h-8 w-8 place-items-center rounded-lg bg-white/[0.06] text-xs font-semibold text-slate-200">
                  {initials}
                </div>
                <div className="hidden min-w-0 text-left sm:block">
                  <div className="max-w-36 truncate text-sm font-medium text-slate-200">
                    {user?.username ?? user?.email ?? "Trader"}
                  </div>
                  <div className="max-w-36 truncate text-[11px] text-slate-500">{user?.email ?? "—"}</div>
                </div>
                <UserCircle className="hidden h-4 w-4 text-slate-500 sm:block" />
              </Link>
              <button
                onClick={handleLogout}
                title="Log out"
                className="rounded-lg p-2 text-slate-400 transition hover:bg-white/[0.06] hover:text-rose-300"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>

          <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:hidden">
            {visibleNav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition",
                    isActive ? "bg-white/[0.07] text-white" : "text-slate-400 hover:bg-white/[0.04]"
                  )
                }
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </NavLink>
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
