import type { Deck } from "../index"
import { firstFamily } from "../dom"

/**
 * The deck's faces, as the format pane and the design panel both offer them:
 * which names to offer, how a name becomes a `font-family` with a fallback,
 * and the Google Fonts stylesheet a deck loads one from.
 */

/** Faces offered by name: the system's, a few Google Fonts that cover Latin and CJK. */
const FONT_PRESETS = [
  "system-ui, sans-serif",
  "Inter",
  "Noto Sans SC",
  "Noto Sans JP",
  "Noto Serif SC",
  "Source Serif 4",
  "Playfair Display",
  "Space Grotesk",
  "IBM Plex Sans",
  "DM Sans",
  "JetBrains Mono",
  "Georgia, serif",
]

const GENERIC = new Set(["system-ui", "sans-serif", "serif", "monospace", "cursive", "Georgia"])

/** The names in a Google Fonts stylesheet's address. */
export function fontName(href: string) {
  return [...href.matchAll(/family=([^:&]+)/g)]
    .map((match) => decodeURIComponent(match[1]!.replace(/\+/g, " ")))
    .join(", ")
}

/** What to offer: whatever the deck already loads, then the presets. */
export function fontOptionsOf(deck: Deck) {
  const loaded = deck.fontLinks.flatMap((href) =>
    [...href.matchAll(/family=([^:&]+)/g)].map((match) => decodeURIComponent(match[1]!.replace(/\+/g, " "))),
  )

  return [...new Set([...loaded, ...FONT_PRESETS])]
}

/** The stylesheet that loads one Google Font, in the weights a deck uses. */
export function googleFontLink(name: string) {
  return `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}:wght@400;500;600;700&display=swap`
}

/**
 * A face set by name: written with a generic fallback, and the deck with that
 * face's stylesheet added when it is a Google Font it does not load yet.
 */
export function withFamily(deck: Deck, family: string): { deck: Deck; family: string } {
  const known = family.includes(",")
    ? family
    : `${/\s/.test(family) ? `'${family}'` : family}, ${/mono/i.test(family) ? "monospace" : /serif|playfair|georgia/i.test(family) && !/sans/i.test(family) ? "serif" : "sans-serif"}`
  const name = firstFamily(known) ?? family

  if (
    GENERIC.has(name) ||
    deck.fontLinks.some((href) => href.includes(`family=${name.replace(/ /g, "+")}`))
  ) {
    return { deck, family: known }
  }

  return { deck: { ...deck, fontLinks: [...deck.fontLinks, googleFontLink(name)] }, family: known }
}
