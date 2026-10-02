export type Ink = { math: string; code: string }

// Claude Code's dark and light themes; `code` is a blue near each theme's own
// inline-code color, for code spans in a paragraph the mod draws itself.
const DARK_INK: Ink = { math: '#e8e8e8', code: '#b1b9f9' }
const LIGHT_INK: Ink = { math: '#24292f', code: '#5769f7' }

// Pictures reach the screen through the kitty graphics protocol, which
// Ghostty (and cmux, built on it) and kitty speak; tmux passes none of it
// through. `mode` is the user's override: `on`, `off` or `auto`.
export function canDrawImages(env: Record<string, string | undefined>, mode: string): boolean {
  if (mode === 'on') return true
  if (mode === 'off') return false
  if (env.TMUX) return false
  return (
    env.TERM_PROGRAM === 'ghostty' ||
    env.TERM === 'xterm-ghostty' ||
    Boolean(env.TERM?.includes('kitty')) ||
    Boolean(env.KITTY_WINDOW_ID)
  )
}

// Formula ink for Claude Code's theme; a `#rrggbb` color overrides it.
export function inkFor(theme: string | undefined, color: string): Ink {
  const ink = theme?.startsWith('light') ? LIGHT_INK : DARK_INK
  return /^#[0-9a-fA-F]{6}$/.test(color) ? { ...ink, math: color } : ink
}
