import * as React from "react";
import { Badge } from "algodesk-frontend";

export const Tones = () => (
  <div className="flex flex-wrap items-center gap-2">
    <Badge tone="neutral">Draft</Badge>
    <Badge tone="success">Live</Badge>
    <Badge tone="danger">Error</Badge>
    <Badge tone="warning">Paused</Badge>
    <Badge tone="info">Backtesting</Badge>
    <Badge tone="violet">Paper</Badge>
  </div>
);
