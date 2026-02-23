// SLOPE Design Tokens — CSS Variable Generator
// Produces a :root {} block with all tokens as CSS custom properties.

import { brand, background, text, border, status, chart, semantic } from './colors.js';
import { fontFamily, fontSize, fontWeight, letterSpacing } from './typography.js';
import { spacing, radius, layout } from './spacing.js';

function flatten(
  obj: Record<string, string>,
  prefix: string,
): string[] {
  return Object.entries(obj).map(
    ([key, value]) => `  --slope-${prefix}-${key}: ${value};`,
  );
}

/** Generate a `:root {}` block with all SLOPE tokens as CSS custom properties. */
export function generateCssVariables(): string {
  const lines = [
    ':root {',
    '  /* Brand */',
    ...flatten(brand, 'brand'),
    '',
    '  /* Background */',
    ...flatten(background, 'bg'),
    '',
    '  /* Text */',
    ...flatten(text, 'text'),
    '',
    '  /* Border */',
    ...flatten(border, 'border'),
    '',
    '  /* Status */',
    ...flatten(status, 'status'),
    '',
    '  /* Chart */',
    ...flatten(chart, 'chart'),
    '',
    '  /* Semantic */',
    ...flatten(semantic, 'semantic'),
    '',
    '  /* Font Family */',
    ...flatten(fontFamily, 'font'),
    '',
    '  /* Font Size */',
    ...flatten(fontSize, 'text-size'),
    '',
    '  /* Font Weight */',
    ...flatten(fontWeight, 'font-weight'),
    '',
    '  /* Letter Spacing */',
    ...flatten(letterSpacing, 'tracking'),
    '',
    '  /* Spacing */',
    ...flatten(spacing, 'space'),
    '',
    '  /* Radius */',
    ...flatten(radius, 'radius'),
    '',
    '  /* Layout */',
    ...flatten(layout, 'layout'),
    '}',
  ];

  return lines.join('\n');
}
