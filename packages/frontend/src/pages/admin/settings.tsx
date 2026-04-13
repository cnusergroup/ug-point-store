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
  contentRolePermissions: ContentRolePermissions;
}

interface TravelSponsorshipSettings {
  travelSponsorshipEnabled: boolean;
  domesticThreshold: number;
  internationalThreshold: number;
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
    contentRolePermissions: {
      Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
    },
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
