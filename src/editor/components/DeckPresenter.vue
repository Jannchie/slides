<script setup lang="ts">
import {
  computed,
  createApp,
  h,
  nextTick,
  onBeforeUnmount,
  onMounted,
  reactive,
  ref,
  shallowRef,
  useTemplateRef,
  watch,
  type App,
} from "vue"

import { DECK_BASE_CSS, DECK_HEIGHT, DECK_WIDTH, deckMagicMove, type Deck } from "../../index"
import { fontFaceRule } from "../../dom"
import { useDialogFocus } from "../support/dialog-focus"

import { t } from "../i18n"
import DeckPresenterConsole from "./DeckPresenterConsole"
import DeckSlideView from "./DeckSlideView"

/**
 * The deck presented: full screen, a slide at a time, each element with a
 * build appearing on a click, and each slide leaving by its transition — the
 * same steps the version's page takes, drawn by the editor's renderer.
 *
 * With `presenter`, a window of its own shows the presenter the notes, the
 * next slide and the time; the two stay in step whichever of them is driven.
 * A browser that refuses the window gets the console on this screen instead.
 */
const props = defineProps<{
  deck: Deck
  start: number
  presenter: boolean
  resolveAsset: (src: string) => string
}>()

const emit = defineEmits<{ close: [slideIndex: number] }>()

/** The slides presented, by their place in the deck. */
const order = computed(() =>
  props.deck.slides.flatMap((slide, index) => (slide.hidden === true ? [] : [index])),
)
const state = reactive({ position: Math.max(order.value.indexOf(props.start), 0), step: 0 })
/** The slide on its way out, and how many of its builds were showing when it left. */
const leaving = shallowRef<{ index: number; animation: string; step: number } | undefined>()
const entering = ref<string>()
/** The 1920×1080 box both slides are drawn in during a transition. */
const slideBox = useTemplateRef<HTMLElement>("slideBox")

const overlay = useTemplateRef<HTMLElement>("overlay")
// Escape is the show's own key, heard on the window with the rest of them.
const { onDialogKeydown } = useDialogFocus({ dialog: overlay })
const stageWrap = useTemplateRef<HTMLElement>("stageWrap")
const room = ref({ width: window.innerWidth, height: window.innerHeight })
const scale = computed(() => Math.min(room.value.width / DECK_WIDTH, room.value.height / DECK_HEIGHT))

const currentIndex = computed(() => order.value[state.position] ?? 0)
const current = computed(() => props.deck.slides[currentIndex.value])
const consoleHere = ref(false)

// ---------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------

type Build = { element: HTMLElement; kind: string; auto: boolean }

/**
 * A slide's builds, a click's worth to a group: one, and every `auto` after
 * it. `which` is the slide on screen (`.deck-current`) or the one leaving it.
 */
function buildGroups(which = ".deck-current"): Build[][] {
  const builds = [...(stageWrap.value?.querySelectorAll<HTMLElement>(`${which} [data-build-in]`) ?? [])]
    .map((element, at) => {
      const words = (element.getAttribute("data-build-in") ?? "").trim().split(/\s+/)
      const order = Number(words.find((word) => /^\d+$/.test(word)) ?? at + 1)

      return { element, kind: words[0] || "fade", order, auto: words.includes("auto"), at }
    })
    .sort((a, b) => a.order - b.order || a.at - b.at)
  const groups: Build[][] = []

  for (const build of builds) {
    if (build.auto && groups.length > 0) {
      groups.at(-1)!.push(build)
    } else {
      groups.push([build])
    }
  }

  return groups
}

function showBuilds(upTo: number, animate: boolean, which = ".deck-current") {
  buildGroups(which).forEach((group, at) =>
    group.forEach((build, order) => {
      const shown = at < upTo

      build.element.style.visibility = shown ? "visible" : "hidden"
      build.element.style.animation =
        shown && animate && at === upTo - 1
          ? `deck-build-${build.kind} 520ms cubic-bezier(.2,.7,.2,1) ${order * 180}ms both`
          : ""
    }),
  )
}

watch(
  () => [currentIndex.value, props.deck] as const,
  () => void nextTick(() => showBuilds(state.step, false)),
)

// ---------------------------------------------------------------------------
// Stepping
// ---------------------------------------------------------------------------

const TRANSITIONS: Record<
  string,
  { out: string; in: string; back: { out: string; in: string }; ms: number }
> = {
  fade: {
    out: "deck-fade-out",
    in: "deck-fade-in",
    back: { out: "deck-fade-out", in: "deck-fade-in" },
    ms: 400,
  },
  // The rest of the two slides cross-fade; what is on both moves (`deckMagicMove`).
  magic: {
    out: "deck-fade-out",
    in: "deck-fade-in",
    back: { out: "deck-fade-out", in: "deck-fade-in" },
    ms: 600,
  },
  push: {
    out: "deck-push-out",
    in: "deck-push-in",
    back: { out: "deck-push-out-back", in: "deck-push-in-back" },
    ms: 500,
  },
}

let leaveTimer: ReturnType<typeof setTimeout> | undefined

function goTo(position: number, forward: boolean) {
  const next = Math.min(Math.max(position, 0), order.value.length - 1)

  if (next === state.position) {
    return
  }

  const from = currentIndex.value
  const transition = props.deck.slides[forward ? from : (order.value[next] ?? from)]?.transition
  const motion = transition === undefined ? undefined : TRANSITIONS[transition]

  clearTimeout(leaveTimer)

  if (motion !== undefined && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const pair = forward ? motion : motion.back

    leaving.value = {
      index: from,
      animation: `${pair.out} ${motion.ms}ms cubic-bezier(.4,0,.2,1) both`,
      step: state.step,
    }
    entering.value = `${pair.in} ${motion.ms}ms cubic-bezier(.4,0,.2,1) both`
    leaveTimer = setTimeout(() => {
      leaving.value = undefined
      entering.value = undefined
    }, motion.ms)
  } else {
    leaving.value = undefined
    entering.value = undefined
  }

  state.position = next
  state.step = 0
  void nextTick(() => {
    const groups = buildGroups().length

    state.step = forward ? 0 : groups
    showBuilds(state.step, false)

    // The leaving slide is drawn afresh, every build showing; it leaves as it
    // was, with only the builds the audience had already seen.
    if (leaving.value !== undefined) {
      showBuilds(leaving.value.step, false, ".deck-leaving")
    }

    // Both slides are drawn now, where they will be: what they share can move.
    const box = slideBox.value

    if (transition === "magic" && motion !== undefined && leaving.value !== undefined && box !== null) {
      const from = box.querySelector<HTMLElement>(".deck-leaving .deck-slide")
      const to = box.querySelector<HTMLElement>(".deck-current .deck-slide")

      if (from !== null && to !== null) {
        deckMagicMove(from, to, box, motion.ms)
      }
    }
  })
}

/** Back to the first slide, its builds still to come — a fresh start, as the version's page does it. */
function restart() {
  if (state.position === 0) {
    state.step = 0
    showBuilds(0, false)
  } else {
    goTo(0, true)
  }
}

function forward() {
  const groups = buildGroups().length

  if (state.step < groups) {
    state.step += 1
    showBuilds(state.step, true)
  } else {
    goTo(state.position + 1, true)
  }
}

function back() {
  if (state.step > 0) {
    state.step -= 1
    showBuilds(state.step, false)
  } else {
    goTo(state.position - 1, false)
  }
}

function step(delta: 1 | -1) {
  if (delta === 1) {
    forward()
  } else {
    back()
  }
}

function close() {
  emit("close", currentIndex.value)
}

function onKeydown(event: KeyboardEvent) {
  const key = event.key

  // A key pressed on this screen (not the console's window) is the gesture a
  // full screen refused at the start was waiting for.
  if (event.view === window && key !== "Escape") {
    retryFullscreen()
  }

  if (key === "ArrowRight" || key === "ArrowDown" || key === "PageDown" || key === " " || key === "Enter") {
    event.preventDefault()

    if (key === " " && event.shiftKey) {
      back()
    } else {
      forward()
    }
  } else if (key === "ArrowLeft" || key === "ArrowUp" || key === "PageUp" || key === "Backspace") {
    event.preventDefault()
    back()
  } else if (key === "Home") {
    event.preventDefault()
    restart()
  } else if (key === "End") {
    event.preventDefault()
    goTo(order.value.length - 1, true)
  } else if (key === "Escape") {
    event.preventDefault()
    close()
  }
}

function onClick(event: MouseEvent) {
  // The first click after a refused full screen goes there instead of on.
  if (retryFullscreen()) {
    return
  }

  if (event.clientX > window.innerWidth / 3) {
    forward()
  } else {
    back()
  }
}

// ---------------------------------------------------------------------------
// The screens
// ---------------------------------------------------------------------------

let popup: Window | null = null
let consoleApp: App | undefined

function openConsole() {
  popup = window.open("", "deck-presenter", "popup,width=1200,height=720")

  if (popup === null) {
    consoleHere.value = true
    return
  }

  const target = popup.document

  target.title = t("deck.presenterView")
  target.body.replaceChildren()
  target.head.querySelectorAll("style[data-deck], link[data-deck]").forEach((node) => node.remove())

  const sheet = target.createElement("style")

  sheet.dataset.deck = "base"
  sheet.textContent = `${DECK_BASE_CSS}\nhtml,body{margin:0;background:#111214}`
  target.head.append(sheet)

  for (const href of props.deck.fontLinks) {
    const link = target.createElement("link")

    link.rel = "stylesheet"
    link.href = href
    link.dataset.deck = "font"
    target.head.append(link)
  }

  // The deck's own font files, at addresses the window can reach on its own:
  // it has no document of this page's to resolve a relative one against.
  if (props.deck.fontFaces.length > 0) {
    const faces = target.createElement("style")

    faces.dataset.deck = "font"
    faces.textContent = props.deck.fontFaces
      .map((face) =>
        fontFaceRule(face.family, new URL(props.resolveAsset(face.src), window.location.href).href),
      )
      .join("\n")
    target.head.append(faces)
  }

  const holder = target.createElement("div")

  target.body.append(holder)
  consoleApp = createApp(() =>
    h(DeckPresenterConsole, {
      deck: props.deck,
      order: order.value,
      position: state.position,
      resolveAsset: props.resolveAsset,
      labels: consoleLabels.value,
      onStep: step,
    }),
  )
  consoleApp.mount(holder)
  popup.addEventListener("keydown", onKeydown)
  popup.addEventListener("pagehide", () => {
    consoleApp?.unmount()
    consoleApp = undefined
    popup = null
  })
}

const consoleLabels = computed(() => ({
  next: t("deck.presenter.next"),
  end: t("deck.presenter.end"),
  notes: t("deck.notes"),
  previous: t("deck.presenter.previous"),
  forward: t("deck.presenter.forward"),
}))

let resizeObserver: ResizeObserver | undefined

/**
 * Full screen wanted but refused: opening the presenter's window spends the
 * click that started the show, and a browser grants full screen only to a
 * gesture it has not spent. The next click or key on this screen asks again.
 */
let fullscreenOwed = false

function enterFullscreen() {
  const target = overlay.value

  if (target?.requestFullscreen === undefined) {
    return
  }

  fullscreenOwed = false
  target.requestFullscreen().catch(() => {
    fullscreenOwed = true
  })
}

/** Ask again for a full screen refused earlier; whether there was one to ask for. */
function retryFullscreen() {
  if (!fullscreenOwed || document.fullscreenElement !== null) {
    return false
  }

  enterFullscreen()
  return true
}

function onFullscreenChange() {
  // Leaving full screen by the browser's own means ends the show, unless the
  // console is on this screen and the slides were never full screen.
  if (document.fullscreenElement === null && !consoleHere.value) {
    close()
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(([entry]) => {
    if (entry !== undefined) {
      room.value = { width: entry.contentRect.width, height: entry.contentRect.height }
    }
  })

  if (stageWrap.value !== null) {
    resizeObserver.observe(stageWrap.value)
  }

  // The presenter's window first: a window refused cannot be had back, and the
  // console would land on the audience's screen; a full screen refused is
  // asked for again on the next gesture (`retryFullscreen`).
  if (props.presenter) {
    openConsole()
  }

  if (!consoleHere.value) {
    enterFullscreen()
  }

  document.addEventListener("fullscreenchange", onFullscreenChange)
  window.addEventListener("keydown", onKeydown)
  void nextTick(() => showBuilds(0, false))
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  document.removeEventListener("fullscreenchange", onFullscreenChange)
  window.removeEventListener("keydown", onKeydown)
  clearTimeout(leaveTimer)
  consoleApp?.unmount()
  popup?.close()

  if (document.fullscreenElement !== null) {
    void document.exitFullscreen?.().catch(() => {})
  }
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="overlay"
      class="slides-editor fixed inset-0 z-[60] bg-black outline-none"
      role="dialog"
      aria-modal="true"
      tabindex="-1"
      :aria-label="t('deck.present')"
      @keydown="onDialogKeydown"
    >
      <DeckPresenterConsole
        v-if="consoleHere"
        :deck="deck"
        :order="order"
        :position="state.position"
        :resolve-asset="resolveAsset"
        :labels="consoleLabels"
        @step="step"
      />
      <div v-else ref="stageWrap" class="absolute inset-0 overflow-hidden" @click="onClick">
        <div
          ref="slideBox"
          class="absolute left-1/2 top-1/2"
          :style="{ width: '1920px', height: '1080px', transform: `translate(-50%, -50%) scale(${scale})` }"
        >
          <div
            v-if="leaving"
            :key="`leaving-${leaving.index}`"
            class="deck-leaving absolute inset-0"
            :style="{ animation: leaving.animation }"
          >
            <DeckSlideView
              v-if="deck.slides[leaving.index]"
              :slide="deck.slides[leaving.index]!"
              :deck-style="deck.style"
              :theme="deck.theme"
              :resolve-asset="resolveAsset"
            />
          </div>
          <div
            :key="`current-${currentIndex}`"
            class="deck-current absolute inset-0"
            :style="{ animation: entering }"
          >
            <DeckSlideView
              v-if="current"
              :slide="current"
              :deck-style="deck.style"
              :theme="deck.theme"
              :resolve-asset="resolveAsset"
            />
          </div>
        </div>
      </div>
      <button
        type="button"
        class="absolute right-3 top-3 h-8 w-8 flex items-center justify-center rounded-md bg-white/10 text-white opacity-0 slides-transition hover:opacity-100 focus-visible:opacity-100"
        :title="t('deck.presenter.exit')"
        :aria-label="t('deck.presenter.exit')"
        @click.stop="close"
      >
        <i class="i-jannchie-x h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  </Teleport>
</template>
