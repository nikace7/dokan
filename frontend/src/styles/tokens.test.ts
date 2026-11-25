import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

// Read from disk: Vitest hands back an empty string for imported stylesheets.
const css = readFileSync('src/styles/tokens.css', 'utf8');

type Rgb = [number, number, number];

/** `--name: H S% L%` as RGB in 0–1. */
function token(name: string): Rgb {
  const match = new RegExp(`--${name}: ([0-9.]+) ([0-9.]+)% ([0-9.]+)%`).exec(css);
  if (!match) throw new Error(`No token ${name}`);
  const [h, s, l] = [Number(match[1]), Number(match[2]) / 100, Number(match[3]) / 100];
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [channel(0), channel(8), channel(4)];
}

/** `name`, or `name/10` laid over white. */
function colour(spec: string): Rgb {
  const [name, percent = '100'] = spec.split('/');
  const alpha = Number(percent) / 100;
  return token(name).map((c) => c * alpha + 1 - alpha) as Rgb;
}

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(text: string, surface: string): number {
  const [light, dark] = [luminance(colour(text)), luminance(colour(surface))].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

const PAIRS: Array<[text: string, surfaces: string[]]> = [
  ['foreground', ['background', 'muted', 'accent']],
  [
    'muted-foreground',
    ['background', 'muted', 'accent', 'success/10', 'warning/10', 'destructive/10'],
  ],
  ['accent-foreground', ['accent']],
  ['primary', ['background', 'muted', 'accent', 'primary/10']],
  ['primary-foreground', ['primary', 'primary/90']],
  ['success', ['background', 'muted', 'success/10']],
  ['success-foreground', ['success']],
  ['warning', ['background', 'muted', 'warning/10']],
  ['warning-foreground', ['warning']],
  ['destructive', ['background', 'muted', 'destructive/10']],
  ['destructive-foreground', ['destructive', 'destructive/90']],
];

describe('theme colours', () => {
  it.each(PAIRS.flatMap(([text, surfaces]) => surfaces.map((surface) => [text, surface] as const)))(
    '%s is readable on %s (WCAG AA, 4.5:1)',
    (text, surface) => {
      expect(contrast(text, surface)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
