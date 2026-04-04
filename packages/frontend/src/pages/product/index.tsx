import { useState, useEffect } from 'react';
import { View, Text, Image, Swiper, SwiperItem } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import './index.scss';

/** Product image info */
interface ProductImageInfo {
  key: string;
  url: string;
}

/** Size option */
interface SizeOptionInfo {
  name: string;
  stock: number;
}

/** Product detail from API (union of points + code_exclusive) */
interface ProductDetail {
  productId: string;
  name: string;
  description: string;
  imageUrl: string;
  type: 'points' | 'code_exclusive';
  status: string;
  stock: number;
  redemptionCount: number;
  pointsCost?: number;
  allowedRoles?: UserRole[] | 'all';
  eventInfo?: string;
  images?: ProductImageInfo[];
  sizeOptions?: SizeOptionInfo[];
  purchaseLimitEnabled?: boolean;
  purchaseLimitCount?: number;
}

const ROLE_CONFIG: Record<UserRole, { label: string; icon: string; className: string }> = {
  UserGroupLeader: { label: 'UserGroupLeader', icon: '👑', className: 'role-item--leader' },
  CommunityBuilder: { label: 'CommunityBuilder', icon: '🏗', className: 'role-item--builder' },
  Speaker: { label: 'Speaker', icon: '🎤', className: 'role-item--speaker' },
  Volunteer: { label: 'Volunteer', icon: '❤️', className: 'role-item--volunteer' },
  Admin: { label: 'Admin', icon: '⚙️', className: 'role-item--admin' },
  SuperAdmin: { label: 'SuperAdmin', icon: '🛡️', className: 'role-item--superadmin' },
};

export default function ProductDetailPage() {
  const router = useRouter();
  const productId = router.params.id || '';

  const user = useAppStore((s) => s.user);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) {
      setError('商品不存在');
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const res = await request<ProductDetail>({ url: `/api/products/${productId}` });
        setProduct(res);
      } catch {
        setError('商品加载失败');
      } finally {
        setLoading(false);
      }
    })();
  }, [productId]);

  const handleBack = () => {
    goBack('/pages/index/index');
  };

  const [addingToCart, setAddingToCart] = useState(false);

  const hasSizeOptions = product?.sizeOptions && product.sizeOptions.length > 0;
  const needsSizeSelection = hasSizeOptions && !selectedSize;

  /** Get the stock for the selected size, or total stock if no sizes */
  const getEffectiveStock = (): number => {
    if (!product) return 0;
    if (hasSizeOptions && selectedSize) {
      const sizeOpt = product.sizeOptions!.find((s) => s.name === selectedSize);
      return sizeOpt?.stock ?? 0;
    }
    return product.stock;
  };

  const handleRedeem = () => {
    if (!product) return;
    if (needsSizeSelection) {
      Taro.showToast({ title: '请选择尺码', icon: 'none', duration: 1500 });
      return;
    }
    if (product.type === 'points') {
      const sizeParam = selectedSize ? `&selectedSize=${encodeURIComponent(selectedSize)}` : '';
      Taro.navigateTo({ url: `/pages/order-confirm/index?productId=${product.productId}&quantity=1${sizeParam}` });
    } else {
      Taro.navigateTo({ url: `/pages/redeem/index?productId=${product.productId}&type=code` });
    }
  };

  const handleAddToCart = async () => {
    if (!product || addingToCart) return;
    if (needsSizeSelection) {
      Taro.showToast({ title: '请选择尺码', icon: 'none', duration: 1500 });
      return;
    }
    setAddingToCart(true);
    try {
      await request({
        url: '/api/cart/items',
        method: 'POST',
        data: {
          productId: product.productId,
          ...(selectedSize ? { selectedSize } : {}),
        },
      });
      Taro.showToast({ title: '已加入购物车', icon: 'success', duration: 1500 });
    } catch (err: any) {
      const msg = err?.data?.message || err?.message || '加入购物车失败';
      Taro.showToast({ title: msg, icon: 'none', duration: 2000 });
    } finally {
      setAddingToCart(false);
    }
  };

  const canUserRedeem = (): boolean => {
    if (!product || !user) return false;
    if (needsSizeSelection) return false;
    const effectiveStock = getEffectiveStock();
    if (effectiveStock <= 0) return false;
    if (product.type === 'code_exclusive') return true;
    if (product.type === 'points') {
      const allowed = product.allowedRoles;
      if (!allowed || allowed === 'all') return user.points >= (product.pointsCost || 0);
      return allowed.some((r) => user.roles.includes(r)) && user.points >= (product.pointsCost || 0);
    }
    return false;
  };

  const canAddToCart = (): boolean => {
    if (!product) return false;
    if (needsSizeSelection) return false;
    const effectiveStock = getEffectiveStock();
    return effectiveStock > 0;
  };

  const getRedeemButtonText = (): string => {
    if (!product) return '';
    if (needsSizeSelection) return '请选择尺码';
    const effectiveStock = getEffectiveStock();
    if (effectiveStock <= 0) return '已售罄';
    if (product.type === 'code_exclusive') return '输入 Code 兑换';
    if (!user) return '请先登录';
    const allowed = product.allowedRoles;
    if (allowed && allowed !== 'all' && !allowed.some((r) => user.roles.includes(r))) {
      return '身份不符';
    }
    if (user.points < (product.pointsCost || 0)) return '积分不足';
    return '立即兑换';
  };

  if (loading) {
    return (
      <View className='detail-page'>
        <View className='detail-loading'>
          <Text className='detail-loading__text'>加载中...</Text>
        </View>
      </View>
    );
  }

  if (error || !product) {
    return (
      <View className='detail-page'>
        <View className='detail-header'>
          <Text className='detail-header__back' onClick={handleBack}>← 返回</Text>
        </View>
        <View className='detail-error'>
          <Text className='detail-error__text'>{error || '商品不存在'}</Text>
        </View>
      </View>
    );
  }

  const isCode = product.type === 'code_exclusive';
  const redeemable = canUserRedeem();
  const cartEnabled = canAddToCart();
  const buttonText = getRedeemButtonText();
  const hasImages = product.images && product.images.length > 0;

  return (
    <View className='detail-page'>
      {/* Top bar */}
      <View className='detail-header'>
        <Text className='detail-header__back' onClick={handleBack}>← 返回</Text>
        {user && (
          <View className='detail-header__points'>
            <Text className='detail-header__points-diamond'>◆</Text>
            <Text className='detail-header__points-value'>{user.points.toLocaleString()}</Text>
          </View>
        )}
      </View>

      {/* Content */}
      <View className='detail-content'>
        {/* Image + Basic Info */}
        <View className='detail-top'>
          <View className='detail-image-wrap'>
            {/* Task 10.1: Image carousel when images array is available */}
            {hasImages ? (
              <View className='detail-carousel'>
                <Swiper
                  className='detail-carousel__swiper'
                  indicatorDots={false}
                  circular
                  onChange={(e) => setCurrentImageIndex(e.detail.current)}
                >
                  {product.images!.map((img) => (
                    <SwiperItem key={img.key}>
                      <Image className='detail-carousel__image' src={img.url} mode='aspectFill' />
                    </SwiperItem>
                  ))}
                </Swiper>
                <View className='detail-carousel__indicator'>
                  <Text className='detail-carousel__indicator-text'>
                    {currentImageIndex + 1}/{product.images!.length}
                  </Text>
                </View>
              </View>
            ) : product.imageUrl ? (
              <Image className='detail-image' src={product.imageUrl} mode='aspectFill' />
            ) : (
              <View className='detail-image-placeholder'>
                <Text className='detail-image-placeholder__icon'>{isCode ? '🎫' : '🎁'}</Text>
              </View>
            )}
          </View>

          <View className='detail-info'>
            <Text className='detail-info__name'>{product.name}</Text>

            {/* Role badges for points products */}
            {!isCode && product.allowedRoles && (
              <View className='detail-info__roles'>
                {product.allowedRoles === 'all' ? (
                  <Text className='role-badge role-badge--all'>所有人</Text>
                ) : (
                  product.allowedRoles.map((role) => (
                    <Text key={role} className={`role-badge role-badge--${role === 'UserGroupLeader' ? 'leader' : role === 'CommunityBuilder' ? 'builder' : role === 'Speaker' ? 'speaker' : 'volunteer'}`}>
                      {ROLE_CONFIG[role]?.label || role}
                    </Text>
                  ))
                )}
              </View>
            )}

            {/* Price */}
            {isCode ? (
              <Text className='detail-info__code-label'>Code 专属商品</Text>
            ) : (
              <View className='detail-info__price'>
                <Text className='detail-info__price-diamond'>◆</Text>
                <Text className='detail-info__price-value'>{product.pointsCost?.toLocaleString()}</Text>
                <Text className='detail-info__price-unit'>积分</Text>
              </View>
            )}

            <Text className='detail-info__stock'>
              库存: {hasSizeOptions && selectedSize
                ? getEffectiveStock()
                : product.stock}
            </Text>

            {/* Task 10.3: Purchase limit hint */}
            {product.purchaseLimitEnabled && product.purchaseLimitCount && (
              <Text className='detail-info__limit-hint'>
                每人限购 {product.purchaseLimitCount} 件
              </Text>
            )}
          </View>
        </View>

        {/* Task 10.2: Size selector */}
        {hasSizeOptions && (
          <View className='detail-section detail-section--sizes'>
            <Text className='detail-section__title'>选择尺码</Text>
            <View className='detail-sizes'>
              {product.sizeOptions!.map((size) => {
                const isSelected = selectedSize === size.name;
                const isSoldOut = size.stock <= 0;
                return (
                  <View
                    key={size.name}
                    className={`detail-sizes__tag ${isSelected ? 'detail-sizes__tag--active' : ''} ${isSoldOut ? 'detail-sizes__tag--disabled' : ''}`}
                    onClick={!isSoldOut ? () => setSelectedSize(size.name) : undefined}
                  >
                    <Text className='detail-sizes__tag-name'>{size.name}</Text>
                    {isSoldOut && <Text className='detail-sizes__tag-sold-out'>已售罄</Text>}
                  </View>
                );
              })}
            </View>
            {selectedSize && (
              <Text className='detail-sizes__stock-hint'>
                当前尺码库存: {getEffectiveStock()}
              </Text>
            )}
            {needsSizeSelection && (
              <Text className='detail-sizes__select-hint'>请选择尺码后再操作</Text>
            )}
          </View>
        )}

        {/* Description */}
        <View className='detail-section'>
          <Text className='detail-section__title'>商品描述</Text>
          <Text className='detail-section__text'>{product.description}</Text>
        </View>

        {/* Role restriction info (points products) */}
        {!isCode && product.allowedRoles && product.allowedRoles !== 'all' && (
          <View className='detail-section detail-section--role-info'>
            <Text className='detail-section__title'>⚠ 身份限定说明</Text>
            <Text className='detail-section__subtitle'>此商品仅限以下身份兑换：</Text>
            <View className='detail-role-list'>
              {product.allowedRoles.map((role) => (
                <View key={role} className={`detail-role-item ${ROLE_CONFIG[role]?.className || ''}`}>
                  <Text className='detail-role-item__icon'>{ROLE_CONFIG[role]?.icon}</Text>
                  <Text className='detail-role-item__name'>{ROLE_CONFIG[role]?.label || role}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Event info (code exclusive products) */}
        {isCode && product.eventInfo && (
          <View className='detail-section detail-section--event-info'>
            <Text className='detail-section__title'>🎯 关联活动</Text>
            <Text className='detail-section__text'>{product.eventInfo}</Text>
            <Text className='detail-section__hint'>此商品需要活动专属兑换码才能兑换</Text>
          </View>
        )}
      </View>

      {/* Bottom Redeem Bar */}
      <View className='detail-bottom'>
        {!isCode && product.pointsCost != null && user && (
          <View className='detail-bottom__balance'>
            <Text className='detail-bottom__balance-label'>当前余额: </Text>
            <Text className='detail-bottom__balance-value'>{user.points.toLocaleString()}</Text>
            <Text className='detail-bottom__balance-sep'> | </Text>
            <Text className='detail-bottom__balance-label'>需要: </Text>
            <Text className='detail-bottom__balance-cost'>{product.pointsCost.toLocaleString()}</Text>
          </View>
        )}
        {!isCode ? (
          <View className='detail-bottom__actions'>
            <View
              className={`detail-bottom__btn detail-bottom__btn--cart ${!cartEnabled ? 'detail-bottom__btn--disabled' : ''}`}
              onClick={cartEnabled ? handleAddToCart : undefined}
            >
              <Text>{addingToCart ? '添加中...' : '🛒 加入购物车'}</Text>
            </View>
            <View
              className={`detail-bottom__btn detail-bottom__btn--redeem ${!redeemable ? 'detail-bottom__btn--disabled' : ''}`}
              onClick={redeemable ? handleRedeem : undefined}
            >
              <Text>{buttonText}</Text>
            </View>
          </View>
        ) : (
          <View
            className='detail-bottom__btn'
            onClick={handleRedeem}
          >
            <Text>{buttonText}</Text>
          </View>
        )}
      </View>
    </View>
  );
}
