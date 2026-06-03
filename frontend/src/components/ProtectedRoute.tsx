import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { Spinner } from "./ui";

export function ProtectedRoute() {
  const token = useAuthStore((s) => s.token);
  const ready = useAuthStore((s) => s.ready);
  // Wait for the initial session (and any in-flight OAuth exchange) to resolve
  // before deciding — redirecting too early drops OAuth params and loops back.
  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center">
        <Spinner className="h-6 w-6 text-brand-400" />
      </div>
    );
  }
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
