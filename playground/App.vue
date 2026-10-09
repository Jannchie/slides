<script setup lang="ts">
import { usePreferredDark } from "@vueuse/core"
import { computed, onBeforeUnmount, ref, watch } from "vue"

import { DeckEditor, type DeckAssetStore } from "../src/editor/vue"
import sample from "./sample-deck.html?raw"

/**
 * A host for working on the editor: what an application around it would hold
 * — the deck's text, where its pictures live, the reader's language and
 * scheme — kept as small as it can be.
 *
 * The deck and the controls are kept in `localStorage`, so a reload while
 * working on the editor comes back to where it was. Pictures are object URLs
 * and do not survive a reload: a playground has no server to keep them.
 */
const DECK_KEY = "slides-playground:deck"
const PREFERENCES_KEY = "slides-playground:preferences"

function stored(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) {
      localStorage.removeItem(key)
    } else {
      localStorage.setItem(key, value)
    }
  } catch {
    // A private window: what is here lasts as long as the page.
  }
}

type Theme = "system" | "light" | "dark"
type Preferences = { locale: string; theme: Theme; editable: boolean; showSource: boolean }

function storedPreferences(): Preferences {
  const fallback: Preferences = { locale: "en", theme: "system", editable: true, showSource: false }

  try {
    return { ...fallback, ...JSON.parse(stored(PREFERENCES_KEY) ?? "{}") }
  } catch {
    return fallback
  }
}

const preferences = ref(storedPreferences())

watch(preferences, (value) => store(PREFERENCES_KEY, JSON.stringify(value)), { deep: true })

const LOCALES = [
  { tag: "en", label: "EN" },
  { tag: "zh-CN", label: "中文" },
  { tag: "ja", label: "日本語" },
]
const THEMES: { theme: Theme; icon: string; label: string }[] = [
  { theme: "system", icon: "i-jannchie-monitor", label: "System" },
  { theme: "light", icon: "i-jannchie-sun", label: "Light" },
  { theme: "dark", icon: "i-jannchie-moon", label: "Dark" },
]

const prefersDark = usePreferredDark()
const scheme = computed(() =>
  preferences.value.theme === "system" ? (prefersDark.value ? "dark" : "light") : preferences.value.theme,
)

// The editor reads its scheme off an ancestor's `data-scheme`; the page's own
// tokens hang off the same attribute.
watch(scheme, (value) => (document.documentElement.dataset.scheme = value), { immediate: true })

const source = ref(stored(DECK_KEY) ?? sample)
const written = ref(source.value)
const editor = ref<InstanceType<typeof DeckEditor> | null>(null)

const files = new Map<string, string>()
let uploaded = 0

const assets: DeckAssetStore = {
  url: (src) => files.get(src) ?? src,
  async upload(file) {
    const extension = file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "bin"
    const src = `assets/${++uploaded}.${extension}`

    files.set(src, URL.createObjectURL(file))
    return src
  },
}

onBeforeUnmount(() => files.forEach((url) => URL.revokeObjectURL(url)))

function onChange() {
  written.value = editor.value?.write() ?? source.value
  store(DECK_KEY, written.value)
}

function reset() {
  store(DECK_KEY, null)
  source.value = sample
  written.value = sample
}
</script>

<template>
  <div class="playground">
    <header class="top">
      <div class="brand">
        <i class="i-jannchie-presentation mark" aria-hidden="true" />
        <span>Slides</span>
        <span class="version">playground</span>
      </div>

      <div class="opts">
        <div class="opt">
          <span class="label">Language</span>
          <div class="segmented" role="group" aria-label="Language">
            <button
              v-for="locale in LOCALES"
              :key="locale.tag"
              type="button"
              :aria-pressed="preferences.locale === locale.tag"
              @click="preferences.locale = locale.tag"
            >
              {{ locale.label }}
            </button>
          </div>
        </div>

        <div class="opt">
          <span class="label">Theme</span>
          <div class="segmented" role="group" aria-label="Theme">
            <button
              v-for="option in THEMES"
              :key="option.theme"
              type="button"
              :aria-pressed="preferences.theme === option.theme"
              :aria-label="option.label"
              :title="option.label"
              @click="preferences.theme = option.theme"
            >
              <i :class="option.icon" class="icon" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div class="opt">
          <span class="label">Mode</span>
          <div class="segmented" role="group" aria-label="Mode">
            <button type="button" :aria-pressed="preferences.editable" @click="preferences.editable = true">
              <i class="i-jannchie-edit icon" aria-hidden="true" /> Edit
            </button>
            <button type="button" :aria-pressed="!preferences.editable" @click="preferences.editable = false">
              <i class="i-jannchie-eye icon" aria-hidden="true" /> Read
            </button>
          </div>
        </div>

        <div class="opt end">
          <button
            type="button"
            class="ghost"
            :aria-pressed="preferences.showSource"
            @click="preferences.showSource = !preferences.showSource"
          >
            <i class="i-jannchie-code icon" aria-hidden="true" /> HTML
          </button>
          <button type="button" class="ghost" @click="reset">
            <i class="i-jannchie-reset icon" aria-hidden="true" /> Reset
          </button>
          <a class="ghost" href="https://github.com/jannchie/slides" target="_blank" rel="noreferrer">
            <i class="i-jannchie-github icon" aria-hidden="true" />
            <span class="sr-only">GitHub</span>
          </a>
        </div>
      </div>
    </header>

    <main class="body">
      <DeckEditor
        ref="editor"
        class="editor"
        :source="source"
        :editable="preferences.editable"
        :assets="assets"
        :locale="preferences.locale"
        @change="onChange"
      />
      <aside v-if="preferences.showSource" class="source">
        <p class="label source-head">write()</p>
        <pre>{{ written }}</pre>
      </aside>
    </main>
  </div>
</template>

<style scoped>
.playground {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.top {
  position: sticky;
  top: 0;
  z-index: 3;
  display: grid;
  grid-template-columns: 220px minmax(0, 1fr);
  height: 49px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--surface) 85%, transparent);
  backdrop-filter: blur(14px) saturate(1.4);
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 20px;
  border-right: 1px solid var(--line);
  font-weight: 600;
  letter-spacing: -0.01em;
  white-space: nowrap;
}

.mark {
  width: 20px;
  height: 20px;
  flex: none;
}

.version {
  color: var(--muted);
  font: 12px/1 var(--mono);
  font-weight: 400;
}

.label {
  margin: 0;
  font: 12px/1.4 var(--mono);
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--muted);
}

/* A row of settings that slides sideways rather than wrapping. */
.opts {
  display: flex;
  align-items: stretch;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
}

.opt {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  border-right: 1px solid var(--line);
  white-space: nowrap;
}

.opt.end {
  gap: 4px;
  margin-left: auto;
  border-right: 0;
  border-left: 1px solid var(--line);
}

/* One hairline round the group; the pressed one is a wash of ink, not a fill. */
.segmented {
  display: flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--line);
  border-radius: 8px;
}

.segmented button,
.ghost {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 26px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: var(--text-2);
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
}

.ghost {
  height: 30px;
}

.segmented button:hover,
.ghost:hover {
  color: var(--text);
}

.segmented button[aria-pressed="true"],
.ghost[aria-pressed="true"] {
  background: var(--accent-soft);
  color: var(--text);
}

.segmented button:focus-visible,
.ghost:focus-visible {
  outline: 2px solid var(--text);
  outline-offset: 1px;
}

.icon {
  width: 16px;
  height: 16px;
  flex: none;
}

.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.body {
  display: flex;
  flex: 1;
  min-height: 0;
}

.editor {
  flex: 1;
  min-width: 0;
}

.source {
  display: flex;
  flex-direction: column;
  width: min(40%, 560px);
  border-left: 1px solid var(--line);
  background: var(--sunken);
}

.source-head {
  padding: 12px 16px;
  border-bottom: 1px solid var(--line);
  text-transform: none;
}

.source pre {
  flex: 1;
  margin: 0;
  padding: 16px;
  overflow: auto;
  font: 12px/1.6 var(--mono);
  color: var(--text-2);
  scrollbar-width: thin;
  scrollbar-color: var(--line-strong) transparent;
}
</style>
