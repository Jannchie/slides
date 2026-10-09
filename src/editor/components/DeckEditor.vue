<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
  watchEffect,
} from "vue"

import {
  DECK_HEIGHT,
  DECK_ICON_NAMES,
  DECK_SHAPE_KINDS,
  DECK_WIDTH,
  TABLE_EDITS,
  childrenAt,
  deckIconMarkup,
  deckNodesText,
  deckSlideTitle,
  editTable,
  element,
  elementAt,
  insertAt,
  isDeckTextBlock,
  nodeAt,
  parentOf,
  patchNodeStyle,
  readDeck,
  readDeckNodes,
  removeAt,
  samePath,
  tableAt,
  text,
  uniqueId,
  updateAt,
  updateSlide,
  updateSlideChildren,
  writeDeck,
  writeDeckNodes,
  type Deck,
  type DeckNode,
  type DeckPath,
  type DeckSlide,
  type DeckTheme,
  type TableEdit,
} from "../../index"
import { loadDeckFonts, px, readInlineDom, type DeckAlignment, type Point } from "../../dom"

import { announce, assertiveMessage, politeMessage } from "../support/announce"

import { DeckHistory } from "../deck-history"
import { formatError, provideDeckAssets, uploadable, type DeckAssetStore } from "../host"
import { provideDeckThemes, withHostThemes } from "../themes"
import { setDeckLocale, t } from "../i18n"
import DeckContextMenu, { type DeckMenuEntry } from "./DeckContextMenu.vue"
import DeckDesign from "./DeckDesign.vue"
import DeckInspector from "./DeckInspector.vue"
import DeckMenu from "./DeckMenu.vue"
import DeckPresenter from "./DeckPresenter.vue"
import DeckSlideList from "./DeckSlideList.vue"
import DeckStage from "./DeckStage.vue"

/**
 * A deck open for the reader to change, as a presentation program shows one:
 * the slides down the side, the slide on its stage, its notes underneath, and
 * the selected element's format beside it.
 *
 * Holds the deck as a tree (`readDeck`) and every change as a new tree in its
 * history, and hands the parent the deck's text when asked (`write`) — the
 * text exactly as it was loaded while nothing has changed, so opening a deck
 * and leaving it saves nothing.
 */
const props = defineProps<{
  source: string
  editable: boolean
  /** Where the deck's own pictures and fonts are kept. */
  assets: DeckAssetStore
  /** The language the editor speaks, as a tag (`ja`, `zh-CN`); English otherwise. */
  locale?: string
  /** Themes a deck may name besides the shipped two; one with a shipped theme's id replaces it. */
  themes?: readonly DeckTheme[]
}>()

const emit = defineEmits<{ change: [] }>()

type EditorSelection = { slideIndex: number; paths: DeckPath[]; scope: DeckPath }

const initial = readDeck(props.source).deck
/** The loaded source as `writeDeck` would write it; a deck still equal to it is unchanged. */
let loadedText = writeDeck(initial)
const history = new DeckHistory<EditorSelection>(initial)
const deck = history.current
const slideIndex = ref(0)
const selection = shallowRef<DeckPath[]>([])
const scope = shallowRef<DeckPath>([])
const editingPath = shallowRef<DeckPath>()

// A version loaded from outside — the model's next write — replaces the deck
// in place rather than rebuilding the editor: the reader stays on the slide
// they were looking at, and the images and fonts already on screen are not
// fetched and laid out again. Synchronous, so `write` never compares the new
// source against the old deck.
watch(
  () => props.source,
  (source) => {
    const next = readDeck(source).deck

    loadedText = writeDeck(next)
    history.reset(next)
    slideIndex.value = Math.max(0, Math.min(slideIndex.value, next.slides.length - 1))
    selection.value = []
    scope.value = []
    editingPath.value = undefined
  },
  { flush: "sync" },
)
/**
 * How wide the editor is, which decides whether the format pane shows unasked:
 * a sidebar has no room for it beside the slide, so below this width it waits
 * to be opened and then floats over the stage rather than squeezing it. What
 * the reader opens or closes stays as they left it. The slide list is always
 * there, as it is in a presentation program.
 */
const width = ref(0)
const COMPACT_INSPECTOR = 900
const inspectorChoice = ref<boolean>()
const inspectorFloats = computed(() => width.value > 0 && width.value < COMPACT_INSPECTOR)
const inspectorOpen = computed({
  get: () => inspectorChoice.value ?? !inspectorFloats.value,
  set: (open) => {
    inspectorChoice.value = open
  },
})

let widthObserver: ResizeObserver | undefined

onMounted(() => {
  widthObserver = new ResizeObserver(([entry]) => {
    width.value = entry?.contentRect.width ?? 0
  })

  if (root.value !== null) {
    widthObserver.observe(root.value)
  }
})

onBeforeUnmount(() => widthObserver?.disconnect())
const notesOpen = ref(true)
const presenting = ref<false | "present" | "presenter">(false)

const stage = useTemplateRef<InstanceType<typeof DeckStage>>("stage")
const root = useTemplateRef<HTMLElement>("root")

const slide = computed<DeckSlide | undefined>(() => deck.value.slides[slideIndex.value])

provideDeckThemes(() => withHostThemes(props.themes))

provideDeckAssets({
  url: (src) => props.assets.url(src),
  upload: (file) => props.assets.upload(file),
})
watchEffect(() => setDeckLocale(props.locale ?? "en"))

const resolveAsset = (src: string) => props.assets.url(src)

watch(
  () => [deck.value.fontLinks, deck.value.fontFaces] as const,
  ([fontLinks, fontFaces]) => loadDeckFonts({ fontLinks, fontFaces }, resolveAsset),
  { immediate: true },
)

/** The deck's text now; the text it was loaded from while nothing has changed. */
function write() {
  const written = writeDeck(deck.value)

  return written === loadedText ? props.source : written
}

const slideTitle = computed(() => (slide.value === undefined ? "" : deckSlideTitle(slide.value)))

/** The words of what is selected, for asking the AI about it. */
function selectedText() {
  const current = slide.value

  if (current === undefined) {
    return ""
  }

  return selection.value
    .map((path) => nodeAt(current.children, path))
    .flatMap((node) => (node === undefined ? [] : [deckNodesText([node]).trim()]))
    .filter((words) => words !== "")
    .join("\n")
}

defineExpose({ write, slideIndex, slideTitle, selectedText })

// ---------------------------------------------------------------------------
// Changing the deck
// ---------------------------------------------------------------------------

function snapshot(): EditorSelection {
  return { slideIndex: slideIndex.value, paths: selection.value, scope: scope.value }
}

function restore(state: EditorSelection | undefined) {
  if (state === undefined) {
    return
  }

  slideIndex.value = Math.min(state.slideIndex, deck.value.slides.length - 1)
  selection.value = state.paths
  scope.value = state.scope
  editingPath.value = undefined
}

function commit(next: Deck, key?: string) {
  if (!props.editable || next === deck.value) {
    return
  }

  history.push(next, snapshot(), key)
  emit("change")
}

function updateChildren(change: (children: readonly DeckNode[]) => DeckNode[], key?: string) {
  commit(updateSlideChildren(deck.value, slideIndex.value, change), key)
}

// Taking a step back is a change like any other: refused while the deck is
// not the reader's to change, which is when the model's turn is writing it
// or a conflict is waiting on the reader's choice.
function undo() {
  step(() => history.undo(snapshot()))
}

function redo() {
  step(() => history.redo(snapshot()))
}

function step(take: () => EditorSelection | undefined) {
  if (!props.editable) {
    return
  }

  finishEditing()

  const restored = take()

  if (restored !== undefined) {
    restore(restored)
    emit("change")
  }
}

function select(paths: DeckPath[], nextScope: DeckPath) {
  selection.value = paths
  scope.value = nextScope
}

/** A change made from the format pane moved what was selected: leave the text, and follow it. */
function selectFromInspector(paths: DeckPath[]) {
  finishEditing()
  select(paths, paths[0] === undefined ? [] : parentOf(paths[0]))
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

const caret = ref<Point | "start" | "all">()

function startEditing(path: DeckPath, at?: Point | "start" | "all") {
  if (!props.editable) {
    return
  }

  history.seal()
  caret.value = at
  editingPath.value = path
  selection.value = [path]
  scope.value = parentOf(path)
}

function finishEditing() {
  if (editingPath.value === undefined) {
    return
  }

  editingPath.value = undefined
  history.seal()
  void nextTick(() => root.value?.focus({ preventScroll: true }))
}

// The deck stops being the reader's mid-sentence: the text editor closes
// rather than going on showing keystrokes nothing will keep.
watch(
  () => props.editable,
  (editable) => {
    if (!editable) {
      finishEditing()
    }
  },
)

function onTextChange(nodes: DeckNode[]) {
  const path = editingPath.value

  if (path !== undefined) {
    updateChildren(
      (children) =>
        updateAt([...children], path, (node) =>
          node.type === "element" ? { ...node, children: nodes } : node,
        ),
      `text:${path.join(".")}`,
    )
  }
}

function onTextKey(event: KeyboardEvent, editing: HTMLElement) {
  if (event.key === "Escape") {
    event.preventDefault()
    finishEditing()
    return
  }

  if (event.key === "Tab") {
    event.preventDefault()
    return
  }

  if (event.key !== "Enter") {
    return
  }

  const path = editingPath.value
  const node =
    path === undefined || slide.value === undefined ? undefined : elementAt(slide.value.children, path)

  event.preventDefault()

  // In a list, Enter starts the next item with what followed the caret.
  if (path !== undefined && node?.tag === "li" && !event.shiftKey) {
    splitItem(path, editing)
    return
  }

  document.execCommand("insertLineBreak")
}

/** A list item split at the caret: what follows it becomes the next item, which is where typing goes on. */
function splitItem(path: DeckPath, editing: HTMLElement) {
  const range = document.getSelection()?.getRangeAt(0)

  if (range === undefined || !editing.contains(range.startContainer)) {
    return
  }

  const tail = document.createRange()

  tail.setStart(range.startContainer, range.startOffset)
  tail.setEndAfter(editing.lastChild ?? editing)

  const holder = document.createElement("div")

  holder.append(tail.extractContents())

  const before = readInlineDom(editing)
  const after = readInlineDom(holder)
  const index = path.at(-1)!
  const next: DeckPath = [...parentOf(path), index + 1]

  updateChildren((children) => {
    const updated = updateAt([...children], path, (node) =>
      node.type === "element" ? { ...node, children: before } : node,
    )
    const item = nodeAt(updated, path)

    return insertAt(updated, parentOf(path), index + 1, [
      item?.type === "element" ? { ...item, attributes: {}, children: after } : element("li", {}, after),
    ])
  }, "split")
  history.seal()
  editingPath.value = undefined
  void nextTick(() => startEditing(next, "start"))
}

/** Bold, italic, underline or strike: on the words selected while typing, or on whole blocks otherwise. */
function toggleMark(mark: "bold" | "italic" | "underline" | "strike") {
  if (editingPath.value !== undefined) {
    document.execCommand(mark === "strike" ? "strikeThrough" : mark)
    return
  }

  const patches = {
    bold: ["font-weight", "700", "400"],
    italic: ["font-style", "italic", "normal"],
    underline: ["text-decoration", "underline", "none"],
    strike: ["text-decoration", "line-through", "none"],
  } as const
  const [property, on] = patches[mark]
  const current = slide.value

  if (current === undefined || selection.value.length === 0) {
    return
  }

  const allOn = selection.value.every((path) => {
    const node = nodeAt(current.children, path)

    return node?.type === "element" && node.style[property] === on
  })

  updateChildren(
    (children) =>
      selection.value.reduce(
        (nodes, path) =>
          updateAt(nodes, path, (node) => patchNodeStyle(node, { [property]: allOn ? undefined : on })),
        [...children],
      ),
    mark,
  )
  history.seal()
}

function addLink() {
  if (editingPath.value === undefined) {
    return
  }

  const href = window.prompt(t("deck.linkPrompt"))?.trim()

  if (href === undefined) {
    return
  }

  if (href === "") {
    document.execCommand("unlink")
  } else if (/^(https?:|mailto:|#)/.test(href)) {
    document.execCommand("createLink", false, href)
  } else {
    document.execCommand("createLink", false, `https://${href}`)
  }
}

// ---------------------------------------------------------------------------
// Inserting
// ---------------------------------------------------------------------------

let cascade = 0

/** Where a new element goes: the middle of the slide, stepped down a little for each one added in a row. */
function placeAt(width: number, height: number) {
  const step = (cascade % 6) * 32

  cascade += 1
  return { left: px((DECK_WIDTH - width) / 2 + step), top: px((DECK_HEIGHT - height) / 2 + step) }
}

// New text takes the deck's own colour, or its theme's.
const ink = computed(() => deck.value.style.color ?? "var(--text)")

/** Put nodes at the top of the slide's paint order, select them, and return where they went. */
function insertNodes(nodes: readonly DeckNode[], key = "insert"): DeckPath[] {
  const current = slide.value

  if (current === undefined || !props.editable) {
    return []
  }

  const at = current.children.length

  finishEditing()
  updateChildren((children) => insertAt(children, [], at, nodes), key)
  history.seal()

  const paths = nodes.map((_, index) => [at + index])

  select(paths, [])
  return paths
}

function insertText(kind: "text" | "heading" | "list") {
  const width = kind === "heading" ? 1200 : 720
  const style = {
    position: "absolute",
    ...placeAt(width, kind === "heading" ? 90 : 60),
    width: px(width),
    color: ink.value,
  }
  const node =
    kind === "heading"
      ? element("h2", { ...style, "font-size": "72px" }, [text(t("deck.newHeading"))])
      : kind === "list"
        ? element(
            "ul",
            { ...style, "font-size": "36px" },
            [1, 2, 3].map((n) => element("li", {}, [text(t("deck.newItem", { n }))])),
          )
        : element("p", { ...style, "font-size": "40px" }, [text(t("deck.newText"))])
  const [path] = insertNodes([node])

  if (path !== undefined) {
    void nextTick(() => startEditing(kind === "list" ? [...path, 0] : path, "all"))
  }
}

function insertShape(kind: (typeof DECK_SHAPE_KINDS)[number]) {
  const line = kind === "line"
  const [width, height] = line ? [480, 8] : kind.startsWith("arrow") ? [320, 160] : [320, 220]

  insertNodes([
    element(
      "x-shape",
      {
        position: "absolute",
        ...placeAt(width, height),
        width: px(width),
        height: px(height),
        background: line ? ink.value : "var(--accent)",
      },
      [],
      { kind },
    ),
  ])
}

function insertIcon(name: string) {
  insertNodes([
    element(
      "x-icon",
      { position: "absolute", ...placeAt(160, 160), width: "160px", height: "160px", color: ink.value },
      [],
      { name },
    ),
  ])
}

function insertArrow() {
  const x = 760 + (cascade % 6) * 32
  const y = 540 + (cascade % 6) * 32

  cascade += 1
  insertNodes([
    element("x-connector", { color: ink.value, border: `4px solid ${ink.value}` }, [], {
      x1: String(x),
      y1: String(y),
      x2: String(x + 400),
      y2: String(y),
      head: "end",
    }),
  ])
}

function insertTable() {
  const cell = (tag: "th" | "td", n: number) =>
    element(tag, {}, [text(tag === "th" ? t("deck.newColumn", { n }) : "—")])
  const rows = [
    element(
      "tr",
      {},
      [1, 2, 3].map((n) => cell("th", n)),
    ),
    element(
      "tr",
      {},
      [1, 2, 3].map((n) => cell("td", n)),
    ),
    element(
      "tr",
      {},
      [1, 2, 3].map((n) => cell("td", n)),
    ),
  ]

  insertNodes([
    element(
      "table",
      { position: "absolute", ...placeAt(1080, 240), width: "1080px", "font-size": "32px", color: ink.value },
      rows,
    ),
  ])
}

const imageInput = useTemplateRef<HTMLInputElement>("imageInput")

async function insertImages(files: readonly File[], at?: Point) {
  // Uploaded together, inserted in the order they were given.
  const uploaded = await Promise.all(
    files
      .filter((file) => file.type.startsWith("image/"))
      .map(async (file) => {
        try {
          const [src, size] = await Promise.all([
            uploadable(file).then((body) => props.assets.upload(body)),
            imageSize(file),
          ])
          return { file, src, size }
        } catch (error) {
          announce(t("deck.uploadFailed", { error: formatError(error) }), { assertive: true })
          return undefined
        }
      }),
  )

  for (const [index, image] of uploaded.entries()) {
    if (image === undefined) {
      continue
    }

    const { file, src, size } = image
    // As large as it can be inside the margins, in its own proportions.
    const fit = Math.min(1, (DECK_WIDTH - 256) / size.width, (DECK_HEIGHT - 256) / size.height)
    const width = Math.round(size.width * fit)
    const height = Math.round(size.height * fit)

    insertNodes([
      element(
        "img",
        {
          position: "absolute",
          ...(at === undefined ? placeAt(width, height) : centredAt(at, width, height, index)),
          width: px(width),
          height: px(height),
          "object-fit": "cover",
        },
        [],
        { src, alt: file.name.replace(/\.[^.]+$/, "") },
      ),
    ])
  }
}

/** A box centred on where something was dropped, kept on the slide, a step apart from the one before. */
function centredAt(at: Point, width: number, height: number, index: number) {
  const step = index * 32
  const left = Math.min(Math.max(at.x - width / 2 + step, 0), DECK_WIDTH - width)
  const top = Math.min(Math.max(at.y - height / 2 + step, 0), DECK_HEIGHT - height)

  return { left: px(Math.round(left)), top: px(Math.round(top)) }
}

// ---------------------------------------------------------------------------
// Pictures dropped on the stage
// ---------------------------------------------------------------------------

/** Pictures are being dragged over the stage, and will be put where they are let go. */
const dropping = ref(false)

function carriesImages(event: DragEvent) {
  return [...(event.dataTransfer?.items ?? [])].some(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  )
}

function onDragOver(event: DragEvent) {
  if (!props.editable || !carriesImages(event)) {
    return
  }

  event.preventDefault()
  event.dataTransfer!.dropEffect = "copy"
  dropping.value = true
}

function onDragLeave(event: DragEvent) {
  // Leaving the stage for something inside it is not leaving.
  if (!(event.currentTarget as HTMLElement).contains(event.relatedTarget as Node | null)) {
    dropping.value = false
  }
}

function onDrop(event: DragEvent) {
  dropping.value = false

  const files = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith("image/"))

  if (!props.editable || files.length === 0) {
    return
  }

  event.preventDefault()
  void insertImages(files, stage.value?.slidePoint(event.clientX, event.clientY))
}

function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const image = new Image()

    image.onload = () => {
      resolve({ width: image.naturalWidth || 960, height: image.naturalHeight || 540 })
      URL.revokeObjectURL(url)
    }
    image.onerror = () => {
      resolve({ width: 960, height: 540 })
      URL.revokeObjectURL(url)
    }
    image.src = url
  })
}

function onImagePicked(event: Event) {
  const input = event.target as HTMLInputElement

  void insertImages([...(input.files ?? [])])
  input.value = ""
}

const iconQuery = ref("")
const icons = computed(() => {
  const query = iconQuery.value.trim().toLowerCase()

  return query === "" ? DECK_ICON_NAMES : DECK_ICON_NAMES.filter((name) => name.includes(query))
})

// ---------------------------------------------------------------------------
// Arranging, removing, copying
// ---------------------------------------------------------------------------

function removeSelection() {
  if (selection.value.length === 0) {
    return
  }

  finishEditing()
  updateChildren((children) => removeAt(children, selection.value), "remove")
  history.seal()
  selection.value = []
}

/** Move the selection one step, or all the way, up or down the paint order among its siblings. */
function reorder(how: "forward" | "backward" | "front" | "back") {
  const current = slide.value
  const paths = selection.value

  if (current === undefined || paths.length === 0) {
    return
  }

  const parent = parentOf(paths[0]!)

  if (!paths.every((path) => samePath(parentOf(path), parent))) {
    return
  }

  const siblings = childrenAt(current.children, parent)
  const chosen = new Set(paths.map((path) => path.at(-1)!))
  const order = siblings.map((_, index) => index)
  let next: number[]

  if (how === "front") {
    next = [...order.filter((index) => !chosen.has(index)), ...order.filter((index) => chosen.has(index))]
  } else if (how === "back") {
    next = [...order.filter((index) => chosen.has(index)), ...order.filter((index) => !chosen.has(index))]
  } else {
    next = [...order]

    const indices = how === "forward" ? [...chosen].sort((a, b) => b - a) : [...chosen].sort((a, b) => a - b)

    for (const index of indices) {
      const at = next.indexOf(index)
      const swap = how === "forward" ? at + 1 : at - 1

      if (swap >= 0 && swap < next.length && !chosen.has(next[swap]!)) {
        ;[next[at], next[swap]] = [next[swap]!, next[at]!]
      }
    }
  }

  updateChildren((children) => {
    const holder = childrenAt(children, parent)
    const reordered = next.map((index) => holder[index]!)

    return parent.length === 0
      ? reordered
      : updateAt([...children], parent, (node) =>
          node.type === "element" ? { ...node, children: reordered } : node,
        )
  }, "reorder")
  history.seal()
  selection.value = next.flatMap((index, at) => (chosen.has(index) ? [[...parent, at]] : []))
}

function alignSelection(how: DeckAlignment) {
  stage.value?.align(how)
}

function distributeSelection(axis: "x" | "y") {
  stage.value?.distribute(axis)
}

function groupSelection() {
  const grouped = stage.value?.group()

  if (grouped !== undefined) {
    select([grouped], parentOf(grouped))
  }
}

function ungroupSelection() {
  const [path] = selection.value

  if (path !== undefined && selection.value.length === 1) {
    const members = stage.value?.ungroup(path)

    if (members !== undefined) {
      select(members, parentOf(path))
    }
  }
}

const canUngroup = computed(() => {
  const [path] = selection.value
  const node =
    path === undefined || slide.value === undefined ? undefined : elementAt(slide.value.children, path)

  return selection.value.length === 1 && node?.tag === "div" && node.children.length > 0
})

function selectedNodes(): DeckNode[] {
  const current = slide.value

  return current === undefined ? [] : selection.value.flatMap((path) => nodeAt(current.children, path) ?? [])
}

/** Copies are pinned elements shifted a little, so a duplicate is seen to be one. */
function offsetCopies(nodes: readonly DeckNode[], step: number): DeckNode[] {
  return nodes.map((node) => {
    if (node.type === "text") {
      return node
    }

    if (node.type === "element" && node.tag === "x-connector") {
      return ["x1", "y1", "x2", "y2"].reduce<DeckNode>((next, name) => {
        const value = Number.parseFloat(node.attributes[name] ?? "")

        return Number.isFinite(value) && next.type === "element"
          ? { ...next, attributes: { ...next.attributes, [name]: String(value + step) } }
          : next
      }, node)
    }

    if (node.style.position !== "absolute") {
      return node
    }

    const left = Number.parseFloat(node.style.left ?? "")
    const top = Number.parseFloat(node.style.top ?? "")

    return patchNodeStyle(node, {
      ...(Number.isFinite(left) ? { left: px(left + step) } : {}),
      ...(Number.isFinite(top) ? { top: px(top + step) } : {}),
    })
  })
}

function duplicateSelection() {
  const nodes = selectedNodes()

  if (nodes.length > 0) {
    insertNodes(offsetCopies(nodes, 32), "duplicate")
  }
}

let pasteCount = 0

/** Whether a key or clipboard event happened in the slide list, where it is about whole slides. */
function inSlideList(event: Event) {
  return event.target instanceof Element && event.target.closest(".slides-slide-list") !== null
}

/**
 * The slide on screen as clipboard text: a deck of that one slide, written as
 * any deck is, so it pastes into this deck, into another one, or into a model's
 * answer as a slide.
 */
function slideClipboardText(index: number) {
  const slide = deck.value.slides[index]

  return slide === undefined ? undefined : writeDeck({ ...deck.value, slides: [slide] })
}

function onCopy(event: ClipboardEvent, cut = false) {
  if (inSlideList(event) && editingPath.value === undefined) {
    const text = slideClipboardText(slideIndex.value)

    if (text !== undefined) {
      event.preventDefault()
      event.clipboardData?.setData("text/plain", text)

      if (cut && props.editable) {
        removeSlide(slideIndex.value)
      }
    }

    return
  }

  if (!owningKeys(event) || selection.value.length === 0 || editingPath.value !== undefined) {
    return
  }

  event.preventDefault()
  event.clipboardData?.setData("text/plain", writeDeckNodes(selectedNodes()))
  pasteCount = 0

  if (cut) {
    removeSelection()
  }
}

function onPaste(event: ClipboardEvent) {
  if (inSlideList(event) && editingPath.value === undefined && props.editable) {
    const pasted = event.clipboardData?.getData("text/plain") ?? ""

    if (pasteSlides(pasted)) {
      event.preventDefault()
    }

    return
  }

  if (!owningKeys(event) || editingPath.value !== undefined || !props.editable) {
    return
  }

  const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith("image/"))

  if (files.length > 0) {
    event.preventDefault()
    void insertImages(files)
    return
  }

  const pasted = event.clipboardData?.getData("text/plain") ?? ""

  if (pasted.trim() === "") {
    return
  }

  event.preventDefault()
  pasteText(pasted)
}

/**
 * Whole slides, from a copy in the slide list or any deck's HTML: put in after
 * the slide on screen, each with an id of its own. Answers whether `pasted`
 * held slides at all.
 */
function pasteSlides(pasted: string) {
  if (!/<section[\s>]/i.test(pasted)) {
    return false
  }

  const slides = readDeck(pasted).deck.slides

  if (slides.length === 0) {
    return false
  }

  const ids = slideIds()
  const fresh = slides.map((slide) => {
    const id = uniqueId(slide.id, ids)

    ids.add(id)
    return { ...slide, id }
  })
  const at = slideIndex.value + 1

  commit(
    { ...deck.value, slides: [...deck.value.slides.slice(0, at), ...fresh, ...deck.value.slides.slice(at)] },
    "slides",
  )
  history.seal()
  pickSlide(at)
  return true
}

/** Text pasted onto the slide: the subset's HTML as the elements it is, anything else as a paragraph. */
function pasteText(pasted: string) {
  if (pasteSlides(pasted)) {
    return
  }

  pasteCount += 1

  const nodes = /^\s*</.test(pasted)
    ? readDeckNodes(pasted)
    : [
        element(
          "p",
          {
            position: "absolute",
            ...placeAt(960, 60),
            width: "960px",
            "font-size": "36px",
            color: ink.value,
          },
          [text(pasted.trim())],
        ),
      ]

  if (nodes.length > 0) {
    insertNodes(offsetCopies(nodes, 32 * pasteCount), "paste")
  }
}

// ---------------------------------------------------------------------------
// The right-click menu
// ---------------------------------------------------------------------------

const menu = shallowRef<{ x: number; y: number; entries: DeckMenuEntry[] }>()

/** Everything at the level being worked in. */
function selectAll() {
  const children = slide.value === undefined ? [] : childrenAt(slide.value.children, scope.value)

  select(
    children.flatMap((node, index) => (node.type === "text" ? [] : [[...scope.value, index]])),
    scope.value,
  )
}

/** The modifier as the reader's platform writes it. */
const MOD = /mac|iphone|ipad/i.test(globalThis.navigator?.platform ?? "") ? "⌘" : "Ctrl+"
const SHIFT = MOD === "⌘" ? "⇧" : "Shift+"

/** Copy without a clipboard event, for the menu: the same text a copy writes. */
async function copySelection(cut: boolean) {
  const nodes = selectedNodes()

  if (nodes.length === 0) {
    return
  }

  try {
    await navigator.clipboard.writeText(writeDeckNodes(nodes))
    pasteCount = 0

    if (cut) {
      removeSelection()
    }
  } catch (error) {
    announce(t("deck.menu.clipboardFailed", { error: formatError(error) }), { assertive: true })
  }
}

/** Paste without a clipboard event, for the menu: pictures first, then text. */
async function pasteFromClipboard() {
  try {
    const items = typeof navigator.clipboard.read === "function" ? await navigator.clipboard.read() : []
    const images = await Promise.all(
      items.flatMap((item) =>
        item.types
          .filter((type) => type.startsWith("image/"))
          .slice(0, 1)
          .map(
            async (type) => new File([await item.getType(type)], `pasted.${type.split("/")[1]}`, { type }),
          ),
      ),
    )

    if (images.length > 0) {
      await insertImages(images)
      return
    }

    const pasted = await navigator.clipboard.readText()

    if (pasted.trim() !== "") {
      pasteText(pasted)
    }
  } catch (error) {
    announce(t("deck.menu.clipboardFailed", { error: formatError(error) }), { assertive: true })
  }
}

function editTableAt(path: DeckPath, edit: TableEdit) {
  const current = slide.value
  const result = current === undefined ? undefined : editTable(current.children, path, edit)

  if (result !== undefined) {
    commit(
      updateSlideChildren(deck.value, slideIndex.value, () => result.nodes),
      "table",
    )
    history.seal()
    select([result.selection], parentOf(result.selection))
  }
}

function slideEntries(index: number): DeckMenuEntry[] {
  const hidden = deck.value.slides[index]?.hidden === true

  return [
    { label: t("deck.slide.add"), icon: "i-jannchie-plus", keys: `${MOD}M`, run: addSlide },
    {
      label: t("deck.slide.duplicate"),
      icon: "i-jannchie-copy",
      keys: `${MOD}D`,
      run: () => duplicateSlide(index),
    },
    "separator",
    {
      label: t("deck.slide.cut"),
      icon: "i-jannchie-scissors",
      keys: `${MOD}X`,
      run: () => copySlide(index, true),
    },
    { label: t("deck.slide.copy"), keys: `${MOD}C`, run: () => copySlide(index, false) },
    { label: t("deck.slide.paste"), icon: "i-jannchie-clipboard", keys: `${MOD}V`, run: pasteFromClipboard },
    "separator",
    {
      label: t(hidden ? "deck.slide.show" : "deck.slide.hide"),
      icon: hidden ? "i-jannchie-eye" : "i-jannchie-eye-off",
      run: () => toggleHidden(index),
    },
    {
      label: t("deck.slide.delete"),
      icon: "i-jannchie-trash",
      keys: "Del",
      danger: true,
      disabled: deck.value.slides.length <= 1,
      run: () => removeSlide(index),
    },
  ]
}

/** A whole slide to the clipboard, for the menu: what Ctrl+C in the slide list writes. */
async function copySlide(index: number, cut: boolean) {
  const text = slideClipboardText(index)

  if (text === undefined) {
    return
  }

  try {
    await navigator.clipboard.writeText(text)

    if (cut) {
      removeSlide(index)
    }
  } catch (error) {
    announce(t("deck.menu.clipboardFailed", { error: formatError(error) }), { assertive: true })
  }
}

function openStageMenu(at: { x: number; y: number }, under: DeckPath | undefined) {
  if (!props.editable) {
    return
  }

  const current = slide.value
  const cell = under !== undefined && current !== undefined ? tableAt(current.children, under) : undefined
  const tableEntries: DeckMenuEntry[] =
    cell === undefined || under === undefined
      ? []
      : [
          "separator",
          ...TABLE_EDITS.map((edit) => ({
            label: t(`deck.table.${edit}`),
            icon: edit.startsWith("remove") ? "i-jannchie-trash" : "i-jannchie-plus",
            danger: edit.startsWith("remove"),
            run: () => editTableAt(under, edit),
          })),
        ]

  menu.value = {
    ...at,
    entries:
      selection.value.length === 0
        ? [
            {
              label: t("deck.menu.paste"),
              icon: "i-jannchie-clipboard",
              keys: `${MOD}V`,
              run: pasteFromClipboard,
            },
            { label: t("deck.menu.selectAll"), keys: `${MOD}A`, run: selectAll },
            "separator",
            ...slideEntries(slideIndex.value),
          ]
        : [
            {
              label: t("deck.menu.cut"),
              icon: "i-jannchie-scissors",
              keys: `${MOD}X`,
              run: () => copySelection(true),
            },
            {
              label: t("deck.menu.copy"),
              icon: "i-jannchie-copy",
              keys: `${MOD}C`,
              run: () => copySelection(false),
            },
            {
              label: t("deck.menu.paste"),
              icon: "i-jannchie-clipboard",
              keys: `${MOD}V`,
              run: pasteFromClipboard,
            },
            { label: t("deck.duplicate"), keys: `${MOD}D`, run: duplicateSelection },
            "separator",
            { label: t("deck.arrange.front"), keys: `${MOD}${SHIFT}]`, run: () => reorder("front") },
            { label: t("deck.arrange.forward"), keys: `${MOD}]`, run: () => reorder("forward") },
            { label: t("deck.arrange.backward"), keys: `${MOD}[`, run: () => reorder("backward") },
            { label: t("deck.arrange.back"), keys: `${MOD}${SHIFT}[`, run: () => reorder("back") },
            "separator",
            {
              label: t("deck.arrange.group"),
              keys: `${MOD}G`,
              disabled: selection.value.length < 2,
              run: groupSelection,
            },
            {
              label: t("deck.arrange.ungroup"),
              keys: `${MOD}${SHIFT}G`,
              disabled: !canUngroup.value,
              run: ungroupSelection,
            },
            ...tableEntries,
            "separator",
            {
              label: t("deck.delete"),
              icon: "i-jannchie-trash",
              keys: "Del",
              danger: true,
              run: removeSelection,
            },
          ],
  }
}

function openSlideMenu(index: number, at: { x: number; y: number }) {
  if (props.editable) {
    menu.value = { ...at, entries: slideEntries(index) }
  }
}

/** The scheme the editor is drawn in, for the menu teleported out of it. */
const scheme = computed(() => root.value?.closest<HTMLElement>("[data-scheme]")?.dataset.scheme)

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Whether a key or clipboard event is the editor's to answer: inside it, and not in a field. */
function owningKeys(event: Event) {
  const target = event.target as HTMLElement | null

  if (target === null || root.value === null || !root.value.contains(target)) {
    return false
  }

  return !target.closest("input, textarea, select, [contenteditable='true']")
}

/** A focused control: what Enter, Space and the arrows mean is its own business. */
const CONTROL =
  "button, a[href], summary, [role='button'], [role='menuitem'], [role='option'], [role='tab'], [role='slider'], [role='radio'], [role='checkbox']"

function onKeydown(event: KeyboardEvent) {
  if (!owningKeys(event) || event.isComposing) {
    return
  }

  const mod = event.ctrlKey || event.metaKey
  const key = event.key.toLowerCase()

  if (
    (key === "enter" || key === " " || key.startsWith("arrow")) &&
    (event.target as HTMLElement).closest(CONTROL) !== null
  ) {
    return
  }

  if (mod && key === "z") {
    event.preventDefault()

    if (event.shiftKey) {
      redo()
    } else {
      undo()
    }

    return
  }

  if (mod && key === "y") {
    event.preventDefault()
    redo()
    return
  }

  if (!props.editable) {
    return
  }

  // A new slide after this one, as presentation programs have it.
  if (mod && key === "m" && props.editable) {
    event.preventDefault()
    addSlide()
    return
  }

  // Zoom: the keys a browser zooms the page with, zooming the slide instead.
  if (mod && (key === "=" || key === "+" || key === "-" || key === "0")) {
    event.preventDefault()

    if (key === "0") {
      void stage.value?.zoomFit()
    } else if (key === "-") {
      stage.value?.zoomOut()
    } else {
      stage.value?.zoomIn()
    }

    return
  }

  if (mod && key === "a") {
    event.preventDefault()
    selectAll()
    return
  }

  if (mod && key === "d") {
    event.preventDefault()
    duplicateSelection()
    return
  }

  if (mod && key === "g") {
    event.preventDefault()

    if (event.shiftKey) {
      ungroupSelection()
    } else {
      groupSelection()
    }

    return
  }

  if (mod && (key === "]" || key === "[")) {
    event.preventDefault()
    reorder(key === "]" ? (event.shiftKey ? "front" : "forward") : event.shiftKey ? "back" : "backward")
    return
  }

  if (mod && (key === "b" || key === "i" || key === "u")) {
    event.preventDefault()
    toggleMark(key === "b" ? "bold" : key === "i" ? "italic" : "underline")
    return
  }

  if (key === "delete" || key === "backspace") {
    event.preventDefault()
    removeSelection()
    return
  }

  if (key.startsWith("arrow") && selection.value.length > 0) {
    event.preventDefault()

    const step = event.shiftKey ? 10 : 1
    const delta = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[
      key
    ] as [number, number] | undefined

    if (delta !== undefined) {
      stage.value?.nudge(delta[0], delta[1])
    }

    return
  }

  if (key === "enter" && selection.value.length === 1) {
    const [path] = selection.value
    const node =
      path === undefined || slide.value === undefined ? undefined : elementAt(slide.value.children, path)

    if (path !== undefined && node !== undefined && isDeckTextBlock(node.tag)) {
      event.preventDefault()
      startEditing(path, "all")
    }

    return
  }

  if (key === "escape") {
    if (selection.value.length > 0 || scope.value.length > 0) {
      event.preventDefault()

      if (scope.value.length > 0) {
        select([scope.value], parentOf(scope.value))
      } else {
        select([], [])
      }
    }
  }
}

onMounted(() => {
  document.addEventListener("copy", onCopy)
  document.addEventListener("cut", onCut)
  document.addEventListener("paste", onPaste)
})

onBeforeUnmount(() => {
  document.removeEventListener("copy", onCopy)
  document.removeEventListener("cut", onCut)
  document.removeEventListener("paste", onPaste)
})

function onCut(event: ClipboardEvent) {
  onCopy(event, true)
}

function onKeyup() {
  // A run of arrow presses is one step back.
  history.seal()
}

// ---------------------------------------------------------------------------
// Slides
// ---------------------------------------------------------------------------

function slideIds() {
  return new Set(deck.value.slides.map((candidate) => candidate.id))
}

function pickSlide(index: number) {
  if (index === slideIndex.value) {
    return
  }

  finishEditing()
  slideIndex.value = index
  select([], [])
}

function addSlide() {
  const current = slide.value
  const id = uniqueId(`slide-${deck.value.slides.length + 1}`, slideIds())
  const fresh: DeckSlide = {
    id,
    style: { background: current?.style.background ?? "#ffffff", padding: "128px", gap: "32px" },
    notes: "",
    children: [element("h2", { "font-size": "72px" }, [text(t("deck.slide.newTitle"))])],
  }
  const at = slideIndex.value + 1

  commit(
    { ...deck.value, slides: [...deck.value.slides.slice(0, at), fresh, ...deck.value.slides.slice(at)] },
    "slides",
  )
  history.seal()
  pickSlide(at)
}

function duplicateSlide(index: number) {
  const source = deck.value.slides[index]

  if (source === undefined) {
    return
  }

  const copy: DeckSlide = { ...source, id: uniqueId(`${source.id}-copy`, slideIds()) }
  // Duplicating a slide and moving what is on it is how a magic move is made:
  // a slide with no way of leaving of its own leaves for its copy by one.
  const original: DeckSlide = source.transition === undefined ? { ...source, transition: "magic" } : source

  commit(
    {
      ...deck.value,
      slides: [...deck.value.slides.slice(0, index), original, copy, ...deck.value.slides.slice(index + 1)],
    },
    "slides",
  )
  history.seal()
  pickSlide(index + 1)
}

function removeSlide(index: number) {
  if (deck.value.slides.length <= 1) {
    return
  }

  const shown = slideIndex.value

  commit({ ...deck.value, slides: deck.value.slides.filter((_, at) => at !== index) }, "slides")
  history.seal()

  // The slide on screen stays on screen: one removed before it moves it up a place.
  if (index < shown) {
    slideIndex.value = shown - 1
  } else if (index === shown) {
    slideIndex.value = Math.min(shown, deck.value.slides.length - 1)
    select([], [])
  }
}

function moveSlide(from: number, to: number) {
  if (from === to || to < 0 || to >= deck.value.slides.length) {
    return
  }

  const slides = [...deck.value.slides]
  const [moved] = slides.splice(from, 1)

  slides.splice(to, 0, moved!)
  commit({ ...deck.value, slides }, "slides")
  history.seal()

  // The moved slide is shown; a selection made on another slide does not travel with it.
  if (from !== slideIndex.value) {
    select([], [])
  }

  slideIndex.value = to
}

function toggleHidden(index: number) {
  commit(
    updateSlide(deck.value, index, (current) => {
      const { hidden: _, ...rest } = current

      return current.hidden === true ? rest : { ...current, hidden: true }
    }),
    "slides",
  )
  history.seal()
}

function setNotes(event: Event) {
  const notes = (event.target as HTMLTextAreaElement).value

  commit(
    updateSlide(deck.value, slideIndex.value, (current) => ({ ...current, notes })),
    "notes",
  )
}

const hasSelection = computed(() => selection.value.length > 0)
</script>

<template>
  <div
    ref="root"
    class="slides-editor flex h-full min-h-0 flex-col bg-slides-bg text-[length:var(--slides-font-size)] text-slides-text outline-none"
    tabindex="-1"
    @keydown="onKeydown"
    @keyup="onKeyup"
  >
    <!-- The toolbar: inserting, then formatting, then arranging. -->
    <div
      class="slides-toolbar flex flex-wrap items-center gap-0.5 border-b border-slides-line bg-slides-panel px-2 py-1"
      role="toolbar"
      :aria-label="t('deck.toolbar')"
    >
      <!-- Reading, the toolbar holds only what reading uses: presenting. -->
      <template v-if="editable">
        <button
          v-for="action in [
            { id: 'undo', icon: 'i-jannchie-undo', run: undo, disabled: !history.canUndo.value },
            { id: 'redo', icon: 'i-jannchie-redo', run: redo, disabled: !history.canRedo.value },
          ]"
          :key="action.id"
          type="button"
          class="slides-icon-button disabled:opacity-35"
          :title="t(`deck.action.${action.id}`)"
          :aria-label="t(`deck.action.${action.id}`)"
          :disabled="action.disabled"
          @mousedown.prevent
          @click="action.run"
        >
          <i :class="action.icon" class="h-4 w-4" aria-hidden="true" />
        </button>

        <span class="mx-1 h-4 w-px bg-slides-line" aria-hidden="true" />

        <button
          v-for="kind in ['text', 'heading', 'list'] as const"
          :key="kind"
          type="button"
          class="slides-icon-button"
          :title="t(`deck.insert.${kind}`)"
          :aria-label="t(`deck.insert.${kind}`)"
          @mousedown.prevent
          @click="insertText(kind)"
        >
          <i
            :class="
              kind === 'text'
                ? 'i-jannchie-text'
                : kind === 'heading'
                  ? 'i-jannchie-heading'
                  : 'i-jannchie-list'
            "
            class="h-4 w-4"
            aria-hidden="true"
          />
        </button>

        <DeckMenu icon="i-jannchie-shapes" :label="t('deck.insert.shape')">
          <template #default="{ close }">
            <div class="grid grid-cols-5 gap-1 p-1">
              <button
                v-for="kind in DECK_SHAPE_KINDS"
                :key="kind"
                type="button"
                class="h-10 w-10 flex items-center justify-center rounded-md slides-hover slides-focus"
                :title="t(`deck.shape.${kind}`)"
                :aria-label="t(`deck.shape.${kind}`)"
                @click="
                  () => {
                    insertShape(kind)
                    close()
                  }
                "
              >
                <svg viewBox="0 0 100 100" class="h-6 w-6 fill-current slides-ink" aria-hidden="true">
                  <rect v-if="kind === 'rect'" x="8" y="22" width="84" height="56" />
                  <rect v-else-if="kind === 'rounded'" x="8" y="22" width="84" height="56" rx="16" />
                  <ellipse v-else-if="kind === 'ellipse'" cx="50" cy="50" rx="42" ry="32" />
                  <line
                    v-else-if="kind === 'line'"
                    x1="8"
                    y1="50"
                    x2="92"
                    y2="50"
                    stroke="currentColor"
                    stroke-width="8"
                  />
                  <polygon
                    v-else
                    :points="
                      {
                        diamond: '50,8 92,50 50,92 8,50',
                        triangle: '50,10 92,88 8,88',
                        'arrow-right': '8,34 56,34 56,14 92,50 56,86 56,66 8,66',
                        'arrow-left': '92,34 44,34 44,14 8,50 44,86 44,66 92,66',
                        'arrow-up': '34,92 34,44 14,44 50,8 86,44 66,44 66,92',
                        'arrow-down': '34,8 34,56 14,56 50,92 86,56 66,56 66,8',
                      }[kind]
                    "
                  />
                </svg>
              </button>
            </div>
          </template>
        </DeckMenu>

        <DeckMenu icon="i-jannchie-smile" :label="t('deck.insert.icon')">
          <template #default="{ close }">
            <div class="w-72 p-1">
              <input
                v-model="iconQuery"
                class="slides-field mb-1 !py-1"
                :placeholder="t('deck.iconSearch')"
                :aria-label="t('deck.iconSearch')"
              />
              <div class="grid grid-cols-8 gap-0.5">
                <button
                  v-for="name in icons"
                  :key="name"
                  type="button"
                  class="h-8 w-8 flex items-center justify-center rounded-md slides-hover slides-focus"
                  :title="name"
                  :aria-label="name"
                  @click="
                    () => {
                      insertIcon(name)
                      close()
                    }
                  "
                >
                  <span
                    class="h-4.5 w-4.5 [&>svg]:block [&>svg]:h-full [&>svg]:w-full"
                    aria-hidden="true"
                    v-html="deckIconMarkup(name)"
                  />
                </button>
              </div>
            </div>
          </template>
        </DeckMenu>

        <button
          type="button"
          class="slides-icon-button"
          :title="t('deck.insert.image')"
          :aria-label="t('deck.insert.image')"
          @mousedown.prevent
          @click="imageInput?.click()"
        >
          <i class="i-jannchie-image h-4 w-4" aria-hidden="true" />
        </button>
        <input
          ref="imageInput"
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
          multiple
          class="hidden"
          @change="onImagePicked"
        />

        <button
          v-for="action in [
            { id: 'table', icon: 'i-jannchie-table', run: insertTable },
            { id: 'arrow', icon: 'i-jannchie-arrow-right', run: insertArrow },
          ]"
          :key="action.id"
          type="button"
          class="slides-icon-button"
          :title="t(`deck.insert.${action.id}`)"
          :aria-label="t(`deck.insert.${action.id}`)"
          @mousedown.prevent
          @click="action.run"
        >
          <i :class="action.icon" class="h-4 w-4" aria-hidden="true" />
        </button>

        <span class="mx-1 h-4 w-px bg-slides-line" aria-hidden="true" />

        <button
          v-for="mark in [
            { id: 'bold', icon: 'i-jannchie-bold', label: 'deck.action.bold' },
            { id: 'italic', icon: 'i-jannchie-italic', label: 'deck.action.italic' },
            { id: 'underline', icon: 'i-jannchie-underline', label: 'deck.underline' },
            { id: 'strike', icon: 'i-jannchie-strikethrough', label: 'deck.action.strike' },
          ] as const"
          :key="mark.id"
          type="button"
          class="slides-icon-button disabled:opacity-35"
          :title="t(mark.label)"
          :aria-label="t(mark.label)"
          :disabled="!hasSelection"
          @mousedown.prevent
          @click="toggleMark(mark.id)"
        >
          <i :class="mark.icon" class="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="slides-icon-button disabled:opacity-35"
          :title="t('deck.action.link')"
          :aria-label="t('deck.action.link')"
          :disabled="editingPath === undefined"
          @mousedown.prevent
          @click="addLink"
        >
          <i class="i-jannchie-link h-4 w-4" aria-hidden="true" />
        </button>

        <span class="mx-1 h-4 w-px bg-slides-line" aria-hidden="true" />

        <DeckMenu icon="i-jannchie-align-center-both" :label="t('deck.arrange')" :disabled="!hasSelection">
          <template #default="{ close }">
            <div class="flex min-w-52 flex-col">
              <button
                v-for="how in ['forward', 'backward', 'front', 'back'] as const"
                :key="how"
                type="button"
                class="slides-menu-item"
                @click="
                  () => {
                    reorder(how)
                    close()
                  }
                "
              >
                <i
                  :class="
                    {
                      forward: 'i-jannchie-arrange-bring-forward',
                      backward: 'i-jannchie-arrange-send-backward',
                      front: 'i-jannchie-arrange-bring-to-front',
                      back: 'i-jannchie-arrange-send-to-back',
                    }[how]
                  "
                  class="h-4 w-4 slides-ink-2"
                  aria-hidden="true"
                />
                {{ t(`deck.arrange.${how}`) }}
              </button>
              <hr class="my-1 border-slides-line" />
              <div class="grid grid-cols-6 gap-0.5 px-1">
                <button
                  v-for="how in ['left', 'centre', 'right', 'top', 'middle', 'bottom'] as const"
                  :key="how"
                  type="button"
                  class="h-8 w-8 flex items-center justify-center rounded-md slides-hover slides-focus"
                  :title="t(`deck.align.${how}`)"
                  :aria-label="t(`deck.align.${how}`)"
                  @click="alignSelection(how)"
                >
                  <i
                    :class="
                      {
                        left: 'i-jannchie-align-objects-left',
                        centre: 'i-jannchie-align-objects-center-horizontal',
                        right: 'i-jannchie-align-objects-right',
                        top: 'i-jannchie-align-objects-top',
                        middle: 'i-jannchie-align-objects-center-vertical',
                        bottom: 'i-jannchie-align-objects-bottom',
                      }[how]
                    "
                    class="h-4 w-4"
                    aria-hidden="true"
                  />
                </button>
              </div>
              <button
                v-for="axis in ['x', 'y'] as const"
                :key="axis"
                type="button"
                class="slides-menu-item"
                :disabled="selection.length < 3"
                @click="
                  () => {
                    distributeSelection(axis)
                    close()
                  }
                "
              >
                <i
                  :class="
                    axis === 'x' ? 'i-jannchie-distribute-horizontal' : 'i-jannchie-distribute-vertical'
                  "
                  class="h-4 w-4 slides-ink-2"
                  aria-hidden="true"
                />
                {{ t(`deck.distribute.${axis}`) }}
              </button>
              <hr class="my-1 border-slides-line" />
              <button
                type="button"
                class="slides-menu-item"
                :disabled="selection.length < 2"
                @click="
                  () => {
                    groupSelection()
                    close()
                  }
                "
              >
                <i class="i-jannchie-group h-4 w-4 slides-ink-2" aria-hidden="true" />
                {{ t("deck.arrange.group") }}
              </button>
              <button
                type="button"
                class="slides-menu-item"
                :disabled="!canUngroup"
                @click="
                  () => {
                    ungroupSelection()
                    close()
                  }
                "
              >
                <i class="i-jannchie-ungroup h-4 w-4 slides-ink-2" aria-hidden="true" />
                {{ t("deck.arrange.ungroup") }}
              </button>
            </div>
          </template>
        </DeckMenu>

        <button
          v-for="action in [
            { id: 'duplicate', icon: 'i-jannchie-copy', run: duplicateSelection },
            { id: 'delete', icon: 'i-jannchie-trash', run: removeSelection },
          ]"
          :key="action.id"
          type="button"
          class="slides-icon-button disabled:opacity-35"
          :title="t(`deck.${action.id}`)"
          :aria-label="t(`deck.${action.id}`)"
          :disabled="!hasSelection"
          @mousedown.prevent
          @click="action.run"
        >
          <i :class="action.icon" class="h-4 w-4" aria-hidden="true" />
        </button>
      </template>

      <span class="flex-1" />

      <DeckMenu
        v-if="editable"
        icon="i-jannchie-palette"
        :label="t('deck.design')"
        show-label
        placement="bottom-end"
      >
        <template #default>
          <DeckDesign :deck="deck" :editable="editable" @commit="commit" @seal="history.seal()" />
        </template>
      </DeckMenu>
      <button type="button" class="slides-tool" :title="t('deck.present')" @click="presenting = 'present'">
        <i class="i-jannchie-play h-4 w-4 slides-ink" aria-hidden="true" />
        {{ t("deck.present") }}
      </button>
      <button
        type="button"
        class="slides-icon-button"
        :title="t('deck.presenterView')"
        :aria-label="t('deck.presenterView')"
        @click="presenting = 'presenter'"
      >
        <i class="i-jannchie-presentation h-4 w-4" aria-hidden="true" />
      </button>
      <button
        v-if="editable"
        type="button"
        class="slides-icon-button"
        :class="{ 'slides-pressed': inspectorOpen }"
        :title="t('deck.inspector')"
        :aria-label="t('deck.inspector')"
        :aria-pressed="inspectorOpen"
        @click="inspectorOpen = !inspectorOpen"
      >
        <i class="i-jannchie-sliders h-4 w-4" aria-hidden="true" />
      </button>
    </div>

    <div class="relative min-h-0 flex flex-1">
      <DeckSlideList
        class="slides-slide-list w-40 shrink-0 border-r border-slides-line bg-slides-bg"
        :deck="deck"
        :slide-index="slideIndex"
        :editable="editable"
        :resolve-asset="resolveAsset"
        @pick="pickSlide"
        @add="addSlide"
        @duplicate="duplicateSlide"
        @remove="removeSlide"
        @move="moveSlide"
        @toggle-hidden="toggleHidden"
        @menu="openSlideMenu"
      />

      <div
        class="slides-stage-area relative min-w-0 flex flex-1 flex-col bg-slides-stage"
        @dragenter="onDragOver"
        @dragover="onDragOver"
        @dragleave="onDragLeave"
        @drop="onDrop"
      >
        <div
          v-if="dropping"
          class="slides-drop pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-[var(--slides-radius-lg)] border-2 border-dashed border-slides-selection bg-slides-selection/6"
          aria-hidden="true"
        >
          <span class="slides-popover flex items-center gap-2 px-3 py-2">
            <i class="i-jannchie-image-plus h-4 w-4" aria-hidden="true" />
            {{ t("deck.dropImages") }}
          </span>
        </div>
        <div class="relative min-h-0 flex-1">
          <DeckStage
            ref="stage"
            class="h-full"
            :deck="deck"
            :slide-index="slideIndex"
            :selection="selection"
            :scope="scope"
            :editing-path="editingPath"
            :caret-at="caret"
            :editable="editable"
            :resolve-asset="resolveAsset"
            @select="select"
            @menu="openStageMenu"
            @update="updateChildren"
            @seal="history.seal()"
            @edit="(path, at) => (path === undefined ? finishEditing() : startEditing(path, at))"
            @text-change="onTextChange"
            @text-done="finishEditing"
            @text-key="onTextKey"
          />
          <div
            class="slides-zoom absolute bottom-3 right-5 z-10 flex items-center gap-0.5 rounded-[var(--slides-radius-lg)] bg-slides-panel p-0.5 shadow-[var(--slides-shadow)]"
            role="group"
            :aria-label="t('deck.zoom.label')"
          >
            <button
              type="button"
              class="slides-icon-button !h-7 !w-7"
              :title="`${t('deck.zoom.out')} (${MOD}-)`"
              :aria-label="t('deck.zoom.out')"
              @click="stage?.zoomOut()"
            >
              <i class="i-jannchie-minus h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="slides-tool !h-7 min-w-13 justify-center slides-num"
              :title="`${stage?.fitted ? t('deck.zoom.actual') : t('deck.zoom.fit')} (${MOD}0)`"
              @click="stage?.fitted ? stage?.zoomActual() : stage?.zoomFit()"
            >
              {{ Math.round((stage?.scale ?? 1) * 100) }}%
            </button>
            <button
              type="button"
              class="slides-icon-button !h-7 !w-7"
              :title="`${t('deck.zoom.in')} (${MOD}=)`"
              :aria-label="t('deck.zoom.in')"
              @click="stage?.zoomIn()"
            >
              <i class="i-jannchie-plus h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="slides-notes border-t border-slides-line bg-slides-panel">
          <button
            type="button"
            class="w-full flex items-center gap-1.5 px-3 py-1 text-left text-xs slides-ink-2 slides-hover slides-focus"
            :aria-expanded="notesOpen"
            @click="notesOpen = !notesOpen"
          >
            <i
              class="i-jannchie-chevron-right slides-chevron"
              :class="{ 'rotate-90': notesOpen }"
              aria-hidden="true"
            />
            {{ t("deck.notes") }}
            <span class="flex-1" />
            <span class="slides-num">{{
              t("deck.slide.position", { slide: slideIndex + 1, count: deck.slides.length })
            }}</span>
          </button>
          <textarea
            v-if="notesOpen && slide"
            :value="slide.notes"
            class="block h-20 w-full resize-none bg-transparent px-3 pb-2 text-sm outline-none"
            :placeholder="t('deck.notesPlaceholder')"
            :aria-label="t('deck.notes')"
            :readonly="!editable"
            @input="setNotes"
            @blur="history.seal()"
          />
        </div>
      </div>

      <DeckInspector
        v-if="editable && inspectorOpen"
        class="slides-inspector w-72 shrink-0 border-l border-slides-line"
        :class="{ 'absolute inset-y-0 right-0 z-20 shadow-[var(--slides-shadow)]': inspectorFloats }"
        :deck="deck"
        :slide-index="slideIndex"
        :selection="selection"
        :editable="editable"
        :measure="(path) => stage?.measure(path)"
        @commit="commit"
        @seal="history.seal()"
        @pin="stage?.pinSelection()"
        @nudge="(dx, dy) => stage?.nudge(dx, dy)"
        @select="selectFromInspector"
      />
    </div>

    <DeckContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :entries="menu.entries"
      :label="t('deck.menu.label')"
      :scheme="scheme"
      @close="menu = undefined"
    />

    <DeckPresenter
      v-if="presenting"
      :deck="deck"
      :start="slideIndex"
      :presenter="presenting === 'presenter'"
      :resolve-asset="resolveAsset"
      @close="
        (at) => {
          presenting = false
          pickSlide(at)
        }
      "
    />

    <!--
      The editor's own spoken status. A host's live region cannot hear it: the
      editor speaks through its own copy of `announce`, whichever page it is in.
    -->
    <p class="sr-only" role="status" aria-live="polite" aria-atomic="true">{{ politeMessage }}</p>
    <p class="sr-only" role="alert" aria-live="assertive" aria-atomic="true">{{ assertiveMessage }}</p>
  </div>
</template>
