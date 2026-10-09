// The build's handle on the editor's classes: UnoCSS writes everything the
// components use into this one import, which the build emits as `style.css`.
// Only the standalone build loads it; the web app generates the same classes
// itself.
import "virtual:uno.css"
