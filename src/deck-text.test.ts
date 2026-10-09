import { describe, expect, it } from "vitest"

import { runStyle } from "./deck-text"

const styled = (style: string) =>
  ({ getAttribute: (name: string) => (name === "style" ? style : null) }) as Element

describe("runStyle", () => {
  it("keeps every style the subset allows a run, not just colours", () => {
    expect(
      runStyle(
        styled("font-size: 48px; font-family: Inter, sans-serif; opacity: 0.5; color: rgb(255, 0, 0)"),
      ),
    ).toEqual({
      "font-size": "48px",
      "font-family": "Inter, sans-serif",
      opacity: "0.5",
      color: "rgb(255, 0, 0)",
    })
  })

  it("keeps a weight that is not bold", () => {
    expect(runStyle(styled("font-weight: 500"))).toEqual({ "font-weight": "500" })
  })

  it("reads a browser's highlight as a run's background", () => {
    expect(runStyle(styled("background-color: rgb(255, 255, 0)"))).toEqual({ background: "rgb(255, 255, 0)" })
  })

  it("drops what a run may not say, and an invisible background", () => {
    expect(runStyle(styled("position: absolute; background-color: transparent"))).toEqual({})
  })
})
