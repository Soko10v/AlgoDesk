import { createBrowserRouter } from "react-router-dom";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { BacktestPage } from "./pages/BacktestPage";
import { DashboardPage } from "./pages/DashboardPage";
import { LoginPage } from "./pages/LoginPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StrategyBuilderPage } from "./pages/StrategyBuilderPage";
import { SubscriptionPage } from "./pages/SubscriptionPage";
import { TradesPage } from "./pages/TradesPage";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <ProtectedRoute />,
    children: [
      {
        element: <Layout />,
        children: [
          { path: "/", element: <DashboardPage /> },
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
