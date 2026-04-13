import { useState, useEffect, useCallback } from 'react';
import { View, Text, Switch, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import './settings.scss';

interface RolePermissions {
  canAccess: boolean;
  canUpload: boolean;
  canDownload: boolean;
  canReserve: boolean;
}

interface ContentRolePermissions {
  Speaker: RolePermissions;
  UserGroupLeader: RolePermissions;
  Volunteer: RolePermissions;
}

interface FeatureToggles {
  codeRedemptionEnabled: boolean;
  pointsClaimEnabled: boolean;
  adminProductsEnabled: boolean;
  adminOrdersEnabled: boolean;
  adminContentReviewEnabled: boolean;
  adminCategoriesEnabled: boolean;
  adminEmailProductsEnabled: boolean;
  adminEmailContentEnabled: boolean;
  contentRolePermissions: ContentRolePermissions;
  emailPointsEarnedEnabled: boolean;
  emailNewOrderEnabled: boolean;
  emailOrderShippedEnabled: boolean;
  emailNewProductEnabled: boolean;
  emailNewContentEnabled: boolean;
}

type NotificationType = 'pointsEarned' | 'newOrder' | 'orderShipped' | 'newProduct' | 'newContent';

interface EmailToggleConfig {
  key: keyof FeatureToggles;
  notificationType: NotificationType;
  label: string;
  desc: string;
}

interface TravelSponsorshipSettings {
  travelSponsorshipEnabled: boolean;
  domesticThreshold: number;
  internationalThreshold: number;
}

type EmailLocale = 'zh' | 'en' | 'ja' | 'ko' | 'zh-TW';

interface EmailTemplate {
  templateId: string;
  locale: EmailLocale;
  subject: string;
  body: string;
  updatedAt?: string;
  updatedBy?: string;
}

const LOCALE_TABS: { key: EmailLocale; label: string }[] = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
  { key: 'ko', label: '한국어' },
  { key: 'zh-TW', label: '繁體中文' },
];

const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  pointsEarned: '积分到账通知',
  newOrder: '新订单通知',
  orderShipped: '订单发货通知',
  newProduct: '新商品通知',
  newContent: '新内容通知',
};

function EmailTemplateEditorModal({
  notificationType,
  onClose,
}: {
  notificationType: NotificationType;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [requiredVariables, setRequiredVariables] = useState<string[]>([]);
  const [activeLocale, setActiveLocale] = useState<EmailLocale>('zh');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState('');

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await request<{ templates: EmailTemplate[]; requiredVariables?: string[] }>({
        url: `/api/admin/email-templates?type=${notificationType}`,
      });
      setTemplates(res.templates || []);
      if (res.requiredVariables) {
        setRequiredVariables(res.requiredVariables);
      }
    } catch {
      Taro.showToast({ title: '加载模板失败', icon: 'none' });
    } finally {
      setLoadingTemplates(false);
    }
  }, [notificationType]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // When templates load or locale changes, populate the fields
  useEffect(() => {
    const tpl = templates.find((t) => t.locale === activeLocale);
    setSubject(tpl?.subject ?? '');
    setBody(tpl?.body ?? '');
    setDirty(false);
    setValidationError('');
  }, [templates, activeLocale]);

  const handleSubjectChange = (val: string) => {
    setSubject(val);
    setDirty(true);
    setValidationError('');
  };

  const handleBodyChange = (val: string) => {
    setBody(val);
    setDirty(true);
    setValidationError('');
  };

  const validate = (): boolean => {
    if (subject.length < 1 || subject.length > 200) {
      setValidationError('主题长度需在 1–200 字符之间');
      return false;
    }
    if (body.length < 1 || body.length > 10000) {
      setValidationError('正文长度需在 1–10000 字符之间');
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await request<{ template: EmailTemplate }>({
        url: `/api/admin/email-templates/${notificationType}/${activeLocale}`,
        method: 'PUT',
        data: { subject, body },
      });
      // Update local templates list with the saved template
      setTemplates((prev) => {
        const idx = prev.findIndex((t) => t.locale === activeLocale);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = res.template;
          return updated;
        }
        return [...prev, res.template];
      });
      setDirty(false);
      Taro.showToast({ title: '保存成功', icon: 'none' });
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: '保存失败', icon: 'none' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = () => {
    onClose();
  };

  return (
    <View className='template-editor-overlay' onClick={handleOverlayClick}>
      <View className='template-editor' onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <View className='template-editor__header'>
          <Text className='template-editor__title'>
            {NOTIFICATION_TYPE_LABELS[notificationType]} — 模板编辑
          </Text>
          <View className='template-editor__close' onClick={onClose}>
            <Text>✕</Text>
          </View>
        </View>

        {/* Locale Tabs */}
        <View className='template-editor__tabs'>
          {LOCALE_TABS.map((tab) => (
            <View
              key={tab.key}
              className={`template-editor__tab${activeLocale === tab.key ? ' template-editor__tab--active' : ''}`}
              onClick={() => setActiveLocale(tab.key)}
            >
              <Text className='template-editor__tab-text'>{tab.label}</Text>
            </View>
          ))}
        </View>

        {loadingTemplates ? (
          <View className='template-editor__loading'>
            <Text>加载中...</Text>
          </View>
        ) : (
          <View className='template-editor__body'>
            {/* Subject Field */}
            <View className='template-editor__field'>
              <View className='template-editor__field-header'>
                <Text className='template-editor__field-label'>主题</Text>
                <Text className='template-editor__field-count'>
                  {subject.length}/200
                </Text>
              </View>
              <Input
                className='template-editor__input'
                value={subject}
                onInput={(e) => handleSubjectChange(e.detail.value)}
                placeholder='输入邮件主题...'
                maxlength={200}
              />
            </View>

            {/* Body Field */}
            <View className='template-editor__field'>
              <View className='template-editor__field-header'>
                <Text className='template-editor__field-label'>正文 (HTML)</Text>
                <Text className='template-editor__field-count'>
                  {body.length}/10000
                </Text>
              </View>
              <textarea
                className='template-editor__textarea'
                value={body}
                onInput={(e: any) => handleBodyChange(e.target.value || e.detail?.value || '')}
                placeholder='输入邮件正文 HTML...'
                maxLength={10000}
              />
            </View>

            {/* Variable Reference Panel */}
            {requiredVariables.length > 0 && (
              <View className='template-editor__variables'>
                <Text className='template-editor__variables-title'>可用变量</Text>
                <View className='template-editor__variables-list'>
                  {requiredVariables.map((v) => (
                    <View key={v} className='template-editor__variable-tag'>
                      <Text className='template-editor__variable-text'>{`{{${v}}}`}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Validation Error */}
            {validationError && (
              <View className='template-editor__error'>
                <Text className='template-editor__error-text'>{validationError}</Text>
              </View>
            )}
          </View>
        )}

        {/* Footer */}
        {!loadingTemplates && (
          <View className='template-editor__footer'>
            <View className='template-editor__cancel-btn' onClick={onClose}>
              <Text className='template-editor__cancel-btn-text'>取消</Text>
            </View>
            <View
              className={`template-editor__save-btn${(!dirty || saving) ? ' template-editor__save-btn--disabled' : ''}`}
              onClick={(!dirty || saving) ? undefined : handleSave}
            >
              <Text className='template-editor__save-btn-text'>
                {saving ? '保存中...' : '保存'}
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

interface InviteSettings {
  inviteExpiryDays: 1 | 3 | 7;
}

interface AdminUserItem {
  userId: string;
  nickname: string;
  email: string;
}

export default function AdminSettingsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<FeatureToggles>({
    codeRedemptionEnabled: false,
    pointsClaimEnabled: false,
    adminProductsEnabled: true,
    adminOrdersEnabled: true,
    adminContentReviewEnabled: false,
    adminCategoriesEnabled: false,
    adminEmailProductsEnabled: false,
    adminEmailContentEnabled: false,
    contentRolePermissions: {
      Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
    },
    emailPointsEarnedEnabled: false,
    emailNewOrderEnabled: false,
    emailOrderShippedEnabled: false,
    emailNewProductEnabled: false,
    emailNewContentEnabled: false,
  });

  const [contentRolePermissions, setContentRolePermissions] = useState<ContentRolePermissions>({
    Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
    UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
    Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
  });

  const [travelSettings, setTravelSettings] = useState<TravelSponsorshipSettings>({
    travelSponsorshipEnabled: false,
    domesticThreshold: 0,
    internationalThreshold: 0,
  });
  const [travelLoading, setTravelLoading] = useState(true);
  const [domesticInput, setDomesticInput] = useState('');
  const [internationalInput, setInternationalInput] = useState('');

  const [inviteSettings, setInviteSettings] = useState<InviteSettings>({ inviteExpiryDays: 1 });

  const [adminUsers, setAdminUsers] = useState<AdminUserItem[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [transferPassword, setTransferPassword] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');

  // Email template editor state
  const [editingTemplateType, setEditingTemplateType] = useState<NotificationType | null>(null);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<FeatureToggles>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });
      setSettings(res);
      if (res.contentRolePermissions) {
        setContentRolePermissions(res.contentRolePermissions);
      }
    } catch {
      // On failure, keep defaults (false)
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTravelSettings = useCallback(async () => {
    setTravelLoading(true);
    try {
      const res = await request<TravelSponsorshipSettings>({
        url: '/api/settings/travel-sponsorship',
        skipAuth: true,
      });
      setTravelSettings(res);
      setDomesticInput(res.domesticThreshold > 0 ? String(res.domesticThreshold) : '');
      setInternationalInput(res.internationalThreshold > 0 ? String(res.internationalThreshold) : '');
    } catch {
      // On failure, keep defaults
    } finally {
      setTravelLoading(false);
    }
  }, []);

  const fetchInviteSettings = useCallback(async () => {
    try {
      const res = await request<InviteSettings>({
        url: '/api/settings/invite-settings',
        skipAuth: true,
      });
      const days = res.inviteExpiryDays;
      if (days === 1 || days === 3 || days === 7) {
        setInviteSettings({ inviteExpiryDays: days });
      }
    } catch {
      // On failure, keep default (1 day)
    }
  }, []);

  const fetchAdminUsers = useCallback(async () => {
    try {
      const res = await request<{ users: AdminUserItem[] }>({
        url: '/api/admin/users?role=Admin',
      });
      setAdminUsers(res.users || []);
    } catch {
      // On failure, keep empty list
    }
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
    fetchSettings();
    fetchTravelSettings();
    fetchInviteSettings();
    fetchAdminUsers();
  }, [isAuthenticated, isSuperAdmin, fetchSettings, fetchTravelSettings, fetchInviteSettings, fetchAdminUsers]);

  const handleToggle = async (key: keyof FeatureToggles, newValue: boolean) => {
    const prev = { ...settings };
    const updated = { ...settings, [key]: newValue };
    setSettings(updated);

    try {
      await request({
        url: '/api/admin/settings/feature-toggles',
        method: 'PUT',
        data: {
          codeRedemptionEnabled: updated.codeRedemptionEnabled,
          pointsClaimEnabled: updated.pointsClaimEnabled,
          adminProductsEnabled: updated.adminProductsEnabled,
          adminOrdersEnabled: updated.adminOrdersEnabled,
          adminContentReviewEnabled: updated.adminContentReviewEnabled,
          adminCategoriesEnabled: updated.adminCategoriesEnabled,
          adminEmailProductsEnabled: updated.adminEmailProductsEnabled,
          adminEmailContentEnabled: updated.adminEmailContentEnabled,
          emailPointsEarnedEnabled: updated.emailPointsEarnedEnabled,
          emailNewOrderEnabled: updated.emailNewOrderEnabled,
          emailOrderShippedEnabled: updated.emailOrderShippedEnabled,
          emailNewProductEnabled: updated.emailNewProductEnabled,
          emailNewContentEnabled: updated.emailNewContentEnabled,
        },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      // Revert on failure
      setSettings(prev);
      Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
    }
  };

  const handlePermissionToggle = async (
    role: keyof ContentRolePermissions,
    perm: keyof RolePermissions,
    newValue: boolean,
  ) => {
    const prev = { ...contentRolePermissions };
    const updated = {
      ...contentRolePermissions,
      [role]: { ...contentRolePermissions[role], [perm]: newValue },
    };
    setContentRolePermissions(updated);

    try {
      await request({
        url: '/api/admin/settings/content-role-permissions',
        method: 'PUT',
        data: { contentRolePermissions: updated },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      setContentRolePermissions(prev);
      Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
    }
  };

  const isValidPositiveInteger = (value: string): boolean => {
    const num = Number(value);
    return Number.isInteger(num) && num >= 1;
  };

  const updateTravelSettings = async (newSettings: TravelSponsorshipSettings) => {
    const prev = { ...travelSettings };
    const prevDomestic = domesticInput;
    const prevInternational = internationalInput;
    setTravelSettings(newSettings);

    try {
      await request({
        url: '/api/admin/settings/travel-sponsorship',
        method: 'PUT',
        data: {
          travelSponsorshipEnabled: newSettings.travelSponsorshipEnabled,
          domesticThreshold: newSettings.domesticThreshold,
          internationalThreshold: newSettings.internationalThreshold,
        },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      // Revert on failure
      setTravelSettings(prev);
      setDomesticInput(prevDomestic);
      setInternationalInput(prevInternational);
      Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
    }
  };

  const handleTravelToggle = (newValue: boolean) => {
    // When enabling, thresholds must be valid positive integers first
    if (newValue) {
      const domesticOk = isValidPositiveInteger(domesticInput);
      const internationalOk = isValidPositiveInteger(internationalInput);
      if (!domesticOk || !internationalOk) {
        Taro.showToast({ title: t('admin.settings.thresholdRequiredBeforeEnable'), icon: 'none' });
        return;
      }
      updateTravelSettings({
        ...travelSettings,
        travelSponsorshipEnabled: true,
        domesticThreshold: Number(domesticInput),
        internationalThreshold: Number(internationalInput),
      });
    } else {
      // When disabling, use current valid thresholds (fallback to 1 if still 0)
      const domestic = travelSettings.domesticThreshold > 0 ? travelSettings.domesticThreshold : 1;
      const international = travelSettings.internationalThreshold > 0 ? travelSettings.internationalThreshold : 1;
      updateTravelSettings({
        ...travelSettings,
        travelSponsorshipEnabled: false,
        domesticThreshold: domestic,
        internationalThreshold: international,
      });
    }
  };

  const handleDomesticBlur = () => {
    if (!isValidPositiveInteger(domesticInput)) {
      Taro.showToast({ title: t('admin.settings.thresholdError'), icon: 'none' });
      setDomesticInput(travelSettings.domesticThreshold > 0 ? String(travelSettings.domesticThreshold) : '');
      return;
    }
    const newValue = Number(domesticInput);
    if (newValue !== travelSettings.domesticThreshold) {
      updateTravelSettings({
        ...travelSettings,
        domesticThreshold: newValue,
      });
    }
  };

  const handleInternationalBlur = () => {
    if (!isValidPositiveInteger(internationalInput)) {
      Taro.showToast({ title: t('admin.settings.thresholdError'), icon: 'none' });
      setInternationalInput(travelSettings.internationalThreshold > 0 ? String(travelSettings.internationalThreshold) : '');
      return;
    }
    const newValue = Number(internationalInput);
    if (newValue !== travelSettings.internationalThreshold) {
      updateTravelSettings({
        ...travelSettings,
        internationalThreshold: newValue,
      });
    }
  };

  const handleInviteExpiryChange = async (days: 1 | 3 | 7) => {
    if (days === inviteSettings.inviteExpiryDays) return;
    const prev = inviteSettings;
    setInviteSettings({ inviteExpiryDays: days });
    try {
      await request({
        url: '/api/admin/settings/invite-settings',
        method: 'PUT',
        data: { inviteExpiryDays: days },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      setInviteSettings(prev);
      Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
    }
  };

  const handleTransfer = async () => {
    setTransferError('');
    if (!selectedTarget) {
      setTransferError(t('admin.settings.errorSelectTarget'));
      return;
    }
    if (!transferPassword) {
      setTransferError(t('admin.settings.errorPasswordRequired'));
      return;
    }
    setTransferring(true);
    try {
      await request({
        url: '/api/admin/superadmin/transfer',
        method: 'POST',
        data: { targetUserId: selectedTarget, password: transferPassword },
      });
      // Update local store: remove SuperAdmin, keep Admin
      const currentUser = useAppStore.getState().user;
      if (currentUser) {
        const newRoles = currentUser.roles.filter((r) => r !== 'SuperAdmin');
        useAppStore.getState().updateUser({ roles: newRoles });
      }
      Taro.showToast({ title: t('admin.settings.transferSuccess'), icon: 'none' });
      setTimeout(() => {
        Taro.redirectTo({ url: '/pages/admin/index' });
      }, 2000);
    } catch (err) {
      if (err instanceof RequestError) {
        const errorKey = (() => {
          switch (err.code) {
            case 'INVALID_CURRENT_PASSWORD': return 'admin.settings.errorPasswordIncorrect';
            case 'TRANSFER_TARGET_NOT_ADMIN': return 'admin.settings.errorTargetNotAdmin';
            case 'TRANSFER_TARGET_NOT_FOUND': return 'admin.settings.errorTargetNotFound';
            default: return null;
          }
        })();
        setTransferError(errorKey ? t(errorKey as any) : err.message);
      } else {
        setTransferError(t('common.operationFailed'));
      }
    } finally {
      setTransferring(false);
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-settings'>
      {/* Toolbar */}
      <View className='admin-settings__toolbar'>
        <View className='admin-settings__back' onClick={handleBack}>
          <Text>{t('admin.settings.backButton')}</Text>
        </View>
        <Text className='admin-settings__title'>{t('admin.settings.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {loading ? (
        <View className='settings-loading'>
          <Text>{t('admin.settings.loading')}</Text>
        </View>
      ) : (
        <View className='toggle-list'>
          {/* Code Redemption Toggle */}
          <View className='toggle-item'>
            <View className='toggle-item__info'>
              <Text className='toggle-item__label'>{t('admin.settings.codeRedemptionLabel')}</Text>
              <Text className='toggle-item__desc'>{t('admin.settings.codeRedemptionDesc')}</Text>
            </View>
            <View className='toggle-item__switch'>
              <Switch
                checked={settings.codeRedemptionEnabled}
                onChange={(e) => handleToggle('codeRedemptionEnabled', e.detail.value)}
                color='var(--accent-primary)'
              />
            </View>
          </View>

          {/* Points Claim Toggle */}
          <View className='toggle-item'>
            <View className='toggle-item__info'>
              <Text className='toggle-item__label'>{t('admin.settings.pointsClaimLabel')}</Text>
              <Text className='toggle-item__desc'>{t('admin.settings.pointsClaimDesc')}</Text>
            </View>
            <View className='toggle-item__switch'>
              <Switch
                checked={settings.pointsClaimEnabled}
                onChange={(e) => handleToggle('pointsClaimEnabled', e.detail.value)}
                color='var(--accent-primary)'
              />
            </View>
          </View>

          {/* Admin Products Permission */}
          <View className='toggle-item'>
            <View className='toggle-item__info'>
              <Text className='toggle-item__label'>{t('admin.settings.adminProductsLabel')}</Text>
              <Text className='toggle-item__desc'>{t('admin.settings.adminProductsDesc')}</Text>
            </View>
            <View className='toggle-item__switch'>
              <Switch
                checked={settings.adminProductsEnabled}
                onChange={(e) => handleToggle('adminProductsEnabled', e.detail.value)}
                color='var(--accent-primary)'
              />
            </View>
          </View>

          {/* Admin Orders Permission */}
          <View className='toggle-item'>
            <View className='toggle-item__info'>
              <Text className='toggle-item__label'>{t('admin.settings.adminOrdersLabel')}</Text>
              <Text className='toggle-item__desc'>{t('admin.settings.adminOrdersDesc')}</Text>
            </View>
            <View className='toggle-item__switch'>
              <Switch
                checked={settings.adminOrdersEnabled}
                onChange={(e) => handleToggle('adminOrdersEnabled', e.detail.value)}
                color='var(--accent-primary)'
              />
            </View>
          </View>

          {/* Admin Content Review Permission */}
          <View className='toggle-item'>
            <View className='toggle-item__info'>
              <Text className='toggle-item__label'>{t('admin.settings.adminContentReviewLabel')}</Text>
              <Text className='toggle-item__desc'>{t('admin.settings.adminContentReviewDesc')}</Text>
            </View>
            <View className='toggle-item__switch'>
              <Switch
                checked={settings.adminContentReviewEnabled}
                onChange={(e) => handleToggle('adminContentReviewEnabled', e.detail.value)}
                color='var(--accent-primary)'
              />
            </View>
          </View>

          {/* Admin Categories Permission */}
          <View className='toggle-item'>
            <View className='toggle-item__info'>
              <Text className='toggle-item__label'>{t('admin.settings.adminCategoriesLabel')}</Text>
              <Text className='toggle-item__desc'>{t('admin.settings.adminCategoriesDesc')}</Text>
            </View>
            <View className='toggle-item__switch'>
              <Switch
                checked={settings.adminCategoriesEnabled}
                onChange={(e) => handleToggle('adminCategoriesEnabled', e.detail.value)}
                color='var(--accent-primary)'
              />
            </View>
          </View>

          {/* Admin Email Products Permission */}
          <View className='toggle-item'>
            <View className='toggle-item__info'>
              <Text className='toggle-item__label'>{t('admin.settings.adminEmailProductsLabel')}</Text>
              <Text className='toggle-item__desc'>{t('admin.settings.adminEmailProductsDesc')}</Text>
            </View>
            <View className='toggle-item__switch'>
              <Switch
                checked={settings.adminEmailProductsEnabled}
                onChange={(e) => handleToggle('adminEmailProductsEnabled', e.detail.value)}
                color='var(--accent-primary)'
              />
            </View>
          </View>

          {/* Admin Email Content Permission */}
          <View className='toggle-item'>
            <View className='toggle-item__info'>
              <Text className='toggle-item__label'>{t('admin.settings.adminEmailContentLabel')}</Text>
              <Text className='toggle-item__desc'>{t('admin.settings.adminEmailContentDesc')}</Text>
            </View>
            <View className='toggle-item__switch'>
              <Switch
                checked={settings.adminEmailContentEnabled}
                onChange={(e) => handleToggle('adminEmailContentEnabled', e.detail.value)}
                color='var(--accent-primary)'
              />
            </View>
          </View>
        </View>
      )}
      {/* Content Role Permissions Matrix — SuperAdmin only */}
      {isSuperAdmin && (
        <>
          <View className='settings-section'>
            <Text className='settings-section__title'>{t('admin.settings.contentRolePermissionsTitle')}</Text>
          </View>
          <View className='toggle-list'>
            <View className='permissions-matrix'>
              {/* Header row */}
              <View className='permissions-matrix__header'>
                <View className='permissions-matrix__role-col' />
                {(['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const).map((perm) => (
                  <View key={perm} className='permissions-matrix__perm-col'>
                    <Text className='permissions-matrix__perm-label'>
                      {t(`admin.settings.permission${perm.charAt(0).toUpperCase() + perm.slice(1)}` as any)}
                    </Text>
                  </View>
                ))}
              </View>
              {/* Role rows */}
              {(['Speaker', 'UserGroupLeader', 'Volunteer'] as const).map((role) => (
                <View key={role} className='permissions-matrix__row'>
                  <View className='permissions-matrix__role-col'>
                    <Text className='permissions-matrix__role-label'>
                      {t(`admin.settings.role${role}` as any)}
                    </Text>
                  </View>
                  {(['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const).map((perm) => (
                    <View key={perm} className='permissions-matrix__perm-col'>
                      <Switch
                        checked={contentRolePermissions[role][perm]}
                        onChange={(e) => handlePermissionToggle(role, perm, e.detail.value)}
                        color='var(--accent-primary)'
                      />
                    </View>
                  ))}
                </View>
              ))}
            </View>
          </View>
        </>
      )}

      {/* Email Notification Section — SuperAdmin only */}
      {isSuperAdmin && !loading && (
        <>
          <View className='settings-section'>
            <Text className='settings-section__title'>{'邮件通知'}</Text>
          </View>
          <View className='toggle-list'>
            {([
              {
                key: 'emailPointsEarnedEnabled' as keyof FeatureToggles,
                notificationType: 'pointsEarned' as NotificationType,
                label: '积分到账通知',
                desc: '用户获得积分时发送邮件通知',
              },
              {
                key: 'emailNewOrderEnabled' as keyof FeatureToggles,
                notificationType: 'newOrder' as NotificationType,
                label: '新订单通知',
                desc: '用户下单时向管理员发送邮件通知',
              },
              {
                key: 'emailOrderShippedEnabled' as keyof FeatureToggles,
                notificationType: 'orderShipped' as NotificationType,
                label: '订单发货通知',
                desc: '订单发货时向用户发送邮件通知',
              },
              {
                key: 'emailNewProductEnabled' as keyof FeatureToggles,
                notificationType: 'newProduct' as NotificationType,
                label: '新商品通知',
                desc: '向订阅用户发送新商品上架邮件通知',
              },
              {
                key: 'emailNewContentEnabled' as keyof FeatureToggles,
                notificationType: 'newContent' as NotificationType,
                label: '新内容通知',
                desc: '向订阅用户发送新内容发布邮件通知',
              },
            ] as EmailToggleConfig[]).map((item) => (
              <View key={item.key} className='email-toggle-item'>
                <View className='email-toggle-item__main'>
                  <View className='toggle-item__info'>
                    <Text className='toggle-item__label'>{item.label}</Text>
                    <Text className='toggle-item__desc'>{item.desc}</Text>
                  </View>
                  <View className='toggle-item__switch'>
                    <Switch
                      checked={settings[item.key] as boolean}
                      onChange={(e) => handleToggle(item.key, e.detail.value)}
                      color='var(--accent-primary)'
                    />
                  </View>
                </View>
                <View
                  className='email-toggle-item__edit-btn'
                  onClick={() => setEditingTemplateType(item.notificationType)}
                >
                  <Text className='email-toggle-item__edit-btn-text'>{'编辑模板'}</Text>
                </View>
              </View>
            ))}

            {/* Seed default templates button */}
            <View
              className='email-seed-btn'
              onClick={async () => {
                try {
                  await request({
                    url: '/api/admin/email-templates/seed',
                    method: 'POST',
                  });
                  Taro.showToast({ title: '默认模板已初始化', icon: 'none' });
                } catch {
                  Taro.showToast({ title: '初始化失败', icon: 'none' });
                }
              }}
            >
              <Text className='email-seed-btn__text'>初始化默认模板</Text>
              <Text className='email-seed-btn__hint'>写入 25 条默认邮件模板（5 种通知 × 5 种语言），已有模板会被覆盖</Text>
            </View>
          </View>
        </>
      )}

      {/* Email Template Editor Modal */}
      {editingTemplateType && (
        <EmailTemplateEditorModal
          notificationType={editingTemplateType}
          onClose={() => setEditingTemplateType(null)}
        />
      )}

      {/* Travel Sponsorship Settings Section */}
      <View className='settings-section'>
        <Text className='settings-section__title'>{t('admin.settings.travelSponsorshipTitle')}</Text>
      </View>

      {travelLoading ? (
        <View className='settings-loading'>
          <Text>{t('admin.settings.loading')}</Text>
        </View>
      ) : (
        <View className='toggle-list'>
          {/* Travel Sponsorship Toggle */}
          <View className='toggle-item'>
            <View className='toggle-item__info'>
              <Text className='toggle-item__label'>{t('admin.settings.travelSponsorshipLabel')}</Text>
              <Text className='toggle-item__desc'>{t('admin.settings.travelSponsorshipDesc')}</Text>
            </View>
            <View className='toggle-item__switch'>
              <Switch
                checked={travelSettings.travelSponsorshipEnabled}
                onChange={(e) => handleTravelToggle(e.detail.value)}
                color='var(--accent-primary)'
              />
            </View>
          </View>

          {/* Domestic Threshold */}
          <View className='threshold-item'>
            <View className='threshold-item__info'>
              <Text className='threshold-item__label'>{t('admin.settings.domesticThresholdLabel')}</Text>
              <Text className='threshold-item__desc'>{t('admin.settings.domesticThresholdDesc')}</Text>
            </View>
            <View className='threshold-item__input'>
              <Input
                type='number'
                value={domesticInput}
                placeholder={t('admin.settings.thresholdPlaceholder')}
                onInput={(e) => setDomesticInput(e.detail.value)}
                onBlur={handleDomesticBlur}
                className='threshold-input'
              />
            </View>
          </View>

          {/* International Threshold */}
          <View className='threshold-item'>
            <View className='threshold-item__info'>
              <Text className='threshold-item__label'>{t('admin.settings.internationalThresholdLabel')}</Text>
              <Text className='threshold-item__desc'>{t('admin.settings.internationalThresholdDesc')}</Text>
            </View>
            <View className='threshold-item__input'>
              <Input
                type='number'
                value={internationalInput}
                placeholder={t('admin.settings.thresholdPlaceholder')}
                onInput={(e) => setInternationalInput(e.detail.value)}
                onBlur={handleInternationalBlur}
                className='threshold-input'
              />
            </View>
          </View>
        </View>
      )}

      {/* Invite Expiry Section — SuperAdmin only */}
      {isSuperAdmin && (
        <>
          <View className='settings-section'>
            <Text className='settings-section__title'>{t('admin.settings.inviteExpiryTitle')}</Text>
          </View>
          <View className='toggle-list'>
            <View className='invite-expiry-item'>
              <Text className='invite-expiry-item__desc'>{t('admin.settings.inviteExpiryDesc')}</Text>
              <View className='invite-expiry-item__options'>
                {([1, 3, 7] as const).map((days) => (
                  <View
                    key={days}
                    className={`invite-expiry-option${inviteSettings.inviteExpiryDays === days ? ' invite-expiry-option--active' : ''}`}
                    onClick={() => handleInviteExpiryChange(days)}
                  >
                    <Text className='invite-expiry-option__label'>
                      {t(`admin.settings.inviteExpiryDays${days}` as any)}
                    </Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </>
      )}

      {/* SuperAdmin Transfer Section — SuperAdmin only */}
      {isSuperAdmin && (
        <>
          <View className='settings-section'>
            <Text className='settings-section__title'>{t('admin.settings.transferTitle')}</Text>
          </View>
          <View className='toggle-list'>
            <View className='transfer-section'>
              <Text className='transfer-section__desc'>{t('admin.settings.transferDesc')}</Text>

              {/* Admin user selector */}
              {adminUsers.length === 0 ? (
                <View className='transfer-section__empty'>
                  <Text className='transfer-section__empty-text'>{t('admin.settings.noEligibleTargets')}</Text>
                </View>
              ) : (
                <View className='transfer-user-list'>
                  {adminUsers.map((user) => (
                    <View
                      key={user.userId}
                      className={`transfer-user-item${selectedTarget === user.userId ? ' transfer-user-item--selected' : ''}`}
                      onClick={() => setSelectedTarget(user.userId)}
                    >
                      <View className='transfer-user-item__check'>
                        {selectedTarget === user.userId && <Text className='transfer-user-item__check-icon'>✓</Text>}
                      </View>
                      <View className='transfer-user-item__info'>
                        <Text className='transfer-user-item__nickname'>{user.nickname}</Text>
                        <Text className='transfer-user-item__email'>{user.email}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Password input */}
              <View className='transfer-section__field'>
                <Text className='transfer-section__label'>{t('admin.settings.passwordLabel')}</Text>
                <Input
                  type='text'
                  password
                  value={transferPassword}
                  placeholder={t('admin.settings.passwordPlaceholder')}
                  onInput={(e) => setTransferPassword(e.detail.value)}
                  className='transfer-input'
                />
              </View>

              {/* Error message */}
              {transferError ? (
                <View className='transfer-section__error'>
                  <Text className='transfer-section__error-text'>{transferError}</Text>
                </View>
              ) : null}

              {/* Confirm button */}
              <View
                className={`transfer-section__btn${(!selectedTarget || !transferPassword || transferring || adminUsers.length === 0) ? ' transfer-section__btn--disabled' : ''}`}
                onClick={(!selectedTarget || !transferPassword || transferring || adminUsers.length === 0) ? undefined : handleTransfer}
              >
                <Text className='transfer-section__btn-text'>
                  {transferring ? t('admin.settings.transferring') : t('admin.settings.confirmTransfer')}
                </Text>
              </View>
            </View>
          </View>
        </>
      )}

    </View>
  );
}
