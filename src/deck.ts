import { readDeckStyle, writeDeckStyle } from "./deck-css"
import { decodeEntities, escapeAttribute, escapeText, tokenizeHtml, type HtmlAttribute } from "./deck-html"
import { deckIconBody } from "./deck-icons"

/**
 * A deck: one HTML document, one `<section>` per slide on a 1920×1080 canvas,
 * every style inline and drawn from a closed subset. See `docs/format.md`.
 *
 * `readDeck` turns the text into a typed tree and says what it had to leave
 * out; `writeDeck` turns a tree back into text. Everything downstream — the
 * page a version renders to, the editor's stage, the exports — reads the tree
 * and never the text, so what the subset refuses here is refused everywhere.
 *
 * Writing is normalized: the same tree always writes the same text, one
 * element to a line, so a reader's change to one box is a diff of one line —
 * which is what the model is shown of it.
 *
 * Browser-safe: the editor reads and writes decks through this.
 */

/** The canvas every slide is drawn on, in CSS pixels. */
export const DECK_WIDTH = 1920
export const DECK_HEIGHT = 1080

/** The most a deck holds, past which it is not a deck anyone presents. */
const MAX_SLIDES = 500
const MAX_ELEMENTS_PER_SLIDE = 200
const MAX_SVG_BYTES = 52 * 1024

export type DeckStyle = Readonly<Record<string, string>>

/** The tags a slide's tree may hold. */
export const DECK_BLOCK_TAGS = [
  "div",
  "h1",
  "h2",
  "h3",
  "p",
  "ul",
  "ol",
  "img",
  "table",
  "hr",
  "x-shape",
  "x-icon",
  "x-connector",
] as const
export const DECK_INLINE_TAGS = ["b", "i", "u", "s", "a", "span", "br"] as const
export type DeckTag =
  | (typeof DECK_BLOCK_TAGS)[number]
  | (typeof DECK_INLINE_TAGS)[number]
  | "li"
  | "tr"
  | "th"
  | "td"

export type DeckText = { type: "text"; text: string }

export type DeckElement = {
  type: "element"
  tag: DeckTag
  attributes: Readonly<Record<string, string>>
  style: DeckStyle
  children: readonly DeckNode[]
}

/**
 * A drawing, kept as the markup inside its `<svg>`: the subset does not
 * reach into it. Drawn as an image, which is why it may hold no script, no
 * handler and nothing from outside itself.
 */
export type DeckSvg = {
  type: "svg"
  attributes: Readonly<Record<string, string>>
  style: DeckStyle
  markup: string
}

export type DeckNode = DeckText | DeckElement | DeckSvg

export const DECK_TRANSITIONS = ["fade", "push", "magic"] as const
export type DeckTransition = (typeof DECK_TRANSITIONS)[number]

export type DeckSlide = {
  id: string
  style: DeckStyle
  /** How this slide leaves for the next. */
  transition?: DeckTransition
  /** The one sentence of the outline a section of the deck starts with, here. */
  section?: string
  /** Skipped when presenting and printing. */
  hidden?: true
  /** The speaker notes, as plain text. */
  notes: string
  children: readonly DeckNode[]
}

/** A face the deck brings: a Google Fonts stylesheet, or a font file among its assets. */
export type DeckFontFace = { family: string; src: string }

export type Deck = {
  title: string
  /** Google Fonts stylesheets, `https://fonts.googleapis.com/css2?…`. */
  fontLinks: readonly string[]
  fontFaces: readonly DeckFontFace[]
  /** The defaults every slide inherits: its type and colour. */
  style: DeckStyle
  slides: readonly DeckSlide[]
}

export const DECK_SHAPE_KINDS = [
  "rect",
  "rounded",
  "ellipse",
  "diamond",
  "triangle",
  "arrow-right",
  "arrow-left",
  "arrow-up",
  "arrow-down",
  "line",
] as const

export type DeckDiagnostic = {
  /** A `warning` changed what the slide shows; a `note` changed only how it is written. */
  severity: "warning" | "note"
  line: number
  column: number
  /** The slide it is on, counted from 1, when it is on one. */
  slide?: number
  message: string
}

// ---------------------------------------------------------------------------
// Reading, pass one: the document as a loose tree
// ---------------------------------------------------------------------------

type RawElement = {
  kind: "element"
  name: string
  attributes: HtmlAttribute[]
  children: RawNode[]
  line: number
  column: number
}
type RawText = { kind: "text"; text: string; line: number; column: number }
type RawWhole = {
  kind: "raw"
  name: string
  attributes: HtmlAttribute[]
  inner: string
  /** Whether its end tag was found. */
  closed: boolean
  line: number
  column: number
}
type RawNode = RawElement | RawText | RawWhole

const VOID = new Set([
  "br",
  "hr",
  "img",
  "meta",
  "link",
  "input",
  "wbr",
  "source",
  "col",
  "area",
  "base",
  "x-shape",
  "x-icon",
  "x-connector",
])
const CLOSES_P = new Set([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "div",
  "ul",
  "ol",
  "table",
  "section",
  "hr",
  "blockquote",
  "figure",
  "header",
  "footer",
  "aside",
])

/**
 * How deep the tree may nest before what is inside is set beside its parent:
 * every reader after this one recurses, and a deck is never this deep.
 */
const MAX_TREE_DEPTH = 256

/**
 * Tokens as a tree, closing what HTML closes on its own: a paragraph at the
 * next block, a list item at the next item, a cell at the next cell, a
 * section at the next section. An end tag nothing is open for is skipped.
 * Past `MAX_TREE_DEPTH` an element opens nothing, and `tooDeep` is told where.
 */
function buildTree(source: string, tooDeep: (at: { line: number; column: number }) => void): RawElement {
  const root: RawElement = {
    kind: "element",
    name: "#root",
    attributes: [],
    children: [],
    line: 1,
    column: 1,
  }
  const stack: RawElement[] = [root]
  const top = () => stack.at(-1)!
  const closeTo = (names: readonly string[], until: readonly string[] = []) => {
    for (let index = stack.length - 1; index > 0; index -= 1) {
      const name = stack[index]!.name

      if (until.includes(name)) {
        return
      }

      if (names.includes(name)) {
        stack.length = index
        return
      }
    }
  }

  for (const token of tokenizeHtml(source)) {
    switch (token.type) {
      case "text":
        top().children.push({ kind: "text", text: token.text, line: token.line, column: token.column })
        break

      case "raw":
        top().children.push({
          kind: "raw",
          name: token.name,
          attributes: token.attributes,
          inner: token.inner,
          closed: token.closed,
          line: token.line,
          column: token.column,
        })
        break

      case "start": {
        const name = token.name

        if (CLOSES_P.has(name)) {
          closeTo(["p"], ["div", "section", "td", "th", "li", "body"])
        }

        if (name === "li") {
          closeTo(["li"], ["ul", "ol"])
        } else if (name === "tr") {
          closeTo(["tr"], ["table", "tbody", "thead", "tfoot"])
        } else if (name === "td" || name === "th") {
          closeTo(["td", "th"], ["tr", "table"])
        } else if (name === "section") {
          closeTo(["section"])
        }

        const element: RawElement = {
          kind: "element",
          name,
          attributes: token.attributes,
          children: [],
          line: token.line,
          column: token.column,
        }

        top().children.push(element)

        if (!VOID.has(name) && !token.selfClosing) {
          if (stack.length < MAX_TREE_DEPTH) {
            stack.push(element)
          } else {
            tooDeep(element)
          }
        }
        break
      }

      case "end": {
        if (VOID.has(token.name)) {
          break
        }

        closeTo([token.name])
        break
      }
    }
  }

  return root
}

// ---------------------------------------------------------------------------
// Reading, pass two: the loose tree as a deck
// ---------------------------------------------------------------------------

/** Tags read as one the subset has. */
const TAG_ALIASES: Record<string, DeckTag> = {
  strong: "b",
  em: "i",
  del: "s",
  strike: "s",
  ins: "u",
  h4: "h3",
  h5: "h3",
  h6: "h3",
  blockquote: "div",
  figure: "div",
  figcaption: "p",
  header: "div",
  footer: "div",
  main: "div",
  article: "div",
  nav: "div",
  center: "div",
  small: "span",
  mark: "span",
  sup: "span",
  sub: "span",
  code: "span",
  kbd: "span",
  label: "span",
  time: "span",
  abbr: "span",
  cite: "span",
  q: "span",
}

/** Wrappers read as their contents: a table's row groups. */
const TRANSPARENT = new Set(["thead", "tbody", "tfoot", "colgroup", "picture"])

/** Elements dropped with what is in them: they draw nothing a slide can hold. */
const DROPPED = new Set([
  "script",
  "noscript",
  "iframe",
  "object",
  "embed",
  "canvas",
  "video",
  "audio",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "template",
  "x-embed",
  "col",
  "source",
  "meta",
  "link",
  "style",
  "title",
  "head",
])

const TEXT_BLOCKS = new Set(["h1", "h2", "h3", "p"])
const INLINE = new Set<string>(["b", "i", "u", "s", "a", "span"])

/** Attributes any element may carry. */
const GLOBAL_ATTRIBUTES = new Set(["id", "data-build-in", "data-build-out"])
const TAG_ATTRIBUTES: Partial<Record<DeckTag, readonly string[]>> = {
  a: ["href"],
  img: ["src", "alt", "data-crop"],
  "x-shape": ["kind"],
  "x-icon": ["name"],
  "x-connector": ["x1", "y1", "x2", "y2", "head", "route", "from"],
}
/** Attributes dropped without a word: they say nothing a slide draws. */
const SILENT_ATTRIBUTES =
  /^(class|role|title|lang|dir|tabindex|aria-.*|data-.*|width|height|loading|decoding|draggable|target|rel|xmlns.*)$/

const SLIDE_ID = /^[A-Za-z0-9_-]{1,64}$/

type Reader = {
  diagnostics: DeckDiagnostic[]
  slide: number | undefined
  elements: number
}

function say(
  reader: Reader,
  at: { line: number; column: number },
  severity: DeckDiagnostic["severity"],
  message: string,
) {
  reader.diagnostics.push({
    severity,
    line: at.line,
    column: at.column,
    ...(reader.slide === undefined ? {} : { slide: reader.slide }),
    message,
  })
}

/**
 * A deck from its text, and everything about the text it could not keep.
 * Never refuses: what the subset cannot say is left out and named, so a deck
 * with one mistake still shows every slide it can.
 */
export function readDeck(source: string): { deck: Deck; diagnostics: DeckDiagnostic[] } {
  const reader: Reader = { diagnostics: [], slide: undefined, elements: 0 }
  let deepWarned = false
  const root = buildTree(source.replace(/\r\n?/g, "\n"), (at) => {
    if (!deepWarned) {
      deepWarned = true
      say(
        reader,
        at,
        "warning",
        `Elements nest more than ${MAX_TREE_DEPTH} deep here; what is deeper is set beside its parent.`,
      )
    }
  })
  const html = findFirst(root, "html") ?? root
  const head = findFirst(html, "head")
  const body = findFirst(html, "body") ?? html
  const titleElement = findFirst(head ?? html, "title")
  const fontLinks: string[] = []
  const fontFaces: DeckFontFace[] = []

  for (const link of findAll(
    head ?? html,
    (node) => node.kind === "element" && node.name === "link",
  ) as RawElement[]) {
    const href = attribute(link, "href")
    const rel = attribute(link, "rel")

    if (rel !== "stylesheet" || href === undefined) {
      continue
    }

    if (href.startsWith("https://fonts.googleapis.com/")) {
      fontLinks.push(href)
    } else {
      say(
        reader,
        link,
        "warning",
        `<link href="${href}"> is dropped: a deck loads stylesheets only from Google Fonts.`,
      )
    }
  }

  for (const style of findAll(root, (node) => node.kind === "raw" && node.name === "style") as RawWhole[]) {
    fontFaces.push(...readFontFaces(reader, style))
  }

  const sections = findAll(
    body,
    (node) => node.kind === "element" && node.name === "section",
    true,
  ) as RawElement[]

  if (sections.length > MAX_SLIDES) {
    say(
      reader,
      sections[MAX_SLIDES]!,
      "warning",
      `A deck holds at most ${MAX_SLIDES} slides; the rest are dropped.`,
    )
  }

  const ids = new Set<string>()
  const slides = sections.slice(0, MAX_SLIDES).map((section, index) => {
    reader.slide = index + 1
    reader.elements = 0

    return readSlide(reader, section, index, ids)
  })

  reader.slide = undefined

  for (const stray of strayContent(body)) {
    say(reader, stray, "warning", "Content outside a <section> is dropped: every slide is a <section>.")
  }

  return {
    deck: {
      title: titleElement === undefined ? "" : textOf(titleElement).trim(),
      fontLinks,
      fontFaces,
      style: readStyle(reader, "body", body),
      slides,
    },
    diagnostics: reader.diagnostics,
  }
}

function attribute(element: RawElement | RawWhole, name: string) {
  return element.attributes.find((candidate) => candidate.name === name)?.value
}

function findFirst(node: RawElement, name: string): RawElement | undefined {
  for (const child of node.children) {
    if (child.kind !== "element") {
      continue
    }

    if (child.name === name) {
      return child
    }

    const found = findFirst(child, name)

    if (found !== undefined) {
      return found
    }
  }

  return undefined
}

/** Every node `matches` takes, in document order; with `outermost`, not looking inside a match. */
function findAll(node: RawElement, matches: (node: RawNode) => boolean, outermost = false): RawNode[] {
  const found: RawNode[] = []

  for (const child of node.children) {
    if (matches(child)) {
      found.push(child)

      if (outermost) {
        continue
      }
    }

    if (child.kind === "element") {
      found.push(...findAll(child, matches, outermost))
    }
  }

  return found
}

/** What lies outside every section and would show: text, or an element that is not a wrapper. */
function strayContent(node: RawElement): RawNode[] {
  return node.children.flatMap((child): RawNode[] => {
    if (child.kind === "text") {
      return child.text.trim() === "" ? [] : [child]
    }

    if (child.kind === "raw") {
      return child.name === "style" ? [] : [child]
    }

    if (
      child.name === "section" ||
      child.name === "head" ||
      child.name === "title" ||
      child.name === "link" ||
      child.name === "meta"
    ) {
      return []
    }

    // A wrapper around sections — a `<main>`, a `<div class="deck">` — is
    // looked through: the sections in it are the slides.
    const holdsSections =
      findAll(child, (node) => node.kind === "element" && node.name === "section").length > 0

    return holdsSections ? strayContent(child) : [child]
  })
}

function textOf(node: RawNode): string {
  if (node.kind === "text") {
    return node.text
  }

  if (node.kind === "raw") {
    return ""
  }

  return node.children.map(textOf).join("")
}

/** `@font-face` rules from a `<style>`; anything else in it is dropped. */
function readFontFaces(reader: Reader, style: RawWhole): DeckFontFace[] {
  const faces: DeckFontFace[] = []
  const rest = style.inner.replace(/@font-face\s*\{([^}]*)\}/g, (_, body: string) => {
    const family = /font-family\s*:\s*(["']?)([^;"']+)\1/.exec(body)?.[2]?.trim()
    const src = /src\s*:\s*url\(\s*(["']?)([^)"']+)\1\s*\)/.exec(body)?.[2]?.trim()

    if (family !== undefined && src !== undefined && isAssetPath(src)) {
      faces.push({ family, src })
    } else {
      say(
        reader,
        style,
        "warning",
        "An @font-face is dropped: it needs a font-family and a src naming one of the deck's assets.",
      )
    }

    return ""
  })

  if (rest.replace(/\/\*[\s\S]*?\*\//g, "").trim() !== "") {
    say(
      reader,
      style,
      "warning",
      "A <style> may hold only @font-face rules; the rest is dropped. Style each element inline.",
    )
  }

  return faces
}

/** Whether `src` names one of the deck's assets: `assets/<name>`. */
export function isAssetPath(src: string) {
  return /^assets\/[\w.-]{1,128}$/.test(src)
}

/** Whether an image may come from `src`: an asset, or the web over https. */
export function isDeckImageSource(src: string) {
  return isAssetPath(src) || /^https:\/\/[^\s"'<>]+$/.test(src)
}

function readStyle(reader: Reader, tag: string, element: RawElement | RawWhole): DeckStyle {
  const written = attribute(element, "style")

  if (written === undefined || written.trim() === "") {
    return {}
  }

  const style: Record<string, string> = {}

  for (const declaration of readDeckStyle(tag, written)) {
    if ("value" in declaration) {
      style[declaration.property] = declaration.value
    } else if (declaration.silent !== true) {
      say(reader, element, "warning", `<${tag}> style \`${declaration.property}\` ${declaration.dropped}.`)
    }
  }

  return style
}

function readSlide(reader: Reader, section: RawElement, index: number, ids: Set<string>): DeckSlide {
  const written = attribute(section, "id")
  let id = written ?? ""

  if (!SLIDE_ID.test(id) || ids.has(id)) {
    const fresh = uniqueId(`slide-${index + 1}`, ids)

    say(
      reader,
      section,
      "note",
      written === undefined
        ? `The slide has no id; it is "${fresh}".`
        : `id="${written}" is ${ids.has(written) ? "taken by an earlier slide" : "not [A-Za-z0-9_-]{1,64}"}; the slide is "${fresh}".`,
    )
    id = fresh
  }

  ids.add(id)

  const transition = attribute(section, "data-transition")
  const sectionTitle = attribute(section, "data-section")?.trim()
  const asides = section.children.filter(
    (child): child is RawWhole => child.kind === "raw" && child.name === "aside",
  )

  for (const aside of asides.filter((candidate) => !candidate.closed)) {
    say(reader, aside, "warning", "<aside> has no </aside>; the notes end where the slide does.")
  }

  const notes = asides.map((aside) => notesText(aside.inner)).join("\n\n")
  const children = readBlocks(
    reader,
    section.children.filter((child) => !(child.kind === "raw" && child.name === "aside")),
    1,
  )

  if (transition !== undefined && !(DECK_TRANSITIONS as readonly string[]).includes(transition)) {
    say(
      reader,
      section,
      "warning",
      `data-transition="${transition}" is dropped: ${DECK_TRANSITIONS.join(", ")}.`,
    )
  }

  if (reader.elements > MAX_ELEMENTS_PER_SLIDE) {
    say(
      reader,
      section,
      "warning",
      `This slide has ${reader.elements} elements; keep a slide under ${MAX_ELEMENTS_PER_SLIDE}, or split it.`,
    )
  }

  return {
    id,
    style: readStyle(reader, "section", section),
    ...((DECK_TRANSITIONS as readonly string[]).includes(transition ?? "")
      ? { transition: transition as DeckTransition }
      : {}),
    ...(sectionTitle === undefined || sectionTitle === "" ? {} : { section: sectionTitle }),
    ...(section.attributes.some((candidate) => candidate.name === "hidden") ? { hidden: true as const } : {}),
    notes,
    children,
  }
}

export function uniqueId(base: string, taken: ReadonlySet<string>) {
  if (!taken.has(base)) {
    return base
  }

  for (let suffix = 2; ; suffix += 1) {
    if (!taken.has(`${base}-${suffix}`)) {
      return `${base}-${suffix}`
    }
  }
}

/** The notes' markup as plain text: a break or a paragraph is a new line, any other tag is gone. */
function notesText(inner: string) {
  return decodeEntities(
    inner
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?p\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  )
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** `data-crop="2 30% 40%"`: a zoom from 1 to 50 and the point it is centred on. */
export function readDeckCrop(text: string): { zoom: number; x: string; y: string } | undefined {
  const parts = text.trim().split(/\s+/)
  const position = /^-?\d+(\.\d+)?(%|px)$/

  if (parts.length !== 3) {
    return undefined
  }

  const zoom = Number(parts[0])

  return Number.isFinite(zoom) &&
    zoom >= 1 &&
    zoom <= 50 &&
    position.test(parts[1]!) &&
    position.test(parts[2]!)
    ? { zoom, x: parts[1]!, y: parts[2]! }
    : undefined
}

/** The attributes a tag keeps, after the ones it may not carry are named and dropped. */
function readAttributes(
  reader: Reader,
  tag: DeckTag,
  element: RawElement | RawWhole,
): Record<string, string> {
  const kept: Record<string, string> = {}
  const allowed = TAG_ATTRIBUTES[tag] ?? []

  for (const { name, value } of element.attributes) {
    if (name === "style") {
      continue
    }

    if (name === "data-crop" && tag === "img" && readDeckCrop(value) === undefined) {
      say(
        reader,
        element,
        "warning",
        `data-crop="${value.slice(0, 60)}" is dropped: a zoom from 1 to 50 and where it is centred, as \`2 30% 40%\`.`,
      )
      continue
    }

    if (GLOBAL_ATTRIBUTES.has(name) || allowed.includes(name)) {
      kept[name] = value
      continue
    }

    if (name.startsWith("on")) {
      say(reader, element, "warning", `<${tag} ${name}> is dropped: a slide runs no scripts.`)
    } else if (!SILENT_ATTRIBUTES.test(name)) {
      say(reader, element, "note", `<${tag}> attribute \`${name}\` is dropped.`)
    }
  }

  return kept
}

/** The tag a written element is read as, or what to do instead. */
function tagOf(name: string): DeckTag | "transparent" | "dropped" | "unknown" {
  if (TRANSPARENT.has(name)) {
    return "transparent"
  }

  if (DROPPED.has(name)) {
    return "dropped"
  }

  const tag = TAG_ALIASES[name] ?? name

  return (DECK_BLOCK_TAGS as readonly string[]).includes(tag) ||
    (DECK_INLINE_TAGS as readonly string[]).includes(tag) ||
    ["li", "tr", "th", "td"].includes(tag)
    ? (tag as DeckTag)
    : "unknown"
}

/**
 * The children of a section or a `div`: blocks. Text standing in it directly
 * is set as a paragraph — which is what was meant, and what the editor can
 * hold — and an inline element with it.
 */
function readBlocks(reader: Reader, nodes: readonly RawNode[], depth: number): DeckNode[] {
  const blocks: DeckNode[] = []
  let loose: RawNode[] = []

  const flushLoose = () => {
    const inline = readInline(reader, loose)
    const first = loose[0]

    if (inline.length > 0 && first !== undefined) {
      say(reader, first, "note", "Text directly inside a container is set as a <p>.")
      blocks.push(element("p", {}, {}, inline))
    }

    loose = []
  }

  for (const node of nodes) {
    if (node.kind === "text") {
      loose.push(node)
      continue
    }

    if (node.kind === "raw") {
      flushLoose()
      blocks.push(...readRaw(reader, node))
      continue
    }

    const tag = tagOf(node.name)

    if (
      tag !== "transparent" &&
      tag !== "dropped" &&
      tag !== "unknown" &&
      (INLINE.has(tag) || tag === "br")
    ) {
      loose.push(node)
      continue
    }

    flushLoose()
    blocks.push(...readBlock(reader, node, depth))
  }

  flushLoose()

  return blocks
}

function readRaw(reader: Reader, node: RawWhole): DeckNode[] {
  if (!node.closed && node.name !== "script") {
    say(reader, node, "warning", `<${node.name}> has no </${node.name}>; it ends where the slide does.`)
  }

  switch (node.name) {
    case "svg":
      return readSvg(reader, node)
    case "script":
      say(reader, node, "warning", "<script> is dropped: a slide runs no scripts.")
      return []
    case "style":
      say(reader, node, "warning", "A <style> inside a slide is dropped: style each element inline.")
      return []
    default:
      return []
  }
}

function readBlock(reader: Reader, node: RawElement, depth: number): DeckNode[] {
  const tag = tagOf(node.name)

  switch (tag) {
    case "transparent":
      return readBlocks(reader, node.children, depth)

    case "dropped":
      say(reader, node, "warning", `<${node.name}> is dropped: it is not in the slide subset.`)
      return []

    case "unknown":
      say(reader, node, "warning", `<${node.name}> is not in the slide subset; what is inside it is kept.`)
      return readBlocks(reader, node.children, depth)
  }

  if (tag !== node.name) {
    say(reader, node, "note", `<${node.name}> is read as <${tag}>.`)
  }

  reader.elements += 1

  const attributes = readAttributes(reader, tag, node)
  const style = readStyle(reader, tag, node)

  switch (tag) {
    case "div":
      if (depth > 15) {
        say(
          reader,
          node,
          "warning",
          "Containers nest at most 15 deep; this one is flattened into its parent.",
        )
        return readBlocks(reader, node.children, depth)
      }

      return [element("div", attributes, style, readBlocks(reader, node.children, depth + 1))]

    case "h1":
    case "h2":
    case "h3":
    case "p":
      return [element(tag, attributes, style, readInline(reader, node.children))]

    case "ul":
    case "ol":
      return [element(tag, attributes, style, readItems(reader, node, "li"))]

    case "table":
      return [element("table", attributes, style, readItems(reader, node, "tr"))]

    case "img": {
      const src = attributes.src

      if (src === undefined || !isDeckImageSource(src)) {
        say(
          reader,
          node,
          "warning",
          src === undefined
            ? "<img> has no src; it is drawn as an empty box."
            : `<img src="${src.slice(0, 60)}"> is dropped: an image is one of the deck's assets or an https URL.`,
        )

        const { src: _, ...rest } = attributes

        return [element("img", rest, style, [])]
      }

      return [element("img", attributes, style, [])]
    }

    case "x-shape":
      if (
        attributes.kind === undefined ||
        !(DECK_SHAPE_KINDS as readonly string[]).includes(attributes.kind)
      ) {
        say(
          reader,
          node,
          "warning",
          `<x-shape kind="${attributes.kind ?? ""}"> is drawn as a rect: kinds are ${DECK_SHAPE_KINDS.join(", ")}.`,
        )
        return [element("x-shape", { ...attributes, kind: "rect" }, style, [])]
      }

      return [element("x-shape", attributes, style, [])]

    case "x-icon":
      if (attributes.name === undefined || deckIconBody(attributes.name) === undefined) {
        say(
          reader,
          node,
          "warning",
          `<x-icon name="${attributes.name ?? ""}"> is not an icon there is; it is dropped. See the icon list.`,
        )
        return []
      }

      return [element("x-icon", attributes, style, [])]

    case "x-connector":
    case "hr":
      return [element(tag, attributes, style, [])]

    case "li":
    case "tr":
    case "th":
    case "td":
      say(
        reader,
        node,
        "warning",
        `<${tag}> outside its ${tag === "li" ? "list" : "table"} is set as a paragraph.`,
      )
      return [element("p", {}, {}, readInline(reader, node.children))]

    default:
      // An inline tag reaches here only from a caller that already sorted
      // them out; kept for the type's sake.
      return [element("p", {}, {}, readInline(reader, [node]))]
  }
}

/** A list's items or a table's rows (and a row's cells): only the one child kind is kept. */
function readItems(reader: Reader, parent: RawElement, kind: "li" | "tr"): DeckNode[] {
  const items: DeckNode[] = []

  const visit = (nodes: readonly RawNode[]) => {
    for (const node of nodes) {
      if (node.kind === "text") {
        if (node.text.trim() !== "") {
          say(
            reader,
            node,
            "warning",
            `Text directly inside <${parent.name}> is dropped: put it in a <${kind === "li" ? "li" : "td"}>.`,
          )
        }
        continue
      }

      if (node.kind === "raw") {
        continue
      }

      if (TRANSPARENT.has(node.name)) {
        visit(node.children)
        continue
      }

      if (node.name !== kind) {
        say(
          reader,
          node,
          "warning",
          `<${node.name}> inside <${parent.name}> is dropped: it holds only <${kind}>.`,
        )
        continue
      }

      reader.elements += 1

      if (kind === "li") {
        items.push(
          element(
            "li",
            readAttributes(reader, "li", node),
            readStyle(reader, "li", node),
            readInline(reader, node.children),
          ),
        )
      } else {
        dropIdentity(reader, node)
        items.push(element("tr", {}, readStyle(reader, "tr", node), readCells(reader, node)))
      }
    }
  }

  visit(parent.children)

  return items
}

/** A row or a cell is not a thing to name or build in by itself: its table is. */
function dropIdentity(reader: Reader, node: RawElement) {
  for (const { name } of node.attributes) {
    if (GLOBAL_ATTRIBUTES.has(name)) {
      say(reader, node, "note", `<${node.name}> attribute \`${name}\` is dropped: give it to the <table>.`)
    }
  }
}

function readCells(reader: Reader, row: RawElement): DeckNode[] {
  return row.children.flatMap((node): DeckNode[] => {
    if (node.kind !== "element") {
      return []
    }

    if (node.name !== "td" && node.name !== "th") {
      say(reader, node, "warning", `<${node.name}> inside <tr> is dropped: a row holds <th> and <td>.`)
      return []
    }

    if (node.attributes.some((candidate) => candidate.name === "colspan" || candidate.name === "rowspan")) {
      say(reader, node, "warning", "colspan and rowspan are dropped: every cell is one cell.")
    }

    reader.elements += 1
    dropIdentity(reader, node)

    return [element(node.name, {}, readStyle(reader, node.name, node), readInline(reader, node.children))]
  })
}

/**
 * The inside of a block of text: runs of text, emphasis, links and coloured
 * spans, and breaks. A block inside text is read as its words; whitespace is
 * collapsed as a browser collapses it, so the tree says what is drawn.
 */
function readInline(reader: Reader, nodes: readonly RawNode[]): DeckNode[] {
  const runs = readInlineRuns(reader, nodes)
  const isBreak = (node: DeckNode | undefined) => node?.type === "element" && node.tag === "br"

  // A block's own edges are line edges already; a break there draws nothing.
  while (isBreak(runs[0])) {
    runs.shift()
  }

  while (isBreak(runs.at(-1))) {
    runs.pop()
  }

  return tidyInline(runs)
}

/** Blocks read inside text as their lines: a paragraph in an item, a list in an item, a `<div>` in a cell. */
const BLOCKS_IN_TEXT = new Set(["h1", "h2", "h3", "p", "div", "ul", "ol", "li", "table", "tr", "td", "th"])

function readInlineRuns(reader: Reader, nodes: readonly RawNode[]): DeckNode[] {
  const runs: DeckNode[] = []
  const lineBreak = () => {
    const last = runs.at(-1)

    if (last !== undefined && !(last.type === "element" && last.tag === "br")) {
      runs.push(element("br", {}, {}, []))
    }
  }

  for (const node of nodes) {
    const tag = node.kind === "element" ? tagOf(node.name) : undefined

    // A block inside text — a `<p>` in an `<li>`, a list in an item, a
    // `<div>` in a cell — is its words, on lines of their own.
    if (node.kind === "element" && typeof tag === "string" && BLOCKS_IN_TEXT.has(tag)) {
      if (!TEXT_BLOCKS.has(tag)) {
        say(reader, node, "note", `<${node.name}> inside text is set as lines of that text.`)
      }

      lineBreak()
      runs.push(...readInlineRuns(reader, node.children))
      lineBreak()
      continue
    }

    runs.push(...readInlineRun(reader, node))
  }

  return runs
}

function readInlineRun(reader: Reader, node: RawNode): DeckNode[] {
  if (node.kind === "text") {
    return [{ type: "text", text: node.text }]
  }

  if (node.kind === "raw") {
    if (node.name === "svg") {
      say(
        reader,
        node,
        "warning",
        "An <svg> inside text is dropped: place it beside the text, in the container.",
      )
    }
    return []
  }

  const tag = tagOf(node.name)

  if (tag === "br") {
    return [element("br", {}, {}, [])]
  }

  if (tag === "dropped") {
    say(reader, node, "warning", `<${node.name}> is dropped: it is not in the slide subset.`)
    return []
  }

  if (typeof tag === "string" && INLINE.has(tag)) {
    if (tag !== node.name && node.name !== "strong" && node.name !== "em") {
      say(reader, node, "note", `<${node.name}> is read as <${tag}>.`)
    }

    const attributes = readAttributes(reader, tag as DeckTag, node)

    if (tag === "a" && attributes.href !== undefined && !/^(https?:|mailto:|#)/.test(attributes.href)) {
      say(
        reader,
        node,
        "warning",
        `<a href="${attributes.href.slice(0, 60)}"> loses its link: links are https:, mailto: or #slide-id.`,
      )
      delete attributes.href
    }

    return [
      element(
        tag as DeckTag,
        attributes,
        readStyle(reader, tag, node),
        readInlineRuns(reader, node.children),
      ),
    ]
  }

  if (tag === "img" || tag === "x-icon" || tag === "x-shape") {
    say(
      reader,
      node,
      "warning",
      `<${node.name}> inside text is dropped: place it beside the text, in the container.`,
    )
    return []
  }

  if (tag === "unknown") {
    say(reader, node, "note", `<${node.name}> is not in the slide subset; its words are kept.`)
  }

  return readInlineRuns(reader, node.children)
}

/**
 * Inline runs as a browser draws them: whitespace collapsed to one space,
 * none at the start or end of the block or beside a break, empty runs and
 * empty wrappers gone, neighbouring text joined.
 */
export function tidyInline(nodes: readonly DeckNode[]): DeckNode[] {
  const collapsed = collapse(nodes)

  trimEdge(collapsed, "start")
  trimEdge(collapsed, "end")

  const pruned = prune(collapsed)

  // A break that ends the block draws nothing; one written there is a
  // paragraph's end read inside a list item or a cell.
  while (pruned.at(-1)?.type === "element" && (pruned.at(-1) as DeckElement).tag === "br") {
    pruned.pop()
  }

  return pruned
}

/**
 * Runs of whitespace as one space, across the edges of wrappers too: `line <b>
 * two</b>` draws one space, not two. `state.space` is whether the last thing
 * drawn was a space; a break resets it, since the next line starts fresh.
 */
function collapse(nodes: readonly DeckNode[], state = { space: true }): DeckNode[] {
  const out: DeckNode[] = []

  for (const node of nodes) {
    if (node.type === "text") {
      let text = node.text.replace(/[ \t\n\r\f]+/g, " ")

      if (state.space && text.startsWith(" ")) {
        text = text.slice(1)
      }

      if (text !== "") {
        state.space = text.endsWith(" ")
      }

      const last = out.at(-1)

      if (last?.type === "text") {
        out[out.length - 1] = { type: "text", text: last.text + text }
      } else {
        out.push({ type: "text", text })
      }
    } else if (node.type === "element") {
      if (node.tag === "br") {
        state.space = true
      }

      out.push({ ...node, children: collapse(node.children, state) })
    } else {
      out.push(node)
    }
  }

  return out
}

/** Drop the space at one edge of a run, looking into wrappers; and either side of each break. */
function trimEdge(nodes: DeckNode[], edge: "start" | "end") {
  const indices = edge === "start" ? nodes.keys() : [...nodes.keys()].reverse()

  for (const index of indices) {
    const node = nodes[index]!

    if (node.type === "text") {
      const text = edge === "start" ? node.text.replace(/^ /, "") : node.text.replace(/ $/, "")

      nodes[index] = { type: "text", text }

      if (text !== "") {
        break
      }
      continue
    }

    if (node.type === "element" && node.tag === "br") {
      break
    }

    if (node.type === "element") {
      const children = [...node.children]

      trimEdge(children, edge)
      nodes[index] = { ...node, children }

      if (children.some((child) => child.type !== "text" || child.text !== "")) {
        break
      }
    }
  }

  // Either side of a break, the line edge is a block edge too.
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index]!

    if (node.type === "element" && node.tag === "br") {
      const before = nodes[index - 1]
      const after = nodes[index + 1]

      if (before?.type === "text") {
        nodes[index - 1] = { type: "text", text: before.text.replace(/ $/, "") }
      }

      if (after?.type === "text") {
        nodes[index + 1] = { type: "text", text: after.text.replace(/^ /, "") }
      }
    }
  }
}

function prune(nodes: readonly DeckNode[]): DeckNode[] {
  return nodes.flatMap((node): DeckNode[] => {
    if (node.type === "text") {
      return node.text === "" ? [] : [node]
    }

    if (node.type === "element" && INLINE.has(node.tag)) {
      const children = prune(node.children)

      return children.length === 0 ? [] : [{ ...node, children }]
    }

    return [node]
  })
}

/**
 * What a drawing may not hold. Read against the markup with its character
 * references decoded, since `&#106;avascript:` is `javascript:` to the
 * browser. An attribute starts after a space, a `/` or a closing quote, which
 * is where HTML starts one too.
 */
const SVG_REFUSALS: readonly [RegExp, string][] = [
  [/<script\b/i, "holds a <script>"],
  [/[\s/"']on[a-z]+\s*=/i, "holds an event handler"],
  [/<foreignObject\b/i, "holds a <foreignObject>"],
  [/<style\b/i, "holds a <style>"],
  [/javascript:/i, "names javascript:"],
  [/(?:xlink:)?href\s*=\s*(?!["']?#)/i, "refers to something outside itself"],
  [/url\(\s*["']?(?!#)/i, "refers to something outside itself"],
  [/<(iframe|embed|object|video|audio|image)\b/i, "holds media"],
  [
    /<(?:set|animate\w*)\b[^>]*attributeName\s*=\s*["']?\s*(?:xlink:)?(?:href|on|style)/i,
    "animates a link, a handler or a style",
  ],
]

function svgRefusal(node: RawWhole) {
  if (node.attributes.some((candidate) => /^on/i.test(candidate.name))) {
    return "holds an event handler"
  }

  if (
    node.attributes.some((candidate) => /href$/i.test(candidate.name) && !candidate.value.startsWith("#"))
  ) {
    return "refers to something outside itself"
  }

  // Tabs and newlines inside a scheme are ignored by the browser, so they are here too.
  const markup = decodeEntities(node.inner)
  const unbroken = markup.replace(/[\t\n\r]/g, "")

  return SVG_REFUSALS.find(([pattern]) => pattern.test(markup) || pattern.test(unbroken))?.[1]
}

function readSvg(reader: Reader, node: RawWhole): DeckNode[] {
  const refusal = svgRefusal(node)

  if (refusal !== undefined) {
    say(
      reader,
      node,
      "warning",
      `An <svg> is dropped: it ${refusal}. A drawing holds shapes and its own #id references only.`,
    )
    return []
  }

  if (node.inner.length > MAX_SVG_BYTES) {
    say(
      reader,
      node,
      "warning",
      `An <svg> of ${node.inner.length} bytes is dropped: a drawing is at most ${MAX_SVG_BYTES} bytes.`,
    )
    return []
  }

  reader.elements += 1

  const attributes: Record<string, string> = {}

  for (const { name, value } of node.attributes) {
    if (name === "style" || name === "xmlns" || name.startsWith("xmlns:")) {
      continue
    }

    attributes[name] = value
  }

  if (attributes["aria-label"] === undefined) {
    say(
      reader,
      node,
      "note",
      "An <svg> without aria-label: say what it shows, for a reader who cannot see it.",
    )
  }

  return [{ type: "svg", attributes, style: readStyle(reader, "svg", node), markup: node.inner.trim() }]
}

function element(
  tag: DeckTag,
  attributes: Record<string, string>,
  style: DeckStyle,
  children: readonly DeckNode[],
): DeckElement {
  return { type: "element", tag, attributes, style, children }
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/** The order attributes are written in, so a tree always writes the same text. */
const ATTRIBUTE_ORDER = [
  "id",
  "kind",
  "name",
  "src",
  "alt",
  "href",
  "x1",
  "y1",
  "x2",
  "y2",
  "from",
  "head",
  "route",
  "data-crop",
  "data-build-in",
  "data-build-out",
]

function writeAttributes(attributes: Readonly<Record<string, string>>, style: DeckStyle) {
  const names = Object.keys(attributes).sort((a, b) => {
    const left = ATTRIBUTE_ORDER.indexOf(a)
    const right = ATTRIBUTE_ORDER.indexOf(b)

    return (left === -1 ? 99 : left) - (right === -1 ? 99 : right) || a.localeCompare(b)
  })
  const written = names.map((name) => ` ${name}="${escapeAttribute(attributes[name]!)}"`)
  const styleText = writeDeckStyle(style)

  return written.join("") + (styleText === "" ? "" : ` style="${escapeAttribute(styleText)}"`)
}

/** A run of inline nodes as one line of markup. */
export function writeInline(nodes: readonly DeckNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return escapeText(node.text)
      }

      if (node.type === "svg") {
        return ""
      }

      if (node.tag === "br") {
        return "<br>"
      }

      return `<${node.tag}${writeAttributes(node.attributes, node.style)}>${writeInline(node.children)}</${node.tag}>`
    })
    .join("")
}

const VOID_TAGS = new Set<DeckTag>(["img", "hr", "br"])

function writeNode(node: DeckNode, indent: string): string {
  if (node.type === "text") {
    return indent + escapeText(node.text)
  }

  if (node.type === "svg") {
    return `${indent}<svg${writeAttributes(node.attributes, node.style)}>${node.markup}</svg>`
  }

  const open = `${indent}<${node.tag}${writeAttributes(node.attributes, node.style)}>`

  if (VOID_TAGS.has(node.tag)) {
    return open
  }

  if (node.tag === "x-shape" || node.tag === "x-icon" || node.tag === "x-connector") {
    return `${open}</${node.tag}>`
  }

  // A block that holds blocks, items or rows: one child to a line, indented.
  if (
    node.tag === "div" ||
    node.tag === "ul" ||
    node.tag === "ol" ||
    node.tag === "table" ||
    node.tag === "tr"
  ) {
    if (node.children.length === 0) {
      return `${open}</${node.tag}>`
    }

    return [
      open,
      ...node.children.map((child) => writeNode(child, `${indent}  `)),
      `${indent}</${node.tag}>`,
    ].join("\n")
  }

  return `${open}${writeInline(node.children)}</${node.tag}>`
}

function writeSlide(slide: DeckSlide): string {
  const attributes: Record<string, string> = { id: slide.id }

  if (slide.transition !== undefined) {
    attributes["data-transition"] = slide.transition
  }

  if (slide.section !== undefined) {
    attributes["data-section"] = slide.section
  }

  const hidden = slide.hidden === true ? " hidden" : ""
  const notes = slide.notes.trim() === "" ? [] : [`<aside>${escapeText(slide.notes.trim())}</aside>`]

  return [
    `<section${writeAttributes(attributes, slide.style)}${hidden}>`,
    ...slide.children.map((child) => writeNode(child, "")),
    ...notes,
    "</section>",
  ].join("\n")
}

/** A deck as text: the same tree always writes the same text. */
export function writeDeck(deck: Deck): string {
  const faces = deck.fontFaces.map(
    (face) => `@font-face{font-family:"${face.family.replace(/["\\]/g, "")}";src:url(${face.src})}`,
  )

  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '<meta charset="utf-8">',
    `<title>${escapeText(deck.title)}</title>`,
    ...deck.fontLinks.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`),
    ...(faces.length === 0 ? [] : [`<style>${faces.join("")}</style>`]),
    "</head>",
    `<body${writeAttributes({}, deck.style)}>`,
    ...deck.slides.map(writeSlide),
    "</body>",
    "</html>",
    "",
  ].join("\n")
}

/** A slide alone, as the markup between its section's tags — what a reader copies and pastes. */
export function writeDeckNodes(nodes: readonly DeckNode[]) {
  return nodes.map((node) => writeNode(node, "")).join("\n")
}

/**
 * Markup pasted into a slide — copied from another deck, or from a model's
 * answer — as nodes, through the same reading a deck gets. What the subset
 * cannot hold is dropped, so a paste never puts into the tree what a write
 * could not.
 */
export function readDeckNodes(markup: string): DeckNode[] {
  const { deck } = readDeck(`<section id="paste">${markup}</section>`)

  return [...(deck.slides[0]?.children ?? [])]
}

// ---------------------------------------------------------------------------
// What the model is told
// ---------------------------------------------------------------------------

/** How many of a write's diagnostics the model is shown before the count. */
const SHOWN_DIAGNOSTICS = 24

/**
 * A deck's diagnostics as lines for the model that wrote it: what was dropped,
 * where, and what to write instead. Notes — what was only respelled — are
 * left out: the slide shows what was meant.
 */
export function describeDeckDiagnostics(diagnostics: readonly DeckDiagnostic[]): string[] {
  const warnings = diagnostics.filter((diagnostic) => diagnostic.severity === "warning")
  const lines = warnings
    .slice(0, SHOWN_DIAGNOSTICS)
    .map(
      (diagnostic) =>
        `${diagnostic.slide === undefined ? "" : `Slide ${diagnostic.slide}, `}line ${diagnostic.line}: ${diagnostic.message}`,
    )

  return warnings.length > SHOWN_DIAGNOSTICS
    ? [...lines, `…and ${warnings.length - SHOWN_DIAGNOSTICS} more like these.`]
    : lines
}

/** Every element of a tree, depth first, with its path — for the readers that walk all of them. */
export function* walkDeckNodes(
  nodes: readonly DeckNode[],
  path: readonly number[] = [],
): Generator<{ node: DeckNode; path: readonly number[] }> {
  for (const [index, node] of nodes.entries()) {
    const at = [...path, index]

    yield { node, path: at }

    if (node.type === "element") {
      yield* walkDeckNodes(node.children, at)
    }
  }
}

/** The plain words of some nodes, a break as a new line. */
export function deckNodesText(nodes: readonly DeckNode[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text") {
        return node.text
      }

      if (node.type === "svg") {
        return ""
      }

      if (node.tag === "br") {
        return "\n"
      }

      const inner = deckNodesText(node.children)

      return TEXT_BLOCKS.has(node.tag) || node.tag === "li" || node.tag === "div" || node.tag === "tr"
        ? `${inner}\n`
        : node.tag === "td" || node.tag === "th"
          ? `${inner}\t`
          : inner
    })
    .join("")
}

/** What a slide is called: its first heading's words, or its first line's. */
export function deckSlideTitle(slide: DeckSlide): string {
  for (const { node } of walkDeckNodes(slide.children)) {
    if (node.type === "element" && (node.tag === "h1" || node.tag === "h2")) {
      return deckNodesText(node.children).trim()
    }
  }

  return deckNodesText(slide.children).trim().split("\n")[0]?.trim() ?? ""
}

/** Whether a tag is a block of text: what the editor edits in place. */
export function isDeckTextBlock(tag: DeckTag) {
  return TEXT_BLOCKS.has(tag) || tag === "li" || tag === "th" || tag === "td"
}
