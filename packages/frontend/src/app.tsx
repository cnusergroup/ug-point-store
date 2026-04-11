import React, { PropsWithChildren, useEffect } from 'react';
import './app.scss';
import { useAppStore } from './store';

function App({ children }: PropsWithChildren) {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const fetchCartCount = useAppStore((s) => s.fetchCartCount);
  const theme = useAppStore((s) => s.theme);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCartCount();
    }
  }, [isAuthenticated, fetchCartCount]);

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.theme = theme === 'warm' ? 'warm' : '';
    }
  }, [theme]);

  return <>{children}</>;
}

export default App;
