import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

import { readDeck } from "../src"

describe("the playground's deck", () => {
  it("is entirely inside the subset, so what it shows is what it says", () => {
    const { deck, diagnostics } = readDeck(
      readFileSync(new URL("./sample-deck.html", import.meta.url), "utf8"),
    )

    expect(diagnostics).toEqual([])
    expect(deck.slides).toHaveLength(4)
  })
})
