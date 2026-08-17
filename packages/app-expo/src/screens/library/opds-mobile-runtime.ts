import { OpdsCatalogStore, OpdsClient, getPlatformService } from "@readany/core";
import type { IPlatformService } from "@readany/core/services";

export function createOpdsMobileRuntime(resolvePlatform: () => IPlatformService) {
  let activePlatform: IPlatformService | undefined;
  let catalogStore: OpdsCatalogStore | undefined;
  let client: OpdsClient | undefined;
  let loadPromise: Promise<void> | undefined;

  const prepare = (): { catalogStore: OpdsCatalogStore; client: OpdsClient } => {
    const platform = resolvePlatform();
    if (platform !== activePlatform || !catalogStore || !client) {
      activePlatform = platform;
      catalogStore = new OpdsCatalogStore(platform);
      client = new OpdsClient(platform);
      loadPromise = undefined;
    }
    return { catalogStore, client };
  };

  return {
    getCatalogStore(): OpdsCatalogStore {
      return prepare().catalogStore;
    },
    getClient(): OpdsClient {
      return prepare().client;
    },
    async ensureCatalogsLoaded(): Promise<void> {
      const currentStore = prepare().catalogStore;
      if (loadPromise) return loadPromise;
      const pending = currentStore.load();
      loadPromise = pending;
      try {
        await pending;
      } catch (error) {
        if (loadPromise === pending) loadPromise = undefined;
        throw error;
      }
    },
  };
}

export const opdsMobileRuntime = createOpdsMobileRuntime(getPlatformService);
