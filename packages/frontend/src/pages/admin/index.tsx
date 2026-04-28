import { useState, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import { PackageIcon, TicketIcon, ProfileIcon, ClaimIcon, ShoppingBagIcon, GlobeIcon, SettingsIcon, GiftIcon, ClockIcon, LocationIcon, TagIcon, MailIcon } from '../../components/icons';
import './index.scss';

interface DashboardCategory {
  key: string;
  labelKey: string;
  icon: React.ComponentType<{ size: number; color: string }>;
}

const DASHBOARD_CATEGORIES: DashboardCategory[] = [
  { key: 'product-management', labelKey: 'admin.dashboard.categoryProducts', icon: PackageIcon },
  { key: 'order-management', labelKey: 'admin.dashboard.categoryOrders', icon: ShoppingBagIcon },
  { key: 'user-management', labelKey: 'admin.dashboard.categoryUsers', icon: ProfileIcon },
  { key: 'content-management', labelKey: 'admin.dashboard.categoryContent', icon: GlobeIcon },
  { key: 'operations', labelKey: 'admin.dashboard.categoryOperations', icon: GiftIcon },
  { key: 'system-settings', labelKey: 'admin.dashboard.categorySystem', icon: SettingsIcon },
];

const ADMIN_LINKS = [
  {
    key: 'products',
    category: 'product-management',
    icon: PackageIcon,
    titleKey: 'admin.dashboard.productsTitle',
    descKey: 'admin.dashboard.productsDesc',
    url: '/pages/admin/products',
    adminPermissionKey: 'adminProductsEnabled' as const,
  },
  {
    key: 'codes',
    category: 'product-management',
    icon: TicketIcon,
    titleKey: 'admin.dashboard.codesTitle',
    descKey: 'admin.dashboard.codesDesc',
    url: '/pages/admin/codes',
    featureToggleKey: 'codeRedemptionEnabled' as const,
  },
  {
    key: 'users',
    category: 'user-management',
    icon: ProfileIcon,
    titleKey: 'admin.dashboard.usersTitle',
    descKey: 'admin.dashboard.usersDesc',
    url: '/pages/admin/users',
  },
  {
    key: 'orders',
    category: 'order-management',
    icon: PackageIcon,
    titleKey: 'admin.dashboard.ordersTitle',
    descKey: 'admin.dashboard.ordersDesc',
    url: '/pages/admin/orders',
    adminPermissionKey: 'adminOrdersEnabled' as const,
  },
  {
    key: 'invites',
    category: 'user-management',
    icon: ShoppingBagIcon,
    titleKey: 'admin.dashboard.invitesTitle',
    descKey: 'admin.dashboard.invitesDesc',
    url: '/pages/admin/invites',
  },
  {
    key: 'claims',
    category: 'order-management',
    icon: ClaimIcon,
    titleKey: 'admin.dashboard.claimsTitle',
    descKey: 'admin.dashboard.claimsDesc',
    url: '/pages/admin/claims',
    featureToggleKey: 'pointsClaimEnabled' as const,
  },
  {
    key: 'content',
    category: 'content-management',
    icon: GlobeIcon,
    titleKey: 'admin.dashboard.contentTitle',
    descKey: 'admin.dashboard.contentDesc',
    url: '/pages/admin/content',
    adminPermissionKey: 'adminContentReviewEnabled' as const,
  },
  {
    key: 'categories',
    category: 'content-management',
    icon: SettingsIcon,
    titleKey: 'admin.dashboard.categoriesTitle',
    descKey: 'admin.dashboard.categoriesDesc',
    url: '/pages/admin/categories',
    adminPermissionKey: 'adminCategoriesEnabled' as const,
  },
  {
    key: 'batch-points',
    category: 'operations',
    icon: GiftIcon,
    titleKey: 'admin.dashboard.batchPointsTitle',
    descKey: 'admin.dashboard.batchPointsDesc',
    url: '/pages/admin/batch-points',
  },
  {
    key: 'batch-history',
    category: 'operations',
    icon: ClockIcon,
    titleKey: 'admin.dashboard.batchHistoryTitle',
    descKey: 'admin.dashboard.batchHistoryDesc',
    url: '/pages/admin/batch-history',
    superAdminOnly: true,
  },
  {
    key: 'quarterly-award',
    category: 'operations',
    icon: GiftIcon,
    titleKey: 'admin.dashboard.quarterlyAwardTitle',
    descKey: 'admin.dashboard.quarterlyAwardDesc',
    url: '/pages/admin/quarterly-award',
    superAdminOnly: true,
  },
  {
    key: 'travel',
    category: 'operations',
    icon: LocationIcon,
    titleKey: 'admin.dashboard.travelTitle',
    descKey: 'admin.dashboard.travelDesc',
    url: '/pages/admin/travel',
    superAdminOnly: true,
  },
  {
    key: 'reports',
    category: 'operations',
    icon: ClockIcon,
    titleKey: 'admin.dashboard.reportsTitle',
    descKey: 'admin.dashboard.reportsDesc',
    url: '/pages/admin/reports',
    superAdminOnly: true,
  },
  {
    key: 'credentials',
    category: 'operations',
    icon: TicketIcon,
    titleKey: 'admin.dashboard.credentialsTitle',
    descKey: 'admin.dashboard.credentialsDesc',
    url: '/pages/admin/credentials',
    superAdminOnly: true,
  },
  {
    key: 'reservation-approvals',
    category: 'content-management',
    icon: ClaimIcon,
    titleKey: 'admin.dashboard.reservationApprovalsTitle',
    descKey: 'admin.dashboard.reservationApprovalsDesc',
    url: '/pages/admin/reservation-approvals',
  },
  {
    key: 'reservation-points-config',
    category: 'content-management',
    icon: SettingsIcon,
    titleKey: 'admin.dashboard.reservationPointsConfigTitle',
    descKey: 'admin.dashboard.reservationPointsConfigDesc',
    url: '/pages/admin/reservation-approvals?mode=config',
    superAdminOnly: true,
  },
  {
    key: 'tags',
    category: 'content-management',
    icon: TagIcon,
    titleKey: 'admin.dashboard.tagsTitle',
    descKey: 'admin.dashboard.tagsDesc',
    url: '/pages/admin/tags',
    superAdminOnly: true,
  },
  {
    key: 'email-products',
    category: 'product-management',
    icon: MailIcon,
    titleKey: 'admin.dashboard.emailProductsTitle',
    descKey: 'admin.dashboard.emailProductsDesc',
    url: '/pages/admin/email-products',
    adminPermissionKey: 'adminEmailProductsEnabled' as const,
  },
  {
    key: 'email-content',
    category: 'content-management',
    icon: MailIcon,
    titleKey: 'admin.dashboard.emailContentTitle',
    descKey: 'admin.dashboard.emailContentDesc',
    url: '/pages/admin/email-content',
    adminPermissionKey: 'adminEmailContentEnabled' as const,
  },
  {
    key: 'settings',
    category: 'system-settings',
    icon: SettingsIcon,
    titleKey: 'admin.dashboard.settingsTitle',
    descKey: 'admin.dashboard.settingsDesc',
    url: '/pages/admin/settings',
    superAdminOnly: true,
  },
];

interface DashboardCategoryNavProps {
  categories: DashboardCategory[];
  activeCategory: string;
  onCategoryChange: (key: string) => void;
}

function DashboardCategoryNav({ categories, activeCategory, onCategoryChange }: DashboardCategoryNavProps) {
  const { t } = useTranslation();
  return (
    <View className='dashboard-category-nav'>
      {categories.map((cat) => {
        const isActive = cat.key === activeCategory;
        const IconComp = cat.icon;
        return (
          <View
            key={cat.key}
            className={`dashboard-category-nav__item${isActive ? ' dashboard-category-nav__item--active' : ''}`}
            onClick={() => onCategoryChange(cat.key)}
          >
            <View className='dashboard-category-nav__icon'>
              <IconComp size={18} color={isActive ? 'var(--text-inverse)' : 'var(--text-secondary)'} />
            </View>
            <Text className='dashboard-category-nav__label'>{t(cat.labelKey)}</Text>
          </View>
        );
      })}
    </View>
  );
}

interface CollapsibleSectionProps {
  title: string;
  description?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}

function CollapsibleSection({
  title,
  description,
  defaultExpanded = true,
  children,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState<boolean>(defaultExpanded);

  return (
    <View className='collapsible-section'>
      <View className='collapsible-section__header' onClick={() => setExpanded(!expanded)}>
        <View className='collapsible-section__header-text'>
          <Text className='collapsible-section__title'>{title}</Text>
          {description && (
            <Text className='collapsible-section__description'>{description}</Text>
          )}
        </View>
        <Text className={`collapsible-section__chevron${expanded ? ' collapsible-section__chevron--expanded' : ''}`}>
          ›
        </Text>
      </View>
      <View className={`collapsible-section__content${expanded ? ' collapsible-section__content--expanded' : ''}`}>
        {children}
      </View>
    </View>
  );
}

export default function AdminDashboard() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);
  const { t } = useTranslation();
  const [activeCategory, setActiveCategory] = useState<string>('product-management');
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

  // --- Visibility filtering logic (Task 6.1) ---
  // Filter visible links by role and feature toggles (preserving existing logic exactly)
  const visibleLinks = featureToggles
    ? ADMIN_LINKS
        .filter((link) => !link.superAdminOnly || user?.roles?.includes('SuperAdmin'))
        .filter((link) => {
          if (link.featureToggleKey && featureToggles[link.featureToggleKey] === false) return false;
          // Hide admin-permission-gated links for non-SuperAdmin when toggle is off
          if (link.adminPermissionKey && !user?.roles?.includes('SuperAdmin')) {
            if (featureToggles[link.adminPermissionKey] === false) return false;
          }
          return true;
        })
    : [];

  // Group visible links by category
  const linksByCategory = DASHBOARD_CATEGORIES.reduce((acc, cat) => {
    acc[cat.key] = visibleLinks.filter((link) => link.category === cat.key);
    return acc;
  }, {} as Record<string, typeof visibleLinks>);

  // Filter categories to only those with visible links
  const visibleCategories = DASHBOARD_CATEGORIES.filter(
    (cat) => (linksByCategory[cat.key]?.length ?? 0) > 0
  );

  // --- Fallback for activeCategory (Task 6.2) ---
  const effectiveActiveCategory =
    visibleCategories.some((cat) => cat.key === activeCategory)
      ? activeCategory
      : visibleCategories[0]?.key ?? 'product-management';

  // Derive active category object and its links
  const activeCategoryObj = visibleCategories.find((cat) => cat.key === effectiveActiveCategory);
  const activeLinks = linksByCategory[effectiveActiveCategory] ?? [];

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

      {featureToggles === null ? (
        <View className='admin-loading'><Text>{t('admin.dashboard.loading')}</Text></View>
      ) : (
        <View className='dashboard-layout'>
          <DashboardCategoryNav
            categories={visibleCategories}
            activeCategory={effectiveActiveCategory}
            onCategoryChange={setActiveCategory}
          />
          <View className='dashboard-content'>
            <Text className='dashboard-content__title'>
              {activeCategoryObj ? t(activeCategoryObj.labelKey) : ''}
            </Text>
            <CollapsibleSection title={activeCategoryObj ? t(activeCategoryObj.labelKey) : ''} defaultExpanded>
              {activeLinks.map((link) => {
                const IconComp = link.icon;
                return (
                  <View
                    key={link.key}
                    className='admin-nav__card'
                    onClick={() => goTo(link.url)}
                  >
                    <View className='admin-nav__card-icon'>
                      <IconComp size={24} color='var(--accent-primary)' />
                    </View>
                    <View className='admin-nav__card-body'>
                      <Text className='admin-nav__card-title'>{t(link.titleKey)}</Text>
                      <Text className='admin-nav__card-desc'>{t(link.descKey)}</Text>
                    </View>
                    <Text className='admin-nav__card-arrow'>›</Text>
                  </View>
                );
              })}
            </CollapsibleSection>
          </View>
        </View>
      )}
    </View>
  );
}
