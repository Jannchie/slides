<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from "vue"

/** A row of the menu, or a line between groups of rows. */
export type DeckMenuEntry =
  | {
      label: string
      icon?: string
      /** The keys that do the same, as the reader's platform spells them. */
      keys?: string
      disabled?: boolean
      /** Takes something away: drawn in the danger ink. */
      danger?: boolean
      run: () => void
    }
  | "separator"

/**
 * The menu a right click opens: the things that can be done to what was
 * clicked, each with the keys that do it, so the menu also teaches them.
 *
 * Opened at the pointer and kept inside the window. Arrow keys move through
 * it, Enter runs a row, and Escape, a click elsewhere, a scroll or the window
 * losing focus close it.
 */
const props = defineProps<{
  x: number
  y: number
  entries: readonly DeckMenuEntry[]
  label: string
  /** The scheme of the editor it opened from, which a menu teleported to `<body>` cannot inherit. */
  scheme?: string
}>()

const emit = defineEmits<{ close: [] }>()

const menu = ref<HTMLElement | null>(null)
const position = ref({ left: props.x, top: props.y })

function rows() {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? [])]
}

function move(by: number) {
  const all = rows()
  const at = all.indexOf(document.activeElement as HTMLButtonElement)

  all[(at + by + all.length) % all.length]?.focus()
}

function onKeydown(event: KeyboardEvent) {
  const actions: Record<string, () => void> = {
    ArrowDown: () => move(1),
    ArrowUp: () => move(-1),
    Home: () => rows()[0]?.focus(),
    End: () => rows().at(-1)?.focus(),
    Escape: () => emit("close"),
    Tab: () => emit("close"),
  }
  const action = actions[event.key]

  if (action !== undefined) {
    event.preventDefault()
    event.stopPropagation()
    action()
  }
}

function run(entry: Exclude<DeckMenuEntry, "separator">) {
  emit("close")
  entry.run()
}

function onOutside(event: Event) {
  if (!menu.value?.contains(event.target as Node)) {
    emit("close")
  }
}

const close = () => emit("close")

onMounted(async () => {
  await nextTick()

  const box = menu.value?.getBoundingClientRect()

  if (box !== undefined) {
    // Kept inside the window: flipped to the other side of the pointer when it would run off an edge.
    position.value = {
      left: props.x + box.width > window.innerWidth - 8 ? Math.max(8, props.x - box.width) : props.x,
      top: props.y + box.height > window.innerHeight - 8 ? Math.max(8, props.y - box.height) : props.y,
    }
  }

  rows()[0]?.focus()
  document.addEventListener("pointerdown", onOutside, true)
  document.addEventListener("contextmenu", onOutside, true)
  window.addEventListener("blur", close)
  window.addEventListener("resize", close)
  window.addEventListener("scroll", close, true)
})

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", onOutside, true)
  document.removeEventListener("contextmenu", onOutside, true)
  window.removeEventListener("blur", close)
  window.removeEventListener("resize", close)
  window.removeEventListener("scroll", close, true)
})
</script>

<template>
  <Teleport to="body">
    <div
      ref="menu"
      class="slides-editor slides-popover slides-context-menu fixed min-w-52 py-1"
      role="menu"
      :aria-label="label"
      :data-scheme="scheme"
      :style="{ left: `${position.left}px`, top: `${position.top}px` }"
      @keydown="onKeydown"
      @contextmenu.prevent
    >
      <template v-for="(entry, index) in entries" :key="index">
        <hr v-if="entry === 'separator'" class="mx-1 my-1 border-t border-slides-line" />
        <button
          v-else
          type="button"
          role="menuitem"
          class="slides-menu-item"
          :class="{ '!text-slides-danger': entry.danger }"
          :disabled="entry.disabled"
          @click="run(entry)"
        >
          <i v-if="entry.icon" :class="entry.icon" class="h-4 w-4 shrink-0 opacity-80" aria-hidden="true" />
          <span v-else class="w-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate">{{ entry.label }}</span>
          <kbd v-if="entry.keys" class="shrink-0 pl-4 slides-muted slides-num text-[11px]">{{
            entry.keys
          }}</kbd>
        </button>
      </template>
    </div>
  </Teleport>
</template>
