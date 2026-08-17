import { describe, expect, it } from "vitest";
import { VectorizationQueue } from "./vectorization-queue";

describe("VectorizationQueue", () => {
  it("removes a queued book without disturbing the active job", () => {
    const queue = new VectorizationQueue<{ id: string }>();
    queue.enqueue({ id: "active" });
    queue.enqueue({ id: "queued" });
    const active = queue.startNext();

    expect(queue.cancel("queued")).toBe("queued");
    expect(active?.book.id).toBe("active");
    expect(active?.signal.aborted).toBe(false);
    expect(queue.snapshot()).toEqual([]);
  });

  it("aborts the active job and keeps it active until cleanup finishes", () => {
    const queue = new VectorizationQueue<{ id: string }>();
    queue.enqueue({ id: "active" });
    const active = queue.startNext();

    expect(queue.cancel("active")).toBe("active");
    expect(active?.signal.aborted).toBe(true);
    expect(queue.activeBookId).toBe("active");

    queue.finish("active");
    expect(queue.activeBookId).toBeNull();
  });
});
