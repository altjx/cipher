/**
 * Generates a distinctive two-tone gradient for a contact avatar
 * based on their name. Each name deterministically maps to a unique
 * hue, producing a light→dark gradient of the same color family.
 */

const PALETTE: [string, string][] = [
  ['#60a5fa', '#2563eb'], // blue
  ['#f472b6', '#db2777'], // pink
  ['#fbbf24', '#d97706'], // amber
  ['#a78bfa', '#7c3aed'], // purple
  ['#34d399', '#059669'], // green
  ['#fb923c', '#ea580c'], // orange
  ['#38bdf8', '#0284c7'], // sky
  ['#e879f9', '#c026d3'], // fuchsia
  ['#4ade80', '#16a34a'], // emerald
  ['#f87171', '#dc2626'], // red
  ['#2dd4bf', '#0d9488'], // teal
  ['#facc15', '#ca8a04'], // yellow
];

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function avatarGradient(name: string): string {
  const [from, to] = PALETTE[hash(name) % PALETTE.length];
  return `linear-gradient(135deg, ${from}, ${to})`;
}
