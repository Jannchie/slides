/**
 * Whether a key press belongs to an input method or to the page.
 *
 * `KeyboardEvent.isComposing` is the answer on paper, and it is wrong exactly
 * where it matters: the Enter that *commits* a composition. Browsers disagree
 * on the order of that sequence — WebKit fires `compositionend` before the
 * keydown, which then arrives with `isComposing` false and looks for all the
 * world like a reader pressing Enter to send. Everyone typing Chinese, Japanese
 * or Korean hits it on the first word they write.
 *
 * So three signals rather than one: the flag, the 229 keycode browsers use for
 * a key the input method swallowed, and a short window after `compositionend`
 * in which an Enter is the commit rather than a send. The window is measured
 * with the events' own `timeStamp`s — same clock, no reading of the wall.
 */

/** Long enough to cover the commit keydown, short enough that a reader
 * pressing Enter straight after a word still sends it. */
const COMMIT_GRACE_MS = 100

export type CompositionGuard = {
  start(): void
  end(event: { timeStamp: number }): void
  /** True while the key belongs to the input method; the page ignores it. */
  composing(event: KeyboardEvent): boolean
}

export function createCompositionGuard(graceMs: number = COMMIT_GRACE_MS): CompositionGuard {
  let open = false
  let endedAt: number | undefined

  return {
    start() {
      open = true
      endedAt = undefined
    },
    end(event) {
      open = false
      endedAt = event.timeStamp
    },
    composing(event) {
      // `keyCode` is deprecated and still the only place some browsers say a
      // key was consumed by the input method. Belt and braces beside `open`,
      // which covers the same window for any caller that binds
      // `compositionstart` — this one answers for a caller that forgets to.
      if (event.isComposing || event.keyCode === 229 || open) {
        return true
      }

      return endedAt !== undefined && event.timeStamp - endedAt <= graceMs
    },
  }
}
