import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { BacktestPage } from "./pages/BacktestPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LandingPage } from "./pages/LandingPage";
import { LegalPage } from "./pages/LegalPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StrategyBuilderPage } from "./pages/StrategyBuilderPage";
import { SubscriptionPage } from "./pages/SubscriptionPage";
import { TradesPage } from "./pages/TradesPage";

export const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LoginPage /> },
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
          { path: "/trades", element: <TradesPage /> },
          { path: "/settings", element: <SettingsPage /> },
          { path: "/subscription", element: <SubscriptionPage /> },
        ],
      },
    ],
  },
]);
