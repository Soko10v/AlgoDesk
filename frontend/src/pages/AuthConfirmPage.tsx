import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, MailWarning } from "lucide-react";
import { type EmailOtpType } from "@supabase/supabase-js";
import { supabase } from "../lib/supabase";
import { useAuthStore } from "../store/auth";
import { toast } from "../store/toast";
import { Button, Card, Spinner } from "../components/ui";

const allowedTypes = new Set<EmailOtpType>(["signup", "magiclink", "recovery", "email_change"]);

function otpTypeFromUrl(value: string | null): EmailOtpType {
  return allowedTypes.has(value as EmailOtpType) ? (value as EmailOtpType) : "signup";
}

export function AuthConfirmPage() {
  const navigate = useNavigate();
  const setToken = useAuthStore((s) => s.setToken);
  const setReady = useAuthStore((s) => s.setReady);
  const attempted = useRef(false);
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("Confirming your email...");

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const type = otpTypeFromUrl(params.get("type"));
    const next = params.get("next") || "/dashboard";

    if (!tokenHash) {
      setReady(true);
      setStatus("error");
      setMessage("This confirmation link is missing a token. Please request a new email.");
      return;
    }

    supabase.auth
      .verifyOtp({ token_hash: tokenHash, type })
      .then(({ data, error }) => {
        if (error || !data.session?.access_token) {
          setReady(true);
          setStatus("error");
          setMessage(error?.message ?? "Could not create a session. Please request a new email.");
          return;
        }

        setToken(data.session.access_token);
        setReady(true);
        setStatus("success");
        setMessage("Email confirmed. Redirecting...");
        toast.success("Email confirmed", "You are signed in.");
        navigate(next.startsWith("/") ? next : "/dashboard", { replace: true });
      })
      .catch(() => {
        setReady(true);
        setStatus("error");
        setMessage("Unexpected error during email confirmation. Please request a new email.");
      });
  }, [navigate, setReady, setToken]);

  return (
    <div className="grid min-h-screen place-items-center p-6">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-brand-500/15 text-brand-300">
          {status === "loading" ? (
            <Spinner className="h-6 w-6" />
          ) : status === "success" ? (
            <CheckCircle2 className="h-6 w-6" />
          ) : (
            <MailWarning className="h-6 w-6" />
          )}
        </div>
        <h1 className="mt-4 text-xl font-bold text-white">
          {status === "error" ? "Email link could not be confirmed" : "Confirming email"}
        </h1>
        <p className="mt-2 text-sm text-slate-400">{message}</p>
        {status === "error" && (
          <Button type="button" className="mt-6 w-full" onClick={() => navigate("/login", { replace: true })}>
            Back to sign in
          </Button>
        )}
      </Card>
    </div>
  );
}
