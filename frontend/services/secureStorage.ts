import * as Keychain from 'react-native-keychain';
import { errorLogger } from './errorLogger';

const AUTH_SERVICE = 'com.aventaro.auth';
const AUTH_USERNAME = 'aventaro_user';

export interface StoredAuthTokens {
  accessToken: string;
  refreshToken: string | null;
}

function safeParseTokens(value: string): StoredAuthTokens | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredAuthTokens>;
    if (!parsed?.accessToken || typeof parsed.accessToken !== 'string') {
      return null;
    }
    return {
      accessToken: parsed.accessToken,
      refreshToken: typeof parsed.refreshToken === 'string' ? parsed.refreshToken : null,
    };
  } catch (error) {
    errorLogger.logError(error, { source: 'SecureStorage', context: { action: 'parse' } });
    return null;
  }
}

export async function setAuthTokensInKeychain(
  accessToken: string,
  refreshToken?: string | null
): Promise<void> {
  const payload: StoredAuthTokens = {
    accessToken,
    refreshToken: refreshToken || null,
  };

  try {
    await Keychain.setGenericPassword(AUTH_USERNAME, JSON.stringify(payload), {
      service: AUTH_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
    });
  } catch (error) {
    errorLogger.logError(error, { source: 'SecureStorage', context: { action: 'setPrimary' } });
    await Keychain.setGenericPassword(AUTH_USERNAME, JSON.stringify(payload), {
      service: AUTH_SERVICE,
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }
}

export async function getAuthTokensFromKeychain(): Promise<StoredAuthTokens | null> {
  try {
    const credentials = await Keychain.getGenericPassword({ service: AUTH_SERVICE });
    if (!credentials) {
      return null;
    }
    return safeParseTokens(credentials.password);
  } catch (error) {
    errorLogger.logError(error, { source: 'SecureStorage', context: { action: 'get' } });
    return null;
  }
}

export async function clearAuthTokensFromKeychain(): Promise<void> {
  try {
    await Keychain.resetGenericPassword({ service: AUTH_SERVICE });
  } catch (error) {
    errorLogger.logError(error, { source: 'SecureStorage', context: { action: 'clear' } });
  }
}
