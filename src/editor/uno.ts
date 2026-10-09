/**
 * The classes the deck editor is written in, as UnoCSS shortcuts and theme
 * colours. A host builds them into its own stylesheet (the web app spreads
 * these into its config), or loads the stylesheet the package builds with
 * them. Defined here and only here, so the editor's `field` or `popover` reads
 * the same in every host and the web app's never drifts from it.
 *
 * Dark variants assume the host's preset says what dark is (`dark:`); the web
 * app writes it to `<html data-scheme>`.
 */
export const deckEditorColors = {
  // The dark theme's grounds, a black with a little blue in it rather than a
  // neutral one: the page, then what is raised off it (dialogs). One hue
  // for every dark surface, so none of them reads as grey beside another.
  ground: "oklch(0.155 0.014 262)",
  "ground-raised": "oklch(0.2 0.016 262)",
  // Secondary text on those grounds: what `ink-muted` and `ink-soft` are in
  // the dark, named once so the next contrast pass is one edit.
  "ink-dim": "oklch(0.84 0 0)",
  // Dark-mode floating surfaces: composer, bubbles, menus, and their hover.
  elevated: "oklch(0.235 0.016 262)",
  "elevated-hover": "oklch(0.265 0.017 262)",
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

export const deckEditorPreflights = [
  {
    getCSS: () =>
      [
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
        `${IN("textarea")}{resize:vertical}`,
        `${OWN}::placeholder{opacity:1;color:color-mix(in oklab,currentColor 50%,transparent)}`,
        `${IN("[hidden]:not([hidden=until-found])")}{display:none!important}`,
      ].join("\n"),
  },
]

export const deckEditorShortcuts = {
  surface: "bg-black/4 dark:bg-white/5",
  "surface-hover": "hover:bg-black/6 dark:hover:bg-white/8",
  "surface-strong": "bg-black/6 dark:bg-white/8",
  // Text inks that clear WCAG AAA (7:1) on the page grounds — neutral-50
  // light, the blue-black `ground` dark. Type the name, not a shade, so the next
  // contrast pass is one edit here rather than a sweep of call sites.
  // Icons are non-text and only need 3:1, so they may sit a step brighter.
  "ink-muted": "text-neutral-600 dark:text-ink-dim",
  // The two rungs an activity row is written in. `ink-strong` is what the row
  // is about — the word it opens with. `ink-soft` is everything it says about
  // that: the detail, the summary, the producer it names.
  //
  // A row's leading icon wears whichever of the two the text beside it does,
  // which is the rule these names exist to make keepable: the icon and its
  // words used to be two literals that agreed by accident, so darkening one
  // left the other behind and the icon read as switched off rather than as
  // quiet. `ink-soft` is a step lighter than `ink-muted` in light mode and the
  // same shade in dark — it sits on a row's tinted ground, not on the page,
  // and it is not body copy.
  "ink-strong": "text-neutral-700 dark:text-neutral-200",
  "ink-soft": "text-neutral-500 dark:text-ink-dim",
  "ink-warning": "text-amber-900 dark:text-amber-400",
  "ink-accent": "text-blue-800 dark:text-blue-400",
  // One focus treatment for every keyboard-reachable control. focus-visible
  // only, so mouse clicks stay quiet while Tab always shows where it landed.
  //
  // Named `kbd-` and not `focus-` on purpose: UnoCSS reads a class beginning
  // with a variant prefix as that variant, so `focus-ring` resolved as
  // `focus:` + `ring` — a 1px shadow, and no `outline-none` — and the
  // browser's own outline was what every control had been showing. A
  // shortcut whose name starts with a variant's is a shortcut that never
  // runs, silently.
  //
  // Solid, and a step darker on the light ground than on the dark one: the
  // ring is a non-text indicator, which WCAG holds to 3:1 against what it
  // sits on — blue-500 at 70% came to about 2.6:1 on neutral-50.
  "kbd-ring":
    "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400",
  // The same treatment for a field that is already its own visible box.
  // Flush against its edge rather than offset outside it: the offset that
  // separates a ring from a button reads, around a box that has its own
  // fill, as a second box drawn around the first.
  "kbd-ring-flush":
    "outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-blue-600 dark:focus-visible:outline-blue-400",
  // The one transition the app uses. 150ms everywhere, so motion reads as
  // one system instead of per-component timings.
  "transition-quick": "transition-all duration-150",
  // Every floating panel: dropdown menus, the slash menu, the workspace
  // switcher. One surface, one ring, one z — they must not each pick their own.
  popover:
    "z-50 rounded-xl bg-neutral-50 p-1 shadow-xl ring-1 ring-black/10 dark:bg-elevated dark:ring-white/10",
  // A text field, a select, the trigger of a field-like menu: a box with an
  // edge. A fill alone read as a label someone had shaded, not as a place to
  // type.
  field:
    "w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-sm placeholder:text-neutral-400 kbd-ring-flush dark:border-neutral-700 dark:bg-ground dark:placeholder:text-neutral-500",
  // The quiet button beside a field or under a list — the one that is not the
  // point of the page. Outlined so it reads as a button before it is hovered.
  "button-secondary":
    "flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-1.5 text-sm surface-hover kbd-ring disabled:opacity-50 dark:border-neutral-700",
  // One choice of a few, all visible: language, theme, a request shape. The
  // track is the ground; the chosen segment is lifted out of it. The ink is
  // the call site's, one of `segment-selected` or `ink-muted`: a colour here
  // would meet the selected one's and win or lose by generation order.
  segmented: "inline-flex flex-wrap gap-0.5 rounded-lg p-0.5 surface",
  segment: "flex items-center gap-1.5 rounded-md px-3 py-1 text-sm kbd-ring transition-quick",
  "segment-selected": "bg-white text-neutral-900 shadow-sm dark:bg-neutral-700 dark:text-neutral-50",
  // A row inside a popover.
  "menu-item":
    "w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm surface-hover kbd-ring",
  // The chevron every fold in the app ends with; the icon class sits beside
  // it at the call site so the glyph stays greppable.
  "fold-chevron": "h-3.5 w-3.5 shrink-0 ink-muted transition-transform duration-150",
  // Every figure that moves: a duration, a count of chars or files, a token
  // total, a cost. Digits of one width, so a reading that ticks up neither
  // shifts what is beside it nor widens the line it is on — and the code
  // face, because a figure usually shares its line with one. One class rather
  // than `font-num` beside `tabular-nums` at each call site: a figure that
  // remembers one and forgets the other is the failure this exists to not
  // have.
  num: "font-num tabular-nums",
  // Every icon-only control in the app.
  "icon-button":
    "h-8 w-8 flex items-center justify-center rounded-md ink-soft surface-hover kbd-ring transition-quick",
}
