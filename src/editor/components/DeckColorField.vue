<script setup lang="ts">
import { computed, nextTick, ref } from "vue"

import {
  DECK_THEME_ROLES,
  isColor,
  resolveDeckColor,
  themeRoleOf,
  type DeckTheme,
  type DeckThemeRole,
} from "../../index"

import { t } from "../i18n"
import { useFloatingHost } from "../support/dialog-focus"
import { useFloatingPanel } from "../support/floating-panel"

/**
 * A colour as a slide holds one: a swatch to pick from, the value written out
 * to type any colour the subset takes (`#hex`, `rgb()`, a name), and a way to
 * clear it. Mixed, across a selection, it shows nothing and changes all.
 *
 * With the deck's theme it also offers the theme's colours, by role. Picking
 * one writes a reference (`var(--accent)`), which follows the theme when the
 * deck's theme changes; the field then says the role's name, and its swatch
 * shows the colour the role is in this theme.
 */
const props = defineProps<{
  value: string | undefined
  label: string
  disabled?: boolean
  /** Offer to clear the colour, for a fill that may be none. */
  clearable?: boolean
  /** What the field says when there is no value. */
  placeholder?: string
  /** The deck's theme: its colours are offered, and a reference to one is drawn as it. */
  theme?: DeckTheme
}>()

const emit = defineEmits<{ change: [value: string | undefined]; done: [] }>()

const role = computed(() => themeRoleOf(props.value))
const roleName = (name: DeckThemeRole) => t(`deck.role.${name}`)

/** What the colour is, drawn: a role resolved through the theme. */
const drawn = computed(() =>
  props.value === undefined || props.theme === undefined
    ? props.value
    : resolveDeckColor(props.value, props.theme),
)

/** The swatch needs six-digit hex; anything else shows as the nearest it can. */
const swatch = computed(() => {
  const value = drawn.value?.trim().toLowerCase() ?? ""

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

/** What the text says: a role by its name, any other colour as written. */
const text = computed(() => (role.value === undefined ? (props.value ?? "") : roleName(role.value)))

function onText(event: Event) {
  const value = (event.target as HTMLInputElement).value.trim()

  if (value === text.value) {
    return
  }

  // A role typed by its name is the role.
  const named = DECK_THEME_ROLES.find((candidate) => roleName(candidate) === value)

  if (value === "") {
    emit("change", undefined)
  } else if (named !== undefined) {
    emit("change", `var(--${named})`)
  } else if (isColor(value)) {
    emit("change", value)
  }
}

// ── the theme's colours ─────────────────────────────────────────────────

const open = ref(false)
const { reference, floating, floatingStyles } = useFloatingPanel({
  open,
  placement: "bottom-end",
  width: "min",
})
const floatingHost = useFloatingHost()

async function toggle() {
  open.value = !open.value

  if (open.value) {
    await nextTick()
    floating.value?.querySelector<HTMLElement>("[aria-pressed=true], button")?.focus()
  }
}

function pick(name: DeckThemeRole) {
  emit("change", `var(--${name})`)
  emit("done")
  open.value = false
}
</script>

<template>
  <div
    ref="reference"
    class="slides-field-box slides-color-field min-w-0 flex-1 !pl-1"
    :class="{ 'opacity-50': disabled }"
  >
    <label
      class="relative h-5 w-5 shrink-0 overflow-hidden rounded-[calc(var(--slides-radius)-2px)] ring-1 ring-slides-line-strong ring-inset"
      :style="{ background: drawn ?? 'transparent' }"
      :title="label"
    >
      <span
        v-if="!value"
        class="absolute inset-0 bg-[linear-gradient(135deg,transparent_45%,var(--slides-danger)_45%,var(--slides-danger)_55%,transparent_55%)]"
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
      class="h-full min-w-0 flex-1 bg-transparent outline-none"
      :class="{ 'slides-num': role === undefined }"
      :value="text"
      :placeholder="placeholder ?? t('deck.mixed')"
      :disabled="disabled"
      :aria-label="label"
      spellcheck="false"
      @change="onText"
    />
    <button
      v-if="theme"
      type="button"
      class="h-5 w-5 flex shrink-0 items-center justify-center rounded slides-muted slides-hover slides-focus"
      :class="{ '!text-slides-text': role !== undefined || open }"
      :title="t('deck.field.themeColors')"
      :aria-label="t('deck.field.themeColors')"
      :aria-expanded="open"
      :disabled="disabled"
      @click="toggle"
    >
      <i class="i-jannchie-palette h-3.5 w-3.5" aria-hidden="true" />
    </button>
    <button
      v-if="clearable"
      type="button"
      class="-mr-1 h-5 w-5 flex shrink-0 items-center justify-center rounded slides-muted slides-hover slides-focus disabled:opacity-0"
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
    <Teleport v-if="theme" :to="floatingHost">
      <div
        v-if="open"
        ref="floating"
        class="slides-editor slides-popover min-w-44"
        role="group"
        :aria-label="t('deck.field.themeColors')"
        :style="floatingStyles"
        @keydown.esc.stop="open = false"
      >
        <p class="px-2 pb-1 pt-0.5 slides-label">{{ t("deck.field.themeColors") }}</p>
        <button
          v-for="name in DECK_THEME_ROLES"
          :key="name"
          type="button"
          class="slides-menu-item"
          :aria-pressed="role === name"
          @click="pick(name)"
        >
          <span
            class="h-4 w-4 shrink-0 rounded-[3px] ring-1 ring-slides-line-strong ring-inset"
            :style="{ background: theme.colors[name] }"
            aria-hidden="true"
          />
          <span class="min-w-0 flex-1 truncate">{{ roleName(name) }}</span>
          <i v-if="role === name" class="i-jannchie-check h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        </button>
      </div>
    </Teleport>
  </div>
</template>
