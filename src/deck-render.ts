import { readPixels } from "./deck-css"
import { escapeAttribute, escapeText } from "./deck-html"
import { deckIconMarkup } from "./deck-icons"
import {
  DECK_HEIGHT,
  DECK_WIDTH,
  type Deck,
  type DeckElement,
  type DeckNode,
  type DeckSlide,
  type DeckStyle,
  readDeckCrop,
} from "./deck"

/**
 * A deck's tree as what a browser draws: the subset's own elements —
 * `x-shape`, `x-icon`, `x-connector`, a drawing — spelled as HTML and SVG, and
 * the styles every slide starts from.
 *
 * One description for two drawers. The version's page writes it out as text;
 * the editor builds vnodes from it. Neither knows how a diamond is drawn, so
 * the page and the stage cannot disagree about one. The exports measure what
 * this draws.
 *
 * Browser-safe.
 */

type DeckRenderBox = {
  attributes: Record<string, string>
  style: Record<string, string>
  /** A class from `DECK_BASE_CSS`, for the subset's own elements. */
  class?: string
  /** Where in the slide's tree this was drawn from, for the editor to find what was clicked. */
  path?: readonly number[]
}

export type DeckRenderNode =
  | { kind: "text"; text: string }
  | (DeckRenderBox & { kind: "element"; tag: string; children: DeckRenderNode[] })
  /**
   * A `<div>` holding SVG markup: what this module drew itself — a shape, an
   * icon, a connector. The model's own drawings are images unless a caller
   * asks otherwise (`svgAsImage: false`).
   */
  | (DeckRenderBox & { kind: "markup"; markup: string })

export type DeckRenderOptions = {
  /** Where an asset is served; the page leaves `assets/…` relative to itself. */
  resolveAsset?: (src: string) => string
  /**
   * A drawing as an `<img>` of itself, which is the default and the only form
   * of the model's markup that cannot run anything: an image runs no scripts
   * and loads nothing. `false` draws it inline, for a caller that has checked
   * the markup itself.
   */
  svgAsImage?: boolean
  /** Mark each element with where in the tree it came from. */
  paths?: boolean
  /** Give a connector a wide invisible stroke, so a line a few pixels thick can be clicked. */
  hitAreas?: boolean
}

/**
 * The styles every slide starts from, under `.deck-slide`. A tag's defaults
 * live here and nowhere else: the page, the stage and the thumbnails all load
 * this one sheet, so a `<p>` is the same size in each.
 */
export const DECK_BASE_CSS = `
.deck-root{font-family:system-ui,-apple-system,"Segoe UI","Noto Sans","PingFang SC","Hiragino Sans",sans-serif;color:#1d1d1f;color-scheme:light}
.deck-slide{position:relative;width:${DECK_WIDTH}px;height:${DECK_HEIGHT}px;overflow:hidden;display:flex;flex-direction:column;background:#ffffff;font-size:32px;line-height:1.4;overflow-wrap:break-word;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.deck-slide,.deck-slide *{margin:0;box-sizing:border-box}
.deck-slide div{display:flex;flex-direction:column;min-width:0}
.deck-slide h1{font-size:96px;font-weight:600;line-height:1.1}
.deck-slide h2{font-size:64px;font-weight:600;line-height:1.15}
.deck-slide h3{font-size:44px;font-weight:600;line-height:1.2}
.deck-slide ul,.deck-slide ol{padding-left:1.25em}
.deck-slide ul{list-style:disc}
.deck-slide ol{list-style:decimal}
.deck-slide li+li{margin-top:.25em}
.deck-slide a{color:inherit;text-decoration:underline}
.deck-slide b{font-weight:700}
.deck-slide img{display:block;max-width:none;object-fit:cover}
.deck-slide table{border-collapse:collapse;font-variant-numeric:tabular-nums}
.deck-slide th,.deck-slide td{padding:.35em .6em;border-bottom:1px solid rgb(128 128 128 / .3);text-align:left;vertical-align:top}
.deck-slide th{font-weight:600}
.deck-slide hr{border:0;border-top:2px solid currentColor;width:100%;flex:none}
.deck-slide .deck-shape,.deck-slide .deck-icon{flex:none}
.deck-slide .deck-shape>svg,.deck-slide .deck-icon>svg{display:block;width:100%;height:100%;overflow:visible}
.deck-slide .deck-connector{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}
`

/**
 * How a slide arrives and leaves, and how a build appears: the keyframes the
 * page's viewer and the editor's presenter both name, so a transition is the
 * same motion in either.
 */
export const DECK_MOTION_CSS = `
@keyframes deck-fade-in { from { opacity: 0 } to { opacity: 1 } }
@keyframes deck-fade-out { from { opacity: 1 } to { opacity: 0 } }
@keyframes deck-push-in { from { transform: translateX(100%) } to { transform: none } }
@keyframes deck-push-out { from { transform: none } to { transform: translateX(-100%) } }
@keyframes deck-push-in-back { from { transform: translateX(-100%) } to { transform: none } }
@keyframes deck-push-out-back { from { transform: none } to { transform: translateX(100%) } }
@keyframes deck-build-fade { from { opacity: 0 } }
@keyframes deck-build-rise { from { opacity: 0; transform: translateY(48px) } }
@keyframes deck-build-drop { from { opacity: 0; transform: translateY(-48px) } }
@keyframes deck-build-left { from { opacity: 0; transform: translateX(-96px) } }
@keyframes deck-build-right { from { opacity: 0; transform: translateX(96px) } }
@keyframes deck-build-scale { from { opacity: 0; transform: scale(0.6) } }
@keyframes deck-build-pop { 0% { opacity: 0; transform: scale(0.5) } 70% { opacity: 1; transform: scale(1.06) } 100% { transform: none } }
`

/** The polygon each shape kind is, on a 100×100 box stretched to the shape's. */
const SHAPE_POINTS: Record<string, string> = {
  diamond: "50,0 100,50 50,100 0,50",
  triangle: "50,0 100,100 0,100",
  "arrow-right": "0,30 60,30 60,0 100,50 60,100 60,70 0,70",
  "arrow-left": "100,30 40,30 40,0 0,50 40,100 40,70 100,70",
  "arrow-up": "30,100 30,40 0,40 50,0 100,40 70,40 70,100",
  "arrow-down": "30,0 30,60 0,60 50,100 100,60 70,60 70,0",
}

/** A slide's children as render nodes. */
export function renderDeckNodes(
  nodes: readonly DeckNode[],
  options: DeckRenderOptions = {},
  path: readonly number[] = [],
  container: Size = SLIDE_SIZE,
): DeckRenderNode[] {
  return nodes.flatMap((node, index) => renderNode(node, options, [...path, index], container))
}

type Size = { width: number; height: number }

const SLIDE_SIZE: Size = { width: DECK_WIDTH, height: DECK_HEIGHT }

function renderNode(
  node: DeckNode,
  options: DeckRenderOptions,
  path: readonly number[],
  container: Size,
): DeckRenderNode[] {
  const marked = options.paths === true ? { path } : {}

  if (node.type === "text") {
    return [{ kind: "text", text: node.text }]
  }

  if (node.type === "svg") {
    const { "aria-label": label, ...attributes } = node.attributes
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"${Object.entries(attributes)
      .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
      .join("")}>${node.markup}</svg>`

    if (options.svgAsImage !== false) {
      return [
        {
          kind: "element",
          tag: "img",
          attributes: {
            src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
            alt: label ?? "",
            draggable: "false",
          },
          style: { "object-fit": "contain", ...svgSize(node), ...node.style },
          children: [],
          ...marked,
        },
      ]
    }

    return [
      {
        kind: "markup",
        attributes: {},
        style: { ...svgSize(node), ...node.style, display: "block" },
        markup: svg.replace("<svg ", '<svg width="100%" height="100%" '),
        ...marked,
      },
    ]
  }

  switch (node.tag) {
    case "x-shape":
      return [renderShape(node, marked)]

    case "x-icon":
      return [
        {
          kind: "markup",
          class: "deck-icon",
          attributes: identity(node),
          style: { width: "64px", height: "64px", ...node.style },
          markup: deckIconMarkup(node.attributes.name ?? ""),
          ...marked,
        },
      ]

    case "x-connector":
      return [renderConnector(node, marked, container, options.hitAreas === true)]

    case "img": {
      const src = node.attributes.src
      const resolved = src === undefined ? undefined : (options.resolveAsset?.(src) ?? src)

      return [
        {
          kind: "element",
          tag: "img",
          attributes: {
            ...(resolved === undefined ? {} : { src: resolved }),
            alt: node.attributes.alt ?? "",
            draggable: "false",
            ...identity(node),
          },
          style: {
            ...(resolved === undefined ? { background: "rgb(128 128 128 / .15)" } : {}),
            ...cropStyle(node),
            ...node.style,
          },
          children: [],
          ...marked,
        },
      ]
    }

    default: {
      const attributes = identity(node)

      if (node.tag === "a" && node.attributes.href !== undefined) {
        attributes.href = node.attributes.href
        attributes.target = "_blank"
        attributes.rel = "noopener"
      }

      return [
        {
          kind: "element",
          tag: node.tag,
          attributes,
          style: { ...node.style },
          children: renderDeckNodes(node.children, options, path, containerOf(node, container)),
          ...marked,
        },
      ]
    }
  }
}

/** The box a pinned child of `node` is placed in: its own size when it states one in px, else the slide's. */
function containerOf(node: DeckElement, outer: Size): Size {
  if (node.tag !== "div" || node.style.position !== "relative") {
    return outer
  }

  return {
    width: readPixels(node.style.width ?? "") ?? outer.width,
    height: readPixels(node.style.height ?? "") ?? outer.height,
  }
}

/** A drawing's size from its own `width`/`height`, when the style does not say. */
function svgSize(node: Extract<DeckNode, { type: "svg" }>): Record<string, string> {
  const size: Record<string, string> = {}
  const width = readPixels(node.attributes.width ?? "")
  const height = readPixels(node.attributes.height ?? "")

  if (width !== undefined) {
    size.width = `${width}px`
  }

  if (height !== undefined) {
    size.height = `${height}px`
  }

  return size
}

/** `data-crop="2 30% 40%"`: a zoom and where it is centred, as a person cropped the picture. */
function cropStyle(node: DeckElement): Record<string, string> {
  const crop = readDeckCrop(node.attributes["data-crop"] ?? "")

  if (crop === undefined) {
    return {}
  }

  return {
    "object-position": `${crop.x} ${crop.y}`,
    "transform-origin": `${crop.x} ${crop.y}`,
    scale: String(crop.zoom),
  }
}

/** What a drawn element keeps of its own attributes: its id, for a magic move, and its builds. */
function identity(node: DeckElement): Record<string, string> {
  const attributes: Record<string, string> = {}

  for (const name of ["id", "data-build-in", "data-build-out"]) {
    const value = node.attributes[name]

    if (value !== undefined) {
      attributes[name] = value
    }
  }

  return attributes
}

/** A shape: a painted box for the boxy kinds, a polygon for the rest, filled and stroked as its style says. */
function renderShape(node: DeckElement, marked: { path?: readonly number[] }): DeckRenderNode {
  const kind = node.attributes.kind ?? "rect"
  const { background, border, ...rest } = node.style
  const attributes = identity(node)

  if (kind === "rect" || kind === "rounded" || kind === "ellipse") {
    return {
      kind: "element",
      tag: "div",
      attributes,
      style: {
        width: "240px",
        height: "160px",
        ...(kind === "rounded"
          ? { "border-radius": "24px" }
          : kind === "ellipse"
            ? { "border-radius": "50%" }
            : {}),
        ...(background === undefined ? { background: "#d4d4d8" } : { background }),
        ...(border === undefined ? {} : { border }),
        ...rest,
      },
      children: [],
      class: "deck-shape",
      ...marked,
    }
  }

  const fill = background ?? "#d4d4d8"
  const stroke = strokeOf(border)
  const inner =
    kind === "line"
      ? `<line x1="0" y1="50" x2="100" y2="50" stroke="${escapeAttribute(stroke?.color ?? fill)}" stroke-width="${stroke?.width ?? 4}" vector-effect="non-scaling-stroke"${dash(stroke?.style)}/>`
      : `<polygon points="${SHAPE_POINTS[kind] ?? SHAPE_POINTS.diamond}" fill="${escapeAttribute(fill)}"${stroke === undefined ? "" : ` stroke="${escapeAttribute(stroke.color)}" stroke-width="${stroke.width}" vector-effect="non-scaling-stroke" stroke-linejoin="round"${dash(stroke.style)}`}/>`

  return {
    kind: "markup",
    class: "deck-shape",
    attributes,
    style: { width: "240px", height: kind === "line" ? "8px" : "160px", ...rest },
    markup: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" preserveAspectRatio="none">${inner}</svg>`,
    ...marked,
  }
}

/** `2px dashed #111` read as a stroke. */
export function strokeOf(
  border: string | undefined,
): { width: number; style: string; color: string } | undefined {
  if (border === undefined || border === "none") {
    return undefined
  }

  const parts = border.split(/\s+(?![^(]*\))/)

  return {
    width: readPixels(parts[0] ?? "") ?? 1,
    style: parts[1] ?? "solid",
    color: parts[2] ?? "#000000",
  }
}

function dash(style: string | undefined) {
  return style === "dashed"
    ? ' stroke-dasharray="8 6"'
    : style === "dotted"
      ? ' stroke-dasharray="2 4" stroke-linecap="round"'
      : ""
}

/** A coordinate in the container's pixels: `120`, `120px` or `50%`. */
function coordinate(value: string | undefined, extent: number) {
  if (value === undefined) {
    return undefined
  }

  const share = /^(-?[\d.]+)%$/.exec(value.trim())

  return share === null ? readPixels(value) : (Number(share[1]) / 100) * extent
}

/**
 * A connector: a line between two points with an arrowhead of a fixed size,
 * straight or in right-angled legs. Placed by coordinates, it is drawn over
 * its whole container; without them it is a flow child whose line runs
 * corner to corner across its own box.
 */
function renderConnector(
  node: DeckElement,
  marked: { path?: readonly number[] },
  container: Size,
  hit: boolean,
): DeckRenderNode {
  const color = node.style.color ?? "#1d1d1f"
  const stroke = strokeOf(node.style.border)
  const width = stroke?.width ?? 3
  const head = node.attributes.head ?? "end"
  // Named by what it draws, so two connectors drawing the same head share
  // one, and the same slide draws the same markup every time.
  const id = `deck-arrow-${color.replace(/[^a-z0-9]/gi, "")}-${width}`
  const marker = `<marker id="${id}" viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse" markerWidth="${10 + width * 4}" markerHeight="${10 + width * 4}" orient="auto-start-reverse"><path d="M0 0 10 5 0 10z" fill="${escapeAttribute(color)}"/></marker>`
  const ends = `${head === "end" || head === "both" ? ` marker-end="url(#${id})"` : ""}${head === "both" ? ` marker-start="url(#${id})"` : ""}`
  const x1 = coordinate(node.attributes.x1, container.width)
  const y1 = coordinate(node.attributes.y1, container.height)
  const x2 = coordinate(node.attributes.x2, container.width)
  const y2 = coordinate(node.attributes.y2, container.height)
  const line = (points: string) =>
    `<polyline points="${points}" fill="none" stroke="${escapeAttribute(color)}" stroke-width="${width}" stroke-linejoin="round"${dash(stroke?.style)}${ends}/>` +
    (hit
      ? `<polyline points="${points}" fill="none" stroke="transparent" stroke-width="24" pointer-events="stroke"/>`
      : "")

  if (x1 !== undefined && y1 !== undefined && x2 !== undefined && y2 !== undefined) {
    const route = node.attributes.route ?? "straight"
    const middleX = (x1 + x2) / 2
    const points =
      route === "hv"
        ? `${x1},${y1} ${x2},${y1} ${x2},${y2}`
        : route === "vh"
          ? `${x1},${y1} ${x1},${y2} ${x2},${y2}`
          : route === "elbow"
            ? `${x1},${y1} ${middleX},${y1} ${middleX},${y2} ${x2},${y2}`
            : `${x1},${y1} ${x2},${y2}`

    return {
      kind: "markup",
      attributes: identity(node),
      style: {
        position: "absolute",
        left: "0",
        top: "0",
        width: `${container.width}px`,
        height: `${container.height}px`,
        "pointer-events": "none",
        ...(node.style.opacity === undefined ? {} : { opacity: node.style.opacity }),
      },
      markup: `<svg xmlns="http://www.w3.org/2000/svg" width="${container.width}" height="${container.height}" viewBox="0 0 ${container.width} ${container.height}" style="overflow:visible"><defs>${marker}</defs>${line(points)}</svg>`,
      ...marked,
    }
  }

  // In the flow: corner to corner across its own box, from the corner `from` names.
  const from = node.attributes.from ?? "tl"
  const [sx, sy, ex, ey] =
    from === "tr"
      ? [100, 0, 0, 100]
      : from === "bl"
        ? [0, 100, 100, 0]
        : from === "br"
          ? [100, 100, 0, 0]
          : [0, 0, 100, 100]
  const { border: _, color: __, ...style } = node.style

  return {
    kind: "markup",
    attributes: identity(node),
    style: {
      width: "96px",
      height: `${Math.max(width, 2)}px`,
      "align-self": "center",
      flex: "none",
      ...style,
    },
    markup: `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" style="overflow:visible;display:block"><defs>${marker}</defs><svg viewBox="0 0 100 100" preserveAspectRatio="none" overflow="visible"><line x1="${sx}" y1="${sy === ey ? 50 : sy}" x2="${ex}" y2="${sy === ey ? 50 : ey}" stroke="${escapeAttribute(color)}" stroke-width="${width}" vector-effect="non-scaling-stroke"${dash(stroke?.style)}${ends}/></svg></svg>`,
    ...marked,
  }
}

// ---------------------------------------------------------------------------
// As text, for the version's page
// ---------------------------------------------------------------------------

function styleText(style: Record<string, string>) {
  return Object.entries(style)
    .map(([property, value]) => `${property}:${value}`)
    .join(";")
}

const VOID = new Set(["img", "hr", "br"])

/** Render nodes as markup. */
export function renderNodesHtml(nodes: readonly DeckRenderNode[]): string {
  return nodes
    .map((node) => {
      if (node.kind === "text") {
        return escapeText(node.text)
      }

      const classText = node.class === undefined ? "" : ` class="${node.class}"`
      const style = styleText(node.style)
      const styleAttribute = style === "" ? "" : ` style="${escapeAttribute(style)}"`
      const attributes = Object.entries(node.attributes)
        .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
        .join("")

      if (node.kind === "markup") {
        return `<div${classText}${attributes}${styleAttribute}>${node.markup}</div>`
      }

      const open = `<${node.tag}${classText}${attributes}${styleAttribute}>`

      return VOID.has(node.tag) ? open : `${open}${renderNodesHtml(node.children)}</${node.tag}>`
    })
    .join("")
}

/** One slide as the markup of its section. */
export function renderSlideHtml(slide: DeckSlide, options: DeckRenderOptions = {}) {
  const attributes = [
    `id="${escapeAttribute(slide.id)}"`,
    ...(slide.transition === undefined ? [] : [`data-transition="${slide.transition}"`]),
    ...(slide.hidden === true ? ["hidden"] : []),
  ]
  const style = styleText(slide.style)

  return `<section class="deck-slide" ${attributes.join(" ")}${style === "" ? "" : ` style="${escapeAttribute(style)}"`}>${renderNodesHtml(renderDeckNodes(slide.children, options))}</section>`
}

/** The stylesheets and faces a deck brings, for the head of a page that draws it. */
export function deckFontMarkup(deck: Deck, resolveAsset: (src: string) => string = (src) => src) {
  const faces = deck.fontFaces
    .map(
      (face) =>
        `@font-face{font-family:"${face.family.replace(/["\\]/g, "")}";src:url("${resolveAsset(face.src)}");font-display:swap}`,
    )
    .join("")

  return [
    ...deck.fontLinks.map((href) => `<link rel="stylesheet" href="${escapeAttribute(href)}">`),
    ...(faces === "" ? [] : [`<style>${faces}</style>`]),
  ].join("\n")
}

/** The deck's defaults as the style of the element its slides sit in. */
export function deckRootStyle(style: DeckStyle) {
  return styleText({ ...style })
}
