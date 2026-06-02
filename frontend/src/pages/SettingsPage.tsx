import { type FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Link2, Link2Off, Lock, Plug, ShieldCheck } from "lucide-react";
import { connectExchange, disconnectExchange, exchangeStatus, testExchange } from "../api/endpoints";
import { toast } from "../store/toast";
import { Badge, Button, Card, Field, Input, PageHeader } from "../components/ui";

export function SettingsPage() {
  const qc = useQueryClient();
  const status = useQuery({ queryKey: ["exchange-status"], queryFn: exchangeStatus });
  const connected = status.data?.connected ?? false;

  const [apiKey, setApiKey] = useState("");
  const [apiSecret, setApiSecret] = useState("");

  const connect = useMutation({
    mutationFn: () => connectExchange(apiKey, apiSecret),
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
      d.ok ? toast.success("Connection OK", "Bybit accepted your keys.") : toast.error("Connection failed", "Check key permissions."),
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
      <PageHeader title="Exchange" description="Connect your Bybit account to enable live trading." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="animate-slide-up p-6 lg:col-span-2">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-xl bg-white/[0.05] text-slate-300">
                <Plug className="h-4.5 w-4.5" />
              </div>
              <div className="font-semibold text-slate-100">Bybit API</div>
            </div>
            {connected ? <Badge tone="success">Connected</Badge> : <Badge tone="warning">Not connected</Badge>}
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="API key" hint="Create a key with trade permissions in Bybit → API Management.">
              <div className="relative">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                <Input
                  className="pl-9"
                  placeholder="Bybit API key"
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
                  placeholder="Bybit API secret"
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
  );
}
