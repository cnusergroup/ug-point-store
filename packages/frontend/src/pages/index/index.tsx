import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import TabBar from '../../components/TabBar';
import { ProductSkeleton } from '../../components/Skeleton';
import { TicketIcon, GiftIcon, PackageIcon, LockIcon, LocationIcon, GlobeIcon } from '../../components/icons';
import type { TravelSponsorshipSettings, TravelQuota } from '@points-mall/shared';
import './index.scss';
/** Product type filter options */
type TypeFilter = 'all' | 'points' | 'code_exclusive' | 'travel';

/** Product list item from API */
interface ProductListItem {
  productId: string;
  name: string;
  description: string;
  imageUrl: string;
  type: 'points' | 'code_exclusive';
  status: string;
  stock: number;
  locked: boolean;
  pointsCost?: number;
  allowedRoles?: UserRole[] | 'all';
  eventInfo?: string;
}

interface ProductListResponse {
  items: ProductListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Role display config */
const ROLE_CONFIG: Record<UserRole, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'Speaker', 'Volunteer'];

function HomeIcon({ size = 20, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  );
}

export default function IndexPage() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [featureToggles, setFeatureToggles] = useState<{ codeRedemptionEnabled: boolean; pointsClaimEnabled: boolean } | null>(null);
  const [travelSettings, setTravelSettings] = useState<TravelSponsorshipSettings | null>(null);
  const [travelQuota, setTravelQuota] = useState<TravelQuota | null>(null);
  const [travelQuotaLoading, setTravelQuotaLoading] = useState(false);
  const fetchProfile = useAppStore((s) => s.fetchProfile);
  const roleWrapRef = useRef<HTMLDivElement>(null);

  // Close role dropdown when clicking outside
  useEffect(() => {
    if (!showRoleDropdown) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (roleWrapRef.current && !roleWrapRef.current.contains(e.target as Node)) {
        setShowRoleDropdown(false);
      }
    };
    document.addEventListener('click', handleClickOutside, true);
    return () => document.removeEventListener('click', handleClickOutside, true);
  }, [showRoleDropdown]);

  const fetchProducts = useCallback(async () => {
    if (typeFilter === 'travel') {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      let url = '/api/products?pageSize=50';
      if (typeFilter !== 'all') url += `&type=${typeFilter}`;
      if (roleFilter) url += `&roleFilter=${roleFilter}`;
      const res = await request<ProductListResponse>({ url });
      setProducts(res.items);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, [typeFilter, roleFilter]);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchProfile();
    fetchProducts();

    // Fetch feature toggles (public endpoint, no auth needed)
    request<{ codeRedemptionEnabled: boolean; pointsClaimEnabled: boolean }>({
      url: '/api/settings/feature-toggles',
      skipAuth: true,
    })
      .then((res) => setFeatureToggles(res))
      .catch(() => {
        // Frontend degradation: default to showing all entries on failure
        setFeatureToggles(null);
      });

    // Fetch travel sponsorship settings (public endpoint)
    request<TravelSponsorshipSettings>({
      url: '/api/settings/travel-sponsorship',
      skipAuth: true,
    })
      .then((res) => setTravelSettings(res))
      .catch(() => {
        setTravelSettings(null);
      });
  }, [isAuthenticated, fetchProfile, fetchProducts]);

  // Reset typeFilter if code_exclusive is disabled
  useEffect(() => {
    if (featureToggles?.codeRedemptionEnabled === false && typeFilter === 'code_exclusive') {
      setTypeFilter('all');
    }
  }, [featureToggles, typeFilter]);

  // Reset typeFilter if travel is disabled
  useEffect(() => {
    if (travelSettings?.travelSponsorshipEnabled === false && typeFilter === 'travel') {
      setTypeFilter('all');
    }
  }, [travelSettings, typeFilter]);

  // Fetch travel quota when travel tab is selected and user is Speaker
  const isSpeaker = user?.roles?.includes('Speaker') ?? false;
  useEffect(() => {
    if (typeFilter !== 'travel' || !isSpeaker) return;
    if (travelQuota) return; // already fetched
    setTravelQuotaLoading(true);
    request<TravelQuota>({ url: '/api/travel/quota' })
      .then((res) => setTravelQuota(res))
      .catch(() => setTravelQuota(null))
      .finally(() => setTravelQuotaLoading(false));
  }, [typeFilter, isSpeaker, travelQuota]);

  const handleCardClick = (product: ProductListItem) => {
    if (product.locked) return;
    Taro.navigateTo({ url: `/pages/product/index?id=${product.productId}` });
  };

  const renderRoleBadges = (allowedRoles?: UserRole[] | 'all') => {
    if (!allowedRoles) return null;
    if (allowedRoles === 'all') {
      return (
        <View className='product-card__roles'>
          <Text className='role-badge role-badge--all'>{t('mall.everyone')}</Text>
        </View>
      );
    }
    return (
      <View className='product-card__roles'>
        {allowedRoles.map((role) => (
          <Text key={role} className={`role-badge ${ROLE_CONFIG[role]?.className || ''}`}>
            {ROLE_CONFIG[role]?.label || role}
          </Text>
        ))}
      </View>
    );
  };

  const renderProductCard = (product: ProductListItem, index: number) => {
    const isCode = product.type === 'code_exclusive';
    const cardClass = [
      'product-card',
      product.locked ? 'product-card--locked' : '',
      isCode ? 'product-card--code-exclusive' : '',
    ].filter(Boolean).join(' ');

    return (
      <View
        key={product.productId}
        className={cardClass}
        style={{ animationDelay: `${index * 0.05}s` }}
        onClick={() => handleCardClick(product)}
      >
        <View className='product-card__image-wrap'>
          {product.imageUrl ? (
            <Image className='product-card__image' src={product.imageUrl} mode='aspectFill' />
          ) : (
            <View className='product-card__image-placeholder'>
              <Text className='product-card__image-placeholder-icon'>{isCode ? <TicketIcon size={32} color='var(--text-tertiary)' /> : <GiftIcon size={32} color='var(--text-tertiary)' />}</Text>
            </View>
          )}
          <View className={`product-card__type-tag ${isCode ? 'product-card__type-tag--code' : ''}`}>
            <Text>{isCode ? t('mall.productTypeCode') : t('mall.productTypePoints')}</Text>
          </View>
          {product.locked && (
            <View className='product-card__lock-overlay'>
              <Text className='product-card__lock-icon'><LockIcon size={24} color='var(--text-primary)' /></Text>
            </View>
          )}
        </View>

        <View className='product-card__body'>
          <Text className='product-card__name'>{product.name}</Text>
          <Text className='product-card__desc'>{product.description}</Text>

          {!isCode && renderRoleBadges(product.allowedRoles)}

          <View className='product-card__footer'>
            {isCode ? (
              <Text className='product-card__price product-card__price--code'>{t('mall.codeRedeem')}</Text>
            ) : (
              <View className='product-card__price'>
                <Text className='product-card__price-diamond'>◆</Text>
                <Text className='product-card__price-value'>
                  {product.pointsCost?.toLocaleString()}
                </Text>
              </View>
            )}
            {product.stock <= 0 && (
              <Text className='product-card__out-of-stock'>{t('mall.outOfStock')}</Text>
            )}
          </View>
        </View>
      </View>
    );
  };

  const renderTravelCard = (category: 'domestic' | 'international') => {
    const isDomestic = category === 'domestic';
    const title = isDomestic ? t('mall.travelDomestic') : t('mall.travelInternational');
    const threshold = isDomestic
      ? (travelSettings?.domesticThreshold ?? 0)
      : (travelSettings?.internationalThreshold ?? 0);
    const available = isDomestic
      ? (travelQuota?.domesticAvailable ?? 0)
      : (travelQuota?.internationalAvailable ?? 0);

    const isLocked = !isSpeaker || available <= 0;
    const lockHint = !isSpeaker
      ? t('mall.travelSpeakerOnly')
      : t('mall.travelInsufficientPoints');

    const handleApply = () => {
      if (isLocked) return;
      Taro.navigateTo({ url: `/pages/travel-apply/index?category=${category}` });
    };

    return (
      <View
        key={category}
        className={`travel-card ${isLocked ? 'travel-card--locked' : ''}`}
      >
        <View className='travel-card__icon-wrap'>
          {isDomestic
            ? <LocationIcon size={36} color={isLocked ? 'var(--text-tertiary)' : 'var(--accent-primary)'} />
            : <GlobeIcon size={36} color={isLocked ? 'var(--text-tertiary)' : 'var(--accent-primary)'} />
          }
        </View>
        <View className='travel-card__body'>
          <Text className='travel-card__title'>{title}</Text>
          <Text className='travel-card__threshold'>
            {t('mall.travelThreshold', { threshold: threshold.toLocaleString() })}
          </Text>
          {isSpeaker && (
            <View className='travel-card__quota'>
              <Text className='travel-card__quota-label'>{t('mall.travelAvailable')}</Text>
              <Text className={`travel-card__quota-value ${available > 0 ? 'travel-card__quota-value--available' : ''}`}>
                {available} {t('mall.travelAvailableUnit')}
              </Text>
            </View>
          )}
        </View>
        <View className='travel-card__action'>
          {isLocked ? (
            <View className='travel-card__locked'>
              <LockIcon size={16} color='var(--text-tertiary)' />
              <Text className='travel-card__locked-hint'>{lockHint}</Text>
            </View>
          ) : (
            <View className='travel-card__apply-btn btn-primary' onClick={handleApply}>
              <Text>{t('mall.travelApply')}</Text>
            </View>
          )}
        </View>
      </View>
    );
  };

  return (
    <View className='mall-page'>
      {/* Header / Welcome */}
      <View className='mall-header'>
        <View className='mall-header__info'>
          <View className='mall-header__info-row'>
            <View className='mall-header__home' onClick={() => Taro.redirectTo({ url: '/pages/hub/index' })}>
              <HomeIcon size={20} color='var(--text-secondary)' />
            </View>
            <Text className='mall-header__greeting'>
              {t('mall.greeting', { nickname: user?.nickname || t('mall.userFallback') })}
            </Text>
          </View>
          {user?.roles && user.roles.length > 0 && (
            <View className='mall-header__user-roles'>
              {user.roles.slice(0, 2).map((role) => (
                <Text key={role} className={`role-badge ${ROLE_CONFIG[role]?.className || ''}`}>
                  {ROLE_CONFIG[role]?.label || role}
                </Text>
              ))}
              {user.roles.length > 2 && (
                <Text className='mall-header__roles-overflow'>+{user.roles.length - 2}</Text>
              )}
            </View>
          )}
        </View>
        <View className='mall-header__right'>
          <View className='mall-header__points'>
            <Text className='mall-header__points-diamond'>◆</Text>
            <Text className='mall-header__points-value'>{user?.points?.toLocaleString() || '0'}</Text>
            <Text className='mall-header__points-label'>{t('mall.pointsLabel')}</Text>
          </View>
        </View>
      </View>

      {/* Filter Bar */}
      <View className='filter-bar'>
        <View className='filter-bar__types'>
          {([
            { key: 'all' as TypeFilter, label: t('mall.filterAll') },
            { key: 'points' as TypeFilter, label: t('mall.filterPoints') },
            { key: 'code_exclusive' as TypeFilter, label: t('mall.filterCodeExclusive') },
            { key: 'travel' as TypeFilter, label: t('mall.filterTravel') },
          ] as const).filter((item) => {
            // Hide code_exclusive tab until featureToggles loaded AND explicitly enabled
            if (item.key === 'code_exclusive' && featureToggles?.codeRedemptionEnabled !== true) return false;
            if (item.key === 'travel' && travelSettings?.travelSponsorshipEnabled !== true) return false;
            return true;
          }).map((item) => (
            <View
              key={item.key}
              className={`filter-tab ${typeFilter === item.key ? 'filter-tab--active' : ''}`}
              onClick={() => setTypeFilter(item.key)}
            >
              <Text>{item.label}</Text>
            </View>
          ))}
        </View>

        {typeFilter !== 'travel' && (
          <View className='filter-bar__role-wrap' ref={roleWrapRef}>
          <View
            className={`filter-bar__role-btn ${roleFilter ? 'filter-bar__role-btn--active' : ''}`}
            onClick={() => setShowRoleDropdown(!showRoleDropdown)}
          >
            <Text>{roleFilter ? ROLE_CONFIG[roleFilter]?.label : t('mall.roleFilter')}</Text>
            <Text className='filter-bar__role-arrow'>▾</Text>
          </View>

          {showRoleDropdown && (
            <View className='filter-bar__role-dropdown'>
              <View
                className={`filter-bar__role-option ${!roleFilter ? 'filter-bar__role-option--active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setRoleFilter(''); setShowRoleDropdown(false); }}
              >
                <Text>{t('mall.roleFilterAll')}</Text>
              </View>
              {ALL_ROLES.map((role) => (
                <View
                  key={role}
                  className={`filter-bar__role-option ${roleFilter === role ? 'filter-bar__role-option--active' : ''}`}
                  onClick={(e) => { e.stopPropagation(); setRoleFilter(role); setShowRoleDropdown(false); }}
                >
                  <Text>{ROLE_CONFIG[role].label}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
        )}
      </View>

      {/* Travel Card View */}
      {typeFilter === 'travel' && (
        <View className='travel-view mall-loading-fade'>
          {travelQuotaLoading ? (
            <View className='mall-loading'>
              <Text className='mall-loading__text'>{t('mall.travelLoading')}</Text>
            </View>
          ) : (
            <View className='travel-cards'>
              {renderTravelCard('domestic')}
              {renderTravelCard('international')}
            </View>
          )}
        </View>
      )}

      {/* Product Grid */}
      {typeFilter !== 'travel' && (
        loading ? (
          <ProductSkeleton />
        ) : products.length === 0 ? (
          <View className='mall-empty mall-loading-fade'>
            <Text className='mall-empty__icon'><PackageIcon size={48} color='var(--text-tertiary)' /></Text>
            <Text className='mall-empty__text'>{t('mall.noProducts')}</Text>
          </View>
        ) : (
          <View className='product-grid mall-loading-fade'>
            {products
              .filter((product) => {
                // Hide code_exclusive products until featureToggles loaded AND explicitly enabled
                if (product.type === 'code_exclusive' && featureToggles?.codeRedemptionEnabled !== true) return false;
                return true;
              })
              .map((product, index) => renderProductCard(product, index))}
          </View>
        )
      )}

      <TabBar current='/pages/index/index' />
    </View>
  );
}
