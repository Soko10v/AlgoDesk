import * as React from "react";
import { Toggle } from "algodesk-frontend";

export const Interactive = () => {
  const [on, setOn] = React.useState(true);
  return <Toggle checked={on} onChange={setOn} label="Auto-rebalance" />;
};

export const On = () => <Toggle checked={true} onChange={() => {}} label="Enabled" />;

export const Off = () => <Toggle checked={false} onChange={() => {}} label="Disabled" />;
