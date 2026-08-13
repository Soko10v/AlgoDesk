import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./router";
import { useAuthBootstrap } from "./hooks/useAuth";
import { useWsEvents } from "./hooks/useWS";
import { Toaster } from "./components/Toaster";
import { useLangStore } from "./store/lang";

export default function App() {
  useAuthBootstrap();
  useWsEvents();
  const lang = useLangStore((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return (
    <>
      <RouterProvider router={router} />
      <Toaster />
    </>
  );
}
