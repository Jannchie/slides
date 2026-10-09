/**
 * How the editor looks, in three layers a host can each reach:
 *
 * - **Tokens** (`--slides-*`): every colour, radius, face and size the editor
 *   draws with, as custom properties on `.slides-editor`. Their defaults sit
 *   inside `:where()`, so a host's `.slides-editor { --slides-accent: … }`
 *   wins without a fight, and a theme is a handful of declarations.
 * - **Named parts** (`slides-field`, `slides-button`, `slides-inspector`…):
 *   the shortcuts below are real classes in the DOM, so a host can reach a
 *   kind of control, or a region, by a name that will not change under it.
 * - **A cascade layer**: the built stylesheet is inside `@layer slides`, so any
 *   rule a host writes outside a layer wins over it whatever its weight.
 *
 * A host that runs UnoCSS spreads these into its own config, and the editor's
 * names are all prefixed `slides-` so they never meet the host's own.
 */

const LIGHT = {
  bg: "#fbfbfc",
  panel: "#ffffff",
  sunken: "#f3f3f5",
  field: "#ffffff",
  stage: "#f0f0f2",
  line: "#e6e6ea",
  "line-strong": "#d4d4da",
  text: "#0e0e11",
  "text-2": "#4a4b53",
  muted: "#6e6f78",
  warning: "#a16207",
  danger: "#dc2626",
}

const DARK = {
  bg: "#09090b",
  panel: "#0e0e11",
  sunken: "#141418",
  field: "#0e0e11",
  stage: "#050506",
  line: "#1d1d22",
  "line-strong": "#2a2a31",
  text: "#f2f2f4",
  "text-2": "#c2c3ca",
  muted: "#9a9ba4",
  warning: "#facc15",
  danger: "#f87171",
}

const declare = (colors: Record<string, string>) =>
  Object.entries(colors)
    .map(([name, value]) => `--slides-${name}:${value};`)
    .join("")

/**
 * The tokens. Light on `.slides-editor`; dark wherever `data-scheme="dark"`
 * says so, on the editor's box or any ancestor. Everything not a colour is the
 * same in both.
 */
const TOKENS = [
  `:where(.slides-editor){${declare(LIGHT)}`,
  // No colour for an accent: the accent is the ink, and a pressed or hovered
  // control is a faint wash of it.
  "--slides-accent:var(--slides-text);",
  "--slides-hover:color-mix(in srgb,var(--slides-text) 6%,transparent);",
  "--slides-pressed:color-mix(in srgb,var(--slides-text) 10%,transparent);",
  "--slides-focus:var(--slides-text);",
  // The one colour that is a colour: what is selected on a slide has to read
  // against whatever the slide is painted, which ink alone does not.
  "--slides-selection:#2563eb;",
  "--slides-font-sans:Inter,system-ui,-apple-system,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;",
  "--slides-font-mono:'Berkeley Mono',ui-monospace,'Sarasa Mono SC',Consolas,monospace;",
  "--slides-font-size:12px;",
  "--slides-radius:6px;",
  "--slides-radius-lg:8px;",
  "--slides-control-height:28px;",
  "--slides-shadow:0 8px 24px rgb(0 0 0 / .12),0 0 0 1px var(--slides-line);",
  "font-family:var(--slides-font-sans);color:var(--slides-text);color-scheme:light}",
  `:where([data-scheme="dark"]) :where(.slides-editor),:where(.slides-editor[data-scheme="dark"]){${declare(DARK)}`,
  "--slides-shadow:0 8px 24px rgb(0 0 0 / .5),0 0 0 1px var(--slides-line);color-scheme:dark}",
].join("")

/**
 * The editor's colours as theme colours, each one its token: `bg-slides-panel`,
 * `border-slides-line`, `text-slides-muted`. A host's value for the token is
 * what every class reads.
 */
export const deckEditorColors = {
  slides: Object.fromEntries(
    [...Object.keys(LIGHT), "accent", "hover", "pressed", "focus", "selection"].map((name) => [
      name,
      `var(--slides-${name})`,
    ]),
  ),
}

/**
 * The icons the editor's classes name (`i-jannchie-*`): Jannchie Icons at the
 * regular weight, a 1.5 stroke, which lands on a whole pixel at the 14–16px
 * they are drawn. Options for `presetIcons`, so a host draws the same icons at
 * the same weight as the editor's own stylesheet.
 */
export const deckEditorIcons = {
  collections: {
    jannchie: () => import("@jannchie/iconify-json/icons.json").then((module) => module.default),
  },
  extraProperties: { display: "inline-block", "vertical-align": "middle" },
}

/**
 * The ground the editor's classes are written on: what a Tailwind-style
 * preflight does, kept to the editor's own boxes (`.slides-editor` — the editor,
 * its presenter and any panel it teleports out). The classes assume it — `border`
 * sets a width and needs the style this sets, a `<button>` has to have lost its
 * face — and a page that has no such reset, or a different one, must not be
 * what decides whether the editor draws. Inside `:where`, so it weighs nothing:
 * any class, the slides' own sheet included, wins over it.
 */
const OWN = ":where(.slides-editor, .slides-editor *)"
// A pseudo-element cannot sit inside `:where`, so it hangs off the outside.
const SCOPE = `${OWN},${OWN}::before,${OWN}::after`
const IN = (selectors: string) => `:where(.slides-editor) :where(${selectors})`

const RESET = [
  `${SCOPE}{box-sizing:border-box;margin:0;padding:0;border:0 solid}`,
  `${IN("h1,h2,h3,h4,h5,h6")}{font-size:inherit;font-weight:inherit}`,
  `${IN("ol,ul,menu")}{list-style:none}`,
  `${IN("a")}{color:inherit;text-decoration:inherit}`,
  `${IN("b,strong")}{font-weight:bolder}`,
  `${IN("img,svg,video,canvas,iframe")}{display:block;vertical-align:middle}`,
  `${IN("img,video")}{max-width:100%;height:auto}`,
  `${IN("table")}{text-indent:0;border-color:inherit;border-collapse:collapse}`,
  `${IN("button,input,select,optgroup,textarea")}{font:inherit;font-feature-settings:inherit;letter-spacing:inherit;color:inherit;border-radius:0;background-color:transparent;opacity:1}`,
  `${IN("button,input[type=button],input[type=reset],input[type=submit]")}{appearance:button}`,
  `${IN("button,select,summary,[role=button]")}{cursor:pointer}`,
  `${IN("textarea")}{resize:vertical}`,
  // A figure is typed or stepped with the arrow keys; the spinner beside it is
  // a target too small to hit at a control's height.
  `${IN("input[type=number]")}{appearance:textfield}`,
  `${OWN}::-webkit-inner-spin-button,${OWN}::-webkit-outer-spin-button{appearance:none;margin:0}`,
  `${IN("input[type=range]")}{accent-color:var(--slides-accent)}`,
  `${IN("input[type=checkbox]")}{accent-color:var(--slides-accent)}`,
  `${OWN}::placeholder{opacity:1;color:var(--slides-muted)}`,
  `${IN("[hidden]:not([hidden=until-found])")}{display:none!important}`,
].join("\n")

/** The tokens, then the reset: both on the editor's own boxes and nowhere else. */
export const deckEditorPreflights = [{ layer: "preflights", getCSS: () => `${TOKENS}\n${RESET}` }]

/**
 * The editor's parts. Each name is a class a host can reach; each reads only
 * tokens, so a theme reaches all of them at once.
 */
export const deckEditorShortcuts = {
  // Keyboard focus: one treatment, shown only for the keyboard.
  "slides-focus":
    "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-slides-focus focus-visible:outline-offset-1",
  "slides-hover": "hover:bg-slides-hover",
  "slides-pressed": "bg-slides-pressed text-slides-text",
  // The inks: what a thing is about, what is said about it, and what is quiet.
  "slides-ink": "text-slides-text",
  "slides-ink-2": "text-slides-text-2",
  "slides-muted": "text-slides-muted",
  "slides-warning": "text-slides-warning",
  // Figures and code: one width of digit, in the code face.
  "slides-num": "[font-family:var(--slides-font-mono)] tabular-nums",
  // A small heading over a group: the code face, set small and wide.
  "slides-label":
    "[font-family:var(--slides-font-mono)] text-[11px] leading-4 uppercase tracking-[.06em] text-slides-muted",

  // Every control is one height, so a row of them lines up whatever they are.
  "slides-field":
    "h-[var(--slides-control-height)] w-full min-w-0 rounded-[var(--slides-radius)] border border-slides-line bg-slides-field px-2 text-[length:var(--slides-font-size)] text-slides-text hover:border-slides-line-strong focus-visible:border-slides-text-2 outline-none disabled:opacity-50",
  // A field with something before it inside its edge: a letter, an icon, a swatch.
  "slides-field-box":
    "h-[var(--slides-control-height)] w-full min-w-0 flex items-center gap-1.5 rounded-[var(--slides-radius)] border border-slides-line bg-slides-field px-2 text-[length:var(--slides-font-size)] text-slides-text hover:border-slides-line-strong focus-within:border-slides-text-2",
  "slides-button":
    "h-[var(--slides-control-height)] inline-flex shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-[var(--slides-radius)] border border-slides-line bg-slides-field px-2 text-[length:var(--slides-font-size)] text-slides-text slides-hover slides-focus disabled:pointer-events-none disabled:opacity-40",
  // A toolbar's control with words or a chevron beside its icon.
  "slides-tool":
    "h-[var(--slides-control-height)] inline-flex shrink-0 items-center gap-1 rounded-[var(--slides-radius)] px-1.5 text-[length:var(--slides-font-size)] text-slides-text-2 hover:text-slides-text slides-hover slides-focus disabled:pointer-events-none disabled:opacity-35",
  "slides-icon-button":
    "h-[var(--slides-control-height)] w-[var(--slides-control-height)] inline-flex shrink-0 items-center justify-center rounded-[var(--slides-radius)] text-slides-text-2 hover:text-slides-text slides-hover slides-focus disabled:pointer-events-none disabled:opacity-35",
  // One choice of a few, all visible: a hairline round the group, and the
  // chosen one a wash of ink rather than a fill.
  "slides-segmented":
    "h-[var(--slides-control-height)] w-full flex gap-0.5 rounded-[var(--slides-radius-lg)] border border-slides-line p-0.5",
  "slides-segment":
    "min-w-0 flex-1 inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-[calc(var(--slides-radius)-1px)] px-1.5 text-[length:var(--slides-font-size)] text-slides-text-2 hover:text-slides-text slides-focus",
  "slides-segment-on": "bg-slides-pressed !text-slides-text",
  // A floating panel, and a row inside one.
  "slides-popover":
    "z-50 rounded-[var(--slides-radius-lg)] bg-slides-panel p-1 text-[length:var(--slides-font-size)] text-slides-text shadow-[var(--slides-shadow)]",
  "slides-menu-item":
    "h-[var(--slides-control-height)] w-full flex items-center gap-2 rounded-[var(--slides-radius)] px-2 text-left text-[length:var(--slides-font-size)] slides-hover slides-focus disabled:pointer-events-none disabled:opacity-40",
  // The format pane: sections of rows, each row a label and its controls, so
  // every control in it starts on one line and is one height.
  "slides-inspector-section": "flex flex-col gap-2 border-b border-slides-line px-3 py-3",
  "slides-inspector-heading": "slides-label",
  "slides-inspector-row":
    "grid min-h-[var(--slides-control-height)] grid-cols-[4.5rem_minmax(0,1fr)] items-center gap-2",
  "slides-inspector-label": "truncate text-slides-text-2",
  "slides-inspector-controls": "min-w-0 flex items-center gap-1.5",
  "slides-chevron": "h-3.5 w-3.5 shrink-0 text-slides-muted transition-transform duration-150",
  "slides-transition": "transition-all duration-150",
}
