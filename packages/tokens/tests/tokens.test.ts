import { describe, it, expect } from 'vitest';
import {
  brand,
  background,
  text,
  border,
  status,
  chart,
  semantic,
  fontFamily,
  fontSize,
  fontWeight,
  letterSpacing,
  spacing,
  radius,
  layout,
  generateCssVariables,
} from '../src/index.js';

describe('colors', () => {
  it('exports brand palette', () => {
    expect(brand.forest).toBe('#1B5E3B');
    expect(brand.emerald).toBe('#4AE68A');
    expect(brand.gold).toBe('#D4A843');
  });

  it('exports background scale', () => {
    expect(background.page).toBe('#f8fafc');
    expect(background.surface).toBe('#ffffff');
    expect(background.muted).toBe('#f1f5f9');
  });

  it('exports text scale', () => {
    expect(text.primary).toBe('#1e293b');
    expect(text.secondary).toBe('#475569');
    expect(text.muted).toBe('#64748b');
    expect(text.faint).toBe('#94a3b8');
  });

  it('exports border scale', () => {
    expect(border.default).toBe('#e2e8f0');
    expect(border.subtle).toBe('#f1f5f9');
    expect(border.accent).toBe('#3b82f6');
  });

  it('exports status colors', () => {
    expect(status.green).toBe('#22c55e');
    expect(status.red).toBe('#ef4444');
    expect(status.amber).toBe('#f59e0b');
    expect(status.blue).toBe('#3b82f6');
  });

  it('exports chart colors', () => {
    expect(chart.parBar).toBe('#cbd5e1');
    expect(chart.underPar).toBe('#22c55e');
    expect(chart.atPar).toBe('#3b82f6');
    expect(chart.overPar).toBe('#ef4444');
  });

  it('exports semantic aliases matching status values', () => {
    expect(semantic.over).toBe(status.red);
    expect(semantic.under).toBe(status.green);
    expect(semantic.even).toBe(text.muted);
  });
});

describe('typography', () => {
  it('exports font families', () => {
    expect(fontFamily.heading).toContain('Plus Jakarta Sans');
    expect(fontFamily.body).toContain('Inter');
    expect(fontFamily.mono).toContain('Geist Mono');
    expect(fontFamily.system).toContain('system-ui');
  });

  it('exports font size scale', () => {
    expect(fontSize.xs).toBe('11px');
    expect(fontSize.sm).toBe('12px');
    expect(fontSize.base).toBe('13px');
    expect(fontSize.xl).toBe('24px');
  });

  it('exports font weights', () => {
    expect(fontWeight.normal).toBe('400');
    expect(fontWeight.bold).toBe('700');
  });
});

describe('spacing', () => {
  it('exports spacing scale', () => {
    expect(spacing['0']).toBe('0px');
    expect(spacing['5']).toBe('16px');
    expect(spacing['7']).toBe('24px');
  });

  it('exports radius scale', () => {
    expect(radius.sm).toBe('4px');
    expect(radius.md).toBe('8px');
  });

  it('exports layout values', () => {
    expect(layout.maxWidth).toBe('960px');
  });
});

describe('generateCssVariables', () => {
  it('returns a :root block', () => {
    const css = generateCssVariables();
    expect(css).toMatch(/^:root \{/);
    expect(css).toMatch(/\}$/);
  });

  it('includes brand tokens', () => {
    const css = generateCssVariables();
    expect(css).toContain('--slope-brand-forest: #1B5E3B');
    expect(css).toContain('--slope-brand-emerald: #4AE68A');
    expect(css).toContain('--slope-brand-gold: #D4A843');
  });

  it('includes background tokens', () => {
    const css = generateCssVariables();
    expect(css).toContain('--slope-bg-page: #f8fafc');
    expect(css).toContain('--slope-bg-surface: #ffffff');
  });

  it('includes text tokens', () => {
    const css = generateCssVariables();
    expect(css).toContain('--slope-text-primary: #1e293b');
    expect(css).toContain('--slope-text-muted: #64748b');
  });

  it('includes font tokens', () => {
    const css = generateCssVariables();
    expect(css).toContain('--slope-font-heading:');
    expect(css).toContain('--slope-text-size-base: 13px');
    expect(css).toContain('--slope-font-weight-bold: 700');
  });

  it('includes spacing tokens', () => {
    const css = generateCssVariables();
    expect(css).toContain('--slope-space-5: 16px');
    expect(css).toContain('--slope-radius-md: 8px');
    expect(css).toContain('--slope-layout-maxWidth: 960px');
  });

  it('includes status tokens', () => {
    const css = generateCssVariables();
    expect(css).toContain('--slope-status-green: #22c55e');
    expect(css).toContain('--slope-status-red: #ef4444');
  });
});
