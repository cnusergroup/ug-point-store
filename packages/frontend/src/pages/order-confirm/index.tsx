import { useState, useEffect, useCallback } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import './index.scss';

/** Address from API */
interface AddressResponse {
  addressId: string;
  recipientName: string;
  phone: string;
  detailAddress: string;
  isDefault: boolean;
}

/** Product detail for order items */
interface ProductDetail {
  productId: string;
  name: string;
  imageUrl: string;
  pointsCost: number;
  stock: number;
  status: string;
}

/** Order item to display */
interface OrderItemDisplay {
  productId: string;
  productName: string;
  imageUrl: string;
  pointsCost: number;
  quantity: number;
  subtotal: number;
  selectedSize?: string;
}

/** Cart selected item from storage */
interface CartSelectedItem {
  productId: string;
  quantity: number;
  selectedSize?: string;
}

export default function OrderConfirmPage() {
  const router = useRouter();
  const fromCart = router.params.from === 'cart';
  const directProductId = router.params.productId || '';
  const directQuantity = parseInt(router.params.quantity || '1', 10) || 1;
  const directSelectedSize = router.params.selectedSize ? decodeURIComponent(router.params.selectedSize) : undefined;

  const [items, setItems] = useState<OrderItemDisplay[]>([]);
  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [selectedAddressId, setSelectedAddressId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAddressForm, setShowAddressForm] = useState(false);

  // Address form state
  const [formName, setFormName] = useState('');
  const [formPhone, setFormPhone] = useState('');
  const [formAddress, setFormAddress] = useState('');
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [formSubmitting, setFormSubmitting] = useState(false);

  const totalPoints = items.reduce((sum, i) => sum + i.subtotal, 0);

  const loadAddresses = useCallback(async () => {
    try {
      const res = await request<AddressResponse[]>({ url: '/api/addresses' });
      setAddresses(res);
      // Auto-select default address (first in list, API returns default first)
      if (res.length > 0 && !selectedAddressId) {
        setSelectedAddressId(res[0].addressId);
      }
    } catch {
      // Non-blocking: user can still add address
    }
  }, []);

  const loadItems = useCallback(async () => {
    try {
      setLoading(true);
      setError('');

      if (fromCart) {
        // Cart checkout: read selected items from storage
        const raw = Taro.getStorageSync('cart_selected_items');
        const cartItems: CartSelectedItem[] = raw ? JSON.parse(raw as string) : [];
        if (cartItems.length === 0) {
          setError('未选择商品');
          return;
        }
        // Fetch product details for each item
        const productDetails = await Promise.all(
          cartItems.map((ci) =>
            request<ProductDetail>({ url: `/api/products/${ci.productId}` }),
          ),
        );
        const displayItems: OrderItemDisplay[] = cartItems.map((ci, idx) => {
          const p = productDetails[idx];
          return {
            productId: ci.productId,
            productName: p.name,
            imageUrl: p.imageUrl,
            pointsCost: p.pointsCost,
            quantity: ci.quantity,
            subtotal: p.pointsCost * ci.quantity,
            selectedSize: ci.selectedSize,
          };
        });
        setItems(displayItems);
      } else if (directProductId) {
        // Direct order from product detail page
        const p = await request<ProductDetail>({ url: `/api/products/${directProductId}` });
        setItems([
          {
            productId: p.productId,
            productName: p.name,
            imageUrl: p.imageUrl,
            pointsCost: p.pointsCost,
            quantity: directQuantity,
            subtotal: p.pointsCost * directQuantity,
            selectedSize: directSelectedSize,
          },
        ]);
      } else {
        setError('参数错误');
      }
    } catch {
      setError('商品信息加载失败');
    } finally {
      setLoading(false);
    }
  }, [fromCart, directProductId, directQuantity, directSelectedSize]);

  useEffect(() => {
    loadItems();
    loadAddresses();
  }, [loadItems, loadAddresses]);

  const handleBack = () => {
    goBack('/pages/cart/index');
  };

  const validateAddressForm = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formName.trim() || formName.length > 20) {
      errors.name = '收件人姓名需为 1-20 个字符';
    }
    if (!/^1\d{10}$/.test(formPhone)) {
      errors.phone = '请输入正确的 11 位手机号';
    }
    if (!formAddress.trim() || formAddress.length > 200) {
      errors.address = '详细地址需为 1-200 个字符';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleAddAddress = async () => {
    if (!validateAddressForm()) return;
    setFormSubmitting(true);
    try {
      await request({
        url: '/api/addresses',
        method: 'POST',
        data: { recipientName: formName, phone: formPhone, detailAddress: formAddress },
      });
      Taro.showToast({ title: '地址已添加', icon: 'success' });
      setShowAddressForm(false);
      setFormName('');
      setFormPhone('');
      setFormAddress('');
      setFormErrors({});
      await loadAddresses();
    } catch {
      Taro.showToast({ title: '添加地址失败', icon: 'none' });
    } finally {
      setFormSubmitting(false);
    }
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!selectedAddressId) {
      Taro.showToast({ title: '请选择收货地址', icon: 'none' });
      return;
    }
    if (items.length === 0) {
      Taro.showToast({ title: '未选择商品', icon: 'none' });
      return;
    }

    setSubmitting(true);
    try {
      let orderId: string;

      if (fromCart) {
        const res = await request<{ orderId: string }>({
          url: '/api/orders',
          method: 'POST',
          data: {
            items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, selectedSize: i.selectedSize })),
            addressId: selectedAddressId,
          },
        });
        orderId = res.orderId;
        // Clear cart selected items from storage
        Taro.removeStorageSync('cart_selected_items');
      } else {
        const res = await request<{ orderId: string }>({
          url: '/api/orders/direct',
          method: 'POST',
          data: {
            productId: directProductId,
            quantity: directQuantity,
            addressId: selectedAddressId,
            selectedSize: directSelectedSize,
          },
        });
        orderId = res.orderId;
      }

      Taro.showToast({ title: '兑换成功', icon: 'success' });
      setTimeout(() => {
        Taro.redirectTo({ url: `/pages/order-detail/index?id=${orderId}` });
      }, 1000);
    } catch (err: any) {
      const code = err?.code || '';
      const msg = err?.message || '兑换失败';
      if (code === 'INSUFFICIENT_POINTS') {
        Taro.showToast({ title: '积分不足', icon: 'none', duration: 2000 });
      } else if (code === 'OUT_OF_STOCK') {
        Taro.showToast({ title: '商品库存不足', icon: 'none', duration: 2000 });
      } else if (code === 'NO_ADDRESS_SELECTED') {
        Taro.showToast({ title: '请选择收货地址', icon: 'none', duration: 2000 });
      } else {
        Taro.showToast({ title: msg, icon: 'none', duration: 2000 });
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View className='confirm-page'>
        <View className='confirm-loading'>
          <Text className='confirm-loading__text'>加载中...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className='confirm-page'>
        <View className='confirm-header'>
          <Text className='confirm-header__back' onClick={handleBack}>← 返回</Text>
          <Text className='confirm-header__title'>确认订单</Text>
          <View className='confirm-header__placeholder' />
        </View>
        <View className='confirm-error'>
          <Text className='confirm-error__text'>{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className='confirm-page'>
      {/* Header */}
      <View className='confirm-header'>
        <Text className='confirm-header__back' onClick={handleBack}>← 返回</Text>
        <Text className='confirm-header__title'>确认订单</Text>
        <View className='confirm-header__placeholder' />
      </View>

      <View className='confirm-content'>
        {/* Address Section */}
        <View className='confirm-section'>
          <Text className='confirm-section__title'>📍 收货地址</Text>

          {addresses.length === 0 ? (
            <View className='confirm-address-empty'>
              <Text className='confirm-address-empty__text'>暂无收货地址</Text>
              <View className='btn-primary confirm-address-empty__btn' onClick={() => setShowAddressForm(true)}>
                <Text>+ 添加地址</Text>
              </View>
            </View>
          ) : (
            <View className='confirm-address-list'>
              {addresses.map((addr) => (
                <View
                  key={addr.addressId}
                  className={`confirm-address-card ${selectedAddressId === addr.addressId ? 'confirm-address-card--selected' : ''}`}
                  onClick={() => setSelectedAddressId(addr.addressId)}
                >
                  <View className={`confirm-address-card__radio ${selectedAddressId === addr.addressId ? 'confirm-address-card__radio--checked' : ''}`}>
                    {selectedAddressId === addr.addressId && <View className='confirm-address-card__radio-dot' />}
                  </View>
                  <View className='confirm-address-card__info'>
                    <View className='confirm-address-card__name-row'>
                      <Text className='confirm-address-card__name'>{addr.recipientName}</Text>
                      <Text className='confirm-address-card__phone'>{addr.phone}</Text>
                      {addr.isDefault && <Text className='confirm-address-card__badge'>默认</Text>}
                    </View>
                    <Text className='confirm-address-card__detail'>{addr.detailAddress}</Text>
                  </View>
                </View>
              ))}
              <Text className='confirm-address-add' onClick={() => setShowAddressForm(true)}>+ 添加新地址</Text>
            </View>
          )}
        </View>

        {/* Items Section */}
        <View className='confirm-section'>
          <Text className='confirm-section__title'>🛒 商品清单</Text>
          <View className='confirm-items'>
            {items.map((item) => (
              <View className='confirm-item' key={item.productId}>
                <View className='confirm-item__image-wrap'>
                  {item.imageUrl ? (
                    <Image className='confirm-item__image' src={item.imageUrl} mode='aspectFill' />
                  ) : (
                    <View className='confirm-item__image-placeholder'>
                      <Text>🎁</Text>
                    </View>
                  )}
                </View>
                <View className='confirm-item__info'>
                  <Text className='confirm-item__name'>
                    {item.productName}
                    {item.selectedSize ? ` - 尺码: ${item.selectedSize}` : ''}
                  </Text>
                  <View className='confirm-item__row'>
                    <Text className='confirm-item__price'>◆ {item.pointsCost.toLocaleString()}</Text>
                    <Text className='confirm-item__qty'>×{item.quantity}</Text>
                  </View>
                  <Text className='confirm-item__subtotal'>小计: ◆ {item.subtotal.toLocaleString()}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Summary */}
        <View className='confirm-summary'>
          <Text className='confirm-summary__label'>积分总计</Text>
          <View className='confirm-summary__value-wrap'>
            <Text className='confirm-summary__diamond'>◆</Text>
            <Text className='confirm-summary__value'>{totalPoints.toLocaleString()}</Text>
          </View>
        </View>
      </View>

      {/* Bottom Bar */}
      <View className='confirm-bottom'>
        <View className='confirm-bottom__info'>
          <Text className='confirm-bottom__label'>合计: </Text>
          <Text className='confirm-bottom__diamond'>◆</Text>
          <Text className='confirm-bottom__total'>{totalPoints.toLocaleString()}</Text>
        </View>
        <View
          className={`confirm-bottom__btn ${submitting || !selectedAddressId ? 'confirm-bottom__btn--disabled' : ''}`}
          onClick={!submitting && selectedAddressId ? handleSubmit : undefined}
        >
          <Text>{submitting ? '提交中...' : '确认兑换'}</Text>
        </View>
      </View>

      {/* Add Address Modal */}
      {showAddressForm && (
        <View className='confirm-modal-overlay' onClick={() => setShowAddressForm(false)}>
          <View className='confirm-modal' onClick={(e) => e.stopPropagation()}>
            <Text className='confirm-modal__title'>添加地址</Text>

            <View className='confirm-modal__field'>
              <Text className='confirm-modal__label'>收件人姓名</Text>
              <input
                className='confirm-modal__input'
                type='text'
                placeholder='请输入收件人姓名'
                value={formName}
                maxLength={20}
                onInput={(e: any) => setFormName(e.target.value || e.detail?.value || '')}
              />
              {formErrors.name && <Text className='confirm-modal__error'>{formErrors.name}</Text>}
            </View>

            <View className='confirm-modal__field'>
              <Text className='confirm-modal__label'>手机号码</Text>
              <input
                className='confirm-modal__input'
                type='tel'
                placeholder='请输入 11 位手机号'
                value={formPhone}
                maxLength={11}
                onInput={(e: any) => setFormPhone(e.target.value || e.detail?.value || '')}
              />
              {formErrors.phone && <Text className='confirm-modal__error'>{formErrors.phone}</Text>}
            </View>

            <View className='confirm-modal__field'>
              <Text className='confirm-modal__label'>详细地址</Text>
              <textarea
                className='confirm-modal__textarea'
                placeholder='请输入详细地址'
                value={formAddress}
                maxLength={200}
                onInput={(e: any) => setFormAddress(e.target.value || e.detail?.value || '')}
              />
              {formErrors.address && <Text className='confirm-modal__error'>{formErrors.address}</Text>}
            </View>

            <View className='confirm-modal__actions'>
              <View className='btn-secondary confirm-modal__btn' onClick={() => setShowAddressForm(false)}>
                <Text>取消</Text>
              </View>
              <View
                className={`btn-primary confirm-modal__btn ${formSubmitting ? 'btn-primary--disabled' : ''}`}
                onClick={formSubmitting ? undefined : handleAddAddress}
              >
                <Text>{formSubmitting ? '提交中...' : '确认'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
