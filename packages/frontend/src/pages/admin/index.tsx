import { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import { PackageIcon, TicketIcon, ProfileIcon, ClaimIcon, ShoppingBagIcon, GlobeIcon, SettingsIcon, GiftIcon, ClockIcon, LocationIcon, TagIcon, MailIcon } from '../../components/icons';
import './index.scss';

const ADMIN_LINKS = [
  {
    key: 'products',
    icon: PackageIcon,
    titleKey: 'admin.dashboard.productsTitle',
    descKey: 'admin.dashboard.productsDesc',
    url: '/pages/admin/products',
    adminPermissionKey: 'adminProductsEnabled' as const,
  },
  {
    key: 'codes',
    icon: TicketIcon,
    titleKey: 'admin.dashboard.codesTitle',
    descKey: 'admin.dashboard.codesDesc',
    url: '/pages/admin/codes',
    featureToggleKey: 'codeRedemptionEnabled' as const,
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
    adminPermissionKey: 'adminOrdersEnabled' as const,
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
    featureToggleKey: 'pointsClaimEnabled' as const,
  },
  {
    key: 'content',
    icon: GlobeIcon,
    titleKey: 'admin.dashboard.contentTitle',
    descKey: 'admin.dashboard.contentDesc',
    url: '/pages/admin/content',
    adminPermissionKey: 'adminContentReviewEnabled' as const,
  },
  {
    key: 'categories',
    icon: SettingsIcon,
    titleKey: 'admin.dashboard.categoriesTitle',
    descKey: 'admin.dashboard.categoriesDesc',
    url: '/pages/admin/categories',
    adminPermissionKey: 'adminCategoriesEnabled' as const,
  },
  {
    key: 'batch-points',
    icon: GiftIcon,
    titleKey: 'admin.dashboard.batchPointsTitle',
    descKey: 'admin.dashboard.batchPointsDesc',
    url: '/pages/admin/batch-points',
  },
  {
    key: 'batch-history',
    icon: ClockIcon,
    titleKey: 'admin.dashboard.batchHistoryTitle',
    descKey: 'admin.dashboard.batchHistoryDesc',
    url: '/pages/admin/batch-history',
    superAdminOnly: true,
  },
  {
    key: 'travel',
    icon: LocationIcon,
    titleKey: 'admin.dashboard.travelTitle',
    descKey: 'admin.dashboard.travelDesc',
    url: '/pages/admin/travel',
    superAdminOnly: true,
  },
  {
    key: 'tags',
    icon: TagIcon,
    titleKey: 'admin.dashboard.tagsTitle',
    descKey: 'admin.dashboard.tagsDesc',
    url: '/pages/admin/tags',
    superAdminOnly: true,
  },
  {
    key: 'email-products',
    icon: MailIcon,
    titleKey: 'admin.dashboard.emailProductsTitle',
    descKey: 'admin.dashboard.emailProductsDesc',
    url: '/pages/admin/email-products',
    adminPermissionKey: 'adminEmailProductsEnabled' as const,
  },
  {
    key: 'email-content',
    icon: MailIcon,
    titleKey: 'admin.dashboard.emailContentTitle',
    descKey: 'admin.dashboard.emailContentDesc',
    url: '/pages/admin/email-content',
    adminPermissionKey: 'adminEmailContentEnabled' as const,
  },
  {
    key: 'settings',
    icon: SettingsIcon,
    titleKey: 'admin.dashboard.settingsTitle',
    descKey: 'admin.dashboard.settingsDesc',
    url: '/pages/admin/settings',
    superAdminOnly: true,
  },
];

export default function AdminDashboard() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);
  const { t } = useTranslation();
  const [featureToggles, setFeatureToggles] = useState<{ codeRedemptionEnabled: boolean; pointsClaimEnabled: boolean; adminProductsEnabled: boolean; adminOrdersEnabled: boolean; adminContentReviewEnabled: boolean; adminCategoriesEnabled: boolean; adminEmailProductsEnabled: boolean; adminEmailContentEnabled: boolean } | null>(null);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    // OrderAdmin 重定向到订单页
    if (user?.roles?.includes('OrderAdmin')) {
      Taro.redirectTo({ url: '/pages/admin/orders' });
      return;
    }
    const hasAdminAccess = user?.roles?.some(r => r === 'Admin' || r === 'SuperAdmin');
    if (!hasAdminAccess) {
      Taro.redirectTo({ url: '/pages/index/index' });
    }

    // Fetch feature toggles (public endpoint, no auth needed)
    request<{ codeRedemptionEnabled: boolean; pointsClaimEnabled: boolean; adminProductsEnabled: boolean; adminOrdersEnabled: boolean; adminContentReviewEnabled: boolean; adminCategoriesEnabled: boolean; adminEmailProductsEnabled: boolean; adminEmailContentEnabled: boolean }>({
      url: '/api/settings/feature-toggles',
      skipAuth: true,
    })
      .then((res) => setFeatureToggles(res))
      .catch(() => {
        // On failure, default to showing all entries (safe degradation)
        setFeatureToggles({
          codeRedemptionEnabled: true,
          pointsClaimEnabled: true,
          adminProductsEnabled: true,
          adminOrdersEnabled: true,
          adminContentReviewEnabled: true,
          adminCategoriesEnabled: true,
          adminEmailProductsEnabled: true,
          adminEmailContentEnabled: true,
        });
      });
  }, [isAuthenticated, user]);

  const goTo = (url: string) => {
    Taro.navigateTo({ url });
  };

  const goHome = () => {
    Taro.redirectTo({ url: '/pages/hub/index' });
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
        {featureToggles === null ? (
          <View className='admin-loading'><Text>{t('admin.dashboard.loading')}</Text></View>
        ) : (
          ADMIN_LINKS
            .filter((link) => !link.superAdminOnly || user?.roles?.includes('SuperAdmin'))
            .filter((link) => {
              if (link.featureToggleKey && featureToggles[link.featureToggleKey] === false) return false;
              // Hide admin-permission-gated links for non-SuperAdmin when toggle is off
              if (link.adminPermissionKey && !user?.roles?.includes('SuperAdmin')) {
                if (featureToggles[link.adminPermissionKey] === false) return false;
              }
              return true;
            })
            .map((link) => {
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
            })
        )}
      </View>
    </View>
  );
}
