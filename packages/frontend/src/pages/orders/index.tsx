import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import TabBar from '../../components/TabBar';
import { PackageIcon, OrderIcon } from '../../components/icons';
import type { ShippingStatus } from '@points-mall/shared';
import './index.scss';

/** Order list item from API */
interface OrderListItem {
  orderId: string;
  itemCount: number;
  totalPoints: number;
  shippingStatus: ShippingStatus;
  createdAt: string;
  productNames: string[];
}

/** Orders list API response */
interface OrdersResponse {
  orders: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** Small clock icon for pending status */
function ClockIcon({ size = 14, color = 'currentColor', className }: { size?: number; color?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

/** Small X-circle icon for cancelled status */
function XCircleIcon({ size = 14, color = 'currentColor', className }: { size?: number; color?: string; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  );
}

interface StatusConfig {
  labelKey: string;
  icon: (props: { size?: number; color?: string; className?: string }) => JSX.Element;
  className: string;
}

const STATUS_CONFIG: Record<ShippingStatus, StatusConfig> = {
  pending: { labelKey: 'orders.statusPending', icon: ClockIcon, className: 'orders-status--pending' },
  shipped: { labelKey: 'orders.statusShipped', icon: PackageIcon, className: 'orders-status--shipped' },
  cancelled: { labelKey: 'orders.statusCancelled', icon: XCircleIcon, className: 'orders-status--cancelled' },
};

const PAGE_SIZE = 10;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function OrdersPage() {
  const { t } = useTranslation();
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
      setError(t('orders.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadOrders(1);
  }, [loadOrders]);

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
          <Text className='orders-loading__text'>{t('common.loading')}</Text>
        </View>
      </View>
    );
  }

  if (error && orders.length === 0) {
    return (
      <View className='orders-page'>
        <View className='orders-header'>
          <Text className='orders-header__title'>{t('orders.title')}</Text>
        </View>
        <View className='orders-error'>
          <Text className='orders-error__text'>{error}</Text>
        </View>
        <TabBar current="/pages/orders/index" />
      </View>
    );
  }

  return (
    <View className='orders-page'>
      {/* Header */}
      <View className='orders-header'>
        <Text className='orders-header__title'>{t('orders.title')}</Text>
      </View>

      {orders.length === 0 ? (
        <View className='orders-empty'>
          <OrderIcon size={64} color='var(--text-tertiary)' className='orders-empty__icon' />
          <Text className='orders-empty__text'>{t('orders.noOrders')}</Text>
          <Text className='orders-empty__hint'>{t('orders.noOrdersHint')}</Text>
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
                  <Text className='orders-card__id'>{t('orders.orderPrefix')}{order.orderId.slice(-8).toUpperCase()}</Text>
                  <View className={`orders-status ${statusCfg.className}`}>
                    <statusCfg.icon size={14} className='orders-status__icon' />
                    <Text className='orders-status__label'>{t(statusCfg.labelKey)}</Text>
                  </View>
                </View>

                <View className='orders-card__body'>
                  <View className='orders-card__info-row'>
                    <Text className='orders-card__info-label'>{t('orders.productLabel')}</Text>
                    <Text className='orders-card__info-value orders-card__product-names'>
                      {order.productNames.length > 0
                        ? order.productNames.join('、')
                        : t('orders.itemsCount', { count: order.itemCount })}
                    </Text>
                  </View>
                  <View className='orders-card__info-row'>
                    <Text className='orders-card__info-label'>{t('orders.pointsTotal')}</Text>
                    <View className='orders-card__points'>
                      <Text className='orders-card__diamond'>◆</Text>
                      <Text className='orders-card__points-value'>{order.totalPoints.toLocaleString()}</Text>
                    </View>
                  </View>
                  <View className='orders-card__info-row'>
                    <Text className='orders-card__info-label'>{t('orders.createdTime')}</Text>
                    <Text className='orders-card__time'>{formatTime(order.createdAt)}</Text>
                  </View>
                </View>

                <View className='orders-card__footer'>
                  <Text className='orders-card__detail-link'>{t('orders.viewDetail')}</Text>
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
                <Text>{t('orders.prevPage')}</Text>
              </View>
              <Text className='orders-pagination__info'>{page} / {totalPages}</Text>
              <View
                className={`orders-pagination__btn ${page >= totalPages ? 'orders-pagination__btn--disabled' : ''}`}
                onClick={handleNextPage}
              >
                <Text>{t('orders.nextPage')}</Text>
              </View>
            </View>
          )}
        </View>
      )}

      <TabBar current="/pages/orders/index" />
    </View>
  );
}
