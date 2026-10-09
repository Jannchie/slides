<script setup lang="ts">
import { computed, ref } from "vue"

import { findDeckTheme, patchStyle, type Deck } from "../../index"
import { firstFamily } from "../../dom"

import { fontName, fontOptionsOf, googleFontLink, withFamily } from "../fonts"
import { t } from "../i18n"
import { themeName, useDeckThemes } from "../themes"
import DeckColorField from "./DeckColorField.vue"
import DeckInspectorRow from "./DeckInspectorRow.vue"

/**
 * What is true of the whole deck — its theme, its type, its ink, the faces it
 * loads — set from the toolbar rather than the format pane, the way a
 * presentation program keeps a deck's design apart from the box in hand: the
 * format pane is about what is selected, and the deck is never what is.
 */
const props = defineProps<{ deck: Deck; editable: boolean }>()

const emit = defineEmits<{ commit: [deck: Deck, key: string]; seal: [] }>()

const themes = useDeckThemes()
const theme = computed(() => findDeckTheme(props.deck.theme, themes()))
const fontOptions = computed(() => fontOptionsOf(props.deck))

function setDeck(next: Deck, key: string) {
  if (props.editable) {
    emit("commit", next, `deck:${key}`)
  }
}

/** Draw the deck in another theme: every colour that refers to a role follows. */
function setTheme(id: string) {
  setDeck({ ...props.deck, theme: id }, "theme")
  emit("seal")
}

function setFamily(family: string) {
  const next = withFamily(props.deck, family)

  setDeck(
    { ...next.deck, style: patchStyle("body", next.deck.style, { "font-family": next.family }) },
    "font",
  )
  emit("seal")
}

const newFont = ref("")

function addFont() {
  const family = newFont.value.trim()

  if (family === "" || !/^[A-Za-z][\w ]{0,39}$/.test(family)) {
    return
  }

  setDeck({ ...props.deck, fontLinks: [...props.deck.fontLinks, googleFontLink(family)] }, "fonts")
  emit("seal")
  newFont.value = ""
}

function removeFont(href: string) {
  setDeck(
    { ...props.deck, fontLinks: props.deck.fontLinks.filter((candidate) => candidate !== href) },
    "fonts",
  )
  emit("seal")
}
</script>

<template>
  <div class="slides-design flex w-80 flex-col gap-2 p-2" :inert="!editable">
    <h3 class="slides-label">{{ t("deck.field.theme") }}</h3>
    <div
      class="slides-theme-picker grid grid-cols-3 gap-1.5"
      role="radiogroup"
      :aria-label="t('deck.field.theme')"
    >
      <button
        v-for="option in themes()"
        :key="option.id"
        type="button"
        role="radio"
        class="slides-theme-option min-w-0 flex flex-col gap-1 rounded-[var(--slides-radius)] p-1 text-left slides-focus slides-hover"
        :class="option.id === theme.id ? 'ring-1.5 ring-slides-focus' : ''"
        :aria-checked="option.id === theme.id"
        :title="themeName(option)"
        @click="setTheme(option.id)"
      >
        <span
          class="relative h-12 w-full flex items-end gap-1 overflow-hidden rounded-[calc(var(--slides-radius)-2px)] px-1.5 pb-1.5 ring-1 ring-inset"
          :style="{ background: option.colors.background, '--un-ring-color': option.colors.line }"
          aria-hidden="true"
        >
          <span class="text-base font-semibold leading-none" :style="{ color: option.colors.text }">Aa</span>
          <span class="mb-0.5 h-1 w-4 rounded-full" :style="{ background: option.colors.accent }" />
          <span class="mb-0.5 h-1 w-3 rounded-full" :style="{ background: option.colors.muted }" />
        </span>
        <span class="truncate px-0.5 slides-ink-2">{{ themeName(option) }}</span>
      </button>
    </div>

    <h3 class="mt-1 border-t border-slides-line pt-3 slides-label">{{ t("deck.design.type") }}</h3>
    <DeckInspectorRow :label="t('deck.field.font')">
      <select
        class="slides-field"
        :value="firstFamily(deck.style['font-family']) ?? ''"
        :aria-label="t('deck.field.font')"
        @change="setFamily(($event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>{{ t("deck.field.font") }}</option>
        <option v-for="family in fontOptions" :key="family" :value="firstFamily(family)">
          {{ firstFamily(family) }}
        </option>
      </select>
    </DeckInspectorRow>
    <DeckInspectorRow :label="t('deck.field.color')">
      <DeckColorField
        :theme="theme"
        :value="deck.style.color"
        :placeholder="t('deck.role.text')"
        :label="t('deck.field.color')"
        @change="
          (value) => setDeck({ ...deck, style: patchStyle('body', deck.style, { color: value }) }, 'color')
        "
        @done="emit('seal')"
      />
    </DeckInspectorRow>
    <div class="slides-inspector-row !items-start">
      <span class="slides-inspector-label leading-[var(--slides-control-height)]">{{
        t("deck.field.fonts")
      }}</span>
      <div class="min-w-0 flex flex-col gap-1.5">
        <ul v-if="deck.fontLinks.length > 0" class="flex flex-col">
          <li
            v-for="href in deck.fontLinks"
            :key="href"
            class="h-[var(--slides-control-height)] flex items-center gap-1 rounded-[var(--slides-radius)] pl-2 slides-hover"
          >
            <span class="min-w-0 flex-1 truncate">{{ fontName(href) }}</span>
            <button
              type="button"
              class="slides-icon-button !h-6 !w-6"
              :title="t('deck.removeFont')"
              :aria-label="t('deck.removeFont')"
              @click="removeFont(href)"
            >
              <i class="i-jannchie-x h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        </ul>
        <form class="flex gap-1.5" @submit.prevent="addFont">
          <input
            v-model="newFont"
            class="slides-field min-w-0 flex-1"
            :placeholder="t('deck.field.addFont')"
            :aria-label="t('deck.field.addFont')"
          />
          <button
            type="submit"
            class="slides-button w-[var(--slides-control-height)] !px-0"
            :aria-label="t('deck.field.addFont')"
            :disabled="newFont.trim() === ''"
          >
            <i class="i-jannchie-plus h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </form>
      </div>
    </div>
  </div>
</template>
