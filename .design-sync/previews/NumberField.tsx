import * as React from "react";
import { NumberField, Field } from "algodesk-frontend";

export const Interactive = () => {
  const [risk, setRisk] = React.useState(1.5);
  return (
    <div className="w-72">
      <Field label="Risk per trade (%)">
        <NumberField value={risk} onValueChange={setRisk} min={0} max={100} />
      </Field>
    </div>
  );
};

export const Leverage = () => {
  const [lev, setLev] = React.useState(3);
  return (
    <div className="w-72">
      <Field label="Leverage" hint="Clamped between 1x and 20x.">
        <NumberField value={lev} onValueChange={setLev} min={1} max={20} />
      </Field>
    </div>
  );
};
