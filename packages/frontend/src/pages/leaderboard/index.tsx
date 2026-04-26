import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { useTranslation } from '../../i18n';
import type { LeaderboardRankingItem, LeaderboardAnnouncementItem } from '@points-mall/shared';
import PageToolbar from '../../components/PageToolbar';
import './index.scss';

/* ---- Types ---- */

interface FeatureTogglesResponse {
  leaderboardRankingEnabled?: boolean;
  leaderboardAnnouncementEnabled?: boolean;
  leaderboardUpdateFrequency?: 'daily' | 'weekly' | 'monthly';
}

interface RankingResponse {
  success: boolean;
  items: LeaderboardRankingItem[];
  lastKey?: string | null;
}

interface AnnouncementResponse {
  success: boolean;
  items: LeaderboardAnnouncementItem[];
  lastKey?: string | null;
}

type RoleFilter = 'all' | 'Speaker' | 'UserGroupLeader' | 'Volunteer';
type MainTab = 'ranking' | 'announcement';

/* ---- Role badge mapping ---- */

const ROLE_BADGE_CLASS: Record<string, string> = {
  UserGroupLeader: 'role-badge--leader',
  Speaker: 'role-badge--speaker',
  Volunteer: 'role-badge--volunteer',
};

const ROLE_DISPLAY_LABEL: Record<string, string> = {
  UserGroupLeader: 'Leader',
  Speaker: 'Speaker',
  Volunteer: 'Volunteer',
};

/* ---- Relative time helper ---- */

function getRelativeTime(isoDate: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const now = Date.now();
  const then = new Date(isoDate).getTime();
  const diffMs = now - then;
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMinutes < 1) return t('leaderboard.justNow');
  if (diffMinutes < 60) return t('leaderboard.minutesAgo', { count: diffMinutes });
  if (diffHours < 24) return t('leaderboard.hoursAgo', { count: diffHours });
  if (diffDays < 30) return t('leaderboard.daysAgo', { count: diffDays });
  if (diffDays < 365) return t('leaderboard.monthsAgo', { count: Math.floor(diffDays / 30) });
  return t('leaderboard.yearsAgo', { count: Math.floor(diffDays / 365) });
}

/* ---- Skeleton Component ---- */

function SkeletonList({ count = 5 }: { count?: number }) {
  return (
    <View className='leaderboard-skeleton'>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} className='leaderboard-skeleton__item'>
          <View className='leaderboard-skeleton__circle' />
          <View className='leaderboard-skeleton__lines'>
            <View className='leaderboard-skeleton__line leaderboard-skeleton__line--medium' />
            <View className='leaderboard-skeleton__line leaderboard-skeleton__line--short' />
          </View>
          <View className='leaderboard-skeleton__value' />
        </View>
      ))}
    </View>
  );
}

/* ---- Ranking Tab Component ---- */

function RankingTab({
  updateFrequency,
}: {
  updateFrequency: string;
}) {
  const { t } = useTranslation();
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [items, setItems] = useState<LeaderboardRankingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastKeyRef = useRef<string | null>(null);

  const roleOptions: { value: RoleFilter; labelKey: string }[] = [
    { value: 'all', labelKey: 'leaderboard.roleAll' },
    { value: 'Speaker', labelKey: 'leaderboard.roleSpeaker' },
    { value: 'UserGroupLeader', labelKey: 'leaderboard.roleLeader' },
    { value: 'Volunteer', labelKey: 'leaderboard.roleVolunteer' },
  ];

  const fetchRanking = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      lastKeyRef.current = null;
    } else {
      setLoadingMore(true);
    }

    try {
      let url = `/api/leaderboard/ranking?role=${roleFilter}&limit=20`;
      if (!reset && lastKeyRef.current) {
        url += `&lastKey=${encodeURIComponent(lastKeyRef.current)}`;
      }

      const res = await request<RankingResponse>({ url });
      const newItems = res.items || [];

      if (reset) {
        setItems(newItems);
      } else {
        setItems((prev) => {
          const existingKeys = new Set(prev.map(i => `${i.nickname}|${i.earnTotal}`));
          const unique = newItems.filter(i => !existingKeys.has(`${i.nickname}|${i.earnTotal}`));
          return [...prev, ...unique];
        });
      }

      lastKeyRef.current = res.lastKey || null;
      setHasMore(!!res.lastKey && newItems.length > 0);
    } catch {
      if (reset) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [roleFilter]);

  useEffect(() => {
    fetchRanking(true);
  }, [fetchRanking]);

  const handleRoleChange = (role: RoleFilter) => {
    setRoleFilter(role);
  };

  const handleScrollToLower = () => {
    if (!loadingMore && hasMore) {
      fetchRanking(false);
    }
  };

  const getRankClass = (rank: number): string => {
    if (rank === 1) return 'ranking-item__rank--gold';
    if (rank === 2) return 'ranking-item__rank--silver';
    if (rank === 3) return 'ranking-item__rank--bronze';
    return '';
  };

  const getFrequencyText = (): string => {
    switch (updateFrequency) {
      case 'realtime': return t('leaderboard.updateFrequencyRealtime');
      case 'daily': return t('leaderboard.updateFrequencyDaily');
      case 'monthly': return t('leaderboard.updateFrequencyMonthly');
      default: return t('leaderboard.updateFrequencyWeekly');
    }
  };

  return (
    <View className='tab-panel'>
      {/* Role Filter Tabs */}
      <View className='role-tabs'>
        {roleOptions.map((opt) => (
          <View
            key={opt.value}
            className={`role-tabs__item ${roleFilter === opt.value ? 'role-tabs__item--active' : ''}`}
            onClick={() => handleRoleChange(opt.value)}
          >
            <Text className='role-tabs__label'>{t(opt.labelKey)}</Text>
          </View>
        ))}
      </View>

      {/* Content */}
      {loading ? (
        <SkeletonList count={6} />
      ) : items.length === 0 ? (
        <View className='leaderboard-empty'>
          <Text className='leaderboard-empty__icon'>🏆</Text>
          <Text className='leaderboard-empty__text'>{t('leaderboard.rankingEmpty')}</Text>
        </View>
      ) : (
        <ScrollView
          className='ranking-list'
          scrollY
          onScrollToLower={handleScrollToLower}
          lowerThreshold={100}
        >
          {items.map((item, idx) => {
            const displayRank = idx + 1;
            return (
            <View key={`${idx}-${item.nickname}`} className='ranking-item' style={{ animationDelay: `${Math.min(idx, 20) * 0.04}s` }}>
              <View className={`ranking-item__rank ${getRankClass(displayRank)}`}>
                <Text>{displayRank}</Text>
              </View>
              <View className='ranking-item__info'>
                <Text className='ranking-item__nickname'>{item.nickname}</Text>
                <View className='ranking-item__roles'>
                  {item.roles.map((role) => (
                    <Text
                      key={role}
                      className={`role-badge ${ROLE_BADGE_CLASS[role] || ''}`}
                    >
                      {ROLE_DISPLAY_LABEL[role] || role}
                    </Text>
                  ))}
                </View>
              </View>
              <Text className='ranking-item__points'>
                {item.earnTotal.toLocaleString()}
              </Text>
            </View>
            );
          })}

          {loadingMore && (
            <View className='leaderboard-load-more'>
              <Text className='leaderboard-load-more__text'>{t('common.loading')}</Text>
            </View>
          )}

          {!loadingMore && hasMore && (
            <View className='leaderboard-load-more leaderboard-load-more--btn' onClick={handleScrollToLower}>
              <Text className='leaderboard-load-more__text'>{t('common.loadMore')}</Text>
            </View>
          )}

          {/* Update frequency footer */}
          <View className='ranking-footer'>
            <Text className='ranking-footer__text'>{getFrequencyText()}</Text>
          </View>
        </ScrollView>
      )}
    </View>
  );
}

/* ---- Announcement Tab Component ---- */

function AnnouncementTab() {
  const { t } = useTranslation();
  const [items, setItems] = useState<LeaderboardAnnouncementItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const lastKeyRef = useRef<string | null>(null);

  const fetchAnnouncements = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      lastKeyRef.current = null;
    } else {
      setLoadingMore(true);
    }

    try {
      let url = '/api/leaderboard/announcements?limit=20';
      if (!reset && lastKeyRef.current) {
        url += `&lastKey=${encodeURIComponent(lastKeyRef.current)}`;
      }

      const res = await request<AnnouncementResponse>({ url });
      const newItems = res.items || [];

      if (reset) {
        setItems(newItems);
      } else {
        setItems((prev) => [...prev, ...newItems]);
      }

      lastKeyRef.current = res.lastKey || null;
      setHasMore(!!res.lastKey);
    } catch {
      if (reset) setItems([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, []);

  useEffect(() => {
    fetchAnnouncements(true);
  }, [fetchAnnouncements]);

  const handleScrollToLower = () => {
    if (!loadingMore && hasMore) {
      fetchAnnouncements(false);
    }
  };

  const isBatchRecord = (source: string) => source.startsWith('批量发放:');
  const isQuarterlyAward = (item: LeaderboardAnnouncementItem) => item.activityType === '季度贡献奖';

  const formatRecord = (item: LeaderboardAnnouncementItem): string => {
    // Quarterly award — dedicated template (no activity/UG)
    if (isQuarterlyAward(item)) {
      return t('leaderboard.quarterlyAwardTemplate' as any, {
        distributorNickname: item.distributorNickname || '—',
        targetRole: ROLE_DISPLAY_LABEL[item.targetRole] || item.targetRole,
        recipientNickname: item.recipientNickname,
        amount: item.amount,
        awardDate: item.activityDate || '—',
      });
    }
    if (isBatchRecord(item.source)) {
      return t('leaderboard.batchTemplate', {
        distributorNickname: item.distributorNickname || '—',
        activityUG: item.activityUG || '—',
        activityDate: item.activityDate || '—',
        activityTopic: item.activityTopic || '—',
        targetRole: ROLE_DISPLAY_LABEL[item.targetRole] || item.targetRole,
        recipientNickname: item.recipientNickname,
        amount: item.amount,
      });
    }
    // Reservation record
    return t('leaderboard.reservationTemplate', {
      recipientNickname: item.recipientNickname,
      activityUG: item.activityUG || '—',
      activityDate: item.activityDate || '—',
      activityTopic: item.activityTopic || '—',
      amount: item.amount,
    });
  };

  return (
    <View className='tab-panel'>
      {loading ? (
        <SkeletonList count={5} />
      ) : items.length === 0 ? (
        <View className='leaderboard-empty'>
          <Text className='leaderboard-empty__icon'>📢</Text>
          <Text className='leaderboard-empty__text'>{t('leaderboard.announcementEmpty')}</Text>
        </View>
      ) : (
        <ScrollView
          className='announcement-list'
          scrollY
          onScrollToLower={handleScrollToLower}
          lowerThreshold={100}
        >
          {items.map((item, idx) => (
            <View key={item.recordId} className='announcement-item' style={{ animationDelay: `${idx * 0.04}s` }}>
              <Text className='announcement-item__content'>
                {formatRecord(item)}
              </Text>
              <View className='announcement-item__meta'>
                <Text className='announcement-item__time'>
                  {getRelativeTime(item.createdAt, t)}
                </Text>
                {item.targetRole && (
                  <Text className={`role-badge ${ROLE_BADGE_CLASS[item.targetRole] || ''}`}>
                    {ROLE_DISPLAY_LABEL[item.targetRole] || item.targetRole}
                  </Text>
                )}
              </View>
            </View>
          ))}

          {loadingMore && (
            <View className='leaderboard-load-more'>
              <Text className='leaderboard-load-more__text'>{t('common.loading')}</Text>
            </View>
          )}

          {!loadingMore && hasMore && (
            <View className='leaderboard-load-more leaderboard-load-more--btn' onClick={handleScrollToLower}>
              <Text className='leaderboard-load-more__text'>{t('common.loadMore')}</Text>
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

/* ---- Main Leaderboard Page ---- */

export default function LeaderboardPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [activeTab, setActiveTab] = useState<MainTab>('ranking');
  const [rankingEnabled, setRankingEnabled] = useState(false);
  const [announcementEnabled, setAnnouncementEnabled] = useState(false);
  const [updateFrequency, setUpdateFrequency] = useState<string>('weekly');
  const [configLoading, setConfigLoading] = useState(true);

  // Track whether each tab has been activated (for preserving scroll)
  const [rankingMounted, setRankingMounted] = useState(false);
  const [announcementMounted, setAnnouncementMounted] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchConfig();
  }, [isAuthenticated]);

  // Track which tabs have been mounted for scroll preservation
  useEffect(() => {
    if (activeTab === 'ranking') setRankingMounted(true);
    if (activeTab === 'announcement') setAnnouncementMounted(true);
  }, [activeTab]);

  const fetchConfig = async () => {
    try {
      const res = await request<FeatureTogglesResponse>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });
      setRankingEnabled(!!res.leaderboardRankingEnabled);
      setAnnouncementEnabled(!!res.leaderboardAnnouncementEnabled);
      setUpdateFrequency(res.leaderboardUpdateFrequency || 'weekly');

      // Set default active tab based on what's enabled
      if (!res.leaderboardRankingEnabled && res.leaderboardAnnouncementEnabled) {
        setActiveTab('announcement');
      }
    } catch {
      // On error, keep defaults (both disabled)
    } finally {
      setConfigLoading(false);
    }
  };

  const handleBack = () => {
    Taro.redirectTo({ url: '/pages/hub/index' });
  };

  const showTabs = rankingEnabled && announcementEnabled;
  const showRanking = rankingEnabled;
  const showAnnouncement = announcementEnabled;
  const bothDisabled = !rankingEnabled && !announcementEnabled;

  if (configLoading) {
    return (
      <View className='leaderboard-page'>
        <PageToolbar title={t('leaderboard.title')} onBack={handleBack} />
        <SkeletonList count={6} />
      </View>
    );
  }

  return (
    <View className='leaderboard-page'>
      {/* Header */}
      <PageToolbar title={t('leaderboard.title')} onBack={handleBack} />

      {/* Tab Switcher — only when both are enabled */}
      {showTabs && (
        <View className='leaderboard-tabs'>
          <View
            className={`leaderboard-tabs__item ${activeTab === 'ranking' ? 'leaderboard-tabs__item--active' : ''}`}
            onClick={() => setActiveTab('ranking')}
          >
            <Text className='leaderboard-tabs__label'>{t('leaderboard.tabRanking')}</Text>
          </View>
          <View
            className={`leaderboard-tabs__item ${activeTab === 'announcement' ? 'leaderboard-tabs__item--active' : ''}`}
            onClick={() => setActiveTab('announcement')}
          >
            <Text className='leaderboard-tabs__label'>{t('leaderboard.tabAnnouncement')}</Text>
          </View>
        </View>
      )}

      {/* Content */}
      <View className='leaderboard-content'>
        {bothDisabled ? (
          <View className='leaderboard-disabled'>
            <View className='leaderboard-disabled__icon'>
              <Text>🔒</Text>
            </View>
            <Text className='leaderboard-disabled__text'>{t('leaderboard.featureDisabled')}</Text>
          </View>
        ) : (
          <>
            {/* Ranking Tab — show/hide via CSS to preserve scroll position */}
            {showRanking && (rankingMounted || activeTab === 'ranking') && (
              <View className={`tab-panel ${activeTab !== 'ranking' ? 'tab-panel--hidden' : ''}`}>
                <RankingTab updateFrequency={updateFrequency} />
              </View>
            )}

            {/* Announcement Tab — show/hide via CSS to preserve scroll position */}
            {showAnnouncement && (announcementMounted || activeTab === 'announcement') && (
              <View className={`tab-panel ${activeTab !== 'announcement' ? 'tab-panel--hidden' : ''}`}>
                <AnnouncementTab />
              </View>
            )}
          </>
        )}
      </View>
    </View>
  );
}
