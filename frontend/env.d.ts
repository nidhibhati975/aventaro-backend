declare module '@env' {
  export const APP_ENV: string | undefined;
  export const API_BASE_URL: string | undefined;
  export const BACKEND_URL: string | undefined;
  export const SENTRY_DSN: string | undefined;
}

declare module 'react-native-vector-icons/Ionicons' {
  import type { ComponentType } from 'react';
  const Ionicons: ComponentType<any>;
  export default Ionicons;
}
