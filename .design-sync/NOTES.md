# design-sync notes — AlgoDesk UI kit

## Shape & source
- **Package shape, synth-entry mode.** AlgoDesk is a Vite app, not a published component library — there is no `dist/` and no shipped `.d.ts`. The 13 primitives live in a single file: `frontend/src/components/ui.tsx`.
- The converter is pointed at that file directly via `--entry ./frontend/src/components/ui.tsx`. `pkg` is `algodesk-frontend` (matches `frontend/package.json`, so `PKG_DIR` resolves to `frontend/`). `--node-modules frontend/node_modules`.
- Only the reusable primitives are synced. App-shell components (`Layout`, `ProtectedRoute`, `Toaster`, `EventToasts`) are deliberately **not** included — they're not design-system parts. Scope is pinned explicitly by `componentSrcMap` (all 13 → `src/components/ui.tsx`).

## CSS generation (must run before the converter)
- The DS styling is Tailwind (utilities + `@layer components` classes `.card/.btn/.input/.badge` + a `brand`/`ink` token palette in `frontend/tailwind.config.js`). There is no precompiled stylesheet, so one is generated: `cfg.buildCmd` runs the Tailwind CLI against `.design-sync/tailwind.gen.mjs` → `frontend/ds-styles.generated.css`, which `cfg.cssEntry` points at.
- `tailwind.gen.mjs` re-exports the frontend theme but widens `content` to also scan `.design-sync/previews/**` and `.design-sync/ds-preview-surface.tsx`, so preview-only utility classes (and `bg-ink-950` on the surface wrapper) aren't purged.
- **Re-sync order:** run `cfg.buildCmd` FIRST (regenerates the CSS — it's gitignored), then `package-build.mjs`. The generated CSS must exist under `frontend/` because `cssEntry` is bounded to `PKG_DIR`.

## Dark-surface requirement (important)
- These components are built for the app's **dark background** (light text on `bg-ink-950`). The preview harness hard-codes a white page background, so without intervention every text-heavy card (Card, PageHeader, StatCard, EmptyState) renders with invisible text.
- Fix: a preview-only wrapper `DsSurface` (`.design-sync/ds-preview-surface.tsx`) paints the branded dark surface behind every card. It's wired via `cfg.extraEntries` (merged onto `window.AlgoDesk`) + `cfg.provider: {component: "DsSurface"}`. It is NOT a shipped DS component — it only wraps preview renders. It does show up in `Object.keys(window.AlgoDesk)` (15 exports = 13 components + `DsSurface` + the `__dsMainNs` marker); that's expected.

## Prop contracts
- Synth-entry mode can't extract props (no shipped `.d.ts`; prop types are local/inline in `ui.tsx`), so every component gets precise `<Name>Props` bodies hand-written in `cfg.dtsPropsFor`, transcribed from `ui.tsx`. If `ui.tsx` prop signatures change, update `dtsPropsFor` to match.

## Known render warns (triaged benign)
- `[FONT_REMOTE]` "Inter", "JetBrains Mono" — the DS loads fonts via a Google Fonts `@import` at the top of `index.css`; they load at runtime, nothing to ship.
- `[RENDER_THIN]` on **Spinner** appeared before the dark surface was wired (a text-less SVG on white). With `DsSurface` it no longer fires. If it reappears, it's benign — Spinner is an animated SVG with no text.
- `InfoTip` renders its trigger glyph only; the tooltip opens on click (internal state) and cannot render statically. This is the correct in-context representation, not a defect.
- tokens: 1 CSS custom property referenced but not defined (below threshold) — non-blocking.

## Re-sync risks / watch-list
- **Generated CSS is gitignored** (`frontend/ds-styles.generated.css`) — a re-sync that skips `cfg.buildCmd` will fail `[CSS_IMPORT_MISSING]` on a fresh clone. Always run `buildCmd` first.
- **`cfg.dtsPropsFor` can silently drift** from `ui.tsx`. If someone adds/renames a prop in `ui.tsx`, the emitted contract won't reflect it until `dtsPropsFor` is updated by hand.
- **Preview content is realistic trading-domain copy** authored by hand (strategy names, BTC/USDT, Sharpe, etc.). It references no real repo data, so it won't rot, but it's not sourced from the app.
- **No Storybook / no reference render** — grading is absolute (the rubric), not diff-based against a source render.
- Playwright/chromium were installed fresh into `.ds-sync/node_modules` for the render check.
