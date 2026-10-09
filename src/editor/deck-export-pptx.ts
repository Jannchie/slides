import { createApp, h, nextTick } from "vue"

import {
  DECK_HEIGHT,
  DECK_WIDTH,
  pathKey,
  readPixels,
  splitTop,
  strokeOf,
  type Deck,
  type DeckElement,
  type DeckNode,
  type DeckPath,
  type DeckSlide,
} from "../index"
import { firstFamily, loadDeckFonts, measureDrawnBox, widenBox, type Box } from "../dom"

import DeckSlideView from "./components/DeckSlideView"

/**
 * A deck as a PowerPoint file, made in the browser from the slides as the
 * browser lays them out.
 *
 * Every slide is drawn off screen at its full 1920×1080, by the same renderer
 * the stage uses, and read back element by element: where flexbox put each
 * box, where each line of text is, which typeface and colour each run is in.
 * Those become PowerPoint's own objects — text boxes with runs, shapes,
 * tables, pictures and lines — at the measured places, so the file opens as
 * slides to edit rather than pictures of slides.
 *
 * What PowerPoint has no object for is drawn into a picture of that element
 * alone: a gradient, a drawing, an icon, a cropped photo. Everything else on
 * the slide stays editable.
 */

/** The canvas's pixels to PowerPoint's inches: 1920 px across a 13.333 in slide. */
const PX_PER_INCH = DECK_WIDTH / 13.333

const inch = (px: number) => px / PX_PER_INCH
/**
 * The canvas's pixels to points, on the same scale: 72 to the inch, so a
 * canvas pixel is half a point. Not CSS's 0.75 — the canvas is not the
 * screen's 96 to the inch, and text set at that would come out half as large
 * again as the slide drew it.
 */
const points = (px: number) => (px * 72) / PX_PER_INCH

type PptxModule = typeof import("pptxgenjs")
type Pptx = InstanceType<PptxModule["default"]>
type PptxSlide = ReturnType<Pptx["addSlide"]>
type TextRun = { text: string; options?: Record<string, unknown> }

/**
 * The file, and the pictures that could not go into it: a picture from
 * another site that does not let a page read it back cannot be drawn into the
 * file, and the reader is told which rather than finding a gap.
 */
export type DeckPptxExport = { blob: Blob; skipped: string[] }

export async function exportDeckPptx(
  deck: Deck,
  title: string,
  resolveAsset: (src: string) => string,
): Promise<DeckPptxExport> {
  const { default: PptxGenJS } = await import("pptxgenjs")
  const pptx = new PptxGenJS()

  pptx.defineLayout({ name: "DECK", width: inch(DECK_WIDTH), height: inch(DECK_HEIGHT) })
  pptx.layout = "DECK"
  pptx.title = title

  const mounted = await mountOffscreen(deck, resolveAsset)
  const skipped = new Set<string>()

  try {
    for (const [index, source] of deck.slides.entries()) {
      const section = mounted.sections[index]

      if (section === undefined) {
        continue
      }

      const slide = pptx.addSlide()

      if (source.hidden === true) {
        slide.hidden = true
      }

      const context: Context = { slide, section, origin: section.getBoundingClientRect(), source, skipped }

      await paintBackground(context)
      await exportNodes(context, source.children, [])

      if (source.notes.trim() !== "") {
        slide.addNotes(source.notes)
      }
    }
  } finally {
    mounted.dispose()
  }

  const blob = (await pptx.write({ outputType: "blob", compression: true })) as Blob

  return { blob, skipped: [...skipped] }
}

// ---------------------------------------------------------------------------
// Drawing off screen
// ---------------------------------------------------------------------------

/** How long the measuring waits for the deck's faces before it goes on with what has arrived. */
const FONT_WAIT_MS = 8000

/**
 * Wait for the faces the slides are set in. Asked after layout, for each
 * family, weight and style an element with text is set in: `fonts.ready` alone
 * settles before a face nobody has laid text out in has even been requested,
 * and text measured in the fallback face is measured at the wrong width.
 */
async function waitForFaces(host: HTMLElement) {
  if (document.fonts === undefined) {
    return
  }

  const wanted = new Set<string>()

  for (const element of host.querySelectorAll<HTMLElement>("*")) {
    if (
      ![...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim())
    ) {
      continue
    }

    const style = getComputedStyle(element)
    const family = firstFamily(style.fontFamily)

    if (family !== undefined && family !== "") {
      wanted.add(`${style.fontStyle} ${style.fontWeight} 16px ${JSON.stringify(family)}`)
    }
  }

  const loads = Promise.all([...wanted].map((font) => document.fonts.load(font).catch(() => [])))

  await Promise.race([loads, new Promise((resolve) => setTimeout(resolve, FONT_WAIT_MS))])
  await document.fonts.ready
}

async function mountOffscreen(deck: Deck, resolveAsset: (src: string) => string) {
  // The faces the deck names, in this document: an export from the gallery
  // has no editor open to have loaded them.
  await loadDeckFonts(deck, resolveAsset)

  const host = document.createElement("div")

  host.setAttribute("aria-hidden", "true")
  Object.assign(host.style, {
    position: "fixed",
    left: "-30000px",
    top: "0",
    width: `${DECK_WIDTH}px`,
    pointerEvents: "none",
  })
  document.body.append(host)

  const app = createApp(() =>
    h(
      "div",
      deck.slides.map((slide) =>
        h("div", { style: { width: `${DECK_WIDTH}px`, height: `${DECK_HEIGHT}px` } }, [
          h(DeckSlideView, { slide, deckStyle: deck.style, resolveAsset, interactive: true }),
        ]),
      ),
    ),
  )

  app.mount(host)
  await nextTick()
  await waitForFaces(host)
  await Promise.all([...host.querySelectorAll("img")].map((image) => image.decode().catch(() => undefined)))

  return {
    sections: [...host.querySelectorAll<HTMLElement>(".deck-slide")],
    dispose() {
      app.unmount()
      host.remove()
    },
  }
}

type Context = {
  slide: PptxSlide
  section: HTMLElement
  origin: DOMRect
  source: DeckSlide
  /** The pictures that could not be drawn into the file, by where they came from. */
  skipped: Set<string>
}

function elementAt(context: Context, path: DeckPath) {
  return context.section.querySelector<HTMLElement>(`[data-deck-path="${pathKey(path)}"]`) ?? undefined
}

/**
 * An element's place on the slide before any rotation, and the rotation —
 * its own and every ancestor's: PowerPoint has no group to turn, so a
 * paragraph inside a turned card is placed turned.
 */
function boxOf(context: Context, element: Element): Box {
  return measureDrawnBox(element, context.section, context.origin)
}

function place(box: Box) {
  return {
    x: inch(box.x),
    y: inch(box.y),
    w: inch(Math.max(box.w, 1)),
    h: inch(Math.max(box.h, 1)),
    ...(box.rotation === 0 ? {} : { rotate: box.rotation }),
  }
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

/** A computed colour as PowerPoint's hex and transparency, or nothing for a colour that draws nothing. */
function colourOf(value: string, opacity = 1): { color: string; transparency?: number } | undefined {
  const match = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)/.exec(value)

  if (match === null) {
    return undefined
  }

  const alpha =
    (match[4] === undefined
      ? 1
      : match[4].endsWith("%")
        ? Number.parseFloat(match[4]) / 100
        : Number(match[4])) * opacity

  if (alpha <= 0.01) {
    return undefined
  }

  const hex = match
    .slice(1, 4)
    .map((part) => Math.round(Number(part)).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase()

  return { color: hex, ...(alpha < 0.99 ? { transparency: Math.round((1 - alpha) * 100) } : {}) }
}

/** The opacity an element is drawn at, its ancestors' included, up to the slide. */
function opacityOf(element: Element, section: HTMLElement) {
  let opacity = 1

  for (
    let current: Element | null = element;
    current !== null && current !== section.parentElement;
    current = current.parentElement
  ) {
    opacity *= Number(getComputedStyle(current).opacity || 1)
  }

  return opacity
}

/** A picture of `element` placed at `box`, as see-through as the element is drawn. */
function addPicture(context: Context, element: Element, data: string, box: Box) {
  const opacity = opacityOf(element, context.section)

  context.slide.addImage({
    data,
    ...place(box),
    ...(opacity < 0.99 ? { transparency: Math.round((1 - opacity) * 100) } : {}),
  })
}

/** A colour the subset wrote (hex, rgb(), a name), as the browser computes it. */
function computeColour(value: string): string {
  const probe = document.createElement("span")

  probe.style.color = value
  document.body.append(probe)

  const computed = getComputedStyle(probe).color

  probe.remove()
  return computed
}

// ---------------------------------------------------------------------------
// Pictures: what PowerPoint has no object for
// ---------------------------------------------------------------------------

const PICTURE_SCALE = 2

function canvasFor(box: Box) {
  const canvas = document.createElement("canvas")
  const scale = Math.min(PICTURE_SCALE, 3840 / Math.max(box.w, box.h, 1))

  canvas.width = Math.max(1, Math.round(box.w * scale))
  canvas.height = Math.max(1, Math.round(box.h * scale))

  const context = canvas.getContext("2d")!

  context.scale(scale, scale)
  return { canvas, context }
}

/** A rounded rectangle path, for clipping a picture to its element's corners. */
function roundedPath(context: CanvasRenderingContext2D, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2)

  context.beginPath()
  context.roundRect(0, 0, width, height, r)
}

/** A CSS gradient painted onto a canvas of `width` × `height`. */
function paintGradient(context: CanvasRenderingContext2D, value: string, width: number, height: number) {
  const match = /^(repeating-)?(linear|radial)-gradient\((.*)\)/s.exec(value.trim())

  if (match === null) {
    return false
  }

  const parts = splitTop(match[3]!, ",")
  let angle = 180
  let centre = { x: 0.5, y: 0.5 }
  const first = parts[0] ?? ""
  const stops = [...parts]

  if (match[2] === "linear") {
    const degrees = /^(-?[\d.]+)(deg|turn|rad)$/.exec(first)
    const side = /^to\s+(.+)$/.exec(first)

    if (degrees !== null) {
      angle =
        degrees[2] === "turn"
          ? Number(degrees[1]) * 360
          : degrees[2] === "rad"
            ? (Number(degrees[1]) * 180) / Math.PI
            : Number(degrees[1])
      stops.shift()
    } else if (side !== null) {
      const words = side[1]!.split(/\s+/)
      const x = words.includes("right") ? 1 : words.includes("left") ? -1 : 0
      const y = words.includes("bottom") ? 1 : words.includes("top") ? -1 : 0

      angle = (Math.atan2(x, -y) * 180) / Math.PI
      stops.shift()
    }
  } else if (!/^#|^rgb|^hsl|^[a-z]+$/.test(first) || /\bat\b|circle|ellipse/.test(first)) {
    const at = /at\s+([\d.]+)%\s+([\d.]+)%/.exec(first)

    if (at !== null) {
      centre = { x: Number(at[1]) / 100, y: Number(at[2]) / 100 }
    }

    stops.shift()
  }

  let gradient: CanvasGradient

  if (match[2] === "linear") {
    const radians = (angle * Math.PI) / 180
    const dx = Math.sin(radians)
    const dy = -Math.cos(radians)
    const half = (Math.abs(width * dx) + Math.abs(height * dy)) / 2

    gradient = context.createLinearGradient(
      width / 2 - dx * half,
      height / 2 - dy * half,
      width / 2 + dx * half,
      height / 2 + dy * half,
    )
  } else {
    const cx = centre.x * width
    const cy = centre.y * height
    const radius = Math.max(
      Math.hypot(cx, cy),
      Math.hypot(width - cx, cy),
      Math.hypot(cx, height - cy),
      Math.hypot(width - cx, height - cy),
    )

    gradient = context.createRadialGradient(cx, cy, 0, cx, cy, radius)
  }

  stops.forEach((stop, index) => {
    const [colour, position] = splitTop(stop, " ")
    const offset = position?.endsWith("%")
      ? Number.parseFloat(position) / 100
      : index / Math.max(stops.length - 1, 1)

    try {
      gradient.addColorStop(Math.min(Math.max(offset, 0), 1), computeColour(colour ?? "#000"))
    } catch {
      // A stop the canvas cannot read is left out rather than failing the picture.
    }
  })

  context.fillStyle = gradient
  context.fillRect(0, 0, width, height)
  return true
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()

    image.crossOrigin = "anonymous"
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`The picture ${src.slice(0, 60)} could not be loaded.`))
    image.src = src
  })
}

/** A picture drawn into its box as `object-fit` draws it, clipped to its corners. */
async function pictureOf(
  src: string,
  box: Box,
  fit: string,
  radius: number,
  position = "50% 50%",
): Promise<string | undefined> {
  try {
    const image = await loadImage(src)
    const { canvas, context } = canvasFor(box)
    const naturalWidth = image.naturalWidth || box.w
    const naturalHeight = image.naturalHeight || box.h
    const scale =
      fit === "contain"
        ? Math.min(box.w / naturalWidth, box.h / naturalHeight)
        : fit === "fill"
          ? 1
          : Math.max(box.w / naturalWidth, box.h / naturalHeight)
    const width = fit === "fill" ? box.w : naturalWidth * scale
    const height = fit === "fill" ? box.h : naturalHeight * scale
    const [px, py] = position
      .split(/\s+/)
      .map((part) => (part.endsWith("%") ? Number.parseFloat(part) / 100 : 0.5))

    if (radius > 0) {
      roundedPath(context, box.w, box.h, radius)
      context.clip()
    }

    context.drawImage(image, (box.w - width) * (px ?? 0.5), (box.h - height) * (py ?? 0.5), width, height)
    return canvas.toDataURL("image/png")
  } catch {
    return undefined
  }
}

/** An SVG document drawn into its box. */
async function svgPicture(markup: string, box: Box) {
  return pictureOf(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`, box, "contain", 0)
}

async function gradientPicture(value: string, box: Box, radius: number) {
  const { canvas, context } = canvasFor(box)

  if (radius > 0) {
    roundedPath(context, box.w, box.h, radius)
    context.clip()
  }

  // A gradient with square corners covers its box, and a JPEG of a smooth
  // field is a hundredth of the PNG; one with corners needs the transparency.
  return paintGradient(context, value, box.w, box.h)
    ? canvas.toDataURL(radius > 0 ? "image/png" : "image/jpeg", 0.92)
    : undefined
}

// ---------------------------------------------------------------------------
// Boxes: fills, strokes, corners and shadows
// ---------------------------------------------------------------------------

function radiusOf(style: CSSStyleDeclaration, box: Box) {
  const value = Number.parseFloat(style.borderTopLeftRadius)

  if (style.borderTopLeftRadius.endsWith("%")) {
    return (Math.min(box.w, box.h) * value) / 100
  }

  return Number.isFinite(value) ? value : 0
}

/** One side of a box's stroke, as a PowerPoint line. */
function strokeLine(widthValue: string, styleValue: string, colourValue: string, opacity: number) {
  const width = Number.parseFloat(widthValue)

  if (!Number.isFinite(width) || width <= 0 || styleValue === "none") {
    return undefined
  }

  const colour = colourOf(colourValue, opacity)

  return colour === undefined
    ? undefined
    : {
        ...colour,
        width: points(width),
        ...(styleValue === "dashed"
          ? { dashType: "dash" as const }
          : styleValue === "dotted"
            ? { dashType: "sysDot" as const }
            : {}),
      }
}

function lineOf(style: CSSStyleDeclaration, opacity: number) {
  return strokeLine(style.borderTopWidth, style.borderTopStyle, style.borderTopColor, opacity)
}

/** The first of an element's shadows, as PowerPoint draws one. */
function shadowOf(style: CSSStyleDeclaration) {
  if (style.boxShadow === "none" || style.boxShadow === "") {
    return undefined
  }

  const [first] = splitTop(style.boxShadow, ",")

  if (first === undefined || first.includes("inset")) {
    return undefined
  }

  const colour = /rgba?\([^)]*\)/.exec(first)?.[0]
  const lengths = first
    .replace(/rgba?\([^)]*\)/, "")
    .trim()
    .split(/\s+/)
    .map((part) => readPixels(part) ?? 0)
  const [x = 0, y = 0, blur = 0] = lengths
  const parsed = colour === undefined ? undefined : colourOf(colour)

  if (parsed === undefined) {
    return undefined
  }

  return {
    type: "outer" as const,
    color: parsed.color,
    opacity: 1 - (parsed.transparency ?? 0) / 100,
    blur: Math.min(points(blur), 100),
    offset: Math.min(points(Math.hypot(x, y)), 200),
    angle: Math.round(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360),
  }
}

/** Whether an element's background is drawn only through its text: `background-clip: text`. */
function clipsText(style: CSSStyleDeclaration) {
  return (
    style.backgroundClip === "text" || style.getPropertyValue("-webkit-background-clip").trim() === "text"
  )
}

/**
 * The colour a gradient starts with: what text filled with that gradient is
 * written in, since a run in PowerPoint is one colour.
 */
function firstStopColour(value: string): string | undefined {
  const match = /gradient\((.*)\)/s.exec(value)

  for (const part of match === null ? [] : splitTop(match[1]!, ",")) {
    const colour = splitTop(part.trim(), " ")[0]

    if (colour !== undefined && CSS.supports("color", colour)) {
      return computeColour(colour)
    }
  }

  return undefined
}

/**
 * What a run of text is drawn in. Text whose fill is see-through shows the
 * background of the element that clips its background to the text — a
 * gradient heading — and is written in that gradient's first colour.
 */
function textColourOf(parent: Element, block: HTMLElement, style: CSSStyleDeclaration) {
  const fill = style.getPropertyValue("-webkit-text-fill-color").trim()

  if (fill === "" || colourOf(fill) !== undefined) {
    return fill === "" ? style.color : fill
  }

  for (let current: Element | null = parent; current !== null; current = current.parentElement) {
    const own = getComputedStyle(current)

    if (clipsText(own)) {
      return firstStopColour(own.backgroundImage) ?? own.color
    }

    if (current === block) {
      break
    }
  }

  return style.color
}

/** Whether an element paints anything of its own: a fill, a stroke or a shadow. */
function paints(style: CSSStyleDeclaration) {
  if (clipsText(style)) {
    return (
      (Number.parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none") ||
      (style.boxShadow !== "none" && style.boxShadow !== "")
    )
  }

  return (
    colourOf(style.backgroundColor) !== undefined ||
    style.backgroundImage !== "none" ||
    (Number.parseFloat(style.borderTopWidth) > 0 && style.borderTopStyle !== "none") ||
    (style.boxShadow !== "none" && style.boxShadow !== "")
  )
}

/** An element's own box drawn: a rectangle with its fill, stroke, corners and shadow, or a picture of its gradient. */
async function paintBox(
  context: Context,
  element: HTMLElement,
  box: Box,
  shape: "rect" | "roundRect" | "ellipse" = "rect",
) {
  const style = getComputedStyle(element)
  const opacity = opacityOf(element, context.section)
  const radius = shape === "ellipse" ? 0 : radiusOf(style, box)
  const kind = shape === "rect" && radius > 0.5 ? "roundRect" : shape
  // A background clipped to the text is the text's colour, not a fill.
  const clipped = clipsText(style)

  if (!clipped && style.backgroundImage !== "none" && style.backgroundImage.includes("gradient(")) {
    const data = await gradientPicture(
      style.backgroundImage,
      box,
      kind === "ellipse" ? Math.min(box.w, box.h) / 2 : radius,
    )

    if (data !== undefined) {
      addPicture(context, element, data, box)
    }
  }

  const fill =
    clipped || style.backgroundImage.includes("gradient(")
      ? undefined
      : colourOf(style.backgroundColor, opacity)
  const line = lineOf(style, opacity)
  const shadow = shadowOf(style)

  if (fill === undefined && line === undefined && shadow === undefined) {
    return
  }

  context.slide.addShape(kind, {
    ...place(box),
    ...(fill === undefined ? { fill: { type: "none" } } : { fill }),
    ...(line === undefined ? {} : { line }),
    ...(shadow === undefined ? {} : { shadow }),
    ...(kind === "roundRect" ? { rectRadius: inch(radius) } : {}),
  } as never)
}

async function paintBackground(context: Context) {
  const style = getComputedStyle(context.section)

  if (style.backgroundImage.includes("gradient(")) {
    const data = await gradientPicture(
      style.backgroundImage,
      { x: 0, y: 0, w: DECK_WIDTH, h: DECK_HEIGHT, rotation: 0 },
      0,
    )

    if (data !== undefined) {
      // The name only says the picture's type: with `data`, nothing is fetched.
      context.slide.background = { data, path: "preencoded.jpg" }
      return
    }
  }

  const fill = colourOf(style.backgroundColor)

  if (fill !== undefined) {
    context.slide.background = fill
  }
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** The runs of a block of text, each with the type its own element is set in; a break ends a line. */
function runsOf(element: HTMLElement, section: HTMLElement): TextRun[] {
  const runs: TextRun[] = []
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)

  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.nodeType === Node.ELEMENT_NODE) {
      if ((node as Element).localName === "br") {
        const last = runs.at(-1)

        if (last === undefined) {
          runs.push({ text: "", options: { breakLine: true } })
        } else {
          last.options = { ...last.options, breakLine: true }
        }
      }

      continue
    }

    const parent = node.parentElement ?? element
    const style = getComputedStyle(parent)
    const raw = node.textContent ?? ""
    const text =
      style.textTransform === "uppercase"
        ? raw.toUpperCase()
        : style.textTransform === "lowercase"
          ? raw.toLowerCase()
          : raw

    if (text === "") {
      continue
    }

    const colour = colourOf(textColourOf(parent, element, style), opacityOf(parent, section))
    const decoration = style.textDecorationLine
    const link = parent.closest("a")?.getAttribute("href")
    const spacing = readPixels(style.letterSpacing)

    runs.push({
      text,
      options: {
        fontFace: firstFamily(style.fontFamily) || "Arial",
        fontSize: Math.round(points(Number.parseFloat(style.fontSize)) * 10) / 10,
        bold: Number(style.fontWeight) >= 600,
        italic: style.fontStyle === "italic",
        ...(decoration.includes("underline") ? { underline: { style: "sng" } } : {}),
        ...(decoration.includes("line-through") ? { strike: "sngStrike" } : {}),
        ...(colour === undefined
          ? {}
          : {
              color: colour.color,
              ...(colour.transparency === undefined ? {} : { transparency: colour.transparency }),
            }),
        ...(link !== null && link !== undefined && /^(https?:|mailto:)/.test(link)
          ? { hyperlink: { url: link } }
          : {}),
        ...(spacing !== undefined && spacing !== 0 ? { charSpacing: points(spacing) } : {}),
      },
    })
  }

  // A break that ends the block draws nothing; PowerPoint would draw an empty line.
  const last = runs.at(-1)

  if (last?.options?.breakLine === true) {
    const { breakLine: _, ...rest } = last.options

    last.options = rest
  }

  return runs
}

const ALIGN: Record<string, string> = {
  left: "left",
  start: "left",
  center: "center",
  right: "right",
  end: "right",
  justify: "justify",
}

/**
 * A text box's inset as pptxgenjs 4.0.1 reads it: `[left, right, bottom,
 * top]`, in points. Its types say CSS's order, but the code that writes the
 * file takes `lIns` from the first value and `tIns` from the last, so a box
 * handed CSS's order comes out with its top and left swapped.
 */
export function textInset(top: number, right: number, bottom: number, left: number) {
  return [left, right, bottom, top].map(points)
}

/** Which side a line of text is set from, for growing its box away from it. */
function anchorOf(align: string): "start" | "centre" | "end" {
  return align === "right" ? "end" : align === "center" ? "centre" : "start"
}

/** The options a text box shares with its runs: where it sits, how it is set, its inset. */
function textBoxOptions(element: HTMLElement, box: Box) {
  const style = getComputedStyle(element)
  const fontSize = Number.parseFloat(style.fontSize)
  const lineHeight = style.lineHeight === "normal" ? 1.2 * fontSize : Number.parseFloat(style.lineHeight)
  const [top, right, bottom, left] = [
    style.paddingTop,
    style.paddingRight,
    style.paddingBottom,
    style.paddingLeft,
  ].map((value) => Number.parseFloat(value) || 0) as [number, number, number, number]
  const align = ALIGN[style.textAlign] ?? "left"

  return {
    // A touch wider than the browser's box, so a line PowerPoint sets a hair
    // wider does not wrap where the slide did not — grown away from the side
    // the text is set from, so a right-aligned line stays where it ended.
    ...place(widenBox(box, box.w * 0.03 + 2, anchorOf(align))),
    margin: textInset(top, right, bottom, left),
    valign: "top",
    align,
    // Exactly the line the browser set: PowerPoint's multiple is of the
    // face's own line, a fifth taller than its size, so 1.4 there is not 1.4 here.
    lineSpacing: Math.round(points(lineHeight) * 10) / 10,
    paraSpaceBefore: 0,
    paraSpaceAfter: 0,
    fit: "none",
    wrap: style.whiteSpace !== "nowrap",
  }
}

async function exportText(context: Context, element: HTMLElement, box: Box) {
  if (paints(getComputedStyle(element))) {
    await paintBox(context, element, box)
  }

  const runs = runsOf(element, context.section)

  if (runs.length > 0) {
    context.slide.addText(runs as never, textBoxOptions(element, box) as never)
  }
}

async function exportList(context: Context, element: HTMLElement, box: Box, ordered: boolean) {
  if (paints(getComputedStyle(element))) {
    await paintBox(context, element, box)
  }

  const items = [...element.children].filter((child): child is HTMLElement => child.localName === "li")
  const runs = items.flatMap((item, index) => {
    const own = runsOf(item, context.section)
    const gap = index === 0 ? 0 : points(Number.parseFloat(getComputedStyle(item).marginTop) || 0)

    if (own.length === 0) {
      own.push({ text: "" })
    }

    own[0] = {
      ...own[0]!,
      options: {
        ...own[0]!.options,
        bullet: ordered ? { type: "number" } : true,
        ...(gap > 0 ? { paraSpaceBefore: gap } : {}),
      },
    }

    if (index < items.length - 1) {
      const last = own.at(-1)!

      own[own.length - 1] = { ...last, options: { ...last.options, breakLine: true } }
    }

    return own
  })

  context.slide.addText(runs as never, textBoxOptions(element, box) as never)
}

async function exportTable(context: Context, element: HTMLElement, box: Box) {
  const rows = [...element.querySelectorAll<HTMLTableRowElement>("tr")]
  const firstRow = rows[0]

  if (firstRow === undefined) {
    return
  }

  const colW = [...firstRow.cells].map((cell) => inch(cell.getBoundingClientRect().width))
  const table = rows.map((row) => {
    const rowStyle = getComputedStyle(row)
    const rowFill = colourOf(rowStyle.backgroundColor)

    return [...row.cells].map((cell) => {
      const style = getComputedStyle(cell)
      const runs = runsOf(cell, context.section)
      const rule = strokeLine(style.borderBottomWidth, style.borderBottomStyle, style.borderBottomColor, 1)

      return {
        text: runs.length === 0 ? "" : runs,
        options: {
          ...(rowFill === undefined ? {} : { fill: rowFill }),
          align: ALIGN[style.textAlign] ?? "left",
          valign: "top",
          margin: [style.paddingTop, style.paddingRight, style.paddingBottom, style.paddingLeft].map(
            (value) => inch(Number.parseFloat(value) || 0),
          ),
          border: [
            { type: "none" },
            { type: "none" },
            rule === undefined ? { type: "none" } : { type: "solid", pt: rule.width, color: rule.color },
            { type: "none" },
          ],
        },
      }
    })
  })

  context.slide.addTable(table as never, { ...place(box), colW } as never)
}

// ---------------------------------------------------------------------------
// The subset's own elements
// ---------------------------------------------------------------------------

const SHAPES: Record<string, string> = {
  rect: "rect",
  rounded: "roundRect",
  ellipse: "ellipse",
  diamond: "diamond",
  triangle: "triangle",
  "arrow-right": "rightArrow",
  "arrow-left": "leftArrow",
  "arrow-up": "upArrow",
  "arrow-down": "downArrow",
  line: "line",
}

async function exportShape(context: Context, node: DeckElement, element: HTMLElement, box: Box) {
  const kind = node.attributes.kind ?? "rect"

  if (kind === "rect" || kind === "rounded" || kind === "ellipse") {
    await paintBox(
      context,
      element,
      box,
      kind === "ellipse" ? "ellipse" : kind === "rounded" ? "roundRect" : "rect",
    )
    return
  }

  const opacity = opacityOf(element, context.section)
  const fillValue = node.style.background ?? "#d4d4d8"
  const stroke = strokeOf(node.style.border)

  if (kind === "line") {
    const colour = colourOf(computeColour(stroke?.color ?? fillValue), opacity)

    context.slide.addShape("line", {
      ...place({ ...box, y: box.y + box.h / 2, h: 0 }),
      line: { color: colour?.color ?? "000000", width: points(stroke?.width ?? box.h) },
    } as never)
    return
  }

  if (fillValue.includes("gradient(")) {
    // A gradient inside a polygon: the polygon drawn as a picture.
    const markup = element.querySelector("svg")?.outerHTML

    if (markup !== undefined) {
      const data = await svgPicture(markup, box)

      if (data !== undefined) {
        addPicture(context, element, data, box)
      }
    }

    return
  }

  const fill = colourOf(computeColour(fillValue), opacity)
  const line = stroke === undefined ? undefined : colourOf(computeColour(stroke.color), opacity)

  context.slide.addShape(
    SHAPES[kind] as never,
    {
      ...place(box),
      fill: fill ?? { type: "none" },
      ...(line === undefined ? {} : { line: { ...line, width: points(stroke!.width) } }),
      ...(shadowOf(getComputedStyle(element)) === undefined
        ? {}
        : { shadow: shadowOf(getComputedStyle(element)) }),
    } as never,
  )
}

/** A connector's legs as lines, with a head on the last leg and on the first when it has two. */
function exportConnector(context: Context, node: DeckElement, element: HTMLElement) {
  const values = ["x1", "y1", "x2", "y2"].map((name) => Number.parseFloat(node.attributes[name] ?? ""))
  const stroke = strokeOf(node.style.border)
  const colour = colourOf(computeColour(node.style.color ?? "#1d1d1f"), opacityOf(element, context.section))
  const head = node.attributes.head ?? "end"
  const line = {
    color: colour?.color ?? "1D1D1F",
    width: points(stroke?.width ?? 3),
    ...(stroke?.style === "dashed"
      ? { dashType: "dash" }
      : stroke?.style === "dotted"
        ? { dashType: "sysDot" }
        : {}),
  }
  let vertices: { x: number; y: number }[]

  if (values.every((value) => Number.isFinite(value))) {
    const origin = element.getBoundingClientRect()
    const ox = origin.left - context.origin.left
    const oy = origin.top - context.origin.top
    const [x1, y1, x2, y2] = values as [number, number, number, number]
    const middle = (x1 + x2) / 2
    const route = node.attributes.route ?? "straight"
    const raw =
      route === "hv"
        ? [
            [x1, y1],
            [x2, y1],
            [x2, y2],
          ]
        : route === "vh"
          ? [
              [x1, y1],
              [x1, y2],
              [x2, y2],
            ]
          : route === "elbow"
            ? [
                [x1, y1],
                [middle, y1],
                [middle, y2],
                [x2, y2],
              ]
            : [
                [x1, y1],
                [x2, y2],
              ]

    vertices = raw.map(([x, y]) => ({ x: x! + ox, y: y! + oy }))
  } else {
    const box = boxOf(context, element)
    const from = node.attributes.from ?? "tl"
    const flat = box.h < 6
    const start = {
      x: from.endsWith("r") ? box.x + box.w : box.x,
      y: flat ? box.y + box.h / 2 : from.startsWith("b") ? box.y + box.h : box.y,
    }
    const end = {
      x: from.endsWith("r") ? box.x : box.x + box.w,
      y: flat ? box.y + box.h / 2 : from.startsWith("b") ? box.y : box.y + box.h,
    }

    vertices = [start, end]
  }

  for (let index = 0; index < vertices.length - 1; index += 1) {
    const a = vertices[index]!
    const b = vertices[index + 1]!
    const last = index === vertices.length - 2

    context.slide.addShape("line", {
      x: inch(Math.min(a.x, b.x)),
      y: inch(Math.min(a.y, b.y)),
      w: inch(Math.abs(b.x - a.x)),
      h: inch(Math.abs(b.y - a.y)),
      flipH: b.x < a.x,
      flipV: b.y < a.y,
      line: {
        ...line,
        ...(last && head !== "none" ? { endArrowType: "triangle" } : {}),
        ...(index === 0 && head === "both" ? { beginArrowType: "triangle" } : {}),
      },
    } as never)
  }
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

const TEXT_TAGS = new Set(["h1", "h2", "h3", "p"])

async function exportNodes(context: Context, nodes: readonly DeckNode[], path: DeckPath) {
  for (const [index, node] of nodes.entries()) {
    const at = [...path, index]

    if (node.type === "text") {
      continue
    }

    const element = elementAt(context, at)

    if (
      element === undefined ||
      getComputedStyle(element).display === "none" ||
      getComputedStyle(element).visibility === "hidden"
    ) {
      continue
    }

    const box = boxOf(context, element)

    if (node.type === "svg") {
      const src = element.getAttribute("src")
      const data = src === null ? undefined : await pictureOf(src, box, "contain", 0)

      if (data !== undefined) {
        addPicture(context, element, data, box)
      }

      continue
    }

    switch (node.tag) {
      case "div":
        if (paints(getComputedStyle(element))) {
          await paintBox(context, element, box)
        }

        await exportNodes(context, node.children, at)
        break

      case "ul":
      case "ol":
        await exportList(context, element, box, node.tag === "ol")
        break

      case "table":
        await exportTable(context, element, box)
        break

      case "img": {
        const src = (element as HTMLImageElement).currentSrc || element.getAttribute("src")
        const style = getComputedStyle(element)
        const data =
          src === null || src === ""
            ? undefined
            : await pictureOf(src, box, style.objectFit, radiusOf(style, box), style.objectPosition)

        if (data !== undefined) {
          addPicture(context, element, data, box)
        } else if (src !== null && src !== "") {
          context.skipped.add(node.attributes.src ?? src)
        }

        break
      }

      case "x-shape":
        await exportShape(context, node, element, box)
        break

      case "x-icon": {
        const markup = element
          .querySelector("svg")
          ?.outerHTML.replace('stroke="currentColor"', `stroke="${getComputedStyle(element).color}"`)
        const data =
          markup === undefined
            ? undefined
            : await svgPicture(markup.replace("<svg ", '<svg width="256" height="256" '), box)

        if (data !== undefined) {
          addPicture(context, element, data, box)
        }

        break
      }

      case "x-connector":
        exportConnector(context, node, element)
        break

      case "hr": {
        const style = getComputedStyle(element)
        const line = lineOf(style, opacityOf(element, context.section))

        if (line !== undefined) {
          context.slide.addShape("line", { ...place({ ...box, h: 0 }), line } as never)
        }

        break
      }

      default:
        if (TEXT_TAGS.has(node.tag)) {
          await exportText(context, element, box)
        }
    }
  }
}

/** Hand a file to the reader as a download. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")

  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
