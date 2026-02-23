// SLOPE Design Tokens — Spacing & Radii
// Spacing scale and border-radius values matching report layout.

// --- Spacing Scale (px) ---

export const spacing = {
  '0': '0px',
  '1': '2px',
  '2': '4px',
  '3': '8px',
  '4': '12px',
  '5': '16px',
  '6': '20px',
  '7': '24px',
  '8': '32px',
  '9': '40px',
} as const;

// --- Border Radius ---

export const radius = {
  none: '0px',
  sm: '4px',
  md: '8px',
} as const;

// --- Layout ---

export const layout = {
  maxWidth: '960px',
  cardMinWidth: '180px',
  cardGap: '16px',
} as const;
