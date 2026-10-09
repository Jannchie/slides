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

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/**
 * The table a path is in, and the cell it is in when it is in one: from the
 * table's own path, a row's, a cell's or anything typed inside a cell.
 */
export function tableAt(
  nodes: readonly DeckNode[],
  path: DeckPath,
): { table: DeckPath; row?: number; column?: number } | undefined {
  for (let length = path.length; length > 0; length--) {
    const candidate = path.slice(0, length)

    if (elementAt(nodes, candidate)?.tag === "table") {
      return { table: candidate, row: path[length], column: path[length + 1] }
    }
  }

  return undefined
}

const isRow = (node: DeckNode): node is DeckElement => node.type === "element" && node.tag === "tr"
const isCell = (node: DeckNode): node is DeckElement =>
  node.type === "element" && (node.tag === "td" || node.tag === "th")
const isHeaderRow = (row: DeckElement) =>
  row.children.some(isCell) && row.children.filter(isCell).every((cell) => cell.tag === "th")

/** An empty cell shaped like `like`: its tag and style, none of its words or its id. */
function emptyCell(like: DeckElement, tag: "td" | "th" = like.tag as "td" | "th"): DeckElement {
  const { id: _id, ...attributes } = like.attributes

  return element(tag, like.style, [], attributes)
}

/**
 * A table with an empty row put in at `at`, its cells shaped like the body
 * row nearest it — a row added under the header is a body row, not a second
 * header.
 */
export function insertTableRow(table: DeckElement, at: number): DeckElement {
  const rows = table.children
  const index = Math.max(0, Math.min(at, rows.length))
  const near = [rows[index], rows[index - 1], ...rows].filter(
    (node): node is DeckElement => node !== undefined && isRow(node),
  )
  const template = near.find((row) => !isHeaderRow(row)) ?? near[0]

  if (template === undefined) {
    return table
  }

  const header = isHeaderRow(template)
  const { id: _id, ...attributes } = template.attributes
  const row = element(
    "tr",
    template.style,
    template.children
      .filter(isCell)
      .map((cell) => emptyCell(cell, header ? "td" : (cell.tag as "td" | "th"))),
    attributes,
  )

  return { ...table, children: [...rows.slice(0, index), row, ...rows.slice(index)] }
}

/** A table with an empty column put in at `at` in every row, each cell shaped like its row's neighbour. */
export function insertTableColumn(table: DeckElement, at: number): DeckElement {
  return {
    ...table,
    children: table.children.map((row) => {
      if (!isRow(row)) {
        return row
      }

      const index = Math.max(0, Math.min(at, row.children.length))
      const template = [row.children[index - 1], row.children[index], ...row.children].find(
        (node): node is DeckElement => node !== undefined && isCell(node),
      )

      return template === undefined
        ? row
        : {
            ...row,
            children: [...row.children.slice(0, index), emptyCell(template), ...row.children.slice(index)],
          }
    }),
  }
}

/** A table without its row at `index`; a table's last row is not taken. */
export function removeTableRow(table: DeckElement, index: number): DeckElement {
  return table.children.filter(isRow).length <= 1
    ? table
    : { ...table, children: table.children.filter((_, at) => at !== index) }
}

/** A table without the cell at `index` in each row; a table's last column is not taken. */
export function removeTableColumn(table: DeckElement, index: number): DeckElement {
  const columns = Math.max(
    0,
    ...table.children.filter(isRow).map((row) => row.children.filter(isCell).length),
  )

  return columns <= 1
    ? table
    : {
        ...table,
        children: table.children.map((row) =>
          isRow(row) ? { ...row, children: row.children.filter((_, at) => at !== index) } : row,
        ),
      }
}

export const TABLE_EDITS = [
  "rowAbove",
  "rowBelow",
  "columnLeft",
  "columnRight",
  "removeRow",
  "removeColumn",
] as const
export type TableEdit = (typeof TABLE_EDITS)[number]

/**
 * One edit to the table at or around `path`, and what should be selected
 * after it: the cell that was, where it has moved to, or the table when the
 * cell is gone. From the table itself, the edit works at its last row or
 * column. Nothing when `path` is in no table, or the edit would take its last
 * row or column.
 */
export function editTable(
  nodes: readonly DeckNode[],
  path: DeckPath,
  edit: TableEdit,
): { nodes: DeckNode[]; selection: DeckPath } | undefined {
  const found = tableAt(nodes, path)
  const table = found === undefined ? undefined : elementAt(nodes, found.table)

  if (found === undefined || table === undefined) {
    return undefined
  }

  const rows = table.children.filter(isRow)
  const lastRow = rows.length - 1
  const lastColumn = Math.max(0, ...rows.map((row) => row.children.filter(isCell).length)) - 1
  const row = found.row ?? lastRow
  const column = found.column ?? lastColumn
  const change: Record<TableEdit, () => [DeckElement, number, number] | undefined> = {
    rowAbove: () => [insertTableRow(table, row), 1, 0],
    rowBelow: () => [insertTableRow(table, row + 1), 0, 0],
    columnLeft: () => [insertTableColumn(table, column), 0, 1],
    columnRight: () => [insertTableColumn(table, column + 1), 0, 0],
    removeRow: () => (lastRow < 1 ? undefined : [removeTableRow(table, row), Number.NaN, 0]),
    removeColumn: () => (lastColumn < 1 ? undefined : [removeTableColumn(table, column), 0, Number.NaN]),
  }
  const result = change[edit]()

  if (result === undefined) {
    return undefined
  }

  const [next, down, right] = result
  const stays = found.row !== undefined && found.column !== undefined && !Number.isNaN(down + right)

  return {
    nodes: updateAt(nodes, found.table, () => next),
    selection: stays ? [...found.table, found.row! + down, found.column! + right] : found.table,
  }
}
