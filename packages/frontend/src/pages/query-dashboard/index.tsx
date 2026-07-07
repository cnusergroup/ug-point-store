import { useState, useCallback, useEffect } from 'react';
import { View, Text, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { request, RequestError } from '../../utils/request';
import './index.scss';

/** 独立本地存储 key，与商城 access_token 区分，与 pages/query-login 一致 */
const QUERY_TOKEN_KEY = 'queryToken';

/** 活动明细视图每页记录数，与后端 paginateActivities 默认值一致 */
const PAGE_SIZE = 50;

type DashboardTab =
  | 'speaker-support'
  | 'volunteer-support'
  | 'total-count'
  | 'employee-activity-detail'
  | 'activity-detail';

interface SupportCountRow {
  userId: string;
  nickname: string;
  email: string;
  supportCount: number;
}

/** 总次数视图的一行：某位员工 Speaker 与志愿者身份按 activityId 去重合并后的总支持次数 */
interface TotalCountRow {
  userId: string;
  nickname: string;
  email: string;
  totalCount: number;
}

type PersonRow = SupportCountRow | TotalCountRow;

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
  employees: ActivityDetailEmployee[];
}

/** 员工支持活动明细视图的单个活动项 */
interface EmployeeActivityItem {
  activityId: string;
  topic: string;
  ugName: string;
  activityDate: string;
  roles: string[];
}

/** 员工支持活动明细视图的一行：某位员工及其支持过的全部活动 */
interface EmployeeActivityDetailRow {
  userId: string;
  nickname: string;
  email: string;
  activities: EmployeeActivityItem[];
}

const TABS: { key: DashboardTab; label: string }[] = [
  { key: 'speaker-support', label: 'Speaker 支持次数' },
  { key: 'volunteer-support', label: '志愿者支持次数' },
  { key: 'total-count', label: '总次数' },
  { key: 'employee-activity-detail', label: '员工支持活动明细' },
  { key: 'activity-detail', label: '活动支持记录明细' },
];

type CountTab = 'speaker-support' | 'volunteer-support' | 'total-count';

/** 人员类计数视图（非明细类）对应的查询接口路径 */
const PERSON_ENDPOINTS: Record<CountTab, string> = {
  'speaker-support': '/api/query/speaker-support',
  'volunteer-support': '/api/query/volunteer-support',
  'total-count': '/api/query/total-count',
};

/** 人员类计数视图表格第三列的标题文案 */
function getCountColumnLabel(tab: CountTab): string {
  if (tab === 'speaker-support') return 'Speaker支持次数';
  if (tab === 'volunteer-support') return '志愿者支持次数';
  return '总次数';
}

/** 从人员类计数视图行中取出计数值（supportCount 或 totalCount） */
function getCountValue(row: PersonRow): number {
  return 'supportCount' in row ? row.supportCount : row.totalCount;
}

/** 身份角色的中文展示文案 */
function roleLabel(role: string): string {
  return role === 'Volunteer' ? '志愿者' : role;
}

/** 拼接查询字符串，忽略空值/未定义字段 */
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

/**
 * 员工活动参与度查询主页面。
 *
 * 完全独立于商城主体系统：请求复用 `utils/request.ts` 的底层 HTTP 客户端，
 * 但通过 `skipAuth: true` 跳过商城 token 注入，手动携带独立的
 * `Authorization: Bearer <queryToken>`。收到 401 响应时清除本地 `queryToken`
 * 并跳转回 `pages/query-login/index`（与商城 token 过期跳转逻辑完全隔离）。
 */
export default function QueryDashboardPage() {
  const [activeTab, setActiveTab] = useState<DashboardTab>('speaker-support');

  // 人员类视图筛选条件
  const [keyword, setKeyword] = useState('');
  // 活动明细视图筛选条件
  const [activityId, setActivityId] = useState('');
  const [topicKeyword, setTopicKeyword] = useState('');
  // 所有视图共用的日期范围
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [personRows, setPersonRows] = useState<PersonRow[]>([]);
  const [employeeActivityRows, setEmployeeActivityRows] = useState<EmployeeActivityDetailRow[]>([]);
  const [activityRows, setActivityRows] = useState<ActivityDetailRow[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 导出交互状态
  const [exportLoading, setExportLoading] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [exportMessageType, setExportMessageType] = useState<'success' | 'error'>('error');

  const isCountView =
    activeTab === 'speaker-support' || activeTab === 'volunteer-support' || activeTab === 'total-count';
  const isEmployeeDetailView = activeTab === 'employee-activity-detail';
  const isKeywordView = isCountView || isEmployeeDetailView;
  const isActivityView = activeTab === 'activity-detail';

  /** 会话失效处理：清除本地 queryToken 并跳转回独立查询登录页 */
  const handleSessionExpired = useCallback(() => {
    Taro.removeStorageSync(QUERY_TOKEN_KEY);
    Taro.redirectTo({ url: '/pages/query-login/index' });
  }, []);

  // 进入页面时校验本地是否存在有效会话 token，缺失则直接跳转登录页
  useEffect(() => {
    const token = Taro.getStorageSync(QUERY_TOKEN_KEY);
    if (!token) {
      Taro.redirectTo({ url: '/pages/query-login/index' });
    }
  }, []);

  const fetchPersonView = useCallback(
    async (tab: CountTab, kw: string, sd: string, ed: string) => {
      const token = Taro.getStorageSync(QUERY_TOKEN_KEY);
      if (!token) {
        handleSessionExpired();
        return;
      }
      setLoading(true);
      setError('');
      try {
        const qs = buildQueryString({ keyword: kw, startDate: sd, endDate: ed });
        const resp = await request<{ rows: PersonRow[] }>({
          url: `${PERSON_ENDPOINTS[tab]}${qs}`,
          method: 'GET',
          skipAuth: true,
          headers: { Authorization: `Bearer ${token}` },
        });
        setPersonRows(resp.rows || []);
      } catch (err) {
        if (err instanceof RequestError && err.statusCode === 401) {
          handleSessionExpired();
          return;
        }
        setPersonRows([]);
        setError(err instanceof RequestError ? err.message : '查询失败，请检查网络后重试');
      } finally {
        setLoading(false);
      }
    },
    [handleSessionExpired],
  );

  const fetchEmployeeActivityDetail = useCallback(
    async (kw: string, sd: string, ed: string) => {
      const token = Taro.getStorageSync(QUERY_TOKEN_KEY);
      if (!token) {
        handleSessionExpired();
        return;
      }
      setLoading(true);
      setError('');
      try {
        const qs = buildQueryString({ keyword: kw, startDate: sd, endDate: ed });
        const resp = await request<{ rows: EmployeeActivityDetailRow[] }>({
          url: `/api/query/employee-activity-detail${qs}`,
          method: 'GET',
          skipAuth: true,
          headers: { Authorization: `Bearer ${token}` },
        });
        setEmployeeActivityRows(resp.rows || []);
      } catch (err) {
        if (err instanceof RequestError && err.statusCode === 401) {
          handleSessionExpired();
          return;
        }
        setEmployeeActivityRows([]);
        setError(err instanceof RequestError ? err.message : '查询失败，请检查网络后重试');
      } finally {
        setLoading(false);
      }
    },
    [handleSessionExpired],
  );

  const fetchActivityDetail = useCallback(
    async (aid: string, tk: string, sd: string, ed: string, pg: number) => {
      const token = Taro.getStorageSync(QUERY_TOKEN_KEY);
      if (!token) {
        handleSessionExpired();
        return;
      }
      setLoading(true);
      setError('');
      try {
        const qs = buildQueryString({ activityId: aid, topicKeyword: tk, startDate: sd, endDate: ed, page: pg });
        const resp = await request<{ rows: ActivityDetailRow[]; page: number; totalPages: number; total: number }>({
          url: `/api/query/activity-detail${qs}`,
          method: 'GET',
          skipAuth: true,
          headers: { Authorization: `Bearer ${token}` },
        });
        setActivityRows(resp.rows || []);
        setPage(resp.page || 1);
        setTotalPages(resp.totalPages || 1);
        setTotal(resp.total || 0);
      } catch (err) {
        if (err instanceof RequestError && err.statusCode === 401) {
          handleSessionExpired();
          return;
        }
        setActivityRows([]);
        setError(err instanceof RequestError ? err.message : '查询失败，请检查网络后重试');
      } finally {
        setLoading(false);
      }
    },
    [handleSessionExpired],
  );

  // 切换 Tab 时重置筛选条件并以空筛选自动查询一次
  useEffect(() => {
    setKeyword('');
    setActivityId('');
    setTopicKeyword('');
    setStartDate('');
    setEndDate('');
    setPage(1);
    if (activeTab === 'activity-detail') {
      fetchActivityDetail('', '', '', '', 1);
    } else if (activeTab === 'employee-activity-detail') {
      fetchEmployeeActivityDetail('', '', '');
    } else {
      fetchPersonView(activeTab as CountTab, '', '', '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleSearch = useCallback(() => {
    if (activeTab === 'activity-detail') {
      setPage(1);
      fetchActivityDetail(activityId, topicKeyword, startDate, endDate, 1);
    } else if (activeTab === 'employee-activity-detail') {
      fetchEmployeeActivityDetail(keyword, startDate, endDate);
    } else {
      fetchPersonView(activeTab as CountTab, keyword, startDate, endDate);
    }
  }, [
    activeTab,
    activityId,
    topicKeyword,
    startDate,
    endDate,
    keyword,
    fetchActivityDetail,
    fetchEmployeeActivityDetail,
    fetchPersonView,
  ]);

  const handlePrevPage = useCallback(() => {
    if (page <= 1) return;
    const newPage = page - 1;
    setPage(newPage);
    fetchActivityDetail(activityId, topicKeyword, startDate, endDate, newPage);
  }, [page, activityId, topicKeyword, startDate, endDate, fetchActivityDetail]);

  const handleNextPage = useCallback(() => {
    if (page >= totalPages) return;
    const newPage = page + 1;
    setPage(newPage);
    fetchActivityDetail(activityId, topicKeyword, startDate, endDate, newPage);
  }, [page, totalPages, activityId, topicKeyword, startDate, endDate, fetchActivityDetail]);

  /** 构建当前生效的导出筛选条件：计数/明细类人员视图为 keyword/日期范围，活动明细视图为 activityId/topicKeyword/日期范围（不含 page） */
  const buildExportFilter = useCallback(() => {
    if (activeTab === 'activity-detail') {
      return {
        activityId: activityId || undefined,
        topicKeyword: topicKeyword || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      };
    }
    return {
      keyword: keyword || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
    };
  }, [activeTab, activityId, topicKeyword, startDate, endDate, keyword]);

  /** 触发导出请求：调用 POST /api/query/export，成功后打开预签名下载链接，失败展示对应错误提示 */
  const triggerExport = useCallback(
    async (format: 'csv' | 'xlsx') => {
      const token = Taro.getStorageSync(QUERY_TOKEN_KEY);
      if (!token) {
        handleSessionExpired();
        return;
      }
      setExportLoading(true);
      setExportMessage('');
      try {
        const resp = await request<{ downloadUrl: string }>({
          url: '/api/query/export',
          method: 'POST',
          skipAuth: true,
          headers: { Authorization: `Bearer ${token}` },
          data: {
            view: activeTab,
            format,
            filter: buildExportFilter(),
          },
        });

        if (resp?.downloadUrl) {
          const env = Taro.getEnv();
          if (env === Taro.ENV_TYPE.WEB) {
            const link = document.createElement('a');
            link.href = resp.downloadUrl;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } else {
            Taro.downloadFile({ url: resp.downloadUrl });
          }
          setExportMessageType('success');
          setExportMessage('导出成功，正在下载...');
        } else {
          setExportMessageType('error');
          setExportMessage('导出失败，请稍后重试');
        }
      } catch (err) {
        if (err instanceof RequestError && err.statusCode === 401) {
          handleSessionExpired();
          return;
        }
        setExportMessageType('error');
        if (err instanceof RequestError && err.code === 'QUERY_EXPORT_LIMIT_EXCEEDED') {
          setExportMessage(err.message || '待导出记录数超过 50,000 条，请缩小搜索关键字或时间范围后重试');
        } else if (err instanceof RequestError) {
          setExportMessage(err.message || '导出失败，请稍后重试');
        } else {
          setExportMessage('导出失败，请稍后重试');
        }
      } finally {
        setExportLoading(false);
      }
    },
    [activeTab, buildExportFilter, handleSessionExpired],
  );

  /** 导出按钮点击：弹出格式选择（CSV/Excel），选择后触发导出请求 */
  const handleExport = useCallback(() => {
    if (exportLoading) return;
    Taro.showActionSheet({
      itemList: ['导出为 CSV', '导出为 Excel'],
    })
      .then((res) => {
        const format = res.tapIndex === 0 ? 'csv' : 'xlsx';
        triggerExport(format);
      })
      .catch(() => {
        // 用户取消选择，无需处理
      });
  }, [exportLoading, triggerExport]);

  return (
    <View className='query-dashboard-page'>
      <View className='query-dashboard-tabs'>
        {TABS.map((tab) => (
          <View
            key={tab.key}
            className={`query-dashboard-tabs__item ${activeTab === tab.key ? 'query-dashboard-tabs__item--active' : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      <View className='query-dashboard-filter-bar'>
        {isKeywordView && (
          <View className='query-dashboard-filter-bar__group'>
            <Text className='query-dashboard-filter-bar__label'>花名/邮箱</Text>
            <input
              className='query-dashboard-filter-bar__input'
              type='text'
              placeholder='搜索花名或邮箱'
              value={keyword}
              onInput={(e: any) => setKeyword(e.target.value || e.detail?.value || '')}
            />
          </View>
        )}

        {isActivityView && (
          <>
            <View className='query-dashboard-filter-bar__group'>
              <Text className='query-dashboard-filter-bar__label'>活动 ID</Text>
              <input
                className='query-dashboard-filter-bar__input'
                type='text'
                placeholder='输入活动 ID'
                value={activityId}
                onInput={(e: any) => setActivityId(e.target.value || e.detail?.value || '')}
              />
            </View>
            <View className='query-dashboard-filter-bar__group'>
              <Text className='query-dashboard-filter-bar__label'>活动主题</Text>
              <input
                className='query-dashboard-filter-bar__input'
                type='text'
                placeholder='搜索活动主题'
                value={topicKeyword}
                onInput={(e: any) => setTopicKeyword(e.target.value || e.detail?.value || '')}
              />
            </View>
          </>
        )}

        <View className='query-dashboard-filter-bar__group'>
          <Text className='query-dashboard-filter-bar__label'>开始日期</Text>
          <Picker mode='date' value={startDate} onChange={(e) => setStartDate(e.detail.value)}>
            <View className='query-dashboard-filter-bar__select'>{startDate || '不限'}</View>
          </Picker>
        </View>
        <View className='query-dashboard-filter-bar__group'>
          <Text className='query-dashboard-filter-bar__label'>结束日期</Text>
          <Picker mode='date' value={endDate} onChange={(e) => setEndDate(e.detail.value)}>
            <View className='query-dashboard-filter-bar__select'>{endDate || '不限'}</View>
          </Picker>
        </View>

        <View className='query-dashboard-filter-bar__actions'>
          <View className='query-dashboard-search-btn' onClick={handleSearch}>
            <Text>查询</Text>
          </View>
          <View
            className={`query-dashboard-export-btn ${exportLoading ? 'query-dashboard-export-btn--disabled' : ''}`}
            onClick={handleExport}
          >
            <Text>{exportLoading ? '导出中...' : '导出'}</Text>
          </View>
        </View>
      </View>

      {exportMessage && (
        <View
          className={`query-dashboard-status ${
            exportMessageType === 'success' ? 'query-dashboard-status--success' : 'query-dashboard-status--error'
          }`}
        >
          <Text>{exportMessage}</Text>
        </View>
      )}

      {error && (
        <View className='query-dashboard-status query-dashboard-status--error'>
          <Text>{error}</Text>
        </View>
      )}

      {loading && (
        <View className='query-dashboard-status'>
          <Text>加载中...</Text>
        </View>
      )}

      {!loading && isCountView && (
        <View className='query-dashboard-table'>
          <View className='query-dashboard-table__header'>
            <Text className='query-dashboard-table__header-cell query-dashboard-table__header-cell--name'>花名</Text>
            <Text className='query-dashboard-table__header-cell query-dashboard-table__header-cell--email'>邮箱</Text>
            <Text className='query-dashboard-table__header-cell query-dashboard-table__header-cell--count'>
              {getCountColumnLabel(activeTab as CountTab)}
            </Text>
          </View>
          <View className='query-dashboard-table__body'>
            {personRows.length === 0 ? (
              <View className='query-dashboard-status'>
                <Text>暂无数据</Text>
              </View>
            ) : (
              personRows.map((row) => (
                <View key={row.userId} className='query-dashboard-table__row'>
                  <Text className='query-dashboard-table__cell query-dashboard-table__cell--name'>{row.nickname}</Text>
                  <Text className='query-dashboard-table__cell query-dashboard-table__cell--email'>{row.email}</Text>
                  <Text className='query-dashboard-table__cell query-dashboard-table__cell--count'>{getCountValue(row)}</Text>
                </View>
              ))
            )}
          </View>
        </View>
      )}

      {!loading && isEmployeeDetailView && (
        <View className='query-dashboard-activity-list'>
          {employeeActivityRows.length === 0 ? (
            <View className='query-dashboard-status'>
              <Text>暂无数据</Text>
            </View>
          ) : (
            employeeActivityRows.map((employee) => (
              <View key={employee.userId} className='query-dashboard-activity-card'>
                <View className='query-dashboard-activity-card__header'>
                  <Text className='query-dashboard-activity-card__topic'>{employee.nickname}</Text>
                  <Text className='query-dashboard-activity-card__meta'>
                    {employee.email} · 支持活动总数：{employee.activities.length}
                  </Text>
                </View>
                <View className='query-dashboard-employee-list'>
                  {employee.activities.map((activity) => (
                    <Text key={activity.activityId} className='query-dashboard-employee-list__item'>
                      {activity.topic}（{activity.ugName} · {activity.activityDate} ·{' '}
                      {activity.roles.map(roleLabel).join('、')}）
                    </Text>
                  ))}
                </View>
              </View>
            ))
          )}
        </View>
      )}

      {!loading && isActivityView && (
        <View className='query-dashboard-activity-list'>
          {activityRows.length === 0 ? (
            <View className='query-dashboard-status'>
              <Text>暂无数据</Text>
            </View>
          ) : (
            activityRows.map((activity) => (
              <View key={activity.activityId} className='query-dashboard-activity-card'>
                <View className='query-dashboard-activity-card__header'>
                  <Text className='query-dashboard-activity-card__topic'>{activity.topic}</Text>
                  <Text className='query-dashboard-activity-card__meta'>
                    {activity.ugName} · {activity.activityDate}
                  </Text>
                </View>
                <View className='query-dashboard-employee-list'>
                  {activity.employees.map((emp) => (
                    <Text key={emp.userId} className='query-dashboard-employee-list__item'>
                      {emp.nickname}（{emp.roles.map(roleLabel).join('、')}）
                    </Text>
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
                <Text>上一页</Text>
              </View>
              <Text className='query-dashboard-pagination__info'>
                第 {page} / {totalPages} 页（共 {total} 条，每页 {PAGE_SIZE} 条）
              </Text>
              <View
                className={`query-dashboard-pagination__btn ${page >= totalPages ? 'query-dashboard-pagination__btn--disabled' : ''}`}
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
