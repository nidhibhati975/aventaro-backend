import AsyncStorage from '@react-native-async-storage/async-storage';
import { errorLogger } from './errorLogger';

interface CacheEnvelope<T> {
  cachedAt: number;
  value: T;
}

const CACHE_INDEX_KEY = 'aventaro.cache.index';
const inflightRequests = new Map<string, Promise<unknown>>();

async function readCacheIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_INDEX_KEY);
    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch (parseError) {
      errorLogger.logAsyncStorageError(parseError, CACHE_INDEX_KEY, 'parseIndex');
      await AsyncStorage.removeItem(CACHE_INDEX_KEY);
      return [];
    }
  } catch (error) {
    errorLogger.logAsyncStorageError(error, CACHE_INDEX_KEY, 'readIndex');
    return [];
  }
}

async function writeCacheIndex(keys: string[]): Promise<void> {
  try {
    await AsyncStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(Array.from(new Set(keys)).sort()));
  } catch (error) {
    errorLogger.logAsyncStorageError(error, CACHE_INDEX_KEY, 'writeIndex');
    // Don't throw - allow app to continue even if index write fails
  }
}

async function rememberCacheKey(key: string): Promise<void> {
  try {
    const keys = await readCacheIndex();
    if (!keys.includes(key)) {
      keys.push(key);
      await writeCacheIndex(keys);
    }
  } catch (error) {
    errorLogger.logAsyncStorageError(error, key, 'rememberKey');
  }
}

async function forgetCacheKey(key: string): Promise<void> {
  try {
    const keys = await readCacheIndex();
    const filteredKeys = keys.filter((item) => item !== key);
    if (filteredKeys.length !== keys.length) {
      await writeCacheIndex(filteredKeys);
    }
  } catch (error) {
    errorLogger.logAsyncStorageError(error, key, 'forgetKey');
  }
}

export async function readCachedValue<T>(key: string, ttlMs: number): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) {
      return null;
    }

    try {
      const envelope = JSON.parse(raw) as CacheEnvelope<T>;
      
      // Validate envelope structure
      if (!envelope || typeof envelope.cachedAt !== 'number' || !Object.prototype.hasOwnProperty.call(envelope, 'value')) {
        throw new Error('Invalid cache envelope structure');
      }

      if (Date.now() - envelope.cachedAt > ttlMs) {
        await AsyncStorage.removeItem(key);
        await forgetCacheKey(key);
        return null;
      }
      return envelope.value;
    } catch (parseError) {
      errorLogger.logAsyncStorageError(parseError, key, 'parseValue');
      // Try to clear corrupted entry
      try {
        await AsyncStorage.removeItem(key);
        await forgetCacheKey(key);
      } catch {
        // Silent failure
      }
      return null;
    }
  } catch (error) {
    errorLogger.logAsyncStorageError(error, key, 'readValue');
    return null;
  }
}

export async function writeCachedValue<T>(key: string, value: T): Promise<void> {
  try {
    const envelope: CacheEnvelope<T> = {
      cachedAt: Date.now(),
      value,
    };
    await AsyncStorage.setItem(key, JSON.stringify(envelope));
    await rememberCacheKey(key);
  } catch (error) {
    errorLogger.logAsyncStorageError(error, key, 'writeValue');
    // Don't throw - allow app to continue even if cache write fails
  }
}

export async function removeCachedValue(key: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(key);
    await forgetCacheKey(key);
  } catch (error) {
    errorLogger.logAsyncStorageError(error, key, 'removeValue');
  }
}

export async function invalidateCacheByPrefix(prefix: string): Promise<void> {
  try {
    const keys = await readCacheIndex();
    const targets = keys.filter((key) => key.startsWith(prefix));

    if (targets.length === 0) {
      return;
    }

    await AsyncStorage.multiRemove(targets);
    await writeCacheIndex(keys.filter((key) => !key.startsWith(prefix)));
  } catch (error) {
    errorLogger.logAsyncStorageError(error, prefix, 'invalidateByPrefix');
  }
}

export async function invalidateCacheByPrefixes(prefixes: string[]): Promise<void> {
  for (const prefix of prefixes) {
    await invalidateCacheByPrefix(prefix);
  }
}

export async function clearCachedValues(): Promise<void> {
  try {
    const keys = await readCacheIndex();
    if (keys.length > 0) {
      await AsyncStorage.multiRemove(keys);
    }
    await AsyncStorage.removeItem(CACHE_INDEX_KEY);
  } catch (error) {
    errorLogger.logAsyncStorageError(error, CACHE_INDEX_KEY, 'clearAll');
  }
}

export async function getCachedOrFetch<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>
): Promise<T> {
  try {
    const cached = await readCachedValue<T>(key, ttlMs);
    if (cached !== null) {
      return cached;
    }

    const existingRequest = inflightRequests.get(key) as Promise<T> | undefined;
    if (existingRequest) {
      return existingRequest;
    }

    const request = (async () => {
      const fresh = await fetcher();
      
      // Validate fetched data
      if (fresh === null || fresh === undefined) {
        throw new Error('Fetcher returned null or undefined');
      }

      await writeCachedValue(key, fresh);
      return fresh;
    })();

    inflightRequests.set(key, request);

    try {
      return await request;
    } finally {
      inflightRequests.delete(key);
    }
  } catch (error) {
    errorLogger.logError(error, { source: 'Cache', context: { key, operation: 'getCachedOrFetch' } });
    // Attempt to call fetcher directly as fallback
    try {
      return await fetcher();
    } catch (fetchError) {
      errorLogger.logError(fetchError, { source: 'Cache', context: { key, operation: 'fetcherFallback' } });
      throw fetchError;
    }
  }
}
