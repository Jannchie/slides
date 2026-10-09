import { autoUpdate, flip, offset, shift, size, useFloating, type Placement } from "@floating-ui/vue"
import { onClickOutside, useEventListener } from "@vueuse/core"
import { ref, type MaybeRefOrGetter, type Ref } from "vue"

/** Kept clear of the window's edges, so a panel never sits flush against one. */
const VIEWPORT_PADDING = 8
/** Below this a list is a slot to peer through; flipping is the better answer. */
const MIN_HEIGHT = 160

/**
 * A menu's panel, positioned against its trigger rather than inside it.
 *
 * The panel is teleported to `<body>` and placed with `position: fixed`, which
 * is what takes it out of whatever the trigger happens to sit in. Hung
 * `absolute` from the trigger, as these menus were, it was part of that box's
 * layout: inside the settings dialog's scrolling column it lengthened the
 * column, dragged a scrollbar in, and was cut off at the column's edge — the
 * dialog changed shape because a list opened.
 *
 * Placement is Floating UI's, because the rules are the ones every menu needs
 * and none of them is obvious: open the other way when this way has no room
 * (`flip`), slide along the edge rather than off it (`shift`), cap the height
 * at what is left of the window (`size`), and keep all of it true while the
 * page scrolls or resizes (`autoUpdate`). The cap arrives as
 * `--floating-max-height` for the panel to spend on whichever part scrolls.
 *
 * Outside-click closing is here too, because it is the one other thing that
 * changes when the panel moves out: the panel is no longer inside the trigger's
 * box, so a click in it would read as a click outside and close the menu under
 * the pointer.
 *
 * Focus leaving closes it the same way a click does — Tab out of the filter
 * box, or a screen reader's cursor moving on — so a list is never left open
 * behind a focus that has gone elsewhere. Only a focus that *arrives*
 * somewhere else counts: one that lands on nothing (a press on a row that
 * takes no focus) is the click's business, and closing on it would shut the
 * menu under the pointer before the click could pick anything.
 */
export function useFloatingPanel(options: {
  open: Ref<boolean>
  placement: MaybeRefOrGetter<Placement>
  /**
   * `match` makes the panel exactly the trigger's width — a form field's menu,
   * which reads as a different control when it is narrower. `min` lets it grow
   * past a small trigger to fit its rows.
   */
  width: "match" | "min"
}) {
  const reference = ref<HTMLElement | null>(null)
  const floating = ref<HTMLElement | null>(null)

  const { floatingStyles } = useFloating(reference, floating, {
    open: options.open,
    placement: options.placement,
    strategy: "fixed",
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(6),
      flip({ padding: VIEWPORT_PADDING }),
      shift({ padding: VIEWPORT_PADDING }),
      size({
        padding: VIEWPORT_PADDING,
        apply({ availableHeight, rects, elements }) {
          elements.floating.style.setProperty(
            "--floating-max-height",
            `${Math.max(MIN_HEIGHT, availableHeight)}px`,
          )
          elements.floating.style[options.width === "match" ? "width" : "minWidth"] =
            `${rects.reference.width}px`
        },
      }),
    ],
  })

  onClickOutside(
    reference,
    () => {
      options.open.value = false
    },
    { ignore: [floating] },
  )

  function onFocusOut(event: FocusEvent) {
    const next = event.relatedTarget

    if (
      next instanceof Node &&
      reference.value?.contains(next) !== true &&
      floating.value?.contains(next) !== true
    ) {
      options.open.value = false
    }
  }

  useEventListener(reference, "focusout", onFocusOut)
  useEventListener(floating, "focusout", onFocusOut)

  return { reference, floating, floatingStyles }
}
