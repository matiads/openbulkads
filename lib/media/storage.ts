export type MediaPutOptions = {
  httpMetadata?: { contentType?: string };
  /**
   * Declared payload length from a trusted header, when present. A valid size
   * lets ingestion stream end to end. Never used to accept an oversized body.
   */
  size?: number;
  /** Override the active limit (tests and non-default callers only). */
  limit?: number;
};

export type MediaObjectBody = {
  body: ReadableStream<Uint8Array>;
  size: number;
  httpMetadata?: { contentType?: string };
};

export type MediaHeadObject = {
  size: number;
  httpMetadata?: { contentType?: string };
};

export type MediaStore = {
  put(
    key: string,
    body: ReadableStream<Uint8Array> | Blob,
    options?: MediaPutOptions,
  ): Promise<void>;
  get(key: string): Promise<MediaObjectBody | null>;
  head(key: string): Promise<MediaHeadObject | null>;
  delete(key: string): Promise<void>;
};

let nodeMediaStore: Promise<MediaStore> | undefined;

export async function mediaStore(): Promise<MediaStore> {
  return (
    nodeMediaStore ??= (async () => {
      const [{ getMediaConfig }, { createLocalMediaStore }] = await Promise.all([
        import('./config'),
        import('./local'),
      ]);
      const { root } = getMediaConfig();
      return createLocalMediaStore(root);
    })().catch((error) => {
      nodeMediaStore = undefined;
      throw error;
    })
  );
}
