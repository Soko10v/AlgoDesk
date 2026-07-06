// Tailwind config for design-sync CSS generation.
// Extends the frontend's own theme/tokens, but widens `content` so that the
// utility classes used inside the authored preview cards (.design-sync/previews)
// are also emitted — the app's own src scan alone would purge preview-only glue.
import base from '../frontend/tailwind.config.js';

export default {
  ...base,
  content: [
    './frontend/index.html',
    './frontend/src/**/*.{ts,tsx}',
    './.design-sync/previews/**/*.tsx',
    './.design-sync/ds-preview-surface.tsx',
  ],
};
