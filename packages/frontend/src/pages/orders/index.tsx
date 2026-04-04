import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import type { ShippingStatus } from '@points-mall/shared';
import './index.scss';

/** Order list item from API */
interface OrderListItem {
  orderId: string;
  itemCount: number;
  totalPoints: number;
  shippingStatus: ShippingStatus;
  createdAt: string;
}

/** Orders list API response */
interface OrdersResponse {
  orders: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
}

const STATUS_CONFIG: Record<ShippingStatus, { label: string; icon: string; className: string }> = {
  pending: { label: '待发货', icon: '⏳', className: 'orders-status--pending' },
  shipped: { label: '已发货', icon: '📦', className: 'orders-status--shipped' },
  in_transit: { label: '运输中', icon: '🚚', className: 'orders-status--in-transit' },
  delivered: { label: '已签收', icon: '✅', className: 'orders-status--delivered' },
};

const PAGE_SIZE = 10;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OrdersPage() {
  const [orders, setOrders] = useState<OrderListItem[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const loadOrders = useCallback(async (p: number) => {
    try {
      setLoading(true);
      setError('');
      const res = await request<OrdersResponse>({
        url: `/api/orders?page=${p}&pageSize=${PAGE_SIZE}`,
      });
      setOrders(res.orders);
      setTotal(res.total);
      setPage(res.page);
    } catch {
      setError('订单加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders(1);
  }, [loadOrders]);

  const handleBack = () => {
    goBack('/pages/profile/index');
  };

  const handleOrderClick = (orderId: string) => {
    Taro.navigateTo({ url: `/pages/order-detail/index?id=${orderId}` });
  };

  const handlePrevPage = () => {
    if (page > 1) loadOrders(page - 1);
  };

  const handleNextPage = () => {
    if (page < totalPages) loadOrders(page + 1);
  };

  if (loading && orders.length === 0) {
    return (
      <View className='orders-page'>
        <View className='orders-loading'>
          <Text className='orders-loading__text'>加载中...</Text>
        </View>
      </View>
    );
  }

  if (error && orders.length === 0) {
    return (
      <View className='orders-page'>
        <View className='orders-header'>
          <Text className='orders-header__back' onClick={handleBack}>← 返回</Text>
          <Text className='orders-header__title'>我的订单</Text>
          <View className='orders-header__placeholder' />
        </View>
        <View className='orders-error'>
          <Text className='orders-error__text'>{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className='orders-page'>
      {/* Header */}
      <View className='orders-header'>
        <Text className='orders-header__back' onClick={handleBack}>← 返回</Text>
        <Text className='orders-header__title'>我的订单</Text>
        <View className='orders-header__placeholder' />
      </View>

      {orders.length === 0 ? (
        <View className='orders-empty'>
          <Text className='orders-empty__icon'>📋</Text>
          <Text className='orders-empty__text'>暂无订单</Text>
          <Text className='orders-empty__hint'>去商城逛逛吧</Text>
        </View>
      ) : (
        <View className='orders-content'>
          {orders.map((order) => {
            const statusCfg = STATUS_CONFIG[order.shippingStatus] || STATUS_CONFIG.pending;
            return (
              <View
                className='orders-card'
                key={order.orderId}
                onClick={() => handleOrderClick(order.orderId)}
              >
                <View className='orders-card__top'>
                  <Text className='orders-card__id'>订单 {order.orderId.slice(-8).toUpperCase()}</Text>
                  <View className={`orders-status ${statusCfg.className}`}>
                    <Text className='orders-status__icon'>{statusCfg.icon}</Text>
                    <Text className='orders-status__label'>{statusCfg.label}</Text>
                  </View>
                </View>

                <View className='orders-card__body'>
                  <View className='orders-card__info-row'>
                    <Text className='orders-card__info-label'>商品数量</Text>
                    <Text className='orders-card__info-value'>{order.itemCount} 件</Text>
                  </View>
                  <View className='orders-card__info-row'>
                    <Text className='orders-card__info-label'>积分总计</Text>
                    <View className='orders-card__points'>
                      <Text className='orders-card__diamond'>◆</Text>
                      <Text className='orders-card__points-value'>{order.totalPoints.toLocaleString()}</Text>
                    </View>
                  </View>
                  <View className='orders-card__info-row'>
                    <Text className='orders-card__info-label'>创建时间</Text>
                    <Text className='orders-card__time'>{formatTime(order.createdAt)}</Text>
                  </View>
                </View>

                <View className='orders-card__footer'>
                  <Text className='orders-card__detail-link'>查看详情 →</Text>
                </View>
              </View>
            );
          })}

          {/* Pagination */}
          {totalPages > 1 && (
            <View className='orders-pagination'>
              <View
                className={`orders-pagination__btn ${page <= 1 ? 'orders-pagination__btn--disabled' : ''}`}
                onClick={handlePrevPage}
              >
                <Text>上一页</Text>
              </View>
              <Text className='orders-pagination__info'>{page} / {totalPages}</Text>
              <View
                className={`orders-pagination__btn ${page >= totalPages ? 'orders-pagination__btn--disabled' : ''}`}
                onClick={handleNextPage}
              >
                <Text>下一页</Text>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
