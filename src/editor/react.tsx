import { forwardRef, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react"

import { mountDeckEditor, type DeckEditorHandle, type DeckEditorOptions } from "./index"

export type { DeckAssetStore, DeckEditorHandle, DeckEditorOptions } from "./index"

export type DeckEditorProps = DeckEditorOptions & { className?: string; style?: CSSProperties }

/**
 * The editor as a React component: a box the Vue editor is mounted into once,
 * and told about every prop that changes after. The ref is the same handle
 * `mountDeckEditor` returns, so `write()` is how a host reads the deck's text.
 */
export const DeckEditor = forwardRef<DeckEditorHandle, DeckEditorProps>(function DeckEditor(
  { className, style, source, editable, assets, locale, onChange },
  ref,
) {
  const element = useRef<HTMLDivElement>(null)
  const handle = useRef<DeckEditorHandle | null>(null)
  // The latest callback, read when the editor calls it, so a new function each
  // render does not have to be handed to the editor each render.
  const changed = useRef(onChange)

  changed.current = onChange

  useEffect(() => {
    if (element.current === null) {
      return
    }

    const mounted = mountDeckEditor(element.current, {
      source,
      ...(editable === undefined ? {} : { editable }),
      assets,
      ...(locale === undefined ? {} : { locale }),
      onChange: () => changed.current?.(),
    })

    handle.current = mounted

    return () => {
      mounted.destroy()
      handle.current = null
    }
    // Mounted once; what changes afterwards is handed over below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    handle.current?.update({
      source,
      ...(editable === undefined ? {} : { editable }),
      assets,
      ...(locale === undefined ? {} : { locale }),
    })
  }, [source, editable, assets, locale])

  useImperativeHandle(
    ref,
    () => ({
      update: (options) => handle.current?.update(options),
      write: () => handle.current?.write() ?? source,
      slideIndex: () => handle.current?.slideIndex() ?? 0,
      slideTitle: () => handle.current?.slideTitle() ?? "",
      selectedText: () => handle.current?.selectedText() ?? "",
      destroy: () => handle.current?.destroy(),
    }),
    [source],
  )

  return <div ref={element} className={className} style={style} />
})
