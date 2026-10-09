import { defineComponent, h, onMounted, onUpdated, ref, type PropType, type VNode } from "vue"

import {
  deckThemeStyle,
  findDeckTheme,
  nodeAt,
  pathKey,
  renderDeckNodes,
  type DeckNode,
  type DeckPath,
  type DeckRenderNode,
  type DeckSlide,
  type DeckStyle,
} from "../../index"
import { buildInlineDom, installDeckSheet, readInlineDom } from "../../dom"

import { createCompositionGuard } from "../support/ime"
import { useDeckThemes } from "../themes"

/**
 * One slide, drawn: the stage, the thumbnails, the presenter and the export
 * all draw a slide with this, from the same render description the version's
 * page is written from (`renderDeckNodes`).
 *
 * Built as vnodes, never as `innerHTML` of the model's text: this is the app's
 * own document, not a sandbox. The only markup set as HTML is what the
 * renderer drew itself — a shape's polygon, an icon's paths — and a drawing
 * the model wrote reaches here as an `<img>` of itself, which cannot run
 * anything.
 *
 * With `interactive`, every element says where in the tree it came from
 * (`data-deck-path`), which is how the stage knows what was clicked; and the
 * element at `editingPath`, if any, is drawn as `DeckTextEditable`, whose
 * children the browser owns while the reader types.
 */
export default defineComponent({
  name: "DeckSlideView",
  props: {
    slide: { type: Object as PropType<DeckSlide>, required: true },
    deckStyle: { type: Object as PropType<DeckStyle>, default: () => ({}) },
    /** The theme the deck names; its colours are what `var(--<role>)` reads. */
    theme: { type: String, default: undefined },
    resolveAsset: { type: Function as PropType<(src: string) => string>, default: undefined },
    interactive: { type: Boolean, default: false },
    editingPath: { type: Array as PropType<DeckPath>, default: undefined },
    /** Where the caret starts: where the reader clicked, the text's start, or around all of it. */
    caretAt: { type: [Object, String] as PropType<CaretAt>, default: undefined },
  },
  emits: {
    rendered: () => true,
    textChange: (_nodes: DeckNode[]) => true,
    textDone: () => true,
    textKey: (_event: KeyboardEvent, _element: HTMLElement) => true,
  },
  setup(props, { emit }) {
    installDeckSheet()

    const themes = useDeckThemes()

    onMounted(() => emit("rendered"))
    onUpdated(() => emit("rendered"))

    return () => {
      const rendered = renderDeckNodes(props.slide.children, {
        svgAsImage: true,
        paths: props.interactive,
        hitAreas: props.interactive,
        ...(props.resolveAsset === undefined ? {} : { resolveAsset: props.resolveAsset }),
      })
      const editingKey = props.editingPath === undefined ? undefined : pathKey(props.editingPath)
      const children = toVNodes(rendered, {
        editingKey,
        slide: props.slide,
        caretAt: props.caretAt,
        onChange: (nodes) => emit("textChange", nodes),
        onDone: () => emit("textDone"),
        onKey: (event, element) => emit("textKey", event, element),
      })

      return h(
        "div",
        {
          class: "deck-root",
          style: {
            ...deckThemeStyle(findDeckTheme(props.theme, themes())),
            ...props.deckStyle,
            width: "1920px",
            height: "1080px",
          },
        },
        [
          h(
            "section",
            {
              class: "deck-slide",
              style: props.slide.style,
              ...(props.interactive ? { "data-deck-path": "" } : {}),
            },
            children,
          ),
        ],
      )
    }
  },
})

/** Where the caret starts in text about to be typed into; the end of it when unsaid. */
export type CaretAt = { x: number; y: number } | "start" | "all"

type VNodeContext = {
  editingKey: string | undefined
  slide: DeckSlide
  caretAt: CaretAt | undefined
  onChange: (nodes: DeckNode[]) => void
  onDone: () => void
  onKey: (event: KeyboardEvent, element: HTMLElement) => void
}

function toVNodes(nodes: readonly DeckRenderNode[], context: VNodeContext): (VNode | string)[] {
  return nodes.map((node) => {
    if (node.kind === "text") {
      return node.text
    }

    const key = node.path === undefined ? undefined : pathKey(node.path)
    const marks = key === undefined ? {} : { "data-deck-path": key, key }

    if (node.kind === "markup") {
      return h("div", {
        ...node.attributes,
        ...marks,
        class: node.class,
        style: node.style,
        innerHTML: node.markup,
      })
    }

    if (key !== undefined && key === context.editingKey && node.path !== undefined) {
      const source = nodeAt(context.slide.children, node.path)

      return h(DeckTextEditable, {
        key: `editing:${key}`,
        tag: node.tag,
        style: node.style,
        attributes: node.attributes,
        pathKey: key,
        initial: source?.type === "element" ? source.children : [],
        caretAt: context.caretAt,
        onChange: context.onChange,
        onDone: context.onDone,
        onKey: context.onKey,
      })
    }

    return h(
      node.tag,
      { ...node.attributes, ...marks, class: node.class, style: node.style },
      toVNodes(node.children, context),
    )
  })
}

/**
 * A block of text being typed into. Its children are built once, from the
 * tree, when it mounts, and from then on they are the browser's: Vue patches
 * its style and nothing inside it, so the caret stays where the reader put it
 * while each input is read back into the tree.
 */
const DeckTextEditable = defineComponent({
  name: "DeckTextEditable",
  props: {
    tag: { type: String, required: true },
    style: { type: Object as PropType<Record<string, string>>, required: true },
    attributes: { type: Object as PropType<Record<string, string>>, required: true },
    pathKey: { type: String, required: true },
    initial: { type: Array as PropType<readonly DeckNode[]>, required: true },
    caretAt: { type: [Object, String] as PropType<CaretAt>, default: undefined },
  },
  emits: {
    change: (_nodes: DeckNode[]) => true,
    done: () => true,
    key: (_event: KeyboardEvent, _element: HTMLElement) => true,
  },
  setup(props, { emit }) {
    const root = ref<HTMLElement>()
    // A key the input method is still holding — the Enter that commits a
    // word — is not the editor's to answer.
    const composition = createCompositionGuard()

    onMounted(() => {
      const element = root.value

      if (element === undefined) {
        return
      }

      element.append(buildInlineDom(props.initial, element.ownerDocument))
      element.focus({ preventScroll: true })
      placeCaret(element, props.caretAt)
    })

    const read = () => {
      if (root.value !== undefined) {
        emit("change", readInlineDom(root.value))
      }
    }

    return () =>
      h(props.tag, {
        ref: root,
        ...props.attributes,
        "data-deck-path": props.pathKey,
        class: "deck-editing-text",
        style: props.style,
        contenteditable: "true",
        spellcheck: "true",
        onInput: read,
        onBlur: () => emit("done"),
        onCompositionstart: () => composition.start(),
        onCompositionend: (event: CompositionEvent) => composition.end(event),
        onKeydown: (event: KeyboardEvent) => {
          if (root.value !== undefined && !composition.composing(event)) {
            emit("key", event, root.value)
          }
        },
        onPaste: (event: ClipboardEvent) => {
          // Pasted as the words alone: a page's markup is not the subset's,
          // and pasting styled text would only be read back as less of it.
          event.preventDefault()
          document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? "")
        },
      })
  },
})

/** The caret where the reader clicked, at the start, around everything, or at the end of the text. */
function placeCaret(element: HTMLElement, at: CaretAt | undefined) {
  const selection = element.ownerDocument.getSelection()

  if (selection === null) {
    return
  }

  const range = element.ownerDocument.createRange()
  const fromPoint =
    at === undefined || typeof at === "string" ? undefined : caretRange(element.ownerDocument, at)

  if (fromPoint !== undefined && element.contains(fromPoint.startContainer)) {
    range.setStart(fromPoint.startContainer, fromPoint.startOffset)
    range.collapse(true)
  } else {
    range.selectNodeContents(element)

    if (at !== "all") {
      range.collapse(at === "start")
    }
  }

  selection.removeAllRanges()
  selection.addRange(range)
}

function caretRange(document: Document, at: { x: number; y: number }): Range | undefined {
  const withPosition = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }

  if (withPosition.caretPositionFromPoint !== undefined) {
    const position = withPosition.caretPositionFromPoint(at.x, at.y)

    if (position === null) {
      return undefined
    }

    const range = document.createRange()

    range.setStart(position.offsetNode, position.offset)
    return range
  }

  return document.caretRangeFromPoint?.(at.x, at.y) ?? undefined
}
