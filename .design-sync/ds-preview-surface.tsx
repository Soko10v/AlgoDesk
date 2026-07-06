import * as React from "react";

// Preview-only wrapper. AlgoDesk's components are built for the app's dark
// surface (they use light text on `bg-ink-950`), but the preview harness forces
// a white page background — so without this the light text renders invisibly.
// This paints the branded dark surface behind each card so previews match how
// the app actually presents these components. It is NOT part of the shipped DS
// component set; it only wraps the preview renders (via cfg.provider).
export function DsSurface({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl bg-ink-950 p-6 text-slate-200"
      style={{
        backgroundImage:
          "radial-gradient(60% 60% at 50% -10%, rgba(16,185,129,0.10), transparent 70%)",
      }}
    >
      {children}
    </div>
  );
}
