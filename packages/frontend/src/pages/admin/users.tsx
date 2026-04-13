import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { canManageUser } from './user-permissions';
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
  { key: 'Admin', label: 'Admin' },
  { key: 'UserGroupLeader', label: 'UserGroupLeader' },
  // [DISABLED] CommunityBuilder
  // { key: 'CommunityBuilder', label: 'CommunityBuilder' },
  { key: 'Speaker', label: 'Speaker' },
  { key: 'Volunteer', label: 'Volunteer' },
];

/** Role display config for badges */
const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
};

/** Role display priority — lower index = higher priority */
const ROLE_PRIORITY: Record<string, number> = {
  SuperAdmin: 0,
  Admin: 1,
  UserGroupLeader: 2,
  Speaker: 3,
  Volunteer: 4,
};

/** Sort roles by display priority */
function sortRolesByPriority(roles: string[]): string[] {
  return [...roles].sort((a, b) => (ROLE_PRIORITY[a] ?? 99) - (ROLE_PRIORITY[b] ?? 99));
}

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

  /** Visible roles in the edit modal — includes locked admin roles the target already has */
  const getVisibleRoles = (): string[] => {
    if (!editingUser) return assignableRoles;
    // SuperAdmin on target is always shown as locked (for any caller)
    // Admin on target is shown as locked for non-SuperAdmin callers
    const lockedRoles = editingUser.roles.filter((r) => {
      if (r === 'SuperAdmin') return true; // Always locked
      if (r === 'Admin' && !isSuperAdmin) return true; // Locked for non-SuperAdmin
      return false;
    });
    return [...new Set([...lockedRoles, ...assignableRoles])];
  };

  /** Check if the current user can manage (disable/delete) a target user */
  const canManageUserCheck = (targetRoles: string[]): boolean => {
    return canManageUser(adminRoles, targetRoles);
  };

  const openRoleEditor = (user: UserListItem) => {
    setEditingUser(user);
    setSelectedRoles([...user.roles]);
    setRoleError('');
  };

  /** Check if a role is locked (cannot be toggled via regular role editing) */
  const isRoleLocked = (role: string): boolean => {
    if (!editingUser) return false;
    // SuperAdmin role is ALWAYS locked for everyone — it uses a dedicated transfer flow
    if (role === 'SuperAdmin' && editingUser.roles.includes('SuperAdmin')) return true;
    // Admin role is locked for non-SuperAdmin callers
    if (!isSuperAdmin) {
      const adminLevelRoles = ['Admin', 'SuperAdmin'];
      return adminLevelRoles.includes(role) && editingUser.roles.includes(role);
    }
    return false;
  };

  const toggleRole = (role: string) => {
    if (isRoleLocked(role)) return;
    setSelectedRoles((prev) =>
      prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role],
    );
  };

  const handleSubmitRoles = async () => {
    if (!editingUser) return;
    setSubmittingRoles(true);
    setRoleError('');
    try {
      // Strip SuperAdmin from ALL submissions (it's managed via dedicated transfer flow).
      // For non-SuperAdmin callers, also strip Admin — backend preserves via read-before-write.
      const rolesToSubmit = !isSuperAdmin
        ? selectedRoles.filter((r) => r !== 'Admin' && r !== 'SuperAdmin')
        : selectedRoles.filter((r) => r !== 'SuperAdmin');
      await request({
        url: `/api/admin/users/${editingUser.userId}/roles`,
        method: 'PUT',
        data: { roles: rolesToSubmit },
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
                    {sortRolesByPriority(user.roles).map((role) => {
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
                  {canManageUserCheck(user.roles) && (user.status === 'active' ? (
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
                  ))}
                  {canManageUserCheck(user.roles) && (
                    <View
                      className='user-row__action-btn user-row__action-btn--danger'
                      onClick={() => setConfirmAction({ type: 'delete', user })}
                    >
                      <Text>{t('admin.users.deleteUser')}</Text>
                    </View>
                  )}
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
                  {editingUser.roles.length > 0 ? sortRolesByPriority(editingUser.roles).map((role) => {
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
                {/* Admin roles section (locked for non-SuperAdmin) */}
                {getVisibleRoles().filter((r) => ['Admin', 'SuperAdmin'].includes(r)).length > 0 && (
                  <>
                    {getVisibleRoles()
                      .filter((r) => ['Admin', 'SuperAdmin'].includes(r))
                      .sort((a, b) => (ROLE_PRIORITY[a] ?? 99) - (ROLE_PRIORITY[b] ?? 99))
                      .map((role) => {
                        const isSelected = selectedRoles.includes(role);
                        const locked = isRoleLocked(role);
                        return (
                          <View
                            key={role}
                            className={`role-edit-item ${isSelected ? 'role-edit-item--active' : ''} ${locked ? 'role-edit-item--locked' : ''}`}
                            onClick={() => toggleRole(role)}
                          >
                            <View className={`role-edit-item__check ${isSelected ? 'role-edit-item__check--on' : ''} ${locked ? 'role-edit-item__check--locked' : ''}`}>
                              <Text>{locked ? '🔒' : isSelected ? '✓' : ''}</Text>
                            </View>
                            <Text className='role-edit-item__name'>{ROLE_LABELS[role] || role}</Text>
                            {locked && <Text className='role-edit-item__lock-hint'>{t('admin.users.roleLocked')}</Text>}
                          </View>
                        );
                      })}
                    <View className='role-edit-list__divider' />
                  </>
                )}
                {/* Regular roles section */}
                {getVisibleRoles()
                  .filter((r) => !['Admin', 'SuperAdmin'].includes(r))
                  .sort((a, b) => (ROLE_PRIORITY[a] ?? 99) - (ROLE_PRIORITY[b] ?? 99))
                  .map((role) => {
                    const isSelected = selectedRoles.includes(role);
                    const locked = isRoleLocked(role);
                    return (
                      <View
                        key={role}
                        className={`role-edit-item ${isSelected ? 'role-edit-item--active' : ''} ${locked ? 'role-edit-item--locked' : ''}`}
                        onClick={() => toggleRole(role)}
                      >
                        <View className={`role-edit-item__check ${isSelected ? 'role-edit-item__check--on' : ''} ${locked ? 'role-edit-item__check--locked' : ''}`}>
                          <Text>{locked ? '🔒' : isSelected ? '✓' : ''}</Text>
                        </View>
                        <Text className='role-edit-item__name'>{ROLE_LABELS[role] || role}</Text>
                        {locked && <Text className='role-edit-item__lock-hint'>{t('admin.users.roleLocked')}</Text>}
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
