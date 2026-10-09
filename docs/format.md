# The deck format

A deck is one HTML document:

```html
<!doctype html>
<html>
<head>
<title>Q3 review</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Source+Serif+4:wght@400;600&display=swap">
</head>
<body style="font-family:'Source Serif 4', serif;color:#1a1a1a">
<section id="cover" data-transition="fade" style="background:#fbfbf8;padding:128px;display:flex;flex-direction:column;justify-content:center;gap:32px">
<h1 style="font-size:120px">Q3 review</h1>
<p style="font-size:40px;color:#6a7179">What moved, and why</p>
<aside>Open with the headline number.</aside>
</section>
</body>
</html>
```

- **Canvas**: 1920×1080, in CSS pixels. Every length is px.
- **Slide**: `<section id style data-transition hidden>`. `id` is stable across edits (`[A-Za-z0-9_-]{1,64}`); the editor mints one for a new slide. `<aside>`, the last child, is the speaker notes.
- **Elements**: `h1 h2 h3 p ul ol li br b i u s a span div img table tr th td svg hr x-shape x-icon x-connector`. `svg` is kept as an opaque string and drawn as an image.
- **Styles**: only in `style=""`, only the properties in the subset table (`src/deck-css.ts`), each with a value grammar and the elements it applies to. No classes, no `<style>` beyond `@font-face`, no `margin`, no `z-index` (paint order is document order), no `em`/`%`-of-font, no `var()`.
- **Fonts**: up to four families, from Google Fonts `<link>`s or the deck's assets.
- **Images**: `src` names one of the deck's assets (`assets/<sha256>.<ext>`) or an `https:` URL. Assets are uploaded by the reader; a model refers to an https image or none.

Anything outside the subset is **dropped on read, with a diagnostic**. The model is told what was dropped, by slide and element, in the result of the write that produced it — the deck it wrote is not the deck that renders until it fixes that, and it cannot see the page to find out. The reader's editor cannot produce anything outside the subset in the first place.

## Why HTML and not a JSON scene graph

A model writes HTML and CSS fluently and a bespoke schema badly. A closed subset of HTML keeps that fluency while giving the same guarantee a schema would: the parser turns the document into a typed tree (`Deck`), and everything downstream — the page, the editor, the exports — reads the tree, never the text. An edit by exact passage keeps working on the text, and the diff the model is shown after a reader's edit is a diff of HTML it can read.

## Why a fixed canvas and real CSS layout

## Themes

A deck may name a theme on its body, `<body data-theme="minimal-dark">`, and refer to the theme's colours by role anywhere a colour is taken: `color:var(--text)`, `background:var(--surface)`, `border:1px solid var(--line)`, a gradient stop. The roles are a closed set — `background`, `surface`, `text`, `muted`, `accent`, `line` — and they are the only `var()` the subset reads. Changing the theme changes every colour that refers to a role; a colour written out stays as written.

Two themes ship: `minimal-light` (Minimal white) and `minimal-dark` (Minimal black). A host adds its own by giving the editor, and whatever draws its pages, a longer list (`themes`); a host theme with a shipped theme's id replaces it. A deck naming no theme, or one the reader does not have, is drawn in the first theme of the list.

Unthemed slides default to the theme too: a section with no `background` takes `var(--background)`, text with no `color` takes `var(--text)`.
