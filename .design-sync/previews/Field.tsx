import * as React from "react";
import { Field, Input, Select } from "algodesk-frontend";

export const WithInput = () => (
  <div className="w-72">
    <Field label="Strategy name">
      <Input placeholder="e.g. Momentum v2" />
    </Field>
  </div>
);

export const WithHint = () => (
  <div className="w-72">
    <Field label="Timeframe" hint="Candle interval the strategy evaluates on.">
      <Select defaultValue="4h">
        <option value="1h">1 hour</option>
        <option value="4h">4 hours</option>
        <option value="1d">1 day</option>
      </Select>
    </Field>
  </div>
);
