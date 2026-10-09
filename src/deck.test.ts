import { describe, expect, it } from "vitest"

import { readDeckStyle } from "./deck-css"
import { tokenizeHtml } from "./deck-html"
import { DECK_ICON_NAMES, deckIconMarkup } from "./deck-icons"
import { describeDeckDiagnostics, readDeck, readDeckNodes, writeDeck, type DeckElement } from "./deck"
import { renderSlideHtml } from "./deck-render"

const DECK = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>Q3 review</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&amp;display=swap">
</head>
<body style="font-family:'Inter', sans-serif;color:#1a1a1a">
<section id="cover" data-transition="fade" style="background:#fbfbf8;padding:128px;display:flex;flex-direction:column;justify-content:center;gap:32px">
<h1 style="font-size:120px">Q3 review</h1>
<p style="font-size:40px;color:#6a7179">What moved, <b>and why</b></p>
<aside>Open with the headline number.</aside>
</section>
<section id="plan" style="background:#ffffff;padding:128px">
<x-shape kind="ellipse" style="position:absolute;left:96px;top:96px;width:200px;height:200px;background:#2563eb"></x-shape>
<ul style="font-size:32px">
  <li>One</li>
  <li>Two</li>
</ul>
</section>
</body>
</html>
`

describe("reading a deck", () => {
  it("reads the title, fonts, defaults, slides and notes", () => {
    const { deck, diagnostics } = readDeck(DECK)

    expect(diagnostics).toEqual([])
    expect(deck.title).toBe("Q3 review")
    expect(deck.fontLinks).toHaveLength(1)
    expect(deck.style).toEqual({ "font-family": "'Inter', sans-serif", color: "#1a1a1a" })
    expect(deck.slides.map((slide) => slide.id)).toEqual(["cover", "plan"])
    expect(deck.slides[0]).toMatchObject({ transition: "fade", notes: "Open with the headline number." })
    expect(deck.slides[0]!.style.padding).toBe("128px")
  })

  it("writes back the text it read, so an untouched deck is unchanged", () => {
    const { deck } = readDeck(DECK)

    expect(writeDeck(deck)).toBe(DECK)
  })

  it("writes the same text for the same tree, however the text was spelled", () => {
    const loose = `<section style="background: #fff ; padding: 64">
      <h2 style="FONT-SIZE: 48pt">Hello   <strong>world</strong>  </h2></section>`
    const { deck } = readDeck(loose)
    const written = writeDeck(deck)

    expect(written).toContain('<section id="slide-1" style="background:#fff;padding:64px">')
    expect(written).toContain('<h2 style="font-size:64px">Hello <b>world</b></h2>')
    expect(writeDeck(readDeck(written).deck)).toBe(written)
  })

  it("closes what HTML closes on its own", () => {
    const { deck } = readDeck(
      "<section id=a><ul><li>one<li>two</ul><p>first<p>second</section><section id=b><p>third",
    )
    const [list, first, second] = deck.slides[0]!.children as DeckElement[]

    expect(list!.children).toHaveLength(2)
    expect(first!.tag).toBe("p")
    expect(second!.tag).toBe("p")
    expect(deck.slides).toHaveLength(2)
  })

  it("sets loose text in a container as a paragraph", () => {
    const { deck, diagnostics } = readDeck("<section id=a><div>Just words, <i>said</i></div></section>")
    const div = deck.slides[0]!.children[0] as DeckElement

    expect((div.children[0] as DeckElement).tag).toBe("p")
    expect(diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(["note"])
  })

  it("reads the tags a model reaches for as the subset's", () => {
    const { deck } = readDeck(
      "<section id=a><h4>Small</h4><blockquote><p><em>q</em></p></blockquote><table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table></section>",
    )
    const [heading, quote, table] = deck.slides[0]!.children as DeckElement[]

    expect(heading!.tag).toBe("h3")
    expect(quote!.tag).toBe("div")
    expect(((quote!.children[0] as DeckElement).children[0] as DeckElement).tag).toBe("i")
    expect(table!.children).toHaveLength(2)
  })

  it("keeps a slide's id stable and mints one where it is missing or taken", () => {
    const { deck, diagnostics } = readDeck(
      '<section id="a"></section><section id="a"></section><section></section>',
    )

    expect(deck.slides.map((slide) => slide.id)).toEqual(["a", "slide-2", "slide-3"])
    expect(diagnostics.every((diagnostic) => diagnostic.severity === "note")).toBe(true)
  })

  it("keeps an svg whole, and refuses one that could run or reach out", () => {
    const drawing =
      '<section id=a><svg aria-label="bars" viewBox="0 0 10 10" style="width:400px"><rect width="5" height="5" fill="url(#g)"/></svg></section>'
    const harmful =
      '<section id=a><svg viewBox="0 0 10 10"><image href="https://x.test/a.png"/></svg><svg onload="x()"></svg></section>'

    expect(readDeck(drawing).deck.slides[0]!.children[0]).toMatchObject({
      type: "svg",
      attributes: { "aria-label": "bars", viewBox: "0 0 10 10" },
      style: { width: "400px" },
      markup: '<rect width="5" height="5" fill="url(#g)"/>',
    })

    const refused = readDeck(harmful)

    expect(refused.deck.slides[0]!.children).toEqual([])
    expect(refused.diagnostics.filter((diagnostic) => diagnostic.severity === "warning")).toHaveLength(2)
  })

  it("drops what the subset cannot hold, and says where", () => {
    const { deck, diagnostics } = readDeck(
      '<section id=a>\n<p style="margin-top:12px;z-index:3;font-size:2em" onclick="x()">Hi</p>\n<script>alert(1)</script>\n<img src="data:image/png;base64,AAAA">\n</section>',
    )
    const lines = describeDeckDiagnostics(diagnostics)

    expect((deck.slides[0]!.children[0] as DeckElement).style).toEqual({})
    expect(lines.some((line) => line.startsWith("Slide 1, line 2:") && line.includes("margin-top"))).toBe(
      true,
    )
    expect(lines.some((line) => line.includes("z-index") && line.includes("order them"))).toBe(true)
    expect(lines.some((line) => line.includes("only px lengths"))).toBe(true)
    expect(lines.some((line) => line.includes("<script>"))).toBe(true)
    expect(lines.some((line) => line.includes("assets or an https URL"))).toBe(true)
  })

  it("collapses whitespace the way a browser draws it", () => {
    const { deck } = readDeck("<section id=a><p>\n  Line one<br>\n  line <b> two </b>\n</p></section>")
    const paragraph = deck.slides[0]!.children[0] as DeckElement

    expect(writeDeck(deck)).toContain("<p>Line one<br>line <b>two</b></p>")
    expect(paragraph.children).toHaveLength(4)
  })

  it("reads pasted markup through the same subset", () => {
    const nodes = readDeckNodes('<p style="color:red;float:left">Pasted</p><button>no</button>')

    expect(nodes).toEqual([
      {
        type: "element",
        tag: "p",
        attributes: {},
        style: { color: "red" },
        children: [{ type: "text", text: "Pasted" }],
      },
    ])
  })
})

describe("the style subset", () => {
  const values = (tag: string, style: string) =>
    Object.fromEntries(
      readDeckStyle(tag, style).flatMap((read) => ("value" in read ? [[read.property, read.value]] : [])),
    )

  it("normalizes lengths, colours and aliases", () => {
    expect(values("div", "width:300;height:12pt;background-color:#FFF;left:calc(50% - 120px)")).toEqual({
      width: "300px",
      height: "16px",
      background: "#fff",
      left: "calc(50% - 120px)",
    })
  })

  it("spells out the font shorthand", () => {
    expect(values("p", "font: italic 600 48px/1.1 'Inter', sans-serif")).toEqual({
      "font-style": "italic",
      "font-weight": "600",
      "font-size": "48px",
      "line-height": "1.1",
      "font-family": "'Inter', sans-serif",
    })
  })

  it("takes gradients, shadows and transforms in the forms it can draw", () => {
    expect(
      values(
        "div",
        "background:linear-gradient(135deg, #111 0%, #333 100%);box-shadow:0 8px 24px rgba(0,0,0,.2);transform:rotate(-4deg) scale(1.1)",
      ),
    ).toEqual({
      background: "linear-gradient(135deg, #111 0%, #333 100%)",
      "box-shadow": "0 8px 24px rgba(0,0,0,.2)",
      transform: "rotate(-4deg) scale(1.1)",
    })
  })

  it("refuses a property on an element it does not apply to", () => {
    const [read] = readDeckStyle("span", "display:flex")

    expect(read).toMatchObject({ property: "display", dropped: "does not apply to <span>" })
  })

  it("refuses var(), url() and units other than px", () => {
    expect(values("div", "color:var(--ink);background:url(a.png);width:10vw;padding:1rem")).toEqual({})
  })
})

describe("the tokenizer", () => {
  it("keeps a stray < in prose as text, and reads entities", () => {
    const tokens = tokenizeHtml("<p>a < b &amp; c &mdash; d</p>")

    expect(tokens[1]).toMatchObject({ type: "text", text: "a < b & c — d" })
  })

  it("reads nested svgs whole", () => {
    const tokens = tokenizeHtml('<svg a="1"><svg><g/></svg><rect/></svg><p>after</p>')

    expect(tokens[0]).toMatchObject({ type: "raw", name: "svg", inner: "<svg><g/></svg><rect/>" })
    expect(tokens[1]).toMatchObject({ type: "start", name: "p" })
  })

  it("says where each token is", () => {
    const tokens = tokenizeHtml("<section>\n  <p>x</p>")

    expect(tokens.find((token) => token.type === "start" && token.name === "p")).toMatchObject({
      line: 2,
      column: 3,
    })
  })
})

describe("what a deck written to break the subset gets", () => {
  const svgSlide = (svg: string) => readDeck(`<section id=a>${svg}</section>`)

  it("refuses an svg however its handler or link is spelled", () => {
    for (const svg of [
      '<svg ONLOAD="x()"></svg>',
      "<svg><animate/onbegin=x() attributeName=x dur=1s/></svg>",
      '<svg><set attributeName="href" to="&#106;avascript:x()"/></svg>',
      "<svg><a href=https://x.test><rect/></a></svg>",
      "<svg><style>section{display:none}</style></svg>",
      '<svg><a href="java\tscript:x()"><rect/></a></svg>',
    ]) {
      expect(svgSlide(svg).deck.slides[0]!.children, svg).toEqual([])
    }
  })

  it("draws a model's svg as an image on the page too", () => {
    const { deck } = svgSlide('<svg aria-label="dot" viewBox="0 0 10 10"><circle r="4"/></svg>')
    const html = renderSlideHtml(deck.slides[0]!)

    expect(html).toContain('<img src="data:image/svg+xml')
    expect(html).not.toContain("<circle")
  })

  it("reads every part of flex, so a value cannot carry a declaration of its own", () => {
    expect(readDeckStyle("div", "flex:1 1 200px")).toEqual([{ property: "flex", value: "1 1 200px" }])
    expect(readDeckStyle("div", "flex:2 auto")).toEqual([{ property: "flex", value: "2 auto" }])

    const smuggled = readDeckStyle(
      "div",
      'flex:1 1 \\";position:fixed;background-image:\\75rl(https://x.test/x);"',
    )

    expect(smuggled.some((read) => "value" in read && read.property !== "flex")).toBe(false)
    expect(smuggled.find((read) => read.property === "flex")).not.toHaveProperty("value")
  })

  it("refuses a CSS escape in any value", () => {
    expect(readDeckStyle("div", "background:\\75rl(x)")[0]).not.toHaveProperty("value")
  })

  it("drops a crop it cannot read rather than writing it into the style", () => {
    const { deck, diagnostics } = readDeck(
      '<section id=a><img src="assets/a.png" data-crop="2 0 0;position:fixed;inset:0"><img src="assets/b.png" data-crop="2 30% 40%"></section>',
    )
    const [bad, good] = deck.slides[0]!.children as DeckElement[]

    expect(bad!.attributes["data-crop"]).toBeUndefined()
    expect(good!.attributes["data-crop"]).toBe("2 30% 40%")
    expect(diagnostics.some((diagnostic) => diagnostic.message.startsWith("data-crop="))).toBe(true)
    expect(renderSlideHtml(deck.slides[0]!)).not.toContain("position:fixed")
  })

  it("ends an unclosed aside at its slide instead of taking every slide after it", () => {
    const { deck, diagnostics } = readDeck(
      "<section id=a><p>One</p><aside>Say hi<p>more</section><section id=b><p>Two</p></section><section id=c><p>Three</p></section>",
    )

    expect(deck.slides.map((slide) => slide.id)).toEqual(["a", "b", "c"])
    expect(deck.slides[0]!.notes).toBe("Say hi\nmore")
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("</aside>"))).toBe(true)
  })

  it("keeps a nested list and a cell's blocks on lines of their own", () => {
    const { deck, diagnostics } = readDeck(
      "<section id=a><ul><li>Parent<ul><li>Child one</li><li>Child two</li></ul></li></ul><table><tr><td><div>a</div><div>b</div></td></tr></table></section>",
    )
    const [list, table] = deck.slides[0]!.children as DeckElement[]
    const item = list!.children[0] as DeckElement
    const cell = (table!.children[0] as DeckElement).children[0] as DeckElement
    const words = (node: DeckElement) =>
      node.children.map((child) =>
        child.type === "text" ? child.text : child.type === "element" ? `<${child.tag}>` : "",
      )

    expect(words(item)).toEqual(["Parent", "<br>", "Child one", "<br>", "Child two"])
    expect(words(cell)).toEqual(["a", "<br>", "b"])
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("inside text"))).toBe(true)
  })

  it("reads an attribute value of any length", () => {
    const data = `data:image/png;base64,${"A".repeat(70 * 1024)}`
    const { deck } = readDeck(`<section id=a><img src="${data}"></section>`)
    const [image] = deck.slides[0]!.children as DeckElement[]

    expect(image!.tag).toBe("img")
  })

  it("survives nesting far deeper than any deck, and says so", () => {
    const deep = `<section id=a>${"<span>".repeat(20000)}x${"</span>".repeat(20000)}</section>`
    const { deck, diagnostics } = readDeck(deep)

    expect(deck.slides).toHaveLength(1)
    expect(diagnostics.some((diagnostic) => diagnostic.message.includes("nest more than"))).toBe(true)
  })

  it("names only icons there are, not what an object inherits", () => {
    const { deck } = readDeck(
      '<section id=a><x-icon name="constructor"></x-icon><x-icon name="add"></x-icon></section>',
    )

    expect((deck.slides[0]!.children as DeckElement[]).map((node) => node.attributes.name)).toEqual(["add"])
  })

  it("keeps an icon an older deck names by its older name, and does not offer that name", () => {
    const { deck, diagnostics } = readDeck('<section id=a><x-icon name="star-filled"></x-icon></section>')

    expect((deck.slides[0]!.children as DeckElement[]).map((node) => node.attributes.name)).toEqual([
      "star-filled",
    ])
    expect(diagnostics).toEqual([])
    expect(deckIconMarkup("star-filled")).toBe(deckIconMarkup("star"))
    expect(DECK_ICON_NAMES).not.toContain("star-filled")
  })

  it("says so when a row or a cell carries an id or a build", () => {
    const { diagnostics } = readDeck(
      '<section id=a><table><tr id="r" data-build-in="fade"><td id="c">x</td></tr></table></section>',
    )

    expect(
      diagnostics.filter((diagnostic) => diagnostic.message.includes("give it to the <table>")),
    ).toHaveLength(3)
  })
})
