import React, { createContext, useContext, useReducer, useEffect, ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface OnboardingData {
  interests: string[];
  travelStyle: string | null;
  budgetMin: number;
  budgetMax: number;
  location: string | null;
}

interface OnboardingState {
  step: number;
  totalSteps: number;
  isComplete: boolean;
  isLoading: boolean;
  data: OnboardingData;
}

type OnboardingAction =
  | { type: 'SET_STEP'; payload: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_INTERESTS'; payload: string[] }
  | { type: 'SET_TRAVEL_STYLE'; payload: string }
  | { type: 'SET_BUDGET'; payload: { min: number; max: number } }
  | { type: 'SET_LOCATION'; payload: string }
  | { type: 'COMPLETE' }
  | { type: 'LOAD_STATE'; payload: Partial<OnboardingState> }
  | { type: 'RESET' };

const initialData: OnboardingData = {
  interests: [],
  travelStyle: null,
  budgetMin: 500,
  budgetMax: 2000,
  location: null,
};

const initialState: OnboardingState = {
  step: 0,
  totalSteps: 5,
  isComplete: false,
  isLoading: true,
  data: initialData,
};

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'SET_STEP':
      return { ...state, step: action.payload };
    case 'NEXT_STEP':
      return { ...state, step: Math.min(state.step + 1, state.totalSteps) };
    case 'PREV_STEP':
      return { ...state, step: Math.max(state.step - 1, 0) };
    case 'SET_INTERESTS':
      return { ...state, data: { ...state.data, interests: action.payload } };
    case 'SET_TRAVEL_STYLE':
      return { ...state, data: { ...state.data, travelStyle: action.payload } };
    case 'SET_BUDGET':
      return {
        ...state,
        data: { ...state.data, budgetMin: action.payload.min, budgetMax: action.payload.max },
      };
    case 'SET_LOCATION':
      return { ...state, data: { ...state.data, location: action.payload } };
    case 'COMPLETE':
      return { ...state, isComplete: true };
    case 'LOAD_STATE':
      return { ...state, ...action.payload, isLoading: false };
    case 'RESET':
      return { ...initialState, isLoading: false };
    default:
      return state;
  }
}

interface OnboardingContextValue {
  state: OnboardingState;
  nextStep: () => void;
  prevStep: () => void;
  goToStep: (step: number) => void;
  setInterests: (interests: string[]) => void;
  setTravelStyle: (style: string) => void;
  setBudget: (min: number, max: number) => void;
  setLocation: (location: string) => void;
  completeOnboarding: () => Promise<void>;
  resetOnboarding: () => Promise<void>;
}

const OnboardingContext = createContext<OnboardingContextValue | undefined>(undefined);

const ONBOARDING_STORAGE_KEY = 'onboarding:state';

export function OnboardingProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(onboardingReducer, initialState);

  // Load saved state on mount
  useEffect(() => {
    loadSavedState();
  }, []);

  const loadSavedState = async () => {
    try {
      const saved = await AsyncStorage.getItem(ONBOARDING_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        dispatch({ type: 'LOAD_STATE', payload: parsed });
      } else {
        dispatch({ type: 'LOAD_STATE', payload: { isLoading: false } });
      }
    } catch (error) {
      console.error('Failed to load onboarding state:', error);
      dispatch({ type: 'LOAD_STATE', payload: { isLoading: false } });
    }
  };

  const saveState = async (newState: OnboardingState) => {
    try {
      await AsyncStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(newState));
    } catch (error) {
      console.error('Failed to save onboarding state:', error);
    }
  };

  const nextStep = () => {
    dispatch({ type: 'NEXT_STEP' });
  };

  const prevStep = () => {
    dispatch({ type: 'PREV_STEP' });
  };

  const goToStep = (step: number) => {
    dispatch({ type: 'SET_STEP', payload: step });
  };

  const setInterests = (interests: string[]) => {
    dispatch({ type: 'SET_INTERESTS', payload: interests });
  };

  const setTravelStyle = (style: string) => {
    dispatch({ type: 'SET_TRAVEL_STYLE', payload: style });
  };

  const setBudget = (min: number, max: number) => {
    dispatch({ type: 'SET_BUDGET', payload: { min, max } });
  };

  const setLocation = (location: string) => {
    dispatch({ type: 'SET_LOCATION', payload: location });
  };

  const completeOnboarding = async () => {
    dispatch({ type: 'COMPLETE' });
    // Save completion state
    const newState = { ...state, isComplete: true };
    await saveState(newState);
    // TODO: Call API to update user profile with onboarding data
  };

  const resetOnboarding = async () => {
    dispatch({ type: 'RESET' });
    await AsyncStorage.removeItem(ONBOARDING_STORAGE_KEY);
  };

  // Auto-save when state changes
  useEffect(() => {
    if (!state.isLoading) {
      saveState(state);
    }
  }, [state, state.isLoading]);

  return (
    <OnboardingContext.Provider
      value={{
        state,
        nextStep,
        prevStep,
        goToStep,
        setInterests,
        setTravelStyle,
        setBudget,
        setLocation,
        completeOnboarding,
        resetOnboarding,
      }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  const context = useContext(OnboardingContext);
  if (!context) {
    throw new Error('useOnboarding must be used within an OnboardingProvider');
  }
  return context;
}