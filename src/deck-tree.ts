import type { Deck, DeckElement, DeckNode, DeckSlide, DeckStyle } from "./deck"
import { normalizeDeckStyleValue } from "./deck-css"

/**
 * A slide's tree as the editor changes it: every change a new tree, nothing
 * mutated, so the history can keep each one and Vue sees each one.
 *
 * A node is named by its **path** — its index among the slide's children,
 * then among its parent's, and so on. A path is only good until the tree
 * changes shape above it, which is why the editor keeps its selection as paths
 * and re-derives them across every structural change it makes.
 */

export type DeckPath = readonly number[]

export function pathKey(path: DeckPath) {
  return path.join(".")
}

export function parsePathKey(key: string): DeckPath {
  return key === "" ? [] : key.split(".").map(Number)
}

export function samePath(a: DeckPath, b: DeckPath) {
  return a.length === b.length && a.every((index, at) => index === b[at])
}

/** Whether `ancestor` holds `path`, or is it. */
export function isWithin(path: DeckPath, ancestor: DeckPath) {
  return ancestor.length <= path.length && ancestor.every((index, at) => index === path[at])
}

export function parentOf(path: DeckPath): DeckPath {
  return path.slice(0, -1)
}

export function nodeAt(nodes: readonly DeckNode[], path: DeckPath): DeckNode | undefined {
  let current: DeckNode | undefined
  let children = nodes

  for (const index of path) {
    current = children[index]

    if (current === undefined) {
      return undefined
    }

    children = current.type === "element" ? current.children : []
  }

  return current
}

export function elementAt(nodes: readonly DeckNode[], path: DeckPath): DeckElement | undefined {
  const node = nodeAt(nodes, path)

  return node?.type === "element" ? node : undefined
}

/** The children a path names: the slide's for the empty path, else the element's. */
export function childrenAt(nodes: readonly DeckNode[], path: DeckPath): readonly DeckNode[] {
  if (path.length === 0) {
    return nodes
  }

  const node = nodeAt(nodes, path)

  return node?.type === "element" ? node.children : []
}

/** The tree with the node at `path` replaced by what `change` makes of it. */
export function updateAt(
  nodes: readonly DeckNode[],
  path: DeckPath,
  change: (node: DeckNode) => DeckNode,
): DeckNode[] {
  const [index, ...rest] = path

  if (index === undefined || nodes[index] === undefined) {
    return [...nodes]
  }

  const next = [...nodes]
  const node = nodes[index]!

  next[index] =
    rest.length === 0
      ? change(node)
      : node.type === "element"
        ? { ...node, children: updateAt(node.children, rest, change) }
        : node
  return next
}

/** The tree with the children at `path` replaced. */
export function updateChildrenAt(
  nodes: readonly DeckNode[],
  path: DeckPath,
  change: (children: readonly DeckNode[]) => DeckNode[],
): DeckNode[] {
  if (path.length === 0) {
    return change(nodes)
  }

  return updateAt(nodes, path, (node) =>
    node.type === "element" ? { ...node, children: change(node.children) } : node,
  )
}

/** Paths deepest and last first: the order removing them one by one leaves the rest valid in. */
function removalOrder(paths: readonly DeckPath[]) {
  return [...paths].sort((a, b) => {
    for (let at = 0; at < Math.min(a.length, b.length); at += 1) {
      if (a[at] !== b[at]) {
        return b[at]! - a[at]!
      }
    }

    return b.length - a.length
  })
}

/** The tree without the nodes at `paths`; a path inside another removed one is ignored. */
export function removeAt(nodes: readonly DeckNode[], paths: readonly DeckPath[]): DeckNode[] {
  const outermost = paths.filter(
    (path) => !paths.some((other) => other !== path && other.length < path.length && isWithin(path, other)),
  )
  let next = [...nodes]

  for (const path of removalOrder(outermost)) {
    const index = path.at(-1)!

    next = updateChildrenAt(next, parentOf(path), (children) => children.filter((_, at) => at !== index))
  }

  return next
}

/** The tree with `inserted` placed among the children at `parent`, from `index`. */
export function insertAt(
  nodes: readonly DeckNode[],
  parent: DeckPath,
  index: number,
  inserted: readonly DeckNode[],
): DeckNode[] {
  return updateChildrenAt(nodes, parent, (children) => [
    ...children.slice(0, index),
    ...inserted,
    ...children.slice(index),
  ])
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * A style with `patch` applied: a value sets a property, `undefined` removes
 * it. Every value is checked against the subset first and a refused one is
 * not set, so nothing the editor does puts into the tree what a write could
 * not. The order a property was first set in is kept, so a style written
 * back reads in the order a person would expect.
 */
export function patchStyle(
  tag: string,
  style: DeckStyle,
  patch: Readonly<Record<string, string | undefined>>,
): DeckStyle {
  const next: Record<string, string> = { ...style }

  for (const [property, value] of Object.entries(patch)) {
    if (value === undefined || value === "") {
      delete next[property]
      continue
    }

    const normalized = normalizeDeckStyleValue(tag, property, value)

    if (normalized !== undefined) {
      next[property] = normalized
    }
  }

  return next
}

export function patchNodeStyle(
  node: DeckNode,
  patch: Readonly<Record<string, string | undefined>>,
): DeckNode {
  if (node.type === "text") {
    return node
  }

  return { ...node, style: patchStyle(node.type === "svg" ? "svg" : node.tag, node.style, patch) }
}

export function setAttribute(node: DeckNode, name: string, value: string | undefined): DeckNode {
  if (node.type === "text") {
    return node
  }

  const attributes: Record<string, string> = { ...node.attributes }

  if (value === undefined) {
    delete attributes[name]
  } else {
    attributes[name] = value
  }

  return { ...node, attributes }
}

// ---------------------------------------------------------------------------
// Slides and decks
// ---------------------------------------------------------------------------

export function updateSlide(deck: Deck, index: number, change: (slide: DeckSlide) => DeckSlide): Deck {
  const slide = deck.slides[index]

  if (slide === undefined) {
    return deck
  }

  const slides = [...deck.slides]

  slides[index] = change(slide)
  return { ...deck, slides }
}

export function updateSlideChildren(
  deck: Deck,
  index: number,
  change: (children: readonly DeckNode[]) => DeckNode[],
): Deck {
  return updateSlide(deck, index, (slide) => ({ ...slide, children: change(slide.children) }))
}

/** The rotation a `transform` holds, in degrees. */
export function rotationOf(style: DeckStyle): number {
  const match = /rotate\((-?[\d.]+)(deg|turn|rad)\)/.exec(style.transform ?? "")

  if (match === null) {
    return 0
  }

  const value = Number(match[1])

  return match[2] === "turn" ? value * 360 : match[2] === "rad" ? (value * 180) / Math.PI : value
}

/** A `transform` with its rotation set to `degrees`, the rest of it kept in the order the subset writes it. */
export function withRotation(transform: string | undefined, degrees: number): string | undefined {
  const rounded = Math.round(degrees * 10) / 10
  const parts = (transform ?? "")
    .split(/\s+(?![^(]*\))/)
    .filter((part) => part !== "" && part !== "none" && !part.startsWith("rotate("))
  const translate = parts.filter((part) => part.startsWith("translate"))
  const rest = parts.filter((part) => !part.startsWith("translate"))
  const rotation = rounded === 0 || rounded === 360 ? [] : [`rotate(${rounded}deg)`]
  const written = [...translate, ...rotation, ...rest].join(" ")

  return written === "" ? undefined : written
}

/** A fresh element, built the way the subset reads one. */
export function element(
  tag: DeckElement["tag"],
  style: DeckStyle = {},
  children: readonly DeckNode[] = [],
  attributes: Record<string, string> = {},
): DeckElement {
  return { type: "element", tag, attributes, style, children }
}

export function text(value: string): DeckNode {
  return { type: "text", text: value }
}
