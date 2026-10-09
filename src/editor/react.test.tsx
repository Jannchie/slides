// @vitest-environment happy-dom
import { act, createRef } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it } from "vitest"

import { DeckEditor, type DeckEditorHandle } from "./react"

const deck = (title: string) =>
  `<!doctype html><html><head><title>${title}</title></head><body><section id="a"><h1>${title}</h1></section></body></html>`

const assets = { url: (src: string) => src, upload: async () => "assets/x.png" }

// React only treats an act() environment as one when told so.
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe("the React DeckEditor", () => {
  it("mounts the editor, follows a new source, and reads back through its ref", async () => {
    const element = document.createElement("div")
    const root = createRoot(element)
    const ref = createRef<DeckEditorHandle>()

    document.body.append(element)
    await act(async () => root.render(<DeckEditor ref={ref} source={deck("One")} assets={assets} />))
    expect(element.textContent).toContain("One")
    expect(ref.current?.write()).toBe(deck("One"))

    await act(async () => root.render(<DeckEditor ref={ref} source={deck("Two")} assets={assets} />))
    expect(element.textContent).toContain("Two")
    expect(ref.current?.write()).toBe(deck("Two"))

    await act(async () => root.unmount())
    expect(element.childElementCount).toBe(0)
  })
})
