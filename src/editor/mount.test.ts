// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest"

import { mountDeckEditor, type DeckEditorHandle } from "./index"

const deck = (title: string) => `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
</head>
<body style="font-family:sans-serif;color:#1a1a1a">
<section id="cover" style="background:#fbfbf8;padding:128px">
<h1 style="font-size:120px">${title}</h1>
<aside>Open with the headline number.</aside>
</section>
<section id="plan" style="background:#ffffff;padding:128px">
<x-shape kind="ellipse" style="position:absolute;left:96px;top:96px;width:200px;height:200px;background:#2563eb"></x-shape>
</section>
</body>
</html>
`

const assets = { url: (src: string) => `/assets/${src}`, upload: async () => "assets/x.png" }

let mounted: DeckEditorHandle | undefined

afterEach(() => {
  mounted?.destroy()
  mounted = undefined
  document.body.innerHTML = ""
})

function mount(source: string, onChange = vi.fn()) {
  const element = document.createElement("div")

  document.body.append(element)
  mounted = mountDeckEditor(element, { source, assets, locale: "ja", onChange })

  return { element, handle: mounted, onChange }
}

describe("mountDeckEditor", () => {
  it("draws the deck and hands its source back untouched while nothing changed", async () => {
    const { element, handle } = mount(deck("Q3 review"))

    await Promise.resolve()

    expect(element.textContent).toContain("Q3 review")
    expect(handle.slideIndex()).toBe(0)
    expect(handle.slideTitle()).toBe("Q3 review")
    expect(handle.write()).toBe(deck("Q3 review"))
  })

  it("takes a new source in place", async () => {
    const { element, handle } = mount(deck("Q3 review"))

    handle.update({ source: deck("Q4 plan") })
    await Promise.resolve()

    expect(element.textContent).toContain("Q4 plan")
    expect(handle.write()).toBe(deck("Q4 plan"))
  })

  it("leaves nothing behind when destroyed", () => {
    const { element, handle } = mount(deck("Q3 review"))

    handle.destroy()
    mounted = undefined

    expect(element.childElementCount).toBe(0)
  })
})
