<script setup lang="ts">
/**
 * A number in a field the height of every other control: what it is, if a
 * letter or an icon says it shorter than the row's label, then the figure,
 * then its unit. `change` is the input's own event, so a handler reads the
 * value the way it reads any field's.
 */
defineProps<{
  value: string | number | undefined
  label: string
  /** A letter before the figure (X, W), or an icon class. */
  prefix?: string
  unit?: string
  min?: number
  max?: number
  step?: number
  placeholder?: string
}>()

const emit = defineEmits<{ change: [event: Event] }>()
</script>

<template>
  <label class="slides-field-box slides-number-field min-w-0 flex-1" :title="label">
    <template v-if="prefix">
      <i
        v-if="prefix.startsWith('i-')"
        :class="prefix"
        class="h-3.5 w-3.5 shrink-0 slides-muted"
        aria-hidden="true"
      />
      <span v-else class="w-2.5 shrink-0 slides-muted slides-num" aria-hidden="true">{{ prefix }}</span>
    </template>
    <input
      type="number"
      class="h-full min-w-0 w-full flex-1 bg-transparent outline-none slides-num"
      :value="value ?? ''"
      :min="min"
      :max="max"
      :step="step"
      :placeholder="placeholder"
      :aria-label="label"
      @change="emit('change', $event)"
    />
    <span v-if="unit" class="shrink-0 slides-muted slides-num" aria-hidden="true">{{ unit }}</span>
  </label>
</template>
