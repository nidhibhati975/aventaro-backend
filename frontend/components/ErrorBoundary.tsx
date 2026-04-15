import React, { type ReactNode } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { captureCrash } from '../services/sentry';
import { errorLogger } from '../services/errorLogger';
import { COLORS } from '../theme/colors';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorCount: number;
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null, errorCount: 0 };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorCount: 0 };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    errorLogger.logRenderError(error, errorInfo.componentStack || 'Unknown');
    captureCrash(error, { source: 'ErrorBoundary', componentStack: errorInfo.componentStack });
    
    if (this.props.onError) {
      this.props.onError(error);
    }

    // Update error count for persistent errors
    this.setState((prev) => ({ errorCount: prev.errorCount + 1 }));
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, errorCount: 0 });
  };

  private handleHardReset = () => {
    this.setState({ hasError: false, error: null, errorCount: 0 });
  };

  render() {
    if (this.state.hasError) {
      const isCritical = this.state.errorCount > 2;
      
      if (this.props.fallback && !isCritical) {
        return this.props.fallback;
      }

      return (
        <View style={styles.container}>
          <Text style={styles.title}>
            {isCritical ? 'Critical Error' : 'Something went wrong'}
          </Text>
          <Text style={styles.subtitle}>
            {isCritical
              ? 'The app encountered a critical error. Please restart the app.'
              : 'The app recovered from an unexpected error.'}
          </Text>
          {this.state.error && __DEV__ && (
            <Text style={styles.errorText} numberOfLines={3}>
              {this.state.error.message}
            </Text>
          )}
          <View style={styles.buttonContainer}>
            {!isCritical && (
              <TouchableOpacity style={styles.button} onPress={this.handleRetry}>
                <Text style={styles.buttonText}>Try Again</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity 
              style={[styles.button, styles.secondaryButton]} 
              onPress={this.handleHardReset}
            >
              <Text style={styles.buttonText}>
                {isCritical ? 'Restart App' : 'Close'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    backgroundColor: COLORS.SURFACE,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: COLORS.TEXT_PRIMARY,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    color: COLORS.TEXT_SECONDARY,
    marginBottom: 12,
  },
  errorText: {
    fontSize: 12,
    color: COLORS.TEXT_SECONDARY,
    textAlign: 'center',
    marginBottom: 16,
    padding: 12,
    backgroundColor: COLORS.BACKGROUND,
    borderRadius: 8,
  },
  buttonContainer: {
    gap: 12,
  },
  button: {
    backgroundColor: COLORS.PRIMARY_PURPLE,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 10,
    minWidth: 120,
  },
  secondaryButton: {
    backgroundColor: COLORS.TEXT_SECONDARY,
  },
  buttonText: {
    color: COLORS.WHITE,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
});
