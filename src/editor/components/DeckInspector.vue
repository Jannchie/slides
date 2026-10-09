<script setup lang="ts">
import { computed, ref, watch } from "vue"

import {
  DECK_ICON_NAMES,
  DECK_SHAPE_KINDS,
  DECK_TRANSITIONS,
  deckStyleApplies,
  elementAt,
  editTable,
  findDeckTheme,
  nodeAt,
  patchNodeStyle,
  patchStyle,
  readDeckNodes,
  readDeckStyle,
  readPixels,
  rotationOf,
  setAttribute,
  strokeOf,
  tableAt,
  updateAt,
  updateSlide,
  updateSlideChildren,
  withRotation,
  writeDeckNodes,
  writeDeckStyle,
  type Deck,
  type DeckElement,
  type DeckNode,
  type DeckPath,
  type DeckSvg,
  type DeckTransition,
  type TableEdit,
} from "../../index"
import { firstFamily, type Box } from "../../dom"
import { announce } from "../support/announce"

import { formatError, uploadable, useDeckAssets } from "../host"
import { t } from "../i18n"
import { themeName, useDeckThemes } from "../themes"
import DeckColorField from "./DeckColorField.vue"
import DeckInspectorRow from "./DeckInspectorRow.vue"
import DeckNumberField from "./DeckNumberField.vue"

/**
 * The format of what is selected, or of the slide and the deck when nothing
 * is: every control a presentation program's format pane offers that the
 * slide subset can say, and the subset's own escape hatch — the style written
 * out — for whatever the controls do not reach.
 *
 * Across several selected elements a control shows a value only when they all
 * share it, and setting one sets it on all of them.
 */
const props = defineProps<{
  deck: Deck
  slideIndex: number
  selection: readonly DeckPath[]
  editable: boolean
  measure: (path: DeckPath) => Box | undefined
}>()

const assets = useDeckAssets()

const emit = defineEmits<{
  commit: [deck: Deck, key?: string]
  seal: []
  pin: []
  nudge: [dx: number, dy: number]
  /** What should be selected after a change that moved what was. */
  select: [paths: DeckPath[]]
}>()

/** A field's name in the reader's language. */
type Field =
  | "position"
  | "rotation"
  | "pin"
  | "text"
  | "font"
  | "size"
  | "weight"
  | "color"
  | "uppercase"
  | "lineHeight"
  | "letterSpacing"
  | "fill"
  | "solid"
  | "gradient"
  | "from"
  | "to"
  | "angle"
  | "border"
  | "borderWidth"
  | "borderStyle"
  | "borderColor"
  | "radius"
  | "effects"
  | "opacity"
  | "shadow"
  | "layout"
  | "gap"
  | "padding"
  | "alignItems"
  | "justify"
  | "columns"
  | "image"
  | "replace"
  | "alt"
  | "shape"
  | "icon"
  | "connector"
  | "head"
  | "route"
  | "build"
  | "magicId"
  | "style"
  | "apply"
  | "slide"
  | "background"
  | "transition"
  | "sectionTitle"
  | "hidden"
  | "deck"
  | "fonts"
  | "addFont"
  | "slideHtml"
  | "dimensions"
  | "align"
  | "fit"
  | "altText"
  | "gridColumns"
  | "section"
  | "table"
  | "rows"
  | "spacing"
  | "theme"

const label = (name: Field) => t(`deck.field.${name}`)

const slide = computed(() => props.deck.slides[props.slideIndex])

/** The themes this editor offers, and the one the deck is drawn in. */
const themes = useDeckThemes()
const theme = computed(() => findDeckTheme(props.deck.theme, themes()))

type Styled = DeckElement | DeckSvg

const selected = computed<{ path: DeckPath; node: Styled }[]>(() => {
  const current = slide.value

  if (current === undefined) {
    return []
  }

  return props.selection.flatMap((path) => {
    const node = nodeAt(current.children, path)

    return node === undefined || node.type === "text" ? [] : [{ path, node }]
  })
})

const tagOf = (node: Styled) => (node.type === "svg" ? "svg" : node.tag)
const single = computed(() => (selected.value.length === 1 ? selected.value[0] : undefined))
const singleTag = computed(() => (single.value === undefined ? undefined : tagOf(single.value.node)))

/** Whether any selected element takes `property`. */
function applies(property: string) {
  return selected.value.some(({ node }) => deckStyleApplies(tagOf(node), property))
}

/** The value every selected element shares for `property`, or nothing when they differ or none set it. */
function common(property: string): string | undefined {
  const values = selected.value
    .filter(({ node }) => deckStyleApplies(tagOf(node), property))
    .map(({ node }) => node.style[property])

  return values.length > 0 && values.every((value) => value === values[0]) ? values[0] : undefined
}

function commonAttribute(name: string): string | undefined {
  const values = selected.value.map(({ node }) => node.attributes[name])

  return values.length > 0 && values.every((value) => value === values[0]) ? values[0] : undefined
}

function setStyle(patch: Record<string, string | undefined>, key = Object.keys(patch).join(",")) {
  if (!props.editable) {
    return
  }

  emit(
    "commit",
    updateSlideChildren(props.deck, props.slideIndex, (children) =>
      selected.value.reduce<DeckNode[]>(
        (nodes, { path, node }) => {
          const own = Object.fromEntries(
            Object.entries(patch).filter(([property]) => deckStyleApplies(tagOf(node), property)),
          )

          return Object.keys(own).length === 0
            ? nodes
            : updateAt(nodes, path, (current) => patchNodeStyle(current, own))
        },
        [...children],
      ),
    ),
    `style:${key}`,
  )
}

function setAttributeAll(name: string, value: string | undefined) {
  if (!props.editable) {
    return
  }

  emit(
    "commit",
    updateSlideChildren(props.deck, props.slideIndex, (children) =>
      selected.value.reduce<DeckNode[]>(
        (nodes, { path }) => updateAt(nodes, path, (current) => setAttribute(current, name, value)),
        [...children],
      ),
    ),
    `attribute:${name}`,
  )
  emit("seal")
}

function setSlideStyle(patch: Record<string, string | undefined>, key = Object.keys(patch).join(",")) {
  if (!props.editable) {
    return
  }

  emit(
    "commit",
    updateSlide(props.deck, props.slideIndex, (current) => ({
      ...current,
      style: patchStyle("section", current.style, patch),
    })),
    `slide:${key}`,
  )
}

function setDeck(next: Deck, key: string) {
  if (props.editable) {
    emit("commit", next, `deck:${key}`)
  }
}

/** Draw the deck in another theme: every colour that refers to a role follows. */
function setTheme(id: string) {
  setDeck({ ...props.deck, theme: id }, "theme")
  emit("seal")
}

/** A number typed into a field, as pixels. */
function numberOf(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)

  return Number.isFinite(value) ? value : undefined
}

function pixels(value: string | undefined) {
  return value === undefined ? "" : String(Math.round(readPixels(value) ?? 0))
}

// ---------------------------------------------------------------------------
// Position and size
// ---------------------------------------------------------------------------

const box = ref<Box>()

// Measured after the slide draws, which is after the tree changed.
watch(
  () => [props.deck, props.selection] as const,
  () => {
    requestAnimationFrame(() => {
      box.value = single.value === undefined ? undefined : props.measure(single.value.path)
    })
  },
  { immediate: true },
)

const pinned = computed(() => single.value?.node.style.position === "absolute")
const isConnector = computed(
  () => single.value?.node.type === "element" && single.value.node.tag === "x-connector",
)

function setX(event: Event) {
  const value = numberOf(event)

  if (value !== undefined && box.value !== undefined) {
    emit("nudge", value - box.value.x, 0)
    emit("seal")
  }
}

function setY(event: Event) {
  const value = numberOf(event)

  if (value !== undefined && box.value !== undefined) {
    emit("nudge", 0, value - box.value.y)
    emit("seal")
  }
}

function setSize(property: "width" | "height", event: Event) {
  const value = numberOf(event)

  if (value !== undefined && value > 0) {
    setStyle({ [property]: `${Math.round(value)}px` })
    emit("seal")
  }
}

function setRotation(event: Event) {
  const value = numberOf(event)

  if (value === undefined || single.value === undefined) {
    return
  }

  setStyle({ transform: withRotation(single.value.node.style.transform, value) })
  emit("seal")
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

/** The table the one selected thing is, or is inside, and the cell it is in. */
const table = computed(() => {
  const current = slide.value
  const path = props.selection.length === 1 ? props.selection[0] : undefined
  const found = current === undefined || path === undefined ? undefined : tableAt(current.children, path)
  const node =
    found === undefined || current === undefined ? undefined : elementAt(current.children, found.table)

  if (found === undefined || node === undefined) {
    return undefined
  }

  const rows = node.children.filter((row) => row.type === "element")
  const columns = Math.max(0, ...rows.map((row) => (row.type === "element" ? row.children.length : 0)))

  return { ...found, node, rows: rows.length, columns }
})

/** One edit to the table, the selection following the cell it was on. */
function changeTable(edit: TableEdit) {
  const path = props.selection[0]
  const current = slide.value

  if (!props.editable || path === undefined || current === undefined) {
    return
  }

  const result = editTable(current.children, path, edit)

  if (result !== undefined) {
    emit(
      "commit",
      updateSlideChildren(props.deck, props.slideIndex, () => result.nodes),
      "table",
    )
    emit("seal")
    emit("select", [result.selection])
  }
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

/** Faces offered by name: the system's, a few Google Fonts that cover Latin and CJK, and whatever the deck already loads. */
const FONT_PRESETS = [
  "system-ui, sans-serif",
  "Inter",
  "Noto Sans SC",
  "Noto Sans JP",
  "Noto Serif SC",
  "Source Serif 4",
  "Playfair Display",
  "Space Grotesk",
  "IBM Plex Sans",
  "DM Sans",
  "JetBrains Mono",
  "Georgia, serif",
]

const fontOptions = computed(() => {
  const loaded = props.deck.fontLinks.flatMap((href) =>
    [...href.matchAll(/family=([^:&]+)/g)].map((match) => decodeURIComponent(match[1]!.replace(/\+/g, " "))),
  )

  return [...new Set([...loaded, ...FONT_PRESETS])]
})

const GENERIC = new Set(["system-ui", "sans-serif", "serif", "monospace", "cursive", "Georgia"])

/** A face set by name: written with a generic fallback, and loaded from Google Fonts when it is one. */
function setFamily(family: string, target: "selection" | "deck") {
  const known = family.includes(",")
    ? family
    : `${/\s/.test(family) ? `'${family}'` : family}, ${/mono/i.test(family) ? "monospace" : /serif|playfair|georgia/i.test(family) && !/sans/i.test(family) ? "serif" : "sans-serif"}`
  const name = firstFamily(known) ?? family
  let deck = props.deck

  if (
    !GENERIC.has(name) &&
    !deck.fontLinks.some((href) => href.includes(`family=${name.replace(/ /g, "+")}`))
  ) {
    deck = {
      ...deck,
      fontLinks: [
        ...deck.fontLinks,
        `https://fonts.googleapis.com/css2?family=${name.replace(/ /g, "+")}:wght@400;500;600;700&display=swap`,
      ],
    }
  }

  if (target === "deck") {
    setDeck({ ...deck, style: patchStyle("body", deck.style, { "font-family": known }) }, "font")
  } else {
    emit(
      "commit",
      updateSlideChildren(deck, props.slideIndex, (children) =>
        selected.value.reduce<DeckNode[]>(
          (nodes, { path, node }) =>
            deckStyleApplies(tagOf(node), "font-family")
              ? updateAt(nodes, path, (current) => patchNodeStyle(current, { "font-family": known }))
              : nodes,
          [...children],
        ),
      ),
      "style:font-family",
    )
  }

  emit("seal")
}

const WEIGHTS = ["300", "400", "500", "600", "700", "800", "900"]
const ALIGNS = ["left", "center", "right", "justify"] as const

// Written out whole, because UnoCSS finds an icon by reading its class name in the source.
const ALIGN_ICONS: Record<(typeof ALIGNS)[number], string> = {
  left: "i-jannchie-align-left",
  center: "i-jannchie-align-center",
  right: "i-jannchie-align-right",
  justify: "i-jannchie-align-justify",
}

// ---------------------------------------------------------------------------
// Fill, border and effects
// ---------------------------------------------------------------------------

const fill = computed(() => common("background"))
const GRADIENT = /^linear-gradient\((-?[\d.]+)deg, (\S+(?:\([^)]*\))?) 0%, (\S+(?:\([^)]*\))?) 100%\)$/
const gradient = computed(() => {
  const match = fill.value === undefined ? null : GRADIENT.exec(fill.value)

  return match === null ? undefined : { angle: Number(match[1]), from: match[2]!, to: match[3]! }
})
const fillKind = computed(() => (fill.value?.includes("gradient(") ? "gradient" : "solid"))
/**
 * What a control shows when the selection has no value of its own: across
 * several that differ, "mixed"; on one, nothing — it is taking what it is
 * inside, which is not a value to report.
 */
const unset = computed(() => (selected.value.length > 1 ? t("deck.mixed") : ""))

/** A row or a cell: placed by its table, so it has no position or size of its own to set. */
const inTable = computed(() => ["tr", "td", "th"].includes(singleTag.value ?? ""))

const slideFillKind = computed(() =>
  slide.value?.style.background?.includes("gradient(") ? "gradient" : "solid",
)

function setGradient(part: Partial<{ angle: number; from: string; to: string }>) {
  const current = gradient.value ?? {
    angle: 135,
    from: fill.value && !fill.value.includes("(") ? fill.value : "#2563eb",
    to: "#7c3aed",
  }
  const next = { ...current, ...part }

  setStyle(
    { background: `linear-gradient(${next.angle}deg, ${next.from} 0%, ${next.to} 100%)` },
    "background",
  )
}

function setFillKind(kind: "solid" | "gradient") {
  if (kind === "gradient") {
    setGradient({})
  } else {
    setStyle({ background: gradient.value?.from ?? "#ffffff" }, "background")
  }

  emit("seal")
}

const border = computed(() => strokeOf(common("border")))

function setBorder(part: Partial<{ width: number; style: string; color: string }>) {
  const current = border.value ?? { width: 2, style: "solid", color: "#d4d4d8" }
  const next = { ...current, ...part }

  setStyle({ border: next.width <= 0 ? undefined : `${next.width}px ${next.style} ${next.color}` }, "border")
}

/** A connector's stroke with its width or its style changed, in the connector's own colour. */
function setConnectorStroke(part: { width?: number; style?: string }) {
  const node = single.value?.node

  if (node === undefined) {
    return
  }

  const stroke = strokeOf(node.style.border)

  setStyle({
    border: `${part.width ?? stroke?.width ?? 3}px ${part.style ?? stroke?.style ?? "solid"} ${node.style.color ?? "#1d1d1f"}`,
  })
  emit("seal")
}

const SHADOWS = {
  none: undefined,
  soft: "0 8px 24px rgba(0,0,0,0.12)",
  medium: "0 16px 40px rgba(0,0,0,0.18)",
  strong: "0 24px 64px rgba(0,0,0,0.28)",
} as const satisfies Record<string, string | undefined>

type ShadowName = keyof typeof SHADOWS

const SHADOW_NAMES = Object.keys(SHADOWS) as ShadowName[]

const shadow = computed(() => {
  const value = common("box-shadow")

  return (
    Object.entries(SHADOWS).find(([, candidate]) => candidate === value)?.[0] ??
    (value === undefined ? "none" : "custom")
  )
})

// ---------------------------------------------------------------------------
// Containers, pictures, shapes, arrows and builds
// ---------------------------------------------------------------------------

const isContainer = computed(
  () =>
    selected.value.length > 0 &&
    selected.value.every(({ node }) => node.type === "element" && node.tag === "div"),
)

function layoutOf(style: Record<string, string | undefined>) {
  return style.display === "grid"
    ? "grid"
    : style.display === "flex" && style["flex-direction"]?.startsWith("row")
      ? "row"
      : "column"
}

const containerLayout = computed(() =>
  single.value === undefined ? undefined : layoutOf(single.value.node.style),
)

function setLayout(kind: "column" | "row" | "grid", target: "selection" | "slide") {
  const patch =
    kind === "grid"
      ? { display: "grid", "flex-direction": undefined, "grid-template-columns": "1fr 1fr" }
      : {
          display: kind === "row" ? "flex" : undefined,
          "flex-direction": kind === "row" ? "row" : undefined,
          "grid-template-columns": undefined,
        }

  if (target === "slide") {
    setSlideStyle(patch, "layout")
  } else {
    setStyle(patch, "layout")
  }

  emit("seal")
}

const ALIGN_ITEMS = ["start", "center", "end", "stretch"]
const JUSTIFY = ["start", "center", "end", "space-between", "space-around", "space-evenly"]
const BUILDS = ["fade", "rise", "drop", "left", "right", "scale", "pop"] as const

const imageInput = ref<HTMLInputElement>()

async function replaceImage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]

  input.value = ""

  if (file === undefined) {
    return
  }

  try {
    setAttributeAll("src", await assets.upload(await uploadable(file)))
  } catch (error) {
    announce(t("deck.uploadFailed", { error: formatError(error) }), { assertive: true })
  }
}

// ---------------------------------------------------------------------------
// The style written out, and the slide's markup
// ---------------------------------------------------------------------------

const styleText = ref("")
const styleDropped = ref<string[]>([])

watch(
  () => single.value?.node,
  (node) => {
    styleText.value = node === undefined ? "" : writeDeckStyle(node.style).replace(/;/g, ";\n")
    styleDropped.value = []
  },
  { immediate: true },
)

function applyStyleText() {
  const current = single.value

  if (current === undefined) {
    return
  }

  const read = readDeckStyle(tagOf(current.node), styleText.value.replace(/\n/g, ""))
  const style: Record<string, string> = {}

  for (const declaration of read) {
    if ("value" in declaration) {
      style[declaration.property] = declaration.value
    }
  }

  styleDropped.value = read.flatMap((declaration) =>
    "dropped" in declaration && declaration.silent !== true
      ? [`${declaration.property} ${declaration.dropped}`]
      : [],
  )
  emit(
    "commit",
    updateSlideChildren(props.deck, props.slideIndex, (children) =>
      updateAt([...children], current.path, (node) => (node.type === "text" ? node : { ...node, style })),
    ),
    "style-text",
  )
  emit("seal")
}

const slideMarkup = ref("")
const markupOpen = ref(false)

// The text is the slide on screen as it is now: re-read when the panel opens,
// and whenever the slide it shows changes under it — another slide picked, an
// edit on the stage, the model's next version — so Apply never writes back
// markup read from somewhere else.
watch([markupOpen, () => slide.value?.children] as const, ([open, children]) => {
  if (open && children !== undefined) {
    slideMarkup.value = writeDeckNodes(children)
  }
})

function applySlideMarkup() {
  emit(
    "commit",
    updateSlideChildren(props.deck, props.slideIndex, () => readDeckNodes(slideMarkup.value)),
    "slide-markup",
  )
  emit("seal")
}

const newFont = ref("")

function addFont() {
  const family = newFont.value.trim()

  if (family === "" || !/^[A-Za-z][\w ]{0,39}$/.test(family)) {
    return
  }

  setDeck(
    {
      ...props.deck,
      fontLinks: [
        ...props.deck.fontLinks,
        `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@400;500;600;700&display=swap`,
      ],
    },
    "fonts",
  )
  emit("seal")
  newFont.value = ""
}

function removeFont(href: string) {
  setDeck(
    { ...props.deck, fontLinks: props.deck.fontLinks.filter((candidate) => candidate !== href) },
    "fonts",
  )
  emit("seal")
}

function fontName(href: string) {
  return [...href.matchAll(/family=([^:&]+)/g)]
    .map((match) => decodeURIComponent(match[1]!.replace(/\+/g, " ")))
    .join(", ")
}

/** The slide's background made a colour or a gradient, starting from what it was. */
function setSlideFill(kind: "solid" | "gradient") {
  const current = slide.value?.style.background

  setSlideStyle({
    background:
      kind === "gradient"
        ? `linear-gradient(135deg, ${current === undefined || current.includes("(") ? "#0f172a" : current} 0%, #1e3a8a 100%)`
        : "#ffffff",
  })
  emit("seal")
}

function setTransition(value: string) {
  emit(
    "commit",
    updateSlide(props.deck, props.slideIndex, (current) => {
      const { transition: _, ...rest } = current

      return value === "none" ? rest : { ...current, transition: value as DeckTransition }
    }),
    "slide:transition",
  )
  emit("seal")
}

function setSlideSection(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim()

  emit(
    "commit",
    updateSlide(props.deck, props.slideIndex, (current) => {
      const { section: _, ...rest } = current

      return value === "" ? rest : { ...current, section: value }
    }),
    "slide:section",
  )
}

function setHidden(event: Event) {
  const hidden = (event.target as HTMLInputElement).checked

  emit(
    "commit",
    updateSlide(props.deck, props.slideIndex, (current) => {
      const { hidden: _, ...rest } = current

      return hidden ? { ...current, hidden: true } : rest
    }),
    "slide:hidden",
  )
  emit("seal")
}
</script>

<template>
  <aside
    class="min-h-0 overflow-y-auto bg-slides-panel text-[length:var(--slides-font-size)] text-slides-text"
    :aria-label="t('deck.inspector')"
    :inert="!editable"
  >
    <!-- The selection. -->
    <template v-if="selected.length > 0">
      <section v-if="single && !isConnector && !inTable" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("position") }}</h3>
        <DeckInspectorRow :label="label('position')">
          <DeckNumberField
            prefix="X"
            :label="`${label('position')} X`"
            :value="box ? Math.round(box.x) : ''"
            @change="setX"
          />
          <DeckNumberField
            prefix="Y"
            :label="`${label('position')} Y`"
            :value="box ? Math.round(box.y) : ''"
            @change="setY"
          />
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('dimensions')">
          <DeckNumberField
            prefix="W"
            :label="`${label('dimensions')} W`"
            :min="1"
            :value="box ? Math.round(box.w) : ''"
            @change="setSize('width', $event)"
          />
          <DeckNumberField
            prefix="H"
            :label="`${label('dimensions')} H`"
            :min="1"
            :value="box ? Math.round(box.h) : ''"
            @change="setSize('height', $event)"
          />
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('rotation')">
          <DeckNumberField
            prefix="i-jannchie-rotate"
            unit="°"
            :label="label('rotation')"
            :value="Math.round(rotationOf(single.node.style))"
            @change="setRotation"
          />
          <span class="min-w-0 flex-1" />
        </DeckInspectorRow>
        <button v-if="!pinned" type="button" class="slides-button w-full" @click="emit('pin')">
          <i class="i-jannchie-pin-diagonal h-3.5 w-3.5" aria-hidden="true" />
          {{ label("pin") }}
        </button>
      </section>

      <section v-if="table" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("table") }}</h3>
        <DeckInspectorRow :label="label('rows')">
          <button
            type="button"
            class="slides-button min-w-0 flex-1"
            :title="t('deck.table.rowAbove')"
            @click="changeTable('rowAbove')"
          >
            <i class="i-jannchie-plus h-3.5 w-3.5" aria-hidden="true" />{{ t("deck.table.above") }}
          </button>
          <button
            type="button"
            class="slides-button min-w-0 flex-1"
            :title="t('deck.table.rowBelow')"
            @click="changeTable('rowBelow')"
          >
            <i class="i-jannchie-plus h-3.5 w-3.5" aria-hidden="true" />{{ t("deck.table.below") }}
          </button>
          <button
            type="button"
            class="slides-icon-button"
            :title="t('deck.table.removeRow')"
            :aria-label="t('deck.table.removeRow')"
            :disabled="table.rows <= 1"
            @click="changeTable('removeRow')"
          >
            <i class="i-jannchie-trash h-4 w-4" aria-hidden="true" />
          </button>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('gridColumns')">
          <button
            type="button"
            class="slides-button min-w-0 flex-1"
            :title="t('deck.table.columnLeft')"
            @click="changeTable('columnLeft')"
          >
            <i class="i-jannchie-plus h-3.5 w-3.5" aria-hidden="true" />{{ t("deck.table.left") }}
          </button>
          <button
            type="button"
            class="slides-button min-w-0 flex-1"
            :title="t('deck.table.columnRight')"
            @click="changeTable('columnRight')"
          >
            <i class="i-jannchie-plus h-3.5 w-3.5" aria-hidden="true" />{{ t("deck.table.right") }}
          </button>
          <button
            type="button"
            class="slides-icon-button"
            :title="t('deck.table.removeColumn')"
            :aria-label="t('deck.table.removeColumn')"
            :disabled="table.columns <= 1"
            @click="changeTable('removeColumn')"
          >
            <i class="i-jannchie-trash h-4 w-4" aria-hidden="true" />
          </button>
        </DeckInspectorRow>
        <p class="slides-muted">
          {{ table.row === undefined ? t("deck.table.hint") : t("deck.table.atCell") }}
        </p>
      </section>

      <section v-if="applies('font-size')" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("text") }}</h3>
        <DeckInspectorRow :label="label('font')">
          <select
            class="slides-field"
            :value="firstFamily(common('font-family')) ?? ''"
            :aria-label="label('font')"
            @change="setFamily(($event.target as HTMLSelectElement).value, 'selection')"
          >
            <option value="" disabled>{{ unset }}</option>
            <option v-for="family in fontOptions" :key="family" :value="firstFamily(family)">
              {{ firstFamily(family) }}
            </option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('size')">
          <DeckNumberField
            unit="px"
            :min="8"
            :max="400"
            :label="label('size')"
            :value="pixels(common('font-size'))"
            :placeholder="unset"
            @change="
              ($event) => {
                setStyle({ 'font-size': `${numberOf($event)}px` })
                emit('seal')
              }
            "
          />
          <select
            class="slides-field min-w-0 flex-1"
            :value="common('font-weight') ?? ''"
            :aria-label="label('weight')"
            :title="label('weight')"
            @change="
              ($event) => {
                setStyle({ 'font-weight': ($event.target as HTMLSelectElement).value })
                emit('seal')
              }
            "
          >
            <option value="" disabled>{{ label("weight") }}</option>
            <option v-for="weight in WEIGHTS" :key="weight" :value="weight">{{ weight }}</option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('color')">
          <DeckColorField
            :theme="theme"
            :placeholder="unset"
            :value="common('color')"
            :label="label('color')"
            @change="(value) => setStyle({ color: value }, 'color')"
            @done="emit('seal')"
          />
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('align')">
          <div class="slides-segmented min-w-0 flex-1" role="group" :aria-label="label('align')">
            <button
              v-for="align in ALIGNS"
              :key="align"
              type="button"
              class="slides-segment"
              :class="{ 'slides-segment-on': common('text-align') === align }"
              :title="t(`deck.align.text.${align}`)"
              :aria-label="t(`deck.align.text.${align}`)"
              :aria-pressed="common('text-align') === align"
              @click="
                () => {
                  setStyle({ 'text-align': common('text-align') === align ? undefined : align })
                  emit('seal')
                }
              "
            >
              <i :class="ALIGN_ICONS[align]" class="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            class="slides-icon-button border border-slides-line"
            :class="{ 'slides-pressed': common('text-transform') === 'uppercase' }"
            :title="label('uppercase')"
            :aria-label="label('uppercase')"
            :aria-pressed="common('text-transform') === 'uppercase'"
            @click="
              () => {
                setStyle({
                  'text-transform': common('text-transform') === 'uppercase' ? undefined : 'uppercase',
                })
                emit('seal')
              }
            "
          >
            <i class="i-jannchie-typography h-4 w-4" aria-hidden="true" />
          </button>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('spacing')">
          <DeckNumberField
            prefix="i-jannchie-line-height"
            :step="0.05"
            :min="0.5"
            :max="4"
            :label="label('lineHeight')"
            :value="common('line-height') ?? ''"
            @change="
              ($event) => {
                setStyle({ 'line-height': String(numberOf($event)) })
                emit('seal')
              }
            "
          />
          <DeckNumberField
            prefix="i-jannchie-letter-spacing"
            unit="px"
            :step="0.5"
            :label="label('letterSpacing')"
            :value="pixels(common('letter-spacing'))"
            @change="
              ($event) => {
                setStyle({ 'letter-spacing': `${numberOf($event)}px` })
                emit('seal')
              }
            "
          />
        </DeckInspectorRow>
      </section>

      <section v-if="applies('background') && !isConnector" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("fill") }}</h3>
        <DeckInspectorRow :label="label('fill')">
          <div class="slides-segmented min-w-0 flex-1" role="group" :aria-label="label('fill')">
            <button
              v-for="kind in ['solid', 'gradient'] as const"
              :key="kind"
              type="button"
              class="slides-segment"
              :class="{ 'slides-segment-on': fillKind === kind }"
              :aria-pressed="fillKind === kind"
              @click="setFillKind(kind)"
            >
              {{ label(kind) }}
            </button>
          </div>
        </DeckInspectorRow>
        <DeckInspectorRow v-if="fillKind === 'solid'" :label="label('color')">
          <DeckColorField
            :theme="theme"
            :placeholder="unset"
            :value="fill"
            :label="label('fill')"
            clearable
            @change="(value) => setStyle({ background: value }, 'background')"
            @done="emit('seal')"
          />
        </DeckInspectorRow>
        <template v-else-if="gradient">
          <DeckInspectorRow :label="label('from')">
            <DeckColorField
              :theme="theme"
              :placeholder="unset"
              :value="gradient.from"
              :label="label('from')"
              @change="(value) => value && setGradient({ from: value })"
              @done="emit('seal')"
            />
          </DeckInspectorRow>
          <DeckInspectorRow :label="label('to')">
            <DeckColorField
              :theme="theme"
              :placeholder="unset"
              :value="gradient.to"
              :label="label('to')"
              @change="(value) => value && setGradient({ to: value })"
              @done="emit('seal')"
            />
          </DeckInspectorRow>
          <DeckInspectorRow :label="label('angle')">
            <DeckNumberField
              prefix="i-jannchie-rotate"
              unit="°"
              :label="label('angle')"
              :value="gradient.angle"
              @change="
                ($event) => {
                  setGradient({ angle: numberOf($event) ?? 135 })
                  emit('seal')
                }
              "
            />
            <span class="min-w-0 flex-1" />
          </DeckInspectorRow>
        </template>
        <p v-else class="break-all slides-muted slides-num">{{ fill }}</p>
      </section>

      <section v-if="applies('border') && !isConnector" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("border") }}</h3>
        <DeckInspectorRow :label="label('borderWidth')">
          <DeckNumberField
            unit="px"
            :min="0"
            :max="32"
            :label="label('borderWidth')"
            :value="border?.width ?? 0"
            @change="
              ($event) => {
                setBorder({ width: numberOf($event) ?? 0 })
                emit('seal')
              }
            "
          />
          <select
            class="slides-field min-w-0 flex-1"
            :value="border?.style ?? 'solid'"
            :aria-label="label('borderStyle')"
            :title="label('borderStyle')"
            @change="
              ($event) => {
                setBorder({ style: ($event.target as HTMLSelectElement).value })
                emit('seal')
              }
            "
          >
            <option
              v-for="style in ['solid', 'dashed', 'dotted', 'double'] as const"
              :key="style"
              :value="style"
            >
              {{ t(`deck.stroke.${style}`) }}
            </option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('color')">
          <DeckColorField
            :theme="theme"
            :placeholder="unset"
            :value="border?.color"
            :label="label('borderColor')"
            @change="(value) => value && setBorder({ color: value })"
            @done="emit('seal')"
          />
        </DeckInspectorRow>
        <DeckInspectorRow v-if="applies('border-radius')" :label="label('radius')">
          <DeckNumberField
            prefix="i-jannchie-corner-radius"
            unit="px"
            :min="0"
            :label="label('radius')"
            :value="pixels(common('border-radius'))"
            @change="
              ($event) => {
                setStyle({ 'border-radius': `${numberOf($event)}px` })
                emit('seal')
              }
            "
          />
          <span class="min-w-0 flex-1" />
        </DeckInspectorRow>
      </section>

      <section class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("effects") }}</h3>
        <DeckInspectorRow :label="label('opacity')">
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="h-[var(--slides-control-height)] min-w-0 flex-1"
            :value="common('opacity') ?? '1'"
            :aria-label="label('opacity')"
            @input="
              setStyle(
                {
                  opacity:
                    ($event.target as HTMLInputElement).value === '1'
                      ? undefined
                      : ($event.target as HTMLInputElement).value,
                },
                'opacity',
              )
            "
            @change="emit('seal')"
          />
          <span class="w-9 shrink-0 text-right slides-ink-2 slides-num">
            {{ Math.round(Number(common("opacity") ?? 1) * 100) }}%
          </span>
        </DeckInspectorRow>
        <DeckInspectorRow v-if="applies('box-shadow')" :label="label('shadow')">
          <select
            class="slides-field"
            :value="shadow"
            :aria-label="label('shadow')"
            @change="
              ($event) => {
                setStyle({ 'box-shadow': SHADOWS[($event.target as HTMLSelectElement).value as ShadowName] })
                emit('seal')
              }
            "
          >
            <option v-for="name in SHADOW_NAMES" :key="name" :value="name">
              {{ t(`deck.shadow.${name}`) }}
            </option>
            <option v-if="shadow === 'custom'" value="custom" disabled>
              {{ t("deck.shadow.custom") }}
            </option>
          </select>
        </DeckInspectorRow>
      </section>

      <section v-if="isContainer && single" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("layout") }}</h3>
        <DeckInspectorRow :label="label('layout')">
          <div class="slides-segmented min-w-0 flex-1" role="group" :aria-label="label('layout')">
            <button
              v-for="kind in ['column', 'row', 'grid'] as const"
              :key="kind"
              type="button"
              class="slides-segment"
              :class="{ 'slides-segment-on': containerLayout === kind }"
              :aria-pressed="containerLayout === kind"
              @click="setLayout(kind, 'selection')"
            >
              {{ t(`deck.layout.${kind}`) }}
            </button>
          </div>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('spacing')">
          <DeckNumberField
            prefix="i-jannchie-layout-columns"
            unit="px"
            :min="0"
            :max="512"
            :label="label('gap')"
            :value="pixels(common('gap'))"
            @change="
              ($event) => {
                setStyle({ gap: `${numberOf($event)}px` })
                emit('seal')
              }
            "
          />
          <DeckNumberField
            prefix="i-jannchie-fit-to-screen"
            unit="px"
            :min="0"
            :max="256"
            :label="label('padding')"
            :value="pixels(common('padding')?.split(' ')[0])"
            @change="
              ($event) => {
                setStyle({ padding: `${numberOf($event)}px` })
                emit('seal')
              }
            "
          />
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('alignItems')">
          <select
            class="slides-field"
            :value="common('align-items') ?? ''"
            :aria-label="label('alignItems')"
            @change="
              ($event) => {
                setStyle({ 'align-items': ($event.target as HTMLSelectElement).value || undefined })
                emit('seal')
              }
            "
          >
            <option value="">—</option>
            <option v-for="value in ALIGN_ITEMS" :key="value" :value="value">{{ value }}</option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('justify')">
          <select
            class="slides-field"
            :value="common('justify-content') ?? ''"
            :aria-label="label('justify')"
            @change="
              ($event) => {
                setStyle({ 'justify-content': ($event.target as HTMLSelectElement).value || undefined })
                emit('seal')
              }
            "
          >
            <option value="">—</option>
            <option v-for="value in JUSTIFY" :key="value" :value="value">{{ value }}</option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow v-if="containerLayout === 'grid'" :label="label('gridColumns')">
          <input
            class="slides-field slides-num"
            :value="common('grid-template-columns') ?? ''"
            :placeholder="label('columns')"
            :aria-label="label('columns')"
            @change="
              ($event) => {
                setStyle({ 'grid-template-columns': ($event.target as HTMLInputElement).value || undefined })
                emit('seal')
              }
            "
          />
        </DeckInspectorRow>
      </section>

      <section v-if="singleTag === 'img'" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("image") }}</h3>
        <button type="button" class="slides-button w-full" @click="imageInput?.click()">
          <i class="i-jannchie-image h-3.5 w-3.5" aria-hidden="true" />
          {{ label("replace") }}
        </button>
        <input ref="imageInput" type="file" accept="image/*" class="hidden" @change="replaceImage" />
        <DeckInspectorRow :label="label('fit')">
          <div class="slides-segmented min-w-0 flex-1" role="group" :aria-label="label('fit')">
            <button
              v-for="fit in ['cover', 'contain'] as const"
              :key="fit"
              type="button"
              class="slides-segment"
              :class="{ 'slides-segment-on': (common('object-fit') ?? 'cover') === fit }"
              :aria-pressed="(common('object-fit') ?? 'cover') === fit"
              @click="
                () => {
                  setStyle({ 'object-fit': fit })
                  emit('seal')
                }
              "
            >
              {{ t(`deck.fit.${fit}`) }}
            </button>
          </div>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('altText')">
          <input
            class="slides-field"
            :value="commonAttribute('alt') ?? ''"
            :placeholder="label('alt')"
            :aria-label="label('alt')"
            @change="setAttributeAll('alt', ($event.target as HTMLInputElement).value)"
          />
        </DeckInspectorRow>
      </section>

      <section v-if="singleTag === 'x-shape'" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("shape") }}</h3>
        <DeckInspectorRow :label="label('shape')">
          <select
            class="slides-field"
            :value="commonAttribute('kind')"
            :aria-label="label('shape')"
            @change="setAttributeAll('kind', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="kind in DECK_SHAPE_KINDS" :key="kind" :value="kind">
              {{ t(`deck.shape.${kind}`) }}
            </option>
          </select>
        </DeckInspectorRow>
      </section>

      <section v-if="singleTag === 'x-icon'" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("icon") }}</h3>
        <DeckInspectorRow :label="label('icon')">
          <select
            class="slides-field"
            :value="commonAttribute('name')"
            :aria-label="label('icon')"
            @change="setAttributeAll('name', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="name in DECK_ICON_NAMES" :key="name" :value="name">{{ name }}</option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('color')">
          <DeckColorField
            :theme="theme"
            :placeholder="unset"
            :value="common('color')"
            :label="label('color')"
            @change="(value) => setStyle({ color: value }, 'color')"
            @done="emit('seal')"
          />
        </DeckInspectorRow>
      </section>

      <section v-if="isConnector && single" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("connector") }}</h3>
        <DeckInspectorRow :label="label('color')">
          <DeckColorField
            :theme="theme"
            :placeholder="unset"
            :value="common('color')"
            :label="label('color')"
            @change="(value) => setStyle({ color: value }, 'color')"
            @done="emit('seal')"
          />
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('head')">
          <select
            class="slides-field"
            :value="commonAttribute('head') ?? 'end'"
            :aria-label="label('head')"
            @change="setAttributeAll('head', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="head in ['end', 'both', 'none'] as const" :key="head" :value="head">
              {{ t(`deck.head.${head}`) }}
            </option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('route')">
          <select
            class="slides-field"
            :value="commonAttribute('route') ?? 'straight'"
            :aria-label="label('route')"
            @change="setAttributeAll('route', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="route in ['straight', 'hv', 'vh', 'elbow'] as const" :key="route" :value="route">
              {{ t(`deck.route.${route}`) }}
            </option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('borderWidth')">
          <DeckNumberField
            unit="px"
            :min="1"
            :max="32"
            :label="label('borderWidth')"
            :value="strokeOf(single.node.style.border)?.width ?? 3"
            @change="setConnectorStroke({ width: numberOf($event) ?? 3 })"
          />
          <select
            class="slides-field min-w-0 flex-1"
            :value="strokeOf(single.node.style.border)?.style ?? 'solid'"
            :aria-label="label('borderStyle')"
            :title="label('borderStyle')"
            @change="setConnectorStroke({ style: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="style in ['solid', 'dashed', 'dotted'] as const" :key="style" :value="style">
              {{ t(`deck.stroke.${style}`) }}
            </option>
          </select>
        </DeckInspectorRow>
      </section>

      <section v-if="single && pinned" class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("build") }}</h3>
        <DeckInspectorRow :label="label('build')">
          <select
            class="slides-field"
            :value="(commonAttribute('data-build-in') ?? '').split(' ')[0] || ''"
            :aria-label="label('build')"
            @change="
              setAttributeAll('data-build-in', ($event.target as HTMLSelectElement).value || undefined)
            "
          >
            <option value="">{{ t("deck.build.none") }}</option>
            <option v-for="build in BUILDS" :key="build" :value="build">
              {{ t(`deck.build.${build}`) }}
            </option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('magicId')">
          <input
            class="slides-field slides-num"
            :value="commonAttribute('id') ?? ''"
            :aria-label="label('magicId')"
            @change="
              setAttributeAll(
                'id',
                ($event.target as HTMLInputElement).value.trim().replace(/[^\w-]/g, '-') || undefined,
              )
            "
          />
        </DeckInspectorRow>
      </section>

      <details v-if="single" class="slides-inspector-section group">
        <summary class="flex cursor-pointer list-none items-center gap-1.5 slides-inspector-heading">
          <i class="i-jannchie-chevron-right slides-chevron group-open:rotate-90" aria-hidden="true" />
          {{ label("style") }}
        </summary>
        <textarea
          v-model="styleText"
          class="slides-field h-32 py-1.5 text-[11px] slides-num"
          spellcheck="false"
          :aria-label="label('style')"
        />
        <p v-for="line in styleDropped" :key="line" class="slides-warning">{{ line }}</p>
        <button type="button" class="slides-button w-full" @click="applyStyleText">
          {{ label("apply") }}
        </button>
      </details>
    </template>

    <!-- Nothing selected: the slide, and the deck. -->
    <template v-else-if="slide">
      <section class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("slide") }}</h3>
        <DeckInspectorRow :label="label('background')">
          <div class="slides-segmented min-w-0 flex-1" role="group" :aria-label="label('background')">
            <button
              v-for="kind in ['solid', 'gradient'] as const"
              :key="kind"
              type="button"
              class="slides-segment"
              :class="{ 'slides-segment-on': slideFillKind === kind }"
              :aria-pressed="slideFillKind === kind"
              @click="setSlideFill(kind)"
            >
              {{ label(kind) }}
            </button>
          </div>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('color')">
          <DeckColorField
            :theme="theme"
            :placeholder="unset"
            v-if="slideFillKind === 'solid'"
            :value="slide.style.background"
            :label="label('background')"
            @change="(value) => setSlideStyle({ background: value ?? '#ffffff' }, 'background')"
            @done="emit('seal')"
          />
          <input
            v-else
            class="slides-field slides-num"
            :value="slide.style.background"
            :aria-label="label('background')"
            @change="
              ($event) => {
                setSlideStyle({ background: ($event.target as HTMLInputElement).value })
                emit('seal')
              }
            "
          />
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('layout')">
          <div class="slides-segmented min-w-0 flex-1" role="group" :aria-label="label('layout')">
            <button
              v-for="kind in ['column', 'row', 'grid'] as const"
              :key="kind"
              type="button"
              class="slides-segment"
              :class="{ 'slides-segment-on': layoutOf(slide.style) === kind }"
              :aria-pressed="layoutOf(slide.style) === kind"
              @click="setLayout(kind, 'slide')"
            >
              {{ t(`deck.layout.${kind}`) }}
            </button>
          </div>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('spacing')">
          <DeckNumberField
            prefix="i-jannchie-fit-to-screen"
            unit="px"
            :min="0"
            :max="256"
            :label="label('padding')"
            :value="pixels(slide.style.padding?.split(' ')[0])"
            @change="
              ($event) => {
                setSlideStyle({ padding: `${numberOf($event)}px` })
                emit('seal')
              }
            "
          />
          <DeckNumberField
            prefix="i-jannchie-layout-columns"
            unit="px"
            :min="0"
            :max="512"
            :label="label('gap')"
            :value="pixels(slide.style.gap)"
            @change="
              ($event) => {
                setSlideStyle({ gap: `${numberOf($event)}px` })
                emit('seal')
              }
            "
          />
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('alignItems')">
          <select
            class="slides-field"
            :value="slide.style['align-items'] ?? ''"
            :aria-label="label('alignItems')"
            @change="
              ($event) => {
                setSlideStyle({ 'align-items': ($event.target as HTMLSelectElement).value || undefined })
                emit('seal')
              }
            "
          >
            <option value="">—</option>
            <option v-for="value in ALIGN_ITEMS" :key="value" :value="value">{{ value }}</option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('justify')">
          <select
            class="slides-field"
            :value="slide.style['justify-content'] ?? ''"
            :aria-label="label('justify')"
            @change="
              ($event) => {
                setSlideStyle({ 'justify-content': ($event.target as HTMLSelectElement).value || undefined })
                emit('seal')
              }
            "
          >
            <option value="">—</option>
            <option v-for="value in JUSTIFY" :key="value" :value="value">{{ value }}</option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('transition')">
          <select
            class="slides-field"
            :value="slide.transition ?? 'none'"
            :aria-label="label('transition')"
            @change="setTransition(($event.target as HTMLSelectElement).value)"
          >
            <option value="none">{{ t("deck.transition.none") }}</option>
            <option v-for="transition in DECK_TRANSITIONS" :key="transition" :value="transition">
              {{ t(`deck.transition.${transition}`) }}
            </option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('section')">
          <input
            class="slides-field"
            :value="slide.section ?? ''"
            :placeholder="label('sectionTitle')"
            :aria-label="label('sectionTitle')"
            @change="setSlideSection"
          />
        </DeckInspectorRow>
        <label
          class="min-h-[var(--slides-control-height)] flex cursor-pointer items-center gap-2 slides-ink-2"
        >
          <input type="checkbox" class="h-3.5 w-3.5" :checked="slide.hidden === true" @change="setHidden" />
          <span>{{ label("hidden") }}</span>
        </label>
      </section>

      <section class="slides-inspector-section">
        <h3 class="slides-inspector-heading">{{ label("deck") }}</h3>
        <div class="slides-inspector-row !items-start">
          <span class="slides-inspector-label leading-[var(--slides-control-height)]">{{
            label("theme")
          }}</span>
          <div
            class="slides-theme-picker min-w-0 grid grid-cols-2 gap-1.5"
            role="radiogroup"
            :aria-label="label('theme')"
          >
            <button
              v-for="option in themes()"
              :key="option.id"
              type="button"
              role="radio"
              class="slides-theme-option min-w-0 flex flex-col gap-1 rounded-[var(--slides-radius)] p-1 text-left slides-focus slides-hover"
              :class="option.id === theme.id ? 'ring-1.5 ring-slides-focus' : ''"
              :aria-checked="option.id === theme.id"
              :title="themeName(option)"
              @click="setTheme(option.id)"
            >
              <span
                class="relative h-10 w-full flex items-end gap-1 overflow-hidden rounded-[calc(var(--slides-radius)-2px)] px-1.5 pb-1 ring-1 ring-inset"
                :style="{ background: option.colors.background, '--tw-ring-color': option.colors.line }"
                aria-hidden="true"
              >
                <span class="text-sm font-semibold leading-none" :style="{ color: option.colors.text }"
                  >Aa</span
                >
                <span class="mb-0.5 h-1 w-4 rounded-full" :style="{ background: option.colors.accent }" />
                <span class="mb-0.5 h-1 w-3 rounded-full" :style="{ background: option.colors.muted }" />
              </span>
              <span class="truncate px-0.5 slides-ink-2">{{ themeName(option) }}</span>
            </button>
          </div>
        </div>
        <DeckInspectorRow :label="label('font')">
          <select
            class="slides-field"
            :value="firstFamily(deck.style['font-family']) ?? ''"
            :aria-label="label('font')"
            @change="setFamily(($event.target as HTMLSelectElement).value, 'deck')"
          >
            <option value="" disabled>{{ label("font") }}</option>
            <option v-for="family in fontOptions" :key="family" :value="firstFamily(family)">
              {{ firstFamily(family) }}
            </option>
          </select>
        </DeckInspectorRow>
        <DeckInspectorRow :label="label('color')">
          <DeckColorField
            :theme="theme"
            :placeholder="unset"
            :value="deck.style.color"
            :label="label('color')"
            @change="
              (value) =>
                setDeck({ ...deck, style: patchStyle('body', deck.style, { color: value }) }, 'color')
            "
            @done="emit('seal')"
          />
        </DeckInspectorRow>
        <div class="slides-inspector-row !items-start">
          <span class="slides-inspector-label leading-[var(--slides-control-height)]">{{
            label("fonts")
          }}</span>
          <div class="min-w-0 flex flex-col gap-1.5">
            <ul v-if="deck.fontLinks.length > 0" class="flex flex-col">
              <li
                v-for="href in deck.fontLinks"
                :key="href"
                class="h-[var(--slides-control-height)] flex items-center gap-1 rounded-[var(--slides-radius)] pl-2 slides-hover"
              >
                <span class="min-w-0 flex-1 truncate">{{ fontName(href) }}</span>
                <button
                  type="button"
                  class="slides-icon-button !h-6 !w-6"
                  :title="t('deck.removeFont')"
                  :aria-label="t('deck.removeFont')"
                  @click="removeFont(href)"
                >
                  <i class="i-jannchie-x h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            </ul>
            <form class="flex gap-1.5" @submit.prevent="addFont">
              <input
                v-model="newFont"
                class="slides-field min-w-0 flex-1"
                :placeholder="label('addFont')"
                :aria-label="label('addFont')"
              />
              <button
                type="submit"
                class="slides-button w-[var(--slides-control-height)] !px-0"
                :aria-label="label('addFont')"
                :disabled="newFont.trim() === ''"
              >
                <i class="i-jannchie-plus h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </form>
          </div>
        </div>
      </section>

      <details
        class="slides-inspector-section group"
        :open="markupOpen"
        @toggle="markupOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary class="flex cursor-pointer list-none items-center gap-1.5 slides-inspector-heading">
          <i class="i-jannchie-chevron-right slides-chevron group-open:rotate-90" aria-hidden="true" />
          {{ label("slideHtml") }}
        </summary>
        <textarea
          v-model="slideMarkup"
          class="slides-field h-56 py-1.5 text-[11px] slides-num"
          spellcheck="false"
          :aria-label="label('slideHtml')"
        />
        <button type="button" class="slides-button w-full" @click="applySlideMarkup">
          {{ label("apply") }}
        </button>
      </details>
    </template>
  </aside>
</template>
