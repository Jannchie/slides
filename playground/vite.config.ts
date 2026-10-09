import { fileURLToPath } from "node:url"

import vue from "@vitejs/plugin-vue"
import unocss from "unocss/vite"
import { defineConfig } from "vite"

const repository = fileURLToPath(new URL("..", import.meta.url))

// The page `pnpm dev` serves: the editor straight from `src/`, so a change to
// it is on screen as soon as it is saved. 3325 spells DECK on a phone keypad,
// and is strict, so a second checkout running says so rather than drifting to
// whatever port is free.
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [unocss({ configFile: `${repository}/uno.config.ts` }), vue()],
  server: {
    port: 3325,
    strictPort: true,
    fs: { allow: [repository] },
  },
})
