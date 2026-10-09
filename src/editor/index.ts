import { createApp, h, ref, shallowReactive } from "vue"

import DeckEditor from "./components/DeckEditor.vue"
import type { DeckTheme } from "../index"
import type { DeckAssetStore } from "./host"

export type { DeckAssetStore } from "./host"
export { DECK_THEMES, MINIMAL_DARK, MINIMAL_LIGHT, type DeckTheme } from "../index"
export { deckLocales, setDeckLocale, type DeckLocale } from "./i18n"

export type DeckEditorOptions = {
  /** The deck's HTML. A new value is taken in place, as the model's next version. */
  source: string
  /** Whether the reader may change it; a read-only editor still pages and presents. */
  editable?: boolean
  assets: DeckAssetStore
  /** A language tag; English when left out or not one the editor speaks. */
  locale?: string
  /** The reader changed the deck; `write()` answers with its text. */
  onChange?: () => void
  /** Themes a deck may name besides the shipped two; one with a shipped theme's id replaces it. */
  themes?: readonly DeckTheme[]
}

export type DeckEditorHandle = {
  /** Change any option; what is left out stays as it was. */
  update(options: Partial<DeckEditorOptions>): void
  /** The deck's text now — exactly the source while nothing has changed. */
  write(): string
  /** Which slide is on screen, from zero. */
  slideIndex(): number
  /** The title of the slide on screen. */
  slideTitle(): string
  /** The words of what is selected, for asking about it. */
  selectedText(): string
  destroy(): void
}

/**
 * The editor mounted into an element of any page, for a host that is not a
 * Vue app. It brings its own Vue; styles
 * come from the package's stylesheet, which the host loads.
 */
export function mountDeckEditor(element: HTMLElement, options: DeckEditorOptions): DeckEditorHandle {
  const state = shallowReactive({ editable: true, ...options })
  const editor = ref<InstanceType<typeof DeckEditor> | null>(null)
  const app = createApp({
    render: () =>
      h(DeckEditor, {
        ref: editor,
        class: "h-full",
        source: state.source,
        editable: state.editable,
        assets: state.assets,
        locale: state.locale,
        themes: state.themes,
        onChange: () => state.onChange?.(),
      }),
  })

  app.mount(element)

  return {
    update(next) {
      Object.assign(state, next)
    },
    write: () => editor.value?.write() ?? state.source,
    slideIndex: () => editor.value?.slideIndex ?? 0,
    slideTitle: () => editor.value?.slideTitle ?? "",
    selectedText: () => editor.value?.selectedText() ?? "",
    destroy() {
      app.unmount()
    },
  }
}
