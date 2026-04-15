/**
 * Global error logging service
 * Captures and logs all errors (JS, API, WebSocket) visible via adb logcat and console.
 */

export interface ErrorContext {
  source?: string;
  context?: Record<string, unknown>;
  userId?: number;
  route?: string;
  timestamp?: number;
}

class ErrorLogger {
  private errorBuffer: Array<{ message: string; timestamp: number }> = [];
  private readonly maxBufferSize = 100;
  private installed = false;
  private readonly originalConsoleError = console.error.bind(console);
  private readonly originalConsoleWarn = console.warn.bind(console);

  logError(error: unknown, context?: ErrorContext): void {
    const now = Date.now();
    const message = this.formatError(error, context);

    this.originalConsoleError('[ERROR_LOGGER]', message);
    if (__DEV__) {
      this.originalConsoleWarn(
        '[ERROR_DEBUG]',
        this.safeSerialize({
          error: this.normalizeErrorPayload(error),
          context,
        })
      );
    }

    this.errorBuffer.push({ message, timestamp: now });
    if (this.errorBuffer.length > this.maxBufferSize) {
      this.errorBuffer.shift();
    }
  }

  logApiError(error: unknown, endpoint: string, context?: ErrorContext): void {
    this.logError(error, {
      ...context,
      source: 'API',
      context: { endpoint, ...(context?.context || {}) },
    });
  }

  logWebSocketError(error: unknown, action: string, context?: ErrorContext): void {
    this.logError(error, {
      ...context,
      source: 'WebSocket',
      context: { action, ...(context?.context || {}) },
    });
  }

  logNavigationError(error: unknown, route: string, params?: unknown): void {
    this.logError(error, {
      source: 'Navigation',
      route,
      context: { params },
    });
  }

  logAsyncStorageError(error: unknown, key: string, operation: string): void {
    this.logError(error, {
      source: 'AsyncStorage',
      context: { key, operation },
    });
  }

  logRenderError(error: unknown, component: string): void {
    this.logError(error, {
      source: 'ComponentRender',
      context: { component },
    });
  }

  getBuffer(): Array<{ message: string; timestamp: number }> {
    return [...this.errorBuffer];
  }

  clearBuffer(): void {
    this.errorBuffer = [];
  }

  installGlobalHandlers(): void {
    if (this.installed || typeof globalThis === 'undefined') {
      return;
    }

    this.installed = true;

    const errorUtils = (
      globalThis as {
        ErrorUtils?: {
          getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
          setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
          setJSExceptionHandler?: (
            handler: (error: Error, isFatal?: boolean) => void,
            allowInDev?: boolean
          ) => void;
        };
      }
    ).ErrorUtils;

    const previousHandler = errorUtils?.getGlobalHandler?.();
    const nextHandler = (error: Error, isFatal?: boolean) => {
      this.logError(error, { source: 'JS', context: { isFatal: Boolean(isFatal) } });
      try {
        previousHandler?.(error, isFatal);
      } catch {
        // Avoid recursive crashes while handling global exceptions.
      }
    };

    try {
      if (typeof errorUtils?.setGlobalHandler === 'function') {
        errorUtils.setGlobalHandler(nextHandler);
      } else if (typeof errorUtils?.setJSExceptionHandler === 'function') {
        errorUtils.setJSExceptionHandler(nextHandler, true);
      }
    } catch (installError) {
      this.originalConsoleWarn(
        '[ERROR_LOGGER_INSTALL_FAILED]',
        this.safeSerialize(this.normalizeErrorPayload(installError))
      );
    }
  }

  private formatError(error: unknown, context?: ErrorContext): string {
    const normalizedError = this.normalizeErrorPayload(error);
    const message =
      (typeof normalizedError.message === 'string' && normalizedError.message) || 'Unknown error';
    const stack =
      typeof normalizedError.stack === 'string' && normalizedError.stack
        ? ` [${normalizedError.stack}]`
        : '';
    const contextStr = context ? ` | Context: ${this.safeSerialize(context)}` : '';
    return `${message}${stack}${contextStr}`;
  }

  private normalizeErrorPayload(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    if (typeof error === 'string') {
      return { message: error };
    }

    if (typeof error === 'object' && error !== null) {
      return {
        message: this.safeSerialize(error),
      };
    }

    return {
      message: String(error ?? 'Unknown error'),
    };
  }

  private safeSerialize(value: unknown): string {
    try {
      const seen = new WeakSet<object>();
      return JSON.stringify(
        value,
        (_key, currentValue) => {
          if (typeof currentValue === 'object' && currentValue !== null) {
            if (seen.has(currentValue)) {
              return '[Circular]';
            }
            seen.add(currentValue);
          }

          if (typeof currentValue === 'function') {
            return `[Function ${currentValue.name || 'anonymous'}]`;
          }

          if (currentValue instanceof Error) {
            return {
              name: currentValue.name,
              message: currentValue.message,
              stack: currentValue.stack,
            };
          }

          return currentValue;
        },
        2
      );
    } catch {
      return '[Unserializable]';
    }
  }
}

export const errorLogger = new ErrorLogger();
errorLogger.installGlobalHandlers();

export default errorLogger;
