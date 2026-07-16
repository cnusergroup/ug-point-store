import { useState, useCallback, useEffect } from 'react';
import { View, Text } from '@tarojs/components';
import { request, RequestError } from '../../utils/request';
import './index.scss';

/** 活动明细视图每页记录数，与后端 paginateActivities 默认值一致 */
const PAGE_SIZE = 50;

/**
 * 公开榜单页（无需登录）：Top Speakers / Top Volunteers / Event Contribution Record。
 * 对应后端三个公开接口：/api/query/speaker-support、/api/query/volunteer-support、/api/query/activity-detail。
 */
type DashboardTab = 'speaker-support' | 'volunteer-support' | 'content-contributors' | 'activity-detail';

interface SupportCountRow {
  userId: string;
  nickname: string;
  email: string;
  supportCount: number;
}

interface ContentContributorRow {
  rank: number;
  nickname: string;
  email: string;
  contentCount: number;
  tags: string[];
}

interface ActivityDetailEmployee {
  userId: string;
  nickname: string;
  email: string;
  roles: string[];
}

interface ActivityDetailRow {
  activityId: string;
  topic: string;
  ugName: string;
  activityDate: string;
  rsvp?: number;
  employees: ActivityDetailEmployee[];
}

interface ImpactSummary {
  rsvpTotal: number;
  rsvpSaImpacted: number;
  meetupTotal: number;
  meetupSaAttended: number;
}


const TABS: { key: DashboardTab; title: string; description: string }[] = [
  {
    key: 'speaker-support',
    title: 'Top Speakers',
    description:
      'Ranking AWS employees by their Speaker support at AWS Community events. Come share AWS and open-source tech, hands-on workshops, and more — thank you to every Amazonian who shares!',
  },
  {
    key: 'volunteer-support',
    title: 'Top Volunteers',
    description:
      'Ranking AWS employees who roll up their sleeves to support AWS Community events — as teaching assistants, booth staff, and beyond. Thank you to every Amazonian who lends a hand!',
  },
  {
    key: 'content-contributors',
    title: 'Top Content Contributors',
    description:
      'Ranking AWS employees by the reusable content they\'ve contributed — decks, workshops, and materials the whole community can build on.',
  },
  {
    key: 'activity-detail',
    title: 'Event Contribution Record',
    description:
      'A record of every AWS Community event and the Amazonians who supported it — as speakers, volunteers, and beyond. Thank you to everyone who showed up!',
  },
];

const PERSON_ENDPOINTS: Record<'speaker-support' | 'volunteer-support', string> = {
  'speaker-support': '/api/query/speaker-support',
  'volunteer-support': '/api/query/volunteer-support',
};

/** Role → English display label for the contribution record. */
function roleLabel(role: string): string {
  if (role === 'Volunteer') return 'Volunteer';
  if (role === 'Speaker') return 'Speaker';
  if (role === 'UserGroupLeader') return 'Leader';
  return role;
}

/** Assemble a query string, skipping empty values. */
function buildQueryString(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const key of Object.keys(params)) {
    const value = params[key];
    if (value !== undefined && value !== null && value !== '') {
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length > 0 ? `?${parts.join('&')}` : '';
}

export default function QueryDashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('speaker-support');

  const currentYear = new Date().getFullYear();
  const [selectedYear, setSelectedYear] = useState(currentYear);

  // Derive startDate/endDate from selectedYear for API calls
  const startDate = `${selectedYear}-01-01`;
  const endDate = `${selectedYear}-12-31`;

  // Year options: 2026 up to current year (ascending)
  const yearOptions = Array.from({ length: currentYear - 2025 }, (_, i) => 2026 + i);

  const [personRows, setPersonRows] = useState<SupportCountRow[]>([]);
  const [contentRows, setContentRows] = useState<ContentContributorRow[]>([]);
  const [activityRows, setActivityRows] = useState<ActivityDetailRow[]>([]);
  const [summary, setSummary] = useState<ImpactSummary | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const isCountView = activeTab === 'speaker-support' || activeTab === 'volunteer-support';
  const isContentView = activeTab === 'content-contributors';
  const isActivityView = activeTab === 'activity-detail';
  const activeMeta = TABS.find((t) => t.key === activeTab)!;

  /** 汇总卡片的范围标签：直接用所选年份 */
  const summaryScopeLabel = String(selectedYear);

  const fetchPersonView = useCallback(
    async (tab: 'speaker-support' | 'volunteer-support', kw: string, sd: string, ed: string) => {
      setLoading(true);
      setError('');
      try {
        const qs = buildQueryString({ keyword: kw, startDate: sd, endDate: ed });
        const resp = await request<{ rows: SupportCountRow[] }>({
          url: `${PERSON_ENDPOINTS[tab]}${qs}`,
          method: 'GET',
          skipAuth: true,
        });
        setPersonRows(resp.rows || []);
      } catch (err) {
        setPersonRows([]);
        setError(err instanceof RequestError ? err.message : '加载失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchContentContributors = useCallback(
    async (sd: string, ed: string) => {
      setLoading(true);
      setError('');
      try {
        const qs = buildQueryString({ startDate: sd, endDate: ed });
        const resp = await request<{ rows: ContentContributorRow[] }>({
          url: `/api/query/content-contributors${qs}`,
          method: 'GET',
          skipAuth: true,
        });
        setContentRows(resp.rows || []);
      } catch (err) {
        setContentRows([]);
        setError(err instanceof RequestError ? err.message : '加载失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchActivityDetail = useCallback(
    async (aid: string, tk: string, sd: string, ed: string, pg: number) => {
      setLoading(true);
      setError('');
      try {
        const qs = buildQueryString({ activityId: aid, topicKeyword: tk, startDate: sd, endDate: ed, page: pg });
        const resp = await request<{ rows: ActivityDetailRow[]; page: number; totalPages: number; total: number }>({
          url: `/api/query/activity-detail${qs}`,
          method: 'GET',
          skipAuth: true,
        });
        setActivityRows(resp.rows || []);
        setPage(resp.page || 1);
        setTotalPages(resp.totalPages || 1);
        setTotal(resp.total || 0);
      } catch (err) {
        setActivityRows([]);
        setError(err instanceof RequestError ? err.message : '加载失败，请稍后重试');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const fetchImpactSummary = useCallback(async (sd: string, ed: string) => {
    try {
      const qs = buildQueryString({ startDate: sd, endDate: ed });
      const resp = await request<{ summary: ImpactSummary }>({
        url: `/api/query/impact-summary${qs}`,
        method: 'GET',
        skipAuth: true,
      });
      setSummary(resp.summary || null);
    } catch {
      setSummary(null);
    }
  }, []);

  // 切换 Tab 或年份时自动查询
  useEffect(() => {
    setPage(1);
    if (activeTab === 'activity-detail') {
      fetchActivityDetail('', '', startDate, endDate, 1);
      fetchImpactSummary(startDate, endDate);
    } else if (activeTab === 'content-contributors') {
      setSummary(null);
      fetchContentContributors(startDate, endDate);
    } else {
      setSummary(null);
      fetchPersonView(activeTab, '', startDate, endDate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, selectedYear]);

  const handlePrevPage = useCallback(() => {
    if (page <= 1) return;
    const newPage = page - 1;
    setPage(newPage);
    fetchActivityDetail('', '', startDate, endDate, newPage);
  }, [page, startDate, endDate, fetchActivityDetail]);

  const handleNextPage = useCallback(() => {
    if (page >= totalPages) return;
    const newPage = page + 1;
    setPage(newPage);
    fetchActivityDetail('', '', startDate, endDate, newPage);
  }, [page, totalPages, startDate, endDate, fetchActivityDetail]);

  return (
    <View className='query-dashboard-page'>
      {/* 页面大标题 + 年份选择（融合为一体） */}
      <View className='query-dashboard-hero'>
        <Text className='query-dashboard-hero__title'>GCR Amazonian Community Impact Board</Text>
        <Text className='query-dashboard-hero__subtitle'>
          Not for the spotlight, but for the community. Thank you to every Amazonian who gives their time, energy, and heart. 💜
        </Text>
        <View className='query-dashboard-hero__year-row'>
          <Text className='query-dashboard-hero__year'>{selectedYear}</Text>
          {yearOptions.length > 1 && (
            <View className='query-dashboard-hero__year-tabs'>
              {yearOptions.map((yr) => (
                <View
                  key={yr}
                  className={`query-dashboard-hero__year-tab ${selectedYear === yr ? 'query-dashboard-hero__year-tab--active' : ''}`}
                  onClick={() => setSelectedYear(yr)}
                >
                  <Text>{yr}</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* Tab 栏 */}
      <View className='query-dashboard-tabs'>
        {TABS.map((tab) => (
          <View
            key={tab.key}
            className={`query-dashboard-tabs__item ${activeTab === tab.key ? 'query-dashboard-tabs__item--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <Text>{tab.title}</Text>
          </View>
        ))}
      </View>

      {/* 当前表标题 + 描述 */}
      <View className='query-dashboard-intro'>
        <Text className='query-dashboard-intro__title'>{activeMeta.title}</Text>
        <Text className='query-dashboard-intro__desc'>{activeMeta.description}</Text>
      </View>

      {error && (
        <View className='query-dashboard-status query-dashboard-status--error'>
          <Text>{error}</Text>
        </View>
      )}

      {loading && (
        <View className='query-dashboard-status'>
          <Text>Loading…</Text>
        </View>
      )}

      {/* 排名视图 */}
      {!loading && isCountView && (
        <View className='query-dashboard-ranking'>
          {personRows.length === 0 ? (
            <View className='query-dashboard-status'>
              <Text>No data yet</Text>
            </View>
          ) : (
            personRows.map((row, idx) => {
              // 并列排名：相同 supportCount 的人获得相同排名
              let rank: number;
              if (idx === 0) {
                rank = 1;
              } else if (row.supportCount === personRows[idx - 1].supportCount) {
                let firstIdx = idx - 1;
                while (firstIdx > 0 && personRows[firstIdx - 1].supportCount === row.supportCount) {
                  firstIdx--;
                }
                rank = firstIdx + 1;
              } else {
                rank = idx + 1;
              }
              const isTop = rank <= 3;
              return (
                <View key={row.userId} className={`query-dashboard-ranking__item ${isTop ? `query-dashboard-ranking__item--top${rank}` : ''}`}>
                  <View className='query-dashboard-ranking__rank'>
                    {isTop ? (
                      <View className={`qd-crown qd-crown--${rank}`} />
                    ) : (
                      <Text className='qd-rank-num'>{rank}</Text>
                    )}
                  </View>
                  <Text className='query-dashboard-ranking__name'>{row.nickname}</Text>
                  <Text className='query-dashboard-ranking__count'>{row.supportCount}</Text>
                </View>
              );
            })
          )}
        </View>
      )}

      {/* 内容贡献者排名视图 */}
      {!loading && isContentView && (
        <View className='query-dashboard-ranking'>
          {contentRows.length === 0 ? (
            <View className='query-dashboard-status'>
              <Text>No data yet</Text>
            </View>
          ) : (
            contentRows.map((row, idx) => {
              const isTop = row.rank <= 3;
              return (
                <View key={`${row.nickname}-${idx}`} className={`query-dashboard-ranking__item ${isTop ? `query-dashboard-ranking__item--top${row.rank}` : ''}`}>
                  <View className='query-dashboard-ranking__rank'>
                    {isTop ? (
                      <View className={`qd-crown qd-crown--${row.rank}`} />
                    ) : (
                      <Text className='qd-rank-num'>{row.rank}</Text>
                    )}
                  </View>
                  <View className='query-dashboard-ranking__info'>
                    <Text className='query-dashboard-ranking__name'>{row.nickname}</Text>
                    {row.tags.length > 0 && (
                      <View className='query-dashboard-ranking__tags'>
                        {row.tags.map((tag) => (
                          <Text key={tag} className='query-dashboard-ranking__tag'>{tag}</Text>
                        ))}
                      </View>
                    )}
                  </View>
                  <Text className='query-dashboard-ranking__count'>{row.contentCount}</Text>
                </View>
              );
            })
          )}
        </View>
      )}

      {/* 顶部影响力汇总卡片（仅活动贡献记录 tab） */}
      {!loading && isActivityView && summary && (
        <View className='query-dashboard-impact query-dashboard-impact--centered'>
          <View className='query-dashboard-impact__card'>
            <Text className='query-dashboard-impact__label'>Impacted RSVP</Text>
            <Text className='query-dashboard-impact__number'>{summary.rsvpSaImpacted.toLocaleString()}</Text>
            <Text className='query-dashboard-impact__total'>
              {summaryScopeLabel} Total UG RSVP&nbsp;&nbsp;{summary.rsvpTotal.toLocaleString()}
            </Text>
          </View>
          <View className='query-dashboard-impact__card'>
            <Text className='query-dashboard-impact__label'>Support Meetup</Text>
            <Text className='query-dashboard-impact__number'>{summary.meetupSaAttended.toLocaleString()}</Text>
            <Text className='query-dashboard-impact__total'>
              {summaryScopeLabel} Total UG Meetup&nbsp;&nbsp;{summary.meetupTotal.toLocaleString()}
            </Text>
          </View>
        </View>
      )}

      {/* 活动贡献记录视图 */}
      {!loading && isActivityView && (
        <View className='query-dashboard-activity-list query-dashboard-activity-list--centered'>
          {activityRows.length === 0 ? (
            <View className='query-dashboard-status'>
              <Text>No data yet</Text>
            </View>
          ) : (
            activityRows.map((activity) => (
              <View key={activity.activityId} className='query-dashboard-activity-card'>
                <View className='query-dashboard-activity-card__header'>
                  <Text className='query-dashboard-activity-card__topic'>{activity.topic}</Text>
                  <Text className='query-dashboard-activity-card__meta'>
                    {activity.ugName} · {activity.activityDate}
                  </Text>
                  {typeof activity.rsvp === 'number' && (
                    <Text className='query-dashboard-activity-card__rsvp'>RSVP · {activity.rsvp.toLocaleString()}</Text>
                  )}
                </View>
                <View className='query-dashboard-employee-list'>
                  {activity.employees.map((emp) => (
                    <View key={emp.userId} className='query-dashboard-employee-list__item'>
                      <Text className='query-dashboard-employee-list__name'>{emp.nickname}</Text>
                      <Text className='query-dashboard-employee-list__roles'>{emp.roles.map(roleLabel).join(' · ')}</Text>
                    </View>
                  ))}
                </View>
              </View>
            ))
          )}

          {activityRows.length > 0 && (
            <View className='query-dashboard-pagination'>
              <View
                className={`query-dashboard-pagination__btn ${page <= 1 ? 'query-dashboard-pagination__btn--disabled' : ''}`}
                onClick={handlePrevPage}
              >
                <Text>Prev</Text>
              </View>
              <Text className='query-dashboard-pagination__info'>
                Page {page} / {totalPages} · {total} events
              </Text>
              <View
                className={`query-dashboard-pagination__btn ${page >= totalPages ? 'query-dashboard-pagination__btn--disabled' : ''}`}
                onClick={handleNextPage}
              >
                <Text>Next</Text>
              </View>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
