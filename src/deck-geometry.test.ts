import { describe, expect, it } from "vitest"

import {
  angleTo,
  composeLinear,
  drawnBox,
  linearOf,
  resizeBox,
  slideLines,
  snapRect,
  snapResize,
  widenBox,
  type Box,
} from "./deck-geometry"

const BOX: Box = { x: 100, y: 100, w: 200, h: 100, rotation: 0 }

describe("resizing a box", () => {
  it("keeps the opposite corner where it was", () => {
    expect(resizeBox(BOX, [1, 1], { x: 50, y: 20 })).toEqual({ x: 100, y: 100, w: 250, h: 120, rotation: 0 })
    expect(resizeBox(BOX, [-1, -1], { x: 50, y: 20 })).toEqual({ x: 150, y: 120, w: 150, h: 80, rotation: 0 })
  })

  it("moves only the edge an edge handle holds", () => {
    expect(resizeBox(BOX, [0, 1], { x: 999, y: 40 })).toEqual({ x: 100, y: 100, w: 200, h: 140, rotation: 0 })
  })

  it("keeps the proportions when asked, and grows from the centre", () => {
    const kept = resizeBox(BOX, [1, 1], { x: 200, y: 0 }, { keepRatio: true })

    expect(kept.w / kept.h).toBeCloseTo(2)
    expect(resizeBox(BOX, [1, 0], { x: 10, y: 0 }, { fromCentre: true })).toEqual({
      x: 90,
      y: 100,
      w: 220,
      h: 100,
      rotation: 0,
    })
  })

  it("keeps the anchor fixed through a rotation", () => {
    const turned: Box = { ...BOX, rotation: 90 }
    // Turned a quarter, the box's own right is the canvas's down.
    const resized = resizeBox(turned, [1, 0], { x: 0, y: 40 })

    expect(resized.w).toBeCloseTo(240)
    expect(resized.h).toBeCloseTo(100)
    // Its left edge, now at the top, did not move: the centre went down by half the growth.
    expect(resized.y + resized.h / 2).toBeCloseTo(150 + 20)
    expect(resized.x + resized.w / 2).toBeCloseTo(200)
  })

  it("never goes below the smallest size", () => {
    expect(resizeBox(BOX, [1, 1], { x: -1000, y: -1000 }).w).toBe(8)
  })
})

describe("snapping", () => {
  it("snaps the nearest edge or centre to a line, and says where", () => {
    const snapped = snapRect({ x: 862, y: 300, w: 200, h: 100 }, slideLines(), 6)

    // Its centre, at 962, meets the slide's at 960.
    expect(snapped.dx).toBe(-2)
    expect(snapped.guides).toEqual([{ axis: "x", at: 960 }])
  })

  it("snaps only the edges a resize moves", () => {
    const { box, guides } = snapResize(
      { x: 130, y: 300, w: 1658, h: 100, rotation: 0 },
      [1, 0],
      slideLines(),
      6,
    )

    expect(box.x).toBe(130)
    expect(box.w).toBe(1662)
    expect(guides).toEqual([{ axis: "x", at: 1792 }])
  })
})

describe("angles", () => {
  it("measures clockwise from straight up, as rotate() does", () => {
    expect(angleTo({ x: 0, y: 0 }, { x: 0, y: -10 })).toBeCloseTo(0)
    expect(angleTo({ x: 0, y: 0 }, { x: 10, y: 0 })).toBeCloseTo(90)
  })
})

describe("what a transform does", () => {
  const turn = (degrees: number, scale = 1) => {
    const radians = (degrees * Math.PI) / 180
    const [cos, sin] = [Math.cos(radians) * scale, Math.sin(radians) * scale]

    return `matrix(${cos}, ${sin}, ${-sin}, ${cos}, 12, 34)`
  }

  it("reads a computed matrix, a 3D one, and none", () => {
    expect(linearOf("none")).toEqual([1, 0, 0, 1])
    expect(linearOf("matrix(2, 0, 0, 3, 10, 20)")).toEqual([2, 0, 0, 3])
    expect(linearOf("matrix3d(2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 10, 20, 0, 1)")).toEqual([2, 0, 0, 3])
  })

  it("adds a parent's turn to its child's", () => {
    const [a, b] = composeLinear(linearOf(turn(-8)), linearOf(turn(3)))

    expect((Math.atan2(b, a) * 180) / Math.PI).toBeCloseTo(-5)
  })

  it("measures a turned and scaled element at the size it is drawn", () => {
    const box = drawnBox({ x: 90, y: 40, w: 220, h: 120 }, { w: 200, h: 100 }, linearOf(turn(-4, 1.1)))

    expect(box.rotation).toBeCloseTo(-4)
    expect(box.w).toBeCloseTo(220)
    expect(box.h).toBeCloseTo(110)
    // Centred where its bounds are.
    expect(box.x + box.w / 2).toBeCloseTo(200)
    expect(box.y + box.h / 2).toBeCloseTo(100)
  })

  it("takes an unturned element's bounds as they are, scale included", () => {
    const scaled = linearOf("matrix(1.1, 0, 0, 1.1, 0, 0)")

    expect(drawnBox({ x: 1, y: 2, w: 330, h: 44 }, { w: 300, h: 40 }, scaled)).toEqual({
      x: 1,
      y: 2,
      w: 330,
      h: 44,
      rotation: 0,
    })
  })
})

describe("widening a text box", () => {
  const box: Box = { x: 100, y: 50, w: 1000, h: 80, rotation: 0 }

  it("grows away from the side the text is set from", () => {
    expect(widenBox(box, 40, "start")).toMatchObject({ x: 100, w: 1040 })
    expect(widenBox(box, 40, "end")).toMatchObject({ x: 60, w: 1040 })
    expect(widenBox(box, 40, "centre")).toMatchObject({ x: 80, w: 1040 })
  })

  it("keeps a turned box's anchored edge where it was", () => {
    const turned = widenBox({ ...box, rotation: 90 }, 40, "start")

    // Turned a quarter, the box's own right is the canvas's down: it grows downwards.
    expect(turned.x + turned.w / 2).toBeCloseTo(600)
    expect(turned.y + turned.h / 2).toBeCloseTo(90 + 20)
  })
})
