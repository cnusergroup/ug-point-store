import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import TabBar from '../../components/TabBar';
import { ProductSkeleton } from '../../components/Skeleton';
import { TicketIcon, GiftIcon, PackageIcon, LockIcon, GlobeIcon } from '../../components/icons';
import './index.scss';
/** Product type filter options */
type TypeFilter = 'all' | 'points' | 'code_exclusive';

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
  CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'];

export default function IndexPage() {
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
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
  }, [isAuthenticated, fetchProfile, fetchProducts]);

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

  return (
    <View className='mall-page'>
      {/* Header / Welcome */}
      <View className='mall-header'>
        <View className='mall-header__info'>
          <Text className='mall-header__greeting'>
            {t('mall.greeting', { nickname: user?.nickname || t('mall.userFallback') })}
          </Text>
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

      {/* Content Hub Entry */}
      <View
        className='mall-content-hub-entry'
        onClick={() => Taro.navigateTo({ url: '/pages/content/index' })}
      >
        <View className='mall-content-hub-entry__icon'>
          <GlobeIcon size={20} color='var(--accent-primary)' />
        </View>
        <Text className='mall-content-hub-entry__label'>{t('mall.contentHub')}</Text>
        <Text className='mall-content-hub-entry__arrow'>›</Text>
      </View>

      {/* Filter Bar */}
      <View className='filter-bar'>
        <View className='filter-bar__types'>
          {([
            { key: 'all' as TypeFilter, label: t('mall.filterAll') },
            { key: 'points' as TypeFilter, label: t('mall.filterPoints') },
            { key: 'code_exclusive' as TypeFilter, label: t('mall.filterCodeExclusive') },
          ]).map((item) => (
            <View
              key={item.key}
              className={`filter-tab ${typeFilter === item.key ? 'filter-tab--active' : ''}`}
              onClick={() => setTypeFilter(item.key)}
            >
              <Text>{item.label}</Text>
            </View>
          ))}
        </View>

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
      </View>

      {/* Product Grid */}
        {loading ? (
          <ProductSkeleton />
        ) : products.length === 0 ? (
          <View className='mall-empty mall-loading-fade'>
            <Text className='mall-empty__icon'><PackageIcon size={48} color='var(--text-tertiary)' /></Text>
            <Text className='mall-empty__text'>{t('mall.noProducts')}</Text>
          </View>
        ) : (
          <View className='product-grid mall-loading-fade'>
            {products.map((product, index) => renderProductCard(product, index))}
          </View>
        )}

      <TabBar current='/pages/index/index' />
    </View>
  );
}
