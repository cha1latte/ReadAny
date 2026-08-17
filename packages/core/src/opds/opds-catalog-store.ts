import type { IPlatformService } from "../services/platform";
import { generateId } from "../utils/generate-id";
import { classifyOpdsUrl } from "./opds-security";
import type { OpdsCredentials } from "./opds-types";

export const OPDS_CATALOG_STORAGE_KEY = "opds.catalogs.v1";

export type OpdsCatalogAuth = "anonymous" | "basic";
export type OpdsPasswordStorage = "none" | "persistent" | "session-only";

export interface OpdsCatalog {
  readonly id: string;
  readonly name: string;
  readonly url: string;
  readonly enabled: boolean;
  readonly builtIn: boolean;
  readonly hidden: boolean;
  readonly auth: OpdsCatalogAuth;
  readonly username?: string;
  readonly passwordStorage: OpdsPasswordStorage;
}

export interface OpdsCatalogInput {
  name: string;
  url: string;
  enabled?: boolean;
  auth: OpdsCatalogAuth;
  username?: string;
  password?: string;
}

export interface OpdsCatalogUpdate {
  name?: string;
  url?: string;
  enabled?: boolean;
  auth?: OpdsCatalogAuth;
  username?: string;
  password?: string;
}

export type OpdsCatalogStorage = Pick<
  IPlatformService,
  "kvGetItem" | "kvSetItem" | "secretGetItem" | "secretSetItem" | "secretRemoveItem"
>;

interface BuiltInCatalogDefinition {
  readonly id: "gutenberg" | "gutenberg-zh";
  readonly name: string;
  readonly url: string;
}

export const OPDS_BUILT_IN_CATALOGS: readonly BuiltInCatalogDefinition[] = Object.freeze([
  Object.freeze({
    id: "gutenberg",
    name: "Project Gutenberg",
    url: "https://www.gutenberg.org/ebooks/search.opds/",
  }),
  Object.freeze({
    id: "gutenberg-zh",
    name: "Project Gutenberg — Chinese Books",
    url: "https://www.gutenberg.org/ebooks/search.opds/?query=l.zh",
  }),
]);

interface CustomCatalogDefinition {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  auth: OpdsCatalogAuth;
  username?: string;
}

interface PersistedCatalogsV1 {
  version: 1;
  customCatalogs: CustomCatalogDefinition[];
  hiddenBuiltInIds: string[];
}

const CUSTOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const builtInIds = new Set<string>(OPDS_BUILT_IN_CATALOGS.map(({ id }) => id));

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const name = value.trim();
  return name.length > 0 ? name : undefined;
}

function normalizeUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const classification = classifyOpdsUrl(value);
  if (!classification.allowed) return undefined;
  try {
    return new URL(value).href;
  } catch {
    return undefined;
  }
}

function normalizeCustomCatalog(value: unknown): CustomCatalogDefinition | undefined {
  if (!isRecord(value)) return undefined;
  const id = typeof value.id === "string" ? value.id : "";
  const name = normalizeName(value.name);
  const url = normalizeUrl(value.url);
  const auth = value.auth;
  if (
    !CUSTOM_ID_PATTERN.test(id) ||
    builtInIds.has(id) ||
    !name ||
    !url ||
    typeof value.enabled !== "boolean" ||
    (auth !== "anonymous" && auth !== "basic")
  ) {
    return undefined;
  }

  const username = typeof value.username === "string" ? value.username : undefined;
  return {
    id,
    name,
    url,
    enabled: value.enabled,
    auth,
    ...(auth === "basic" && username !== undefined ? { username } : {}),
  };
}

export function opdsCatalogSecretKey(catalogId: string): string {
  if (!CUSTOM_ID_PATTERN.test(catalogId)) {
    throw new Error("Invalid custom catalog id");
  }
  return `opds.catalog.${catalogId}.password`;
}

export class OpdsCatalogStore {
  private readonly customCatalogs = new Map<string, CustomCatalogDefinition>();
  private readonly hiddenBuiltInIds = new Set<string>();
  private readonly sessionPasswords = new Map<string, string>();
  private readonly passwordStorage = new Map<string, Exclude<OpdsPasswordStorage, "none">>();

  constructor(
    private readonly storage: OpdsCatalogStorage,
    private readonly createId: () => string = generateId,
  ) {}

  async load(): Promise<void> {
    this.customCatalogs.clear();
    this.hiddenBuiltInIds.clear();

    let raw: string | null;
    try {
      raw = await this.storage.kvGetItem(OPDS_CATALOG_STORAGE_KEY);
    } catch {
      return;
    }
    if (!raw) return;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    if (!isRecord(parsed) || parsed.version !== 1) return;

    if (Array.isArray(parsed.hiddenBuiltInIds)) {
      for (const id of parsed.hiddenBuiltInIds) {
        if (typeof id === "string" && builtInIds.has(id)) this.hiddenBuiltInIds.add(id);
      }
    }

    if (Array.isArray(parsed.customCatalogs)) {
      for (const value of parsed.customCatalogs) {
        const catalog = normalizeCustomCatalog(value);
        if (catalog && !this.customCatalogs.has(catalog.id)) {
          this.customCatalogs.set(catalog.id, catalog);
        }
      }
    }
    // Rewrite the validated projection so unknown or malicious fields do not remain in general KV.
    await this.persist().catch(() => undefined);
  }

  listCatalogs(options: { includeHidden?: boolean } = {}): OpdsCatalog[] {
    const builtIns = OPDS_BUILT_IN_CATALOGS.map((definition) =>
      this.toBuiltInCatalog(definition),
    ).filter((catalog) => options.includeHidden || !catalog.hidden);
    const custom = Array.from(this.customCatalogs.values(), (definition) =>
      this.toCustomCatalog(definition),
    );
    return [...builtIns, ...custom];
  }

  getCatalog(id: string): OpdsCatalog | undefined {
    const builtIn = OPDS_BUILT_IN_CATALOGS.find((catalog) => catalog.id === id);
    if (builtIn) return this.toBuiltInCatalog(builtIn);
    const custom = this.customCatalogs.get(id);
    return custom ? this.toCustomCatalog(custom) : undefined;
  }

  async addCatalog(input: OpdsCatalogInput): Promise<OpdsCatalog> {
    const id = this.createId();
    if (!CUSTOM_ID_PATTERN.test(id) || builtInIds.has(id) || this.customCatalogs.has(id)) {
      throw new Error("Could not generate a unique catalog id");
    }
    const catalog = this.catalogFromInput(id, input);
    this.customCatalogs.set(id, catalog);
    await this.persist();
    if (input.password) await this.storePassword(id, input.password);
    return this.toCustomCatalog(catalog);
  }

  async updateCatalog(id: string, update: OpdsCatalogUpdate): Promise<OpdsCatalog> {
    if (builtInIds.has(id)) throw new Error("Built-in catalogs cannot be edited");
    const current = this.customCatalogs.get(id);
    if (!current) throw new Error("Catalog not found");

    const next = this.catalogFromInput(id, {
      name: update.name ?? current.name,
      url: update.url ?? current.url,
      enabled: update.enabled ?? current.enabled,
      auth: update.auth ?? current.auth,
      username: update.username ?? current.username,
    });
    const identityChanged =
      next.url !== current.url || next.auth !== current.auth || next.username !== current.username;
    if (identityChanged || update.password !== undefined) {
      await this.removePassword(id);
    }

    this.customCatalogs.set(id, next);
    await this.persist();
    if (next.auth === "basic" && update.password) {
      await this.storePassword(id, update.password);
    }
    return this.toCustomCatalog(next);
  }

  async setCatalogEnabled(id: string, enabled: boolean): Promise<OpdsCatalog> {
    return this.updateCatalog(id, { enabled });
  }

  async removeCatalog(id: string): Promise<boolean> {
    if (builtInIds.has(id)) throw new Error("Built-in catalogs cannot be deleted");
    if (!this.customCatalogs.has(id)) return false;
    await this.removePassword(id);
    this.customCatalogs.delete(id);
    await this.persist();
    return true;
  }

  async hideBuiltIn(id: string): Promise<void> {
    this.requireBuiltIn(id);
    this.hiddenBuiltInIds.add(id);
    await this.persist();
  }

  async restoreBuiltIn(id: string): Promise<void> {
    this.requireBuiltIn(id);
    this.hiddenBuiltInIds.delete(id);
    await this.persist();
  }

  async getCredentials(id: string): Promise<OpdsCredentials | undefined> {
    const catalog = this.customCatalogs.get(id);
    if (!catalog || catalog.auth !== "basic") return undefined;

    let password = this.sessionPasswords.get(id);
    const { secretGetItem, secretSetItem, secretRemoveItem } = this.storage;
    if (!password && secretGetItem && secretSetItem && secretRemoveItem) {
      try {
        password = (await secretGetItem(opdsCatalogSecretKey(id))) ?? undefined;
        if (password) this.passwordStorage.set(id, "persistent");
      } catch {
        password = undefined;
      }
    }
    if (!password) return undefined;
    return {
      username: catalog.username ?? "",
      password,
      catalogOrigin: new URL(catalog.url).origin,
    };
  }

  private catalogFromInput(
    id: string,
    input: Omit<OpdsCatalogInput, "password">,
  ): CustomCatalogDefinition {
    const name = normalizeName(input.name);
    const url = normalizeUrl(input.url);
    if (!name) throw new Error("Catalog name is required");
    if (!url) throw new Error("Catalog URL is not allowed");
    if (input.auth !== "anonymous" && input.auth !== "basic") {
      throw new Error("Catalog authentication type is invalid");
    }
    return {
      id,
      name,
      url,
      enabled: input.enabled ?? true,
      auth: input.auth,
      ...(input.auth === "basic" ? { username: input.username ?? "" } : {}),
    };
  }

  private async storePassword(id: string, password: string): Promise<void> {
    const { secretGetItem, secretSetItem, secretRemoveItem } = this.storage;
    if (secretGetItem && secretSetItem && secretRemoveItem) {
      try {
        await secretSetItem(opdsCatalogSecretKey(id), password);
        this.sessionPasswords.delete(id);
        this.passwordStorage.set(id, "persistent");
        return;
      } catch {
        // A secret backend failure intentionally degrades to an explicit in-memory session secret.
      }
    }
    this.sessionPasswords.set(id, password);
    this.passwordStorage.set(id, "session-only");
  }

  private async removePassword(id: string): Promise<void> {
    if (this.storage.secretRemoveItem) {
      await this.storage.secretRemoveItem(opdsCatalogSecretKey(id));
    }
    this.sessionPasswords.delete(id);
    this.passwordStorage.delete(id);
  }

  private async persist(): Promise<void> {
    const value: PersistedCatalogsV1 = {
      version: 1,
      customCatalogs: Array.from(this.customCatalogs.values(), (catalog) => ({ ...catalog })),
      hiddenBuiltInIds: Array.from(this.hiddenBuiltInIds),
    };
    await this.storage.kvSetItem(OPDS_CATALOG_STORAGE_KEY, JSON.stringify(value));
  }

  private requireBuiltIn(id: string): void {
    if (!builtInIds.has(id)) throw new Error("Built-in catalog not found");
  }

  private toBuiltInCatalog(definition: BuiltInCatalogDefinition): OpdsCatalog {
    return {
      ...definition,
      enabled: true,
      builtIn: true,
      hidden: this.hiddenBuiltInIds.has(definition.id),
      auth: "anonymous",
      passwordStorage: "none",
    };
  }

  private toCustomCatalog(definition: CustomCatalogDefinition): OpdsCatalog {
    return {
      ...definition,
      builtIn: false,
      hidden: false,
      passwordStorage: this.passwordStorage.get(definition.id) ?? "none",
    };
  }
}
