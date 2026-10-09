import { inject, provide, type App, type InjectionKey } from "vue"

import { DECK_THEMES, type DeckTheme } from "../index"
import { hasMessage, t } from "./i18n"

/**
 * The themes a deck can be drawn in here: the shipped ones, then the host's.
 *
 * A host's theme with a shipped theme's id replaces it, so a host can restyle
 * "minimal-dark" without decks having to name something else. Read through a
 * function rather than held, because the host's list is a prop that can change.
 */
const THEMES: InjectionKey<() => readonly DeckTheme[]> = Symbol("deck-themes")

export function withHostThemes(host: readonly DeckTheme[] = []): readonly DeckTheme[] {
  const byId = new Map(DECK_THEMES.map((theme) => [theme.id, theme]))

  for (const theme of host) {
    byId.set(theme.id, theme)
  }

  return [...byId.values()]
}

/** Hand the themes to every component under the editor. */
export function provideDeckThemes(themes: () => readonly DeckTheme[], app?: App) {
  if (app === undefined) {
    provide(THEMES, themes)
  } else {
    app.provide(THEMES, themes)
  }
}

/** The themes this component's editor offers; the shipped ones outside an editor. */
export function useDeckThemes(): () => readonly DeckTheme[] {
  return inject(THEMES, () => DECK_THEMES)
}

/** A theme's name in the reader's language: the shipped themes are translated, a host's says its own. */
export function themeName(theme: DeckTheme) {
  const key = `deck.theme.${theme.id}`

  return hasMessage(key) ? t(key) : theme.name
}
