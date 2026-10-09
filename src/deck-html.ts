/**
 * A tokenizer for the HTML a deck is written in.
 *
 * Not a general HTML parser, and not meant to be: a deck is a closed subset
 * (see `deck.ts`), and what this has to get right is reading that subset
 * exactly, reading whatever else a model writes well enough to say what it
 * was, and saying where — every token carries its line and column, which is
 * what a diagnostic quotes back.
 *
 * Three elements are read whole rather than tokenized inside: `<svg>`, kept
 * as markup and drawn as an image; `<style>`, which may hold only
 * `@font-face`; and `<script>`, which is refused. `<aside>` is read whole too,
 * as the speaker notes' plain text.
 *
 * Browser-safe and free of the DOM: the server reads decks with no document to
 * parse them into, and the editor must read them exactly as the server does.
 */

export type HtmlAttribute = { name: string; value: string }

export type HtmlToken = { line: number; column: number } & (
  | { type: "start"; name: string; attributes: HtmlAttribute[]; selfClosing: boolean }
  | { type: "end"; name: string }
  | { type: "text"; text: string }
  | {
      type: "raw"
      name: "svg" | "style" | "script" | "aside"
      attributes: HtmlAttribute[]
      inner: string
      /** Whether its end tag was found; an unclosed one ends at the next slide instead. */
      closed: boolean
    }
)

const RAW_ELEMENTS = new Set(["svg", "style", "script", "aside"])

/** The named references a model writes; anything else is left as written. */
const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ensp: " ",
  emsp: " ",
  thinsp: " ",
  mdash: "—",
  ndash: "–",
  hellip: "…",
  middot: "·",
  bull: "•",
  copy: "©",
  reg: "®",
  trade: "™",
  times: "×",
  divide: "÷",
  minus: "−",
  plusmn: "±",
  deg: "°",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  rarr: "→",
  larr: "←",
  uarr: "↑",
  darr: "↓",
  harr: "↔",
  rArr: "⇒",
  le: "≤",
  ge: "≥",
  ne: "≠",
  asymp: "≈",
  infin: "∞",
  check: "✓",
  cross: "✗",
  star: "☆",
  hearts: "♥",
  euro: "€",
  pound: "£",
  yen: "¥",
  cent: "¢",
  sect: "§",
  para: "¶",
  dagger: "†",
  frac12: "½",
  frac14: "¼",
  frac34: "¾",
  sup2: "²",
  sup3: "³",
  micro: "µ",
  alpha: "α",
  beta: "β",
  gamma: "γ",
  delta: "δ",
  Delta: "Δ",
  epsilon: "ε",
  theta: "θ",
  lambda: "λ",
  mu: "μ",
  pi: "π",
  sigma: "σ",
  Sigma: "Σ",
  omega: "ω",
  Omega: "Ω",
}

/** Character references replaced by what they stand for. */
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (whole, reference: string) => {
    if (reference[0] === "#") {
      const code =
        reference[1] === "x" || reference[1] === "X"
          ? parseInt(reference.slice(2), 16)
          : parseInt(reference.slice(1), 10)

      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole
    }

    return ENTITIES[reference] ?? whole
  })
}

/** Text as it may stand between tags. */
export function escapeText(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

/** Text as it may stand inside a double-quoted attribute. */
export function escapeAttribute(text: string) {
  return text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;")
}

/**
 * A document as tokens. Never throws: what it cannot read as a tag is read as
 * text, which is how a stray `<` in a sentence survives.
 */
export function tokenizeHtml(source: string): HtmlToken[] {
  const tokens: HtmlToken[] = []
  const lineStarts = [0]

  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) {
      lineStarts.push(index + 1)
    }
  }

  const where = (offset: number) => {
    let low = 0
    let high = lineStarts.length - 1

    while (low < high) {
      const middle = (low + high + 1) >> 1

      if (lineStarts[middle]! <= offset) {
        low = middle
      } else {
        high = middle - 1
      }
    }

    return { line: low + 1, column: offset - lineStarts[low]! + 1 }
  }

  let position = 0
  let textStart = 0

  const flushText = (end: number) => {
    if (end > textStart) {
      tokens.push({ type: "text", text: decodeEntities(source.slice(textStart, end)), ...where(textStart) })
    }
  }

  while (position < source.length) {
    const open = source.indexOf("<", position)

    if (open === -1) {
      break
    }

    // A comment, a doctype or a processing instruction: skipped.
    if (source.startsWith("<!--", open)) {
      flushText(open)
      const close = source.indexOf("-->", open + 4)

      position = close === -1 ? source.length : close + 3
      textStart = position
      continue
    }

    if (source.startsWith("<!", open) || source.startsWith("<?", open)) {
      flushText(open)
      const close = source.indexOf(">", open)

      position = close === -1 ? source.length : close + 1
      textStart = position
      continue
    }

    const end = /^<\/([a-zA-Z][\w-]*)\s*>/.exec(source.slice(open, open + 80))

    if (end !== null) {
      flushText(open)
      tokens.push({ type: "end", name: end[1]!.toLowerCase(), ...where(open) })
      position = open + end[0].length
      textStart = position
      continue
    }

    const start = readStartTag(source, open)

    if (start === undefined) {
      // Not a tag: a `<` in prose. It stays in the text.
      position = open + 1
      continue
    }

    flushText(open)

    if (RAW_ELEMENTS.has(start.name) && !start.selfClosing) {
      const { inner, after, closed } = readRaw(source, start.name, start.end)

      tokens.push({
        type: "raw",
        name: start.name as "svg" | "style" | "script" | "aside",
        attributes: start.attributes,
        inner,
        closed,
        ...where(open),
      })
      position = after
    } else {
      tokens.push({
        type: "start",
        name: start.name,
        attributes: start.attributes,
        selfClosing: start.selfClosing,
        ...where(open),
      })
      position = start.end
    }

    textStart = position
  }

  flushText(source.length)

  return tokens
}

const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/y

/** A start tag at `open`, or nothing when what is there is not one. */
function readStartTag(source: string, open: number) {
  const name = /^<([a-zA-Z][\w-]*)/.exec(source.slice(open, open + 64))

  if (name === null) {
    return undefined
  }

  const attributes: HtmlAttribute[] = []
  let position = open + name[0].length
  // A drawing's attributes keep their case: `viewBox` is not `viewbox` to SVG.
  const keepCase = name[1]!.toLowerCase() === "svg"

  while (position < source.length) {
    const rest = /^\s*/.exec(source.slice(position, position + 256))!

    position += rest[0].length

    if (source.startsWith("/>", position)) {
      return { name: name[1]!.toLowerCase(), attributes, selfClosing: true, end: position + 2 }
    }

    if (source[position] === ">") {
      return { name: name[1]!.toLowerCase(), attributes, selfClosing: false, end: position + 1 }
    }

    // Matched in place rather than on a slice, so a value of any length — an
    // inlined image's data URL — is read as the value it is.
    ATTRIBUTE.lastIndex = position
    const attribute = ATTRIBUTE.exec(source)

    if (attribute === null) {
      // A lone `/` before the end, or something no tag holds: skip a character.
      if (source[position] === "/") {
        position += 1
        continue
      }

      return undefined
    }

    attributes.push({
      name: keepCase ? attribute[1]! : attribute[1]!.toLowerCase(),
      value: decodeEntities(attribute[2] ?? attribute[3] ?? attribute[4] ?? ""),
    })
    position += attribute[0].length
  }

  return undefined
}

/**
 * A raw element's inside, up to its matching end tag — nested `<svg>`s counted
 * — and where it ends. One left unclosed ends where the slide does, at the
 * next `<section>` or `</section>`, rather than taking every slide after it.
 */
function readRaw(source: string, name: string, from: number) {
  const pattern = new RegExp(`<(/?)(${name}|section)\\b[^>]*?(/?)>`, "gi")
  let depth = 1

  pattern.lastIndex = from

  for (let match = pattern.exec(source); match !== null; match = pattern.exec(source)) {
    if (match[2]!.toLowerCase() !== name) {
      return { inner: source.slice(from, match.index), after: match.index, closed: false }
    }

    if (match[1] === "/") {
      depth -= 1
    } else if (match[3] !== "/" && name === "svg") {
      depth += 1
    }

    if (depth === 0) {
      return { inner: source.slice(from, match.index), after: match.index + match[0].length, closed: true }
    }
  }

  return { inner: source.slice(from), after: source.length, closed: false }
}
