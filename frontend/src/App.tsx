import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { useAuthBootstrap } from "./hooks/useAuth";
import { useWsEvents } from "./hooks/useWS";

export default function App() {
  useAuthBootstrap();
  useWsEvents();
  return <RouterProvider router={router} />;
}
