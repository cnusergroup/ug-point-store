import { useState, useEffect, useCallback } from 'react';
import { View, Text, Switch, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import './settings.scss';

interface FeatureToggles {
  codeRedemptionEnabled: boolean;
  pointsClaimEnabled: boolean;
  adminProductsEnabled: boolean;
  adminOrdersEnabled: boolean;
}

interface TravelSponsorshipSettings {
  travelSponsorshipEnabled: boolean;
  domesticThreshold: number;
  internationalThreshold: number;
}

export default function AdminSettingsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<FeatureToggles>({
    codeRedemptionEnabled: false,
    pointsClaimEnabled: false,
    adminProductsEnabled: true,
    adminOrdersEnabled: true,
  });

  const [travelSettings, setTravelSettings] = useState<TravelSponsorshipSettings>({
    travelSponsorshipEnabled: false,
    domesticThreshold: 0,
    internationalThreshold: 0,
  });
  const [travelLoading, setTravelLoading] = useState(true);
  const [domesticInput, setDomesticInput] = useState('');
  const [internationalInput, setInternationalInput] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<FeatureToggles>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });
      setSettings(res);
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

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchSettings();
    fetchTravelSettings();
  }, [isAuthenticated, fetchSettings, fetchTravelSettings]);

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
        },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      // Revert on failure
      setSettings(prev);
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
        </View>
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
    </View>
  );
}
