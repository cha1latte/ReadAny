import { describe, expect, it, vi } from "vitest";
import {
  OPDS_BUILT_IN_CATALOGS,
  OPDS_CATALOG_STORAGE_KEY,
  type OpdsCatalogStorage,
  OpdsCatalogStore,
  opdsCatalogSecretKey,
} from "./opds-catalog-store";

const CUSTOM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ID = "22222222-2222-4222-8222-222222222222";

function createStorage(initial: string | null = null) {
  let persisted = initial;
  const secrets = new Map<string, string>();
  const storage = {
    kvGetItem: vi.fn(async () => persisted),
    kvSetItem: vi.fn(async (_key: string, value: string) => {
      persisted = value;
    }),
    secretGetItem: vi.fn(async (key: string) => secrets.get(key) ?? null),
    secretSetItem: vi.fn(async (key: string, value: string) => {
      secrets.set(key, value);
    }),
    secretRemoveItem: vi.fn(async (key: string) => {
      secrets.delete(key);
    }),
  } satisfies OpdsCatalogStorage;
  return { storage, secrets, persisted: () => persisted };
}

describe("OpdsCatalogStore", () => {
  it("provides the two stable Gutenberg catalogs with immutable URLs", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    expect(OPDS_BUILT_IN_CATALOGS.map(({ id, url }) => ({ id, url }))).toEqual([
      { id: "gutenberg", url: "https://www.gutenberg.org/ebooks/search.opds/" },
      {
        id: "gutenberg-zh",
        url: "https://www.gutenberg.org/ebooks/search.opds/?query=l.zh",
      },
    ]);
    expect(store.getCatalog("gutenberg-zh")?.url).toBe(
      "https://www.gutenberg.org/ebooks/search.opds/?query=l.zh",
    );
    await expect(
      store.updateCatalog("gutenberg", { url: "https://attacker.test/catalog" }),
    ).rejects.toThrow("Built-in catalogs cannot be edited");
    expect(store.getCatalog("gutenberg")?.url).toBe(
      "https://www.gutenberg.org/ebooks/search.opds/",
    );
  });

  it("adds, edits, disables, enables, and deletes a custom catalog", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    const catalog = await store.addCatalog({
      name: "My catalog",
      url: "https://catalog.test/opds",
      auth: "anonymous",
    });
    expect(catalog).toMatchObject({ id: CUSTOM_ID, enabled: true, builtIn: false });

    await store.updateCatalog(CUSTOM_ID, { name: "Renamed" });
    await store.setCatalogEnabled(CUSTOM_ID, false);
    expect(store.getCatalog(CUSTOM_ID)).toMatchObject({ name: "Renamed", enabled: false });
    await store.setCatalogEnabled(CUSTOM_ID, true);
    expect(store.getCatalog(CUSTOM_ID)?.enabled).toBe(true);

    await store.removeCatalog(CUSTOM_ID);
    expect(store.getCatalog(CUSTOM_ID)).toBeUndefined();
  });

  it("persists only versioned definitions and built-in hidden state, never passwords", async () => {
    const { storage, persisted } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "secret-password",
    });
    await store.hideBuiltIn("gutenberg");

    const raw = persisted();
    expect(storage.kvSetItem).toHaveBeenCalledWith(OPDS_CATALOG_STORAGE_KEY, expect.any(String));
    expect(raw).not.toBeNull();
    expect(raw).not.toContain("secret-password");
    expect(raw).not.toContain("Authorization");
    expect(JSON.parse(raw ?? "{}")).toEqual({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Private",
          url: "https://catalog.test/opds",
          enabled: true,
          auth: "basic",
          username: "reader",
        },
      ],
      hiddenBuiltInIds: ["gutenberg"],
    });
  });

  it("hides and restores built-ins without deleting their definitions", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    await store.hideBuiltIn("gutenberg-zh");
    expect(store.listCatalogs().map((catalog) => catalog.id)).not.toContain("gutenberg-zh");
    expect(store.getCatalog("gutenberg-zh")?.hidden).toBe(true);
    await store.restoreBuiltIn("gutenberg-zh");
    expect(store.listCatalogs().map((catalog) => catalog.id)).toContain("gutenberg-zh");
  });

  it("removes a catalog secret on delete and treats a missing secret as idempotent", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
    });

    await expect(store.removeCatalog(CUSTOM_ID)).resolves.toBe(true);
    expect(storage.secretRemoveItem).toHaveBeenCalledWith(`opds.catalog.${CUSTOM_ID}.password`);
    await expect(store.removeCatalog(CUSTOM_ID)).resolves.toBe(false);
  });

  it("clears the old secret when URL or auth identity changes but retains it for display edits", async () => {
    const { storage } = createStorage();
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();
    await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "secret-password",
    });
    vi.mocked(storage.secretRemoveItem).mockClear();

    await store.updateCatalog(CUSTOM_ID, { name: "Still private" });
    expect(storage.secretRemoveItem).not.toHaveBeenCalled();
    await store.updateCatalog(CUSTOM_ID, { url: "https://other.test/opds" });
    expect(storage.secretRemoveItem).toHaveBeenCalledWith(opdsCatalogSecretKey(CUSTOM_ID));

    vi.mocked(storage.secretRemoveItem).mockClear();
    await store.updateCatalog(CUSTOM_ID, { auth: "anonymous" });
    expect(storage.secretRemoveItem).toHaveBeenCalledWith(opdsCatalogSecretKey(CUSTOM_ID));
  });

  it("uses a per-instance session password when secret persistence is unavailable", async () => {
    const { storage: persistentStorage } = createStorage();
    const storage: OpdsCatalogStorage = {
      kvGetItem: persistentStorage.kvGetItem,
      kvSetItem: persistentStorage.kvSetItem,
    };
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    const catalog = await store.addCatalog({
      name: "Session catalog",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "session-password",
    });
    expect(catalog.passwordStorage).toBe("session-only");
    await expect(store.getCredentials(CUSTOM_ID)).resolves.toEqual({
      username: "reader",
      password: "session-password",
      catalogOrigin: "https://catalog.test",
    });

    const reloaded = new OpdsCatalogStore(storage, () => OTHER_ID);
    await reloaded.load();
    expect(reloaded.getCatalog(CUSTOM_ID)?.passwordStorage).toBe("none");
    await expect(reloaded.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
  });

  it("falls back to session-only without leaking a password when secret storage fails", async () => {
    const { storage, persisted } = createStorage();
    vi.mocked(storage.secretSetItem).mockRejectedValue(new Error("backend included a secret"));
    const store = new OpdsCatalogStore(storage, () => CUSTOM_ID);
    await store.load();

    const catalog = await store.addCatalog({
      name: "Private",
      url: "https://catalog.test/opds",
      auth: "basic",
      username: "reader",
      password: "never-persist-me",
    });

    expect(catalog.passwordStorage).toBe("session-only");
    expect(persisted()).not.toContain("never-persist-me");
    expect(JSON.stringify(store.listCatalogs({ includeHidden: true }))).not.toContain(
      "never-persist-me",
    );
  });

  it("treats a partial secret adapter as unavailable instead of reusing an unremovable secret", async () => {
    const persisted = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Private",
          url: "https://catalog.test/opds",
          enabled: true,
          auth: "basic",
          username: "reader",
        },
      ],
      hiddenBuiltInIds: [],
    });
    const { storage: completeStorage, secrets } = createStorage(persisted);
    secrets.set(opdsCatalogSecretKey(CUSTOM_ID), "stale-password");
    const partialStorage: OpdsCatalogStorage = {
      kvGetItem: completeStorage.kvGetItem,
      kvSetItem: completeStorage.kvSetItem,
      secretGetItem: completeStorage.secretGetItem,
      secretSetItem: completeStorage.secretSetItem,
    };
    const store = new OpdsCatalogStore(partialStorage, () => OTHER_ID);
    await store.load();

    await expect(store.getCredentials(CUSTOM_ID)).resolves.toBeUndefined();
    const added = await store.addCatalog({
      name: "Session only",
      url: "https://other.test/opds",
      auth: "basic",
      username: "reader",
      password: "session-password",
    });
    expect(added.passwordStorage).toBe("session-only");
  });

  it("loads valid records while discarding userinfo URLs, invalid IDs, pollution keys, and duplicates", async () => {
    const persisted = JSON.stringify({
      version: 1,
      customCatalogs: [
        {
          id: CUSTOM_ID,
          name: "Good",
          url: "https://catalog.test/opds?query=books",
          enabled: true,
          auth: "anonymous",
        },
        {
          id: OTHER_ID,
          name: "Malicious URL",
          url: "https://user:password@catalog.test/opds",
          enabled: true,
          auth: "anonymous",
        },
        {
          id: "__proto__",
          name: "Pollution",
          url: "https://pollution.test/opds",
          enabled: true,
          auth: "anonymous",
        },
        {
          id: "gutenberg",
          name: "Fake built-in",
          url: "https://attacker.test/opds",
          enabled: true,
          auth: "anonymous",
        },
        {
          id: CUSTOM_ID,
          name: "Duplicate",
          url: "https://duplicate.test/opds",
          enabled: true,
          auth: "anonymous",
        },
      ],
      hiddenBuiltInIds: ["gutenberg-zh", "gutenberg-zh", "__proto__"],
      password: "must-be-ignored",
    });
    const { storage, persisted: saved } = createStorage(persisted);
    const store = new OpdsCatalogStore(storage, () => OTHER_ID);

    await expect(store.load()).resolves.toBeUndefined();
    expect(store.listCatalogs({ includeHidden: true }).map((catalog) => catalog.id)).toEqual([
      "gutenberg",
      "gutenberg-zh",
      CUSTOM_ID,
    ]);
    expect(store.getCatalog(CUSTOM_ID)?.url).toBe("https://catalog.test/opds?query=books");
    expect(store.getCatalog("gutenberg-zh")?.hidden).toBe(true);
    expect(Object.prototype.polluted).toBeUndefined();
    expect(saved()).not.toContain("must-be-ignored");
    expect(saved()).not.toContain("user:password");
  });

  it("does not collide secret keys for distinct catalog IDs", () => {
    expect(opdsCatalogSecretKey(CUSTOM_ID)).toBe(`opds.catalog.${CUSTOM_ID}.password`);
    expect(opdsCatalogSecretKey(OTHER_ID)).toBe(`opds.catalog.${OTHER_ID}.password`);
    expect(opdsCatalogSecretKey(CUSTOM_ID)).not.toBe(opdsCatalogSecretKey(OTHER_ID));
  });
});
