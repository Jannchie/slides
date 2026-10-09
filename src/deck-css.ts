/**
 * The styles a deck's elements may carry: every property, the values it
 * takes, and the elements it applies to.
 *
 * Closed, because four readers draw one slide — the page, the editor's stage,
 * the thumbnails and the PowerPoint file — and the last of them has to turn
 * every style into something an office program draws. A property that one of
 * them cannot say is a slide that comes out differently in it; refusing the
 * property is the only way the four agree.
 *
 * Values are normalized as they are read — a bare number is pixels, points are
 * converted, the `font` shorthand is spelled out — so the tree holds one
 * spelling of each, which is what lets the editor read a value back and the
 * writer produce the same text for the same slide.
 *
 * Browser-safe: the editor reads and writes styles through this.
 */

/** What a property may be set on. `text` is a block of text; `inline` a run inside one. */
export type DeckStyleTarget =
  | "section"
  | "div"
  | "text"
  | "inline"
  | "img"
  | "table"
  | "row"
  | "cell"
  | "shape"
  | "icon"
  | "connector"
  | "hr"
  | "svg"

/** The target an element's styles are checked against. */
export function styleTargetOf(tag: string): DeckStyleTarget | undefined {
  switch (tag) {
    case "section":
    case "body":
      return "section"
    case "div":
      return "div"
    case "h1":
    case "h2":
    case "h3":
    case "p":
    case "ul":
    case "ol":
    case "li":
      return "text"
    case "span":
    case "a":
    case "b":
    case "i":
    case "u":
    case "s":
      return "inline"
    case "img":
      return "img"
    case "table":
      return "table"
    case "tr":
      return "row"
    case "th":
    case "td":
      return "cell"
    case "x-shape":
      return "shape"
    case "x-icon":
      return "icon"
    case "x-connector":
      return "connector"
    case "hr":
      return "hr"
    case "svg":
      return "svg"
    default:
      return undefined
  }
}

const ALL: readonly DeckStyleTarget[] = [
  "section",
  "div",
  "text",
  "inline",
  "img",
  "table",
  "row",
  "cell",
  "shape",
  "icon",
  "connector",
  "hr",
  "svg",
]
const BOXES: readonly DeckStyleTarget[] = [
  "div",
  "text",
  "img",
  "table",
  "cell",
  "shape",
  "icon",
  "hr",
  "svg",
]
const PLACED: readonly DeckStyleTarget[] = [
  "div",
  "text",
  "img",
  "table",
  "shape",
  "icon",
  "hr",
  "svg",
  "connector",
]
const CONTAINERS: readonly DeckStyleTarget[] = ["section", "div"]
const TYPE: readonly DeckStyleTarget[] = ["section", "div", "text", "table", "cell"]
const PAINTED: readonly DeckStyleTarget[] = ["section", "div", "text", "img", "table", "cell", "icon"]

/** A value read: its normalized spelling, or why it was refused. */
type Read = { value: string } | { refused: string }

type PropertySpec = {
  targets: readonly DeckStyleTarget[]
  read: (value: string) => Read
  /** What the property means, for a refusal that names a value. */
  takes: string
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const ok = (value: string): Read => ({ value })
const refuse = (refused: string): Read => ({ refused })

const NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/

/** A number, or nothing. */
function number(text: string) {
  return NUMBER.test(text) ? Number(text) : undefined
}

/** Trimmed to at most three decimals, without trailing zeros: `12.50` → `12.5`. */
function trim(value: number) {
  return String(Math.round(value * 1000) / 1000)
}

/** A length in pixels: `24px`, `24` (pixels), `18pt` (converted). Nothing else. */
export function readPixels(text: string): number | undefined {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|pt)?$/i.exec(text.trim())

  if (match === null) {
    return undefined
  }

  const value = Number(match[1])

  return match[2]?.toLowerCase() === "pt" ? (value * 4) / 3 : value
}

const px = (value: number) => (value === 0 ? "0" : `${trim(value)}px`)

/** `text` as a length between `min` and `max` pixels, spelled `Npx`. */
function length(text: string, min = -4096, max = 8192): Read {
  const value = readPixels(text)

  if (value === undefined) {
    return refuse(/(em|rem|vw|vh|vmin|vmax|ch|ex)$/i.test(text) ? "only px lengths" : "a length in px")
  }

  if (value < min || value > max) {
    return refuse(`a length from ${min} to ${max}px`)
  }

  return ok(px(value))
}

function percent(text: string): number | undefined {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))%$/.exec(text.trim())

  return match === null ? undefined : Number(match[1])
}

function lengthOrPercent(text: string, extra: readonly string[] = []): Read {
  const word = text.trim().toLowerCase()

  if (extra.includes(word)) {
    return ok(word)
  }

  const share = percent(text)

  if (share !== undefined) {
    return ok(`${trim(share)}%`)
  }

  return length(text)
}

/** One of `words`, lowercased. */
function keyword(words: readonly string[]) {
  return (text: string): Read => {
    const word = text.trim().toLowerCase()

    return words.includes(word) ? ok(word) : refuse(words.join(" | "))
  }
}

/** A plain number between `min` and `max`. */
function bounded(min: number, max: number, integer = false) {
  return (text: string): Read => {
    const value = number(text.trim())

    if (value === undefined || value < min || value > max || (integer && !Number.isInteger(value))) {
      return refuse(`a ${integer ? "whole " : ""}number from ${min} to ${max}`)
    }

    return ok(trim(value))
  }
}

/**
 * Split at top-level separators: commas or spaces outside parentheses and
 * quotes. `rgb(0, 0, 0) 2px` is two parts, not four.
 */
export function splitTop(text: string, separator: "," | " "): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let escaped = false
  let current = ""

  for (const char of text) {
    if (quote !== undefined) {
      current += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
      current += char
      continue
    }

    if (char === "(") {
      depth += 1
    } else if (char === ")") {
      depth -= 1
    }

    const splits = separator === "," ? char === "," : /\s/.test(char)

    if (splits && depth === 0) {
      if (current.trim() !== "") {
        parts.push(current.trim())
      }
      current = ""
      continue
    }

    current += char
  }

  if (current.trim() !== "") {
    parts.push(current.trim())
  }

  return parts
}

/** The colours CSS names, which a model writes as often as hex. */
const NAMED_COLORS = new Set(
  (
    "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood " +
    "cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray " +
    "darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen " +
    "darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue " +
    "firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew " +
    "hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan " +
    "lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray " +
    "lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue " +
    "mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred " +
    "midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid " +
    "palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple " +
    "rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue " +
    "slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow " +
    "yellowgreen transparent"
  ).split(" "),
)

const COLOR_FUNCTION = /^(rgba?|hsla?)\(\s*[-\d.%\s,/deg]+\)$/i

/** A colour: hex, `rgb()`/`rgba()`/`hsl()`/`hsla()`, or a name. Lowercased. */
export function isColor(text: string) {
  const value = text.trim().toLowerCase()

  return (
    /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.test(value) ||
    COLOR_FUNCTION.test(value) ||
    NAMED_COLORS.has(value)
  )
}

function color(text: string): Read {
  const value = text.trim()

  if (/currentcolor|var\(/i.test(value)) {
    return refuse("a colour written out: #hex, rgb(), hsl() or a name — not currentColor or var()")
  }

  return isColor(value) ? ok(value.toLowerCase()) : refuse("a colour: #hex, rgb(), hsl() or a name")
}

function angle(text: string) {
  return /^-?(?:\d+\.?\d*|\.\d+)(deg|turn|rad)$/i.test(text.trim()) || text.trim() === "0"
}

const GRADIENT = /^(repeating-)?(linear|radial)-gradient\((.*)\)$/is

/** A gradient's stops and direction, loosely: what it may hold, not what it means. */
function gradient(text: string): Read {
  const match = GRADIENT.exec(text.trim())

  if (match === null) {
    return refuse("a colour or a linear-gradient() / radial-gradient()")
  }

  const parts = splitTop(match[3]!, ",")
  const stops = parts.filter((part) => isColor(splitTop(part, " ")[0] ?? ""))

  if (stops.length < 2 || stops.length > 8) {
    return refuse("a gradient of 2 to 8 colour stops")
  }

  for (const part of parts) {
    const [first, ...rest] = splitTop(part, " ")

    if (isColor(first ?? "")) {
      if (!rest.every((position) => percent(position) !== undefined || readPixels(position) !== undefined)) {
        return refuse("gradient stops as a colour and up to two positions in % or px")
      }
      continue
    }

    // The direction or shape: an angle, `to <side>`, or a radial shape and centre.
    const words = splitTop(part, " ")
    const direction =
      (words.length === 1 && angle(words[0]!)) ||
      (words[0] === "to" &&
        words.slice(1).every((word) => ["top", "bottom", "left", "right"].includes(word))) ||
      words.every(
        (word) =>
          [
            "circle",
            "ellipse",
            "at",
            "center",
            "top",
            "bottom",
            "left",
            "right",
            "closest-side",
            "farthest-corner",
          ].includes(word) ||
          percent(word) !== undefined ||
          readPixels(word) !== undefined,
      )

    if (!direction) {
      return refuse("a gradient's direction as an angle, `to <side>`, or a radial shape `at X% Y%`")
    }
  }

  return ok(text.trim().replace(/\s+/g, " "))
}

function background(text: string): Read {
  const value = text.trim()

  if (/url\(/i.test(value)) {
    return refuse("a colour or a gradient — an image is an <img>")
  }

  if (isColor(value)) {
    return ok(value.toLowerCase())
  }

  // A gradient, optionally over a colour: `linear-gradient(…), #fff`. The
  // gradient's own commas are inside its parentheses, so a top-level split
  // is its layers.
  const layers = splitTop(value, ",")

  if (layers.length > 2 || (layers.length === 2 && !isColor(layers[1]!))) {
    return refuse("one gradient, optionally with a colour under it")
  }

  const read = gradient(layers[0]!)

  if ("refused" in read) {
    return read
  }

  return ok(layers.length === 2 ? `${read.value}, ${layers[1]!.toLowerCase()}` : read.value)
}

const BORDER_STYLES = ["solid", "dashed", "dotted", "double", "none"]

/** `2px solid #ccc`: one stroke, the style word required. */
function border(text: string): Read {
  const value = text.trim().toLowerCase()

  if (value === "none" || value === "0") {
    return ok("none")
  }

  const parts = splitTop(value, " ")
  const style = parts.find((part) => BORDER_STYLES.includes(part))
  const width = parts.find((part) => readPixels(part) !== undefined)
  const paint = parts.find((part) => part !== style && part !== width)

  if (style === undefined) {
    return refuse("a stroke with its style word: `2px solid #ccc`")
  }

  if (parts.length > 3 || (paint !== undefined && !isColor(paint))) {
    return refuse("a width, a style and a colour: `2px solid #ccc`")
  }

  const pixels = width === undefined ? 1 : readPixels(width)!

  if (pixels < 0 || pixels > 32) {
    return refuse("a stroke from 0 to 32px")
  }

  return ok([px(pixels), style, ...(paint === undefined ? [] : [paint])].join(" "))
}

/** One to four lengths, as `padding` and `border-radius` take them. */
function lengths(min: number, max: number, allowPercent = false) {
  return (text: string): Read => {
    const parts = splitTop(text.trim(), " ")

    if (parts.length < 1 || parts.length > 4) {
      return refuse("one to four lengths in px")
    }

    const read = parts.map((part) =>
      allowPercent && percent(part) !== undefined ? ok(`${trim(percent(part)!)}%`) : length(part, min, max),
    )
    const refused = read.find((part) => "refused" in part)

    return refused ?? ok(read.map((part) => (part as { value: string }).value).join(" "))
  }
}

/** `0 8px 24px rgba(0,0,0,.2), …`: up to eight shadows. */
function shadow(inset: boolean) {
  return (text: string): Read => {
    if (text.trim().toLowerCase() === "none") {
      return ok("none")
    }

    const layers = splitTop(text, ",")

    if (layers.length > 8) {
      return refuse("at most eight shadows")
    }

    for (const layer of layers) {
      const parts = splitTop(layer, " ").filter((part) => !(inset && part.toLowerCase() === "inset"))
      const paints = parts.filter((part) => isColor(part))
      const sizes = parts.filter((part) => readPixels(part) !== undefined)

      if (
        paints.length !== 1 ||
        sizes.length < 2 ||
        sizes.length > (inset ? 4 : 3) ||
        paints.length + sizes.length !== parts.length
      ) {
        return refuse(`shadows as x y${inset ? " [blur [spread]]" : " [blur]"} and one colour`)
      }
    }

    return ok(layers.map((layer) => layer.replace(/\s+/g, " ").trim()).join(", "))
  }
}

const TRANSFORMS = /^(translate|translateX|translateY|rotate|scale|skew|skewX|skewY)\(([^()]*)\)$/

function transform(text: string): Read {
  const value = text.trim()

  if (value === "none") {
    return ok("none")
  }

  for (const part of splitTop(value, " ")) {
    const match = TRANSFORMS.exec(part)

    if (match === null) {
      return refuse("translate(), rotate(), scale() and skew() only")
    }

    const args = splitTop(match[2]!, ",")
    const fn = match[1]!
    const valid = fn.startsWith("translate")
      ? args.length >= 1 &&
        args.length <= (fn === "translate" ? 2 : 1) &&
        args.every((arg) => readPixels(arg) !== undefined || percent(arg) !== undefined)
      : fn === "rotate" || fn.startsWith("skew")
        ? args.length >= 1 && args.length <= (fn === "skew" ? 2 : 1) && args.every(angle)
        : args.length === 1 &&
          number(args[0]!) !== undefined &&
          Number(args[0]) >= 0.1 &&
          Number(args[0]) <= 4

    if (!valid) {
      return refuse(
        `${fn}() with ${fn.startsWith("translate") ? "px or % offsets" : fn === "scale" ? "one factor" : "an angle"}`,
      )
    }
  }

  return ok(value.replace(/\s+/g, " "))
}

const FILTERS = /^(blur|brightness|contrast|saturate|grayscale|sepia|invert|hue-rotate|opacity)\(([^()]*)\)$/

function filter(text: string): Read {
  const value = text.trim()

  if (value === "none") {
    return ok("none")
  }

  return splitTop(value, " ").every((part) => FILTERS.test(part))
    ? ok(value.replace(/\s+/g, " "))
    : refuse(
        "blur(), brightness(), contrast(), saturate(), grayscale(), sepia(), invert(), hue-rotate() and opacity()",
      )
}

/** `'Inter', 'Noto Sans JP', sans-serif`: names, quoted or bare. */
function family(text: string): Read {
  const names = splitTop(text, ",")

  if (names.length === 0 || names.some((name) => !/^(["'])[^"';{}<>]+\1$|^[A-Za-z][\w -]*$/.test(name))) {
    return refuse("font names, quoted when they have spaces, then a generic family")
  }

  return ok(names.join(", "))
}

function fontWeight(text: string): Read {
  const value = text.trim().toLowerCase()

  if (value === "normal") {
    return ok("400")
  }

  if (value === "bold") {
    return ok("700")
  }

  const weight = number(value)

  return weight !== undefined && weight >= 100 && weight <= 900 && weight % 100 === 0
    ? ok(String(weight))
    : refuse("100 to 900 in hundreds, normal or bold")
}

function lineHeight(text: string): Read {
  const value = text.trim()
  const factor = number(value)

  if (factor !== undefined) {
    return factor >= 0.5 && factor <= 4 ? ok(trim(factor)) : refuse("a factor from 0.5 to 4")
  }

  const share = percent(value)

  if (share !== undefined) {
    return share >= 50 && share <= 400 ? ok(trim(share / 100)) : refuse("a factor from 0.5 to 4")
  }

  return length(value, 4, 1600)
}

function letterSpacing(text: string): Read {
  const value = text.trim().toLowerCase()

  if (value === "normal") {
    return ok("normal")
  }

  const em = /^(-?(?:\d+\.?\d*|\.\d+))em$/.exec(value)

  if (em !== null) {
    return ok(`${trim(Number(em[1]))}em`)
  }

  return length(value, -24, 32)
}

/** `span 2`, the one form of placing a grid child. */
function gridSpan(text: string): Read {
  const match = /^span\s+(\d+)$/.exec(text.trim())

  return match !== null && Number(match[1]) >= 1 && Number(match[1]) <= 24
    ? ok(`span ${Number(match[1])}`)
    : refuse("`span N`: grid children fill in order")
}

/** `1fr 2fr`, `repeat(3, 1fr)`, `240px auto`: up to 24 tracks. */
function tracks(text: string): Read {
  const value = text.trim().replace(/\s+/g, " ")
  const expanded = value.replace(/repeat\(\s*(\d+)\s*,\s*([^()]+)\)/g, (_, count: string, track: string) =>
    Array.from({ length: Math.min(Number(count), 25) }, () => track.trim()).join(" "),
  )
  const parts = splitTop(expanded, " ")

  if (parts.length === 0 || parts.length > 24) {
    return refuse("1 to 24 tracks")
  }

  return parts.every(
    (part) =>
      part === "auto" ||
      /^\d+(\.\d+)?fr$/.test(part) ||
      readPixels(part) !== undefined ||
      percent(part) !== undefined,
  )
    ? ok(value)
    : refuse("tracks in px, %, fr or auto — no minmax(), auto-fill or names")
}

function flex(text: string): Read {
  const value = text.trim().toLowerCase()

  if (["none", "auto"].includes(value)) {
    return ok(value)
  }

  const parts = splitTop(value, " ")
  const basis = (part: string) =>
    part === "auto" || part === "content" || readPixels(part) !== undefined || percent(part) !== undefined
  // Every part is read: an unread last part is where a value carried a
  // declaration of its own past the subset.
  const valid =
    parts.length >= 1 &&
    parts.length <= 3 &&
    number(parts[0]!) !== undefined &&
    (parts.length < 2 || number(parts[1]!) !== undefined || (parts.length === 2 && basis(parts[1]!))) &&
    (parts.length < 3 || basis(parts[2]!))

  return valid ? ok(value) : refuse("none, auto, or grow [shrink] [basis]")
}

function aspectRatio(text: string): Read {
  const value = text.trim()

  return /^\d+(\.\d+)?(\s*\/\s*\d+(\.\d+)?)?$/.test(value)
    ? ok(value.replace(/\s*\/\s*/, " / "))
    : refuse("N or N / N")
}

/** `left`/`top` may also be `calc(50% - 120px)`, which is how a box is centred on a side. */
function offset(text: string): Read {
  const value = text.trim()
  const calc = /^calc\(\s*(-?[\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)$/.exec(value)

  if (calc !== null) {
    return ok(`calc(${trim(Number(calc[1]))}% ${calc[2]} ${trim(Number(calc[3]))}px)`)
  }

  return lengthOrPercent(value, ["auto"])
}

function textDecoration(text: string): Read {
  const parts = splitTop(text.trim().toLowerCase(), " ")
  const lines = ["none", "underline", "line-through"]
  const styles = ["solid", "double", "dotted", "dashed", "wavy"]

  return parts.length >= 1 &&
    lines.includes(parts[0]!) &&
    parts.slice(1).every((part) => styles.includes(part) || isColor(part))
    ? ok(parts.join(" "))
    : refuse("none, underline or line-through, then a style and a colour")
}

function textStroke(text: string): Read {
  const parts = splitTop(text.trim(), " ")
  const width = parts[0] === undefined ? undefined : readPixels(parts[0])

  return parts.length === 2 && width !== undefined && width >= 0 && width <= 8 && isColor(parts[1]!)
    ? ok(`${px(width)} ${parts[1]!.toLowerCase()}`)
    : refuse("a width up to 8px and a colour")
}

function textFillColor(text: string): Read {
  const value = text.trim().toLowerCase()

  return value === "transparent" || value === "currentcolor"
    ? ok(value)
    : refuse("transparent, with background-clip:text")
}

const ALIGN = ["start", "center", "end", "stretch", "baseline", "flex-start", "flex-end"]

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

const PROPERTIES: Record<string, PropertySpec> = {
  position: { targets: PLACED, read: keyword(["absolute", "relative"]), takes: "absolute | relative" },
  left: { targets: PLACED, read: offset, takes: "px, %, calc(% ± px) or auto" },
  top: { targets: PLACED, read: offset, takes: "px, %, calc(% ± px) or auto" },
  right: { targets: PLACED, read: (text) => lengthOrPercent(text, ["auto"]), takes: "px, % or auto" },
  bottom: { targets: PLACED, read: (text) => lengthOrPercent(text, ["auto"]), takes: "px, % or auto" },
  width: {
    targets: [...BOXES, "section"],
    read: (text) => lengthOrPercent(text, ["auto"]),
    takes: "px, % or auto",
  },
  height: {
    targets: [...BOXES, "section"],
    read: (text) => lengthOrPercent(text, ["auto"]),
    takes: "px, % or auto",
  },
  "min-width": {
    targets: BOXES,
    read: (text) => lengthOrPercent(text, ["min-content", "max-content"]),
    takes: "px, min-content or max-content",
  },
  "min-height": { targets: BOXES, read: (text) => length(text, 0), takes: "px" },
  "max-width": { targets: BOXES, read: (text) => length(text, 0), takes: "px" },
  "max-height": { targets: BOXES, read: (text) => length(text, 0), takes: "px" },
  display: { targets: CONTAINERS, read: keyword(["flex", "grid", "none"]), takes: "flex | grid | none" },
  "flex-direction": {
    targets: CONTAINERS,
    read: keyword(["row", "column", "row-reverse", "column-reverse"]),
    takes: "row | column [-reverse]",
  },
  "flex-wrap": { targets: CONTAINERS, read: keyword(["wrap", "nowrap"]), takes: "wrap | nowrap" },
  gap: { targets: CONTAINERS, read: (text) => length(text, 0, 512), takes: "one length from 0 to 512px" },
  "align-items": { targets: CONTAINERS, read: keyword(ALIGN), takes: ALIGN.join(" | ") },
  "justify-content": {
    targets: CONTAINERS,
    read: keyword([
      "start",
      "center",
      "end",
      "space-between",
      "space-around",
      "space-evenly",
      "flex-start",
      "flex-end",
    ]),
    takes: "start | center | end | space-between | space-around | space-evenly",
  },
  "justify-items": {
    targets: CONTAINERS,
    read: keyword(["start", "center", "end", "stretch"]),
    takes: "start | center | end | stretch",
  },
  "align-self": { targets: BOXES, read: keyword([...ALIGN, "auto"]), takes: `${ALIGN.join(" | ")} | auto` },
  "justify-self": {
    targets: BOXES,
    read: keyword(["start", "center", "end", "stretch", "auto"]),
    takes: "start | center | end | stretch | auto",
  },
  flex: { targets: BOXES, read: flex, takes: "none, auto, or grow [shrink] [basis]" },
  "flex-grow": { targets: BOXES, read: bounded(0, 100), takes: "a number" },
  "flex-shrink": { targets: BOXES, read: bounded(0, 100), takes: "a number" },
  "flex-basis": { targets: BOXES, read: (text) => lengthOrPercent(text, ["auto"]), takes: "px or auto" },
  "grid-template-columns": { targets: CONTAINERS, read: tracks, takes: "tracks in px, %, fr or auto" },
  "grid-template-rows": { targets: CONTAINERS, read: tracks, takes: "tracks in px, %, fr or auto" },
  "grid-column": { targets: BOXES, read: gridSpan, takes: "span N" },
  "grid-row": { targets: BOXES, read: gridSpan, takes: "span N" },
  "aspect-ratio": { targets: BOXES, read: aspectRatio, takes: "N or N / N" },
  padding: {
    targets: [...TYPE, "inline"],
    read: lengths(0, 256),
    takes: "one to four lengths from 0 to 256px",
  },
  overflow: { targets: ["div", "section"], read: keyword(["hidden", "visible"]), takes: "hidden | visible" },
  "font-family": { targets: [...TYPE, "inline"], read: family, takes: "font names, then a generic family" },
  "font-size": {
    targets: [...TYPE, "inline"],
    read: (text) => length(text, 8, 400),
    takes: "a size from 8 to 400px",
  },
  "font-weight": { targets: [...TYPE, "inline"], read: fontWeight, takes: "100 to 900, normal or bold" },
  "font-style": {
    targets: [...TYPE, "inline"],
    read: keyword(["normal", "italic"]),
    takes: "normal | italic",
  },
  "line-height": { targets: TYPE, read: lineHeight, takes: "a factor from 0.5 to 4, or px" },
  "letter-spacing": { targets: [...TYPE, "inline"], read: letterSpacing, takes: "px, em or normal" },
  "text-align": {
    targets: TYPE,
    read: keyword(["left", "center", "right", "justify", "start", "end"]),
    takes: "left | center | right | justify",
  },
  "text-transform": {
    targets: [...TYPE, "inline"],
    read: keyword(["none", "uppercase", "lowercase", "capitalize"]),
    takes: "none | uppercase | lowercase | capitalize",
  },
  "white-space": { targets: TYPE, read: keyword(["normal", "nowrap"]), takes: "normal | nowrap" },
  "text-decoration": {
    targets: [...TYPE, "inline"],
    read: textDecoration,
    takes: "none | underline | line-through [style] [colour]",
  },
  "font-variant-numeric": {
    targets: [...TYPE, "inline"],
    read: keyword(["normal", "tabular-nums"]),
    takes: "normal | tabular-nums",
  },
  "-webkit-text-stroke": { targets: ["text"], read: textStroke, takes: "a width and a colour" },
  "-webkit-text-fill-color": { targets: ["text", "inline"], read: textFillColor, takes: "transparent" },
  "background-clip": { targets: ["text"], read: keyword(["text", "border-box"]), takes: "text" },
  color: { targets: [...TYPE, "inline", "icon", "connector", "hr"], read: color, takes: "a colour" },
  background: {
    targets: [...PAINTED, "row", "shape", "hr", "inline"],
    read: background,
    takes: "a colour or one gradient",
  },
  border: { targets: [...PAINTED, "shape", "hr", "connector"], read: border, takes: "`2px solid #ccc`" },
  "border-top": { targets: [...PAINTED, "hr"], read: border, takes: "`2px solid #ccc`" },
  "border-right": { targets: PAINTED, read: border, takes: "`2px solid #ccc`" },
  "border-bottom": { targets: PAINTED, read: border, takes: "`2px solid #ccc`" },
  "border-left": { targets: PAINTED, read: border, takes: "`2px solid #ccc`" },
  "border-radius": {
    targets: [...PAINTED, "shape", "inline"],
    read: lengths(0, 2048, true),
    takes: "one to four lengths, or 50%",
  },
  "box-shadow": {
    targets: [...PAINTED, "shape"],
    read: shadow(true),
    takes: "x y [blur [spread]] colour, up to eight",
  },
  "text-shadow": {
    targets: [...TYPE, "inline"],
    read: shadow(false),
    takes: "x y [blur] colour, up to eight",
  },
  opacity: { targets: ALL, read: bounded(0, 1), takes: "0 to 1" },
  transform: {
    targets: [...PLACED, "section"],
    read: transform,
    takes: "translate(), rotate(), scale(), skew()",
  },
  filter: {
    targets: ["div", "text", "img", "shape", "svg"],
    read: filter,
    takes: "blur(), brightness(), … — no url()",
  },
  "backdrop-filter": { targets: ["div", "text"], read: filter, takes: "blur(), brightness(), … — no url()" },
  "mix-blend-mode": {
    targets: ["div", "text", "img", "shape", "svg"],
    read: keyword(["normal", "multiply", "screen", "overlay", "darken", "lighten"]),
    takes: "normal | multiply | screen | overlay | darken | lighten",
  },
  "object-fit": { targets: ["img"], read: keyword(["cover", "contain", "fill"]), takes: "cover | contain" },
  "object-position": {
    targets: ["img"],
    read: (text) =>
      splitTop(text, " ").every(
        (part) => percent(part) !== undefined || ["center", "top", "bottom", "left", "right"].includes(part),
      )
        ? ok(text.trim())
        : refuse("X% Y%"),
    takes: "X% Y%",
  },
}

/** Properties a model writes that mean one of the above, read as it. */
const ALIASES: Record<string, string> = {
  "background-color": "background",
  "background-image": "background",
  "grid-gap": "gap",
  "row-gap": "gap",
  "column-gap": "gap",
  "text-fill-color": "-webkit-text-fill-color",
  "-webkit-background-clip": "background-clip",
}

/** Properties dropped without a word: they change nothing on a slide, or nothing the subset can say differently. */
const SILENT = new Set([
  "box-sizing",
  "-webkit-font-smoothing",
  "-moz-osx-font-smoothing",
  "font-feature-settings",
  "text-rendering",
  "cursor",
  "user-select",
  "pointer-events",
  "list-style",
  "list-style-type",
])

/** What a property the subset leaves out should be instead, where there is an answer. */
const INSTEAD: Record<string, string> = {
  margin: "space boxes with the parent's gap and padding",
  "margin-top": "space boxes with the parent's gap and padding",
  "margin-bottom": "space boxes with the parent's gap and padding",
  "margin-left": "space boxes with the parent's gap and padding",
  "margin-right": "space boxes with the parent's gap and padding",
  "z-index": "later elements paint over earlier ones: order them instead",
  float: "use a flex row",
  "border-color": "write the whole stroke: `border:2px solid #ccc`",
  "border-width": "write the whole stroke: `border:2px solid #ccc`",
  "border-style": "write the whole stroke: `border:2px solid #ccc`",
  animation: "use data-build-in on a pinned element",
  transition: "use data-transition on the slide",
  "vertical-align": "align with a flex container's align-items",
  "word-break": "size the box to its longest word",
  "text-wrap": "size the box to its text",
}

/** One declaration, as read. */
export type DeckStyleRead =
  | { property: string; value: string }
  | { property: string; dropped: string; silent?: true }

/**
 * A `style` attribute, read against what `tag` may carry.
 *
 * Every declaration comes back: the ones kept with their normalized value,
 * the ones dropped with why — which is what the model is told. `font` is
 * spelled out into its parts, so the editor reads one property per thing it
 * sets.
 */
export function readDeckStyle(tag: string, style: string): DeckStyleRead[] {
  const target = styleTargetOf(tag)
  const read: DeckStyleRead[] = []

  for (const declaration of splitDeclarations(style)) {
    const colon = declaration.indexOf(":")

    if (colon === -1) {
      read.push({ property: declaration.trim(), dropped: "is not a declaration: write `property:value`" })
      continue
    }

    const written = declaration.slice(0, colon).trim().toLowerCase()
    let value = declaration.slice(colon + 1).trim()

    if (/!important$/i.test(value)) {
      value = value.replace(/\s*!important$/i, "")
    }

    if (written === "") {
      continue
    }

    if (written === "font") {
      read.push(...readFontShorthand(tag, value))
      continue
    }

    read.push(readDeclaration(target, tag, ALIASES[written] ?? written, value))
  }

  return read
}

function readDeclaration(
  target: DeckStyleTarget | undefined,
  tag: string,
  property: string,
  value: string,
): DeckStyleRead {
  if (SILENT.has(property)) {
    return { property, dropped: "", silent: true }
  }

  // `margin: 0` says nothing a slide would draw differently.
  if (property.startsWith("margin") && /^0(px)?(\s+0(px)?)*$/.test(value)) {
    return { property, dropped: "", silent: true }
  }

  const spec = PROPERTIES[property]

  if (spec === undefined) {
    const instead = INSTEAD[property]

    return { property, dropped: `is not in the slide subset${instead === undefined ? "" : `: ${instead}`}` }
  }

  if (target === undefined || !spec.targets.includes(target)) {
    return { property, dropped: `does not apply to <${tag}>` }
  }

  // A backslash is an escape to CSS — `\75rl(` is `url(` — and nothing in the
  // subset needs one, so a value holding one is not read past.
  if (/var\(|url\(|expression\(|\\/i.test(value)) {
    return { property, dropped: `${JSON.stringify(value)}: no var(), url(), expressions or escapes` }
  }

  const result = spec.read(value)

  return "refused" in result
    ? { property, dropped: `${JSON.stringify(value)} is not ${result.refused}` }
    : { property, value: result.value }
}

/** `italic 600 48px/1.1 'Inter', sans-serif` as its parts. */
function readFontShorthand(tag: string, value: string): DeckStyleRead[] {
  const target = styleTargetOf(tag)
  const match =
    /^((?:(?:italic|normal|bold|[1-9]00)\s+)*)([\d.]+(?:px|pt)?)(?:\s*\/\s*([\d.]+(?:px|%)?))?\s+(.+)$/i.exec(
      value.trim(),
    )

  if (match === null) {
    return [
      {
        property: "font",
        dropped: `${JSON.stringify(value)} is not [italic] [weight] size[/line-height] family`,
      },
    ]
  }

  const words = match[1]!.trim().split(/\s+/).filter(Boolean)
  const parts: [string, string][] = [
    ...(words.includes("italic") ? [["font-style", "italic"] as [string, string]] : []),
    ...words
      .filter((word) => word !== "italic" && word !== "normal")
      .map((word): [string, string] => ["font-weight", word]),
    ["font-size", match[2]!],
    ...(match[3] === undefined ? [] : [["line-height", match[3]] as [string, string]]),
    ["font-family", match[4]!],
  ]

  return parts.map(([property, part]) => readDeclaration(target, tag, property, part))
}

/** Declarations split at semicolons outside parentheses and quotes. */
function splitDeclarations(style: string) {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let escaped = false
  let current = ""

  for (const char of style) {
    if (quote !== undefined) {
      current += char
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === quote) {
        quote = undefined
      }
      continue
    }

    if (char === '"' || char === "'") {
      quote = char
    } else if (char === "(") {
      depth += 1
    } else if (char === ")") {
      depth -= 1
    } else if (char === ";" && depth === 0) {
      parts.push(current)
      current = ""
      continue
    }

    current += char
  }

  parts.push(current)

  return parts.filter((part) => part.trim() !== "")
}

/** A style map as an attribute: `left:120px;top:96px`. */
export function writeDeckStyle(style: Readonly<Record<string, string>>) {
  return Object.entries(style)
    .map(([property, value]) => `${property}:${value}`)
    .join(";")
}

/** Whether the subset knows a property at all, for the editor's inspector. */
export function isDeckStyleProperty(property: string) {
  return property in PROPERTIES
}

/** Whether a property may be set on `tag`, for the editor's inspector. */
export function deckStyleApplies(tag: string, property: string) {
  const target = styleTargetOf(tag)

  return target !== undefined && PROPERTIES[property]?.targets.includes(target) === true
}

/** A value checked for `property` on `tag` as the editor sets it: the normalized value, or undefined if refused. */
export function normalizeDeckStyleValue(tag: string, property: string, value: string): string | undefined {
  const read = readDeclaration(styleTargetOf(tag), tag, property, value)

  return "value" in read ? read.value : undefined
}
