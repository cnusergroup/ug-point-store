import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import './quarterly-award.scss';

interface UserListItem {
  userId: string;
  email: string;
  nickname: string;
  roles: string[];
  points: number;
  status: 'active' | 'disabled';
}

type TargetRole = 'UserGroupLeader' | 'Speaker' | 'Volunteer';

const ROLE_TABS: { key: TargetRole; labelKey: string; className: string }[] = [
  { key: 'UserGroupLeader', labelKey: 'batchPoints.page.roleLeader', className: 'role-badge--leader' },
  { key: 'Speaker', labelKey: 'batchPoints.page.roleSpeaker', className: 'role-badge--speaker' },
  { key: 'Volunteer', labelKey: 'batchPoints.page.roleVolunteer', className: 'role-badge--volunteer' },
];

export default function QuarterlyAwardPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const { t } = useTranslation();

  const [targetRole, setTargetRole] = useState<TargetRole>('Speaker');
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pointsInput, setPointsInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');
  const [awardDate, setAwardDate] = useState<string>(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const fetchUsers = useCallback(async (role: TargetRole, reset = false, lk?: string | null) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ role, pageSize: '50' });
      if (!reset && lk) params.set('lastKey', lk);
      const res = await request<{ users: UserListItem[]; lastKey?: string }>({
        url: `/api/admin/users?${params.toString()}`,
      });
      const newUsers = res.users || [];
      setUsers((prev) => (reset ? newUsers : [...prev, ...newUsers]));
      setLastKey(res.lastKey ?? null);
    } catch {
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    if (!isSuperAdmin) {
      Taro.redirectTo({ url: '/pages/admin/index' });
      return;
    }
    fetchUsers(targetRole, true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, isSuperAdmin, targetRole]);

  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.toLowerCase();
    return users.filter(
      (u) =>
        u.nickname?.toLowerCase().includes(q) ||
        u.email?.toLowerCase().includes(q),
    );
  }, [users, searchQuery]);

  const toggleUser = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedIds.size === filteredUsers.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredUsers.map((u) => u.userId)));
    }
  };

  const handleRoleChange = (role: TargetRole) => {
    setTargetRole(role);
    setSelectedIds(new Set());
    setUsers([]);
    setLastKey(null);
  };

  const canSubmit =
    selectedIds.size > 0 &&
    pointsInput.trim() !== '' &&
    parseInt(pointsInput, 10) >= 1 &&
    reasonInput.trim().length >= 1 &&
    reasonInput.trim().length <= 200 &&
    /^\d{4}-\d{2}-\d{2}$/.test(awardDate);

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      const res = await request<{ distributionId: string; successCount: number; totalPoints: number }>({
        url: '/api/admin/quarterly-award',
        method: 'POST',
        data: {
          userIds: [...selectedIds],
          points: parseInt(pointsInput, 10),
          reason: reasonInput.trim(),
          targetRole,
          awardDate,
        },
      });
      Taro.showToast({
        title: `发放成功：${res.successCount} 人，共 ${res.totalPoints} 积分`,
        icon: 'none',
        duration: 3000,
      });
      setShowConfirm(false);
      setSelectedIds(new Set());
      setPointsInput('');
      setReasonInput('');
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: '发放失败，请重试', icon: 'none' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className='quarterly-award'>
      {/* Toolbar */}
      <View className='quarterly-award__toolbar'>
        <View className='quarterly-award__back' onClick={() => goBack('/pages/admin/index')}>
          <Text className='quarterly-award__back-text'>‹ 返回</Text>
        </View>
        <Text className='quarterly-award__title'>季度贡献奖发放</Text>
        <View style={{ width: '60px' }} />
      </View>

      <View className='quarterly-award__body'>
        {/* Form card */}
        <View className='qa-form-card'>
          <Text className='qa-form-card__title'>发放配置</Text>

          {/* Date picker */}
          <View className='qa-field'>
            <Text className='qa-field__label'>发放日期</Text>
            <Picker
              mode='date'
              value={awardDate}
              onChange={(e) => setAwardDate(e.detail.value)}
            >
              <View className='qa-date-picker'>
                <Text className='qa-date-picker__text'>{awardDate || '请选择日期'}</Text>
                <Text className='qa-date-picker__icon'>📅</Text>
              </View>
            </Picker>
          </View>

          {/* Role selector */}
          <View className='qa-field'>
            <Text className='qa-field__label'>获奖身份</Text>
            <View className='qa-role-tabs'>
              {ROLE_TABS.map((tab) => (
                <View
                  key={tab.key}
                  className={`qa-role-tab${targetRole === tab.key ? ' qa-role-tab--active' : ''}`}
                  onClick={() => handleRoleChange(tab.key)}
                >
                  <Text className='qa-role-tab__text'>{t(tab.labelKey as any)}</Text>
                </View>
              ))}
            </View>
          </View>

          {/* Points input */}
          <View className='qa-field'>
            <Text className='qa-field__label'>积分数量</Text>
            <Input
              className='qa-input'
              type='number'
              value={pointsInput}
              onInput={(e) => setPointsInput(e.detail.value)}
              placeholder='请输入积分数量（正整数）'
            />
          </View>

          {/* Reason input */}
          <View className='qa-field'>
            <Text className='qa-field__label'>发放原因</Text>
            <Input
              className='qa-input'
              value={reasonInput}
              onInput={(e) => setReasonInput(e.detail.value)}
              placeholder='请输入发放原因（1~200字）'
              maxlength={200}
            />
            <Text className='qa-field__count'>{reasonInput.length}/200</Text>
          </View>
        </View>

        {/* User selection */}
        <View className='qa-user-section'>
          <View className='qa-user-section__header'>
            <Text className='qa-user-section__title'>
              选择获奖用户（{selectedIds.size} / {filteredUsers.length}）
            </Text>
            <View className='qa-select-all' onClick={toggleAll}>
              <Text className='qa-select-all__text'>
                {selectedIds.size === filteredUsers.length && filteredUsers.length > 0 ? '取消全选' : '全选'}
              </Text>
            </View>
          </View>

          {/* Search */}
          <View className='qa-search'>
            <Input
              className='qa-search__input'
              value={searchQuery}
              onInput={(e) => setSearchQuery(e.detail.value)}
              placeholder='搜索昵称或邮箱...'
            />
          </View>

          {/* User list */}
          <View className='qa-user-list'>
            {loading && users.length === 0 ? (
              <View className='qa-empty'><Text className='qa-empty__text'>加载中...</Text></View>
            ) : filteredUsers.length === 0 ? (
              <View className='qa-empty'><Text className='qa-empty__text'>暂无符合条件的用户</Text></View>
            ) : (
              filteredUsers.map((user) => {
                const isSelected = selectedIds.has(user.userId);
                return (
                  <View
                    key={user.userId}
                    className={`qa-user-item${isSelected ? ' qa-user-item--selected' : ''}`}
                    onClick={() => toggleUser(user.userId)}
                  >
                    <View className={`qa-user-item__check${isSelected ? ' qa-user-item__check--checked' : ''}`}>
                      {isSelected && <Text className='qa-user-item__check-icon'>✓</Text>}
                    </View>
                    <View className='qa-user-item__info'>
                      <Text className='qa-user-item__nickname'>{user.nickname || '—'}</Text>
                      <Text className='qa-user-item__email'>{user.email}</Text>
                    </View>
                    <Text className='qa-user-item__points'>{user.points ?? 0} 分</Text>
                  </View>
                );
              })
            )}
            {lastKey && !loading && (
              <View className='qa-load-more' onClick={() => fetchUsers(targetRole, false, lastKey)}>
                <Text className='qa-load-more__text'>加载更多</Text>
              </View>
            )}
          </View>
        </View>

        {/* Submit button */}
        <View
          className={`qa-submit-btn${!canSubmit ? ' qa-submit-btn--disabled' : ''}`}
          onClick={canSubmit ? () => setShowConfirm(true) : undefined}
        >
          <Text className='qa-submit-btn__text'>
            确认发放（{selectedIds.size} 人 × {pointsInput || '0'} 积分）
          </Text>
        </View>
      </View>

      {/* Confirm modal */}
      {showConfirm && (
        <View className='qa-confirm-overlay' onClick={() => !submitting && setShowConfirm(false)}>
          <View className='qa-confirm-dialog' onClick={(e) => e.stopPropagation()}>
            <Text className='qa-confirm-dialog__title'>确认发放季度贡献奖</Text>
            <View className='qa-confirm-dialog__info'>
              <View className='qa-confirm-row'>
                <Text className='qa-confirm-row__label'>日期</Text>
                <Text className='qa-confirm-row__value'>{awardDate}</Text>
              </View>
              <View className='qa-confirm-row'>
                <Text className='qa-confirm-row__label'>身份</Text>
                <Text className='qa-confirm-row__value'>{t(`batchPoints.page.role${targetRole.replace('UserGroup', '')}` as any)}</Text>
              </View>
              <View className='qa-confirm-row'>
                <Text className='qa-confirm-row__label'>人数</Text>
                <Text className='qa-confirm-row__value'>{selectedIds.size} 人</Text>
              </View>
              <View className='qa-confirm-row'>
                <Text className='qa-confirm-row__label'>每人积分</Text>
                <Text className='qa-confirm-row__value'>{pointsInput} 分</Text>
              </View>
              <View className='qa-confirm-row'>
                <Text className='qa-confirm-row__label'>合计积分</Text>
                <Text className='qa-confirm-row__value qa-confirm-row__value--highlight'>
                  {selectedIds.size * parseInt(pointsInput || '0', 10)} 分
                </Text>
              </View>
              <View className='qa-confirm-row'>
                <Text className='qa-confirm-row__label'>原因</Text>
                <Text className='qa-confirm-row__value'>{reasonInput}</Text>
              </View>
            </View>
            <View className='qa-confirm-dialog__actions'>
              <View
                className='qa-confirm-dialog__cancel'
                onClick={() => !submitting && setShowConfirm(false)}
              >
                <Text className='qa-confirm-dialog__cancel-text'>取消</Text>
              </View>
              <View
                className={`qa-confirm-dialog__confirm${submitting ? ' qa-confirm-dialog__confirm--disabled' : ''}`}
                onClick={submitting ? undefined : handleSubmit}
              >
                <Text className='qa-confirm-dialog__confirm-text'>
                  {submitting ? '发放中...' : '确认发放'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
