/**
 * Theme persistence. FRONTEND_SPEC §15.3.
 * Dark is the default. The `dark` class on the document selects it;
 * `light` selects the light workspace tokens. Home stays on the dark stylesheet.
 */

export type ThemeName = 'dark' | 'light'

const THEME_KEY = 'spherex-theme'

export function readStoredTheme(): ThemeName | null {
  try {
    const value = localStorage.getItem(THEME_KEY)
    if (value === 'dark' || value === 'light') return value
    return null
  } catch {
    return null
  }
}

export function writeStoredTheme(theme: ThemeName): void {
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Private mode and blocked storage keep the in-memory choice only.
  }
}

/** Initial theme: `'light'` only if explicitly stored as `'light'`, otherwise `'dark'`. */
export function initialTheme(): ThemeName {
  return readStoredTheme() === 'light' ? 'light' : 'dark'
}

export function applyTheme(theme: ThemeName): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.classList.toggle('light', theme === 'light')
  root.style.colorScheme = theme
  const scheme = document.querySelector('meta[name="color-scheme"]')
  if (scheme) scheme.setAttribute('content', theme)
  const chrome = document.querySelector('meta[name="theme-color"]')
  if (chrome) chrome.setAttribute('content', theme === 'dark' ? '#000000' : '#ffffff')
}

export function prefersReducedMotion(): boolean {
  if (typeof matchMedia !== 'function') return false
  return matchMedia('(prefers-reduced-motion: reduce)').matches
}
