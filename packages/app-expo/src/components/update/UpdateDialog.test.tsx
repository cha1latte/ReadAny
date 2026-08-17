import { describe, expect, it, vi } from "vitest";
import { createUpdateInstallOwner } from "../../lib/shlai-apk-installer";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("UpdateDialog install ownership", () => {
  it("prevents a second installer request while the first is active", async () => {
    const owner = createUpdateInstallOwner();
    const pending = deferred();
    const install = vi.fn(() => pending.promise);

    const first = owner.run(install);
    await expect(owner.run(install)).resolves.toBe(false);
    expect(install).toHaveBeenCalledTimes(1);

    pending.resolve();
    await expect(first).resolves.toBe(true);
    await expect(owner.run(async () => undefined)).resolves.toBe(true);
  });
});
