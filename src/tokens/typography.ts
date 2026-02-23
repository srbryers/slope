// SLOPE Design Tokens — Typography
// Font stacks, size scale, and weight scale.

// --- Font Stacks ---

export const fontFamily = {
  heading: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
  body: "'Inter', system-ui, -apple-system, sans-serif",
  mono: "'Geist Mono', ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
  /** System font stack used in HTML reports (no external font dependency) */
  system: "system-ui, -apple-system, sans-serif",
} as const;

// --- Size Scale (px) ---

export const fontSize = {
  xs: '11px',
  sm: '12px',
  base: '13px',
  md: '15px',
  lg: '18px',
  xl: '24px',
  '2xl': '28px',
} as const;

// --- Weight Scale ---

export const fontWeight = {
  normal: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

// --- Letter Spacing ---

export const letterSpacing = {
  tight: '-0.01em',
  normal: '0',
  wide: '0.05em',
} as const;
