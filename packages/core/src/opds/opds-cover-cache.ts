import type { OpdsAssetResponse } from "./opds-client";

export interface OpdsCoverValue {
  readonly uri: string;
  readonly byteLength: number;
}

export interface OpdsCoverLease {
  readonly uri: string;
  release(): void;
}

function bytesToBase64(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1];
    const third = bytes[index + 2];
    const value = (first << 16) | ((second ?? 0) << 8) | (third ?? 0);
    output += alphabet[(value >> 18) & 63];
    output += alphabet[(value >> 12) & 63];
    output += second === undefined ? "=" : alphabet[(value >> 6) & 63];
    output += third === undefined ? "=" : alphabet[value & 63];
  }
  return output;
}

export async function readOpdsCover(
  response: OpdsAssetResponse,
  signal: AbortSignal,
  maxBytes: number,
): Promise<OpdsCoverValue> {
  let cancelled = false;
  const cancelTransport = async (reason: string) => {
    if (cancelled) return;
    cancelled = true;
    await response.cancel(reason);
  };
  const contentType = response.headers.get("Content-Type")?.split(";", 1)[0]?.trim();
  const advertisedLength = Number(response.headers.get("Content-Length"));
  if (!contentType?.startsWith("image/")) {
    await cancelTransport("not-an-image");
    throw new Error("not-an-image");
  }
  if (Number.isFinite(advertisedLength) && advertisedLength > maxBytes) {
    await cancelTransport("cover-too-large");
    throw new Error("cover-too-large");
  }
  if (signal.aborted) {
    await cancelTransport("cancelled");
    throw new Error("cancelled");
  }
  if (!response.body) {
    await cancelTransport("missing-stream");
    throw new Error("missing-stream");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  const onAbort = () => void cancelTransport("cancelled");
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      if (signal.aborted) {
        await cancelTransport("cancelled");
        throw new Error("cancelled");
      }
      const next = await reader.read();
      if (signal.aborted) {
        await cancelTransport("cancelled");
        throw new Error("cancelled");
      }
      if (next.done) break;
      byteLength += next.value.byteLength;
      if (byteLength > maxBytes) {
        await cancelTransport("cover-too-large");
        throw new Error("cover-too-large");
      }
      chunks.push(next.value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { uri: `data:${contentType};base64,${bytesToBase64(bytes)}`, byteLength };
}

interface CacheEntry extends OpdsCoverValue {
  references: number;
  lastUsed: number;
}

interface InFlightEntry {
  controller: AbortController;
  promise: Promise<OpdsCoverValue>;
  waiters: number;
}

export function createOpdsCoverCache({
  load,
  maxEntries,
  maxBytes,
  maxConcurrentLoads = 4,
}: {
  load(url: string, signal: AbortSignal): Promise<OpdsCoverValue>;
  maxEntries: number;
  maxBytes: number;
  maxConcurrentLoads?: number;
}) {
  const entries = new Map<string, CacheEntry>();
  const inFlight = new Map<string, InFlightEntry>();
  let sourceBytes = 0;
  let clock = 0;
  let generation = 0;
  let activeLoads = 0;
  const queuedLoads: Array<() => void> = [];

  const runQueuedLoads = () => {
    const limit = Math.max(1, maxConcurrentLoads);
    while (activeLoads < limit) {
      const start = queuedLoads.shift();
      if (!start) return;
      activeLoads += 1;
      start();
    }
  };

  const scheduleLoad = (url: string, signal: AbortSignal): Promise<OpdsCoverValue> =>
    new Promise((resolve, reject) => {
      queuedLoads.push(() => {
        if (signal.aborted) {
          activeLoads -= 1;
          reject(new Error("cancelled"));
          runQueuedLoads();
          return;
        }
        void load(url, signal)
          .then(resolve, reject)
          .finally(() => {
            activeLoads -= 1;
            runQueuedLoads();
          });
      });
      runQueuedLoads();
    });

  const evict = () => {
    while (entries.size > maxEntries || sourceBytes > maxBytes) {
      const candidate = [...entries.entries()]
        .filter(([, entry]) => entry.references === 0)
        .sort(([, left], [, right]) => left.lastUsed - right.lastUsed)[0];
      if (!candidate) return;
      entries.delete(candidate[0]);
      sourceBytes -= candidate[1].byteLength;
    }
  };

  const lease = (entry: CacheEntry): OpdsCoverLease => {
    entry.references += 1;
    entry.lastUsed = ++clock;
    let released = false;
    return {
      uri: entry.uri,
      release() {
        if (released) return;
        released = true;
        entry.references = Math.max(0, entry.references - 1);
        entry.lastUsed = ++clock;
        evict();
      },
    };
  };

  return {
    async acquire(url: string, signal?: AbortSignal): Promise<OpdsCoverLease> {
      const acquisitionGeneration = generation;
      if (signal?.aborted) throw new Error("cancelled");
      const cached = entries.get(url);
      if (cached) return lease(cached);

      let pending = inFlight.get(url);
      if (!pending) {
        const controller = new AbortController();
        const promise = scheduleLoad(url, controller.signal).finally(() => {
          if (inFlight.get(url)?.promise === promise) inFlight.delete(url);
        });
        pending = { controller, promise, waiters: 0 };
        inFlight.set(url, pending);
      }
      pending.waiters += 1;
      let settled = false;
      let rejectCancelled: ((error: Error) => void) | undefined;
      const cancelled = new Promise<never>((_resolve, reject) => {
        rejectCancelled = reject;
      });
      const onAbort = () => rejectCancelled?.(new Error("cancelled"));
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const value = await Promise.race([pending.promise, cancelled]);
        settled = true;
        if (acquisitionGeneration !== generation) throw new Error("cancelled");
        let entry = entries.get(url);
        if (!entry && value.byteLength <= maxBytes && maxEntries > 0) {
          while (entries.size >= maxEntries || sourceBytes + value.byteLength > maxBytes) {
            const candidate = [...entries.entries()]
              .filter(([, cached]) => cached.references === 0)
              .sort(([, left], [, right]) => left.lastUsed - right.lastUsed)[0];
            if (!candidate) break;
            entries.delete(candidate[0]);
            sourceBytes -= candidate[1].byteLength;
          }
          if (entries.size < maxEntries && sourceBytes + value.byteLength <= maxBytes) {
            entry = { ...value, references: 0, lastUsed: ++clock };
            entries.set(url, entry);
            sourceBytes += value.byteLength;
          }
        }
        return entry ? lease(entry) : { uri: value.uri, release() {} };
      } finally {
        signal?.removeEventListener("abort", onAbort);
        pending.waiters = Math.max(0, pending.waiters - 1);
        if (!settled && pending.waiters === 0) pending.controller.abort();
      }
    },
    clear(): void {
      generation += 1;
      for (const pending of inFlight.values()) pending.controller.abort();
      inFlight.clear();
      entries.clear();
      sourceBytes = 0;
    },
    snapshot() {
      return { entries: entries.size, sourceBytes, urls: [...entries.keys()] };
    },
  };
}
