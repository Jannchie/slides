import { DECK_HEIGHT, DECK_WIDTH } from "./deck"

/**
 * Where things are on a slide, in the canvas's own pixels — 1920 across,
 * whatever the stage is scaled to — and the arithmetic of moving, sizing,
 * rotating and snapping them.
 *
 * A box is the element as laid out, before any rotation: its centre is where
 * the browser drew it, its size is its layout size, and `rotation` turns it
 * about that centre, which is what `transform: rotate()` does.
 */

export type Rect = { x: number; y: number; w: number; h: number }
export type Box = Rect & { rotation: number }
export type Point = { x: number; y: number }

/** An edge or centre a selection can be lined up along. */
export type DeckAlignment = "left" | "centre" | "right" | "top" | "middle" | "bottom"

/** The 128px the format suggests for a slide's margins: the lines a box most often wants to sit on. */
export const DECK_MARGIN = 128

/**
 * The linear part of a computed `transform` — what turns and scales, not what
 * moves — as `[a, b, c, d]`: a point (x, y) goes to (a·x + c·y, b·x + d·y).
 * `none`, or anything unreadable, is the identity.
 */
export type Linear = readonly [number, number, number, number]

export const IDENTITY: Linear = [1, 0, 0, 1]

export function linearOf(transform: string): Linear {
  const match = /^matrix(3d)?\((.*)\)$/.exec(transform.trim())

  if (match === null) {
    return IDENTITY
  }

  const values = match[2]!.split(",").map(Number)
  // matrix3d is column-major: its 2D part is m11, m12, m21, m22.
  const [a, b, c, d] = match[1] === "3d" ? [values[0], values[1], values[4], values[5]] : values

  return [a, b, c, d].every((value) => Number.isFinite(value))
    ? ([a, b, c, d] as unknown as Linear)
    : IDENTITY
}

/** `outer` applied after `inner`: an ancestor's transform around its descendant's. */
export function composeLinear(outer: Linear, inner: Linear): Linear {
  const [a1, b1, c1, d1] = outer
  const [a2, b2, c2, d2] = inner

  return [a1 * a2 + c1 * b2, b1 * a2 + d1 * b2, a1 * c2 + c1 * d2, b1 * c2 + d1 * d2]
}

/** How far a transform turns (degrees, clockwise, as `rotate()` writes it) and how much it scales each axis. */
export function turnAndScale(linear: Linear) {
  const [a, b, c, d] = linear

  return {
    rotation: Math.round(((Math.atan2(b, a) * 180) / Math.PI) * 100) / 100,
    scaleX: Math.hypot(a, b),
    scaleY: Math.hypot(c, d),
  }
}

/**
 * The box an element is drawn as, from what the browser can say of it: the
 * box around its corners on screen (`bounds`, already in canvas pixels), its
 * layout size, and the transform it is drawn under. An affine map keeps a
 * rectangle's centre at the centre of the box around it, so the centre is the
 * bounds'; the size is the layout size scaled; the turn is the transform's.
 * Nothing turned, the bounds are the box.
 */
export function drawnBox(bounds: Rect, layout: { w: number; h: number }, linear: Linear): Box {
  const { rotation, scaleX, scaleY } = turnAndScale(linear)

  if (Math.abs(rotation) < 0.01) {
    return { ...bounds, rotation: 0 }
  }

  const centre = centreOf(bounds)
  const w = layout.w * scaleX
  const h = layout.h * scaleY

  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h, rotation }
}

function boundsFrom(element: Element, origin: { left: number; top: number }, scale: number): Rect {
  const bounds = element.getBoundingClientRect()

  return {
    x: (bounds.left - origin.left) / scale,
    y: (bounds.top - origin.top) / scale,
    w: bounds.width / scale,
    h: bounds.height / scale,
  }
}

/**
 * An element's box on the canvas, measured from the slide's own top-left
 * corner (`origin`, on screen), with `rotation` the element's own turn. The
 * size includes the element's own scale, so `rotate(-4deg) scale(1.1)` is
 * measured at the size it is drawn.
 */
export function measureBox(
  element: Element,
  origin: { left: number; top: number },
  scale: number,
  rotation: number,
): Box {
  const bounds = boundsFrom(element, origin, scale)

  if (rotation === 0 || !(element instanceof HTMLElement)) {
    return { ...bounds, rotation: 0 }
  }

  const { scaleX, scaleY } = turnAndScale(linearOf(getComputedStyle(element).transform))
  const centre = centreOf(bounds)
  const w = element.offsetWidth * scaleX
  const h = element.offsetHeight * scaleY

  return { x: centre.x - w / 2, y: centre.y - h / 2, w, h, rotation }
}

/**
 * An element's box as it is drawn on the slide, every turn and scale between
 * it and `slide` included: a paragraph inside a turned card is turned with it.
 * What a file that has no nesting of transforms — a PowerPoint slide — needs
 * to place each element on its own.
 */
export function measureDrawnBox(
  element: Element,
  slide: Element,
  origin: { left: number; top: number },
): Box {
  const bounds = boundsFrom(element, origin, 1)

  if (!(element instanceof HTMLElement)) {
    return { ...bounds, rotation: 0 }
  }

  let linear = IDENTITY

  for (
    let current: Element | null = element;
    current !== null && current !== slide;
    current = current.parentElement
  ) {
    linear = composeLinear(linearOf(getComputedStyle(current).transform), linear)
  }

  return drawnBox(bounds, { w: element.offsetWidth, h: element.offsetHeight }, linear)
}

/**
 * A box made `extra` wider on the side its text runs away from: a line set
 * from the left grows to the right, one set from the right grows to the left,
 * a centred one grows both ways. Through the box's turn, so a turned box keeps
 * its anchored edge where it was.
 */
export function widenBox(box: Box, extra: number, anchor: "start" | "centre" | "end"): Box {
  const w = box.w + extra
  const along = anchor === "start" ? extra / 2 : anchor === "end" ? -extra / 2 : 0
  const shift = rotate({ x: along, y: 0 }, box.rotation)
  const centre = centreOf(box)

  return {
    x: centre.x + shift.x - w / 2,
    y: centre.y + shift.y - box.h / 2,
    w,
    h: box.h,
    rotation: box.rotation,
  }
}

export function centreOf(box: Rect): Point {
  return { x: box.x + box.w / 2, y: box.y + box.h / 2 }
}

/** The box around some boxes, rotation ignored. */
export function boundsOf(boxes: readonly Rect[]): Rect {
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.w))
  const bottom = Math.max(...boxes.map((box) => box.y + box.h))

  return { x: left, y: top, w: right - left, h: bottom - top }
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h
}

function rotate(point: Point, degrees: number): Point {
  const radians = (degrees * Math.PI) / 180
  const cos = Math.cos(radians)
  const sin = Math.sin(radians)

  return { x: point.x * cos - point.y * sin, y: point.x * sin + point.y * cos }
}

/**
 * A box resized by dragging one of its handles. `handle` is which one, as
 * -1, 0 or 1 across and down (`[1, 1]` is the bottom-right corner); `delta`
 * is how far the pointer went, on the canvas. The handle opposite the one
 * dragged stays put — through any rotation, which is why the drag is first
 * turned into the box's own frame. `keepRatio` keeps the proportions (a
 * corner only); `fromCentre` grows both sides at once.
 */
export function resizeBox(
  start: Box,
  handle: readonly [number, number],
  delta: Point,
  options: { keepRatio?: boolean; fromCentre?: boolean; min?: number } = {},
): Box {
  const [hx, hy] = handle
  const local = rotate(delta, -start.rotation)
  const grow = options.fromCentre ? 2 : 1
  const min = options.min ?? 8
  let w = Math.max(min, start.w + hx * local.x * grow)
  let h = Math.max(min, start.h + hy * local.y * grow)

  if (options.keepRatio && hx !== 0 && hy !== 0) {
    const scale = Math.max(w / start.w, h / start.h)

    w = Math.max(min, start.w * scale)
    h = Math.max(min, start.h * scale)
  } else if (options.keepRatio && (hx === 0 || hy === 0)) {
    // An edge with the ratio kept grows the other side in step.
    if (hx === 0) {
      w = Math.max(min, start.w * (h / start.h))
    } else {
      h = Math.max(min, start.h * (w / start.w))
    }
  }

  const centre = centreOf(start)

  if (options.fromCentre) {
    return { x: centre.x - w / 2, y: centre.y - h / 2, w, h, rotation: start.rotation }
  }

  // The opposite handle's place on the canvas, which must not move.
  const anchor = rotate({ x: (-hx * start.w) / 2, y: (-hy * start.h) / 2 }, start.rotation)
  const fixed = { x: centre.x + anchor.x, y: centre.y + anchor.y }
  const reach = rotate({ x: (hx * w) / 2, y: (hy * h) / 2 }, start.rotation)
  // The new centre: an edge handle has no reach across, so the other axis
  // stays centred where it was.
  const next = { x: fixed.x + reach.x, y: fixed.y + reach.y }

  return { x: next.x - w / 2, y: next.y - h / 2, w, h, rotation: start.rotation }
}

/** The angle from a box's centre to a point, as `rotate()` measures it: 0 straight up, clockwise. */
export function angleTo(centre: Point, point: Point) {
  return (Math.atan2(point.x - centre.x, -(point.y - centre.y)) * 180) / Math.PI
}

// ---------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------

/** A line a box may snap to, and what drew it: the slide, its margins, or another element. */
export type SnapLines = { xs: number[]; ys: number[] }

export type Guide = { axis: "x" | "y"; at: number }

/** The slide's own lines: its edges, its centre and its margins. */
export function slideLines(): SnapLines {
  return {
    xs: [0, DECK_MARGIN, DECK_WIDTH / 2, DECK_WIDTH - DECK_MARGIN, DECK_WIDTH],
    ys: [0, DECK_MARGIN, DECK_HEIGHT / 2, DECK_HEIGHT - DECK_MARGIN, DECK_HEIGHT],
  }
}

/** Every edge and centre of `boxes`, to snap to. */
export function linesOf(boxes: readonly Rect[]): SnapLines {
  return {
    xs: boxes.flatMap((box) => [box.x, box.x + box.w / 2, box.x + box.w]),
    ys: boxes.flatMap((box) => [box.y, box.y + box.h / 2, box.y + box.h]),
  }
}

export function joinLines(...sets: SnapLines[]): SnapLines {
  return { xs: sets.flatMap((set) => set.xs), ys: sets.flatMap((set) => set.ys) }
}

/** The nearest line to any of `own` within `threshold`, and how far to move to meet it. */
function nearest(own: readonly number[], lines: readonly number[], threshold: number) {
  let best: { offset: number; at: number } | undefined

  for (const value of own) {
    for (const line of lines) {
      const offset = line - value

      if (Math.abs(offset) <= threshold && (best === undefined || Math.abs(offset) < Math.abs(best.offset))) {
        best = { offset, at: line }
      }
    }
  }

  return best
}

/**
 * How far to shift a moving box so its nearest edge or centre meets a line,
 * on each axis independently, and the guides to draw where it did.
 */
export function snapRect(
  box: Rect,
  lines: SnapLines,
  threshold: number,
): { dx: number; dy: number; guides: Guide[] } {
  const x = nearest([box.x, box.x + box.w / 2, box.x + box.w], lines.xs, threshold)
  const y = nearest([box.y, box.y + box.h / 2, box.y + box.h], lines.ys, threshold)

  return {
    dx: x?.offset ?? 0,
    dy: y?.offset ?? 0,
    guides: [
      ...(x === undefined ? [] : [{ axis: "x" as const, at: x.at }]),
      ...(y === undefined ? [] : [{ axis: "y" as const, at: y.at }]),
    ],
  }
}

/** A point snapped to the nearest line on each axis. */
export function snapPoint(
  point: Point,
  lines: SnapLines,
  threshold: number,
): { point: Point; guides: Guide[] } {
  const x = nearest([point.x], lines.xs, threshold)
  const y = nearest([point.y], lines.ys, threshold)

  return {
    point: { x: point.x + (x?.offset ?? 0), y: point.y + (y?.offset ?? 0) },
    guides: [
      ...(x === undefined ? [] : [{ axis: "x" as const, at: x.at }]),
      ...(y === undefined ? [] : [{ axis: "y" as const, at: y.at }]),
    ],
  }
}

/**
 * The moving edges of a box being resized snapped to lines: only the sides
 * the handle moves, and only for a box that is not turned, whose edges are
 * the lines it is drawn with.
 */
export function snapResize(
  box: Box,
  handle: readonly [number, number],
  lines: SnapLines,
  threshold: number,
): { box: Box; guides: Guide[] } {
  if (box.rotation !== 0) {
    return { box, guides: [] }
  }

  const [hx, hy] = handle
  const guides: Guide[] = []
  let { x, y, w, h } = box

  if (hx !== 0) {
    const edge = hx > 0 ? x + w : x
    const snapped = nearest([edge], lines.xs, threshold)

    if (snapped !== undefined) {
      guides.push({ axis: "x", at: snapped.at })
      if (hx > 0) {
        w += snapped.offset
      } else {
        x += snapped.offset
        w -= snapped.offset
      }
    }
  }

  if (hy !== 0) {
    const edge = hy > 0 ? y + h : y
    const snapped = nearest([edge], lines.ys, threshold)

    if (snapped !== undefined) {
      guides.push({ axis: "y", at: snapped.at })
      if (hy > 0) {
        h += snapped.offset
      } else {
        y += snapped.offset
        h -= snapped.offset
      }
    }
  }

  return { box: { x, y, w, h, rotation: 0 }, guides }
}

/** Round to the pixel a style is written in. */
export function px(value: number) {
  return `${Math.round(value)}px`
}
