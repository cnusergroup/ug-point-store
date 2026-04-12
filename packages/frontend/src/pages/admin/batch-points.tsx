import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import './batch-points.scss';

/** User list item returned by the admin users API */
interface UserListItem {
  userId: string;
  email: string;
  nickname: string;
  roles: string[];
  points: number;
  status: 'active' | 'disabled';
  createdAt: string;
}

/** Target role options for batch distribution */
type TargetRole = 'UserGroupLeader' | 'Speaker' | 'Volunteer';

const ROLE_TABS: { key: TargetRole; labelKey: string; className: string }[] = [
  { key: 'UserGroupLeader', labelKey: 'batchPoints.page.roleLeader', className: 'role-badge--leader' },
  { key: 'Speaker', labelKey: 'batchPoints.page.roleSpeaker', className: 'role-badge--speaker' },
  { key: 'Volunteer', labelKey: 'batchPoints.page.roleVolunteer', className: 'role-badge--volunteer' },
];

export default function BatchPointsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();

  // Role filter
  const [targetRole, setTargetRole] = useState<TargetRole>('UserGroupLeader');

  // User list
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Search
  const [searchQuery, setSearchQuery] = useState('');

  // Selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Form
  const [pointsInput, setPointsInput] = useState('');
  const [reasonInput, setReasonInput] = useState('');

  // Confirm modal
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Fetch users for the selected role
  const fetchUsers = useCallback(async (role: TargetRole, append = false, cursor?: string | null) => {
    if (!append) setLoading(true);
    try {
      let url = `/api/admin/users?role=${role}&pageSize=20`;
      if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;

      const res = await request<{ users: UserListItem[]; lastKey?: string }>({ url });
      const activeUsers = (res.users || []).filter((u) => u.status === 'active');
      if (append) {
        setUsers((prev) => [...prev, ...activeUsers]);
      } else {
        setUsers(activeUsers);
      }
      setLastKey(res.lastKey || null);
    } catch {
      if (!append) setUsers([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    // Reset selection and search when role changes
    setSelectedIds(new Set());
    setSearchQuery('');
    fetchUsers(targetRole);
  }, [isAuthenticated, fetchUsers, targetRole]);

  // Client-side fuzzy search filter
  const filteredUsers = useMemo(() => {
    if (!searchQuery.trim()) return users;
    const q = searchQuery.trim().toLowerCase();
    return users.filter(
      (u) => u.nickname.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [users, searchQuery]);

  const handleTabChange = (role: TargetRole) => {
    setTargetRole(role);
  };

  const handleLoadMore = () => {
    if (lastKey) {
      fetchUsers(targetRole, true, lastKey);
    }
  };

  // Selection handlers
  const toggleUser = (userId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) {
        next.delete(userId);
      } else {
        next.add(userId);
      }
      return next;
    });
  };

  const isAllSelected = filteredUsers.length > 0 && filteredUsers.every((u) => selectedIds.has(u.userId));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      // Deselect all filtered users
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.delete(u.userId));
        return next;
      });
    } else {
      // Select all filtered users
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.add(u.userId));
        return next;
      });
    }
  };

  // Validation
  const pointsValue = Number(pointsInput);
  const isPointsValid = Number.isInteger(pointsValue) && pointsValue >= 1;
  const isReasonValid = reasonInput.trim().length >= 1 && reasonInput.trim().length <= 200;
  const canSubmit = selectedIds.size > 0 && isPointsValid && isReasonValid;

  // Submit
  const handleOpenConfirm = () => {
    if (!canSubmit) return;
    setShowConfirm(true);
  };

  const handleCloseConfirm = () => {
    setShowConfirm(false);
  };

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    try {
      await request({
        url: '/api/admin/batch-points',
        method: 'POST',
        data: {
          userIds: Array.from(selectedIds),
          points: pointsValue,
          reason: reasonInput.trim(),
          targetRole,
        },
      });
      Taro.showToast({ title: t('batchPoints.page.successToast'), icon: 'none' });
      // Reset form
      setSelectedIds(new Set());
      setPointsInput('');
      setReasonInput('');
      setShowConfirm(false);
      // Refresh user list to show updated points
      fetchUsers(targetRole);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('batchPoints.page.errorToast'),
        icon: 'none',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  const currentRoleTab = ROLE_TABS.find((t) => t.key === targetRole);

  return (
    <View className='batch-points'>
      {/* Toolbar */}
      <View className='batch-points__toolbar'>
        <View className='batch-points__back' onClick={handleBack}>
          <Text>{t('batchPoints.page.backButton')}</Text>
        </View>
        <Text className='batch-points__title'>{t('batchPoints.page.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Role Filter Tabs */}
      <View className='bp-tabs'>
        {ROLE_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`bp-tabs__item ${targetRole === tab.key ? 'bp-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{t(tab.labelKey)}</Text>
          </View>
        ))}
      </View>

      {/* Search Box */}
      <View className='bp-search'>
        <Input
          className='bp-search__input'
          value={searchQuery}
          onInput={(e) => setSearchQuery(e.detail.value)}
          placeholder={t('batchPoints.page.searchPlaceholder')}
        />
      </View>

      {/* Select All Bar */}
      {!loading && filteredUsers.length > 0 && (
        <View className='bp-select-bar'>
          <View className='bp-select-bar__left' onClick={toggleSelectAll}>
            <View className={`bp-checkbox ${isAllSelected ? 'bp-checkbox--checked' : ''}`}>
              <Text>{isAllSelected ? '✓' : ''}</Text>
            </View>
            <Text className='bp-select-bar__label'>{t('batchPoints.page.selectAll')}</Text>
          </View>
          <Text className='bp-select-bar__count'>
            {t('batchPoints.page.selectedCount', { count: selectedIds.size })}
          </Text>
        </View>
      )}

      {/* User List */}
      {loading ? (
        <View className='admin-loading'><Text>{t('batchPoints.page.loading')}</Text></View>
      ) : filteredUsers.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>👤</Text>
          <Text className='admin-empty__text'>
            {searchQuery.trim() ? t('batchPoints.page.noUsersSearch') : t('batchPoints.page.noUsersRole')}
          </Text>
        </View>
      ) : (
        <View className='bp-user-list'>
          {filteredUsers.map((user) => {
            const isSelected = selectedIds.has(user.userId);
            return (
              <View
                key={user.userId}
                className={`bp-user-row ${isSelected ? 'bp-user-row--selected' : ''}`}
                onClick={() => toggleUser(user.userId)}
              >
                <View className={`bp-checkbox ${isSelected ? 'bp-checkbox--checked' : ''}`}>
                  <Text>{isSelected ? '✓' : ''}</Text>
                </View>
                <View className='bp-user-row__info'>
                  <View className='bp-user-row__top'>
                    <Text className='bp-user-row__nickname'>{user.nickname}</Text>
                  </View>
                  <Text className='bp-user-row__email'>{user.email}</Text>
                </View>
                <Text className='bp-user-row__points'>{user.points} {t('batchPoints.page.pointsUnit')}</Text>
              </View>
            );
          })}

          {/* Load More */}
          {lastKey && (
            <View className='bp-user-list__load-more' onClick={handleLoadMore}>
              <Text>{t('common.loadMore')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Form Section */}
      <View className='bp-form'>
        <View className='bp-form__field'>
          <Text className='bp-form__label'>{t('batchPoints.page.pointsLabel')}</Text>
          <Input
            className='bp-form__input'
            type='number'
            value={pointsInput}
            onInput={(e) => setPointsInput(e.detail.value)}
            placeholder={t('batchPoints.page.pointsPlaceholder')}
          />
        </View>
        <View className='bp-form__field'>
          <Text className='bp-form__label'>{t('batchPoints.page.reasonLabel')}</Text>
          <Input
            className='bp-form__input'
            value={reasonInput}
            onInput={(e) => {
              if (e.detail.value.length <= 200) {
                setReasonInput(e.detail.value);
              }
            }}
            placeholder={t('batchPoints.page.reasonPlaceholder')}
            maxlength={200}
          />
          <Text className='bp-form__char-count'>{reasonInput.length}/200</Text>
        </View>
        <View
          className={`bp-form__submit ${!canSubmit ? 'bp-form__submit--disabled' : ''}`}
          onClick={handleOpenConfirm}
        >
          <Text>{t('batchPoints.page.submitButton')}</Text>
        </View>
      </View>

      {/* Confirm Modal */}
      {showConfirm && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('batchPoints.page.confirmTitle')}</Text>
              <View className='form-modal__close' onClick={handleCloseConfirm}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmTargetRole')}</Text>
                <Text className={`role-badge ${currentRoleTab?.className || ''}`}>
                  {currentRoleTab ? t(currentRoleTab.labelKey) : targetRole}
                </Text>
              </View>
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmSelectedCount')}</Text>
                <Text className='bp-confirm__value'>{selectedIds.size}</Text>
              </View>
              {/* Selected user names */}
              <View className='bp-confirm__names'>
                {filteredUsers
                  .filter((u) => selectedIds.has(u.userId))
                  .map((u) => (
                    <Text key={u.userId} className='bp-confirm__name-tag'>{u.nickname}</Text>
                  ))}
              </View>
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmPointsPerPerson')}</Text>
                <Text className='bp-confirm__value bp-confirm__value--highlight'>{pointsValue}</Text>
              </View>
              <View className='bp-confirm__row'>
                <Text className='bp-confirm__label'>{t('batchPoints.page.confirmTotalPoints')}</Text>
                <Text className='bp-confirm__value bp-confirm__value--highlight'>
                  {selectedIds.size * pointsValue}
                </Text>
              </View>
              <View className='bp-confirm__reason'>{reasonInput.trim()}</View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={handleCloseConfirm}>
                <Text>{t('batchPoints.page.confirmCancel')}</Text>
              </View>
              <View
                className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleSubmit}
              >
                <Text>{submitting ? t('batchPoints.page.submitting') : t('batchPoints.page.confirmSubmit')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
