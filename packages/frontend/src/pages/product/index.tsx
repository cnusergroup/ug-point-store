import { useState, useEffect } from 'react';
import { View, Text, Image, Swiper, SwiperItem } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import { goBack } from '../../utils/navigation';
import { TicketIcon, GiftIcon, WarningIcon, ShoppingBagIcon, CartIcon } from '../../components/icons';
import PageToolbar from '../../components/PageToolbar';
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
  UserGroupLeader: { label: 'UserGroupLeader', icon: '♛', className: 'role-item--leader' },
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'CommunityBuilder', icon: '▣', className: 'role-item--builder' },
  Speaker: { label: 'Speaker', icon: '♪', className: 'role-item--speaker' },
  Volunteer: { label: 'Volunteer', icon: '♥', className: 'role-item--volunteer' },
  Admin: { label: 'Admin', icon: '⚙', className: 'role-item--admin' },
  SuperAdmin: { label: 'SuperAdmin', icon: '◈', className: 'role-item--superadmin' },
};

export default function ProductDetailPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const productId = router.params.id || '';

  const user = useAppStore((s) => s.user);
  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [currentImageIndex, setCurrentImageIndex] = useState(0);
  const [selectedSize, setSelectedSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!productId) {
      setError(t('product.notFound'));
      setLoading(false);
      return;
    }
    (async () => {
      setLoading(true);
      try {
        const res = await request<ProductDetail>({ url: `/api/products/${productId}` });
        setProduct(res);
      } catch {
        setError(t('product.loadFailed'));
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

  /** Compute max selectable quantity: min(effectiveStock, purchaseLimitRemaining) */
  const getMaxQuantity = (): number => {
    const stock = getEffectiveStock();
    if (stock <= 0) return 0;
    if (product?.purchaseLimitEnabled && product.purchaseLimitCount) {
      return Math.min(stock, product.purchaseLimitCount);
    }
    return stock;
  };

  /** Reset quantity to 1 when size changes */
  useEffect(() => {
    setQuantity(1);
  }, [selectedSize]);

  const handleRedeem = () => {
    if (!product) return;
    if (needsSizeSelection) {
      Taro.showToast({ title: t('product.selectSizeFirst'), icon: 'none', duration: 1500 });
      return;
    }
    if (product.type === 'points') {
      const sizeParam = selectedSize ? `&selectedSize=${encodeURIComponent(selectedSize)}` : '';
      Taro.navigateTo({ url: `/pages/order-confirm/index?productId=${product.productId}&quantity=${quantity}${sizeParam}` });
    } else {
      Taro.navigateTo({ url: `/pages/redeem/index?productId=${product.productId}&type=code` });
    }
  };

  const handleAddToCart = async () => {
    if (!product || addingToCart) return;
    if (needsSizeSelection) {
      Taro.showToast({ title: t('product.selectSizeFirst'), icon: 'none', duration: 1500 });
      return;
    }
    setAddingToCart(true);
    try {
      await request({
        url: '/api/cart/items',
        method: 'POST',
        data: {
          productId: product.productId,
          quantity,
          ...(selectedSize ? { selectedSize } : {}),
        },
      });
      Taro.showToast({ title: t('product.addedToCart'), icon: 'success', duration: 1500 });
    } catch (err: any) {
      const code = err?.data?.code || '';
      const serverMsg = err?.data?.message || '';
      let msg = t('product.addToCartFailed');
      if (code === 'QUANTITY_EXCEEDS_STOCK' && serverMsg) {
        msg = serverMsg;
      } else if (code === 'OUT_OF_STOCK' || code === 'PRODUCT_UNAVAILABLE') {
        msg = t('product.stockChanged');
      } else if (serverMsg) {
        msg = serverMsg;
      }
      Taro.showToast({ title: msg, icon: 'none', duration: 2000 });
    } finally {
      setAddingToCart(false);
    }
  };

  const canUserRedeem = (): boolean => {
    if (!product || !user) return false;
    if (product.status === 'inactive') return false;
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
    if (product.status === 'inactive') return false;
    if (needsSizeSelection) return false;
    const effectiveStock = getEffectiveStock();
    return effectiveStock > 0;
  };

  const getRedeemButtonText = (): string => {
    if (!product) return '';
    if (product.status === 'inactive') return t('product.delisted');
    if (needsSizeSelection) return t('product.selectSizeHint');
    const effectiveStock = getEffectiveStock();
    if (effectiveStock <= 0) return t('product.soldOut');
    if (product.type === 'code_exclusive') return t('product.enterCodeRedeem');
    if (!user) return t('product.pleaseLogin');
    const allowed = product.allowedRoles;
    if (allowed && allowed !== 'all' && !allowed.some((r) => user.roles.includes(r))) {
      return t('product.roleNotMatch');
    }
    if (user.points < (product.pointsCost || 0)) return t('product.insufficientPoints');
    return t('product.redeemNow');
  };

  if (loading) {
    return (
      <View className='detail-page'>
        <View className='detail-loading'>
          <Text className='detail-loading__text'>{t('product.loading')}</Text>
        </View>
      </View>
    );
  }

  if (error || !product) {
    return (
      <View className='detail-page'>
        <PageToolbar title='' onBack={handleBack} />
        <View className='detail-error'>
          <Text className='detail-error__text'>{error || t('product.notFound')}</Text>
        </View>
      </View>
    );
  }

  const isCode = product.type === 'code_exclusive';
  const isDelisted = product.status === 'inactive';
  const redeemable = canUserRedeem();
  const cartEnabled = canAddToCart();
  const buttonText = getRedeemButtonText();
  const hasImages = product.images && product.images.length > 0;
  const effectiveStock = getEffectiveStock();
  const maxQuantity = getMaxQuantity();
  const isSoldOut = effectiveStock <= 0;

  return (
    <View className='detail-page'>
      {/* Top bar */}
      <PageToolbar
        title=''
        onBack={handleBack}
        rightSlot={user ? (
          <View className='detail-header__points'>
            <Text className='detail-header__points-diamond'>◆</Text>
            <Text className='detail-header__points-value'>{user.points.toLocaleString()}</Text>
          </View>
        ) : undefined}
      />

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
                      <Image
                        className='detail-carousel__image'
                        src={img.url}
                        mode='aspectFill'
                        onClick={() => setPreviewUrl(img.url)}
                      />
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
              <Image
                className='detail-image'
                src={product.imageUrl}
                mode='aspectFill'
                onClick={() => setPreviewUrl(product.imageUrl!)}
              />
            ) : (
              <View className='detail-image-placeholder'>
                <Text className='detail-image-placeholder__icon'>{isCode ? <TicketIcon size={48} color='var(--text-tertiary)' /> : <GiftIcon size={48} color='var(--text-tertiary)' />}</Text>
              </View>
            )}
          </View>

          <View className='detail-info'>
            <Text className='detail-info__name'>{product.name}</Text>

            {/* Delisted badge */}
            {isDelisted && (
              <Text className='detail-info__delisted-badge'>{t('product.delistedBadge')}</Text>
            )}

            {/* Role badges for points products */}
            {!isCode && product.allowedRoles && (
              <View className='detail-info__roles'>
                {product.allowedRoles === 'all' ? (
                  <Text className='role-badge role-badge--all'>{t('product.everyone')}</Text>
                ) : (
                  product.allowedRoles.map((role) => (
                    <Text key={role} className={`role-badge role-badge--${role === 'UserGroupLeader' ? 'leader' : /* [DISABLED] CommunityBuilder */ role === 'Speaker' ? 'speaker' : 'volunteer'}`}>
                      {ROLE_CONFIG[role]?.label || role}
                    </Text>
                  ))
                )}
              </View>
            )}

            {/* Price */}
            {isCode ? (
              <Text className='detail-info__code-label'>{t('product.codeExclusiveLabel')}</Text>
            ) : (
              <View className='detail-info__price'>
                <Text className='detail-info__price-diamond'>◆</Text>
                <Text className='detail-info__price-value'>{product.pointsCost?.toLocaleString()}</Text>
                <Text className='detail-info__price-unit'>{t('product.pointsUnit')}</Text>
              </View>
            )}

            <Text className='detail-info__stock'>
              {t('product.stockLabel', { count: hasSizeOptions && selectedSize
                ? getEffectiveStock()
                : product.stock })}
            </Text>

            {/* Task 10.3: Purchase limit hint */}
            {product.purchaseLimitEnabled && product.purchaseLimitCount && (
              <Text className='detail-info__limit-hint'>
                {t('product.purchaseLimit', { count: product.purchaseLimitCount })}
              </Text>
            )}
          </View>
        </View>

        {/* Task 10.2: Size selector */}
        {hasSizeOptions && (
          <View className='detail-section detail-section--sizes'>
            <Text className='detail-section__title'>{t('product.selectSize')}</Text>
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
                    {isSoldOut && <Text className='detail-sizes__tag-sold-out'>{t('product.soldOut')}</Text>}
                  </View>
                );
              })}
            </View>
            {selectedSize && (
              <Text className='detail-sizes__stock-hint'>
                {t('product.currentSizeStock', { count: getEffectiveStock() })}
              </Text>
            )}
            {needsSizeSelection && (
              <Text className='detail-sizes__select-hint'>{t('product.selectSizeHint')}</Text>
            )}
          </View>
        )}

        {/* Description */}
        <View className='detail-section'>
          <Text className='detail-section__title'>{t('product.descriptionTitle')}</Text>
          <Text className='detail-section__text'>{product.description}</Text>
        </View>

        {/* Role restriction info (points products) */}
        {!isCode && product.allowedRoles && product.allowedRoles !== 'all' && (
          <View className='detail-section detail-section--role-info'>
            <Text className='detail-section__title'><WarningIcon size={16} color='var(--warning)' /> {t('product.roleRestrictionTitle')}</Text>
            <Text className='detail-section__subtitle'>{t('product.roleRestrictionSubtitle')}</Text>
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
            <Text className='detail-section__title'><ShoppingBagIcon size={16} color='var(--role-leader)' /> {t('product.eventInfoTitle')}</Text>
            <Text className='detail-section__text'>{product.eventInfo}</Text>
            <Text className='detail-section__hint'>{t('product.eventInfoHint')}</Text>
          </View>
        )}
      </View>

      {/* Bottom Redeem Bar */}
      <View className='detail-bottom'>
        {!isCode && product.pointsCost != null && user && (
          <View className='detail-bottom__balance'>
            <Text className='detail-bottom__balance-label'>{t('product.balanceLabel')}</Text>
            <Text className='detail-bottom__balance-value'>{user.points.toLocaleString()}</Text>
            <Text className='detail-bottom__balance-sep'> | </Text>
            <Text className='detail-bottom__balance-label'>{t('product.needLabel')}</Text>
            <Text className='detail-bottom__balance-cost'>{product.pointsCost.toLocaleString()}</Text>
          </View>
        )}
        {/* Quantity selector: only for points products with stock > 0 */}
        {!isCode && !isSoldOut && !isDelisted && !needsSizeSelection && (
          <View className='detail-quantity'>
            <Text className='detail-quantity__label'>{t('product.quantityLabel')}</Text>
            <View className='detail-quantity__controls'>
              <View
                className={`detail-quantity__btn ${quantity <= 1 ? 'detail-quantity__btn--disabled' : ''}`}
                onClick={quantity > 1 ? () => setQuantity((q) => q - 1) : undefined}
              >
                <Text className='detail-quantity__btn-text'>−</Text>
              </View>
              <View className='detail-quantity__value'>
                <Text className='detail-quantity__value-text'>{quantity}</Text>
              </View>
              <View
                className={`detail-quantity__btn ${quantity >= maxQuantity ? 'detail-quantity__btn--disabled' : ''}`}
                onClick={quantity < maxQuantity ? () => setQuantity((q) => q + 1) : undefined}
              >
                <Text className='detail-quantity__btn-text'>+</Text>
              </View>
            </View>
            {quantity >= maxQuantity && (
              <Text className='detail-quantity__hint'>{t('product.maxQuantityHint')}</Text>
            )}
          </View>
        )}
        {!isCode ? (
          <View className='detail-bottom__actions'>
            {!isSoldOut && (
              <View
                className={`detail-bottom__btn detail-bottom__btn--cart ${!cartEnabled ? 'detail-bottom__btn--disabled' : ''}`}
                onClick={cartEnabled ? handleAddToCart : undefined}
              >
                <Text>{addingToCart ? t('product.addingToCart') : <><CartIcon size={16} color='currentColor' /> {t('product.addToCart')}</>}</Text>
              </View>
            )}
            <View
              className={`detail-bottom__btn detail-bottom__btn--redeem ${!redeemable ? 'detail-bottom__btn--disabled' : ''}`}
              onClick={redeemable ? handleRedeem : undefined}
            >
              <Text>{buttonText}</Text>
            </View>
          </View>
        ) : (
          <View
            className={`detail-bottom__btn ${!redeemable ? 'detail-bottom__btn--disabled' : ''}`}
            onClick={redeemable ? handleRedeem : undefined}
          >
            <Text>{buttonText}</Text>
          </View>
        )}
      </View>

      {/* Image Preview Lightbox */}
      {previewUrl && (
        <View
          style={{
            position: 'fixed',
            inset: '0',
            background: 'rgba(0,0,0,0.88)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: '200',
            cursor: 'pointer',
          }}
          onClick={() => setPreviewUrl(null)}
        >
          <img
            src={previewUrl}
            style={{ maxWidth: '90vw', maxHeight: '85vh', objectFit: 'contain', borderRadius: '8px', cursor: 'default', display: 'block' }}
            onClick={(e) => e.stopPropagation()}
            alt='preview'
          />
          <View
            style={{
              position: 'fixed',
              top: '20px',
              right: '20px',
              width: '40px',
              height: '40px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'rgba(255,255,255,0.15)',
              borderRadius: '50%',
              cursor: 'pointer',
              fontSize: '18px',
              color: '#fff',
            }}
            onClick={() => setPreviewUrl(null)}
          >
            <Text style={{ color: '#fff', fontSize: '18px' }}>✕</Text>
          </View>
        </View>
      )}
    </View>
  );
}
