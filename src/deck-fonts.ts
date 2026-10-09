import type { Deck } from "./deck"
import { DECK_BASE_CSS, DECK_MOTION_CSS } from "./deck-render"

/**
 * What a deck needs from the page drawing it: the slide sheet every slide
 * starts from, and the typefaces the deck names.
 *
 * Both go into the app's own document, once each. The sheet is scoped under
 * `.deck-slide`, so it styles nothing else; and it is a step more specific
 * than the app's reset, so a `<ul>` on a slide keeps its bullets. A Google
 * Fonts stylesheet loads once for every deck that names it.
 */

const EDITOR_CSS = `
.deck-stage .deck-slide a { pointer-events: none; }
.deck-editing-text { outline: none; cursor: text; caret-color: auto; }
.deck-editing-text:empty::before { content: "\\200b"; }
`

let sheetInstalled = false

export function installDeckSheet() {
  if (sheetInstalled || typeof document === "undefined") {
    return
  }

  const style = document.createElement("style")

  style.dataset.deck = "base"
  style.textContent = DECK_BASE_CSS + DECK_MOTION_CSS + EDITOR_CSS
  document.head.append(style)
  sheetInstalled = true
}

/** Each stylesheet link added, by its address, settling when it has loaded or failed. */
const loadedLinks = new Map<string, Promise<void>>()
const loadedFaces = new Set<string>()

/** The rule declaring one of a deck's own faces, served at `url`. */
export function fontFaceRule(family: string, url: string) {
  return `@font-face{font-family:${JSON.stringify(family)};src:url(${JSON.stringify(url)});font-display:swap}`
}

/**
 * Load the faces a deck names; `resolveAsset` says where its own font files
 * are served. Settles once the stylesheets that declare them have arrived —
 * the faces themselves load when text is laid out in them.
 */
export function loadDeckFonts(
  deck: Pick<Deck, "fontLinks" | "fontFaces">,
  resolveAsset: (src: string) => string,
): Promise<void> {
  if (typeof document === "undefined") {
    return Promise.resolve()
  }

  const sheets: Promise<void>[] = []

  for (const href of deck.fontLinks) {
    if (!href.startsWith("https://fonts.googleapis.com/")) {
      continue
    }

    let loaded = loadedLinks.get(href)

    if (loaded === undefined) {
      const link = document.createElement("link")

      loaded = new Promise((resolve) => {
        link.addEventListener("load", () => resolve(), { once: true })
        link.addEventListener("error", () => resolve(), { once: true })
      })
      link.rel = "stylesheet"
      link.href = href
      document.head.append(link)
      loadedLinks.set(href, loaded)
    }

    sheets.push(loaded)
  }

  for (const face of deck.fontFaces) {
    const url = resolveAsset(face.src)
    const key = `${face.family}@${url}`

    if (loadedFaces.has(key)) {
      continue
    }

    const style = document.createElement("style")

    style.textContent = fontFaceRule(face.family, url)
    document.head.append(style)
    loadedFaces.add(key)
  }

  return Promise.all(sheets).then(() => undefined)
}

/** The family a font-family value starts with, unquoted. */
export function firstFamily(value: string | undefined) {
  return value
    ?.split(",")[0]
    ?.trim()
    .replace(/^['"]|['"]$/g, "")
}
