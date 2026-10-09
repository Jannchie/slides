import { computed, defineComponent, h, onBeforeUnmount, onMounted, ref, type PropType } from "vue"

import { DECK_WIDTH, type Deck } from "../../index"

import DeckSlideView from "./DeckSlideView"

/**
 * What the presenter sees: the slide the audience sees, the one after it,
 * the notes in type large enough to read at a glance, and the time since the
 * talk began.
 *
 * Styled inline, and built from nothing but the slide renderer: it is mounted
 * into a window of its own, which has none of the app's stylesheet.
 */
export default defineComponent({
  name: "DeckPresenterConsole",
  props: {
    deck: { type: Object as PropType<Deck>, required: true },
    /** The slides presented, by their place in the deck: the hidden ones are skipped. */
    order: { type: Array as PropType<readonly number[]>, required: true },
    position: { type: Number, required: true },
    resolveAsset: { type: Function as PropType<(src: string) => string>, required: true },
    labels: {
      type: Object as PropType<{
        next: string
        end: string
        notes: string
        previous: string
        forward: string
      }>,
      required: true,
    },
  },
  emits: { step: (_delta: 1 | -1) => true },
  setup(props, { emit }) {
    const started = Date.now()
    const now = ref(Date.now())
    const width = ref(1200)
    let timer: ReturnType<typeof setInterval> | undefined
    const root = ref<HTMLElement>()
    let observer: ResizeObserver | undefined

    onMounted(() => {
      timer = setInterval(() => (now.value = Date.now()), 1000)
      observer = new ResizeObserver(([entry]) => {
        if (entry !== undefined) {
          width.value = entry.contentRect.width
        }
      })

      if (root.value !== undefined) {
        observer.observe(root.value)
      }
    })

    onBeforeUnmount(() => {
      clearInterval(timer)
      observer?.disconnect()
    })

    const elapsed = computed(() => {
      const seconds = Math.floor((now.value - started) / 1000)

      return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`
    })

    const current = computed(() => props.deck.slides[props.order[props.position] ?? 0])
    const next = computed(() => {
      const index = props.order[props.position + 1]

      return index === undefined ? undefined : props.deck.slides[index]
    })

    const slideBox = (slide: Deck["slides"][number] | undefined, boxWidth: number) =>
      h(
        "div",
        {
          style: {
            position: "relative",
            width: `${boxWidth}px`,
            height: `${boxWidth * (9 / 16)}px`,
            overflow: "hidden",
            borderRadius: "6px",
            background: "#000",
            boxShadow: "0 0 0 1px rgb(255 255 255 / 0.12)",
          },
        },
        slide === undefined
          ? []
          : [
              h(
                "div",
                {
                  style: {
                    position: "absolute",
                    left: "0",
                    top: "0",
                    transformOrigin: "0 0",
                    transform: `scale(${boxWidth / DECK_WIDTH})`,
                  },
                },
                [
                  h(DeckSlideView, {
                    slide,
                    deckStyle: props.deck.style,
                    theme: props.deck.theme,
                    resolveAsset: props.resolveAsset,
                  }),
                ],
              ),
            ],
      )

    const button = (text: string, delta: 1 | -1) =>
      h(
        "button",
        {
          type: "button",
          style: {
            background: "rgb(255 255 255 / 0.1)",
            color: "inherit",
            border: "0",
            borderRadius: "8px",
            padding: "8px 14px",
            font: "inherit",
            cursor: "pointer",
          },
          onClick: () => emit("step", delta),
        },
        text,
      )

    return () => {
      const main = Math.max(Math.min(width.value * 0.58, 1100), 280)
      const side = Math.max(Math.min(width.value - main - 72, 520), 200)

      return h(
        "div",
        {
          ref: root,
          style: {
            position: "fixed",
            inset: "0",
            display: "grid",
            gridTemplateColumns: `${main}px 1fr`,
            gap: "24px",
            padding: "24px",
            background: "#111214",
            color: "#ececef",
            font: "15px/1.5 system-ui, sans-serif",
            boxSizing: "border-box",
          },
        },
        [
          h("div", { style: { display: "flex", flexDirection: "column", gap: "16px", minWidth: "0" } }, [
            slideBox(current.value, main),
            h("div", { style: { display: "flex", alignItems: "center", gap: "8px" } }, [
              button(props.labels.previous, -1),
              button(props.labels.forward, 1),
              h("span", { style: { flex: "1" } }),
              h(
                "span",
                {
                  style: {
                    fontVariantNumeric: "tabular-nums",
                    fontSize: "28px",
                    fontFamily: "ui-monospace, monospace",
                  },
                },
                elapsed.value,
              ),
              h(
                "span",
                { style: { fontVariantNumeric: "tabular-nums", opacity: "0.7", marginLeft: "16px" } },
                `${props.position + 1} / ${props.order.length}`,
              ),
            ]),
          ]),
          h(
            "div",
            {
              style: { display: "flex", flexDirection: "column", gap: "16px", minWidth: "0", minHeight: "0" },
            },
            [
              h(
                "div",
                {
                  style: {
                    fontSize: "12px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    opacity: "0.6",
                  },
                },
                props.labels.next,
              ),
              next.value === undefined
                ? h("div", { style: { opacity: "0.6" } }, props.labels.end)
                : slideBox(next.value, side),
              h(
                "div",
                {
                  style: {
                    fontSize: "12px",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    opacity: "0.6",
                    marginTop: "8px",
                  },
                },
                props.labels.notes,
              ),
              h(
                "div",
                {
                  style: {
                    flex: "1",
                    minHeight: "0",
                    overflowY: "auto",
                    whiteSpace: "pre-wrap",
                    fontSize: "22px",
                    lineHeight: "1.45",
                  },
                },
                current.value?.notes ?? "",
              ),
            ],
          ),
        ],
      )
    }
  },
})
