import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import './users.scss';

/** User list item returned by the API */
interface UserListItem {
  userId: string;
  email: string;
  nickname: string;
  roles: string[];
  points: number;
  status: 'active' | 'disabled';
  createdAt: string;
}

/** Role filter tab options */
type RoleFilter = 'all' | 'UserGroupLeader' | /* [DISABLED] CommunityBuilder */ 'Speaker' | 'Volunteer' | 'Admin';

const ROLE_FILTER_TABS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: 'all' },
  { key: 'UserGroupLeader', label: 'UserGroupLeader' },
  // [DISABLED] CommunityBuilder
  // { key: 'CommunityBuilder', label: 'CommunityBuilder' },
  { key: 'Speaker', label: 'Speaker' },
  { key: 'Volunteer', label: 'Volunteer' },
  { key: 'Admin', label: 'Admin' },
];

/** Role display config for badges */
const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

/** Regular roles any Admin can assign */
const REGULAR_ROLES = [
  'UserGroupLeader',
  // [DISABLED] CommunityBuilder
  // 'CommunityBuilder',
  'Speaker',
  'Volunteer',
];

/** Role labels for display in the edit modal */
const ROLE_LABELS: Record<string, string> = {
  UserGroupLeader: 'UserGroupLeader',
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: 'CommunityBuilder',
  Speaker: 'Speaker',
  Volunteer: 'Volunteer',
  Admin: 'Admin',
};

export default function AdminUsersPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const adminRoles = useAppStore((s) => s.user?.roles || []);
  const { t } = useTranslation();

  const [users, setUsers] = useState<UserListItem[]>([]);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [loading, setLoading] = useState(true);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<string[]>([]);
  const [submittingRoles, setSubmittingRoles] = useState(false);
  const [roleError, setRoleError] = useState('');
  const [confirmAction, setConfirmAction] = useState<{ type: 'disable' | 'enable' | 'delete'; user: UserListItem } | null>(null);

  const fetchUsers = useCallback(async (filter: RoleFilter, append = false, cursor?: string | null) => {
    if (!append) setLoading(true);
    try {
      let url = '/api/admin/users?pageSize=20';
      if (filter !== 'all') url += `&role=${filter}`;
      if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;

      const res = await request<{ users: UserListItem[]; lastKey?: string }>({ url });
      if (append) {
        setUsers((prev) => [...prev, ...(res.users || [])]);
      } else {
        setUsers(res.users || []);
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
    fetchUsers(roleFilter);
  }, [isAuthenticated, fetchUsers, roleFilter]);

  const handleTabChange = (tab: RoleFilter) => {
    setRoleFilter(tab);
  };

  const handleLoadMore = () => {
    if (lastKey) {
      fetchUsers(roleFilter, true, lastKey);
    }
  };

  const handleSetStatus = async (user: UserListItem, status: 'active' | 'disabled') => {
    try {
      await request({
        url: `/api/admin/users/${user.userId}/status`,
        method: 'PATCH',
        data: { status },
      });
      Taro.showToast({ title: status === 'disabled' ? t('admin.users.disabled') : t('admin.users.enabled'), icon: 'none' });
      setConfirmAction(null);
      fetchUsers(roleFilter);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('common.operationFailed'),
        icon: 'none',
      });
    }
  };

  const handleDelete = async (user: UserListItem) => {
    try {
      await request({
        url: `/api/admin/users/${user.userId}`,
        method: 'DELETE',
      });
      Taro.showToast({ title: t('admin.users.deleted'), icon: 'none' });
      setConfirmAction(null);
      fetchUsers(roleFilter);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('common.deleteFailed'),
        icon: 'none',
      });
    }
  };

  /** Determine which roles the current admin can assign */
  const isSuperAdmin = adminRoles.includes('SuperAdmin');
  const assignableRoles = isSuperAdmin ? [...REGULAR_ROLES, 'Admin'] : REGULAR_ROLES;

  const openRoleEditor = (user: UserListItem) => {
    setEditingUser(user);
    setSelectedRoles([...user.roles]);
    setRoleError('');
  };

  const toggleRole = (role: string) => {
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const handleSubmitRoles = async () => {
    if (!editingUser) return;
    setSubmittingRoles(true);
    setRoleError('');
    try {
      await request({
        url: `/api/admin/users/${editingUser.userId}/roles`,
        method: 'PUT',
        data: { roles: selectedRoles },
      });
      Taro.showToast({ title: t('admin.users.rolesUpdated'), icon: 'none' });
      setEditingUser(null);
      fetchUsers(roleFilter);
    } catch (err) {
      setRoleError(err instanceof RequestError ? err.message : t('admin.users.rolesUpdateFailed'));
    } finally {
      setSubmittingRoles(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-users'>
      {/* Toolbar */}
      <View className='admin-users__toolbar'>
        <View className='admin-users__back' onClick={handleBack}>
          <Text>{t('admin.users.backButton')}</Text>
        </View>
        <Text className='admin-users__title'>{t('admin.users.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Role Filter Tabs */}
      <View className='user-tabs'>
        {ROLE_FILTER_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`user-tabs__item ${roleFilter === tab.key ? 'user-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{tab.key === 'all' ? t('admin.users.filterAll') : tab.label}</Text>
          </View>
        ))}
      </View>

      {/* User List */}
      {loading ? (
        <View className='admin-loading'><Text>{t('admin.users.loading')}</Text></View>
      ) : users.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>👤</Text>
          <Text className='admin-empty__text'>{t('admin.users.noUsers')}</Text>
        </View>
      ) : (
        <View className='user-list'>
          {users.map((user) => (
            <View key={user.userId} className={`user-row ${user.status === 'disabled' ? 'user-row--disabled' : ''}`}>
              <View className='user-row__main'>
                <View className='user-row__info'>
                  <View className='user-row__top'>
                    <Text className='user-row__nickname'>{user.nickname}</Text>
                    <Text className={`user-status user-status--${user.status}`}>
                      {user.status === 'active' ? t('admin.users.statusActive') : t('admin.users.statusDisabled')}
                    </Text>
                  </View>
                  <Text className='user-row__email'>{user.email}</Text>
                  <View className='user-row__roles'>
                    {user.roles.map((role) => {
                      const config = ROLE_CONFIG[role];
                      return (
                        <Text key={role} className={`role-badge ${config?.className || ''}`}>
                          {config?.label || role}
                        </Text>
                      );
                    })}
                    {user.roles.length === 0 && (
                      <Text className='user-row__no-role'>{t('admin.users.noRole')}</Text>
                    )}
                  </View>
                  <View className='user-row__meta'>
                    <Text className='user-row__meta-item'>{t('admin.users.pointsLabel', { count: user.points })}</Text>
                    <Text className='user-row__meta-item'>{t('admin.users.registeredLabel', { time: formatTime(user.createdAt) })}</Text>
                  </View>
                </View>
                <View className='user-row__actions'>
                  <View className='user-row__action-btn user-row__action-btn--edit' onClick={() => openRoleEditor(user)}>
                    <Text>{t('admin.users.editRoles')}</Text>
                  </View>
                  {user.status === 'active' ? (
                    <View
                      className='user-row__action-btn user-row__action-btn--warn'
                      onClick={() => setConfirmAction({ type: 'disable', user })}
                    >
                      <Text>{t('admin.users.disableUser')}</Text>
                    </View>
                  ) : (
                    <View
                      className='user-row__action-btn user-row__action-btn--enable'
                      onClick={() => setConfirmAction({ type: 'enable', user })}
                    >
                      <Text>{t('admin.users.enableUser')}</Text>
                    </View>
                  )}
                  <View
                    className='user-row__action-btn user-row__action-btn--danger'
                    onClick={() => setConfirmAction({ type: 'delete', user })}
                  >
                    <Text>{t('admin.users.deleteUser')}</Text>
                  </View>
                </View>
              </View>
            </View>
          ))}

          {/* Load More */}
          {lastKey && (
            <View className='user-list__load-more' onClick={handleLoadMore}>
              <Text>{t('admin.users.loadMore')}</Text>
            </View>
          )}
        </View>
      )}

      {/* Confirm Action Dialog (placeholder for task 8.3) */}
      {confirmAction && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>
                {confirmAction.type === 'delete' ? t('admin.users.confirmDeleteTitle') : confirmAction.type === 'disable' ? t('admin.users.confirmDisableTitle') : t('admin.users.confirmEnableTitle')}
              </Text>
              <View className='form-modal__close' onClick={() => setConfirmAction(null)}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                {confirmAction.type === 'delete'
                  ? t('admin.users.confirmDeleteMessage', { name: confirmAction.user.nickname })
                  : confirmAction.type === 'disable'
                    ? t('admin.users.confirmDisableMessage', { name: confirmAction.user.nickname })
                    : t('admin.users.confirmEnableMessage', { name: confirmAction.user.nickname })}
              </Text>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={() => setConfirmAction(null)}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`form-modal__submit ${confirmAction.type === 'delete' ? 'form-modal__submit--danger' : ''}`}
                onClick={() => {
                  if (confirmAction.type === 'delete') {
                    handleDelete(confirmAction.user);
                  } else {
                    handleSetStatus(confirmAction.user, confirmAction.type === 'disable' ? 'disabled' : 'active');
                  }
                }}
              >
                <Text>{t('common.confirm')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Role Edit Modal */}
      {editingUser && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('admin.users.editRolesTitle', { name: editingUser.nickname })}</Text>
              <View className='form-modal__close' onClick={() => setEditingUser(null)}><Text>✕</Text></View>
            </View>
            {roleError && (
              <View className='form-modal__error'><Text>{roleError}</Text></View>
            )}
            <View className='form-modal__body'>
              <View className='role-edit-current'>
                <Text className='role-edit-current__label'>{t('admin.users.currentRolesLabel')}</Text>
                <View className='role-edit-current__badges'>
                  {editingUser.roles.length > 0 ? editingUser.roles.map((role) => {
                    const config = ROLE_CONFIG[role];
                    return (
                      <Text key={role} className={`role-badge ${config?.className || ''}`}>
                        {config?.label || role}
                      </Text>
                    );
                  }) : (
                    <Text className='role-edit-current__none'>{t('admin.users.noRolesLabel')}</Text>
                  )}
                </View>
              </View>
              <View className='role-edit-list'>
                <Text className='role-edit-list__label'>{t('admin.users.assignableRolesLabel')}</Text>
                {assignableRoles.map((role) => {
                  const isSelected = selectedRoles.includes(role);
                  return (
                    <View
                      key={role}
                      className={`role-edit-item ${isSelected ? 'role-edit-item--active' : ''}`}
                      onClick={() => toggleRole(role)}
                    >
                      <View className={`role-edit-item__check ${isSelected ? 'role-edit-item__check--on' : ''}`}>
                        <Text>{isSelected ? '✓' : ''}</Text>
                      </View>
                      <Text className='role-edit-item__name'>{ROLE_LABELS[role] || role}</Text>
                    </View>
                  );
                })}
              </View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={() => setEditingUser(null)}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`form-modal__submit ${submittingRoles ? 'form-modal__submit--loading' : ''}`}
                onClick={handleSubmitRoles}
              >
                <Text>{submittingRoles ? t('admin.users.saving') : t('common.save')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
