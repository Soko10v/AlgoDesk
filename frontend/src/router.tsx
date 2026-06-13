import { Suspense, lazy, type ReactNode } from "react";
import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";

// Pages are code-split: each route is fetched on demand, so heavy libraries
// (reactflow on the builder, lightweight-charts on backtest) stay out of the
// initial bundle and only download when that page is actually opened.
const LandingPage = lazy(() => import("./pages/LandingPage").then((m) => ({ default: m.LandingPage })));
const LoginPage = lazy(() => import("./pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const AuthCallbackPage = lazy(() => import("./pages/AuthCallbackPage").then((m) => ({ default: m.AuthCallbackPage })));
const LegalPage = lazy(() => import("./pages/LegalPage").then((m) => ({ default: m.LegalPage })));
const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const StrategyBuilderPage = lazy(() => import("./pages/StrategyBuilderPage").then((m) => ({ default: m.StrategyBuilderPage })));
const BacktestPage = lazy(() => import("./pages/BacktestPage").then((m) => ({ default: m.BacktestPage })));
const ComparePage = lazy(() => import("./pages/ComparePage").then((m) => ({ default: m.ComparePage })));
const TradesPage = lazy(() => import("./pages/TradesPage").then((m) => ({ default: m.TradesPage })));
const ProfilePage = lazy(() => import("./pages/ProfilePage").then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const SubscriptionPage = lazy(() => import("./pages/SubscriptionPage").then((m) => ({ default: m.SubscriptionPage })));

function PageFallback() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/10 border-t-brand-500" />
    </div>
  );
}

function page(node: ReactNode) {
  return <Suspense fallback={<PageFallback />}>{node}</Suspense>;
}

export const router = createBrowserRouter([
  { path: "/", element: page(<LandingPage />) },
  { path: "/login", element: page(<LoginPage />) },
  { path: "/auth/callback", element: page(<AuthCallbackPage />) },
  { path: "/privacy", element: page(<LegalPage />) },
  { path: "/terms", element: page(<LegalPage />) },
  {
    element: <ProtectedRoute />,
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
