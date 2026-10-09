// The editor as Vue components, for a host that is itself a Vue app: the
// props and events are the whole contract. A host on another framework mounts
// the same component through `mountDeckEditor` (`.`) or the React wrapper.
export { default as DeckEditor } from "./components/DeckEditor.vue"
export { default as DeckSlideView } from "./components/DeckSlideView"
export type { DeckAssetStore } from "./host"
export { deckLocale, deckLocales, setDeckLocale, type DeckLocale } from "./i18n"
