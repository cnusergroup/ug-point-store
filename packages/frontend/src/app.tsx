import { PropsWithChildren, useEffect } from 'react';
import './app.scss';
import { useAppStore } from './store';

// Guard: the mall SPA must never run on the credential domain.
// Real credential pages (/c/{id}) are server-rendered HTML and never load this
// SPA. But if the origin returns 404 for a (deleted/invalid) credential, the
// CloudFront errorResponses rule rewrites it to /index.html — booting the SPA
// on creds.awscommunity.cn. When that happens, redirect to the store domain,
// preserving the hash route so deep links still work.
if (typeof window !== 'undefined' && window.location.hostname === 'creds.awscommunity.cn') {
  window.location.replace('https://store.awscommunity.cn/' + (window.location.hash || ''));
}

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
