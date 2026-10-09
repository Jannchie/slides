import { describe, expect, it } from "vitest"

import { readDeck, type DeckElement } from "./deck"

import { insertAt, nodeAt, patchStyle, removeAt, rotationOf, updateAt, withRotation } from "./deck-tree"

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
