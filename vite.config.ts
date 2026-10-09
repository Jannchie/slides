import vue from "@vitejs/plugin-vue"
import unocss from "unocss/vite"
import { defineConfig } from "vite"

// What is published (`pnpm build` → `dist/`): one module per entry, plus the
// editor's stylesheet for a host that does not run UnoCSS itself. Everything a
// host installs stays an import, so a Vue host and the editor share one Vue.
export default defineConfig({
  plugins: [unocss(), vue()],
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
      ],
    },
  },
})
