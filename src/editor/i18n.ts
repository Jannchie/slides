import { ref } from "vue"

import enMessages from "./locales/en.json"
import jaMessages from "./locales/ja.json"
import zhCNMessages from "./locales/zh-CN.json"

/**
 * The editor's own words, in the languages it ships.
 *
 * The same shape as the web app's: flat keys, `{param}` interpolation, a
 * module singleton over a ref, so a computed that calls `t` follows a change
 * of language wherever it sits. The words travel with the editor rather than
 * being asked of the host, because a host that forgot one would show a key;
 * the host says only which language (`setDeckLocale`, or the editor's
 * `locale` prop, which calls it).
 *
 * One language per page: two editors mounted side by side in two languages is
 * not a case anything here has.
 */
export const deckLocales = ["en", "zh-CN", "ja"] as const

export type DeckLocale = (typeof deckLocales)[number]

/** Every key English has, which is what `t` is typed against. */
export type DeckMessageKey = keyof typeof enMessages
type MessageParams = Record<string, string | number>

// Typed against English's keys, so a language missing one is a compile error.
const dictionaries: Record<DeckLocale, Record<DeckMessageKey, string>> = {
  en: enMessages,
  "zh-CN": zhCNMessages,
  ja: jaMessages,
}

export const deckLocale = ref<DeckLocale>("en")

/**
 * Take a language tag the host speaks in. Matched on the primary subtag, as the
 * web app does: `zh-Hant` is better served by simplified Chinese than English.
 */
export function setDeckLocale(tag: string) {
  switch (tag.trim().replace(/_/g, "-").toLowerCase().split("-")[0]) {
    case "zh":
      deckLocale.value = "zh-CN"
      break
    case "ja":
      deckLocale.value = "ja"
      break
    default:
      deckLocale.value = "en"
  }
}

/** Whether the editor has words for `key`: for a key made from a value, such as a theme's id. */
export function hasMessage(key: string): key is DeckMessageKey {
  return key in enMessages
}

export function t(key: DeckMessageKey, params?: MessageParams): string {
  const message = dictionaries[deckLocale.value][key]

  if (params === undefined) {
    return message
  }

  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]

    return value === undefined ? match : String(value)
  })
}
