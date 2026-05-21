import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Image, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { WishListItem, WishStatus } from '@points-mall/shared';
import PageToolbar from '../../components/PageToolbar';
import TabBar from '../../components/TabBar';
import './index.scss';

/* ---- Types ---- */

interface ListWishesResponse {
  wishes: WishListItem[];
  total: number;
}

interface FeatureTogglesResponse {
  wishPoolEnabled?: boolean;
}

type SortMode = 'votes' | 'time';

/* ---- Status config ---- */

const STATUS_CLASS: Record<WishStatus, string> = {
  pending: 'wish-status--pending',
  approved: 'wish-status--approved',
  adopted: 'wish-status--adopted',
  fulfilled: 'wish-status--fulfilled',
  closed: 'wish-status--closed',
};

/* ---- Skeleton Component ---- */

function SkeletonList({ count = 4 }: { count?: number }) {
  return (
    <View className='wish-skeleton'>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} className='wish-skeleton__item'>
          <View className='wish-skeleton__vote' />
          <View className='wish-skeleton__img' />
          <View className='wish-skeleton__lines'>
            <View className='wish-skeleton__line wish-skeleton__line--title' />
            <View className='wish-skeleton__line wish-skeleton__line--desc' />
            <View className='wish-skeleton__line wish-skeleton__line--meta' />
          </View>
        </View>
      ))}
    </View>
  );
}

/* ---- Main Page ---- */

export default function WishListPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [wishes, setWishes] = useState<WishListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [sortBy, setSortBy] = useState<SortMode>('votes');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [wishPoolEnabled, setWishPoolEnabled] = useState(true);
  const [votingIds, setVotingIds] = useState<Set<string>>(new Set());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((wishId: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(wishId)) next.delete(wishId);
      else next.add(wishId);
      return next;
    });
  }, []);

  const pageSize = 20;
  const isMountedRef = useRef(true);

  // Fetch feature toggles
  useEffect(() => {
    request<FeatureTogglesResponse>({
      url: '/api/settings/feature-toggles',
      skipAuth: true,
    })
      .then((res) => {
        if (isMountedRef.current) {
          setWishPoolEnabled(res.wishPoolEnabled !== false);
        }
      })
      .catch(() => {
        // Default to enabled on failure
      });
  }, []);

  // Fetch wishes
  const fetchWishes = useCallback(async (reset = false) => {
    const currentPage = reset ? 1 : page;
    if (reset) {
      setLoading(true);
    } else {
      setLoadingMore(true);
    }

    try {
      const url = `/api/wishes?sortBy=${sortBy}&page=${currentPage}&pageSize=${pageSize}`;
      const res = await request<ListWishesResponse>({ url });

      if (!isMountedRef.current) return;

      const newWishes = res.wishes || [];
      setTotal(res.total || 0);

      if (reset) {
        setWishes(newWishes);
        setPage(2);
      } else {
        setWishes((prev) => [...prev, ...newWishes]);
        setPage((p) => p + 1);
      }

      setHasMore(newWishes.length >= pageSize);
    } catch {
      if (reset && isMountedRef.current) {
        setWishes([]);
        setTotal(0);
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [sortBy, page]);

  // Initial fetch and refetch on sort change
  useEffect(() => {
    fetchWishes(true);
  }, [sortBy]);

  // Cleanup
  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  // Handle sort toggle
  const handleSortChange = (mode: SortMode) => {
    if (mode !== sortBy) {
      setSortBy(mode);
      setPage(1);
      setHasMore(true);
    }
  };

  // Handle load more
  const handleLoadMore = () => {
    if (!loadingMore && hasMore) {
      fetchWishes(false);
    }
  };

  // Handle vote
  const handleVote = async (wishId: string) => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }

    if (votingIds.has(wishId)) return;

    setVotingIds((prev) => new Set(prev).add(wishId));

    try {
      await request({ url: `/api/wishes/${wishId}/vote`, method: 'POST' });

      // Optimistic update
      setWishes((prev) =>
        prev.map((w) =>
          w.wishId === wishId
            ? { ...w, voteCount: w.voteCount + 1, hasVoted: true }
            : w
        )
      );
    } catch (err) {
      if (err instanceof RequestError) {
        // If already voted, just mark it
        if (err.code === 'ALREADY_VOTED') {
          setWishes((prev) =>
            prev.map((w) =>
              w.wishId === wishId ? { ...w, hasVoted: true } : w
            )
          );
        } else {
          Taro.showToast({ title: err.message, icon: 'none' });
        }
      } else {
        Taro.showToast({ title: t('wishPool.voteFailed'), icon: 'none' });
      }
    } finally {
      setVotingIds((prev) => {
        const next = new Set(prev);
        next.delete(wishId);
        return next;
      });
    }
  };

  // Navigate to create page
  const handleGoCreate = () => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    Taro.navigateTo({ url: '/pages/wishes/create' });
  };

  const handleBack = () => goBack('/pages/hub/index');

  const getStatusLabel = (status: WishStatus): string => {
    return t(`wishPool.status_${status}` as any) || status;
  };

  // Compute aggregate stats for the hero bar
  const totalVotes = wishes.reduce((sum, w) => sum + (w.voteCount || 0), 0);
  const fulfilledCount = wishes.filter(w => w.status === 'fulfilled').length;

  return (
    <View className='wish-list-page'>
      {/* Toolbar */}
      <PageToolbar
        title={t('wishPool.title')}
        onBack={handleBack}
        rightSlot={wishPoolEnabled ? (
          <View className='wish-list-page__toolbar-actions'>
            <View className='wish-list-page__mine-btn' onClick={() => Taro.navigateTo({ url: '/pages/wishes/mine' })}>
              <Text>{t('wishPool.myWishesBtn')}</Text>
            </View>
            <View className='wish-list-page__create-btn' onClick={handleGoCreate}>
              <Text>+ {t('wishPool.submitWish')}</Text>
            </View>
          </View>
        ) : undefined}
      />

      {/* Hero / Stats bar */}
      {!loading && wishes.length > 0 && (
        <View className='wish-hero'>
          <Text className='wish-hero__title'>{t('wishPool.heroTitle')}</Text>
          <Text className='wish-hero__subtitle'>{t('wishPool.heroSubtitle')}</Text>
          <View className='wish-hero__stats'>
            <View className='wish-hero__stat'>
              <Text className='wish-hero__stat-value wish-hero__stat-value--accent'>{total}</Text>
              <Text className='wish-hero__stat-label'>{t('wishPool.statTotal')}</Text>
            </View>
            <View className='wish-hero__stat'>
              <Text className='wish-hero__stat-value'>{totalVotes}</Text>
              <Text className='wish-hero__stat-label'>{t('wishPool.statVotes')}</Text>
            </View>
            <View className='wish-hero__stat'>
              <Text className='wish-hero__stat-value'>{fulfilledCount}</Text>
              <Text className='wish-hero__stat-label'>{t('wishPool.statFulfilled')}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Sort Tabs (pill style) */}
      {!loading && wishes.length > 0 && (
        <View className='wish-sort-tabs'>
          <View
            className={`wish-sort-tabs__item ${sortBy === 'votes' ? 'wish-sort-tabs__item--active' : ''}`}
            onClick={() => handleSortChange('votes')}
          >
            <Text className='wish-sort-tabs__icon'>🔥</Text>
            <Text className='wish-sort-tabs__label'>{t('wishPool.sortByVotes')}</Text>
          </View>
          <View
            className={`wish-sort-tabs__item ${sortBy === 'time' ? 'wish-sort-tabs__item--active' : ''}`}
            onClick={() => handleSortChange('time')}
          >
            <Text className='wish-sort-tabs__icon'>✨</Text>
            <Text className='wish-sort-tabs__label'>{t('wishPool.sortByTime')}</Text>
          </View>
        </View>
      )}

      {/* Content */}
      {loading ? (
        <SkeletonList count={5} />
      ) : wishes.length === 0 ? (
        <View className='wish-empty'>
          <View className='wish-empty__illustration'>
            <Text className='wish-empty__icon'>🌟</Text>
          </View>
          <Text className='wish-empty__title'>{t('wishPool.emptyTitle')}</Text>
          <Text className='wish-empty__text'>{t('wishPool.emptyText')}</Text>
          {wishPoolEnabled && (
            <View className='wish-empty__cta' onClick={handleGoCreate}>
              <Text>{t('wishPool.submitWish')}</Text>
            </View>
          )}
        </View>
      ) : (
        <ScrollView
          className='wish-list'
          scrollY
          onScrollToLower={handleLoadMore}
          lowerThreshold={100}
        >
          {wishes.map((wish) => {
            const canVote = wishPoolEnabled && wish.status === 'approved';
            const isVoteLoading = votingIds.has(wish.wishId);
            const voteColClass = `wish-card__vote-col${wish.hasVoted ? ' wish-card__vote-col--voted' : ''}${!canVote ? ' wish-card__vote-col--readonly' : ''}${isVoteLoading ? ' wish-card__vote-col--loading' : ''}`;

            return (
              <View key={wish.wishId} className={`wish-card wish-card--${wish.status}`}>
                {/* Vote column (left) */}
                <View
                  className={voteColClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (canVote && !wish.hasVoted) handleVote(wish.wishId);
                  }}
                >
                  <Text className='wish-card__vote-arrow'>{wish.hasVoted ? '✓' : '▲'}</Text>
                  <Text className='wish-card__vote-count'>{wish.voteCount}</Text>
                  <Text className='wish-card__vote-label'>{t('wishPool.voteLabel')}</Text>
                </View>

                {/* Image thumbnail (optional) */}
                {wish.imageUrl && (
                  <View className='wish-card__img-wrap'>
                    <Image
                      src={wish.imageUrl}
                      className='wish-card__img'
                      mode='aspectFill'
                      onClick={() => Taro.previewImage({ current: wish.imageUrl!, urls: [wish.imageUrl!] })}
                    />
                  </View>
                )}

                {/* Content (right) */}
                <View className='wish-card__content'>
                  <View className='wish-card__header'>
                    <Text
                      className={`wish-card__title${expandedIds.has(wish.wishId) ? ' wish-card__title--expanded' : ''}`}
                      onClick={() => toggleExpanded(wish.wishId)}
                    >
                      {wish.title}
                    </Text>
                    <Text className={`wish-status ${STATUS_CLASS[wish.status]}`}>
                      {getStatusLabel(wish.status)}
                    </Text>
                  </View>

                  <Text
                    className={`wish-card__desc${expandedIds.has(wish.wishId) ? ' wish-card__desc--expanded' : ''}`}
                    onClick={() => toggleExpanded(wish.wishId)}
                  >
                    {wish.description}
                  </Text>
                  {((wish.description && wish.description.length > 40) || (wish.title && wish.title.length > 20)) && (
                    <Text className='wish-card__toggle' onClick={() => toggleExpanded(wish.wishId)}>
                      {expandedIds.has(wish.wishId) ? t('wishPool.collapse') : t('wishPool.expand')}
                    </Text>
                  )}

                  <View className='wish-card__meta'>
                    <Text className='wish-card__time'>
                      {new Date(wish.createdAt).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}

          {/* Load more */}
          {loadingMore && (
            <View className='wish-load-more'>
              <Text className='wish-load-more__text'>{t('common.loading')}</Text>
            </View>
          )}

          {!loadingMore && hasMore && (
            <View className='wish-load-more wish-load-more--btn' onClick={handleLoadMore}>
              <Text className='wish-load-more__text'>{t('common.loadMore')}</Text>
            </View>
          )}

          {!hasMore && wishes.length > 0 && (
            <View className='wish-load-more'>
              <Text className='wish-load-more__text wish-load-more__text--end'>{t('wishPool.noMoreWishes')}</Text>
            </View>
          )}
        </ScrollView>
      )}

      <TabBar current="/pages/wishes/index" />
    </View>
  );
}
