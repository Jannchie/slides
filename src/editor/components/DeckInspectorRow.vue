<script setup lang="ts">
/**
 * One row of the format pane: what it sets, then the controls that set it.
 * Every row has the label column, so the controls of a section start on one
 * line whatever their labels say.
 */
defineProps<{ label?: string }>()
</script>

<template>
  <div class="slides-inspector-row">
    <span class="slides-inspector-label" :title="label">{{ label }}</span>
    <div class="slides-inspector-controls">
      <slot />
    </div>
  </div>
</template>
