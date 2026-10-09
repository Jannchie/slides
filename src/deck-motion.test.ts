// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest"

import { DECK_MAGIC_MOVE_SOURCE } from "./deck-motion"

/** Two slides side by side in one box, as a presenter draws them during a transition. */
function stage(fromHtml: string, toHtml: string) {
  const host = document.createElement("div")

  host.innerHTML = `<div class="deck-root" style="--text:#111"><section class="deck-slide">${fromHtml}</section></div><div class="deck-root" style="--text:#111"><section class="deck-slide" style="color:#fafafa">${toHtml}</section></div>`
  document.body.append(host)

  const [from, to] = [...host.querySelectorAll<HTMLElement>("section.deck-slide")]

  return { host, from: from!, to: to! }
}

describe("a magic move, carried as source", () => {
  // happy-dom draws nothing, so the animation is only recorded.
  const animate = vi.fn()

  Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true })

  // The page's script builds the move from its source alone: nothing it uses may be outside it.
  const move = new Function(`return ${DECK_MAGIC_MOVE_SOURCE}`)() as (
    from: HTMLElement,
    to: HTMLElement,
    host: HTMLElement,
    duration?: number,
  ) => void

  it("moves, from its source alone, what both slides share — named or alike — on a layer of its own", () => {
    const { host, from, to } = stage(
      '<h1 id="title">Q3</h1><div class="deck-shape"><svg viewBox="0 0 100 100"><path d="M0 0"/></svg></div><p>Only here</p>',
      '<h2 id="title">Q3</h2><div class="deck-shape"><svg viewBox="0 0 100 100"><path d="M0 0"/></svg></div>',
    )

    animate.mockClear()
    move(from, to, host, 10)

    const layer = [...host.querySelectorAll<HTMLElement>("section.deck-slide")].find(
      (section) => section.style.background === "transparent",
    )

    expect(layer?.children.length).toBe(2)
    expect(animate).toHaveBeenCalledTimes(2)
    // The originals wait, hidden, while their copies move.
    expect(to.querySelector<HTMLElement>("#title")?.style.visibility).toBe("hidden")
    expect(from.querySelector("p")?.getAttribute("style") ?? "").not.toContain("hidden")
  })

  it("gives a copy the colour it took from its slide", () => {
    const { host, from, to } = stage('<h1 id="t">Q3</h1>', '<h2 id="t">Q3</h2>')

    move(from, to, host, 10)

    const copy = [...host.querySelectorAll<HTMLElement>("section.deck-slide")]
      .find((section) => section.style.background === "transparent")
      ?.querySelector("h2")

    expect(copy?.style.getPropertyValue("color")).toBe(getComputedStyle(to.querySelector("h2")!).color)
  })
})
