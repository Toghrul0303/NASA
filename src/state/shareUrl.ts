/**
 * Share links and embed code. FRONTEND_SPEC §5.1 and §5.4.
 * No React and no DOM: callers pass the current `href`.
 * Parameter order follows §5.2: ra, dec, fov, tool, slug, embed, then unknown parameters.
 */
import { isValidSlug } from '../contract/validate'

const KNOWN_ORDER = ['ra', 'dec', 'fov', 'tool', 'slug', 'embed'] as const

function canonicalUrl(href: string, slug: string | null, embed: boolean): string {
  const url = new URL(href)
  const source = url.searchParams
  const known = new Map<string, string>()
  const unknown: Array<[string, string]> = []
  for (const [key, value] of source) {
    if ((KNOWN_ORDER as readonly string[]).includes(key)) {
      if (!known.has(key)) known.set(key, value)
    } else {
      unknown.push([key, value])
    }
  }
  if (!known.has('slug') && slug !== null && isValidSlug(slug)) known.set('slug', slug)
  if (embed) known.set('embed', '1')
  else known.delete('embed')
  const next = new URLSearchParams()
  for (const key of KNOWN_ORDER) {
    const value = known.get(key)
    if (value !== undefined) next.set(key, value)
  }
  for (const [key, value] of unknown) next.append(key, value)
  url.search = next.toString()
  return url.toString()
}

/** The current workspace URL, without `embed`. `slug` fills in only when the URL lacks one. */
export function buildShareLink(href: string, slug: string | null): string {
  return canonicalUrl(href, slug, false)
}

/** The same URL plus `embed=1`. */
export function buildEmbedUrl(href: string, slug: string | null): string {
  return canonicalUrl(href, slug, true)
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export const EMBED_HEIGHT_PX = 640

/** An `<iframe>` element for the embed URL. Width 100%, height 640, with a title. */
export function buildEmbedCode(embedUrl: string, title: string): string {
  return `<iframe src="${escapeAttribute(embedUrl)}" width="100%" height="${EMBED_HEIGHT_PX}" title="${escapeAttribute(title)}" style="border:0" loading="lazy" allowfullscreen></iframe>`
}
