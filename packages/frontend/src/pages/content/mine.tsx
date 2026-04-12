import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { MyContentItemSummary, ContentStatus } from '@points-mall/shared';
import './mine.scss';

interface MyContentListResponse {
  success: boolean;
  items: MyContentItemSummary[];
  lastKey?: string;
}

/** Status filter tab options */
type StatusFilter = 'all' | 'pending' | 'approved' | 'rejected';

const STATUS_TABS: { key: StatusFilter; labelKey: string }[] = [
  { key: 'all', labelKey: 'contentHub.mine.filterAll' },
  { key: 'pending', labelKey: 'contentHub.mine.filterPending' },
  { key: 'approved', labelKey: 'contentHub.mine.filterApproved' },
  { key: 'rejected', labelKey: 'contentHub.mine.filterRejected' },
];

const STATUS_CONFIG: Record<ContentStatus, { labelKey: string; className: string }> = {
  pending: { labelKey: 'contentHub.mine.statusPending', className: 'mine-status--pending' },
  approved: { labelKey: 'contentHub.mine.statusApproved', className: 'mine-status--approved' },
  rejected: { labelKey: 'contentHub.mine.statusRejected', className: 'mine-status--rejected' },
};

export default function MyContentPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [items, setItems] = useState<MyContentItemSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastKeyRef = useRef<string | undefined>(undefined);

  const fetchContent = useCallback(async (filter: StatusFilter, reset = false) => {
    if (reset) {
      setLoading(true);
      lastKeyRef.current = undefined;
    } else {
      setLoadingMore(true);
    }

    try {
      let url = '/api/content/mine?pageSize=20';
      if (filter !== 'all') url += `&status=${filter}`;
      if (!reset && lastKeyRef.current) url += `&lastKey=${encodeURIComponent(lastKeyRef.current)}`;

      const res = await request<MyContentListResponse>({ url });
      const newItems = res.items || [];

      if (reset) {
        setItems(newItems);
      } else {
        setItems((prev) => [...prev, ...newItems]);
      }

      lastKeyRef.current = res.lastKey;
      setHasMore(!!res.lastKey);
    } catch {
      if (reset) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchContent(statusFilter, true);
  }, [isAuthenticated, statusFilter, fetchContent]);

  const handleTabChange = (tab: StatusFilter) => {
    setStatusFilter(tab);
  };

  const handleScrollToLower = () => {
    if (!loadingMore && hasMore) {
      fetchContent(statusFilter, false);
    }
  };

  const handleItemClick = (contentId: string) => {
    Taro.navigateTo({ url: `/pages/content/detail?id=${contentId}` });
  };

  const handleBack = () => {
    goBack('/pages/profile/index');
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  return (
    <View className='mine-page'>
      {/* Header */}
      <View className='mine-header'>
        <View className='mine-header__left'>
          <Text className='mine-header__back' onClick={handleBack}>{t('contentHub.mine.backButton')}</Text>
        </View>
        <Text className='mine-header__title'>{t('contentHub.mine.title')}</Text>
        <View className='mine-header__right' />
      </View>

      {/* Status Filter Tabs */}
      <View className='mine-tabs'>
        {STATUS_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`mine-tabs__item ${statusFilter === tab.key ? 'mine-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{t(tab.labelKey)}</Text>
          </View>
        ))}
      </View>

      {/* Content List */}
      {loading ? (
        <View className='mine-loading'>
          <Text className='mine-loading__text'>{t('contentHub.mine.loading')}</Text>
        </View>
      ) : items.length === 0 ? (
        <View className='mine-empty'>
          <Text className='mine-empty__icon'>{t('contentHub.mine.emptyIcon')}</Text>
          <Text className='mine-empty__text'>{t('contentHub.mine.empty')}</Text>
        </View>
      ) : (
        <ScrollView
          className='mine-list'
          scrollY
          onScrollToLower={handleScrollToLower}
          lowerThreshold={100}
        >
          {items.map((item) => {
            const st = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
            return (
              <View
                key={item.contentId}
                className='mine-card'
                onClick={() => handleItemClick(item.contentId)}
              >
                <View className='mine-card__body'>
                  <View className='mine-card__top'>
                    <Text className='mine-card__title'>{item.title}</Text>
                    <Text className={`mine-status ${st.className}`}>{t(st.labelKey)}</Text>
                  </View>
                  <Text className='mine-card__category'>{item.categoryName}</Text>
                  <View className='mine-card__stats'>
                    <View className='mine-card__stat'>
                      <Text className='mine-card__stat-icon'>♡</Text>
                      <Text className='mine-card__stat-value'>{item.likeCount}</Text>
                    </View>
                    <View className='mine-card__stat'>
                      <Text className='mine-card__stat-icon'>✎</Text>
                      <Text className='mine-card__stat-value'>{item.commentCount}</Text>
                    </View>
                    <View className='mine-card__stat'>
                      <Text className='mine-card__stat-icon'>⊞</Text>
                      <Text className='mine-card__stat-value'>{item.reservationCount}</Text>
                    </View>
                  </View>
                  <Text className='mine-card__time'>{formatTime(item.createdAt)}</Text>
                </View>
                <View className='mine-card__arrow'>
                  <Text className='mine-card__arrow-icon'>›</Text>
                </View>
              </View>
            );
          })}

          {loadingMore && (
            <View className='mine-loading-more'>
              <Text className='mine-loading-more__text'>{t('contentHub.mine.loadingMore')}</Text>
            </View>
          )}

          {!hasMore && items.length > 0 && (
            <View className='mine-no-more'>
              <Text className='mine-no-more__text'>{t('contentHub.mine.noMore')}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}
