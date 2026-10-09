import { shallowRef, type ShallowRef } from "vue"
import type { Deck } from "../index"

/**
 * What the deck editor can take back: every deck it has held, as values.
 *
 * A change made under the same `key` as the one before, within a moment of
 * it, joins that step rather than adding one: a drag is a hundred moves and
 * one thing the reader did, a run of typing is one edit, a slider pulled
 * across is one change of opacity. Anything else — a different key, or a
 * pause — starts the next step.
 *
 * Each step carries what was selected when it was taken, so undoing a move
 * puts the selection back on what moved.
 */
export type DeckHistoryEntry<Selection> = { deck: Deck; selection: Selection }

const JOIN_WINDOW_MS = 800
const LIMIT = 200

export class DeckHistory<Selection> {
  readonly current: ShallowRef<Deck>
  readonly canUndo = shallowRef(false)
  readonly canRedo = shallowRef(false)

  private past: DeckHistoryEntry<Selection>[] = []
  private future: DeckHistoryEntry<Selection>[] = []
  private lastKey: string | undefined
  private lastAt = 0

  constructor(deck: Deck) {
    this.current = shallowRef(deck)
  }

  /** Start over from `deck`, forgetting every step: a version loaded from outside. */
  reset(deck: Deck) {
    this.past = []
    this.future = []
    this.lastKey = undefined
    this.current.value = deck
    this.sync()
  }

  /** Make `deck` the current one; `selection` is what to restore if this is undone. */
  push(deck: Deck, selection: Selection, key?: string) {
    if (deck === this.current.value) {
      return
    }

    const now = Date.now()
    const joins =
      key !== undefined && key === this.lastKey && now - this.lastAt < JOIN_WINDOW_MS && this.past.length > 0

    if (!joins) {
      this.past.push({ deck: this.current.value, selection })

      if (this.past.length > LIMIT) {
        this.past.shift()
      }
    }

    this.future = []
    this.lastKey = key
    this.lastAt = now
    this.current.value = deck
    this.sync()
  }

  /** End the step being joined, so the next change under the same key is a step of its own. */
  seal() {
    this.lastKey = undefined
  }

  undo(selection: Selection): Selection | undefined {
    const entry = this.past.pop()

    if (entry === undefined) {
      return undefined
    }

    this.future.push({ deck: this.current.value, selection })
    this.current.value = entry.deck
    this.lastKey = undefined
    this.sync()

    return entry.selection
  }

  redo(selection: Selection): Selection | undefined {
    const entry = this.future.pop()

    if (entry === undefined) {
      return undefined
    }

    this.past.push({ deck: this.current.value, selection })
    this.current.value = entry.deck
    this.lastKey = undefined
    this.sync()

    return entry.selection
  }

  private sync() {
    this.canUndo.value = this.past.length > 0
    this.canRedo.value = this.future.length > 0
  }
}
