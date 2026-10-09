import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import vue from "@vitejs/plugin-vue"
import unocss from "unocss/vite"
import { defineConfig, type Plugin } from "vite"

/**
 * The built sheet touches the editor's boxes and nothing else. UnoCSS writes
 * its theme variables on `:root` and its property fallbacks on `*`: on a host
 * page those would set `--spacing` or `--radius-md` for the whole page, and a
 * host whose own design system uses those names would find them changed by
 * opening a deck. Both are moved onto `.slides-editor`, which the editor's
 * root, its presenter and every menu it teleports out all carry.
 */
function ownRootOnly(): Plugin {
  return {
    name: "slides-own-root-only",
    // After the files are written: the stylesheet is assembled by Vite's own
    // CSS plugin, after every other plugin has seen the bundle.
    writeBundle(options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== "asset" || !file.fileName.endsWith(".css")) {
          continue
        }

        const path = join(options.dir ?? "dist", file.fileName)

        writeFileSync(
          path,
          readFileSync(path, "utf8")
            .replaceAll(":root,:host{", ".slides-editor{")
            .replaceAll(
              "*,:before,:after,::backdrop{",
              ".slides-editor,.slides-editor *,.slides-editor :before,.slides-editor :after{",
            ),
        )
      }
    },
  }
}

// What is published (`pnpm build` → `dist/`): one module per entry, plus the
// editor's stylesheet for a host that does not run UnoCSS itself. Everything a
// host installs stays an import, so a Vue host and the editor share one Vue.
export default defineConfig({
  plugins: [unocss(), vue(), ownRootOnly()],
  build: {
    lib: {
      entry: {
        index: "src/index.ts",
        dom: "src/dom.ts",
        editor: "src/editor/index.ts",
        vue: "src/editor/vue.ts",
        react: "src/editor/react.tsx",
        pptx: "src/editor/pptx.ts",
        uno: "src/editor/uno.ts",
        style: "src/editor/style.ts",
      },
      formats: ["es"],
      cssFileName: "style",
    },
    // One stylesheet for the whole editor, whichever entry a host loads.
    cssCodeSplit: false,
    rollupOptions: {
      external: [
        /^vue$/,
        /^react($|\/)/,
        /^pptxgenjs$/,
        /^@floating-ui\//,
        /^@vueuse\//,
        /^@jannchie\/iconify-json($|\/)/,
        // `./uno` runs in a UnoCSS config, in Node.
        /^node:/,
      ],
    },
  },
})
