import * as React from "react";
import { InfoTip } from "algodesk-frontend";

// InfoTip's tooltip opens on click (internal state), so a static card shows the
// trigger glyph beside the label it annotates — its real in-context usage.
export const InContext = () => (
  <div className="flex items-center gap-1.5 text-sm font-medium text-slate-300">
    <span>Sharpe ratio</span>
    <InfoTip text="Risk-adjusted return: mean excess return divided by its standard deviation." />
  </div>
);
