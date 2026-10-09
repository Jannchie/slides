import { describe, expect, it } from "vitest"

import { readDeck, writeDeck, type DeckElement } from "./deck"

import {
  insertAt,
  editTable,
  insertTableColumn,
  insertTableRow,
  nodeAt,
  patchStyle,
  removeAt,
  removeTableColumn,
  removeTableRow,
  rotationOf,
  tableAt,
  updateAt,
  updateSlideChildren,
  withRotation,
} from "./deck-tree"

const slide = () =>
  readDeck('<section id="a"><h1>Title</h1><div><p>One</p><p>Two</p></div><p>Three</p></section>').deck
    .slides[0]!.children

describe("a slide's tree by path", () => {
  it("finds a node by its path", () => {
    expect((nodeAt(slide(), [1, 1]) as DeckElement).children).toEqual([{ type: "text", text: "Two" }])
  })

  it("replaces one node and leaves every other one the same object", () => {
    const before = slide()
    const after = updateAt(before, [1, 0], (node) => ({ ...(node as DeckElement), tag: "h2" }))

    expect((nodeAt(after, [1, 0]) as DeckElement).tag).toBe("h2")
    expect(after[0]).toBe(before[0])
    expect((after[1] as DeckElement).children[1]).toBe((before[1] as DeckElement).children[1])
  })

  it("removes several nodes, deepest and last first, and ignores one inside another removed", () => {
    const after = removeAt(slide(), [[1, 0], [2], [1]])

    expect(after).toHaveLength(1)
    expect((after[0] as DeckElement).tag).toBe("h1")
  })

  it("inserts among a container's children", () => {
    const after = insertAt(slide(), [1], 1, [
      { type: "element", tag: "hr", attributes: {}, style: {}, children: [] },
    ])

    expect((after[1] as DeckElement).children.map((node) => (node as DeckElement).tag)).toEqual([
      "p",
      "hr",
      "p",
    ])
  })
})

describe("styles the editor sets", () => {
  it("normalizes what it sets, refuses what the subset does not take, and removes what is cleared", () => {
    expect(
      patchStyle(
        "p",
        { color: "#111", margin: "0" },
        { "font-size": "24pt", "z-index": "3", color: undefined },
      ),
    ).toEqual({
      margin: "0",
      "font-size": "32px",
    })
  })

  it("sets a rotation in the transform's own order and reads it back", () => {
    const transform = withRotation("translateX(-50%) scale(1.2)", 15)

    expect(transform).toBe("translateX(-50%) rotate(15deg) scale(1.2)")
    expect(rotationOf({ transform: transform! })).toBe(15)
    expect(withRotation("rotate(15deg)", 0)).toBeUndefined()
  })
})

describe("tables", () => {
  const source = `<section id="s"><table style="width:900px">
<tr><th style="padding:16px">A</th><th style="padding:16px">B</th></tr>
<tr><td id="first" style="padding:12px">1</td><td style="padding:12px">2</td></tr>
</table></section>`
  const tableOf = () => {
    const node = readDeck(source).deck.slides[0]!.children[0]

    if (node?.type !== "element" || node.tag !== "table") {
      throw new Error("no table")
    }

    return node
  }
  const shape = (table: DeckElement) =>
    table.children.map((row) =>
      row.type === "element"
        ? row.children
            .map((cell) => (cell.type === "element" ? `${cell.tag}:${cell.children.length}` : "?"))
            .join(" ")
        : "?",
    )

  it("finds the table and the cell from anything inside it", () => {
    const nodes = readDeck(source).deck.slides[0]!.children

    expect(tableAt(nodes, [0])).toEqual({ table: [0], row: undefined, column: undefined })
    expect(tableAt(nodes, [0, 1, 1])).toEqual({ table: [0], row: 1, column: 1 })
    expect(tableAt(nodes, [0, 1, 1, 0])).toEqual({ table: [0], row: 1, column: 1 })
  })

  it("adds a row under the header as a body row, empty, shaped like its neighbour and without its id", () => {
    const table = insertTableRow(tableOf(), 1)

    expect(shape(table)).toEqual(["th:1 th:1", "td:0 td:0", "td:1 td:1"])
    const added = table.children[1]

    expect(
      added?.type === "element" && added.children[0]?.type === "element" && added.children[0].style,
    ).toEqual({
      padding: "12px",
    })
    expect(
      added?.type === "element" && added.children[0]?.type === "element" && added.children[0].attributes,
    ).toEqual({})
  })

  it("adds a column in every row, each cell like its row's", () => {
    expect(shape(insertTableColumn(tableOf(), 1))).toEqual(["th:1 th:0 th:1", "td:1 td:0 td:1"])
    expect(shape(insertTableColumn(tableOf(), 2))).toEqual(["th:1 th:1 th:0", "td:1 td:1 td:0"])
  })

  it("removes a row or a column, but never the last one", () => {
    expect(shape(removeTableRow(tableOf(), 0))).toEqual(["td:1 td:1"])
    expect(shape(removeTableColumn(tableOf(), 0))).toEqual(["th:1", "td:1"])
    expect(shape(removeTableRow(removeTableRow(tableOf(), 0), 0))).toEqual(["td:1 td:1"])
    expect(shape(removeTableColumn(removeTableColumn(tableOf(), 0), 0))).toEqual(["th:1", "td:1"])
  })

  it("writes an added row the subset reads back unchanged", () => {
    const deck = readDeck(source).deck
    const next = updateSlideChildren(deck, 0, (children) => [
      insertTableRow(tableOf(), 2),
      ...children.slice(1),
    ])
    const { deck: reread, diagnostics } = readDeck(writeDeck(next))

    expect(diagnostics).toEqual([])
    expect(writeDeck(reread)).toBe(writeDeck(next))
  })
})

describe("editing a table from a cell", () => {
  const nodes = () =>
    readDeck(`<section id="s"><table>
<tr><th>A</th><th>B</th></tr>
<tr><td>1</td><td>2</td></tr>
</table></section>`).deck.slides[0]!.children

  it("keeps the selection on the cell it was on, wherever the edit moved it", () => {
    expect(editTable(nodes(), [0, 1, 1], "rowAbove")?.selection).toEqual([0, 2, 1])
    expect(editTable(nodes(), [0, 1, 1], "rowBelow")?.selection).toEqual([0, 1, 1])
    expect(editTable(nodes(), [0, 1, 1], "columnLeft")?.selection).toEqual([0, 1, 2])
    expect(editTable(nodes(), [0, 1, 1], "columnRight")?.selection).toEqual([0, 1, 1])
  })

  it("hands the selection to the table when the cell goes", () => {
    expect(editTable(nodes(), [0, 1, 1], "removeRow")?.selection).toEqual([0])
    expect(editTable(nodes(), [0, 1, 1], "removeColumn")?.selection).toEqual([0])
  })

  it("works at the end from the table itself, and refuses outside a table", () => {
    const added = editTable(nodes(), [0], "rowBelow")!
    const table = added.nodes[0]

    expect(table?.type === "element" && table.children.length).toBe(3)
    expect(added.selection).toEqual([0])
    expect(
      editTable(readDeck('<section id="s"><p>x</p></section>').deck.slides[0]!.children, [0], "rowBelow"),
    ).toBeUndefined()
  })
})
