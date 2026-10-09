import { tidyInline, type DeckNode } from "./deck"
import { normalizeDeckStyleValue, readDeckStyle } from "./deck-css"

import { element, text } from "./deck-tree"

/**
 * A block of a slide's text as the browser edits it, and back.
 *
 * Text is edited in place with `contenteditable` on the one element being
 * typed into. What a browser makes of typing, pasting and its own formatting
 * commands is whatever it likes — `<div>`s for new lines, `<font color>`,
 * `<span style="font-weight: 700">`, a stray `<br>` at the end — so it is read
 * back through `readInlineDom` on every input, which keeps only what the
 * subset's inline runs can say: bold, italic, underline, strike, links,
 * styled spans and breaks, each carrying whatever styles the subset allows a
 * run (`readDeckStyle`, the same reader the model's text goes through). The
 * tree never holds more than that, and the DOM the editor builds to start
 * from (`buildInlineDom`) holds nothing else.
 */

/** Inline nodes as DOM, for an element about to be edited. */
export function buildInlineDom(nodes: readonly DeckNode[], document: Document): DocumentFragment {
  const fragment = document.createDocumentFragment()

  for (const node of nodes) {
    if (node.type === "text") {
      fragment.append(document.createTextNode(node.text))
      continue
    }

    if (node.type === "svg") {
      continue
    }

    if (node.tag === "br") {
      fragment.append(document.createElement("br"))
      continue
    }

    const created = document.createElement(node.tag)

    for (const [property, value] of Object.entries(node.style)) {
      created.style.setProperty(property, value)
    }

    if (node.tag === "a" && node.attributes.href !== undefined) {
      created.setAttribute("href", node.attributes.href)
    }

    created.append(buildInlineDom(node.children, document))
    fragment.append(created)
  }

  return fragment
}

const LINK = /^(https?:|mailto:|#)/

/** What an element being edited holds, as the subset's inline runs. */
export function readInlineDom(root: Node): DeckNode[] {
  return tidyInline(readChildren(root))
}

function readChildren(parent: Node): DeckNode[] {
  const out: DeckNode[] = []

  for (const child of parent.childNodes) {
    out.push(...readNode(child, out))
  }

  return out
}

function readNode(node: Node, before: readonly DeckNode[]): DeckNode[] {
  if (node.nodeType === Node.TEXT_NODE) {
    // A browser keeps a typed space visible as a no-break space; a lone one
    // is an ordinary space to the slide. A run of them was meant.
    return [text((node.textContent ?? "").replace(/(?<! ) (?! )/g, " "))]
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return []
  }

  const source = node as HTMLElement
  const tag = source.localName
  const inner = () => readChildren(source)

  switch (tag) {
    case "br":
      return [element("br")]

    case "b":
    case "strong":
      return wrap("b", inner(), runStyle(source))

    case "i":
    case "em":
      return wrap("i", inner(), runStyle(source))

    case "u":
    case "ins":
      return wrap("u", inner(), runStyle(source))

    case "s":
    case "strike":
    case "del":
      return wrap("s", inner(), runStyle(source))

    case "a": {
      const href = source.getAttribute("href") ?? ""

      return LINK.test(href) ? wrap("a", inner(), runStyle(source), { href }) : inner()
    }

    case "span":
    case "font":
      return readStyled(source, inner())

    case "div":
    case "p":
    case "li":
    case "h1":
    case "h2":
    case "h3":
    case "h4": {
      // A browser makes a new line a block of its own: read as a break before it.
      const last = before.at(-1)
      const breaks = before.length > 0 && !(last?.type === "element" && last.tag === "br")

      return [...(breaks ? [element("br")] : []), ...readStyled(source, inner())]
    }

    case "script":
    case "style":
    case "img":
    case "svg":
      return []

    default:
      return inner()
  }
}

function wrap(
  tag: "b" | "i" | "u" | "s" | "a" | "span",
  children: DeckNode[],
  style: Record<string, string> = {},
  attributes: Record<string, string> = {},
): DeckNode[] {
  return children.length === 0 ? [] : [element(tag, style, children, attributes)]
}

/**
 * The styles an element says that a run may carry, read the way the model's
 * text is read. A browser's own formatting commands write `background-color`
 * for a highlight, which a run says as `background`.
 */
export function runStyle(source: Element): Record<string, string> {
  const written = (source.getAttribute("style") ?? "").replace(
    /(^|;)\s*background-color\s*:/gi,
    "$1background:",
  )
  const kept: Record<string, string> = {}

  for (const read of readDeckStyle("span", written)) {
    if ("value" in read && read.value !== "transparent" && read.value !== "rgba(0, 0, 0, 0)") {
      kept[read.property] = read.value
    }
  }

  return kept
}

/**
 * What a span or a `<font>` meant: emphasis it spelled as a style is read as
 * the element for it, any other style the subset allows a run stays on a span,
 * anything else is gone.
 */
function readStyled(source: HTMLElement, children: DeckNode[]): DeckNode[] {
  let nodes = children
  const kept = runStyle(source)
  const fontColor = source.localName === "font" ? source.getAttribute("color") : null

  if (fontColor !== null && kept.color === undefined) {
    const normalized = normalizeDeckStyleValue("span", "color", fontColor)

    if (normalized !== undefined) {
      kept.color = normalized
    }
  }

  // Bold, italic and a plain underline or strike are the elements for them;
  // a weight that is not bold, or a decoration with a style or colour, stays a style.
  const bold = kept["font-weight"] === "bold" || kept["font-weight"] === "700"
  const italic = kept["font-style"] === "italic"
  const decoration = kept["text-decoration"]
  const underline = decoration === "underline"
  const strike = decoration === "line-through"

  if (bold) {
    delete kept["font-weight"]
  }

  if (italic) {
    delete kept["font-style"]
  }

  if (underline || strike) {
    delete kept["text-decoration"]
  }

  if (Object.keys(kept).length > 0) {
    nodes = wrap("span", nodes, kept)
  }

  if (bold) {
    nodes = wrap("b", nodes)
  }

  if (italic) {
    nodes = wrap("i", nodes)
  }

  if (underline) {
    nodes = wrap("u", nodes)
  }

  if (strike) {
    nodes = wrap("s", nodes)
  }

  return nodes
}
