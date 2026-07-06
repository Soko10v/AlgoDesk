import * as React from "react";
import { StatCard } from "algodesk-frontend";
import { TrendingUp, Activity, Wallet } from "lucide-react";

export const Basic = () => (
  <StatCard icon={TrendingUp} label="Total return" value="+24.8%" sub="Since inception" />
);

export const Negative = () => (
  <StatCard
    icon={Activity}
    label="Max drawdown"
    value="-12.3%"
    sub="Last 90 days"
    valueClassName="text-rose-400"
  />
);

export const Grid = () => (
  <div className="grid grid-cols-3 gap-4">
    <StatCard icon={Wallet} label="Equity" value="$48,210" sub="+$1,204 today" />
    <StatCard icon={TrendingUp} label="Sharpe" value="1.84" sub="Rolling 30d" />
    <StatCard icon={Activity} label="Open trades" value="7" sub="3 long / 4 short" />
  </div>
);
