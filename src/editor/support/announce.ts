import { nextTick, ref } from "vue"

/**
 * What a reader who cannot see the screen is told, as it happens.
 *
 * One pair of regions for the whole editor, mounted with it (`DeckEditor`), and
 * any component speaks through `announce` rather than keeping a region of its
 * own. Two reasons. A region only speaks about changes made while it is in the
 * document, so one rendered beside the thing that changed — a copy button, a
 * row being archived — is usually created in the same tick as its text and
 * says nothing. And two regions speaking at once are read in whatever order
 * the screen reader likes; one region reads them in the order they happened.
 *
 * `polite` waits for a gap in what is being read; `assertive` is for what the
 * reader must hear before they act again — a refusal, a failure — and nothing
 * else, because it cuts in.
 */
export const politeMessage = ref("")
export const assertiveMessage = ref("")

export function announce(message: string, options: { assertive?: boolean } = {}) {
  const region = options.assertive === true ? assertiveMessage : politeMessage

  // Emptied first and refilled a tick later: a region handed the same words
  // twice sees no change, and "Copied." for the second copy is not news to it.
  region.value = ""
  void nextTick(() => {
    region.value = message
  })
}
