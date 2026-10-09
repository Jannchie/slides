# @jannchie/slides

Slide decks as constrained HTML, and an editor for them.

A deck is one HTML document: one `<section>` per slide on a 1920×1080 canvas, every style inline and drawn from a closed subset of CSS. A model writes it as fluently as any HTML; the subset is what lets the same source be a web page, an editable canvas, a PowerPoint file and a PDF without four renderers disagreeing. See [docs/format.md](docs/format.md).

```sh
pnpm add @jannchie/slides
```

## Reading and writing a deck

Runs anywhere, server included. No framework, no DOM.

```ts
import { readDeck, writeDeck } from "@jannchie/slides"

const { deck, diagnostics } = readDeck(source) // anything outside the subset is dropped, and said so
const normalized = writeDeck(deck) // the same tree always writes the same text
```

`@jannchie/slides/dom` is the half that needs a document: measuring laid-out boxes, loading a deck's fonts, reading and writing a `contenteditable` run.

## The editor

A canvas with selection and transforms, an inspector, a slide list, speaker notes, a presenter with a speaker console, and PPTX export. Written in Vue, usable three ways:

```ts
// A Vue app
import { DeckEditor } from "@jannchie/slides/vue"

// Any page
import { mountDeckEditor } from "@jannchie/slides/editor"
const editor = mountDeckEditor(element, { source, assets, locale: "ja", onChange: () => save(editor.write()) })

// A React app
import { DeckEditor } from "@jannchie/slides/react"
<DeckEditor ref={ref} source={source} assets={assets} locale="ja" onChange={() => save(ref.current!.write())} />
```

| option | |
| --- | --- |
| `source` | The deck's HTML. A new value is taken in place, as the next version: the reader stays on the same slide. |
| `assets` | `{ url(src), upload(file) }`. A deck names its own files `assets/<name>`. `url` says where the browser fetches one; `upload` stores a picture or font file and answers with the `src` to name it by. The editor never uploads an SVG: it rasterizes it to a PNG first. |
| `editable` | Defaults to `true`. A read-only editor still pages and presents. |
| `locale` | A language tag. The editor ships English, Japanese and Simplified Chinese; anything else reads as English. |
| `onChange` | The reader changed the deck. `write()` returns its text, which is exactly `source` while nothing has changed. |

Saving, versions and conflicts belong to the host.

The editor speaks its own status to screen readers, and its presenter is a real modal (`aria-modal="true"`, everything outside it `inert`). A host whose keyboard shortcuts should wait while a modal is open can ask the document for one.

## Styles

Load `@jannchie/slides/style.css`, or, in a host that runs UnoCSS, spread `deckEditorShortcuts`, `deckEditorColors` and `deckEditorPreflights` from `@jannchie/slides/uno` into its config, pass `deckEditorIcons` to `presetIcons` (which needs `@jannchie/iconify-json`), and scan `node_modules/@jannchie/slides/dist/*.js` for the editor's classes.

Overriding it is meant to be easy, at three depths:

```css
/* 1. Tokens: every colour, radius, face and size the editor draws with. */
.slides-editor {
  --slides-accent: #7c3aed;
  --slides-radius: 4px;
  --slides-control-height: 32px;
  --slides-font-sans: "IBM Plex Sans", sans-serif;
}
[data-scheme="dark"] .slides-editor {
  --slides-bg: #0b1020;
}

/* 2. Parts: each kind of control and each region has a class of its own. */
.slides-inspector-label { text-transform: uppercase; }

/* 3. Anything: the built sheet is in `@layer slides`, so a rule outside a layer wins. */
.slides-toolbar button { color: hotpink; }
```

| tokens | |
| --- | --- |
| colours | `--slides-bg` `--slides-panel` `--slides-sunken` `--slides-field` `--slides-stage` `--slides-line` `--slides-line-strong` `--slides-text` `--slides-text-2` `--slides-muted` `--slides-accent` `--slides-hover` `--slides-pressed` `--slides-focus` `--slides-selection` `--slides-warning` `--slides-danger` |
| shape | `--slides-radius` `--slides-radius-lg` `--slides-control-height` `--slides-shadow` |
| type | `--slides-font-sans` `--slides-font-mono` `--slides-font-size` |

| parts | |
| --- | --- |
| regions | `slides-editor` (the root, the presenter and every menu) `slides-toolbar` `slides-slide-list` `slides-stage-area` `slides-notes` `slides-inspector` `slides-context-menu` |
| controls | `slides-field` `slides-field-box` `slides-number-field` `slides-color-field` `slides-button` `slides-icon-button` `slides-tool` `slides-segmented` `slides-segment` `slides-segment-on` `slides-popover` `slides-menu-item` `slides-label` |
| format pane | `slides-inspector-section` `slides-inspector-heading` `slides-inspector-row` `slides-inspector-label` `slides-inspector-controls` |

The defaults sit inside `:where()`, so they weigh nothing, and the reset that comes with them touches only the editor's own boxes. Dark mode follows `data-scheme="dark"` on the editor's box or any ancestor of it.

## What is left as an import

`vue`, `@floating-ui/vue`, `@vueuse/core` and `pptxgenjs` are dependencies rather than bundled, so a Vue host and the editor share one Vue. `react` is an optional peer, needed only by `./react`. `pptxgenjs` loads only when an export is asked for.

## Development

```sh
pnpm install
pnpm test        # vitest
pnpm typecheck   # vue-tsc
pnpm build       # dist/, with declarations under dist/types
pnpm icons       # regenerate src/deck-icons.ts from @jannchie/iconify-json
```

Inside this repository the package's exports point at `src/`, so a host linked to a local checkout (`pnpm link`) runs the source; `publishConfig.exports` swaps in `dist/` when it is packed.

## License

MIT
