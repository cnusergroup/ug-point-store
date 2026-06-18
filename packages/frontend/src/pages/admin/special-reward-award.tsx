/**
 * 特殊奖励积分颁发 (Special Reward Award) — SuperAdmin 页面
 *
 * 独立发放通道：写入 `earnTotalSpecialReward` 字段、绑定 RewardTag 元数据
 * （独立 `PointsMall-RewardTags` 表）。**不关联活动**——去重粒度为
 * `(rewardTagName, userId)`（全局，同一奖励标签下每个用户只能拿一次）。
 *
 * 表单字段：
 *   - 颁发日期（默认今天）
 *   - 每人积分（正整数）
 *   - 奖励标签（RewardTagPicker；输入 + 自动补全 + 新建）
 *   - 已选用户列表（分页加载 + 客户端搜索 + 全选切换）
 *
 * 提交流程：
 *   1. 表单校验（canSubmit）+ 客户端预检 BATCH_TOO_LARGE（人数 ≤ 50）
 *   2. ConfirmModal 展示汇总（日期 / 标签 / 人数 / 单人积分 / 合计）
 *   3. POST /api/admin/special-reward-award
 *   4. 成功 → toast + 重置勾选；失败：
 *      - DUPLICATE_REWARD_TAG_DISTRIBUTION → 高亮 duplicateUserIds 行 + toast
 *      - 其它 4xx/5xx → toast 显示后端 message
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
// RewardTag 与 AwardTag 校验规则一致，复用 shared 的纯函数并以 reward 语义别名导出。
import { validateAwardTagName as validateRewardTagName } from '@points-mall/shared';
import RewardTagPicker from '../../components/RewardTagPicker';
import './special-reward-award.scss';

// ---- Types ----

interface UserListItem {
  userId: string;
  email: string;
  nickname: string;
  roles: string[];
  points: number;
  status: 'active' | 'disabled';
}

interface SubmitSuccessResponse {
  distributionId: string;
  successCount: number;
  totalPoints: number;
  rewardTagId: string;
  rewardTagName: string;
}

interface DuplicateErrorPayload {
  duplicateUserIds?: string[];
}

/** 单次提交允许的最大用户数（与后端 BATCH_TOO_LARGE 约束一致：userIds.length * 2 ≤ 100） */
const MAX_USERS_PER_SUBMIT = 50;

// ---- Pure helpers ----

/**
 * filterUsersBySearch — 包含语义
 * 空 query（trim 后）返回原列表（顺序保持）；否则按 nickname / email 的
 * toLowerCase 子串包含过滤。
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
  points: number;
  rewardTagName: string;
  userIds: string[];
  awardDate: string;
}

/**
 * canSubmit — 必填条件合取（不再含活动）
 * 等价于 `Number.isInteger(points) && points >= 1
 *        && validateRewardTagName(rewardTagName).valid && userIds.length >= 1
 *        && /^\d{4}-\d{2}-\d{2}$/.test(awardDate)`
 */
export function canSubmit(state: CanSubmitState): boolean {
  if (!Number.isInteger(state.points) || state.points < 1) return false;
  if (!validateRewardTagName(state.rewardTagName).valid) return false;
  if (!Array.isArray(state.userIds) || state.userIds.length < 1) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(state.awardDate)) return false;
  return true;
}

// ---- Inline SVG icon ----

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

// ---- Page component ----

export default function SpecialRewardAwardPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const { t } = useTranslation();

  // ---- Form state ----
  const [pointsInput, setPointsInput] = useState('');
  const [rewardTagName, setRewardTagName] = useState('');
  const [awardDate, setAwardDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });

  // ---- User list ----
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [usersLastKey, setUsersLastKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // ---- Duplicate highlight (from DUPLICATE_REWARD_TAG_DISTRIBUTION submit error) ----
  const [duplicateUserIds, setDuplicateUserIds] = useState<Set<string>>(new Set());

  // ---- Modal / submission ----
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // ---- Auth gate ----
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

  // ---- Fetch users (paginated) ----
  const fetchUsers = useCallback(async (append = false, cursor?: string | null) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '50' });
      if (append && cursor) params.set('lastKey', cursor);
      const res = await request<{ users: UserListItem[]; lastKey?: string }>({
        url: `/api/admin/users?${params.toString()}`,
      });
      const activeUsers = (res.users || []).filter((u) => u.status === 'active');
      setUsers((prev) => (append ? [...prev, ...activeUsers] : activeUsers));
      setUsersLastKey(res.lastKey ?? null);
    } catch {
      if (!append) setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !isSuperAdmin) return;
    fetchUsers(false);
  }, [isAuthenticated, isSuperAdmin, fetchUsers]);

  // ---- Derived data ----
  const filteredUsers = useMemo(
    () => filterUsersBySearch(users, searchQuery),
    [users, searchQuery],
  );

  const isAllSelected =
    filteredUsers.length > 0 &&
    filteredUsers.every((u) => selectedIds.has(u.userId));

  const pointsValue = (() => {
    const n = parseInt(pointsInput, 10);
    return Number.isInteger(n) && n >= 1 ? n : 0;
  })();

  const submittable = canSubmit({
    points: pointsValue,
    rewardTagName,
    userIds: [...selectedIds],
    awardDate,
  });

  // ---- Handlers ----
  const handleBack = () => goBack('/pages/admin/index');

  const toggleUser = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
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
        filteredUsers.forEach((u) => next.delete(u.userId));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.add(u.userId));
        return next;
      });
    }
  };

  const handleOpenConfirm = () => {
    if (!submittable) return;
    if (selectedIds.size > MAX_USERS_PER_SUBMIT) {
      Taro.showToast({ title: t('specialRewardAward.errorBatchTooLarge'), icon: 'none' });
      return;
    }
    setShowConfirm(true);
  };

  const handleSubmit = async () => {
    if (!submittable || submitting) return;
    setSubmitting(true);
    try {
      const userIds = [...selectedIds];
      const res = await request<SubmitSuccessResponse>({
        url: '/api/admin/special-reward-award',
        method: 'POST',
        data: {
          points: pointsValue,
          rewardTagName,
          userIds,
          awardDate,
        },
      });
      Taro.showToast({
        title: t('specialRewardAward.successToast', {
          count: res.successCount,
          total: res.totalPoints,
        }),
        icon: 'none',
        duration: 3000,
      });
      setShowConfirm(false);
      setSelectedIds(new Set());
      setDuplicateUserIds(new Set());
    } catch (err) {
      if (err instanceof RequestError) {
        if (err.code === 'DUPLICATE_REWARD_TAG_DISTRIBUTION') {
          const data = err.data as DuplicateErrorPayload | undefined;
          const dupIds = Array.isArray(data?.duplicateUserIds) ? data!.duplicateUserIds! : [];
          setDuplicateUserIds(new Set(dupIds));
          setShowConfirm(false);
          Taro.showToast({
            title: t('specialRewardAward.errorDuplicateRewardTagDistribution'),
            icon: 'none',
          });
        } else if (err.code === 'BATCH_TOO_LARGE') {
          Taro.showToast({ title: t('specialRewardAward.errorBatchTooLarge'), icon: 'none' });
        } else if (err.code === 'FORBIDDEN') {
          Taro.showToast({ title: t('specialRewardAward.errorForbidden'), icon: 'none' });
        } else {
          Taro.showToast({ title: err.message, icon: 'none' });
        }
      } else {
        Taro.showToast({ title: t('specialRewardAward.errorDefault'), icon: 'none' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ---- Render ----
  const totalPoints = selectedIds.size * pointsValue;

  return (
    <View className='special-reward-award'>
      {/* Toolbar */}
      <View className='special-reward-award__toolbar'>
        <View className='special-reward-award__back' onClick={handleBack}>
          <Text className='special-reward-award__back-text'>
            {t('specialRewardAward.backButton')}
          </Text>
        </View>
        <Text className='special-reward-award__title'>
          {t('specialRewardAward.title')}
        </Text>
        <View style={{ width: '60px' }} />
      </View>

      <View className='special-reward-award__body'>
        {/* Form card */}
        <View className='sra-form-card'>
          <Text className='sra-form-card__title'>
            {t('specialRewardAward.formCardTitle')}
          </Text>

          {/* Award date */}
          <View className='sra-field'>
            <Text className='sra-field__label'>
              {t('specialRewardAward.awardDateLabel')}
            </Text>
            <Picker
              mode='date'
              value={awardDate}
              onChange={(e) => setAwardDate(e.detail.value)}
            >
              <View className='sra-date-picker'>
                <Text className='sra-date-picker__text'>
                  {awardDate || t('specialRewardAward.pickDateHint')}
                </Text>
                <View className='sra-date-picker__icon'>
                  <CalendarIcon />
                </View>
              </View>
            </Picker>
          </View>

          {/* Points */}
          <View className='sra-field'>
            <Text className='sra-field__label'>
              {t('specialRewardAward.pointsLabel')}
            </Text>
            <Input
              className='sra-input'
              type='number'
              value={pointsInput}
              onInput={(e) => setPointsInput(e.detail.value)}
              placeholder={t('specialRewardAward.pointsPlaceholder')}
            />
            {pointsInput.length > 0 && pointsValue === 0 && (
              <Text className='sra-field__error'>
                {t('specialRewardAward.errorPointsInvalid')}
              </Text>
            )}
          </View>

          {/* RewardTag picker */}
          <View className='sra-field'>
            <Text className='sra-field__label'>
              {t('specialRewardAward.rewardTagLabel')}
            </Text>
            <Text className='sra-field__hint'>
              {t('specialRewardAward.rewardTagHint')}
            </Text>
            <RewardTagPicker value={rewardTagName} onChange={setRewardTagName} />
          </View>
        </View>

        {/* User selection */}
        <View className='sra-user-section'>
          <View className='sra-user-section__header'>
            <Text className='sra-user-section__title'>
              {t('specialRewardAward.userSectionTitle')}
            </Text>
            <Text className='sra-user-section__count'>
              {selectedIds.size} / {filteredUsers.length}
            </Text>
            <View className='sra-select-all' onClick={toggleSelectAll}>
              <Text className='sra-select-all__text'>
                {isAllSelected
                  ? t('specialRewardAward.deselectAll')
                  : t('specialRewardAward.selectAll')}
              </Text>
            </View>
          </View>

          <View className='sra-search'>
            <Input
              className='sra-search__input'
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.detail.value)}
              placeholder={t('specialRewardAward.searchPlaceholder')}
            />
          </View>

          <View className='sra-user-list'>
            {usersLoading && users.length === 0 ? (
              <View className='sra-empty'>
                <Text className='sra-empty__text'>
                  {t('specialRewardAward.loading')}
                </Text>
              </View>
            ) : filteredUsers.length === 0 ? (
              <View className='sra-empty'>
                <Text className='sra-empty__text'>
                  {searchQuery.trim()
                    ? t('specialRewardAward.noUsersSearch')
                    : t('specialRewardAward.noUsers')}
                </Text>
              </View>
            ) : (
              filteredUsers.map((user) => {
                const isSelected = selectedIds.has(user.userId);
                const isDuplicate = duplicateUserIds.has(user.userId);
                const itemClass = [
                  'sra-user-item',
                  isSelected && 'sra-user-item--selected',
                  isDuplicate && 'sra-user-item--duplicate',
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
                      className={`sra-user-item__check${isSelected ? ' sra-user-item__check--checked' : ''}`}
                    >
                      {isSelected && (
                        <Text className='sra-user-item__check-icon'>✓</Text>
                      )}
                    </View>
                    <View className='sra-user-item__info'>
                      <Text className='sra-user-item__nickname'>
                        {user.nickname || '—'}
                      </Text>
                      <Text className='sra-user-item__email'>{user.email}</Text>
                    </View>
                    <Text className='sra-user-item__points'>{user.points ?? 0}</Text>
                  </View>
                );
              })
            )}
            {usersLastKey && !usersLoading && (
              <View
                className='sra-load-more'
                onClick={() => fetchUsers(true, usersLastKey)}
              >
                <Text className='sra-load-more__text'>
                  {t('specialRewardAward.loadMore')}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Footer with submit button */}
        <View className='sra-footer'>
          <View
            className={`sra-submit-btn${!submittable ? ' sra-submit-btn--disabled' : ''}`}
            onClick={submittable ? handleOpenConfirm : undefined}
          >
            <Text className='sra-submit-btn__text'>
              {t('specialRewardAward.submitButton')} ({selectedIds.size} × {pointsValue || 0})
            </Text>
          </View>
        </View>
      </View>

      {/* Confirm modal */}
      {showConfirm && (
        <View
          className='sra-confirm-overlay'
          onClick={() => !submitting && setShowConfirm(false)}
        >
          <View className='sra-confirm-dialog' onClick={(e) => e.stopPropagation()}>
            <Text className='sra-confirm-dialog__title'>
              {t('specialRewardAward.confirmTitle')}
            </Text>
            <View className='sra-confirm-dialog__info'>
              <View className='sra-confirm-row'>
                <Text className='sra-confirm-row__label'>
                  {t('specialRewardAward.confirmAwardDate')}
                </Text>
                <Text className='sra-confirm-row__value'>{awardDate}</Text>
              </View>
              <View className='sra-confirm-row'>
                <Text className='sra-confirm-row__label'>
                  {t('specialRewardAward.confirmRewardTagName')}
                </Text>
                <Text className='sra-confirm-row__value sra-confirm-row__value--tag'>
                  {rewardTagName}
                </Text>
              </View>
              <View className='sra-confirm-row'>
                <Text className='sra-confirm-row__label'>
                  {t('specialRewardAward.confirmCount')}
                </Text>
                <Text className='sra-confirm-row__value'>{selectedIds.size}</Text>
              </View>
              <View className='sra-confirm-row'>
                <Text className='sra-confirm-row__label'>
                  {t('specialRewardAward.confirmPointsPerPerson')}
                </Text>
                <Text className='sra-confirm-row__value'>{pointsValue}</Text>
              </View>
              <View className='sra-confirm-row'>
                <Text className='sra-confirm-row__label'>
                  {t('specialRewardAward.confirmTotalPoints')}
                </Text>
                <Text className='sra-confirm-row__value sra-confirm-row__value--highlight'>
                  {totalPoints}
                </Text>
              </View>
            </View>
            <View className='sra-confirm-dialog__actions'>
              <View
                className='sra-confirm-dialog__cancel'
                onClick={() => !submitting && setShowConfirm(false)}
              >
                <Text className='sra-confirm-dialog__cancel-text'>
                  {t('specialRewardAward.confirmCancel')}
                </Text>
              </View>
              <View
                className={`sra-confirm-dialog__confirm${submitting ? ' sra-confirm-dialog__confirm--disabled' : ''}`}
                onClick={submitting ? undefined : handleSubmit}
              >
                <Text className='sra-confirm-dialog__confirm-text'>
                  {submitting
                    ? t('specialRewardAward.submitting')
                    : t('specialRewardAward.confirmSubmit')}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
