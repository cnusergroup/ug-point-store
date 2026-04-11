import { useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { useTranslation } from '../../i18n';
import { PackageIcon, TicketIcon, ProfileIcon, ClaimIcon, ShoppingBagIcon, GlobeIcon, SettingsIcon } from '../../components/icons';
import './index.scss';

const ADMIN_LINKS = [
  {
    key: 'products',
    icon: PackageIcon,
    titleKey: 'admin.dashboard.productsTitle',
    descKey: 'admin.dashboard.productsDesc',
    url: '/pages/admin/products',
  },
  {
    key: 'codes',
    icon: TicketIcon,
    titleKey: 'admin.dashboard.codesTitle',
    descKey: 'admin.dashboard.codesDesc',
    url: '/pages/admin/codes',
  },
  {
    key: 'users',
    icon: ProfileIcon,
    titleKey: 'admin.dashboard.usersTitle',
    descKey: 'admin.dashboard.usersDesc',
    url: '/pages/admin/users',
  },
  {
    key: 'orders',
    icon: PackageIcon,
    titleKey: 'admin.dashboard.ordersTitle',
    descKey: 'admin.dashboard.ordersDesc',
    url: '/pages/admin/orders',
  },
  {
    key: 'invites',
    icon: ShoppingBagIcon,
    titleKey: 'admin.dashboard.invitesTitle',
    descKey: 'admin.dashboard.invitesDesc',
    url: '/pages/admin/invites',
  },
  {
    key: 'claims',
    icon: ClaimIcon,
    titleKey: 'admin.dashboard.claimsTitle',
    descKey: 'admin.dashboard.claimsDesc',
    url: '/pages/admin/claims',
  },
  {
    key: 'content',
    icon: GlobeIcon,
    titleKey: 'admin.dashboard.contentTitle',
    descKey: 'admin.dashboard.contentDesc',
    url: '/pages/admin/content',
  },
  {
    key: 'categories',
    icon: SettingsIcon,
    titleKey: 'admin.dashboard.categoriesTitle',
    descKey: 'admin.dashboard.categoriesDesc',
    url: '/pages/admin/categories',
  },
];

export default function AdminDashboard() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);
  const { t } = useTranslation();

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    const hasAdminAccess = user?.roles?.some(r => r === 'Admin' || r === 'SuperAdmin');
    if (!hasAdminAccess) {
      Taro.redirectTo({ url: '/pages/index/index' });
    }
  }, [isAuthenticated, user]);

  const goTo = (url: string) => {
    Taro.navigateTo({ url });
  };

  const goHome = () => {
    Taro.redirectTo({ url: '/pages/index/index' });
  };

  return (
    <View className='admin-page'>
      <View className='admin-header'>
        <View className='admin-header__info'>
          <Text className='admin-header__title'>{t('admin.dashboard.title')}</Text>
          <Text className='admin-header__sub'>
            {t('admin.dashboard.welcomeBack', { name: user?.nickname || t('admin.dashboard.adminFallback') })}
          </Text>
        </View>
        <View className='admin-header__home' onClick={goHome}>
          <Text>{t('admin.dashboard.goToMall')}</Text>
        </View>
      </View>

      <View className='admin-nav'>
        {ADMIN_LINKS.map((link) => {
          const IconComp = link.icon;
          return (
            <View
              key={link.key}
              className='admin-nav__card'
              onClick={() => goTo(link.url)}
            >
              <View className='admin-nav__card-icon'><IconComp size={24} color='var(--accent-primary)' /></View>
              <View className='admin-nav__card-body'>
                <Text className='admin-nav__card-title'>{t(link.titleKey)}</Text>
                <Text className='admin-nav__card-desc'>{t(link.descKey)}</Text>
              </View>
              <Text className='admin-nav__card-arrow'>›</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}
