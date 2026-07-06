# AlgoDesk UI kit — how to build with it

AlgoDesk is a **dark-first** trading/algo dashboard design system. Every component is
built for a dark app surface and styled with **Tailwind utility classes** plus a small
set of brand tokens. Import components from `window.AlgoDesk` (the bundle is loaded from
the root `_ds_bundle.js`).

## Wrapping & setup — put content on the dark surface

The components use **light text on a dark background** (e.g. `text-slate-100`, `text-white`).
On a light background their text is invisible. Render your screens on the app's dark
surface — set the page/root background to `bg-ink-950` (near-black) and default text to
`text-slate-200`:

```jsx
<div className="min-h-screen bg-ink-950 text-slate-200 p-6">
  {/* your screen */}
</div>
```

There is **no theme provider or context** to wrap — components are self-contained. The
only "setup" is putting them on a dark surface.

## Styling idiom — Tailwind utilities + brand tokens

Style layout and spacing with standard Tailwind utilities (`flex`, `grid`, `gap-*`,
`p-*`, `rounded-xl`, etc.). Use the DS's brand token scales for color so everything stays
on-palette:

| Token family | Use for | Example classes |
|---|---|---|
| `brand-*` (50–900) | primary accent — emerald green | `bg-brand-500`, `text-brand-400`, `border-brand-500/60` |
| `ink-*` (950, 900, 850, 800) | surfaces / backgrounds, darkest → dark | `bg-ink-950` (page), `bg-ink-900` (panels/inputs) |
| `slate-*` (Tailwind default) | text, borders, muted copy | `text-slate-100`, `text-slate-400`, `text-slate-500` |
| semantic (Tailwind default) | status colors | `rose-*` (danger), `amber-*` (warning), `sky-*` (info), `indigo-*` (secondary/violet) |

The DS also defines these reusable component classes (in the shipped stylesheet) — you can
apply them directly to your own markup for consistency:

- `.card` — the standard translucent panel (rounded-2xl, subtle border + shadow, backdrop blur)
- `.btn` + `.btn-primary` / `.btn-secondary` / `.btn-ghost` / `.btn-danger` — button styles
- `.input` — form field styling (used by `Input`, `Select`, `NumberField`)
- `.badge` — pill styling
- `.label` — uppercase field label

Prefer the exported components below over raw markup; reach for `.card`/`.btn` only for
composition the components don't cover.

## Components (all from `window.AlgoDesk`)

- **Actions:** `Button` (`variant`: primary/secondary/ghost/danger, `size`: sm/md, `loading`), `Toggle` (`checked`/`onChange`)
- **Forms:** `Input`, `Select`, `NumberField` (`value`/`onValueChange`, clamps min/max), `Field` (label + optional `hint`), `InfoTip` (click-to-reveal help glyph)
- **Feedback / data:** `Badge` (`tone`: neutral/success/danger/warning/info/violet), `StatCard` (`icon`/`label`/`value`/`sub`), `Spinner`, `Card`, `EmptyState`, `PageHeader`
- Icons in the examples come from `lucide-react` (the DS's icon library).

## Where the truth lives

- Component styling and tokens: read the bound `styles.css` and its `@import` closure (the
  brand/ink palette and `.card`/`.btn`/`.input` classes are defined there).
- Per-component API + usage: each component's `<Name>.d.ts` (props) and `<Name>.prompt.md`.

## Idiomatic snippet

```jsx
const { PageHeader, StatCard, Card, Badge, Button } = window.AlgoDesk;

<div className="min-h-screen bg-ink-950 text-slate-200 p-6">
  <PageHeader
    title="Momentum v2"
    description="Live on Binance · BTC/USDT · 4h"
    actions={<Badge tone="success">Live</Badge>}
  />
  <div className="grid grid-cols-3 gap-4">
    <StatCard label="Total return" value="+24.8%" sub="Since inception" />
    <StatCard label="Sharpe" value="1.84" sub="Rolling 30d" />
    <StatCard label="Open trades" value="7" sub="3 long / 4 short" />
  </div>
  <Card className="mt-4 p-5">
    <div className="flex items-center justify-between">
      <h3 className="text-base font-semibold text-slate-100">EMA crossover</h3>
      <Button size="sm" variant="secondary">Deploy</Button>
    </div>
  </Card>
</div>
```
