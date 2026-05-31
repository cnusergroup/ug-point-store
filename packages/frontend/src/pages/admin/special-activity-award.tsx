/**
 * 特殊活动积分颁发 (Special Activity Award) — SuperAdmin 页面
 *
 * 与 quarterly-award 模板同构（参考 `pages/admin/quarterly-award.tsx`），但发放
 * 通道独立：写入 `earnTotalSpecialActivity` 字段、绑定 AwardTag 元数据、
 * 去重粒度为 (activityId, awardTagName, userId)。详见
 * `.kiro/specs/special-activity-award/design.md`。
 *
 * 表单字段：
 *   - 活动选择器（关联活动；批量发放结果绑定到该活动）
 *   - 颁发日期（默认今天）
 *   - 每人积分（正整数）
 *   - 奖项标签（AwardTagPicker；输入 + 自动补全 + 新建）
 *   - 已选用户列表（分页加载 + 客户端搜索 + 全选切换）
 *
 * 提交流程：
 *   1. 表单校验（canSubmit）+ 客户端预检 BATCH_TOO_LARGE（人数 ≤ 50）
 *   2. 弹出 ConfirmModal 展示汇总（活动 / 日期 / 标签 / 人数 / 单人积分 / 合计）
 *   3. POST /api/admin/special-activity-award
 *   4. 成功 → toast + 重置勾选；失败：
 *      - DUPLICATE_AWARD_TAG_DISTRIBUTION → 高亮 duplicateUserIds 行 + toast
 *      - 其它 4xx/5xx → toast 显示后端 message
 *
 * UI/UX：
 *   - 仅使用 special-activity-award.scss 中已定义的 BEM 类
 *   - 不使用 emoji 作为图标；图标用内联 SVG（Heroicons outline）
 *   - 所有可点击行使用 `cursor: pointer`（已在 scss 中配置）
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { validateAwardTagName } from '@points-mall/shared';
import AwardTagPicker from '../../components/AwardTagPicker';
import './special-activity-award.scss';

// ---- Types ----

interface UserListItem {
  userId: string;
  email: string;
  nickname: string;
  roles: string[];
  points: number;
  status: 'active' | 'disabled';
}

interface ActivityItem {
  activityId: string;
  activityType: '线上活动' | '线下活动';
  ugName: string;
  topic: string;
  activityDate: string;
}

interface SubmitSuccessResponse {
  distributionId: string;
  successCount: number;
  totalPoints: number;
  awardTagId: string;
  awardTagName: string;
}

interface DuplicateErrorPayload {
  duplicateUserIds?: string[];
}

/** 单次提交允许的最大用户数（与后端 BATCH_TOO_LARGE 约束一致：userIds.length * 2 ≤ 100） */
const MAX_USERS_PER_SUBMIT = 50;

// ---- Pure helpers (Property 3 / Property 4 候选) ----

/**
 * Property 3: filterUsersBySearch — 包含语义
 *
 * 当 query 经 trim 后为空字符串时返回原列表；否则返回每个 user 满足
 * `nickname` 或 `email` 在 toLowerCase 后包含 query.toLowerCase() 子串的子集。
 */
export function filterUsersBySearch(users: UserListItem[], query: string): UserListItem[] {
  const q = (query ?? '').trim().toLowerCase();
  if (q.length === 0) return users;
  return users.filter(
    (u) =>
      (u.nickname ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q),
  );
}

interface CanSubmitState {
  selectedActivity: ActivityItem | null;
  points: number;
  awardTagName: string;
  userIds: string[];
  awardDate: string;
}

/**
 * Property 4: canSubmit — 必填条件合取
 *
 * 等价于 `selectedActivity != null && points >= 1 && validateAwardTagName(awardTagName).valid
 *        && userIds.length >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(awardDate)`
 */
export function canSubmit(state: CanSubmitState): boolean {
  if (!state.selectedActivity) return false;
  if (!Number.isInteger(state.points) || state.points < 1) return false;
  if (!validateAwardTagName(state.awardTagName).valid) return false;
  if (!Array.isArray(state.userIds) || state.userIds.length < 1) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.awardDate)) return false;
  return true;
}

// ---- Inline SVG icons (Heroicons outline 24×24, currentColor) ----

function CalendarIcon() {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      fill='none'
      viewBox='0 0 24 24'
      strokeWidth={1.5}
      stroke='currentColor'
      width={20}
      height={20}
    >
      <path
        strokeLinecap='round'
        strokeLinejoin='round'
        d='M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5'
      />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      xmlns='http://www.w3.org/2000/svg'
      fill='none'
      viewBox='0 0 24 24'
      strokeWidth={1.5}
      stroke='currentColor'
      width={20}
      height={20}
    >
      <path strokeLinecap='round' strokeLinejoin='round' d='m19.5 8.25-7.5 7.5-7.5-7.5' />
    </svg>
  );
}

// ---- Page component ----

export default function SpecialActivityAwardPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const { t } = useTranslation();

  // ---- Form state ----
  const [selectedActivity, setSelectedActivity] = useState<ActivityItem | null>(null);
  const [pointsInput, setPointsInput] = useState('');
  const [awardTagName, setAwardTagName] = useState('');
  const [awardDate, setAwardDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

  // ---- Activity list ----
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesLastKey, setActivitiesLastKey] = useState<string | null>(null);
  const [activitySearch, setActivitySearch] = useState('');
  const [showActivityList, setShowActivityList] = useState(false);

  // ---- User list ----
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersLastKey, setUsersLastKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ---- Awarded users (already received under (activityId, awardTagName)) ----
  // 在 backend 暂未支持 SpecialActivity 的 /awarded 查询时，这里靠 submit
  // 时的 DUPLICATE_AWARD_TAG_DISTRIBUTION 错误兜底（duplicateUserIds 字段）。
  const [awardedUserIds, setAwardedUserIds] = useState<Set<string>>(new Set());
  const [duplicateUserIds, setDuplicateUserIds] = useState<Set<string>>(new Set());

  // ---- Modal / submission ----
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ---- Auth gate (mirror quarterly-award) ----
  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    if (!isSuperAdmin) {
      Taro.redirectTo({ url: '/pages/admin/index' });
      return;
    }
  }, [isAuthenticated, isSuperAdmin]);

  // ---- Fetch activities ----
  const fetchActivities = useCallback(async (append = false, cursor?: string | null) => {
    if (!append) setActivitiesLoading(true);
    try {
      let url = '/api/admin/activities?pageSize=50';
      if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;
      const res = await request<{ activities: ActivityItem[]; lastKey?: string }>({ url });
      setActivities((prev) => (append ? [...prev, ...(res.activities || [])] : res.activities || []));
      setActivitiesLastKey(res.lastKey ?? null);
    } catch {
      if (!append) setActivities([]);
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  // ---- Fetch users (paginated) ----
  const fetchUsers = useCallback(async (append = false, cursor?: string | null) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '50' });
      if (append && cursor) params.set('lastKey', cursor);
      const res = await request<{ users: UserListItem[]; lastKey?: string }>({
        url: `/api/admin/users?${params.toString()}`,
      });
      // 仅保留 active 用户（与 design.md 前端要求一致）
      const activeUsers = (res.users || []).filter((u) => u.status === 'active');
      setUsers((prev) => (append ? [...prev, ...activeUsers] : activeUsers));
      setUsersLastKey(res.lastKey ?? null);
    } catch {
      if (!append) setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  // ---- Best-effort awarded-users preload ----
  // 当 activity + awardTag 都已选定时尝试拉取已发放用户。后端当前的
  // /api/admin/batch-points/awarded 仅识别身份分三角色，调用 SpecialActivity
  // 会返回 400 — 此时静默吞错，依赖 submit 时的 DUPLICATE 错误兜底。
  const fetchAwardedUsers = useCallback(async (activityId: string, tagName: string) => {
    try {
      const params = new URLSearchParams({
        activityId,
        targetRole: 'SpecialActivity',
        awardTagName: tagName,
      });
      const res = await request<{ userIds: string[] }>({
        url: `/api/admin/batch-points/awarded?${params.toString()}`,
      });
      setAwardedUserIds(new Set(res.userIds || []));
    } catch {
      setAwardedUserIds(new Set());
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !isSuperAdmin) return;
    fetchUsers(false);
    fetchActivities(false);
  }, [isAuthenticated, isSuperAdmin, fetchUsers, fetchActivities]);

  useEffect(() => {
    if (!isAuthenticated || !isSuperAdmin) return;
    setAwardedUserIds(new Set());
    setDuplicateUserIds(new Set());
    if (selectedActivity && validateAwardTagName(awardTagName).valid) {
      fetchAwardedUsers(selectedActivity.activityId, awardTagName);
    }
  }, [isAuthenticated, isSuperAdmin, selectedActivity, awardTagName, fetchAwardedUsers]);

  // ---- Derived data ----
  const filteredUsers = useMemo(
    () => filterUsersBySearch(users, searchQuery),
    [users, searchQuery],
  );

  const selectableUsers = useMemo(
    () => filteredUsers.filter((u) => !awardedUserIds.has(u.userId)),
    [filteredUsers, awardedUserIds],
  );

  const filteredActivities = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    if (!q) return activities;
    return activities.filter(
      (a) =>
        a.ugName.toLowerCase().includes(q) ||
        a.topic.toLowerCase().includes(q) ||
        a.activityDate.includes(q),
    );
  }, [activities, activitySearch]);

  const isAllSelected =
    selectableUsers.length > 0 &&
    selectableUsers.every((u) => selectedIds.has(u.userId));

  const pointsValue = (() => {
    const n = parseInt(pointsInput, 10);
    return Number.isInteger(n) && n >= 1 ? n : 0;
  })();

  const submittable = canSubmit({
    selectedActivity,
    points: pointsValue,
    awardTagName,
    userIds: [...selectedIds],
    awardDate,
  });

  // ---- Handlers ----
  const handleBack = () => goBack('/pages/admin/index');

  const handleSelectActivity = (activity: ActivityItem) => {
    setSelectedActivity(activity);
    setShowActivityList(false);
    setActivitySearch('');
    setSelectedIds(new Set());
    setDuplicateUserIds(new Set());
  };

  const handleClearActivity = () => {
    setSelectedActivity(null);
    setSelectedIds(new Set());
    setDuplicateUserIds(new Set());
  };

  const toggleUser = (userId: string) => {
    if (awardedUserIds.has(userId)) return;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
    // 用户重新勾选时清除其重复标记
    if (duplicateUserIds.has(userId)) {
      setDuplicateUserIds((prev) => {
        const next = new Set(prev);
        next.delete(userId);
        return next;
      });
    }
  };

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableUsers.forEach((u) => next.delete(u.userId));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        selectableUsers.forEach((u) => next.add(u.userId));
        return next;
      });
    }
  };

  const handleOpenConfirm = () => {
    if (!submittable) return;
    if (selectedIds.size > MAX_USERS_PER_SUBMIT) {
      Taro.showToast({
        title: t('specialActivityAward.errorBatchTooLarge'),
        icon: 'none',
      });
      return;
    }
    setShowConfirm(true);
  };

  const handleSubmit = async () => {
    if (!submittable || submitting || !selectedActivity) return;
    setSubmitting(true);
    try {
      const userIds = [...selectedIds];
      const res = await request<SubmitSuccessResponse>({
        url: '/api/admin/special-activity-award',
        method: 'POST',
        data: {
          activityId: selectedActivity.activityId,
          points: pointsValue,
          awardTagName,
          userIds,
          awardDate,
        },
      });
      Taro.showToast({
        title: t('specialActivityAward.successToast', {
          count: res.successCount,
          total: res.totalPoints,
        }),
        icon: 'none',
        duration: 3000,
      });
      setShowConfirm(false);
      setSelectedIds(new Set());
      setDuplicateUserIds(new Set());
      // 重新拉取已发放列表，把刚发放的用户标记为已发放
      if (selectedActivity && validateAwardTagName(awardTagName).valid) {
        fetchAwardedUsers(selectedActivity.activityId, awardTagName);
      }
    } catch (err) {
      if (err instanceof RequestError) {
        if (err.code === 'DUPLICATE_AWARD_TAG_DISTRIBUTION') {
          // 高亮重复用户行
          const data = err.data as DuplicateErrorPayload | undefined;
          const dupIds = Array.isArray(data?.duplicateUserIds) ? data!.duplicateUserIds! : [];
          setDuplicateUserIds(new Set(dupIds));
          Taro.showToast({
            title: t('specialActivityAward.errorDuplicateAwardTagDistribution'),
            icon: 'none',
          });
        } else if (err.code === 'BATCH_TOO_LARGE') {
          Taro.showToast({ title: t('specialActivityAward.errorBatchTooLarge'), icon: 'none' });
        } else if (err.code === 'ACTIVITY_NOT_FOUND') {
          Taro.showToast({ title: t('specialActivityAward.errorActivityNotFound'), icon: 'none' });
        } else if (err.code === 'FORBIDDEN') {
          Taro.showToast({ title: t('specialActivityAward.errorForbidden'), icon: 'none' });
        } else {
          Taro.showToast({ title: err.message, icon: 'none' });
        }
      } else {
        Taro.showToast({ title: t('specialActivityAward.errorDefault'), icon: 'none' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Render ----
  const totalPoints = selectedIds.size * pointsValue;

  return (
    <View className='special-activity-award'>
      {/* Toolbar */}
      <View className='special-activity-award__toolbar'>
        <View className='special-activity-award__back' onClick={handleBack}>
          <Text className='special-activity-award__back-text'>
            {t('specialActivityAward.backButton')}
          </Text>
        </View>
        <Text className='special-activity-award__title'>
          {t('specialActivityAward.title')}
        </Text>
        <View style={{ width: '60px' }} />
      </View>

      <View className='special-activity-award__body'>
        {/* Form card */}
        <View className='saa-form-card'>
          <Text className='saa-form-card__title'>
            {t('specialActivityAward.formCardTitle')}
          </Text>

          {/* Activity picker */}
          <View className='saa-field'>
            <Text className='saa-field__label'>
              {t('specialActivityAward.activityLabel')}
            </Text>
            <View
              className={`saa-activity-picker${selectedActivity ? '' : ' saa-activity-picker--placeholder'}`}
              onClick={() => setShowActivityList((v) => !v)}
            >
              <Text className='saa-activity-picker__text'>
                {selectedActivity
                  ? `${selectedActivity.ugName} · ${selectedActivity.topic} · ${selectedActivity.activityDate}`
                  : t('specialActivityAward.activityLabel')}
              </Text>
              <View className='saa-activity-picker__icon'>
                <ChevronDownIcon />
              </View>
            </View>

            {selectedActivity && (
              <Text
                className='saa-field__hint'
                onClick={handleClearActivity}
                style={{ cursor: 'pointer' }}
              >
                {t('specialActivityAward.backButton')}
              </Text>
            )}

            {/* Activity selection list (inline) */}
            {showActivityList && (
              <View className='saa-user-section'>
                <View className='saa-search'>
                  <Input
                    className='saa-search__input'
                    value={activitySearch}
                    onInput={(e) => setActivitySearch(e.detail.value)}
                    placeholder={t('specialActivityAward.searchPlaceholder')}
                  />
                </View>
                <View className='saa-user-list'>
                  {activitiesLoading && activities.length === 0 ? (
                    <View className='saa-empty'>
                      <Text className='saa-empty__text'>
                        {t('specialActivityAward.loading')}
                      </Text>
                    </View>
                  ) : filteredActivities.length === 0 ? (
                    <View className='saa-empty'>
                      <Text className='saa-empty__text'>
                        {t('specialActivityAward.noUsersSearch')}
                      </Text>
                    </View>
                  ) : (
                    filteredActivities.map((activity) => (
                      <View
                        key={activity.activityId}
                        className='saa-user-item'
                        onClick={() => handleSelectActivity(activity)}
                      >
                        <View className='saa-user-item__info'>
                          <Text className='saa-user-item__nickname'>{activity.topic}</Text>
                          <Text className='saa-user-item__email'>
                            {activity.activityType} · {activity.ugName} · {activity.activityDate}
                          </Text>
                        </View>
                      </View>
                    ))
                  )}
                  {activitiesLastKey && !activitiesLoading && (
                    <View
                      className='saa-load-more'
                      onClick={() => fetchActivities(true, activitiesLastKey)}
                    >
                      <Text className='saa-load-more__text'>
                        {t('specialActivityAward.loadMore')}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            )}
          </View>

          {/* Award date */}
          <View className='saa-field'>
            <Text className='saa-field__label'>
              {t('specialActivityAward.awardDateLabel')}
            </Text>
            <Picker
              mode='date'
              value={awardDate}
              onChange={(e) => setAwardDate(e.detail.value)}
            >
              <View className='saa-date-picker'>
                <Text className='saa-date-picker__text'>
                  {awardDate || t('specialActivityAward.pickDateHint')}
                </Text>
                <View className='saa-date-picker__icon'>
                  <CalendarIcon />
                </View>
              </View>
            </Picker>
          </View>

          {/* Points */}
          <View className='saa-field'>
            <Text className='saa-field__label'>
              {t('specialActivityAward.pointsLabel')}
            </Text>
            <Input
              className='saa-input'
              type='number'
              value={pointsInput}
              onInput={(e) => setPointsInput(e.detail.value)}
              placeholder={t('specialActivityAward.pointsPlaceholder')}
            />
            {pointsInput.length > 0 && pointsValue === 0 && (
              <Text className='saa-field__error'>
                {t('specialActivityAward.errorPointsInvalid')}
              </Text>
            )}
          </View>

          {/* AwardTag picker */}
          <View className='saa-field'>
            <Text className='saa-field__label'>
              {t('specialActivityAward.awardTagLabel')}
            </Text>
            <Text className='saa-field__hint'>
              {t('specialActivityAward.awardTagHint')}
            </Text>
            <AwardTagPicker value={awardTagName} onChange={setAwardTagName} />
          </View>
        </View>

        {/* User selection */}
        <View className='saa-user-section'>
          <View className='saa-user-section__header'>
            <Text className='saa-user-section__title'>
              {t('specialActivityAward.userSectionTitle')}
            </Text>
            <Text className='saa-user-section__count'>
              {selectedIds.size} / {selectableUsers.length}
            </Text>
            <View className='saa-select-all' onClick={toggleSelectAll}>
              <Text className='saa-select-all__text'>
                {isAllSelected
                  ? t('specialActivityAward.deselectAll')
                  : t('specialActivityAward.selectAll')}
              </Text>
            </View>
          </View>

          <View className='saa-search'>
            <Input
              className='saa-search__input'
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.detail.value)}
              placeholder={t('specialActivityAward.searchPlaceholder')}
            />
          </View>

          <View className='saa-user-list'>
            {usersLoading && users.length === 0 ? (
              <View className='saa-empty'>
                <Text className='saa-empty__text'>
                  {t('specialActivityAward.loading')}
                </Text>
              </View>
            ) : filteredUsers.length === 0 ? (
              <View className='saa-empty'>
                <Text className='saa-empty__text'>
                  {searchQuery.trim()
                    ? t('specialActivityAward.noUsersSearch')
                    : t('specialActivityAward.noUsers')}
                </Text>
              </View>
            ) : (
              filteredUsers.map((user) => {
                const isAwarded = awardedUserIds.has(user.userId);
                const isSelected = selectedIds.has(user.userId);
                const isDuplicate = duplicateUserIds.has(user.userId);
                const itemClass = [
                  'saa-user-item',
                  isSelected && 'saa-user-item--selected',
                  isAwarded && 'saa-user-item--awarded',
                  isDuplicate && 'saa-user-item--duplicate',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <View
                    key={user.userId}
                    className={itemClass}
                    onClick={() => toggleUser(user.userId)}
                  >
                    <View
                      className={`saa-user-item__check${isSelected ? ' saa-user-item__check--checked' : ''}${isAwarded ? ' saa-user-item__check--disabled' : ''}`}
                    >
                      {isSelected && (
                        <Text className='saa-user-item__check-icon'>✓</Text>
                      )}
                    </View>
                    <View className='saa-user-item__info'>
                      <Text className='saa-user-item__nickname'>
                        {user.nickname || '—'}
                      </Text>
                      <Text className='saa-user-item__email'>{user.email}</Text>
                    </View>
                    {isAwarded ? (
                      <Text className='saa-user-item__awarded-tag'>
                        {t('specialActivityAward.awardedBadge')}
                      </Text>
                    ) : (
                      <Text className='saa-user-item__points'>{user.points ?? 0}</Text>
                    )}
                  </View>
                );
              })
            )}
            {usersLastKey && !usersLoading && (
              <View
                className='saa-load-more'
                onClick={() => fetchUsers(true, usersLastKey)}
              >
                <Text className='saa-load-more__text'>
                  {t('specialActivityAward.loadMore')}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Footer with submit button */}
        <View className='saa-footer'>
          <View
            className={`saa-submit-btn${!submittable ? ' saa-submit-btn--disabled' : ''}`}
            onClick={submittable ? handleOpenConfirm : undefined}
          >
            <Text className='saa-submit-btn__text'>
              {t('specialActivityAward.submitButton')} ({selectedIds.size} × {pointsValue || 0})
            </Text>
          </View>
        </View>
      </View>

      {/* Confirm modal */}
      {showConfirm && (
        <View
          className='saa-confirm-overlay'
          onClick={() => !submitting && setShowConfirm(false)}
        >
          <View className='saa-confirm-dialog' onClick={(e) => e.stopPropagation()}>
            <Text className='saa-confirm-dialog__title'>
              {t('specialActivityAward.confirmTitle')}
            </Text>
            <View className='saa-confirm-dialog__info'>
              <View className='saa-confirm-row'>
                <Text className='saa-confirm-row__label'>
                  {t('specialActivityAward.confirmActivity')}
                </Text>
                <Text className='saa-confirm-row__value'>
                  {selectedActivity
                    ? `${selectedActivity.ugName} · ${selectedActivity.topic}`
                    : '—'}
                </Text>
              </View>
              <View className='saa-confirm-row'>
                <Text className='saa-confirm-row__label'>
                  {t('specialActivityAward.confirmAwardDate')}
                </Text>
                <Text className='saa-confirm-row__value'>{awardDate}</Text>
              </View>
              <View className='saa-confirm-row'>
                <Text className='saa-confirm-row__label'>
                  {t('specialActivityAward.confirmAwardTagName')}
                </Text>
                <Text className='saa-confirm-row__value saa-confirm-row__value--tag'>
                  {awardTagName}
                </Text>
              </View>
              <View className='saa-confirm-row'>
                <Text className='saa-confirm-row__label'>
                  {t('specialActivityAward.confirmCount')}
                </Text>
                <Text className='saa-confirm-row__value'>{selectedIds.size}</Text>
              </View>
              <View className='saa-confirm-row'>
                <Text className='saa-confirm-row__label'>
                  {t('specialActivityAward.confirmPointsPerPerson')}
                </Text>
                <Text className='saa-confirm-row__value'>{pointsValue}</Text>
              </View>
              <View className='saa-confirm-row'>
                <Text className='saa-confirm-row__label'>
                  {t('specialActivityAward.confirmTotalPoints')}
                </Text>
                <Text className='saa-confirm-row__value saa-confirm-row__value--highlight'>
                  {totalPoints}
                </Text>
              </View>
            </View>
            <View className='saa-confirm-dialog__actions'>
              <View
                className='saa-confirm-dialog__cancel'
                onClick={() => !submitting && setShowConfirm(false)}
              >
                <Text className='saa-confirm-dialog__cancel-text'>
                  {t('specialActivityAward.confirmCancel')}
                </Text>
              </View>
              <View
                className={`saa-confirm-dialog__confirm${submitting ? ' saa-confirm-dialog__confirm--disabled' : ''}`}
                onClick={submitting ? undefined : handleSubmit}
              >
                <Text className='saa-confirm-dialog__confirm-text'>
                  {submitting
                    ? t('specialActivityAward.submitting')
                    : t('specialActivityAward.confirmSubmit')}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
