import { Suspense, lazy, useEffect, type ComponentType, type ReactNode } from "react";
import * as Sentry from "@sentry/react";
import { createBrowserRouter, useRouteError } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";

// After a deploy the previous build's content-hashed chunks are gone, so an
// already-open tab that lazy-navigates hits a 404 ("Importing a module script
// failed"). Reload once to pull the fresh index.html + new chunk names; a short
// sessionStorage guard prevents a reload loop if the chunk is genuinely
// unreachable (offline / real 404).
function lazyWithRetry<T extends ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      const key = "chunk_reload_at";
      const now = Date.now();
      const last = Number(sessionStorage.getItem(key) ?? 0);
      if (now - last > 15_000) {
        sessionStorage.setItem(key, String(now));
        window.location.reload();
        return new Promise<{ default: T }>(() => {}); // hang until the reload navigates away
      }
      throw err;
    }
  });
}

// Pages are code-split: each route is fetched on demand, so heavy libraries
// (reactflow on the builder, lightweight-charts on backtest) stay out of the
// initial bundle and only download when that page is actually opened.
const LandingPage = lazyWithRetry(() => import("./pages/LandingPage").then((m) => ({ default: m.LandingPage })));
const LoginPage = lazyWithRetry(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const AuthCallbackPage = lazyWithRetry(() => import("./pages/AuthCallbackPage").then((m) => ({ default: m.AuthCallbackPage })));
const AuthConfirmPage = lazyWithRetry(() => import("./pages/AuthConfirmPage").then((m) => ({ default: m.AuthConfirmPage })));
const LegalPage = lazyWithRetry(() => import("./pages/LegalPage").then((m) => ({ default: m.LegalPage })));
const DashboardPage = lazyWithRetry(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const StrategyBuilderPage = lazyWithRetry(() => import("./pages/StrategyBuilderPage").then((m) => ({ default: m.StrategyBuilderPage })));
const BacktestPage = lazyWithRetry(() => import("./pages/BacktestPage").then((m) => ({ default: m.BacktestPage })));
const ComparePage = lazyWithRetry(() => import("./pages/ComparePage").then((m) => ({ default: m.ComparePage })));
const TradesPage = lazyWithRetry(() => import("./pages/TradesPage").then((m) => ({ default: m.TradesPage })));
const ProfilePage = lazyWithRetry(() => import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazyWithRetry(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const SubscriptionPage = lazyWithRetry(() => import("./pages/SubscriptionPage").then((m) => ({ default: m.SubscriptionPage })));

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-brand-500" />
    </div>
  );
}

// Shown for any uncaught error in a route's render — a real bug, an offline
// network, or a chunk-load failure that outlived lazyWithRetry's one silent
// reload. Report it: this errorElement is a React error boundary, so the
// exception never reaches window.onerror / Sentry's automatic capture —
// without this, a render crash here is invisible to monitoring.
function RouteError() {
  const error = useRouteError();
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);
  return (
    <div className="grid min-h-screen place-items-center p-6 text-center">
      <div className="max-w-sm space-y-3">
        <div className="text-base font-semibold text-slate-200">Не удалось загрузить страницу</div>
        <p className="text-sm text-slate-500">
          Возможно, вышло обновление. Обнови страницу — если не поможет, проверь соединение.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-brand-500"
        >
          Обновить
        </button>
      </div>
    </div>
  );
}

function page(node: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  { path: "/", element: page(<LandingPage />), errorElement: <RouteError /> },
  { path: "/login", element: page(<LoginPage />), errorElement: <RouteError /> },
  { path: "/auth/callback", element: page(<AuthCallbackPage />), errorElement: <RouteError /> },
  { path: "/auth/confirm", element: page(<AuthConfirmPage />), errorElement: <RouteError /> },
  { path: "/privacy", element: page(<LegalPage />), errorElement: <RouteError /> },
  { path: "/terms", element: page(<LegalPage />), errorElement: <RouteError /> },
  {
    element: <ProtectedRoute />,
    errorElement: <RouteError />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: "/dashboard", element: page(<DashboardPage />) },
          { path: "/builder", element: page(<StrategyBuilderPage />) },
          { path: "/backtest", element: page(<BacktestPage />) },
          { path: "/compare", element: page(<ComparePage />) },
          { path: "/trades", element: page(<TradesPage />) },
          { path: "/profile", element: page(<ProfilePage />) },
          { path: "/settings", element: page(<SettingsPage />) },
          { path: "/subscription", element: page(<SubscriptionPage />) },
        ],
      },
    ],
  },
]);
