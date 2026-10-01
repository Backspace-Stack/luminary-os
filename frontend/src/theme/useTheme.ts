// React binding for the theme engine. Components re-render only
// when theme state changes; the CSS-variable projection itself
// happens inside the engine, outside React.

import { useSyncExternalStore } from 'react';
import { getTheme, subscribeTheme, setTheme, type ThemeState } from './engine';

export function useTheme(): [ThemeState, (patch: Partial<ThemeState>) => void] {
  const state = useSyncExternalStore(subscribeTheme, getTheme);
  return [state, setTheme];
}
