import * as React from "react";
import { Spinner } from "algodesk-frontend";

export const Sizes = () => (
  <div className="flex items-center gap-4 text-brand-400">
    <Spinner className="h-4 w-4" />
    <Spinner className="h-6 w-6" />
    <Spinner className="h-8 w-8" />
  </div>
);
