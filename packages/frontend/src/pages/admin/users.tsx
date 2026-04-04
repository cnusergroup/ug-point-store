import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
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
type RoleFilter = 'all' | 'UserGroupLeader' | 'CommunityBuilder' | 'Speaker' | 'Volunteer' | 'Admin';

const ROLE_FILTER_TABS: { key: RoleFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'UserGroupLeader', label: 'UserGroupLeader' },
  { key: 'CommunityBuilder', label: 'CommunityBuilder' },
  { key: 'Speaker', label: 'Speaker' },
  { key: 'Volunteer', label: 'Volunteer' },
  { key: 'Admin', label: 'Admin' },
];

/** Role display config for badges */
const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

const STATUS_LABELS: Record<string, string> = {
  active: '正常',
  disabled: '已停用',
};

/** Regular roles any Admin can assign */
const REGULAR_ROLES = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'];

/** Role labels for display in the edit modal */
const ROLE_LABELS: Record<string, string> = {
  UserGroupLeader: 'UserGroupLeader',
  CommunityBuilder: 'CommunityBuilder',
  Speaker: 'Speaker',
  Volunteer: 'Volunteer',
  Admin: 'Admin',
};

export default function AdminUsersPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const adminRoles = useAppStore((s) => s.user?.roles || []);

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
      Taro.showToast({ title: status === 'disabled' ? '已停用' : '已启用', icon: 'none' });
      setConfirmAction(null);
      fetchUsers(roleFilter);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : '操作失败',
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
      Taro.showToast({ title: '已删除', icon: 'none' });
      setConfirmAction(null);
      fetchUsers(roleFilter);
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : '删除失败',
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
      Taro.showToast({ title: '角色已更新', icon: 'none' });
      setEditingUser(null);
      fetchUsers(roleFilter);
    } catch (err) {
      setRoleError(err instanceof RequestError ? err.message : '角色更新失败');
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
          <Text>‹ 返回</Text>
        </View>
        <Text className='admin-users__title'>用户管理</Text>
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
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* User List */}
      {loading ? (
        <View className='admin-loading'><Text>加载中...</Text></View>
      ) : users.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>👤</Text>
          <Text className='admin-empty__text'>暂无用户记录</Text>
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
                      {STATUS_LABELS[user.status] || user.status}
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
                      <Text className='user-row__no-role'>无角色</Text>
                    )}
                  </View>
                  <View className='user-row__meta'>
                    <Text className='user-row__meta-item'>积分: {user.points}</Text>
                    <Text className='user-row__meta-item'>注册: {formatTime(user.createdAt)}</Text>
                  </View>
                </View>
                <View className='user-row__actions'>
                  <View className='user-row__action-btn user-row__action-btn--edit' onClick={() => openRoleEditor(user)}>
                    <Text>编辑角色</Text>
                  </View>
                  {user.status === 'active' ? (
                    <View
                      className='user-row__action-btn user-row__action-btn--warn'
                      onClick={() => setConfirmAction({ type: 'disable', user })}
                    >
                      <Text>停用</Text>
                    </View>
                  ) : (
                    <View
                      className='user-row__action-btn user-row__action-btn--enable'
                      onClick={() => setConfirmAction({ type: 'enable', user })}
                    >
                      <Text>启用</Text>
                    </View>
                  )}
                  <View
                    className='user-row__action-btn user-row__action-btn--danger'
                    onClick={() => setConfirmAction({ type: 'delete', user })}
                  >
                    <Text>删除</Text>
                  </View>
                </View>
              </View>
            </View>
          ))}

          {/* Load More */}
          {lastKey && (
            <View className='user-list__load-more' onClick={handleLoadMore}>
              <Text>加载更多</Text>
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
                {confirmAction.type === 'delete' ? '确认删除' : confirmAction.type === 'disable' ? '确认停用' : '确认启用'}
              </Text>
              <View className='form-modal__close' onClick={() => setConfirmAction(null)}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                {confirmAction.type === 'delete'
                  ? `确定要删除用户「${confirmAction.user.nickname}」吗？此操作不可恢复。`
                  : confirmAction.type === 'disable'
                    ? `确定要停用用户「${confirmAction.user.nickname}」吗？停用后该用户将无法登录。`
                    : `确定要启用用户「${confirmAction.user.nickname}」吗？`}
              </Text>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={() => setConfirmAction(null)}>
                <Text>取消</Text>
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
                <Text>确认</Text>
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
              <Text className='form-modal__title'>编辑角色 - {editingUser.nickname}</Text>
              <View className='form-modal__close' onClick={() => setEditingUser(null)}><Text>✕</Text></View>
            </View>
            {roleError && (
              <View className='form-modal__error'><Text>{roleError}</Text></View>
            )}
            <View className='form-modal__body'>
              <View className='role-edit-current'>
                <Text className='role-edit-current__label'>当前角色</Text>
                <View className='role-edit-current__badges'>
                  {editingUser.roles.length > 0 ? editingUser.roles.map((role) => {
                    const config = ROLE_CONFIG[role];
                    return (
                      <Text key={role} className={`role-badge ${config?.className || ''}`}>
                        {config?.label || role}
                      </Text>
                    );
                  }) : (
                    <Text className='role-edit-current__none'>无角色</Text>
                  )}
                </View>
              </View>
              <View className='role-edit-list'>
                <Text className='role-edit-list__label'>可分配角色</Text>
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
                <Text>取消</Text>
              </View>
              <View
                className={`form-modal__submit ${submittingRoles ? 'form-modal__submit--loading' : ''}`}
                onClick={handleSubmitRoles}
              >
                <Text>{submittingRoles ? '保存中...' : '保存'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
