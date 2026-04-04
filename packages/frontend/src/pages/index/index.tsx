import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { request } from '../../utils/request';
import type { CartResponse } from '@points-mall/shared';
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
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [products, setProducts] = useState<ProductListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [cartCount, setCartCount] = useState(0);
  const logout = useAppStore((s) => s.logout);
  const fetchProfile = useAppStore((s) => s.fetchProfile);
  const roleWrapRef = useRef<HTMLDivElement>(null);
  const userMenuRef = useRef<HTMLDivElement>(null);

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

  // Close user menu when clicking outside
  useEffect(() => {
    if (!showUserMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside, true);
    return () => document.removeEventListener('click', handleClickOutside, true);
  }, [showUserMenu]);

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
    // Fetch cart item count
    request<CartResponse>({ url: '/api/cart' })
      .then((res) => {
        setCartCount(res.items.filter((i) => i.available).length);
      })
      .catch(() => {});
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
          <Text className='role-badge role-badge--all'>所有人</Text>
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
              <Text className='product-card__image-placeholder-icon'>{isCode ? '🎫' : '🎁'}</Text>
            </View>
          )}
          <View className={`product-card__type-tag ${isCode ? 'product-card__type-tag--code' : ''}`}>
            <Text>{isCode ? 'CODE' : '积分'}</Text>
          </View>
          {product.locked && (
            <View className='product-card__lock-overlay'>
              <Text className='product-card__lock-icon'>🔒</Text>
            </View>
          )}
        </View>

        <View className='product-card__body'>
          <Text className='product-card__name'>{product.name}</Text>
          <Text className='product-card__desc'>{product.description}</Text>

          {!isCode && renderRoleBadges(product.allowedRoles)}

          <View className='product-card__footer'>
            {isCode ? (
              <Text className='product-card__price product-card__price--code'>Code 兑换</Text>
            ) : (
              <View className='product-card__price'>
                <Text className='product-card__price-diamond'>◆</Text>
                <Text className='product-card__price-value'>
                  {product.pointsCost?.toLocaleString()}
                </Text>
              </View>
            )}
            {product.stock <= 0 && (
              <Text className='product-card__out-of-stock'>已售罄</Text>
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
            你好，{user?.nickname || '用户'} 👋
          </Text>
          {user?.roles && user.roles.length > 0 && (
            <View className='mall-header__user-roles'>
              {user.roles.map((role) => (
                <Text key={role} className={`role-badge ${ROLE_CONFIG[role]?.className || ''}`}>
                  {ROLE_CONFIG[role]?.label || role}
                </Text>
              ))}
            </View>
          )}
        </View>
        <View className='mall-header__right'>
          <View className='mall-header__points'>
            <Text className='mall-header__points-diamond'>◆</Text>
            <Text className='mall-header__points-value'>{user?.points?.toLocaleString() || '0'}</Text>
            <Text className='mall-header__points-label'>积分</Text>
          </View>
          <View className='mall-header__cart-btn' onClick={() => Taro.navigateTo({ url: '/pages/cart/index' })}>
            <Text className='mall-header__cart-icon'>🛒</Text>
            {cartCount > 0 && (
              <View className='mall-header__cart-badge'>
                <Text className='mall-header__cart-badge-text'>{cartCount > 99 ? '99+' : cartCount}</Text>
              </View>
            )}
          </View>
          <View className='mall-header__user-wrap' ref={userMenuRef}>
            <View className='mall-header__user-btn' onClick={() => setShowUserMenu(!showUserMenu)}>
              <Text className='mall-header__user-avatar'>
                {user?.nickname?.charAt(0)?.toUpperCase() || '?'}
              </Text>
            </View>
            {showUserMenu && (
              <View className='mall-header__user-menu'>
                <View className='mall-header__menu-item' onClick={(e) => { e.stopPropagation(); setShowUserMenu(false); Taro.navigateTo({ url: '/pages/profile/index' }); }}>
                  <Text>个人中心</Text>
                </View>
                {user?.roles?.some(r => r === 'Admin' || r === 'SuperAdmin') && (
                  <>
                    <View className='mall-header__menu-divider' />
                    <View className='mall-header__menu-item' onClick={(e) => { e.stopPropagation(); setShowUserMenu(false); Taro.navigateTo({ url: '/pages/admin/index' }); }}>
                      <Text>⚙️ 管理后台</Text>
                    </View>
                  </>
                )}
                <View className='mall-header__menu-divider' />
                <View className='mall-header__menu-item mall-header__menu-item--danger' onClick={(e) => { e.stopPropagation(); setShowUserMenu(false); logout(); }}>
                  <Text>退出登录</Text>
                </View>
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Filter Bar */}
      <View className='filter-bar'>
        <View className='filter-bar__types'>
          {([
            { key: 'all' as TypeFilter, label: '全部' },
            { key: 'points' as TypeFilter, label: '积分商品' },
            { key: 'code_exclusive' as TypeFilter, label: 'Code 专属' },
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
            <Text>{roleFilter ? ROLE_CONFIG[roleFilter]?.label : '身份筛选'}</Text>
            <Text className='filter-bar__role-arrow'>▾</Text>
          </View>

          {showRoleDropdown && (
            <View className='filter-bar__role-dropdown'>
              <View
                className={`filter-bar__role-option ${!roleFilter ? 'filter-bar__role-option--active' : ''}`}
                onClick={(e) => { e.stopPropagation(); setRoleFilter(''); setShowRoleDropdown(false); }}
              >
                <Text>全部身份</Text>
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
        <View className='mall-loading'>
          <Text className='mall-loading__text'>加载中...</Text>
        </View>
      ) : products.length === 0 ? (
        <View className='mall-empty'>
          <Text className='mall-empty__icon'>📦</Text>
          <Text className='mall-empty__text'>暂无商品</Text>
        </View>
      ) : (
        <View className='product-grid'>
          {products.map((product, index) => renderProductCard(product, index))}
        </View>
      )}
    </View>
  );
}
