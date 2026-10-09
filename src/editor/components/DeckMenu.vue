<script setup lang="ts">
import { nextTick, ref } from "vue"

import { useFloatingHost } from "../support/dialog-focus"
import { useFloatingPanel } from "../support/floating-panel"

/**
 * A toolbar button that opens a panel of its own: the shapes to insert, the
 * icons, the ways to arrange a selection. The panel is the caller's slot,
 * handed `close` so a choice can shut it.
 *
 * A press on the button does not take the focus from the slide: the stage's
 * selection, and a caret in text being typed, stay where they were while the
 * panel is used.
 */
const props = withDefaults(
  defineProps<{
    icon: string
    label: string
    disabled?: boolean
    /** Show the label beside the icon, for a menu whose icon alone says too little. */
    showLabel?: boolean
    placement?: "bottom-start" | "bottom-end"
  }>(),
  { disabled: false, showLabel: false, placement: "bottom-start" },
)

const open = ref(false)
const { reference, floating, floatingStyles } = useFloatingPanel({
  open,
  placement: () => props.placement,
  width: "min",
})
const floatingHost = useFloatingHost()

async function toggle() {
  open.value = !open.value

  if (open.value) {
    await nextTick()
    floating.value?.querySelector<HTMLElement>("button, input")?.focus({ preventScroll: true })
  }
}

function close() {
  open.value = false
}

/** A press in the panel leaves the focus where it was, unless it is on a field to type into. */
function keepFocus(event: MouseEvent) {
  if (!(event.target as HTMLElement).closest("input, textarea, select")) {
    event.preventDefault()
  }
}
</script>

<template>
  <div ref="reference" class="inline-flex" @keydown.esc.stop="close">
    <button
      type="button"
      class="slides-tool"
      :class="{ 'slides-pressed': open }"
      :title="label"
      :aria-label="label"
      aria-haspopup="true"
      :aria-expanded="open"
      :disabled="disabled"
      @mousedown.prevent
      @click="toggle"
    >
      <i :class="icon" class="h-4 w-4" aria-hidden="true" />
      <span v-if="showLabel">{{ label }}</span>
      <i class="i-jannchie-chevron-down h-3 w-3 slides-muted" aria-hidden="true" />
    </button>
    <Teleport :to="floatingHost">
      <div
        v-if="open"
        ref="floating"
        class="slides-editor slides-popover max-h-[var(--floating-max-height)] overflow-y-auto"
        :style="floatingStyles"
        @mousedown="keepFocus"
      >
        <slot :close="close" />
      </div>
    </Teleport>
  </div>
</template>
