import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { ShoppingBagIcon } from '../../components/icons';
import { EXCLUSIVE_ROLES } from '@points-mall/shared';
import './invites.scss';

interface InviteRecord {
  token: string;
  role: string;
  roles?: string[];
  status: 'pending' | 'used' | 'expired';
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
}

interface NewInvite {
  token: string;
  link: string;
  roles: string[];
  expiresAt: string;
}

type StatusFilter = 'all' | 'pending' | 'used' | 'expired';

const ROLE_OPTIONS = [
  { value: 'UserGroupLeader', label: 'Leader', className: 'role-badge--leader' },
  // [DISABLED] CommunityBuilder
  // { value: 'CommunityBuilder', label: 'Builder', className: 'role-badge--builder' },
  { value: 'Speaker', label: 'Speaker', className: 'role-badge--speaker' },
  { value: 'Volunteer', label: 'Volunteer', className: 'role-badge--volunteer' },
];

const ROLE_LABELS: Record<string, { className: string; labelKey?: string; label?: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  OrderAdmin: { labelKey: 'roles.orderAdmin', className: 'role-badge--order-admin' },
};

/** 从邀请记录安全获取 roles 数组（兼容旧数据） */
function getInviteRoles(record: { role?: string; roles?: string[] }): string[] {
  if (record.roles && record.roles.length > 0) return record.roles;
  if (record.role) return [record.role];
  return [];
}

export default function AdminInvitesPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const { t } = useTranslation();

  /** Resolve role label: uses i18n key when available, otherwise static label */
  const getRoleLabel = (role: string): string => {
    const config = ROLE_LABELS[role];
    if (!config) return role;
    if (config.labelKey) return t(config.labelKey as any);
    return config.label || role;
  };

  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [showForm, setShowForm] = useState(false);
  const [formRoles, setFormRoles] = useState<string[]>([]);
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

  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const roleOptions = [
    ...ROLE_OPTIONS,
    ...(isSuperAdmin ? [{ value: 'OrderAdmin', label: t('roles.orderAdmin'), className: 'role-badge--order-admin' }] : []),
  ];

  const toggleRole = (role: string) => {
    if (EXCLUSIVE_ROLES.includes(role as any)) {
      // Selecting an exclusive role: clear all others, toggle this one
      setFormRoles((prev) => prev.includes(role) ? [] : [role]);
    } else {
      // Selecting a regular role: clear any exclusive roles first
      setFormRoles((prev) => {
        const withoutExclusive = prev.filter(r => !EXCLUSIVE_ROLES.includes(r as any));
        return withoutExclusive.includes(role)
          ? withoutExclusive.filter(r => r !== role)
          : [...withoutExclusive, role];
      });
    }
  };

  const openForm = () => {
    setFormRoles([]);
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
    if (formRoles.length === 0) {
      setFormError(t('admin.invites.errorRolesRequired') || '请至少选择一个角色');
      return;
    }
    const count = Number(formCount);
    if (!count || count < 1 || count > 100) {
      setFormError(t('admin.invites.errorCountRequired'));
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const res = await request<{ invites: NewInvite[] }>({
        url: '/api/admin/invites/batch',
        method: 'POST',
        data: { count, roles: formRoles },
      });
      setNewInvites(res.invites || []);
      fetchInvites(statusFilter);
    } catch (err) {
      setFormError(err instanceof RequestError ? err.message : t('admin.invites.generateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (token: string) => {
    try {
      await request({ url: `/api/admin/invites/${token}/revoke`, method: 'PATCH' });
      fetchInvites(statusFilter);
      Taro.showToast({ title: t('admin.invites.revoked'), icon: 'none' });
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('admin.invites.revokeFailed'),
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
          <Text>{t('admin.invites.backButton')}</Text>
        </View>
        <Text className='admin-invites__title'>{t('admin.invites.title')}</Text>
        <View className='admin-invites__gen-btn' onClick={openForm}>
          <Text>{t('admin.invites.generateInvite')}</Text>
        </View>
      </View>

      {/* Status Filter Tabs */}
      <View className='invite-tabs'>
        {([
          { key: 'all' as StatusFilter, label: t('admin.invites.filterAll') },
          { key: 'pending' as StatusFilter, label: t('admin.invites.filterPending') },
          { key: 'used' as StatusFilter, label: t('admin.invites.filterUsed') },
          { key: 'expired' as StatusFilter, label: t('admin.invites.filterExpired') },
        ]).map((tab) => (
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
              <Text className='form-modal__title'>{t('admin.invites.generateTitle')}</Text>
              <View className='form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {formError && (
              <View className='form-modal__error'><Text>{formError}</Text></View>
            )}
            <View className='form-modal__body'>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.invites.targetRolesLabel')}</Text>
                <View className='invite-role-select'>
                  {roleOptions.map((opt) => (
                    <View
                      key={opt.value}
                      className={`invite-role-select__item ${formRoles.includes(opt.value) ? 'invite-role-select__item--active' : ''}`}
                      onClick={() => toggleRole(opt.value)}
                    >
                      <Text className={`role-badge ${opt.className}`}>{opt.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.invites.countLabel')}</Text>
                <Input
                  className='form-field__input'
                  type='number'
                  value={formCount}
                  onInput={(e) => setFormCount(e.detail.value)}
                  placeholder={t('admin.invites.countPlaceholder')}
                />
              </View>
            </View>

            {/* New invites result list */}
            {newInvites.length > 0 && (
              <View className='new-invites-list'>
                <Text className='new-invites-list__title'>{t('admin.invites.generatedCount', { count: newInvites.length })}</Text>
                {newInvites.map((inv) => (
                  <View key={inv.token} className='new-invite-row'>
                    <View className='new-invite-row__info'>
                      <View className='new-invite-row__header'>
                        <Text className='new-invite-row__token'>{inv.token.slice(0, 8)}...</Text>
                        {inv.roles.map((role) => (
                          <Text key={role} className={`role-badge ${ROLE_LABELS[role]?.className || ''}`}>
                            {getRoleLabel(role)}
                          </Text>
                        ))}
                      </View>
                      <Text className='new-invite-row__link'>{buildInviteLink(inv.token)}</Text>
                    </View>
                    <View className='new-invite-row__copy' onClick={() => copyLink(buildInviteLink(inv.token))}>
                      <Text>{t('common.copy')}</Text>
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
                <Text>{submitting ? t('admin.invites.generating') : t('admin.invites.batchGenerate')}</Text>
              </View>
            )}
            {newInvites.length > 0 && (
              <View className='form-modal__submit' onClick={closeForm}>
                <Text>{t('common.done')}</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Invite List */}
      {loading ? (
        <View className='admin-loading'><Text>{t('admin.invites.loading')}</Text></View>
      ) : invites.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'><ShoppingBagIcon size={48} color='var(--text-tertiary)' /></Text>
          <Text className='admin-empty__text'>{t('admin.invites.noInvites')}</Text>
        </View>
      ) : (
        <View className='invite-list'>
          {invites.map((inv) => (
            <View key={inv.token} className='invite-row'>
              <View className='invite-row__main'>
                <View className='invite-row__info'>
                  <View className='invite-row__top'>
                    <Text className='invite-row__token'>{inv.token.slice(0, 8)}...</Text>
                    {getInviteRoles(inv).map((role) => (
                      <Text key={role} className={`role-badge ${ROLE_LABELS[role]?.className || ''}`}>
                        {getRoleLabel(role)}
                      </Text>
                    ))}
                    <Text className={`invite-status invite-status--${inv.status}`}>
                      {inv.status === 'pending' ? t('admin.invites.statusPending') : inv.status === 'used' ? t('admin.invites.statusUsed') : t('admin.invites.statusExpired')}
                    </Text>
                  </View>
                  <View className='invite-row__meta'>
                    <Text className='invite-row__meta-item'>{t('admin.invites.createdLabel', { time: formatTime(inv.createdAt) })}</Text>
                    <Text className='invite-row__meta-item'>{t('admin.invites.expiresLabel', { time: formatTime(inv.expiresAt) })}</Text>
                    {inv.usedAt && (
                      <Text className='invite-row__meta-item'>{t('admin.invites.usedLabel', { time: formatTime(inv.usedAt) })}</Text>
                    )}
                  </View>
                </View>
                {inv.status === 'pending' && (
                  <View className='invite-row__actions'>
                    <View
                      className='invite-row__copy-btn'
                      onClick={() => copyLink(buildInviteLink(inv.token))}
                    >
                      <Text>{t('admin.invites.copyLink')}</Text>
                    </View>
                    <View className='invite-row__revoke-btn' onClick={() => handleRevoke(inv.token)}>
                      <Text>{t('admin.invites.revokeButton')}</Text>
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
