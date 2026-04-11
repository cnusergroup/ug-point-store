import { useState, useEffect, useCallback } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { request } from '../../utils/request';
import TabBar from '../../components/TabBar';
import { GiftIcon, CartIcon } from '../../components/icons';
import { useAppStore } from '../../store';
import { useTranslation } from '../../i18n';
import './index.scss';

/** Cart item detail from API */
interface CartItemDetail {
  productId: string;
  productName: string;
  imageUrl: string;
  pointsCost: number;
  quantity: number;
  subtotal: number;
  stock: number;
  status: 'active' | 'inactive';
  available: boolean;
  selectedSize?: string;
}

/** Cart response from API */
interface CartResponse {
  userId: string;
  items: CartItemDetail[];
  totalPoints: number;
  updatedAt: string;
}

export default function CartPage() {
  const [items, setItems] = useState<CartItemDetail[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const setCartCount = useAppStore((s) => s.setCartCount);
  const { t } = useTranslation();

  const loadCart = useCallback(async () => {
    try {
      setLoading(true);
      const res = await request<CartResponse>({ url: '/api/cart' });
      setItems(res.items);
      // Auto-select all available items
      const availableIds = new Set(
        res.items.filter((i) => i.available).map((i) => i.productId),
      );
      setSelectedIds(availableIds);
    } catch {
      setError(t('cart.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCart();
  }, [loadCart]);

  const toggleSelect = (productId: string) => {
    const item = items.find((i) => i.productId === productId);
    if (!item?.available) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  const toggleSelectAll = () => {
    const availableItems = items.filter((i) => i.available);
    const allSelected = availableItems.every((i) => selectedIds.has(i.productId));
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(availableItems.map((i) => i.productId)));
    }
  };

  const handleQuantityChange = async (productId: string, delta: number) => {
    const item = items.find((i) => i.productId === productId);
    if (!item) return;
    const newQty = item.quantity + delta;
    if (newQty < 1 || newQty > item.stock) return;
    try {
      await request({
        url: `/api/cart/items/${productId}`,
        method: 'PUT',
        data: { quantity: newQty },
      });
      setItems((prev) => {
        const updated = prev.map((i) =>
          i.productId === productId
            ? { ...i, quantity: newQty, subtotal: i.pointsCost * newQty }
            : i,
        );
        const newCount = updated.filter((i) => i.available).reduce((sum, i) => sum + i.quantity, 0);
        setCartCount(newCount);
        return updated;
      });
    } catch {
      Taro.showToast({ title: t('cart.updateQuantityFailed'), icon: 'none' });
    }
  };

  const handleDelete = async (productId: string) => {
    try {
      await request({
        url: `/api/cart/items/${productId}`,
        method: 'DELETE',
      });
      setItems((prev) => {
        const updated = prev.filter((i) => i.productId !== productId);
        const newCount = updated.filter((i) => i.available).reduce((sum, i) => sum + i.quantity, 0);
        setCartCount(newCount);
        return updated;
      });
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(productId);
        return next;
      });
      Taro.showToast({ title: t('cart.deleted'), icon: 'success' });
    } catch {
      Taro.showToast({ title: t('cart.deleteFailed'), icon: 'none' });
    }
  };

  const selectedTotal = items
    .filter((i) => selectedIds.has(i.productId))
    .reduce((sum, i) => sum + i.subtotal, 0);

  const selectedCount = selectedIds.size;

  const handleRedeem = () => {
    if (selectedCount === 0) {
      Taro.showToast({ title: t('cart.selectProducts'), icon: 'none' });
      return;
    }
    const selectedItems = items
      .filter((i) => selectedIds.has(i.productId))
      .map((i) => ({ productId: i.productId, quantity: i.quantity, selectedSize: i.selectedSize }));
    // Store selected items for order-confirm page
    Taro.setStorageSync('cart_selected_items', JSON.stringify(selectedItems));
    Taro.navigateTo({ url: '/pages/order-confirm/index?from=cart' });
  };

  const availableItems = items.filter((i) => i.available);
  const unavailableItems = items.filter((i) => !i.available);
  const allAvailableSelected =
    availableItems.length > 0 && availableItems.every((i) => selectedIds.has(i.productId));

  if (loading) {
    return (
      <View className='cart-page'>
        <View className='cart-loading'>
          <Text className='cart-loading__text'>{t('common.loading')}</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className='cart-page'>
        <View className='cart-header'>
          <Text className='cart-header__title'>{t('cart.title')}</Text>
        </View>
        <View className='cart-error'>
          <Text className='cart-error__text'>{error}</Text>
        </View>
        <TabBar current="/pages/cart/index" />
      </View>
    );
  }

  return (
    <View className='cart-page'>
      {/* Header */}
      <View className='cart-header'>
        <Text className='cart-header__title'>{t('cart.title')}</Text>
      </View>

      {items.length === 0 ? (
        <View className='cart-empty'>
          <CartIcon size={64} color='var(--text-tertiary)' className='cart-empty__icon' />
          <Text className='cart-empty__text'>{t('cart.empty')}</Text>
          <Text className='cart-empty__hint'>{t('cart.emptyHint')}</Text>
        </View>
      ) : (
        <View className='cart-content'>
          {/* Available items */}
          {availableItems.length > 0 && (
            <View className='cart-section'>
              {availableItems.map((item) => (
                <View className='cart-item' key={item.productId}>
                  <View
                    className={`cart-item__checkbox ${selectedIds.has(item.productId) ? 'cart-item__checkbox--checked' : ''}`}
                    onClick={() => toggleSelect(item.productId)}
                  >
                    {selectedIds.has(item.productId) && <Text className='cart-item__check-icon'>✓</Text>}
                  </View>

                  <View className='cart-item__image-wrap'>
                    {item.imageUrl ? (
                      <Image className='cart-item__image' src={item.imageUrl} mode='aspectFill' />
                    ) : (
                      <View className='cart-item__image-placeholder'>
                        <GiftIcon size={32} color='var(--text-tertiary)' />
                      </View>
                    )}
                  </View>

                  <View className='cart-item__info'>
                    <Text className='cart-item__name'>
                      {item.productName}
                      {item.selectedSize ? ` - ${t('common.size')}: ${item.selectedSize}` : ''}
                    </Text>
                    <View className='cart-item__price-row'>
                      <Text className='cart-item__price'>◆ {item.pointsCost.toLocaleString()}</Text>
                      <Text className='cart-item__subtotal'>{t('common.subtotal')}: {item.subtotal.toLocaleString()}</Text>
                    </View>
                    <View className='cart-item__actions'>
                      <View className='cart-item__qty-control'>
                        <Text
                          className={`cart-item__qty-btn ${item.quantity <= 1 ? 'cart-item__qty-btn--disabled' : ''}`}
                          onClick={() => handleQuantityChange(item.productId, -1)}
                        >−</Text>
                        <Text className='cart-item__qty-value'>{item.quantity}</Text>
                        <Text
                          className={`cart-item__qty-btn ${item.quantity >= item.stock ? 'cart-item__qty-btn--disabled' : ''}`}
                          onClick={() => handleQuantityChange(item.productId, 1)}
                        >+</Text>
                      </View>
                      <Text className='cart-item__delete' onClick={() => handleDelete(item.productId)}>{t('cart.deleteButton')}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Unavailable items */}
          {unavailableItems.length > 0 && (
            <View className='cart-section cart-section--unavailable'>
              <Text className='cart-section__label'>{t('cart.unavailableSection')}</Text>
              {unavailableItems.map((item) => (
                <View className='cart-item cart-item--unavailable' key={item.productId}>
                  <View className='cart-item__checkbox cart-item__checkbox--disabled' />

                  <View className='cart-item__image-wrap cart-item__image-wrap--gray'>
                    {item.imageUrl ? (
                      <Image className='cart-item__image' src={item.imageUrl} mode='aspectFill' />
                    ) : (
                      <View className='cart-item__image-placeholder'>
                        <GiftIcon size={32} color='var(--text-tertiary)' />
                      </View>
                    )}
                  </View>

                  <View className='cart-item__info'>
                    <Text className='cart-item__name cart-item__name--gray'>
                      {item.productName}
                      {item.selectedSize ? ` - ${t('common.size')}: ${item.selectedSize}` : ''}
                    </Text>
                    <Text className='cart-item__unavailable-tag'>
                      {item.status === 'inactive' ? t('cart.inactive') : t('cart.outOfStock')}
                    </Text>
                    <View className='cart-item__actions'>
                      <View />
                      <Text className='cart-item__delete' onClick={() => handleDelete(item.productId)}>{t('cart.deleteButton')}</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
        </View>
      )}

      {/* Bottom bar */}
      {items.length > 0 && (
        <View className='cart-bottom'>
          <View className='cart-bottom__select-all' onClick={toggleSelectAll}>
            <View className={`cart-item__checkbox ${allAvailableSelected ? 'cart-item__checkbox--checked' : ''}`}>
              {allAvailableSelected && <Text className='cart-item__check-icon'>✓</Text>}
            </View>
            <Text className='cart-bottom__select-label'>{t('cart.selectAll')}</Text>
          </View>
          <View className='cart-bottom__summary'>
            <View className='cart-bottom__total'>
              <Text className='cart-bottom__total-label'>{t('cart.totalLabel')}</Text>
              <Text className='cart-bottom__total-diamond'>◆</Text>
              <Text className='cart-bottom__total-value'>{selectedTotal.toLocaleString()}</Text>
            </View>
            <View
              className={`cart-bottom__btn ${selectedCount === 0 ? 'cart-bottom__btn--disabled' : ''}`}
              onClick={handleRedeem}
            >
              <Text>{t('cart.redeemNow')}{selectedCount > 0 ? `(${selectedCount})` : ''}</Text>
            </View>
          </View>
        </View>
      )}

      <TabBar current="/pages/cart/index" />
    </View>
  );
}
