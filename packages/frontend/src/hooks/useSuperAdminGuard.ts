import { useEffect, useState } from 'react';
import Taro from '@tarojs/taro';
import { useAppStore } from '../store';

/**
 * Guard hook for SuperAdmin-only pages.
 * - If not authenticated → redirect to login
 * - If authenticated but not SuperAdmin → show forbidden view
 * Returns { isSuperAdmin, ready } where ready=true once auth state is confirmed.
 */
export function useSuperAdminGuard() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    setReady(true);
  }, [isAuthenticated]);

  return { isSuperAdmin, ready, isAuthenticated };
}
