import * as React from "react";
import { Card, Badge, Button } from "algodesk-frontend";

export const Basic = () => (
  <Card className="p-5">
    <div className="flex items-center justify-between">
      <h3 className="text-base font-semibold text-slate-100">Momentum v2</h3>
      <Badge tone="success">Live</Badge>
    </div>
    <p className="mt-2 text-sm text-slate-400">
      Trades BTC/USDT on a 4h timeframe using an EMA crossover with an ATR trailing stop.
    </p>
    <div className="mt-4 flex gap-2">
      <Button size="sm" variant="ghost">Edit</Button>
      <Button size="sm" variant="secondary">Deploy</Button>
    </div>
  </Card>
);
