import AsyncStorage from '@react-native-async-storage/async-storage';

import api, { getApiData } from './api';
import { invalidateCacheByPrefixes } from './cache';
import { errorLogger } from './errorLogger';
import type { BoostRecord } from './types';

type BoostType = 'profile' | 'trip';

const BOOST_STORAGE_PREFIX = 'aventaro.activeBoost';

function getStorageKey(boostType: BoostType) {
  return `${BOOST_STORAGE_PREFIX}:${boostType}`;
}

async function persistBoost(boost: BoostRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(getStorageKey(boost.boost_type), JSON.stringify(boost));
  } catch (error) {
    errorLogger.logAsyncStorageError(error, getStorageKey(boost.boost_type), 'persistBoost');
  }
}

async function clearBoost(boostType: BoostType): Promise<void> {
  try {
    await AsyncStorage.removeItem(getStorageKey(boostType));
  } catch (error) {
    errorLogger.logAsyncStorageError(error, getStorageKey(boostType), 'clearBoost');
  }
}

export async function getActiveBoost(boostType: BoostType): Promise<BoostRecord | null> {
  try {
    const rawValue = await AsyncStorage.getItem(getStorageKey(boostType));
    if (!rawValue) {
      return null;
    }

    const boost = JSON.parse(rawValue) as BoostRecord;
    if (!boost.expires_at || Date.parse(boost.expires_at) <= Date.now()) {
      await clearBoost(boostType);
      return null;
    }
    return boost;
  } catch (error) {
    errorLogger.logAsyncStorageError(error, getStorageKey(boostType), 'getActiveBoost');
    await clearBoost(boostType);
    return null;
  }
}

export async function activateProfileBoost(): Promise<BoostRecord> {
  const response = await api.post('/boost/profile');
  const boost = getApiData<BoostRecord>(response);
  await persistBoost(boost);
  await invalidateCacheByPrefixes(['discover:people', 'profile:me']);
  return boost;
}

export async function activateTripBoost(): Promise<BoostRecord> {
  const response = await api.post('/boost/trip');
  const boost = getApiData<BoostRecord>(response);
  await persistBoost(boost);
  await invalidateCacheByPrefixes(['discover:trips', 'trips:all']);
  return boost;
}
