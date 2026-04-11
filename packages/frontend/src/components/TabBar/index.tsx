import Taro from '@tarojs/taro';
import {
  HomeIcon, HomeActiveIcon,
  CartIcon, CartActiveIcon,
  OrderIcon, OrderActiveIcon,
  ProfileIcon, ProfileActiveIcon,
} from '../icons';
import type { IconProps } from '../icons';
import { useAppStore } from '../../store';
import { useTranslation } from '../../i18n';
import './index.scss';

interface TabBarProps {
  /** 当前激活的 tab 路径，如 '/pages/index/index' */
  current: string;
}

interface TabConfig {
  key: string;
  labelKey: string;
  path: string;
  icon: (props: IconProps) => JSX.Element;
  activeIcon: (props: IconProps) => JSX.Element;
  badge?: 'cart';
}

const TABS: TabConfig[] = [
  { key: 'home', labelKey: 'tabBar.mall', path: '/pages/index/index', icon: HomeIcon, activeIcon: HomeActiveIcon },
  { key: 'cart', labelKey: 'tabBar.cart', path: '/pages/cart/index', icon: CartIcon, activeIcon: CartActiveIcon, badge: 'cart' },
  { key: 'orders', labelKey: 'tabBar.orders', path: '/pages/orders/index', icon: OrderIcon, activeIcon: OrderActiveIcon },
  { key: 'profile', labelKey: 'tabBar.profile', path: '/pages/profile/index', icon: ProfileIcon, activeIcon: ProfileActiveIcon },
];

export { TABS };
export type { TabBarProps, TabConfig };

export default function TabBar({ current }: TabBarProps) {
  const cartCount = useAppStore((s) => s.cartCount);
  const { t } = useTranslation();

  const handleClick = (path: string) => {
    if (path === current) return;
    Taro.redirectTo({ url: path });
  };

  return (
    <div className="tab-bar">
      {TABS.map((tab) => {
        const isActive = tab.path === current;
        const Icon = isActive ? tab.activeIcon : tab.icon;
        const color = isActive ? 'var(--accent-primary)' : 'var(--text-tertiary)';

        return (
          <div
            key={tab.key}
            className="tab-bar__item"
            onClick={() => handleClick(tab.path)}
          >
            <div style={{ position: 'relative' }}>
              <Icon size={24} color={color} />
              {tab.badge === 'cart' && cartCount > 0 && (
                <span className="tab-bar__badge">
                  {cartCount > 99 ? '99+' : cartCount}
                </span>
              )}
            </div>
            <span className={`tab-bar__label${isActive ? ' tab-bar__label--active' : ''}`}>
              {t(tab.labelKey)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
