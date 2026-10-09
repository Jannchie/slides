import { inject, provide, type InjectionKey } from "vue"

/**
 * Where a deck's pictures and font files live: the one thing the editor needs
 * from whoever stores the deck.
 *
 * A deck names its own files `assets/<name>`; what that resolves to — a route
 * on a session, a path in a plugin's store — is the host's. Anything else a
 * deck names (an https picture, a data: URI) is drawn as it stands and never
 * reaches here.
 */
export type DeckAssetStore = {
  /** Where the browser fetches `src`, which is `assets/<name>` as the deck names it. */
  url(src: string): string
  /** Keep a picture or a font file, and answer with the `src` the deck should name it by. */
  upload(file: Blob): Promise<string>
}

const ASSETS: InjectionKey<DeckAssetStore> = Symbol("deck-assets")

/** Hand the store to every component under the editor. */
export function provideDeckAssets(store: DeckAssetStore) {
  provide(ASSETS, store)
}

export function useDeckAssets(): DeckAssetStore {
  const store = inject(ASSETS, undefined)

  if (store === undefined) {
    throw new Error("A deck component was mounted outside a deck editor.")
  }

  return store
}

/**
 * What goes up for a file the reader dropped in: a drawing as a PNG of itself,
 * anything else as it is. A store that served an SVG back from its own origin
 * would be serving something that can run, so none is ever handed one.
 */
export async function uploadable(file: Blob): Promise<Blob> {
  return file.type === "image/svg+xml" ? await rasterize(file) : file
}

/** A drawing drawn into a PNG at twice its own size, for a crisp picture on a slide. */
async function rasterize(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file)

  try {
    const image = new Image()

    image.src = url
    await image.decode()

    const width = Math.max(image.naturalWidth || 512, 1)
    const height = Math.max(image.naturalHeight || 512, 1)
    const scale = Math.min(2, 4096 / Math.max(width, height))
    const canvas = document.createElement("canvas")

    canvas.width = Math.round(width * scale)
    canvas.height = Math.round(height * scale)
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height)

    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (blob) => (blob === null ? reject(new Error("The drawing could not be drawn.")) : resolve(blob)),
        "image/png",
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
