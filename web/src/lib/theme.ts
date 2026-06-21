// Theme engine — Material You dynamic color generation + Vercel hybrid mapping.
//
// Uses @material/material-color-utilities to generate a full M3 tonal palette
// from a single accent (seed) color, then maps those tokens onto the app's
// existing CSS custom-property system so every component adapts automatically.
//
// Design philosophy:
//   Vercel mode  → Neutral zinc/gray surfaces, accent only on interactive elements
//   Material mode → Full M3 dynamic color: tinted surfaces, tonal containers,
//                   accent-derived backgrounds — the "Material You" experience

import {
  argbFromHex,
  hexFromArgb,
  Hct,
  SchemeTonalSpot,
  SchemeNeutral,
  SchemeVibrant,
  SchemeExpressive,
  SchemeFidelity,
  SchemeContent,
  SchemeMonochrome,
  SchemeRainbow,
  SchemeFruitSalad,
} from '@material/material-color-utilities';

// ── Types ──────────────────────────────────────────────────────────────

export type SchemeVariant =
  | 'tonal_spot'
  | 'neutral'
  | 'vibrant'
  | 'expressive'
  | 'fidelity'
  | 'content'
  | 'monochrome'
  | 'rainbow'
  | 'fruit_salad';

export interface ThemeTokens {
  // Backgrounds / Surfaces
  bgMain: string;
  bgSecondary: string;
  bgTertiary: string;
  bgHover: string;

  // Borders
  borderMain: string;
  borderHover: string;
  borderSubtle: string;

  // Text
  textMain: string;
  textSecondary: string;
  textMuted: string;

  // Assistant bubble
  assistantBubble: string;
  assistantBubbleBorder: string;

  // Primary (buttons, strong actions)
  primary: string;
  primaryForeground: string;
  primaryHover: string;
  primaryLight: string;

  // Accent (interactive highlights)
  accent: string;
  accentMuted: string;

  // Status colors
  success: string;
  warning: string;
  error: string;
  info: string;
}

// ── Scheme factory ─────────────────────────────────────────────────────

function createScheme(
  sourceHct: Hct,
  isDark: boolean,
  variant: SchemeVariant,
  contrast: number = 0,
) {
  switch (variant) {
    case 'tonal_spot':
      return new SchemeTonalSpot(sourceHct, isDark, contrast);
    case 'neutral':
      return new SchemeNeutral(sourceHct, isDark, contrast);
    case 'vibrant':
      return new SchemeVibrant(sourceHct, isDark, contrast);
    case 'expressive':
      return new SchemeExpressive(sourceHct, isDark, contrast);
    case 'fidelity':
      return new SchemeFidelity(sourceHct, isDark, contrast);
    case 'content':
      return new SchemeContent(sourceHct, isDark, contrast);
    case 'monochrome':
      return new SchemeMonochrome(sourceHct, isDark, contrast);
    case 'rainbow':
      return new SchemeRainbow(sourceHct, isDark, contrast);
    case 'fruit_salad':
      return new SchemeFruitSalad(sourceHct, isDark, contrast);
  }
}

const hex = hexFromArgb;

// ── Vercel tokens — neutral zinc surfaces, accent passed through ───────

function vercelTokens(accentHex: string, isDark: boolean): ThemeTokens {
  // Vercel keeps its signature neutral zinc surface system. The accent color
  // is applied directly — no M3 palette derivation needed since only one
  // color role (accent) is used on neutral surfaces.

  if (isDark) {
    return {
      bgMain: '#09090b',
      bgSecondary: '#0c0c0e',
      bgTertiary: '#18181b',
      bgHover: '#222225',
      borderMain: '#27272a',
      borderHover: '#3f3f46',
      borderSubtle: '#1e1e22',
      textMain: '#fafafa',
      textSecondary: '#a1a1aa',
      textMuted: '#71717a',
      assistantBubble: '#18181b',
      assistantBubbleBorder: '#27272a',
      primary: '#fafafa',
      primaryForeground: '#09090b',
      primaryHover: '#d4d4d8',
      primaryLight: '#18181b',
      accent: accentHex,
      accentMuted: accentHex + '18',
      success: '#22c55e',
      warning: '#eab308',
      error: '#ef4444',
      info: '#3b82f6',
    };
  }
  return {
    bgMain: '#ffffff',
    bgSecondary: '#fafafa',
    bgTertiary: '#f5f5f5',
    bgHover: '#ebebeb',
    borderMain: '#e5e5e5',
    borderHover: '#999999',
    borderSubtle: '#f0f0f0',
    textMain: '#171717',
    textSecondary: '#525252',
    textMuted: '#737373',
    assistantBubble: '#f4f4f5',
    assistantBubbleBorder: '#e4e4e7',
    primary: '#171717',
    primaryForeground: '#ffffff',
    primaryHover: '#404040',
    primaryLight: '#f5f5f5',
    accent: accentHex,
    accentMuted: accentHex + '20',
    success: '#22c55e',
    warning: '#eab308',
    error: '#ef4444',
    info: '#3b82f6',
  };
}

// ── Material You tokens — full tonal surface system ────────────────────

function materialTokens(
  accentHex: string,
  isDark: boolean,
  variant: SchemeVariant,
  contrast: number = 0,
): ThemeTokens {
  const argb = argbFromHex(accentHex);
  const sourceHct = Hct.fromInt(argb);
  const scheme = createScheme(sourceHct, isDark, variant, contrast);

  // M3 surface container hierarchy for layered UI
  const surfaceLowest = hex(scheme.surfaceContainerLowest);
  const surfaceLow = hex(scheme.surfaceContainerLow);
  const surfaceContainer = hex(scheme.surfaceContainer);
  const surfaceHigh = hex(scheme.surfaceContainerHigh);
  const surfaceHighest = hex(scheme.surfaceContainerHighest);

  const accentColor = hex(scheme.primary);
  const accentContainerColor = hex(scheme.primaryContainer);
  const onAccentContainer = hex(scheme.onPrimaryContainer);

  return {
    // M3 surface container hierarchy:
    // bgMain = surface (the base canvas)
    // bgSecondary = surfaceContainerLow (sidebar, cards)
    // bgTertiary = surfaceContainer (elevated cards, code blocks)
    // bgHover = surfaceContainerHigh (hover states)
    bgMain: hex(scheme.surface),
    bgSecondary: surfaceLow,
    bgTertiary: surfaceContainer,
    bgHover: surfaceHigh,

    // M3 outline system
    borderMain: hex(scheme.outlineVariant),
    borderHover: hex(scheme.outline),
    borderSubtle: isDark
      ? blendHex(hex(scheme.surface), hex(scheme.outlineVariant), 0.4)
      : blendHex(hex(scheme.surface), hex(scheme.outlineVariant), 0.3),

    // M3 on-surface hierarchy
    textMain: hex(scheme.onSurface),
    textSecondary: hex(scheme.onSurfaceVariant),
    textMuted: hex(scheme.outline),

    // Assistant bubble uses surfaceContainerHigh for subtle elevation
    assistantBubble: surfaceHigh,
    assistantBubbleBorder: hex(scheme.outlineVariant),

    // Primary action — use M3 primary for filled buttons
    primary: hex(scheme.primary),
    primaryForeground: hex(scheme.onPrimary),
    primaryHover: isDark
      ? blendHex(hex(scheme.primary), '#ffffff', 0.12)
      : blendHex(hex(scheme.primary), '#000000', 0.12),
    primaryLight: surfaceContainer,

    // Accent = primary color for interactive highlights
    accent: accentColor,
    accentMuted: accentColor + (isDark ? '18' : '20'),

    // Status colors — blend with scheme's error for consistency
    success: '#22c55e',
    warning: '#eab308',
    error: hex(scheme.error),
    info: accentColor,
  };
}

// ── Hex color blending utility ─────────────────────────────────────────

function blendHex(hex1: string, hex2: string, amount: number): string {
  const r1 = parseInt(hex1.slice(1, 3), 16);
  const g1 = parseInt(hex1.slice(3, 5), 16);
  const b1 = parseInt(hex1.slice(5, 7), 16);
  const r2 = parseInt(hex2.slice(1, 3), 16);
  const g2 = parseInt(hex2.slice(3, 5), 16);
  const b2 = parseInt(hex2.slice(5, 7), 16);
  const r = Math.round(r1 + (r2 - r1) * amount);
  const g = Math.round(g1 + (g2 - g1) * amount);
  const b = Math.round(b1 + (b2 - b1) * amount);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

// ── Public API ─────────────────────────────────────────────────────────

export function generateThemeTokens(
  accentHex: string,
  isDark: boolean,
  style: 'vercel' | 'material',
  variant: SchemeVariant = 'tonal_spot',
  contrast: number = 0,
): ThemeTokens {
  if (style === 'vercel') {
    return vercelTokens(accentHex, isDark);
  }
  return materialTokens(accentHex, isDark, variant, contrast);
}

/**
 * Apply theme tokens as CSS custom properties on the given element.
 * This maps ThemeTokens → the existing --bg-main, --text-main, etc.
 * CSS variable names used throughout the app.
 */
export function applyThemeTokens(tokens: ThemeTokens, target: HTMLElement = document.documentElement) {
  const s = target.style;
  s.setProperty('--bg-main', tokens.bgMain);
  s.setProperty('--bg-secondary', tokens.bgSecondary);
  s.setProperty('--bg-tertiary', tokens.bgTertiary);
  s.setProperty('--bg-hover', tokens.bgHover);
  s.setProperty('--border-main', tokens.borderMain);
  s.setProperty('--border-hover', tokens.borderHover);
  s.setProperty('--border-subtle', tokens.borderSubtle);
  s.setProperty('--text-main', tokens.textMain);
  s.setProperty('--text-secondary', tokens.textSecondary);
  s.setProperty('--text-muted', tokens.textMuted);
  s.setProperty('--assistant-bubble', tokens.assistantBubble);
  s.setProperty('--assistant-bubble-border', tokens.assistantBubbleBorder);
  s.setProperty('--primary', tokens.primary);
  s.setProperty('--primary-foreground', tokens.primaryForeground);
  s.setProperty('--primary-hover', tokens.primaryHover);
  s.setProperty('--primary-light', tokens.primaryLight);
  s.setProperty('--accent', tokens.accent);
  s.setProperty('--accent-muted', tokens.accentMuted);
  s.setProperty('--success', tokens.success);
  s.setProperty('--warning', tokens.warning);
  s.setProperty('--error', tokens.error);
  s.setProperty('--info', tokens.info);
}

/**
 * Generate a preview swatch palette from a seed color for the Settings UI.
 * Returns 5 representative colors that give users a visual sense of the scheme.
 */
export function generatePreviewPalette(
  accentHex: string,
  isDark: boolean,
  variant: SchemeVariant,
): { surface: string; primary: string; secondary: string; tertiary: string; container: string } {
  const argb = argbFromHex(accentHex);
  const sourceHct = Hct.fromInt(argb);
  const scheme = createScheme(sourceHct, isDark, variant, 0);

  return {
    surface: hex(scheme.surfaceContainer),
    primary: hex(scheme.primary),
    secondary: hex(scheme.secondary),
    tertiary: hex(scheme.tertiary),
    container: hex(scheme.primaryContainer),
  };
}

// ── Scheme variant metadata for the UI ─────────────────────────────────

export const SCHEME_VARIANTS: {
  value: SchemeVariant;
  label: string;
  description: string;
}[] = [
  { value: 'tonal_spot', label: 'Tonal Spot', description: 'Default Material You — balanced and versatile' },
  { value: 'neutral', label: 'Neutral', description: 'Understated surfaces with subtle color accents' },
  { value: 'vibrant', label: 'Vibrant', description: 'Rich, saturated colors for a bold look' },
  { value: 'expressive', label: 'Expressive', description: 'Highly colorful with shifted hue accents' },
  { value: 'fidelity', label: 'Fidelity', description: 'Stays true to the source color\'s hue and chroma' },
  { value: 'content', label: 'Content', description: 'Adapts chroma for content-rich interfaces' },
  { value: 'monochrome', label: 'Monochrome', description: 'Achromatic palette — pure grayscale tones' },
  { value: 'rainbow', label: 'Rainbow', description: 'Full-spectrum hue rotation with medium chroma' },
  { value: 'fruit_salad', label: 'Fruit Salad', description: 'Playful complementary color combinations' },
];
