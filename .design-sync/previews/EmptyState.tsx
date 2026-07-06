import * as React from "react";
import { EmptyState, Button } from "algodesk-frontend";
import { LineChart } from "lucide-react";

export const Basic = () => (
  <div className="w-[28rem]">
    <EmptyState
      icon={LineChart}
      title="No strategies yet"
      description="Build your first algorithmic strategy to start backtesting against historical data."
      action={<Button variant="primary">Create strategy</Button>}
    />
  </div>
);
