import { createContext, useContext } from 'react';

export const LoadingPreviewContext = createContext(false);

export function useLoadingPreview() {
  return useContext(LoadingPreviewContext);
}
