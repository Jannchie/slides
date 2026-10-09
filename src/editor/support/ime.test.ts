import { describe, expect, it } from "vitest"

import { createCompositionGuard } from "./ime"

const key = (event: Partial<KeyboardEvent>): KeyboardEvent =>
  ({
    key: "Enter",
    isComposing: false,
    keyCode: 13,
    timeStamp: 0,
    ...event,
  }) as KeyboardEvent

describe("createCompositionGuard", () => {
  it("leaves an ordinary key press to the page", () => {
    const guard = createCompositionGuard()

    expect(guard.composing(key({ timeStamp: 1000 }))).toBe(false)
  })

  it("takes the key the browser says is being composed", () => {
    const guard = createCompositionGuard()

    expect(guard.composing(key({ isComposing: true }))).toBe(true)
    // What some browsers say instead: a key the input method swallowed.
    expect(guard.composing(key({ keyCode: 229 }))).toBe(true)
  })

  it("takes every key between the start and the end of a composition", () => {
    const guard = createCompositionGuard()

    guard.start()
    expect(guard.composing(key({ timeStamp: 500 }))).toBe(true)

    guard.end({ timeStamp: 900 })
    expect(guard.composing(key({ timeStamp: 2000 }))).toBe(false)
  })

  // The bug this exists for: WebKit ends the composition first, so the Enter
  // that commits the word arrives looking exactly like an Enter that sends.
  it("takes the commit keydown that arrives after compositionend", () => {
    const guard = createCompositionGuard()

    guard.start()
    guard.end({ timeStamp: 900 })

    expect(guard.composing(key({ timeStamp: 901 }))).toBe(true)
  })

  it("gives Enter back as soon as the reader could have meant it", () => {
    const guard = createCompositionGuard(100)

    guard.start()
    guard.end({ timeStamp: 900 })

    expect(guard.composing(key({ timeStamp: 1000 }))).toBe(true)
    expect(guard.composing(key({ timeStamp: 1001 }))).toBe(false)
  })
})
