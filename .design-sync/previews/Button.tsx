import * as React from "react";
import { Button } from "algodesk-frontend";
import { Play, Trash2 } from "lucide-react";

export const Variants = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary">Run backtest</Button>
    <Button variant="secondary">Deploy</Button>
    <Button variant="ghost">Cancel</Button>
    <Button variant="danger">Delete</Button>
  </div>
);

export const Sizes = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
  </div>
);

export const WithIcon = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary">
      <Play className="h-4 w-4" /> Start live
    </Button>
    <Button variant="danger">
      <Trash2 className="h-4 w-4" /> Remove
    </Button>
  </div>
);

export const States = () => (
  <div className="flex flex-wrap items-center gap-3">
    <Button variant="primary" loading>
      Saving
    </Button>
    <Button variant="primary" disabled>
      Disabled
    </Button>
  </div>
);
