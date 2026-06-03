import { type FormEvent, useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, KeyRound, Link2, Link2Off, ListOrdered, Lock, Plug, ShieldCheck } from "lucide-react";
import {
  connectExchange,
  disconnectExchange,
  exchangeStatus,
  type ExchangeId,
  testExchange,
} from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, Field, Input, PageHeader } from "../components/ui";
import { cn } from "../lib/cn";

type ExchangeMeta = {
  id: ExchangeId;
  name: string;
  apiUrl: string;
  steps: string[];
};

const EXCHANGES: ExchangeMeta[] = [
  {
    id: "bybit",
    name: "Bybit",
    apiUrl: "https://www.bybit.com/app/user/api-management",
    steps: [
      "Sign in to Bybit, then open the profile menu → API.",
      "Click “Create New Key” and choose “System-generated API Keys”.",
      "Set the key to Read-Write and enable Unified Trading → Trade (Orders & Positions).",
      "Leave the Withdraw permission disabled — AlgoDesk never needs it.",
      "Optionally restrict the key to your server IP for extra safety.",
      "Copy the API Key and Secret and paste them here (the secret is shown only once).",
    ],
  },
  {
    id: "binance",
    name: "Binance",
    apiUrl: "https://www.binance.com/en/my/settings/api-management",
    steps: [
      "Sign in to Binance, then open Account → API Management.",
      "Click “Create API”, choose “System generated”, label it (e.g. AlgoDesk) and pass 2FA.",
      "Enable “Reading” and “Enable Spot & Margin Trading”.",
      "Keep “Enable Withdrawals” OFF — it isn't required.",
      "Optionally restrict access to trusted IPs for extra safety.",
      "Copy the API Key and Secret Key and paste them here (the secret is shown only once).",
    ],
  },
];

export function SettingsPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["exchange-status"], queryFn: exchangeStatus });
  const connected = status.data?.connected ?? false;

  const [exchange, setExchange] = useState<ExchangeId>("bybit");
  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  // Pre-select whichever exchange the user is already connected to.
  useEffect(() => {
    if (status.data?.connected) setExchange(status.data.exchange);
  }, [status.data?.connected, status.data?.exchange]);

  const meta = EXCHANGES.find((e) => e.id === exchange) ?? EXCHANGES[0];

  const connect = useMutation({
    mutationFn: () => connectExchange(exchange, apiKey, apiSecret),
    onSuccess: () => {
      toast.success("Exchange connected", "API keys encrypted and stored.");
      setApiKey("");
      setApiSecret("");
      qc.invalidateQueries({ queryKey: ["exchange-status"] });
    },
    onError: () => toast.error("Could not save keys"),
  });

  const test = useMutation({
    mutationFn: testExchange,
    onSuccess: (d) =>
      d.ok
        ? toast.success("Connection OK", `${meta.name} accepted your keys.`)
        : toast.error("Connection failed", "Check key permissions."),
    onError: () => toast.error("Test failed", "Keys are missing or invalid."),
  });

  const disconnect = useMutation({
    mutationFn: disconnectExchange,
    onSuccess: () => {
      toast.info("Exchange disconnected");
      qc.invalidateQueries({ queryKey: ["exchange-status"] });
    },
    onError: () => toast.error("Failed to disconnect"),
  });

  const canSubmit = apiKey.trim().length >= 3 && apiSecret.trim().length >= 3;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (canSubmit) connect.mutate();
  }

  return (
    <div className="animate-fade-in">
      <PageHeader title="Exchange" description="Connect your Bybit or Binance account to enable live trading." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="animate-slide-up p-6 lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-slate-300">
                <Plug className="h-4.5 w-4.5" />
              </div>
              <div className="font-semibold text-slate-100">{meta.name} API</div>
            </div>
            {connected ? (
              <Badge tone="success">Connected · {status.data?.exchange}</Badge>
            ) : (
              <Badge tone="warning">Not connected</Badge>
            )}
          </div>

          <Field label="Exchange" hint="Pick the exchange these API keys belong to.">
            <div className="grid grid-cols-2 gap-2">
              {EXCHANGES.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setExchange(e.id)}
                  className={cn(
                    "rounded-xl border px-4 py-2.5 text-sm font-medium transition",
                    exchange === e.id
                      ? "border-brand-500/40 bg-brand-500/10 text-brand-200"
                      : "border-white/10 bg-white/[0.02] text-slate-400 hover:border-white/20 hover:text-slate-200"
                  )}
                >
                  {e.name}
                </button>
              ))}
            </div>
          </Field>

          <form onSubmit={submit} className="mt-4 space-y-4">
            <Field label="API key" hint={`Create a key with trade permissions in ${meta.name} → API Management.`}>
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  className="pl-9"
                  placeholder={`${meta.name} API key`}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </Field>
            <Field label="API secret">
              <div className="relative">
                <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  className="pl-9"
                  type="password"
                  placeholder={`${meta.name} API secret`}
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  autoComplete="off"
                />
              </div>
            </Field>

            <div className="flex flex-wrap gap-2 pt-1">
              <Button type="submit" loading={connect.isPending} disabled={!canSubmit}>
                <Link2 className="h-4 w-4" /> Save keys
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => test.mutate()}
                loading={test.isPending}
                disabled={!connected}
              >
                <ShieldCheck className="h-4 w-4" /> Test connection
              </Button>
              <Button
                type="button"
                variant="danger"
                onClick={() => disconnect.mutate()}
                loading={disconnect.isPending}
                disabled={!connected}
              >
                <Link2Off className="h-4 w-4" /> Disconnect
              </Button>
            </div>
          </form>
        </Card>

        <div className="space-y-6">
          <Card className="animate-slide-up p-6">
            <div className="flex items-center gap-2 text-brand-300">
              <ListOrdered className="h-5 w-5" />
              <span className="font-semibold">How to get your {meta.name} keys</span>
            </div>
            <ol className="mt-4 space-y-3 text-sm text-slate-400">
              {meta.steps.map((step, i) => (
                <li key={i} className="flex gap-2.5">
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-500/15 text-xs font-semibold text-brand-300">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
            <a
              href={meta.apiUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-300 hover:text-brand-200"
            >
              Open {meta.name} API Management <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Card>

          <Card className="animate-slide-up p-6">
            <div className="flex items-center gap-2 text-brand-300">
              <ShieldCheck className="h-5 w-5" />
              <span className="font-semibold">Your keys are safe</span>
            </div>
            <ul className="mt-4 space-y-3 text-sm text-slate-400">
              <li className="flex gap-2.5">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                Encrypted with Fernet before they ever touch the database.
              </li>
              <li className="flex gap-2.5">
                <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                The secret is never returned to the browser after saving.
              </li>
              <li className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                Use a key restricted to trading — no withdrawal permission needed.
              </li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
