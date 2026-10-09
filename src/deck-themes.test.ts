import { describe, expect, it } from "vitest"

import { readDeck, writeDeck } from "./deck"
import { readDeckStyle } from "./deck-css"
import { deckRootStyle } from "./deck-render"
import {
  DECK_THEMES,
  MINIMAL_DARK,
  MINIMAL_LIGHT,
  deckThemeStyle,
  findDeckTheme,
  resolveDeckColor,
  themeRoleOf,
  type DeckTheme,
} from "./deck-themes"

const deck = (body: string, slide = '<section id="a"><p>x</p></section>') =>
  `<!doctype html><html><head><title>T</title></head><body ${body}>${slide}</body></html>`

const values = (tag: string, style: string) =>
  Object.fromEntries(
    readDeckStyle(tag, style).flatMap((read) => ("value" in read ? [[read.property, read.value]] : [])),
  )

describe("a deck's theme", () => {
  it("is named on the body, and written back there", () => {
    const { deck: read, diagnostics } = readDeck(deck('data-theme="minimal-dark"'))

    expect(read.theme).toBe("minimal-dark")
    expect(diagnostics).toEqual([])
    expect(writeDeck(read)).toContain('<body data-theme="minimal-dark">')
    expect(readDeck(writeDeck(read)).deck.theme).toBe("minimal-dark")
  })

  it("is absent when the deck names none, and a name that is not an id is refused", () => {
    expect(readDeck(deck("")).deck.theme).toBeUndefined()

    const odd = readDeck(deck('data-theme="Bad Theme!"'))

    expect(odd.deck.theme).toBeUndefined()
    expect(odd.diagnostics.some((diagnostic) => diagnostic.message.includes("data-theme"))).toBe(true)
  })
})

describe("theme colours in a style", () => {
  it("are read wherever a colour is: text, fill, border and gradient stops", () => {
    expect(values("p", "color: var(--accent)")).toEqual({ color: "var(--accent)" })
    expect(values("div", "background: var(--surface)")).toEqual({ background: "var(--surface)" })
    expect(values("div", "border: 2px solid var(--line)")).toMatchObject({ border: "2px solid var(--line)" })
    expect(values("div", "background: linear-gradient(90deg, var(--accent), var(--background))")).toEqual({
      background: "linear-gradient(90deg, var(--accent), var(--background))",
    })
  })

  it("are written one way however they were spelled", () => {
    expect(values("p", "color: VAR( --Accent )")).toEqual({ color: "var(--accent)" })
  })

  it("are the only var() the subset reads", () => {
    expect(values("p", "color: var(--brand)")).toEqual({})
    expect(values("p", "font-size: var(--size)")).toEqual({})
    expect(values("div", "background: linear-gradient(90deg, var(--accent), var(--brand))")).toEqual({})
  })

  it("leave every other colour as it was written", () => {
    expect(values("p", "color: rgb(255, 0, 0)")).toEqual({ color: "rgb(255, 0, 0)" })
  })
})

describe("drawing a theme", () => {
  const custom: DeckTheme = {
    id: "brand",
    name: "Brand",
    colors: { ...MINIMAL_LIGHT.colors, accent: "#e11d48" },
  }

  it("finds the theme a deck names, among the ones it is offered", () => {
    expect(findDeckTheme("minimal-dark")).toBe(MINIMAL_DARK)
    expect(findDeckTheme("brand", [...DECK_THEMES, custom])).toBe(custom)
  })

  it("falls back to the first theme for none, or for one nobody offers", () => {
    expect(findDeckTheme(undefined)).toBe(MINIMAL_LIGHT)
    expect(findDeckTheme("brand")).toBe(MINIMAL_LIGHT)
    expect(findDeckTheme("nope", [custom])).toBe(custom)
  })

  it("sets every role on the box the slides sit in, under the deck's own defaults", () => {
    expect(deckThemeStyle(MINIMAL_DARK)).toMatchObject({ "--background": "#0a0a0b", "--text": "#f4f4f5" })

    const root = deckRootStyle({ "font-family": "Inter" }, MINIMAL_DARK)

    expect(root).toContain("--background:#0a0a0b")
    expect(root.indexOf("--background")).toBeLessThan(root.indexOf("font-family"))
  })

  it("resolves a reference to its colour, and leaves a written colour alone", () => {
    expect(themeRoleOf("var(--muted)")).toBe("muted")
    expect(resolveDeckColor("var(--accent)", custom)).toBe("#e11d48")
    expect(resolveDeckColor("#123456", custom)).toBe("#123456")
  })
})
