import { describe, expect, it } from "vitest"

import { textInset } from "./deck-export-pptx"

describe("a text box's inset", () => {
  it("is handed over in the order pptxgenjs writes it — left, right, bottom, top — in points", () => {
    // 8px above and below, 48px either side: about half a point to a canvas pixel.
    const close = (values: number[], expected: number[]) =>
      values.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 2))

    close(textInset(8, 48, 8, 48), [24, 24, 4, 4])
    close(textInset(1, 2, 3, 4), [2, 1, 1.5, 0.5])
  })
})
