/**
 * A deck's theme: the colours its slides refer to by role rather than by
 * value. A slide writes `color:var(--text)` or `background:var(--surface)`, and
 * the theme the deck names (`<body data-theme="minimal-dark">`) says what each
 * role is — so changing the theme changes every slide at once, the way a
 * presentation program's theme does. A colour written out stays as written:
 * whether a box follows the theme is the author's choice, box by box.
 *
 * The roles are a closed set, because a model writes against them and an
 * editor offers them: a theme that could name its own would be one no deck
 * written for another theme could use.
 *
 * Two themes ship; a host adds its own by handing the editor (and the reader of
 * a page) a longer list. A deck naming a theme nobody has is drawn in the first
 * theme of the list it is given.
 */

/** What a theme colours, and what a slide may refer to as `var(--<role>)`. */
export const DECK_THEME_ROLES = ["background", "surface", "text", "muted", "accent", "line"] as const

export type DeckThemeRole = (typeof DECK_THEME_ROLES)[number]

export type DeckTheme = {
  /** What a deck names it by: lower case, digits and hyphens. */
  id: string
  /** What a reader sees it called. The shipped themes' names are also translated by the editor. */
  name: string
  colors: Readonly<Record<DeckThemeRole, string>>
}

/** Minimal white: black ink on white, one hairline grey, no colour of its own. */
export const MINIMAL_LIGHT: DeckTheme = {
  id: "minimal-light",
  name: "Minimal white",
  colors: {
    background: "#ffffff",
    surface: "#f4f4f5",
    text: "#0e0e11",
    muted: "#6e6f78",
    accent: "#0e0e11",
    line: "#e4e4e7",
  },
}

/** Minimal black: white ink on near-black, the same restraint the other way round. */
export const MINIMAL_DARK: DeckTheme = {
  id: "minimal-dark",
  name: "Minimal black",
  colors: {
    background: "#0a0a0b",
    surface: "#18181b",
    text: "#f4f4f5",
    muted: "#a1a1aa",
    accent: "#f4f4f5",
    line: "#27272a",
  },
}

/** The themes every deck can name. A host's own go after these. */
export const DECK_THEMES: readonly DeckTheme[] = [MINIMAL_LIGHT, MINIMAL_DARK]

/** A theme's id: what `data-theme` may hold. */
export function isDeckThemeId(id: string) {
  return /^[a-z0-9][a-z0-9-]{0,63}$/.test(id)
}

/** The theme a deck names, among `themes`; the first of them when it names none or one not there. */
export function findDeckTheme(id: string | undefined, themes: readonly DeckTheme[] = DECK_THEMES): DeckTheme {
  return themes.find((theme) => theme.id === id) ?? themes[0] ?? MINIMAL_LIGHT
}

/** The custom properties that make a theme's roles resolve, for the box the slides sit in. */
export function deckThemeStyle(theme: DeckTheme): Record<string, string> {
  return Object.fromEntries(DECK_THEME_ROLES.map((role) => [`--${role}`, theme.colors[role]]))
}

const THEME_REFERENCE = new RegExp(`^var\\(\\s*--(${DECK_THEME_ROLES.join("|")})\\s*\\)$`, "i")
const THEME_REFERENCES = new RegExp(`var\\(\\s*--(?:${DECK_THEME_ROLES.join("|")})\\s*\\)`, "gi")

/** The role `value` refers to, when it is exactly a reference to one: `var(--accent)`. */
export function themeRoleOf(value: string | undefined): DeckThemeRole | undefined {
  const match = value === undefined ? null : THEME_REFERENCE.exec(value.trim())

  return match === null ? undefined : (match[1]!.toLowerCase() as DeckThemeRole)
}

/** `value` with every reference to a theme role taken out: what is left must hold no other `var()`. */
export function withoutThemeReferences(value: string) {
  return value.replace(THEME_REFERENCES, "")
}

/** A colour as it draws under `theme`: a role reference resolved, anything else as it stands. */
export function resolveDeckColor(value: string, theme: DeckTheme) {
  const role = themeRoleOf(value)

  return role === undefined ? value : theme.colors[role]
}
