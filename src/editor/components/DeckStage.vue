<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useTemplateRef, watch } from "vue"

import {
  DECK_HEIGHT,
  DECK_WIDTH,
  childrenAt,
  elementAt,
  insertAt as insertAtPath,
  isDeckTextBlock,
  isWithin,
  nodeAt,
  parentOf,
  parsePathKey,
  patchNodeStyle,
  pathKey,
  removeAt as removeAtPaths,
  rotationOf,
  samePath,
  setAttribute,
  updateAt,
  withRotation,
  type Deck,
  type DeckNode,
  type DeckPath,
} from "../../index"
import {
  angleTo,
  boundsOf,
  centreOf,
  intersects,
  joinLines,
  linesOf,
  measureBox,
  px,
  resizeBox,
  slideLines,
  snapPoint,
  snapRect,
  snapResize,
  type Box,
  type DeckAlignment,
  type Guide,
  type Point,
  type Rect,
  type SnapLines,
} from "../../dom"

import { t } from "../i18n"
import DeckSlideView from "./DeckSlideView"

/**
 * The slide being edited, and every way of taking hold of what is on it.
 *
 * The slide is drawn at its own 1920×1080 and scaled to the room it has; the
 * selection, its handles and the snapping guides are drawn over it at screen
 * size, so a handle is as easy to grab on a small panel as on a large one.
 * Everything the stage does to the slide it reports as a change to its tree
 * (`update`), which the editor applies and keeps in its history.
 *
 * Picking follows a **scope**: a click picks the element under it that sits
 * directly in the scope — the slide, to begin with — and a double click on a
 * container steps into it, so the next click picks inside. A double click on
 * text starts typing into it.
 *
 * An element in the flow that is moved or resized is pinned first
 * (`position:absolute`) at exactly the place layout had put it, which is what
 * a presentation program does with a placeholder taken hold of; its
 * neighbours close up behind it.
 */
const props = defineProps<{
  deck: Deck
  slideIndex: number
  selection: readonly DeckPath[]
  scope: DeckPath
  editingPath?: DeckPath
  /** Where the caret starts in text being typed into: where it was clicked, its start, or around all of it. */
  caretAt?: Point | "start" | "all"
  editable: boolean
  resolveAsset: (src: string) => string
}>()

const emit = defineEmits<{
  select: [paths: DeckPath[], scope: DeckPath]
  update: [change: (children: readonly DeckNode[]) => DeckNode[], key: string]
  seal: []
  edit: [path: DeckPath | undefined, caretAt?: Point]
  textChange: [nodes: DeckNode[]]
  textDone: []
  textKey: [event: KeyboardEvent, element: HTMLElement]
  /** A right click: where, and the deepest thing under it, if anything. */
  menu: [at: { x: number; y: number }, under: DeckPath | undefined]
}>()

defineOptions({ inheritAttrs: false })

const slide = computed(() => props.deck.slides[props.slideIndex])

// The overlay follows the selection, which can change without the slide
// drawing again.
watch(
  () => [props.selection, props.scope] as const,
  () => void nextTick(remeasure),
)

// ---------------------------------------------------------------------------
// Scale
// ---------------------------------------------------------------------------

const viewport = useTemplateRef<HTMLElement>("viewport")
const frame = useTemplateRef<HTMLElement>("frame")
const room = ref({ width: 0, height: 0 })
const PADDING = 24

const scale = computed(() => {
  const width = Math.max(room.value.width - PADDING * 2, 40)
  const height = Math.max(room.value.height - PADDING * 2, 40)

  return Math.min(width / DECK_WIDTH, height / DECK_HEIGHT)
})

const frameStyle = computed(() => {
  const width = DECK_WIDTH * scale.value
  const height = DECK_HEIGHT * scale.value

  return {
    width: `${width}px`,
    height: `${height}px`,
    left: `${Math.max((room.value.width - width) / 2, 0)}px`,
    top: `${Math.max((room.value.height - height) / 2, 0)}px`,
  }
})

let resizeObserver: ResizeObserver | undefined

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry !== undefined) {
      room.value = { width: entry.contentRect.width, height: entry.contentRect.height }
      remeasure()
    }
  })

  if (viewport.value !== null) {
    resizeObserver.observe(viewport.value)
  }

  void document.fonts?.ready.then(() => remeasure())
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()

  if (moveFrame !== undefined) {
    cancelAnimationFrame(moveFrame)
  }
})

// ---------------------------------------------------------------------------
// Measuring
// ---------------------------------------------------------------------------

function section() {
  return frame.value?.querySelector<HTMLElement>(".deck-slide") ?? undefined
}

function elementOf(path: DeckPath) {
  return section()?.querySelector<HTMLElement>(`[data-deck-path="${pathKey(path)}"]`) ?? undefined
}

function nodeOf(path: DeckPath) {
  return slide.value === undefined ? undefined : nodeAt(slide.value.children, path)
}

/** Whether a node is a connector placed by its two ends, which is held by its ends rather than a box. */
function connectorEnds(node: DeckNode | undefined): [Point, Point] | undefined {
  if (node?.type !== "element" || node.tag !== "x-connector") {
    return undefined
  }

  const values = ["x1", "y1", "x2", "y2"].map((name) => Number.parseFloat(node.attributes[name] ?? ""))

  if (
    values.some((value) => !Number.isFinite(value)) ||
    Object.values(node.attributes).some((value) => value.endsWith("%"))
  ) {
    return undefined
  }

  return [
    { x: values[0]!, y: values[1]! },
    { x: values[2]!, y: values[3]! },
  ]
}

/** Where a connector's container starts on the canvas: its ends are in the container's pixels. */
function connectorOrigin(path: DeckPath): Point {
  const parent = parentOf(path)

  if (parent.length === 0) {
    return { x: 0, y: 0 }
  }

  const element = elementOf(parent)
  const root = section()

  return element === undefined || root === undefined
    ? { x: 0, y: 0 }
    : measureBox(element, root.getBoundingClientRect(), scale.value, 0)
}

function measure(path: DeckPath): Box | undefined {
  const root = section()
  const node = nodeOf(path)
  const ends = connectorEnds(node)

  if (ends !== undefined) {
    const origin = connectorOrigin(path)
    const [a, b] = ends

    return {
      x: origin.x + Math.min(a.x, b.x),
      y: origin.y + Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
      rotation: 0,
    }
  }

  const element = elementOf(path)

  if (root === undefined || element === undefined || node === undefined || node.type === "text") {
    return undefined
  }

  return measureBox(element, root.getBoundingClientRect(), scale.value, rotationOf(node.style))
}

/** What is drawn over the slide, measured after each draw. */
const boxes = shallowRef<{ key: string; box: Box; ends?: [Point, Point] }[]>([])
const hover = shallowRef<Box>()
const scopeBox = shallowRef<Box>()
let hoverPath: DeckPath | undefined

function remeasure() {
  boxes.value = props.selection.flatMap((path) => {
    const box = measure(path)
    const ends = connectorEnds(nodeOf(path))
    const origin = ends === undefined ? undefined : connectorOrigin(path)

    return box === undefined
      ? []
      : [
          {
            key: pathKey(path),
            box,
            ...(ends === undefined || origin === undefined
              ? {}
              : {
                  ends: [
                    { x: origin.x + ends[0].x, y: origin.y + ends[0].y },
                    { x: origin.x + ends[1].x, y: origin.y + ends[1].y },
                  ] as [Point, Point],
                }),
          },
        ]
  })
  hover.value =
    hoverPath === undefined || props.selection.some((path) => samePath(path, hoverPath!))
      ? undefined
      : measure(hoverPath)
  scopeBox.value = props.scope.length === 0 ? undefined : measure(props.scope)
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------

/** The deepest element under the pointer, as a path. */
function deepestAt(target: EventTarget | null): DeckPath | undefined {
  const element = (target as Element | null)?.closest?.("[data-deck-path]")

  if (element === null || element === undefined || !section()?.contains(element)) {
    return undefined
  }

  const key = element.getAttribute("data-deck-path") ?? ""

  return key === "" ? undefined : parsePathKey(key)
}

/** What a click on `deepest` picks: the element holding it that sits directly in the scope, else the slide's own child. */
function pick(deepest: DeckPath): { path: DeckPath; scope: DeckPath } {
  if (props.scope.length > 0 && isWithin(deepest, props.scope) && deepest.length > props.scope.length) {
    return { path: deepest.slice(0, props.scope.length + 1), scope: props.scope }
  }

  return { path: deepest.slice(0, 1), scope: [] }
}

function canvasPoint(event: PointerEvent | MouseEvent): Point {
  const bounds = frame.value!.getBoundingClientRect()

  return { x: (event.clientX - bounds.left) / scale.value, y: (event.clientY - bounds.top) / scale.value }
}

// ---------------------------------------------------------------------------
// Taking hold
// ---------------------------------------------------------------------------

/** One selected element as it stood when a gesture began. */
type Held = {
  path: DeckPath
  box: Box
  left: number
  top: number
  width: number
  height: number
  pinned: boolean
  /** A block of text: it keeps its height to its words unless a handle sets one. */
  textual: boolean
  ends?: [Point, Point]
}

type Gesture =
  | {
      kind: "press"
      start: Point
      client: Point
      held: Held[]
      toggle?: DeckPath
      pinned: boolean
      lines?: SnapLines
    }
  | { kind: "resize"; start: Point; held: Held; handle: [number, number]; pinned: boolean; lines: SnapLines }
  | { kind: "rotate"; held: Held; centre: Point; from: number }
  | { kind: "end"; held: Held; which: 0 | 1; lines: SnapLines; origin: Point }
  | { kind: "marquee"; start: Point }

let gesture: Gesture | undefined
const guides = shallowRef<Guide[]>([])
const marquee = shallowRef<Rect>()

/** Past this many screen pixels a press is a drag. */
const DRAG_THRESHOLD = 3
/** How near, in screen pixels, a box snaps to a line. */
const SNAP_PX = 6

function hold(path: DeckPath): Held | undefined {
  const node = nodeOf(path)
  const element = elementOf(path)
  const box = measure(path)

  if (node === undefined || node.type === "text" || box === undefined) {
    return undefined
  }

  const ends = connectorEnds(node)
  const tag = node.type === "svg" ? "svg" : node.tag

  return {
    path,
    box,
    left: element?.offsetLeft ?? box.x,
    top: element?.offsetTop ?? box.y,
    width: element?.offsetWidth ?? box.w,
    height: element?.offsetHeight ?? box.h,
    pinned: ends !== undefined || node.style.position === "absolute",
    textual: tag !== "svg" && isDeckTextBlock(tag as never),
    ...(ends === undefined ? {} : { ends }),
  }
}

/** Every selected element in the flow pinned where it stands. Returns the change, to fold into the first move. */
function pinChange(held: readonly Held[]) {
  return (children: readonly DeckNode[]) =>
    held.reduce<DeckNode[]>(
      (nodes, item) =>
        item.pinned
          ? nodes
          : updateAt(nodes, item.path, (node) =>
              patchNodeStyle(node, {
                position: "absolute",
                left: px(item.left),
                top: px(item.top),
                width: px(item.width),
                ...(item.textual ? {} : { height: px(item.height) }),
                right: undefined,
                bottom: undefined,
                flex: undefined,
                "align-self": undefined,
                "justify-self": undefined,
                "grid-column": undefined,
                "grid-row": undefined,
              }),
            ),
      [...children],
    )
}

/** Pin the selection where it stands, as a step of its own — the inspector's "pin" toggle. */
function pinSelection() {
  const held = props.selection.flatMap((path) => hold(path) ?? [])

  if (held.some((item) => !item.pinned)) {
    emit("update", pinChange(held), "pin")
    emit("seal")
  }
}

/** The selection moved by `delta` canvas pixels: pinned first where it was in the flow. */
function moveChange(held: readonly Held[], delta: Point) {
  const pin = pinChange(held)

  return (children: readonly DeckNode[]) =>
    held.reduce<DeckNode[]>(
      (nodes, item) =>
        updateAt(nodes, item.path, (node) => {
          if (item.ends !== undefined) {
            return withEnds(node, item.ends, delta)
          }

          // An element held by its right or bottom edge is moved by its left and
          // top: the edge it was held by goes, and the size it was drawn at is
          // written down, or moving it would stretch it instead.
          const style = node.type === "element" ? node.style : {}

          return patchNodeStyle(node, {
            left: px(item.left + delta.x),
            top: px(item.top + delta.y),
            ...(style.right === undefined
              ? {}
              : { right: undefined, ...(style.width === undefined ? { width: px(item.width) } : {}) }),
            ...(style.bottom === undefined
              ? {}
              : {
                  bottom: undefined,
                  ...(style.height === undefined && !item.textual ? { height: px(item.height) } : {}),
                }),
          })
        }),
      pin(children),
    )
}

/** Move the selection by arrow keys: the same move a drag makes, without snapping. */
function nudge(dx: number, dy: number) {
  const held = props.selection.flatMap((path) => hold(path) ?? [])

  if (held.length > 0) {
    emit("update", moveChange(held, { x: dx, y: dy }), "nudge")
  }
}

/** A connector's ends written as `ends` shifted by `delta`, in its container's pixels. */
function withEnds(node: DeckNode, ends: [Point, Point], delta: Point): DeckNode {
  const values = [ends[0].x + delta.x, ends[0].y + delta.y, ends[1].x + delta.x, ends[1].y + delta.y]

  return (["x1", "y1", "x2", "y2"] as const).reduce(
    (next, name, index) => setAttribute(next, name, String(Math.round(values[index]!))),
    node,
  )
}

/** Each held element moved by its own delta, as one change: what aligning and distributing are. */
function moveEachChange(moves: readonly { held: Held; delta: Point }[]) {
  const pin = pinChange(moves.map((move) => move.held))

  return (children: readonly DeckNode[]) =>
    moves.reduce<DeckNode[]>(
      (nodes, { held, delta }) => moveChange([{ ...held, pinned: true }], delta)(nodes),
      pin(children),
    )
}

/**
 * Line the selection up along one edge or centre: several elements against
 * the box around them, one element against the slide (or the container it is
 * in).
 */
function align(how: DeckAlignment) {
  const held = props.selection.flatMap((path) => hold(path) ?? [])

  if (held.length === 0) {
    return
  }

  const frameBox: Rect =
    held.length > 1
      ? boundsOf(held.map((item) => item.box))
      : props.scope.length > 0 && scopeBox.value !== undefined
        ? scopeBox.value
        : { x: 0, y: 0, w: DECK_WIDTH, h: DECK_HEIGHT }
  const moves = held.map((item) => {
    const { box } = item
    const delta = {
      left: { x: frameBox.x - box.x, y: 0 },
      centre: { x: frameBox.x + frameBox.w / 2 - (box.x + box.w / 2), y: 0 },
      right: { x: frameBox.x + frameBox.w - (box.x + box.w), y: 0 },
      top: { x: 0, y: frameBox.y - box.y },
      middle: { x: 0, y: frameBox.y + frameBox.h / 2 - (box.y + box.h / 2) },
      bottom: { x: 0, y: frameBox.y + frameBox.h - (box.y + box.h) },
    }[how]

    return { held: item, delta }
  })

  emit("update", moveEachChange(moves), "align")
  emit("seal")
}

/** Space three or more elements evenly between the outermost two, across or down. */
function distribute(axis: "x" | "y") {
  const held = props.selection.flatMap((path) => hold(path) ?? [])

  if (held.length < 3) {
    return
  }

  const along = (item: Held) => (axis === "x" ? item.box.x : item.box.y)
  const size = (item: Held) => (axis === "x" ? item.box.w : item.box.h)
  const ordered = [...held].sort((a, b) => along(a) - along(b))
  const first = ordered[0]!
  const last = ordered.at(-1)!
  const span = along(last) + size(last) - along(first)
  const gap = (span - ordered.reduce((sum, item) => sum + size(item), 0)) / (ordered.length - 1)
  let cursor = along(first)
  const moves = ordered.map((item) => {
    const delta = cursor - along(item)

    cursor += size(item) + gap
    return { held: item, delta: axis === "x" ? { x: delta, y: 0 } : { x: 0, y: delta } }
  })

  emit("update", moveEachChange(moves), "distribute")
  emit("seal")
}

/**
 * Wrap the selected siblings in a pinned `div` the size of the box around
 * them, each placed inside it where it stood — so the group moves, sizes and
 * copies as one.
 */
function group(): DeckPath | undefined {
  const held = props.selection.flatMap((path) => hold(path) ?? [])
  const parent = held[0] === undefined ? undefined : parentOf(held[0].path)

  if (
    held.length < 2 ||
    parent === undefined ||
    !held.every((item) => samePath(parentOf(item.path), parent))
  ) {
    return undefined
  }

  const bounds = boundsOf(held.map((item) => item.box))
  // Where the container's own coordinates start, read off one element whose
  // place in it is known: its box less its offset.
  const origin = { x: held[0]!.box.x - held[0]!.left, y: held[0]!.box.y - held[0]!.top }
  const groupLeft = bounds.x - origin.x
  const groupTop = bounds.y - origin.y
  const ordered = [...held].sort((a, b) => a.path.at(-1)! - b.path.at(-1)!)
  const at = ordered[0]!.path.at(-1)!

  emit(
    "update",
    (children) => {
      const pinned = pinChange(held)(children)
      const members = ordered.map((item) => {
        const node = nodeAt(pinned, item.path)!

        return item.ends !== undefined
          ? withEnds(node, item.ends, { x: -groupLeft, y: -groupTop })
          : patchNodeStyle(node, { left: px(item.left - groupLeft), top: px(item.top - groupTop) })
      })
      const wrapper: DeckNode = {
        type: "element",
        tag: "div",
        attributes: {},
        style: {
          position: "absolute",
          left: px(groupLeft),
          top: px(groupTop),
          width: px(bounds.w),
          height: px(bounds.h),
        },
        children: members,
      }
      const without = removeAtPaths(
        pinned,
        ordered.map((item) => item.path),
      )

      return insertAtPath(without, parent, at, [wrapper])
    },
    "group",
  )
  emit("seal")

  return [...parent, at]
}

/** Take a group apart: each member pinned where it stands, in the group's place among its siblings. */
function ungroup(path: DeckPath): DeckPath[] | undefined {
  const node = slide.value === undefined ? undefined : elementAt(slide.value.children, path)
  const outer = hold(path)

  if (node === undefined || node.tag !== "div" || outer === undefined || node.children.length === 0) {
    return undefined
  }

  const members = node.children.flatMap((child, index) =>
    child.type === "text" ? [] : (hold([...path, index]) ?? []),
  )
  const origin = { x: outer.box.x - outer.left, y: outer.box.y - outer.top }

  emit(
    "update",
    (children) => {
      const lifted = members.map((item) => {
        const member = nodeAt(children, item.path)!

        if (item.ends !== undefined) {
          return withEnds(member, item.ends, { x: outer.box.x - origin.x, y: outer.box.y - origin.y })
        }

        return patchNodeStyle(member, {
          position: "absolute",
          left: px(item.box.x - origin.x),
          top: px(item.box.y - origin.y),
          width: px(item.width),
          ...(item.textual ? {} : { height: px(item.height) }),
          right: undefined,
          bottom: undefined,
        })
      })
      const without = removeAtPaths(children, [path])

      return insertAtPath(without, parentOf(path), path.at(-1)!, lifted)
    },
    "ungroup",
  )
  emit("seal")

  return members.map((_, index) => [...parentOf(path), path.at(-1)! + index])
}

/** The lines a moving selection snaps to: the slide's, and every other element in its scope. */
function snapLinesFor(exclude: readonly DeckPath[]): SnapLines {
  const siblings = slide.value === undefined ? [] : childrenAt(slide.value.children, props.scope)
  const others = siblings.flatMap((node, index) => {
    const path = [...props.scope, index]

    if (node.type === "text" || exclude.some((excluded) => isWithin(path, excluded))) {
      return []
    }

    // A connector drawn over the whole slide has no edges worth meeting.
    if (connectorEnds(node) !== undefined) {
      return []
    }

    const box = measure(path)

    return box === undefined ? [] : [box]
  })

  return joinLines(
    props.scope.length === 0 ? slideLines() : linesOf(scopeBox.value === undefined ? [] : [scopeBox.value]),
    linesOf(others),
  )
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0 || slide.value === undefined) {
    return
  }

  const target = event.target as HTMLElement

  // Typing: a press inside the text goes to the caret.
  if (props.editingPath !== undefined && elementOf(props.editingPath)?.contains(target)) {
    return
  }

  if (props.editingPath !== undefined) {
    emit("textDone")
  }

  const handle = target.closest<HTMLElement>("[data-handle]")?.dataset.handle

  if (handle !== undefined && props.editable) {
    startHandle(event, handle)
    return
  }

  const deepest = deepestAt(target)
  const start = canvasPoint(event)

  frame.value?.setPointerCapture(event.pointerId)

  if (deepest === undefined) {
    gesture = { kind: "marquee", start }

    if (!event.shiftKey) {
      emit("select", [], props.scope)
    }

    return
  }

  const picked = pick(deepest)
  const already = props.selection.some((path) => samePath(path, picked.path))
  const sameScope = samePath(picked.scope, props.scope)
  let selection: DeckPath[]

  if (event.shiftKey && sameScope) {
    selection = already ? [...props.selection] : [...props.selection, picked.path]
  } else {
    selection = already ? [...props.selection] : [picked.path]
  }

  if (!already || !sameScope) {
    emit("select", selection, picked.scope)
  }

  if (!props.editable) {
    return
  }

  gesture = {
    kind: "press",
    start,
    client: { x: event.clientX, y: event.clientY },
    held: selection.flatMap((path) => hold(path) ?? []),
    ...(event.shiftKey && already ? { toggle: picked.path } : {}),
    pinned: false,
  }
}

function startHandle(event: PointerEvent, handle: string) {
  const [first] = props.selection
  const held = first === undefined ? undefined : hold(first)

  if (held === undefined) {
    return
  }

  frame.value?.setPointerCapture(event.pointerId)
  event.stopPropagation()

  if (handle === "rotate") {
    const centre = centreOf(held.box)

    gesture = { kind: "rotate", held, centre, from: angleTo(centre, canvasPoint(event)) - held.box.rotation }
    return
  }

  if (handle === "end-0" || handle === "end-1") {
    gesture = {
      kind: "end",
      held,
      which: handle === "end-0" ? 0 : 1,
      lines: snapLinesFor([held.path]),
      origin: connectorOrigin(held.path),
    }
    return
  }

  const [hx, hy] = handle.split(",").map(Number) as [number, number]

  gesture = {
    kind: "resize",
    start: canvasPoint(event),
    held,
    handle: [hx, hy],
    pinned: held.pinned,
    lines: snapLinesFor([held.path]),
  }
}

// Every move is measured from where the gesture started, so only the latest
// one in a frame matters: a pointer reporting faster than the screen draws
// would otherwise commit, render and measure the deck once per report.
let pendingMove: PointerEvent | undefined
let moveFrame: number | undefined

function onPointerMove(event: PointerEvent) {
  pendingMove = event
  moveFrame ??= requestAnimationFrame(flushPointerMove)
}

function flushPointerMove() {
  const event = pendingMove

  if (moveFrame !== undefined) {
    cancelAnimationFrame(moveFrame)
  }

  moveFrame = undefined
  pendingMove = undefined

  if (event !== undefined) {
    applyPointerMove(event)
  }
}

function applyPointerMove(event: PointerEvent) {
  if (gesture === undefined) {
    updateHover(event)
    return
  }

  const point = canvasPoint(event)
  const threshold = SNAP_PX / scale.value
  const snapping = !event.altKey

  switch (gesture.kind) {
    case "press": {
      const moved =
        Math.hypot(event.clientX - gesture.client.x, event.clientY - gesture.client.y) > DRAG_THRESHOLD

      if (!moved && !gesture.pinned) {
        return
      }

      if (gesture.held.length === 0) {
        return
      }

      gesture.pinned = true
      gesture.lines ??= snapLinesFor(gesture.held.map((item) => item.path))

      let delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y }

      // Shift holds a drag to the axis it moved most along.
      if (event.shiftKey) {
        delta = Math.abs(delta.x) > Math.abs(delta.y) ? { x: delta.x, y: 0 } : { x: 0, y: delta.y }
      }

      const bounds = boundsOf(gesture.held.map((item) => item.box))
      const moved2 = { ...bounds, x: bounds.x + delta.x, y: bounds.y + delta.y }
      const snapped = snapping ? snapRect(moved2, gesture.lines, threshold) : { dx: 0, dy: 0, guides: [] }

      guides.value = snapped.guides
      emit("update", moveChange(gesture.held, { x: delta.x + snapped.dx, y: delta.y + snapped.dy }), "move")
      return
    }

    case "resize": {
      const { held, handle } = gesture
      const delta = { x: point.x - gesture.start.x, y: point.y - gesture.start.y }
      const node = nodeOf(held.path)
      const keepRatio =
        event.shiftKey !== (node?.type === "element" && (node.tag === "img" || node.tag === "x-icon"))
      const resized = resizeBox(held.box, handle, delta, { keepRatio, fromCentre: event.altKey })
      const snapped =
        snapping && !keepRatio
          ? snapResize(resized, handle, gesture.lines, threshold)
          : { box: resized, guides: [] }
      const box = snapped.box
      const pin = pinChange([held])
      const setsHeight = !held.textual || handle[1] !== 0 || (held.pinned && nodeHeightSet(held.path))

      guides.value = snapped.guides
      emit(
        "update",
        (children) =>
          updateAt(pin(children), held.path, (current) =>
            patchNodeStyle(current, {
              left: px(held.left + (box.x - held.box.x)),
              top: px(held.top + (box.y - held.box.y)),
              width: px(box.w),
              ...(setsHeight ? { height: px(box.h) } : {}),
            }),
          ),
        "resize",
      )
      return
    }

    case "rotate": {
      const { held } = gesture
      let angle = angleTo(gesture.centre, point) - gesture.from

      angle = ((angle % 360) + 360) % 360

      if (event.shiftKey) {
        angle = Math.round(angle / 15) * 15
      } else if (snapping) {
        // A turn near square snaps square.
        const square = Math.round(angle / 90) * 90

        if (Math.abs(angle - square) < 3) {
          angle = square
        }
      }

      const signed = angle > 180 ? angle - 360 : angle

      emit(
        "update",
        (children) =>
          updateAt([...children], held.path, (node) =>
            node.type === "text"
              ? node
              : patchNodeStyle(node, { transform: withRotation(node.style.transform, signed) }),
          ),
        "rotate",
      )
      return
    }

    case "end": {
      const { held, which, origin } = gesture
      const snapped = snapping ? snapPoint(point, gesture.lines, threshold) : { point, guides: [] }
      const local = { x: Math.round(snapped.point.x - origin.x), y: Math.round(snapped.point.y - origin.y) }

      guides.value = snapped.guides
      emit(
        "update",
        (children) =>
          updateAt([...children], held.path, (node) =>
            setAttribute(
              setAttribute(node, which === 0 ? "x1" : "x2", String(local.x)),
              which === 0 ? "y1" : "y2",
              String(local.y),
            ),
          ),
        "end",
      )
      return
    }

    case "marquee": {
      const { start } = gesture

      marquee.value = {
        x: Math.min(start.x, point.x),
        y: Math.min(start.y, point.y),
        w: Math.abs(point.x - start.x),
        h: Math.abs(point.y - start.y),
      }
      return
    }
  }
}

function nodeHeightSet(path: DeckPath) {
  const node = nodeOf(path)

  return node !== undefined && node.type !== "text" && node.style.height !== undefined
}

function onPointerUp(event: PointerEvent) {
  flushPointerMove()

  const ended = gesture

  gesture = undefined
  guides.value = []

  if (frame.value?.hasPointerCapture(event.pointerId)) {
    frame.value.releasePointerCapture(event.pointerId)
  }

  if (ended === undefined) {
    return
  }

  if (ended.kind === "marquee") {
    const area = marquee.value

    marquee.value = undefined

    if (area !== undefined && area.w > 2 && area.h > 2 && slide.value !== undefined) {
      const inside = childrenAt(slide.value.children, props.scope).flatMap((node, index) => {
        const path = [...props.scope, index]
        const box = node.type === "text" ? undefined : measure(path)

        return box !== undefined && intersects(box, area) ? [path] : []
      })

      emit(
        "select",
        event.shiftKey
          ? [
              ...props.selection,
              ...inside.filter((path) => !props.selection.some((held) => samePath(held, path))),
            ]
          : inside,
        props.scope,
      )
    }

    return
  }

  if (ended.kind === "press" && !ended.pinned && ended.toggle !== undefined) {
    emit(
      "select",
      props.selection.filter((path) => !samePath(path, ended.toggle!)),
      props.scope,
    )
  }

  emit("seal")
}

/** A double click steps into a container, or starts typing into text. */
function onDoubleClick(event: MouseEvent) {
  if (!props.editable || slide.value === undefined) {
    return
  }

  // From the point, not the target: the press before it captured the
  // pointer, which makes the frame the target of what follows.
  const deepest = deepestAt(document.elementFromPoint(event.clientX, event.clientY))

  if (deepest === undefined) {
    return
  }

  // The innermost block of text under the pointer, if there is one inside what was picked.
  const picked = pick(deepest)
  let textPath: DeckPath | undefined

  for (let depth = deepest.length; depth >= picked.path.length; depth -= 1) {
    const candidate = deepest.slice(0, depth)
    const element = elementAt(slide.value.children, candidate)

    if (element !== undefined && isDeckTextBlock(element.tag)) {
      textPath = candidate
      break
    }
  }

  const pickedNode = elementAt(slide.value.children, picked.path)

  // A container is stepped into; text directly picked, or a list or table
  // whose item is under the pointer, is typed into.
  if (pickedNode !== undefined && pickedNode.tag === "div" && textPath === undefined) {
    const inner = deepest.length > picked.path.length ? deepest.slice(0, picked.path.length + 1) : undefined

    emit("select", inner === undefined ? [] : [inner], picked.path)
    return
  }

  if (
    pickedNode !== undefined &&
    pickedNode.tag === "div" &&
    textPath !== undefined &&
    textPath.length > picked.path.length + 1
  ) {
    // Text nested deeper inside a container: step in one level first.
    emit("select", [deepest.slice(0, picked.path.length + 1)], picked.path)
    return
  }

  if (textPath !== undefined) {
    emit("select", [textPath], parentOf(textPath))
    emit("edit", textPath, { x: event.clientX, y: event.clientY })
  }
}

function updateHover(event: PointerEvent) {
  if (!props.editable) {
    return
  }

  const deepest = deepestAt(event.target)
  const next = deepest === undefined ? undefined : pick(deepest).path

  if (
    (next === undefined && hoverPath === undefined) ||
    (next !== undefined && hoverPath !== undefined && samePath(next, hoverPath))
  ) {
    return
  }

  hoverPath = next
  hover.value =
    next === undefined || props.selection.some((path) => samePath(path, next)) ? undefined : measure(next)
}

function onPointerLeave() {
  if (gesture === undefined) {
    pendingMove = undefined
    hoverPath = undefined
    hover.value = undefined
  }
}

// ---------------------------------------------------------------------------
// Drawing the overlay
// ---------------------------------------------------------------------------

const HANDLES: [number, number][] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
]

const CURSORS: Record<string, string> = {
  "-1,-1": "nwse-resize",
  "1,1": "nwse-resize",
  "1,-1": "nesw-resize",
  "-1,1": "nesw-resize",
  "0,-1": "ns-resize",
  "0,1": "ns-resize",
  "-1,0": "ew-resize",
  "1,0": "ew-resize",
}

function boxStyle(box: Box) {
  const s = scale.value

  return {
    left: `${box.x * s}px`,
    top: `${box.y * s}px`,
    width: `${box.w * s}px`,
    height: `${box.h * s}px`,
    transform: box.rotation === 0 ? undefined : `rotate(${box.rotation}deg)`,
  }
}

function handleStyle([hx, hy]: [number, number]) {
  return {
    left: `${((hx + 1) / 2) * 100}%`,
    top: `${((hy + 1) / 2) * 100}%`,
    cursor: CURSORS[`${hx},${hy}`],
  }
}

const single = computed(() => (boxes.value.length === 1 ? boxes.value[0] : undefined))

/** A box too small to hold eight handles keeps its corners only. */
const handles = computed(() => {
  const box = single.value?.box

  if (box === undefined) {
    return []
  }

  const small = box.w * scale.value < 36 || box.h * scale.value < 36

  return small ? HANDLES.filter(([hx, hy]) => hx !== 0 && hy !== 0) : HANDLES
})

function pointStyle(point: Point) {
  return { left: `${point.x * scale.value}px`, top: `${point.y * scale.value}px` }
}

function guideStyle(guide: Guide) {
  return guide.axis === "x"
    ? { left: `${guide.at * scale.value}px`, top: "0", width: "1px", height: "100%" }
    : { top: `${guide.at * scale.value}px`, left: "0", height: "1px", width: "100%" }
}

function onRendered() {
  remeasure()
}

/**
 * A right click selects what it is on, as a press would, and asks for the
 * menu. Inside the text being typed into it is left to the browser, whose
 * menu is the one that spells and copies.
 */
function onContextMenu(event: MouseEvent) {
  if (slide.value === undefined) {
    return
  }

  const target = event.target as HTMLElement

  if (props.editingPath !== undefined && elementOf(props.editingPath)?.contains(target)) {
    return
  }

  event.preventDefault()

  if (props.editingPath !== undefined) {
    emit("textDone")
  }

  const deepest = deepestAt(target)

  if (deepest === undefined) {
    emit("select", [], props.scope)
  } else {
    const picked = pick(deepest)

    if (!props.selection.some((path) => samePath(path, picked.path) || isWithin(path, picked.path))) {
      emit("select", [picked.path], picked.scope)
    }
  }

  emit("menu", { x: event.clientX, y: event.clientY }, deepest)
}

/** Where a point on screen falls on the slide, in the slide's own pixels. */
function slidePoint(clientX: number, clientY: number): Point | undefined {
  const rect = frame.value?.getBoundingClientRect()

  if (rect === undefined || rect.width === 0) {
    return undefined
  }

  const ratio = rect.width / DECK_WIDTH

  return { x: (clientX - rect.left) / ratio, y: (clientY - rect.top) / ratio }
}

defineExpose({
  measure,
  remeasure,
  nudge,
  pinSelection,
  elementOf,
  align,
  distribute,
  group,
  ungroup,
  slidePoint,
})
</script>

<template>
  <div
    ref="viewport"
    class="relative h-full w-full overflow-hidden"
    v-bind="$attrs"
    @pointerdown.self="emit('select', [], [])"
    @contextmenu.self.prevent="
      (event: MouseEvent) => {
        emit('select', [], [])
        emit('menu', { x: event.clientX, y: event.clientY }, undefined)
      }
    "
  >
    <div
      v-if="slide"
      ref="frame"
      class="deck-stage absolute touch-none select-none"
      :class="{ 'cursor-default': editable }"
      :style="frameStyle"
      :aria-label="t('deck.stage')"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerLeave"
      @dblclick="onDoubleClick"
      @contextmenu="onContextMenu"
      @load.capture="remeasure"
    >
      <div
        class="absolute left-0 top-0 origin-top-left shadow-md ring-1 ring-slides-line"
        :style="{ transform: `scale(${scale})`, width: '1920px', height: '1080px' }"
      >
        <DeckSlideView
          :slide="slide"
          :deck-style="deck.style"
          :resolve-asset="resolveAsset"
          :editing-path="editingPath"
          :caret-at="caretAt"
          interactive
          @rendered="onRendered"
          @text-change="(nodes) => emit('textChange', nodes)"
          @text-done="emit('textDone')"
          @text-key="(event, element) => emit('textKey', event, element)"
        />
      </div>

      <!-- What is drawn over the slide, at screen size. -->
      <div class="pointer-events-none absolute inset-0">
        <div
          v-if="scopeBox"
          class="absolute outline-1 outline-dashed outline-slides-selection/70"
          :style="boxStyle(scopeBox)"
        />
        <div
          v-if="hover"
          class="absolute outline-1 outline-solid outline-slides-selection/60"
          :style="boxStyle(hover)"
        />

        <template v-for="item in boxes" :key="item.key">
          <template v-if="item.ends">
            <svg class="absolute inset-0 h-full w-full overflow-visible">
              <line
                :x1="item.ends[0].x * scale"
                :y1="item.ends[0].y * scale"
                :x2="item.ends[1].x * scale"
                :y2="item.ends[1].y * scale"
                class="stroke-slides-selection"
                stroke-width="1.5"
                stroke-dasharray="4 3"
              />
            </svg>
          </template>
          <div
            v-else
            class="absolute outline-1.5 outline-solid outline-slides-selection"
            :style="boxStyle(item.box)"
          >
            <template v-if="single === item && editable && !editingPath">
              <span
                v-for="handle in handles"
                :key="handle.join()"
                :data-handle="handle.join()"
                class="pointer-events-auto absolute h-2.5 w-2.5 rounded-sm bg-white ring-1.5 ring-slides-selection -translate-x-1/2 -translate-y-1/2"
                :style="handleStyle(handle)"
              />
              <span
                data-handle="rotate"
                class="pointer-events-auto absolute left-1/2 top-0 h-3 w-3 cursor-grab rounded-full bg-white ring-1.5 ring-slides-selection -translate-x-1/2 -translate-y-[22px]"
                :title="t('deck.rotate')"
              />
            </template>
          </div>
        </template>

        <template v-if="single?.ends && editable">
          <span
            v-for="(point, which) in single.ends"
            :key="which"
            :data-handle="`end-${which}`"
            class="pointer-events-auto absolute h-3 w-3 cursor-crosshair rounded-full bg-white ring-1.5 ring-slides-selection -translate-x-1/2 -translate-y-1/2"
            :style="pointStyle(point)"
          />
        </template>

        <div
          v-for="(guide, index) in guides"
          :key="index"
          class="absolute bg-pink-500"
          :style="guideStyle(guide)"
        />
        <div
          v-if="marquee"
          class="absolute border border-slides-selection bg-slides-selection/10"
          :style="boxStyle({ ...marquee, rotation: 0 })"
        />
      </div>
    </div>
  </div>
</template>
