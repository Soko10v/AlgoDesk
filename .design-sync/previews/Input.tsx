import * as React from "react";
import { Input } from "algodesk-frontend";

export const Default = () => (
  <div className="w-72">
    <Input placeholder="Strategy name" />
  </div>
);

export const WithValue = () => (
  <div className="w-72">
    <Input defaultValue="BTC/USDT" />
  </div>
);

export const Disabled = () => (
  <div className="w-72">
    <Input defaultValue="Read only" disabled />
  </div>
);
