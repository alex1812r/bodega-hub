import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";

/**
 * Cache persistida: es lo que permite abrir la app sin red y seguir viendo lo
 * ultimo que se cargo. Solo lecturas; las mutaciones se bloquean (`mutationGuard`).
 */
export const queryPersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: "bodegahub.query-cache",
  throttleTime: 2000,
});

/** 24 h: mas alla de eso los precios y el stock ya no son fiables. */
export const persistedCacheMaxAge = 24 * 60 * 60 * 1000;
