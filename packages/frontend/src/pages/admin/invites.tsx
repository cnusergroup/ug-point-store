import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import './invites.scss';

interface InviteRecord {
  token: string;
  role: string;
  status: 'pending' | 'used' | 'expired';
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

interface NewInvite {
  token: string;
  link: string;
  role: string;
  expiresAt: string;
}

type StatusFilter = 'all' | 'pending' | 'used' | 'expired';

const ROLE_OPTIONS = [
  { value: 'UserGroupLeader', label: 'Leader', className: 'role-badge--leader' },
  { value: 'CommunityBuilder', label: 'Builder', className: 'role-badge--builder' },
  { value: 'Speaker', label: 'Speaker', className: 'role-badge--speaker' },
  { value: 'Volunteer', label: 'Volunteer', className: 'role-badge--volunteer' },
];

const ROLE_LABELS: Record<string, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待使用',
  used: '已使用',
  expired: '已过期',
};

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'pending', label: 'pending' },
  { key: 'used', label: 'used' },
  { key: 'expired', label: 'expired' },
];

export default function AdminInvitesPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [showForm, setShowForm] = useState(false);
  const [formRole, setFormRole] = useState('UserGroupLeader');
  const [formCount, setFormCount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const [newInvites, setNewInvites] = useState<NewInvite[]>([]);

  const fetchInvites = useCallback(async (filter: StatusFilter) => {
    setLoading(true);
    try {
      const url = filter === 'all' ? '/api/admin/invites' : `/api/admin/invites?status=${filter}`;
      const res = await request<{ invites: InviteRecord[] }>({ url });
      setInvites(res.invites || []);
    } catch {
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchInvites(statusFilter);
  }, [isAuthenticated, fetchInvites, statusFilter]);

  const handleTabChange = (tab: StatusFilter) => {
    setStatusFilter(tab);
  };

  const openForm = () => {
    setFormRole('UserGroupLeader');
    setFormCount('');
    setFormError('');
    setNewInvites([]);
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError('');
    setNewInvites([]);
  };

  const handleGenerate = async () => {
    const count = Number(formCount);
    if (!count || count < 1 || count > 100) {
      setFormError('请输入 1~100 之间的数量');
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const res = await request<{ invites: NewInvite[] }>({
        url: '/api/admin/invites/batch',
        method: 'POST',
        data: { count, role: formRole },
      });
      setNewInvites(res.invites || []);
      fetchInvites(statusFilter);
    } catch (err) {
      setFormError(err instanceof RequestError ? err.message : '生成失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (token: string) => {
    try {
      await request({ url: `/api/admin/invites/${token}/revoke`, method: 'PATCH' });
      fetchInvites(statusFilter);
      Taro.showToast({ title: '已撤销', icon: 'none' });
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : '撤销失败',
        icon: 'none',
      });
    }
  };

  /** 构建邀请注册完整 URL */
  const buildInviteLink = (token: string): string => {
    const env = Taro.getEnv();
    if (env === Taro.ENV_TYPE.WEB && typeof window !== 'undefined') {
      // H5: 基于当前 origin + hash 路由构建
      const origin = window.location.origin;
      const basePath = window.location.pathname || '/';
      return `${origin}${basePath}#/pages/register/index?token=${token}`;
    }
    // 小程序或其他环境：使用环境变量
    const base = process.env.TARO_APP_REGISTER_BASE_URL || '';
    return `${base}?token=${token}`;
  };

  const copyLink = (link: string) => {
    Taro.setClipboardData({ data: link });
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-invites'>
      <View className='admin-invites__toolbar'>
        <View className='admin-invites__back' onClick={handleBack}>
          <Text>‹ 返回</Text>
        </View>
        <Text className='admin-invites__title'>邀请管理</Text>
        <View className='admin-invites__gen-btn' onClick={openForm}>
          <Text>+ 生成邀请链接</Text>
        </View>
      </View>

      {/* Status Filter Tabs */}
      <View className='invite-tabs'>
        {STATUS_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`invite-tabs__item ${statusFilter === tab.key ? 'invite-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* Generate Form Modal */}
      {showForm && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>生成邀请链接</Text>
              <View className='form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {formError && (
              <View className='form-modal__error'><Text>{formError}</Text></View>
            )}
            <View className='form-modal__body'>
              <View className='form-field'>
                <Text className='form-field__label'>目标角色</Text>
                <View className='invite-role-select'>
                  {ROLE_OPTIONS.map((opt) => (
                    <View
                      key={opt.value}
                      className={`invite-role-select__item ${formRole === opt.value ? 'invite-role-select__item--active' : ''}`}
                      onClick={() => setFormRole(opt.value)}
                    >
                      <Text className={`role-badge ${opt.className}`}>{opt.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>生成数量（1~100）</Text>
                <Input
                  className='form-field__input'
                  type='number'
                  value={formCount}
                  onInput={(e) => setFormCount(e.detail.value)}
                  placeholder='例如: 10'
                />
              </View>
            </View>

            {/* New invites result list */}
            {newInvites.length > 0 && (
              <View className='new-invites-list'>
                <Text className='new-invites-list__title'>已生成 {newInvites.length} 条邀请链接</Text>
                {newInvites.map((inv) => (
                  <View key={inv.token} className='new-invite-row'>
                    <View className='new-invite-row__info'>
                      <Text className='new-invite-row__token'>{inv.token.slice(0, 8)}...</Text>
                      <Text className='new-invite-row__link'>{buildInviteLink(inv.token)}</Text>
                    </View>
                    <View className='new-invite-row__copy' onClick={() => copyLink(buildInviteLink(inv.token))}>
                      <Text>复制</Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {newInvites.length === 0 && (
              <View
                className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleGenerate}
              >
                <Text>{submitting ? '生成中...' : '批量生成'}</Text>
              </View>
            )}
            {newInvites.length > 0 && (
              <View className='form-modal__submit' onClick={closeForm}>
                <Text>完成</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Invite List */}
      {loading ? (
        <View className='admin-loading'><Text>加载中...</Text></View>
      ) : invites.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>✉️</Text>
          <Text className='admin-empty__text'>暂无邀请记录</Text>
        </View>
      ) : (
        <View className='invite-list'>
          {invites.map((inv) => (
            <View key={inv.token} className='invite-row'>
              <View className='invite-row__main'>
                <View className='invite-row__info'>
                  <View className='invite-row__top'>
                    <Text className='invite-row__token'>{inv.token.slice(0, 8)}...</Text>
                    <Text className={`role-badge ${ROLE_LABELS[inv.role]?.className || ''}`}>
                      {ROLE_LABELS[inv.role]?.label || inv.role}
                    </Text>
                    <Text className={`invite-status invite-status--${inv.status}`}>
                      {STATUS_LABELS[inv.status] || inv.status}
                    </Text>
                  </View>
                  <View className='invite-row__meta'>
                    <Text className='invite-row__meta-item'>创建: {formatTime(inv.createdAt)}</Text>
                    <Text className='invite-row__meta-item'>过期: {formatTime(inv.expiresAt)}</Text>
                    {inv.usedAt && (
                      <Text className='invite-row__meta-item'>使用: {formatTime(inv.usedAt)}</Text>
                    )}
                  </View>
                </View>
                {inv.status === 'pending' && (
                  <View className='invite-row__actions'>
                    <View
                      className='invite-row__copy-btn'
                      onClick={() => copyLink(buildInviteLink(inv.token))}
                    >
                      <Text>复制链接</Text>
                    </View>
                    <View className='invite-row__revoke-btn' onClick={() => handleRevoke(inv.token)}>
                      <Text>撤销</Text>
                    </View>
                  </View>
                )}
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
