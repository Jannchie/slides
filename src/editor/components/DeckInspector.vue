<script setup lang="ts">
import { computed, ref, watch } from "vue"

import {
  DECK_ICON_NAMES,
  DECK_SHAPE_KINDS,
  DECK_TRANSITIONS,
  deckStyleApplies,
  nodeAt,
  patchNodeStyle,
  patchStyle,
  readDeckNodes,
  readDeckStyle,
  readPixels,
  rotationOf,
  setAttribute,
  strokeOf,
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
} from "../../index"
import { firstFamily, type Box } from "../../dom"
import { announce } from "../support/announce"

import { formatError, uploadable, useDeckAssets } from "../host"
import { t } from "../i18n"
import DeckColorField from "./DeckColorField.vue"

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

const label = (name: Field) => t(`deck.field.${name}`)

const slide = computed(() => props.deck.slides[props.slideIndex])

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
    class="min-h-0 overflow-y-auto bg-white text-xs dark:bg-ground-raised"
    :aria-label="t('deck.inspector')"
    :inert="!editable"
  >
    <!-- The selection. -->
    <template v-if="selected.length > 0">
      <section v-if="single && !isConnector" class="inspector-section">
        <h3 class="inspector-heading">{{ label("position") }}</h3>
        <div class="grid grid-cols-2 gap-1.5">
          <label class="inspector-number"
            ><span>X</span><input type="number" :value="box ? Math.round(box.x) : ''" @change="setX"
          /></label>
          <label class="inspector-number"
            ><span>Y</span><input type="number" :value="box ? Math.round(box.y) : ''" @change="setY"
          /></label>
          <label class="inspector-number"
            ><span>W</span
            ><input
              type="number"
              min="1"
              :value="box ? Math.round(box.w) : ''"
              @change="setSize('width', $event)"
          /></label>
          <label class="inspector-number"
            ><span>H</span
            ><input
              type="number"
              min="1"
              :value="box ? Math.round(box.h) : ''"
              @change="setSize('height', $event)"
          /></label>
          <label class="inspector-number col-span-2">
            <i class="i-jannchie-rotate h-3.5 w-3.5" :title="label('rotation')" />
            <input
              type="number"
              step="1"
              :value="Math.round(rotationOf(single.node.style))"
              :aria-label="label('rotation')"
              @change="setRotation"
            />
          </label>
        </div>
        <button
          v-if="!pinned"
          type="button"
          class="button-secondary mt-1.5 w-full justify-center !py-1 !text-xs"
          @click="emit('pin')"
        >
          <i class="i-jannchie-pin-diagonal h-3.5 w-3.5" aria-hidden="true" />
          {{ label("pin") }}
        </button>
      </section>

      <section v-if="applies('font-size')" class="inspector-section">
        <h3 class="inspector-heading">{{ label("text") }}</h3>
        <select
          class="field !py-1 !text-xs"
          :value="firstFamily(common('font-family')) ?? ''"
          :aria-label="label('font')"
          @change="setFamily(($event.target as HTMLSelectElement).value, 'selection')"
        >
          <option value="" disabled>{{ label("font") }}</option>
          <option v-for="family in fontOptions" :key="family" :value="firstFamily(family)">
            {{ firstFamily(family) }}
          </option>
        </select>
        <div class="mt-1.5 grid grid-cols-[1fr_1fr] gap-1.5">
          <label class="inspector-number">
            <i class="i-jannchie-heading h-3.5 w-3.5" :title="label('size')" />
            <input
              type="number"
              min="8"
              max="400"
              :value="pixels(common('font-size'))"
              :placeholder="t('deck.mixed')"
              :aria-label="label('size')"
              @change="
                ($event) => {
                  setStyle({ 'font-size': `${numberOf($event)}px` })
                  emit('seal')
                }
              "
            />
          </label>
          <select
            class="field !py-1 !text-xs"
            :value="common('font-weight') ?? ''"
            :aria-label="label('weight')"
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
        </div>
        <div class="mt-1.5">
          <DeckColorField
            :value="common('color')"
            :label="label('color')"
            @change="(value) => setStyle({ color: value }, 'color')"
            @done="emit('seal')"
          />
        </div>
        <div class="mt-1.5 flex items-center gap-0.5">
          <button
            v-for="align in ALIGNS"
            :key="align"
            type="button"
            class="h-7 w-7 flex items-center justify-center rounded-md surface-hover kbd-ring"
            :class="{ 'surface-strong ink-accent': common('text-align') === align }"
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
          <span class="flex-1" />
          <button
            type="button"
            class="h-7 w-7 flex items-center justify-center rounded-md surface-hover kbd-ring"
            :class="{ 'surface-strong ink-accent': common('text-transform') === 'uppercase' }"
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
        </div>
        <div class="mt-1.5 grid grid-cols-2 gap-1.5">
          <label class="inspector-number">
            <i class="i-jannchie-line-height h-3.5 w-3.5" :title="label('lineHeight')" />
            <input
              type="number"
              step="0.05"
              min="0.5"
              max="4"
              :value="common('line-height') ?? ''"
              :aria-label="label('lineHeight')"
              @change="
                ($event) => {
                  setStyle({ 'line-height': String(numberOf($event)) })
                  emit('seal')
                }
              "
            />
          </label>
          <label class="inspector-number">
            <i class="i-jannchie-letter-spacing h-3.5 w-3.5" :title="label('letterSpacing')" />
            <input
              type="number"
              step="0.5"
              :value="pixels(common('letter-spacing'))"
              :aria-label="label('letterSpacing')"
              @change="
                ($event) => {
                  setStyle({ 'letter-spacing': `${numberOf($event)}px` })
                  emit('seal')
                }
              "
            />
          </label>
        </div>
      </section>

      <section v-if="applies('background') && !isConnector" class="inspector-section">
        <h3 class="inspector-heading">{{ label("fill") }}</h3>
        <div class="segmented mb-1.5 w-full">
          <button
            v-for="kind in ['solid', 'gradient'] as const"
            :key="kind"
            type="button"
            class="segment flex-1 justify-center !px-2 !py-0.5 !text-xs"
            :class="fillKind === kind ? 'segment-selected' : 'ink-muted'"
            @click="setFillKind(kind)"
          >
            {{ label(kind) }}
          </button>
        </div>
        <DeckColorField
          v-if="fillKind === 'solid'"
          :value="fill"
          :label="label('fill')"
          clearable
          @change="(value) => setStyle({ background: value }, 'background')"
          @done="emit('seal')"
        />
        <div v-else-if="gradient" class="flex flex-col gap-1.5">
          <DeckColorField
            :value="gradient.from"
            :label="label('from')"
            @change="(value) => value && setGradient({ from: value })"
            @done="emit('seal')"
          />
          <DeckColorField
            :value="gradient.to"
            :label="label('to')"
            @change="(value) => value && setGradient({ to: value })"
            @done="emit('seal')"
          />
          <label class="inspector-number">
            <i class="i-jannchie-rotate h-3.5 w-3.5" :title="label('angle')" />
            <input
              type="number"
              :value="gradient.angle"
              :aria-label="label('angle')"
              @change="
                ($event) => {
                  setGradient({ angle: numberOf($event) ?? 135 })
                  emit('seal')
                }
              "
            />
          </label>
        </div>
        <p v-else class="ink-soft">{{ fill }}</p>
      </section>

      <section v-if="applies('border') && !isConnector" class="inspector-section">
        <h3 class="inspector-heading">{{ label("border") }}</h3>
        <div class="grid grid-cols-[4.5rem_1fr] gap-1.5">
          <label class="inspector-number">
            <i class="i-jannchie-square h-3.5 w-3.5" :title="label('borderWidth')" />
            <input
              type="number"
              min="0"
              max="32"
              :value="border?.width ?? 0"
              :aria-label="label('borderWidth')"
              @change="
                ($event) => {
                  setBorder({ width: numberOf($event) ?? 0 })
                  emit('seal')
                }
              "
            />
          </label>
          <select
            class="field !py-1 !text-xs"
            :value="border?.style ?? 'solid'"
            :aria-label="label('borderStyle')"
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
        </div>
        <div class="mt-1.5">
          <DeckColorField
            :value="border?.color"
            :label="label('borderColor')"
            @change="(value) => value && setBorder({ color: value })"
            @done="emit('seal')"
          />
        </div>
        <label v-if="applies('border-radius')" class="inspector-number mt-1.5">
          <i class="i-jannchie-corner-radius h-3.5 w-3.5" :title="label('radius')" />
          <input
            type="number"
            min="0"
            :value="pixels(common('border-radius'))"
            :aria-label="label('radius')"
            @change="
              ($event) => {
                setStyle({ 'border-radius': `${numberOf($event)}px` })
                emit('seal')
              }
            "
          />
        </label>
      </section>

      <section class="inspector-section">
        <h3 class="inspector-heading">{{ label("effects") }}</h3>
        <label class="flex items-center gap-2">
          <span class="w-14 ink-muted">{{ label("opacity") }}</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            class="min-w-0 flex-1"
            :value="common('opacity') ?? '1'"
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
        </label>
        <label v-if="applies('box-shadow')" class="mt-1.5 flex items-center gap-2">
          <span class="w-14 ink-muted">{{ label("shadow") }}</span>
          <select
            class="field min-w-0 flex-1 !py-1 !text-xs"
            :value="shadow"
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
        </label>
      </section>

      <section v-if="isContainer && single" class="inspector-section">
        <h3 class="inspector-heading">{{ label("layout") }}</h3>
        <div class="segmented mb-1.5 w-full">
          <button
            v-for="kind in ['column', 'row', 'grid'] as const"
            :key="kind"
            type="button"
            class="segment flex-1 justify-center !px-2 !py-0.5 !text-xs"
            :class="containerLayout === kind ? 'segment-selected' : 'ink-muted'"
            @click="setLayout(kind, 'selection')"
          >
            {{ t(`deck.layout.${kind}`) }}
          </button>
        </div>
        <div class="grid grid-cols-2 gap-1.5">
          <label class="inspector-number">
            <i class="i-jannchie-layout-columns h-3.5 w-3.5" :title="label('gap')" />
            <input
              type="number"
              min="0"
              max="512"
              :value="pixels(common('gap'))"
              :aria-label="label('gap')"
              @change="
                ($event) => {
                  setStyle({ gap: `${numberOf($event)}px` })
                  emit('seal')
                }
              "
            />
          </label>
          <label class="inspector-number">
            <i class="i-jannchie-fit-to-screen h-3.5 w-3.5" :title="label('padding')" />
            <input
              type="number"
              min="0"
              max="256"
              :value="pixels(common('padding')?.split(' ')[0])"
              :aria-label="label('padding')"
              @change="
                ($event) => {
                  setStyle({ padding: `${numberOf($event)}px` })
                  emit('seal')
                }
              "
            />
          </label>
        </div>
        <div class="mt-1.5 grid grid-cols-2 gap-1.5">
          <select
            class="field !py-1 !text-xs"
            :value="common('align-items') ?? ''"
            :aria-label="label('alignItems')"
            @change="
              ($event) => {
                setStyle({ 'align-items': ($event.target as HTMLSelectElement).value || undefined })
                emit('seal')
              }
            "
          >
            <option value="">{{ label("alignItems") }}</option>
            <option v-for="value in ALIGN_ITEMS" :key="value" :value="value">{{ value }}</option>
          </select>
          <select
            class="field !py-1 !text-xs"
            :value="common('justify-content') ?? ''"
            :aria-label="label('justify')"
            @change="
              ($event) => {
                setStyle({ 'justify-content': ($event.target as HTMLSelectElement).value || undefined })
                emit('seal')
              }
            "
          >
            <option value="">{{ label("justify") }}</option>
            <option v-for="value in JUSTIFY" :key="value" :value="value">{{ value }}</option>
          </select>
        </div>
        <input
          v-if="containerLayout === 'grid'"
          class="field mt-1.5 !py-1 !text-xs num"
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
      </section>

      <section v-if="singleTag === 'img'" class="inspector-section">
        <h3 class="inspector-heading">{{ label("image") }}</h3>
        <button
          type="button"
          class="button-secondary w-full justify-center !py-1 !text-xs"
          @click="imageInput?.click()"
        >
          <i class="i-jannchie-image h-3.5 w-3.5" aria-hidden="true" />
          {{ label("replace") }}
        </button>
        <input ref="imageInput" type="file" accept="image/*" class="hidden" @change="replaceImage" />
        <div class="segmented mt-1.5 w-full">
          <button
            v-for="fit in ['cover', 'contain'] as const"
            :key="fit"
            type="button"
            class="segment flex-1 justify-center !px-2 !py-0.5 !text-xs"
            :class="(common('object-fit') ?? 'cover') === fit ? 'segment-selected' : 'ink-muted'"
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
        <input
          class="field mt-1.5 !py-1 !text-xs"
          :value="commonAttribute('alt') ?? ''"
          :placeholder="label('alt')"
          :aria-label="label('alt')"
          @change="setAttributeAll('alt', ($event.target as HTMLInputElement).value)"
        />
      </section>

      <section v-if="singleTag === 'x-shape'" class="inspector-section">
        <h3 class="inspector-heading">{{ label("shape") }}</h3>
        <select
          class="field !py-1 !text-xs"
          :value="commonAttribute('kind')"
          @change="setAttributeAll('kind', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="kind in DECK_SHAPE_KINDS" :key="kind" :value="kind">
            {{ t(`deck.shape.${kind}`) }}
          </option>
        </select>
      </section>

      <section v-if="singleTag === 'x-icon'" class="inspector-section">
        <h3 class="inspector-heading">{{ label("icon") }}</h3>
        <select
          class="field !py-1 !text-xs"
          :value="commonAttribute('name')"
          @change="setAttributeAll('name', ($event.target as HTMLSelectElement).value)"
        >
          <option v-for="name in DECK_ICON_NAMES" :key="name" :value="name">{{ name }}</option>
        </select>
        <div class="mt-1.5">
          <DeckColorField
            :value="common('color')"
            :label="label('color')"
            @change="(value) => setStyle({ color: value }, 'color')"
            @done="emit('seal')"
          />
        </div>
      </section>

      <section v-if="isConnector && single" class="inspector-section">
        <h3 class="inspector-heading">{{ label("connector") }}</h3>
        <DeckColorField
          :value="common('color')"
          :label="label('color')"
          @change="(value) => setStyle({ color: value }, 'color')"
          @done="emit('seal')"
        />
        <div class="mt-1.5 grid grid-cols-2 gap-1.5">
          <select
            class="field !py-1 !text-xs"
            :value="commonAttribute('head') ?? 'end'"
            :aria-label="label('head')"
            @change="setAttributeAll('head', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="head in ['end', 'both', 'none'] as const" :key="head" :value="head">
              {{ t(`deck.head.${head}`) }}
            </option>
          </select>
          <select
            class="field !py-1 !text-xs"
            :value="commonAttribute('route') ?? 'straight'"
            :aria-label="label('route')"
            @change="setAttributeAll('route', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="route in ['straight', 'hv', 'vh', 'elbow'] as const" :key="route" :value="route">
              {{ t(`deck.route.${route}`) }}
            </option>
          </select>
        </div>
        <div class="mt-1.5 grid grid-cols-[4.5rem_1fr] gap-1.5">
          <label class="inspector-number">
            <i class="i-jannchie-square h-3.5 w-3.5" :title="label('borderWidth')" />
            <input
              type="number"
              min="1"
              max="32"
              :value="strokeOf(single.node.style.border)?.width ?? 3"
              :aria-label="label('borderWidth')"
              @change="setConnectorStroke({ width: numberOf($event) ?? 3 })"
            />
          </label>
          <select
            class="field !py-1 !text-xs"
            :value="strokeOf(single.node.style.border)?.style ?? 'solid'"
            :aria-label="label('borderStyle')"
            @change="setConnectorStroke({ style: ($event.target as HTMLSelectElement).value })"
          >
            <option v-for="style in ['solid', 'dashed', 'dotted'] as const" :key="style" :value="style">
              {{ t(`deck.stroke.${style}`) }}
            </option>
          </select>
        </div>
      </section>

      <section v-if="single && pinned" class="inspector-section">
        <h3 class="inspector-heading">{{ label("build") }}</h3>
        <select
          class="field !py-1 !text-xs"
          :value="(commonAttribute('data-build-in') ?? '').split(' ')[0] || ''"
          @change="setAttributeAll('data-build-in', ($event.target as HTMLSelectElement).value || undefined)"
        >
          <option value="">{{ t("deck.build.none") }}</option>
          <option v-for="build in BUILDS" :key="build" :value="build">
            {{ t(`deck.build.${build}`) }}
          </option>
        </select>
        <input
          class="field mt-1.5 !py-1 !text-xs num"
          :value="commonAttribute('id') ?? ''"
          :placeholder="label('magicId')"
          :aria-label="label('magicId')"
          @change="
            setAttributeAll(
              'id',
              ($event.target as HTMLInputElement).value.trim().replace(/[^\w-]/g, '-') || undefined,
            )
          "
        />
      </section>

      <details v-if="single" class="inspector-section">
        <summary class="inspector-heading cursor-pointer">{{ label("style") }}</summary>
        <textarea
          v-model="styleText"
          class="field mt-1.5 h-32 resize-y !text-[11px] num"
          spellcheck="false"
          :aria-label="label('style')"
        />
        <p v-for="line in styleDropped" :key="line" class="mt-1 ink-warning">{{ line }}</p>
        <button
          type="button"
          class="button-secondary mt-1.5 w-full justify-center !py-1 !text-xs"
          @click="applyStyleText"
        >
          {{ label("apply") }}
        </button>
      </details>
    </template>

    <!-- Nothing selected: the slide, and the deck. -->
    <template v-else-if="slide">
      <section class="inspector-section">
        <h3 class="inspector-heading">{{ label("slide") }}</h3>
        <div class="segmented mb-1.5 w-full">
          <button
            v-for="kind in ['solid', 'gradient'] as const"
            :key="kind"
            type="button"
            class="segment flex-1 justify-center !px-2 !py-0.5 !text-xs"
            :class="
              (slide.style.background?.includes('gradient(') ? 'gradient' : 'solid') === kind
                ? 'segment-selected'
                : 'ink-muted'
            "
            @click="setSlideFill(kind)"
          >
            {{ label(kind) }}
          </button>
        </div>
        <DeckColorField
          v-if="!slide.style.background?.includes('gradient(')"
          :value="slide.style.background"
          :label="label('background')"
          @change="(value) => setSlideStyle({ background: value ?? '#ffffff' }, 'background')"
          @done="emit('seal')"
        />
        <input
          v-else
          class="field !py-1 !text-xs num"
          :value="slide.style.background"
          :aria-label="label('background')"
          @change="
            ($event) => {
              setSlideStyle({ background: ($event.target as HTMLInputElement).value })
              emit('seal')
            }
          "
        />
        <div class="mt-1.5 segmented w-full">
          <button
            v-for="kind in ['column', 'row', 'grid'] as const"
            :key="kind"
            type="button"
            class="segment flex-1 justify-center !px-2 !py-0.5 !text-xs"
            :class="layoutOf(slide.style) === kind ? 'segment-selected' : 'ink-muted'"
            @click="setLayout(kind, 'slide')"
          >
            {{ t(`deck.layout.${kind}`) }}
          </button>
        </div>
        <div class="mt-1.5 grid grid-cols-2 gap-1.5">
          <label class="inspector-number">
            <i class="i-jannchie-fit-to-screen h-3.5 w-3.5" :title="label('padding')" />
            <input
              type="number"
              min="0"
              max="256"
              :value="pixels(slide.style.padding?.split(' ')[0])"
              :aria-label="label('padding')"
              @change="
                ($event) => {
                  setSlideStyle({ padding: `${numberOf($event)}px` })
                  emit('seal')
                }
              "
            />
          </label>
          <label class="inspector-number">
            <i class="i-jannchie-layout-columns h-3.5 w-3.5" :title="label('gap')" />
            <input
              type="number"
              min="0"
              max="512"
              :value="pixels(slide.style.gap)"
              :aria-label="label('gap')"
              @change="
                ($event) => {
                  setSlideStyle({ gap: `${numberOf($event)}px` })
                  emit('seal')
                }
              "
            />
          </label>
          <select
            class="field !py-1 !text-xs"
            :value="slide.style['align-items'] ?? ''"
            :aria-label="label('alignItems')"
            @change="
              ($event) => {
                setSlideStyle({ 'align-items': ($event.target as HTMLSelectElement).value || undefined })
                emit('seal')
              }
            "
          >
            <option value="">{{ label("alignItems") }}</option>
            <option v-for="value in ALIGN_ITEMS" :key="value" :value="value">{{ value }}</option>
          </select>
          <select
            class="field !py-1 !text-xs"
            :value="slide.style['justify-content'] ?? ''"
            :aria-label="label('justify')"
            @change="
              ($event) => {
                setSlideStyle({ 'justify-content': ($event.target as HTMLSelectElement).value || undefined })
                emit('seal')
              }
            "
          >
            <option value="">{{ label("justify") }}</option>
            <option v-for="value in JUSTIFY" :key="value" :value="value">{{ value }}</option>
          </select>
        </div>
        <label class="mt-1.5 flex items-center gap-2">
          <span class="w-20 ink-muted">{{ label("transition") }}</span>
          <select
            class="field min-w-0 flex-1 !py-1 !text-xs"
            :value="slide.transition ?? 'none'"
            @change="setTransition(($event.target as HTMLSelectElement).value)"
          >
            <option value="none">{{ t("deck.transition.none") }}</option>
            <option v-for="transition in DECK_TRANSITIONS" :key="transition" :value="transition">
              {{ t(`deck.transition.${transition}`) }}
            </option>
          </select>
        </label>
        <input
          class="field mt-1.5 !py-1 !text-xs"
          :value="slide.section ?? ''"
          :placeholder="label('sectionTitle')"
          :aria-label="label('sectionTitle')"
          @change="setSlideSection"
        />
        <label class="mt-1.5 flex items-center gap-2">
          <input type="checkbox" :checked="slide.hidden === true" @change="setHidden" />
          <span>{{ label("hidden") }}</span>
        </label>
      </section>

      <section class="inspector-section">
        <h3 class="inspector-heading">{{ label("deck") }}</h3>
        <select
          class="field !py-1 !text-xs"
          :value="firstFamily(deck.style['font-family']) ?? ''"
          :aria-label="label('font')"
          @change="setFamily(($event.target as HTMLSelectElement).value, 'deck')"
        >
          <option value="" disabled>{{ label("font") }}</option>
          <option v-for="family in fontOptions" :key="family" :value="firstFamily(family)">
            {{ firstFamily(family) }}
          </option>
        </select>
        <div class="mt-1.5">
          <DeckColorField
            :value="deck.style.color"
            :label="label('color')"
            @change="
              (value) =>
                setDeck({ ...deck, style: patchStyle('body', deck.style, { color: value }) }, 'color')
            "
            @done="emit('seal')"
          />
        </div>
        <h4 class="mb-1 mt-2.5 ink-muted">{{ label("fonts") }}</h4>
        <ul class="m-0 flex list-none flex-col gap-0.5 p-0">
          <li v-for="href in deck.fontLinks" :key="href" class="flex items-center gap-1">
            <span class="min-w-0 flex-1 truncate">{{ fontName(href) }}</span>
            <button
              type="button"
              class="h-5 w-5 flex items-center justify-center rounded ink-soft surface-hover kbd-ring"
              :aria-label="t('deck.removeFont')"
              @click="removeFont(href)"
            >
              <i class="i-jannchie-x h-3 w-3" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <form class="mt-1 flex gap-1" @submit.prevent="addFont">
          <input
            v-model="newFont"
            class="field min-w-0 flex-1 !py-1 !text-xs"
            :placeholder="label('addFont')"
            :aria-label="label('addFont')"
          />
          <button
            type="submit"
            class="button-secondary !px-2 !py-1 !text-xs"
            :disabled="newFont.trim() === ''"
          >
            <i class="i-jannchie-plus h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </form>
      </section>

      <details
        class="inspector-section"
        :open="markupOpen"
        @toggle="markupOpen = ($event.target as HTMLDetailsElement).open"
      >
        <summary class="inspector-heading cursor-pointer">{{ label("slideHtml") }}</summary>
        <textarea
          v-model="slideMarkup"
          class="field mt-1.5 h-56 resize-y !text-[11px] num"
          spellcheck="false"
          :aria-label="label('slideHtml')"
        />
        <button
          type="button"
          class="button-secondary mt-1.5 w-full justify-center !py-1 !text-xs"
          @click="applySlideMarkup"
        >
          {{ label("apply") }}
        </button>
      </details>
    </template>
  </aside>
</template>

<style scoped>
.inspector-section {
  padding: 0.625rem 0.75rem;
  border-bottom: 1px solid rgb(0 0 0 / 0.06);
}

:global([data-scheme="dark"]) .inspector-section {
  border-bottom-color: rgb(255 255 255 / 0.06);
}

.inspector-heading {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  opacity: 0.7;
}

.inspector-number {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  border-radius: 0.5rem;
  padding: 0 0.375rem;
  background: rgb(0 0 0 / 0.04);
}

:global([data-scheme="dark"]) .inspector-number {
  background: rgb(255 255 255 / 0.05);
}

.inspector-number > span,
.inspector-number > i {
  flex: none;
  opacity: 0.6;
  font-size: 0.7rem;
}

.inspector-number > input {
  min-width: 0;
  flex: 1;
  border: 0;
  background: transparent;
  padding: 0.3rem 0;
  font: inherit;
  font-variant-numeric: tabular-nums;
  outline: none;
}
</style>
