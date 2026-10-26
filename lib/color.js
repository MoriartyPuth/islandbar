const FALLBACK = 0x282828;

// '#rrggbb' -> 'rgba(r, g, b, alpha)' for St inline styles. Anything that
// isn't a 6-digit hex falls back to Gruvbox bg so a bad setting can't break CSS.
export function rgba(hex, alpha) {
    const match = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
    const n = match ? parseInt(match[1], 16) : FALLBACK;
    return `rgba(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255}, ${alpha})`;
}
