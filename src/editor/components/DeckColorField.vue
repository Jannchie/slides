<script setup lang="ts">
import { computed } from "vue"

import { isColor } from "../../index"

import { t } from "../i18n"

/**
 * A colour as a slide holds one: a swatch to pick from, the value written out
 * to type any colour the subset takes (`#hex`, `rgb()`, a name), and a way to
 * clear it. Mixed, across a selection, it shows nothing and changes all.
 */
const props = defineProps<{
  value: string | undefined
  label: string
  disabled?: boolean
  /** Offer to clear the colour, for a fill that may be none. */
  clearable?: boolean
}>()

const emit = defineEmits<{ change: [value: string | undefined]; done: [] }>()

/** The swatch needs six-digit hex; anything else shows as the nearest it can. */
const swatch = computed(() => {
  const value = props.value?.trim().toLowerCase() ?? ""

  if (/^#[0-9a-f]{6}$/.test(value)) {
    return value
  }

  if (/^#[0-9a-f]{3}$/.test(value)) {
    return `#${value
      .slice(1)
      .split("")
      .map((digit) => digit + digit)
      .join("")}`
  }

  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(value)

  if (rgb !== null) {
    return `#${rgb
      .slice(1, 4)
      .map((part) => Math.min(255, Number(part)).toString(16).padStart(2, "0"))
      .join("")}`
  }

  return "#000000"
})

function onText(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim()

  if (value === "") {
    emit("change", undefined)
  } else if (isColor(value)) {
    emit("change", value)
  }
}
</script>

<template>
  <div class="flex items-center gap-1">
    <label
      class="relative h-6 w-6 shrink-0 overflow-hidden rounded-md ring-1 ring-black/15 dark:ring-white/15"
      :class="{ 'opacity-40': disabled }"
      :style="{ background: value ?? 'transparent' }"
      :title="label"
    >
      <span
        v-if="!value"
        class="absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,#ef4444_45%,#ef4444_55%,transparent_55%)]"
        aria-hidden="true"
      />
      <input
        type="color"
        class="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        :value="swatch"
        :disabled="disabled"
        :aria-label="label"
        @input="emit('change', ($event.target as HTMLInputElement).value)"
        @change="emit('done')"
      />
    </label>
    <input
      class="field min-w-0 flex-1 !px-1.5 !py-0.5 !text-xs num"
      :value="value ?? ''"
      :placeholder="t('deck.mixed')"
      :disabled="disabled"
      :aria-label="label"
      spellcheck="false"
      @change="onText"
    />
    <button
      v-if="clearable"
      type="button"
      class="h-6 w-6 flex shrink-0 items-center justify-center rounded-md ink-soft surface-hover kbd-ring disabled:opacity-35"
      :title="t('deck.noFill')"
      :aria-label="t('deck.noFill')"
      :disabled="disabled || !value"
      @click="
        () => {
          emit('change', undefined)
          emit('done')
        }
      "
    >
      <i class="i-jannchie-x h-3.5 w-3.5" aria-hidden="true" />
    </button>
  </div>
</template>
