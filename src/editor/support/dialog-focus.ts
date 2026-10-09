import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  type InjectionKey,
  type Ref,
} from "vue"

/**
 * A modal that actually holds the focus.
 *
 * `aria-modal` tells a screen reader that nothing outside the box exists; it
 * does not tell Tab, which walks the page behind it all the same — so a
 * keyboard reader Tabs out of the dialog and lands on a sidebar they were just
 * told is not there. This is what makes the attribute true:
 *
 * - the focus starts inside, and Tab cycles inside;
 * - everything outside the box is `inert` while it is open, so a click, a
 *   screen reader's virtual cursor and a focus that went astray all find
 *   nothing there — the Tab trap alone holds only against Tab;
 * - Escape closes it, heard on the dialog rather than on `window`, so a menu
 *   open inside it takes the first Escape and the dialog the second, and a
 *   stack of two overlays closes one at a time;
 * - the focus goes back to whatever opened it when it closes — or, when that
 *   is gone (the settings button that opened the store no longer exists once
 *   the store is up), to what the caller names, or to the page's main region.
 *
 * Shared rather than written per dialog because it is behaviour nobody looks at
 * twice and everybody gets subtly wrong — and because two copies drift,
 * leaving one dialog's keyboard reader with a trap the other's has not got.
 */
export function useDialogFocus(options: {
  /** The box itself, which takes the focus so Tab starts inside it. */
  dialog: Ref<HTMLElement | null>
  /** What to focus on open instead; the box itself when it is not there. */
  initial?: Ref<HTMLElement | null>
  /** Escape. Left out, Escape does nothing here and the caller decides. */
  onEscape?: () => void
  /** Where the focus goes on close when the control that opened it has gone. */
  returnFocus?: () => HTMLElement | null | undefined
}) {
  const openedFrom = typeof document === "undefined" ? null : (document.activeElement as HTMLElement | null)
  let released: (() => void) | undefined

  // A menu inside the dialog is teleported into it rather than to <body>: a
  // panel outside the box would be inert with everything else out there.
  provide(FLOATING_HOST, options.dialog)

  onMounted(() => {
    openModals.value++
    void nextTick(() => {
      const dialog = options.dialog.value

      if (dialog !== null) {
        released = inertOutside(dialog)
      }

      ;(options.initial?.value ?? dialog)?.focus()
    })
  })

  onBeforeUnmount(() => {
    openModals.value--
    released?.()

    const target =
      openedFrom?.isConnected === true && openedFrom !== document.body
        ? openedFrom
        : (options.returnFocus?.() ?? document.getElementById("main"))

    // After the unmount, so the box leaving does not take the focus with it.
    void nextTick(() => target?.focus())
  })

  /** Bind to the dialog's `keydown`: Tab cycles inside, Escape closes. */
  function onDialogKeydown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      if (options.onEscape !== undefined && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        options.onEscape()
      }

      return
    }

    if (event.key !== "Tab") {
      return
    }

    // Read at the moment of the keystroke: which tab is open decides what is in
    // the box, and a list rendered under a filter changes under it too.
    const stops = focusableIn(options.dialog.value)

    if (stops.length === 0) {
      event.preventDefault()
      return
    }

    const edge = event.shiftKey ? stops[0] : stops[stops.length - 1]

    if (document.activeElement === edge || !options.dialog.value?.contains(document.activeElement)) {
      event.preventDefault()
      ;(event.shiftKey ? stops[stops.length - 1] : stops[0]).focus()
    }
  }

  return { onDialogKeydown }
}

/** How many modal dialogs are open; the page's own shortcuts wait while any is. */
const openModals = ref(0)

export const modalOpen = computed(() => openModals.value > 0)

/**
 * Where a floating panel is teleported to: the open dialog it was opened from,
 * or `<body>` outside of one.
 */
export const FLOATING_HOST: InjectionKey<Ref<HTMLElement | null>> = Symbol("floating-host")

export function useFloatingHost() {
  const host = inject(FLOATING_HOST, undefined)

  return computed(() => host?.value ?? "body")
}

const FOCUSABLE = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=hidden])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "iframe",
  "audio[controls]",
  "video[controls]",
  "[contenteditable]:not([contenteditable=false])",
  "[tabindex]",
].join(",")

/** The Tab stops inside a box, in order: rendered, not inert, not `tabindex=-1`. */
export function focusableIn(root: HTMLElement | null | undefined): HTMLElement[] {
  if (root == null) {
    return []
  }

  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0 && element.closest("[inert]") === null && isRendered(element),
  )
}

function isRendered(element: HTMLElement) {
  // `offsetParent` is null for anything `position: fixed`, which is half of
  // what a dialog holds; `checkVisibility` answers the actual question.
  return typeof element.checkVisibility === "function"
    ? element.checkVisibility({ visibilityProperty: true })
    : element.getClientRects().length > 0
}

/**
 * Make everything outside `keep` inert, and return what undoes it.
 *
 * Walks from the box up to `<body>` and marks each sibling along the way —
 * the standard way to make "outside" mean something to a browser. What was
 * already inert is left alone and not released later, so a second dialog over
 * the first hands the page back to the first rather than to nothing. A live
 * region is spared: an inert one is outside the accessibility tree, and what it
 * says while a dialog is open is still worth hearing.
 */
function inertOutside(keep: HTMLElement): () => void {
  const marked: HTMLElement[] = []
  let node: HTMLElement | null = keep

  while (node !== null && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement

    for (const sibling of parent?.children ?? []) {
      if (
        sibling !== node &&
        sibling instanceof HTMLElement &&
        !sibling.inert &&
        !sibling.hasAttribute("aria-live") &&
        sibling.tagName !== "SCRIPT"
      ) {
        sibling.inert = true
        marked.push(sibling)
      }
    }

    node = parent
  }

  return () => {
    for (const element of marked) {
      element.inert = false
    }
  }
}
