import { useState, useEffect, useCallback } from 'react';
import { View, Text, Image } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { maskPhone } from '@points-mall/shared';
import type { ShippingStatus, ShippingEvent, OrderItem } from '@points-mall/shared';
import './index.scss';

/** Order detail from API */
interface OrderDetail {
  orderId: string;
  userId: string;
  items: OrderItem[];
  totalPoints: number;
  shippingAddress: {
    recipientName: string;
    phone: string;
    detailAddress: string;
  };
  shippingStatus: ShippingStatus;
  trackingNumber?: string;
  shippingEvents: ShippingEvent[];
  createdAt: string;
  updatedAt: string;
}

const STATUS_LABEL: Record<ShippingStatus, string> = {
  pending: '待发货',
  shipped: '已发货',
  in_transit: '运输中',
  delivered: '已签收',
};

const STATUS_ICON: Record<ShippingStatus, string> = {
  pending: '⏳',
  shipped: '📦',
  in_transit: '🚚',
  delivered: '✅',
};

const STATUS_CLASS: Record<ShippingStatus, string> = {
  pending: 'detail-timeline__dot--pending',
  shipped: 'detail-timeline__dot--shipped',
  in_transit: 'detail-timeline__dot--in-transit',
  delivered: 'detail-timeline__dot--delivered',
};

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OrderDetailPage() {
  const router = useRouter();
  const orderId = router.params.id || '';

  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOrder = useCallback(async () => {
    if (!orderId) {
      setError('订单 ID 缺失');
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setError('');
      const res = await request<OrderDetail>({ url: `/api/orders/${orderId}` });
      setOrder(res);
    } catch {
      setError('订单加载失败');
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    loadOrder();
  }, [loadOrder]);

  const handleBack = () => {
    goBack('/pages/orders/index');
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

  if (error || !order) {
    return (
      <View className='detail-page'>
        <View className='detail-header'>
          <Text className='detail-header__back' onClick={handleBack}>← 返回</Text>
          <Text className='detail-header__title'>订单详情</Text>
          <View className='detail-header__placeholder' />
        </View>
        <View className='detail-error'>
          <Text className='detail-error__text'>{error || '订单不存在'}</Text>
        </View>
      </View>
    );
  }

  const statusLabel = STATUS_LABEL[order.shippingStatus] || '未知';
  const statusIcon = STATUS_ICON[order.shippingStatus] || '❓';

  return (
    <View className='detail-page'>
      {/* Header */}
      <View className='detail-header'>
        <Text className='detail-header__back' onClick={handleBack}>← 返回</Text>
        <Text className='detail-header__title'>订单详情</Text>
        <View className='detail-header__placeholder' />
      </View>

      <View className='detail-content'>
        {/* Status Banner */}
        <View className={`detail-banner detail-banner--${order.shippingStatus.replace('_', '-')}`}>
          <Text className='detail-banner__icon'>{statusIcon}</Text>
          <Text className='detail-banner__label'>{statusLabel}</Text>
          {order.trackingNumber && (
            <Text className='detail-banner__tracking'>物流单号: {order.trackingNumber}</Text>
          )}
        </View>

        {/* Shipping Address */}
        <View className='detail-section'>
          <Text className='detail-section__title'>📍 收货信息</Text>
          <View className='detail-address'>
            <View className='detail-address__row'>
              <Text className='detail-address__name'>{order.shippingAddress.recipientName}</Text>
              <Text className='detail-address__phone'>{maskPhone(order.shippingAddress.phone)}</Text>
            </View>
            <Text className='detail-address__detail'>{order.shippingAddress.detailAddress}</Text>
          </View>
        </View>

        {/* Items */}
        <View className='detail-section'>
          <Text className='detail-section__title'>🛒 商品列表</Text>
          <View className='detail-items'>
            {order.items.map((item, idx) => (
              <View className='detail-item' key={`${item.productId}-${idx}`}>
                <View className='detail-item__image-wrap'>
                  {item.imageUrl ? (
                    <Image className='detail-item__image' src={item.imageUrl} mode='aspectFill' />
                  ) : (
                    <View className='detail-item__image-placeholder'>
                      <Text>🎁</Text>
                    </View>
                  )}
                </View>
                <View className='detail-item__info'>
                  <Text className='detail-item__name'>{item.productName}</Text>
                  <View className='detail-item__row'>
                    <Text className='detail-item__price'>◆ {item.pointsCost.toLocaleString()}</Text>
                    <Text className='detail-item__qty'>×{item.quantity}</Text>
                  </View>
                  <Text className='detail-item__subtotal'>小计: ◆ {item.subtotal.toLocaleString()}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* Total */}
        <View className='detail-summary'>
          <Text className='detail-summary__label'>积分总计</Text>
          <View className='detail-summary__value-wrap'>
            <Text className='detail-summary__diamond'>◆</Text>
            <Text className='detail-summary__value'>{order.totalPoints.toLocaleString()}</Text>
          </View>
        </View>

        {/* Shipping Timeline */}
        {order.shippingEvents.length > 0 && (
          <View className='detail-section'>
            <Text className='detail-section__title'>📋 物流时间线</Text>
            <View className='detail-timeline'>
              {[...order.shippingEvents].reverse().map((evt, idx) => (
                <View className='detail-timeline__item' key={`${evt.status}-${idx}`}>
                  <View className='detail-timeline__track'>
                    <View className={`detail-timeline__dot ${STATUS_CLASS[evt.status] || ''} ${idx === 0 ? 'detail-timeline__dot--active' : ''}`} />
                    {idx < order.shippingEvents.length - 1 && <View className='detail-timeline__line' />}
                  </View>
                  <View className='detail-timeline__body'>
                    <View className='detail-timeline__head'>
                      <Text className={`detail-timeline__status detail-timeline__status--${evt.status.replace('_', '-')}`}>
                        {STATUS_ICON[evt.status]} {STATUS_LABEL[evt.status]}
                      </Text>
                      <Text className='detail-timeline__time'>{formatTime(evt.timestamp)}</Text>
                    </View>
                    {evt.remark && (
                      <Text className='detail-timeline__remark'>{evt.remark}</Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </View>
        )}
      </View>
    </View>
  );
}
