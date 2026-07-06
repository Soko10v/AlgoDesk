import * as React from "react";
import { PageHeader, Button, Badge } from "algodesk-frontend";
import { Plus } from "lucide-react";

export const Basic = () => (
  <PageHeader title="Strategies" description="Design, backtest, and deploy trading algorithms." />
);

export const WithActions = () => (
  <PageHeader
    title="Momentum v2"
    description="Live on Binance · BTC/USDT · 4h"
    actions={
      <>
        <Badge tone="success">Live</Badge>
        <Button variant="ghost" size="sm">Pause</Button>
        <Button variant="primary" size="sm">
          <Plus className="h-4 w-4" /> New version
        </Button>
      </>
    }
  />
);
