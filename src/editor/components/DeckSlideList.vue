<script setup lang="ts">
import { nextTick, ref, useTemplateRef, watch } from "vue"

import { DECK_WIDTH, deckSlideTitle, type Deck } from "../../index"

import { t } from "../i18n"
import DeckSlideView from "./DeckSlideView"

/**
 * The deck's slides down the side, each drawn small by the same renderer the
 * stage uses — so a thumbnail is its slide, not a summary of its words.
 *
 * A slide is picked by a click or the arrow keys, moved by dragging it (or
 * Alt with an arrow), and added, copied, hidden or removed from the bar.
 */
const props = defineProps<{
  deck: Deck
  slideIndex: number
  editable: boolean
  resolveAsset: (src: string) => string
}>()

const emit = defineEmits<{
  pick: [index: number]
  add: []
  duplicate: [index: number]
  remove: [index: number]
  move: [from: number, to: number]
  toggleHidden: [index: number]
  /** A right click on a slide: which, and where. */
  menu: [index: number, at: { x: number; y: number }]
}>()

/** The thumbnail's width in pixels, which is what its slide is scaled to. */
const THUMB_WIDTH = 120
const thumbScale = THUMB_WIDTH / DECK_WIDTH

const list = useTemplateRef<HTMLElement>("list")
const dragging = ref<number>()
const dropAt = ref<number>()

function onDragStart(event: DragEvent, index: number) {
  if (!props.editable) {
    event.preventDefault()
    return
  }

  dragging.value = index
  event.dataTransfer?.setData("text/plain", String(index))

  if (event.dataTransfer !== null) {
    event.dataTransfer.effectAllowed = "move"
  }
}

function onDragOver(event: DragEvent, index: number) {
  if (dragging.value === undefined) {
    return
  }

  event.preventDefault()

  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect()

  dropAt.value = event.clientY < bounds.top + bounds.height / 2 ? index : index + 1
}

function onDrop(event: DragEvent) {
  event.preventDefault()

  const from = dragging.value
  const to = dropAt.value

  dragging.value = undefined
  dropAt.value = undefined

  if (from === undefined || to === undefined) {
    return
  }

  // Dropped below itself, the gap it leaves shifts the place by one.
  const target = to > from ? to - 1 : to

  if (target !== from) {
    emit("move", from, target)
  }
}

function onKeydown(event: KeyboardEvent, index: number) {
  const step = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0

  // A key the list answers is not also the stage's: Alt+Arrow moving a slide
  // must not nudge what is selected, nor Delete remove it.
  if (step !== 0) {
    event.preventDefault()
    event.stopPropagation()

    const next = index + step

    if (next < 0 || next >= props.deck.slides.length) {
      return
    }

    if (event.altKey && props.editable) {
      emit("move", index, next)
    } else {
      emit("pick", next)
    }

    return
  }

  if ((event.key === "Delete" || event.key === "Backspace") && props.editable) {
    event.preventDefault()
    event.stopPropagation()
    emit("remove", index)
    return
  }

  // Enter adds a slide after this one, and Ctrl/Cmd+D copies it, as in a
  // presentation program's slide list. Home and End go to the ends.
  const mod = event.ctrlKey || event.metaKey

  if (event.key === "Enter" && !mod && !event.shiftKey && props.editable) {
    event.preventDefault()
    event.stopPropagation()
    emit("pick", index)
    emit("add")
    return
  }

  if (mod && event.key.toLowerCase() === "d" && props.editable) {
    event.preventDefault()
    event.stopPropagation()
    emit("duplicate", index)
    return
  }

  if (event.key === "Home" || event.key === "End") {
    event.preventDefault()
    event.stopPropagation()
    emit("pick", event.key === "Home" ? 0 : props.deck.slides.length - 1)
  }
}

// The current slide stays in view, and keeps the focus when it was in the list.
watch(
  () => props.slideIndex,
  async (index) => {
    await nextTick()

    const button = list.value?.querySelector<HTMLElement>(`[data-slide-index="${index}"]`)

    button?.scrollIntoView({ block: "nearest" })

    if (list.value?.contains(document.activeElement)) {
      button?.focus({ preventScroll: true })
    }
  },
)
</script>

<template>
  <nav class="flex min-h-0 flex-col" :aria-label="t('deck.slide.list')">
    <div v-if="editable" class="flex items-center gap-0.5 border-b border-slides-line px-1.5 py-1">
      <button
        type="button"
        class="slides-icon-button"
        :title="t('deck.slide.add')"
        :aria-label="t('deck.slide.add')"
        :disabled="!editable"
        @click="emit('add')"
      >
        <i class="i-jannchie-plus h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="slides-icon-button"
        :title="t('deck.slide.duplicate')"
        :aria-label="t('deck.slide.duplicate')"
        :disabled="!editable"
        @click="emit('duplicate', slideIndex)"
      >
        <i class="i-jannchie-copy h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        class="slides-icon-button"
        :title="deck.slides[slideIndex]?.hidden ? t('deck.slide.show') : t('deck.slide.hide')"
        :aria-label="deck.slides[slideIndex]?.hidden ? t('deck.slide.show') : t('deck.slide.hide')"
        :disabled="!editable"
        @click="emit('toggleHidden', slideIndex)"
      >
        <i
          :class="deck.slides[slideIndex]?.hidden ? 'i-jannchie-eye' : 'i-jannchie-eye-off'"
          class="h-4 w-4"
          aria-hidden="true"
        />
      </button>
      <span class="flex-1" />
      <button
        type="button"
        class="slides-icon-button"
        :title="t('deck.slide.delete')"
        :aria-label="t('deck.slide.delete')"
        :disabled="!editable || deck.slides.length <= 1"
        @click="emit('remove', slideIndex)"
      >
        <i class="i-jannchie-trash h-4 w-4" aria-hidden="true" />
      </button>
    </div>

    <!-- The padding is on the list, not the scroll container; see `scroll-list`. -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <ol ref="list" class="m-0 flex list-none flex-col gap-1.5 p-2" @dragover.prevent @drop="onDrop">
        <li
          v-for="(item, index) in deck.slides"
          :key="item.id"
          class="relative"
          :draggable="editable"
          @dragstart="onDragStart($event, index)"
          @dragover="onDragOver($event, index)"
          @dragend="
            () => {
              dragging = undefined
              dropAt = undefined
            }
          "
        >
          <span
            v-if="dropAt === index"
            class="absolute -top-1 left-4 right-0 h-0.5 rounded bg-slides-selection"
            aria-hidden="true"
          />
          <span
            v-if="dropAt === index + 1 && index === deck.slides.length - 1"
            class="absolute -bottom-1 left-4 right-0 h-0.5 rounded bg-slides-selection"
            aria-hidden="true"
          />
          <button
            type="button"
            class="w-full flex gap-1.5 rounded-md text-left slides-focus"
            :data-slide-index="index"
            :aria-current="index === slideIndex ? 'true' : undefined"
            :aria-label="`${index + 1}. ${deckSlideTitle(item) || t('deck.slide.untitled')}`"
            @click="emit('pick', index)"
            @contextmenu.prevent="
              (event: MouseEvent) => {
                emit('pick', index)
                emit('menu', index, { x: event.clientX, y: event.clientY })
              }
            "
            @keydown="onKeydown($event, index)"
          >
            <span class="w-4 shrink-0 pt-0.5 text-right text-[0.65rem] slides-muted slides-num">{{
              index + 1
            }}</span>
            <span
              class="relative block shrink-0 overflow-hidden rounded-sm bg-white ring-1"
              :class="[
                index === slideIndex ? 'ring-2 ring-slides-selection' : 'ring-slides-line',
                { 'opacity-45': item.hidden },
              ]"
              :style="{ width: `${THUMB_WIDTH}px`, height: `${THUMB_WIDTH * (9 / 16)}px` }"
              aria-hidden="true"
            >
              <span
                class="pointer-events-none absolute left-0 top-0 block origin-top-left"
                :style="{ transform: `scale(${thumbScale})` }"
              >
                <DeckSlideView
                  :slide="item"
                  :deck-style="deck.style"
                  :theme="deck.theme"
                  :resolve-asset="resolveAsset"
                />
              </span>
              <i
                v-if="item.hidden"
                class="i-jannchie-eye-off absolute bottom-1 right-1 h-3.5 w-3.5 slides-muted"
              />
            </span>
          </button>
        </li>
      </ol>
    </div>
  </nav>
</template>
