import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { BacktestPage } from "./pages/BacktestPage";
import { ComparePage } from "./pages/ComparePage";
import { DashboardPage } from "./pages/DashboardPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { LandingPage } from "./pages/LandingPage";
import { LegalPage } from "./pages/LegalPage";
import { LoginPage } from "./pages/LoginPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SettingsPage } from "./pages/SettingsPage";
import { StrategyBuilderPage } from "./pages/StrategyBuilderPage";
import { SubscriptionPage } from "./pages/SubscriptionPage";
import { TradesPage } from "./pages/TradesPage";

export const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
  { path: "/auth/callback", element: <AuthCallbackPage /> },
  { path: "/privacy", element: <LegalPage /> },
  { path: "/terms", element: <LegalPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: "/dashboard", element: <DashboardPage /> },
          { path: "/builder", element: <StrategyBuilderPage /> },
          { path: "/backtest", element: <BacktestPage /> },
          { path: "/compare", element: <ComparePage /> },
          { path: "/trades", element: <TradesPage /> },
          { path: "/profile", element: <ProfilePage /> },
          { path: "/settings", element: <SettingsPage /> },
          { path: "/subscription", element: <SubscriptionPage /> },
        ],
      },
    ],
  },
]);
