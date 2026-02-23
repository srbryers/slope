// SLOPE Design Tokens — Colors
// Brand palette, background/text/border scales, and status colors.

// --- Brand ---

export const brand = {
  forest: '#1B5E3B',
  emerald: '#4AE68A',
  gold: '#D4A843',
} as const;

// --- Background Scale (light theme) ---

export const background = {
  page: '#f8fafc',
  surface: '#ffffff',
  muted: '#f1f5f9',
} as const;

// --- Text Scale ---

export const text = {
  primary: '#1e293b',
  secondary: '#475569',
  tertiary: '#334155',
  muted: '#64748b',
  faint: '#94a3b8',
} as const;

// --- Border Scale ---

export const border = {
  default: '#e2e8f0',
  subtle: '#f1f5f9',
  accent: '#3b82f6',
  warning: '#fde68a',
} as const;

// --- Status Colors ---

export const status = {
  green: '#22c55e',
  red: '#ef4444',
  amber: '#f59e0b',
  blue: '#3b82f6',
  purple: '#8b5cf6',
  orange: '#f97316',
} as const;

// --- Chart Colors ---

export const chart = {
  parBar: '#cbd5e1',
  underPar: '#22c55e',
  atPar: '#3b82f6',
  overPar: '#ef4444',
  heatmapBase: '#f8fafc',
  heatmapHot: '#ef4444',
} as const;

// --- Semantic Aliases (report classes) ---

export const semantic = {
  over: status.red,
  under: status.green,
  even: text.muted,
  warn: status.red,
  hazardHeading: '#92400e',
} as const;
