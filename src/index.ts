// A slide deck is a constrained HTML document: what the model writes, what
// an editor reads into a tree and writes back, what a page draws. Nothing
// here knows a framework, a session, a disk or a DOM, so a server reads and
// writes decks with the same code an editor does. What needs a document —
// measuring, fonts, contenteditable — is `@jannchie/slides/dom`.
export * from "./deck"
export * from "./deck-css"
export * from "./deck-html"
export * from "./deck-icons"
export * from "./deck-render"
export * from "./deck-themes"
export * from "./deck-tree"
export * from "./deck-motion"
