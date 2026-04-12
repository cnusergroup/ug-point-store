import { useState, useEffect, useCallback } from 'react';
import { View, Text, Image, Input } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { LocationIcon, TicketIcon, GiftIcon } from '../../components/icons';
import './index.scss';

/** Redemption page mode */
type RedeemMode = 'points' | 'code' | 'points-code';

/** Product info for display */
interface ProductInfo {
  productId: string;
  name: string;
  imageUrl: string;
  type: 'points' | 'code_exclusive';
  pointsCost?: number;
  stock: number;
}

/** Address from API */
interface AddressResponse {
  addressId: string;
  recipientName: string;
  phone: string;
  detailAddress: string;
  isDefault: boolean;
}

/** Points redemption response */
interface PointsRedemptionResponse {
  redemptionId: string;
  productName: string;
  pointsSpent: number;
  orderId?: string;
}

/** Code redemption response */
interface CodeRedemptionResponse {
  redemptionId: string;
  productName: string;
  orderId?: string;
}

/** Points code redeem response */
interface PointsCodeResponse {
  pointsEarned: number;
  newBalance: number;
}

/** Error code to translation key mapping */
const ERROR_CODE_KEYS: Record<string, string> = {
  INSUFFICIENT_POINTS: 'redeem.errorInsufficientPoints',
  CODE_ALREADY_USED: 'redeem.errorCodeAlreadyUsed',
  CODE_EXHAUSTED: 'redeem.errorCodeExhausted',
  INVALID_CODE: 'redeem.errorInvalidCode',
  CODE_PRODUCT_MISMATCH: 'redeem.errorCodeProductMismatch',
  CODE_ONLY_PRODUCT: 'redeem.errorCodeOnlyProduct',
  OUT_OF_STOCK: 'redeem.errorOutOfStock',
  NO_REDEMPTION_PERMISSION: 'redeem.errorNoPermission',
  NO_ADDRESS_SELECTED: 'redeem.errorNoAddress',
  ADDRESS_NOT_FOUND: 'redeem.errorAddressNotFound',
  PURCHASE_LIMIT_EXCEEDED: 'redeem.errorPurchaseLimitExceeded',
};

export default function RedeemPage() {
  const router = useRouter();
  const productId = router.params.productId || '';
  const mode = (router.params.type as RedeemMode) || 'points-code';

  const user = useAppStore((s) => s.user);
  const updatePoints = useAppStore((s) => s.updatePoints);
  const { t } = useTranslation();

  const [product, setProduct] = useState<ProductInfo | null>(null);
  const [pageLoading, setPageLoading] = useState(!!productId);
  const [codeValue, setCodeValue] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Feature toggle state (only used for points-code mode)
  const [featureDisabled, setFeatureDisabled] = useState(false);
  const [featureLoading, setFeatureLoading] = useState(mode === 'points-code');

  // Address state
  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState('');
  const [showAddressList, setShowAddressList] = useState(false);

  // Success state
  const [success, setSuccess] = useState(false);
  const [successOrderId, setSuccessOrderId] = useState('');
  const [successData, setSuccessData] = useState<{
    type: 'product' | 'points';
    productName?: string;
    pointsSpent?: number;
    pointsEarned?: number;
    newBalance?: number;
  } | null>(null);

  // Load addresses for points/code modes
  const loadAddresses = useCallback(async () => {
    try {
      const res = await request<AddressResponse[]>({ url: '/api/addresses' });
      setAddresses(res);
      const defaultAddr = res.find((a) => a.isDefault);
      if (defaultAddr) {
        setSelectedAddressId(defaultAddr.addressId);
      } else if (res.length > 0) {
        setSelectedAddressId(res[0].addressId);
      }
    } catch {
      // Non-blocking
    }
  }, []);

  // Load product info if productId is provided
  useEffect(() => {
    if (!productId) {
      setPageLoading(false);
      return;
    }
    (async () => {
      setPageLoading(true);
      try {
        const res = await request<ProductInfo>({ url: `/api/products/${productId}` });
        setProduct(res);
      } catch {
        setError(t('redeem.productLoadFailed'));
      } finally {
        setPageLoading(false);
      }
    })();
  }, [productId]);

  // Load addresses for product redemption modes
  useEffect(() => {
    if (mode === 'points' || mode === 'code') {
      loadAddresses();
    }
  }, [mode, loadAddresses]);

  // Check feature toggle for points-code mode
  useEffect(() => {
    if (mode !== 'points-code') return;
    setFeatureLoading(true);
    request<{ codeRedemptionEnabled: boolean }>({
      url: '/api/settings/feature-toggles',
      skipAuth: true,
    })
      .then((res) => {
        setFeatureDisabled(!res.codeRedemptionEnabled);
      })
      .catch(() => {
        // Frontend degradation: default to showing the form on failure
        setFeatureDisabled(false);
      })
      .finally(() => {
        setFeatureLoading(false);
      });
  }, [mode]);

  const handleBack = () => {
    goBack('/pages/index/index');
  };

  const goToProductList = () => {
    Taro.redirectTo({ url: '/pages/index/index' });
  };

  const getErrorMessage = (err: unknown): string => {
    if (err instanceof RequestError) {
      const key = ERROR_CODE_KEYS[err.code];
      return key ? t(key) : err.message;
    }
    return t('redeem.redeemFailed');
  };

  /** Points redemption: POST /api/redemptions/points */
  const handlePointsRedeem = async () => {
    if (!product || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await request<PointsRedemptionResponse>({
        url: '/api/redemptions/points',
        method: 'POST',
        data: { productId: product.productId, addressId: selectedAddressId },
      });
      // Update local points balance
      if (user && product.pointsCost) {
        updatePoints(user.points - product.pointsCost);
      }
      setSuccess(true);
      setSuccessOrderId(res.orderId || '');
      setSuccessData({
        type: 'product',
        productName: product.name,
        pointsSpent: res.pointsSpent,
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Code redemption for product: POST /api/redemptions/code */
  const handleCodeRedeem = async () => {
    if (!product || !codeValue.trim() || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await request<CodeRedemptionResponse>({
        url: '/api/redemptions/code',
        method: 'POST',
        data: { productId: product.productId, code: codeValue.trim(), addressId: selectedAddressId },
      });
      setSuccess(true);
      setSuccessOrderId(res.orderId || '');
      setSuccessData({
        type: 'product',
        productName: product.name,
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  /** Points code redemption (no product): POST /api/points/redeem-code */
  const handlePointsCodeRedeem = async () => {
    if (!codeValue.trim() || submitting) return;
    setError('');
    setSubmitting(true);
    try {
      const res = await request<PointsCodeResponse>({
        url: '/api/points/redeem-code',
        method: 'POST',
        data: { code: codeValue.trim() },
      });
      updatePoints(res.newBalance);
      setSuccess(true);
      setSuccessData({
        type: 'points',
        pointsEarned: res.pointsEarned,
        newBalance: res.newBalance,
      });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Success View ----
  if (success && successData) {
    const goToOrderDetail = () => {
      if (successOrderId) {
        Taro.navigateTo({ url: `/pages/order-detail/index?id=${successOrderId}` });
      }
    };

    return (
      <View className='redeem-page'>
        <View className='redeem-header'>
          <View className='redeem-header__spacer' />
          <Text className='redeem-header__title'>{t('redeem.resultTitle')}</Text>
          <View className='redeem-header__spacer' />
        </View>
        <View className='redeem-content'>
          <View className='redeem-success'>
            <Text className='redeem-success__icon'>✓</Text>
            <Text className='redeem-success__title'>{t('redeem.successTitle')}</Text>
            {successData.type === 'product' ? (
              <>
                <Text className='redeem-success__message'>
                  {t('redeem.successProductMessage', { name: successData.productName || '' })}
                  {successData.pointsSpent ? t('redeem.successPointsSpent', { count: successData.pointsSpent.toLocaleString() }) : ''}
                </Text>
              </>
            ) : (
              <>
                <Text className='redeem-success__message'>{t('redeem.successPointsCodeMessage')}</Text>
                <View className='redeem-success__detail'>
                  <Text className='redeem-success__detail-label'>{t('redeem.earnedPoints')}</Text>
                  <Text className='redeem-success__detail-value'>+{successData.pointsEarned?.toLocaleString()}</Text>
                </View>
                <Text className='redeem-success__message'>
                  {t('redeem.currentBalance', { count: successData.newBalance?.toLocaleString() || '0' })}
                </Text>
              </>
            )}
            <View className='redeem-success__actions'>
              {successOrderId && (
                <View className='redeem-success__order-btn' onClick={goToOrderDetail}>
                  <Text>{t('redeem.viewOrder')}</Text>
                </View>
              )}
              <View className='redeem-success__back-btn' onClick={goToProductList}>
                <Text>{t('redeem.backToProductList')}</Text>
              </View>
            </View>
          </View>
        </View>
      </View>
    );
  }

  // ---- Loading View ----
  if (pageLoading || featureLoading) {
    return (
      <View className='redeem-page'>
        <View className='redeem-header'>
          <Text className='redeem-header__back' onClick={handleBack}>{t('redeem.backButton')}</Text>
          <Text className='redeem-header__title'>{t('redeem.redeemTitle')}</Text>
          <View className='redeem-header__spacer' />
        </View>
        <View className='redeem-loading'>
          <Text className='redeem-loading__text'>{t('redeem.loadingText')}</Text>
        </View>
      </View>
    );
  }

  // ---- Error View (page-level, e.g. product not found) ----
  if (!productId && mode !== 'points-code') {
    return (
      <View className='redeem-page'>
        <View className='redeem-header'>
          <Text className='redeem-header__back' onClick={handleBack}>{t('redeem.backButton')}</Text>
          <Text className='redeem-header__title'>{t('redeem.redeemTitle')}</Text>
          <View className='redeem-header__spacer' />
        </View>
        <View className='redeem-error-page'>
          <Text className='redeem-error-page__text'>{t('redeem.missingProduct')}</Text>
          <View className='redeem-error-page__back-btn' onClick={goToProductList}>
            <Text>{t('redeem.backToProductList')}</Text>
          </View>
        </View>
      </View>
    );
  }

  const currentPoints = user?.points || 0;
  const pointsCost = product?.pointsCost || 0;
  const balanceAfter = currentPoints - pointsCost;
  const canAfford = balanceAfter >= 0;
  const needsAddress = mode === 'points' || mode === 'code';
  const selectedAddress = addresses.find((a) => a.addressId === selectedAddressId);

  const headerTitle = mode === 'points' ? t('redeem.pointsRedeemTitle') : mode === 'code' ? t('redeem.codeRedeemTitle') : t('redeem.pointsCodeRedeemTitle');

  const goToAddressPage = () => {
    Taro.navigateTo({ url: '/pages/address/index' });
  };

  /** Address selector block (shared between points and code modes) */
  const renderAddressSelector = () => {
    if (!needsAddress) return null;

    if (addresses.length === 0) {
      return (
        <View className='redeem-address redeem-address--empty'>
          <Text className='redeem-address__empty-icon'><LocationIcon size={24} color='var(--text-tertiary)' /></Text>
          <Text className='redeem-address__empty-text'>{t('redeem.addAddressEmpty')}</Text>
          <Text className='redeem-address__empty-link' onClick={goToAddressPage}>{t('redeem.addAddressLink')}</Text>
        </View>
      );
    }

    return (
      <View className='redeem-address'>
        <View className='redeem-address__selected' onClick={() => setShowAddressList(!showAddressList)}>
          <Text className='redeem-address__label'><LocationIcon size={14} color='currentColor' /> {t('redeem.shippingAddressLabel')}</Text>
          {selectedAddress ? (
            <View className='redeem-address__info'>
              <View className='redeem-address__name-row'>
                <Text className='redeem-address__name'>{selectedAddress.recipientName}</Text>
                <Text className='redeem-address__phone'>{selectedAddress.phone}</Text>
              </View>
              <Text className='redeem-address__detail'>{selectedAddress.detailAddress}</Text>
            </View>
          ) : (
            <Text className='redeem-address__placeholder'>{t('redeem.selectAddress')}</Text>
          )}
          <Text className='redeem-address__arrow'>{showAddressList ? '▲' : '▼'}</Text>
        </View>

        {showAddressList && (
          <View className='redeem-address__list'>
            {addresses.map((addr) => (
              <View
                key={addr.addressId}
                className={`redeem-address__item ${selectedAddressId === addr.addressId ? 'redeem-address__item--active' : ''}`}
                onClick={() => { setSelectedAddressId(addr.addressId); setShowAddressList(false); }}
              >
                <View className={`redeem-address__radio ${selectedAddressId === addr.addressId ? 'redeem-address__radio--checked' : ''}`}>
                  {selectedAddressId === addr.addressId && <View className='redeem-address__radio-dot' />}
                </View>
                <View className='redeem-address__item-info'>
                  <View className='redeem-address__name-row'>
                    <Text className='redeem-address__name'>{addr.recipientName}</Text>
                    <Text className='redeem-address__phone'>{addr.phone}</Text>
                    {addr.isDefault && <Text className='redeem-address__badge'>{t('redeem.defaultBadge')}</Text>}
                  </View>
                  <Text className='redeem-address__detail'>{addr.detailAddress}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    );
  };

  return (
    <View className='redeem-page'>
      <View className='redeem-header'>
        <Text className='redeem-header__back' onClick={handleBack}>{t('redeem.backButton')}</Text>
        <Text className='redeem-header__title'>{headerTitle}</Text>
        <View className='redeem-header__spacer' />
      </View>

      <View className='redeem-content'>
        {/* Product summary (when product exists) */}
        {product && (
          <View className='redeem-product'>
            {product.imageUrl ? (
              <Image className='redeem-product__image' src={product.imageUrl} mode='aspectFill' />
            ) : (
              <View className='redeem-product__image-placeholder'>
                <Text className='redeem-product__image-placeholder-icon'>
                  {product.type === 'code_exclusive' ? <TicketIcon size={32} color='var(--text-tertiary)' /> : <GiftIcon size={32} color='var(--text-tertiary)' />}
                </Text>
              </View>
            )}
            <View className='redeem-product__info'>
              <Text className='redeem-product__name'>{product.name}</Text>
              <Text className={`redeem-product__type redeem-product__type--${product.type === 'code_exclusive' ? 'code' : 'points'}`}>
                {product.type === 'code_exclusive' ? t('redeem.productTypeCodeExclusive') : t('redeem.productTypePoints')}
              </Text>
            </View>
          </View>
        )}

        {/* Error message */}
        {error && (
          <View className='redeem-error'>
            <Text className='redeem-error__text'>{error}</Text>
          </View>
        )}

        {/* Mode: Points Redemption */}
        {mode === 'points' && product && (
          <>
            {renderAddressSelector()}
            <View className='redeem-confirm'>
              <Text className='redeem-confirm__title'>{t('redeem.confirmRedeemTitle')}</Text>
              <View className='redeem-confirm__row'>
                <Text className='redeem-confirm__label'>{t('redeem.requiredPoints')}</Text>
                <Text className='redeem-confirm__value redeem-confirm__value--cost'>
                  -{pointsCost.toLocaleString()}
                </Text>
              </View>
              <View className='redeem-confirm__row'>
                <Text className='redeem-confirm__label'>{t('redeem.currentBalanceLabel')}</Text>
                <Text className='redeem-confirm__value redeem-confirm__value--balance'>
                  {currentPoints.toLocaleString()}
                </Text>
              </View>
              <View className='redeem-confirm__divider' />
              <View className='redeem-confirm__row'>
                <Text className='redeem-confirm__label'>{t('redeem.balanceAfterLabel')}</Text>
                <Text className={`redeem-confirm__value ${canAfford ? 'redeem-confirm__value--after' : 'redeem-confirm__value--insufficient'}`}>
                  {canAfford ? balanceAfter.toLocaleString() : t('redeem.insufficientPoints')}
                </Text>
              </View>
            </View>
            <View
              className={`redeem-btn ${!canAfford || !selectedAddressId || submitting ? 'redeem-btn--disabled' : ''} ${submitting ? 'redeem-btn--loading' : ''}`}
              onClick={canAfford && selectedAddressId && !submitting ? handlePointsRedeem : undefined}
            >
              <Text>{submitting ? t('redeem.redeeming') : t('redeem.confirmRedeem')}</Text>
            </View>
            <View className='redeem-cancel' onClick={handleBack}>
              <Text>{t('redeem.cancelButton')}</Text>
            </View>
          </>
        )}

        {/* Mode: Code Redemption (product-specific code) */}
        {mode === 'code' && product && (
          <>
            {renderAddressSelector()}
            <View className='redeem-code'>
              <Text className='redeem-code__title'>{t('redeem.enterCodeTitle')}</Text>
              <Text className='redeem-code__subtitle'>{t('redeem.enterCodeSubtitle')}</Text>
              <View className='redeem-code__input-wrap'>
                <Input
                  className='redeem-code__input'
                  type='text'
                  placeholder={t('redeem.codePlaceholder')}
                  value={codeValue}
                  onInput={(e) => setCodeValue(e.detail.value)}
                  maxlength={32}
                />
              </View>
              <Text className='redeem-code__hint'>{t('redeem.codeHint')}</Text>
            </View>
            <View
              className={`redeem-btn ${!codeValue.trim() || !selectedAddressId || submitting ? 'redeem-btn--disabled' : ''} ${submitting ? 'redeem-btn--loading' : ''}`}
              onClick={codeValue.trim() && selectedAddressId && !submitting ? handleCodeRedeem : undefined}
            >
              <Text>{submitting ? t('redeem.redeeming') : t('redeem.confirmRedeem')}</Text>
            </View>
            <View className='redeem-cancel' onClick={handleBack}>
              <Text>{t('redeem.cancelButton')}</Text>
            </View>
          </>
        )}

        {/* Mode: Points Code (no product, redeem code for points) */}
        {mode === 'points-code' && !featureDisabled && (
          <>
            <View className='redeem-code redeem-points-code'>
              <Text className='redeem-points-code__icon'><TicketIcon size={32} color='var(--accent-primary)' /></Text>
              <Text className='redeem-code__title'>{t('redeem.pointsCodeTitle')}</Text>
              <Text className='redeem-code__subtitle'>{t('redeem.pointsCodeSubtitle')}</Text>
              <View className='redeem-code__input-wrap'>
                <Input
                  className='redeem-code__input'
                  type='text'
                  placeholder={t('redeem.pointsCodePlaceholder')}
                  value={codeValue}
                  onInput={(e) => setCodeValue(e.detail.value)}
                  maxlength={32}
                />
              </View>
              <Text className='redeem-code__hint'>{t('redeem.pointsCodeHint')}</Text>
            </View>
            <View
              className={`redeem-btn ${!codeValue.trim() || submitting ? 'redeem-btn--disabled' : ''} ${submitting ? 'redeem-btn--loading' : ''}`}
              onClick={codeValue.trim() && !submitting ? handlePointsCodeRedeem : undefined}
            >
              <Text>{submitting ? t('redeem.redeeming') : t('redeem.redeemPoints')}</Text>
            </View>
            <View className='redeem-cancel' onClick={handleBack}>
              <Text>{t('redeem.cancelButton')}</Text>
            </View>
          </>
        )}

        {/* Feature disabled message for points-code mode */}
        {mode === 'points-code' && featureDisabled && (
          <View style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'var(--space-48) var(--space-24)',
            textAlign: 'center',
          }}>
            <Text style={{
              fontSize: '48px',
              marginBottom: 'var(--space-16)',
              opacity: 0.5,
            }}>🔒</Text>
            <Text style={{
              fontFamily: 'var(--font-display)',
              fontSize: '18px',
              fontWeight: 600,
              color: 'var(--text-primary)',
              marginBottom: 'var(--space-8)',
            }}>{t('featureToggle.featureDisabled')}</Text>
            <Text style={{
              fontFamily: 'var(--font-body)',
              fontSize: '14px',
              color: 'var(--text-secondary)',
              marginBottom: 'var(--space-32)',
              lineHeight: 1.5,
            }}>{t('featureToggle.featureDisabledDesc')}</Text>
            <View
              className='btn-secondary'
              style={{ padding: 'var(--space-12) var(--space-32)', cursor: 'pointer' }}
              onClick={handleBack}
            >
              <Text>{t('featureToggle.backButton')}</Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
