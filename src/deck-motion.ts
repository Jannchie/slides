/**
 * A magic move: what is on both slides — an element with the same `id` on
 * each — glides from where it was to where it is, while the rest of the two
 * slides cross-fade beneath it.
 *
 * The gliding copy is drawn on a layer of its own above both slides, at full
 * strength: inside the slide that is fading in, it would fade in with it and
 * read as one more dissolve. The two originals are hidden while it moves.
 *
 * Written to stand alone — no import, nothing from around it — so a page that
 * cannot import modules carries its source (`DECK_MAGIC_MOVE_SOURCE`) in its
 * own script, and the page and the editor's presenter move things the same way.
 *
 * Typed by what it touches rather than by the DOM's own types, and reaching the
 * browser's globals through `globalThis`: a server builds that page, and a
 * server's program has no DOM to type against.
 */

type MotionRect = { left: number; top: number; width: number; height: number }

type MotionStyle = {
  cssText: string
  visibility: string
  position: string
  left: string
  top: string
  width: string
  height: string
  margin: string
  boxSizing: string
  transformOrigin: string
  flex: string
  setProperty(name: string, value: string): void
}

type MotionElement = {
  id: string
  className: string
  tagName: string
  innerHTML: string
  textContent: string | null
  getAttribute(name: string): string | null
  contains(other: unknown): boolean
  style: MotionStyle
  getBoundingClientRect(): MotionRect
  querySelectorAll(selector: string): ArrayLike<unknown>
  closest(selector: string): unknown
  cloneNode(deep: boolean): unknown
  removeAttribute(name: string): void
  append(child: unknown): void
  remove(): void
  animate(keyframes: Record<string, string>[], options: Record<string, unknown>): unknown
}

type MotionGlobals = {
  document: { createElement(tag: string): MotionElement }
  matchMedia?: (query: string) => { matches: boolean }
  getComputedStyle(element: MotionElement): { opacity: string; getPropertyValue(name: string): string }
  setTimeout(run: () => void, delay: number): unknown
}

/**
 * @param from The slide being left, as drawn: its `.deck-slide`.
 * @param to The slide arriving, drawn at the same place.
 * @param host The box both slides are positioned in, at the slide's own 1920×1080.
 * @param duration How long the move takes, in milliseconds.
 */
export function deckMagicMove(
  from: MotionElement,
  to: MotionElement,
  host: MotionElement,
  duration = 600,
): void {
  const browser = globalThis as unknown as MotionGlobals
  // Inside the function, like everything it uses: its source travels alone.
  /** The text properties an element takes from around it: what a copy must be told it had. */
  const INHERITED = [
    "color",
    "font-family",
    "font-size",
    "font-weight",
    "font-style",
    "line-height",
    "letter-spacing",
    "text-align",
    "text-transform",
    "text-decoration-color",
  ]

  if (
    typeof browser.matchMedia === "function" &&
    browser.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return
  }

  const fromBox = from.getBoundingClientRect()
  const toBox = to.getBoundingClientRect()
  const scale = toBox.width / 1920 || 1
  const boxOf = (element: MotionElement, origin: MotionRect) => {
    const rect = element.getBoundingClientRect()

    return {
      x: (rect.left - origin.left) / scale,
      y: (rect.top - origin.top) / scale,
      w: rect.width / scale,
      h: rect.height / scale,
    }
  }
  // An id inside a drawing is the drawing's own (a marker, a gradient), not a slide element's.
  const named = (root: MotionElement) =>
    (Array.from(root.querySelectorAll("[id]")) as MotionElement[]).filter(
      (element) => element.closest("svg") === null,
    )
  // What a slide is made of: its blocks, shapes, pictures and drawings — not a
  // run of text inside one, nor the inside of a drawing. Outermost first.
  const partsOf = (root: MotionElement) =>
    (Array.from(root.querySelectorAll("h1,h2,h3,p,ul,ol,div,img,table,hr,svg")) as MotionElement[]).filter(
      (element) => {
        const drawing = element.closest("svg")

        return drawing === null || drawing === element
      },
    )
  // What makes two parts the same thing when nobody named them, the way a
  // presentation program matches them: the same kind of element drawn the same —
  // its words and their markup, a shape's kind and fill (which its drawing is),
  // a picture's source. Where it is and how big are what may differ.
  const looks = new Map<MotionElement, string>()
  const looksOf = (element: MotionElement) => {
    let look = looks.get(element)

    if (look === undefined) {
      look = `${element.tagName}|${element.getAttribute("class") ?? ""}|${element.getAttribute("src") ?? ""}|${element.innerHTML}`
      looks.set(element, look)
    }

    return look
  }

  const pairs: [MotionElement, MotionElement][] = []
  const takenFrom: MotionElement[] = []
  const takenTo: MotionElement[] = []
  // A part inside one that is already moving moves with it, not again on its own.
  const within = (element: MotionElement, taken: MotionElement[]) =>
    taken.some((other) => other === element || other.contains(element))
  const take = (source: MotionElement, target: MotionElement) => {
    pairs.push([source, target])
    takenFrom.push(source)
    takenTo.push(target)
  }

  // Named first: an id says which is which.
  const byId = new Map(named(from).map((element) => [element.id, element]))

  for (const target of named(to)) {
    const source = byId.get(target.id)

    if (source !== undefined && !within(target, takenTo) && !within(source, takenFrom)) {
      take(source, target)
    }
  }

  // Then by looks: of several alike, the one nearest where this one is.
  const fromParts = partsOf(from)

  for (const target of partsOf(to)) {
    if (within(target, takenTo)) {
      continue
    }

    const b = boxOf(target, toBox)
    let nearest: MotionElement | undefined
    let distance = Number.POSITIVE_INFINITY

    for (const source of fromParts) {
      if (within(source, takenFrom) || looksOf(source) !== looksOf(target)) {
        continue
      }

      const a = boxOf(source, fromBox)
      const apart = Math.hypot(a.x - b.x, a.y - b.y)

      if (apart < distance) {
        nearest = source
        distance = apart
      }
    }

    if (nearest !== undefined) {
      take(nearest, target)
    }
  }

  const root = to.closest(".deck-root") as MotionElement | null

  // The layer the copies move on: the arriving slide's own root and slide, so
  // they keep its type, its theme's colours and the subset's base sheet — with
  // nothing painted behind them.
  const layer = browser.document.createElement("div")

  layer.className = "deck-root"
  layer.style.cssText = `${root?.style.cssText ?? ""};position:absolute;left:0;top:0;width:1920px;height:1080px;pointer-events:none;z-index:10`

  const stage = browser.document.createElement("section")

  stage.className = "deck-slide"
  stage.style.cssText = "position:absolute;left:0;top:0;background:transparent;overflow:visible"
  layer.append(stage)

  const hidden: MotionElement[] = []

  for (const [source, target] of pairs) {
    const a = boxOf(source, fromBox)
    const b = boxOf(target, toBox)
    const copy = target.cloneNode(true) as MotionElement

    copy.removeAttribute("id")
    copy.style.position = "absolute"
    copy.style.left = `${b.x}px`
    copy.style.top = `${b.y}px`
    copy.style.width = `${b.w}px`
    copy.style.height = `${b.h}px`
    copy.style.margin = "0"
    copy.style.boxSizing = "border-box"
    copy.style.transformOrigin = "0 0"
    copy.style.flex = "none"

    // What it takes from the slide around it rather than says itself — a
    // heading's colour is often the section's — written onto the copy, which
    // moves on a layer that is no slide: otherwise it would change colour, or
    // face, for as long as it moves.
    const drawn = browser.getComputedStyle(target)

    for (const property of INHERITED) {
      copy.style.setProperty(property, drawn.getPropertyValue(property))
    }
    stage.append(copy)

    // Text keeps its shape: a heading is as wide as its column on both slides,
    // so only its height says how much its type grew, and scaling the two
    // ways apart would squash the letters. A shape or a picture takes its new
    // width and height each.
    const ratioY = a.h / (b.h || 1)
    const ratioX = (target.textContent ?? "").trim() === "" ? a.w / (b.w || 1) : ratioY

    copy.animate(
      [
        {
          transform: `translate(${a.x - b.x}px, ${a.y - b.y}px) scale(${ratioX}, ${ratioY})`,
          opacity: browser.getComputedStyle(source).opacity,
        },
        { transform: "none", opacity: browser.getComputedStyle(target).opacity },
      ],
      { duration, easing: "cubic-bezier(.4, 0, .2, 1)", fill: "both" },
    )
    hidden.push(source, target)
  }

  if (hidden.length === 0) {
    return
  }

  for (const element of hidden) {
    element.style.visibility = "hidden"
  }

  host.append(layer)
  browser.setTimeout(() => {
    layer.remove()

    for (const element of hidden) {
      element.style.visibility = ""
    }
  }, duration)
}

/** `deckMagicMove` as a function expression, for a page's own script: `const move = ${DECK_MAGIC_MOVE_SOURCE}`. */
export const DECK_MAGIC_MOVE_SOURCE = deckMagicMove.toString()
