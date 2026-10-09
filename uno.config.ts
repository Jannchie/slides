import presetIcons from "@unocss/preset-icons"
import { defineConfig, presetWind4 } from "unocss"

import { deckEditorColors, deckEditorIcons, deckEditorShortcuts } from "./src/editor/uno"

// The stylesheet the package builds for a host that does not run UnoCSS
// itself (`dist/style.css`). A host that does spreads the same shortcuts and
// colours from `@jannchie/slides/uno` into its own config and builds the
// editor's classes along with the rest of its page.
export default defineConfig({
  content: {
    pipeline: {
      // Templates and plain modules both: `mountDeckEditor` names its classes
      // in a render function, which the default pipeline does not scan. Only
      // the editor's: the format's modules are full of CSS words that are not
      // classes.
      include: [/\.vue($|\?)/, /\/src\/editor\/.+\.[jt]sx?($|\?)/],
    },
  },
  theme: {
    colors: deckEditorColors,
    font: { num: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" },
  },
  shortcuts: deckEditorShortcuts,
  presets: [
    presetWind4({
      // Dark is said the way the web app says it, on an ancestor: a host
      // sets `data-scheme="dark"` on the editor's box or anywhere above it.
      dark: { dark: '[data-scheme="dark"]', light: '[data-scheme="light"]' },
      // The host's page keeps its own reset; the editor brings only its classes.
      preflights: { reset: false },
    }),
    presetIcons(deckEditorIcons),
  ],
})
