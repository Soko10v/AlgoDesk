import * as React from "react";
import { Select } from "algodesk-frontend";

export const Basic = () => (
  <div className="w-72">
    <Select defaultValue="4h">
      <option value="1m">1 minute</option>
      <option value="15m">15 minutes</option>
      <option value="1h">1 hour</option>
      <option value="4h">4 hours</option>
      <option value="1d">1 day</option>
    </Select>
  </div>
);

export const Disabled = () => (
  <div className="w-72">
    <Select defaultValue="binance" disabled>
      <option value="binance">Binance</option>
    </Select>
  </div>
);
