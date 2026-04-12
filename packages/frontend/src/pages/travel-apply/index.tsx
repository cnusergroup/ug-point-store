import { useState, useEffect, useMemo } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { LocationIcon, GlobeIcon } from '../../components/icons';
import type { TravelApplication } from '@points-mall/shared';
import './index.scss';

type TravelCategory = 'domestic' | 'international';
type CommunityRole = 'Hero' | 'CommunityBuilder' | 'UGL';

const COMMUNITY_ROLES: CommunityRole[] = ['Hero', 'CommunityBuilder', 'UGL'];

function isValidUrl(str: string): boolean {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Required field label — no asterisk, consistent with rest of app */
function FieldLabel({ label }: { label: string }) {
  return <Text className='ta-field__label'>{label}</Text>;
}

export default function TravelApplyPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  // URL params
  const [applicationId, setApplicationId] = useState<string | null>(null);
  const [initialCategory, setInitialCategory] = useState<TravelCategory>('domestic');
  const isEditMode = !!applicationId;

  // Form state
  const [category, setCategory] = useState<TravelCategory>('domestic');
  const [communityRole, setCommunityRole] = useState<CommunityRole | ''>('');
  const [eventLink, setEventLink] = useState('');
  const [cfpScreenshotUrl, setCfpScreenshotUrl] = useState('');
  const [cfpUploading, setCfpUploading] = useState(false);
  const [transportCost, setTransportCost] = useState('');
  const [hotelCost, setHotelCost] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);

  // Parse URL params on mount
  useEffect(() => {
    const instance = Taro.getCurrentInstance();
    const params = instance?.router?.params || {};
    if (params.category === 'domestic' || params.category === 'international') {
      setCategory(params.category);
      setInitialCategory(params.category);
    }
    if (params.applicationId) {
      setApplicationId(params.applicationId);
    }
  }, []);

  // Load existing application data in edit mode
  useEffect(() => {
    if (!applicationId) return;
    setLoading(true);
    request<{ applications: TravelApplication[] }>({
      url: `/api/travel/my-applications?pageSize=100`,
    })
      .then((res) => {
        const app = res.applications?.find((a) => a.applicationId === applicationId);
        if (app) {
          setCategory(app.category as TravelCategory);
          setInitialCategory(app.category as TravelCategory);
          setCommunityRole(app.communityRole as CommunityRole);
          setEventLink(app.eventLink);
          setCfpScreenshotUrl(app.cfpScreenshotUrl);
          setTransportCost(String(app.flightCost));
          setHotelCost(String(app.hotelCost));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [applicationId]);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
    }
  }, [isAuthenticated]);

  const totalCost = useMemo(() => {
    const transport = parseFloat(transportCost) || 0;
    const hotel = parseFloat(hotelCost) || 0;
    return transport + hotel;
  }, [transportCost, hotelCost]);

  const handleChooseImage = async () => {
    try {
      const chooseRes = await Taro.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      });
      const files = chooseRes.tempFilePaths || [];
      if (files.length === 0) return;

      const filePath = files[0];
      setCfpUploading(true);

      let fileName = 'image.jpg';
      let contentType = 'image/jpeg';
      const tempFile = (chooseRes as any).tempFiles?.[0];
      if (tempFile?.originalFileObj?.name) {
        fileName = tempFile.originalFileObj.name;
      } else if (tempFile?.type) {
        const typeExtMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
        const ext = typeExtMap[tempFile.type] || 'jpg';
        fileName = `image.${ext}`;
        contentType = tempFile.type;
      } else {
        const pathName = filePath.split('/').pop() || '';
        if (pathName.includes('.')) fileName = pathName;
      }
      const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
      const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
      contentType = mimeMap[ext] || contentType;

      const uploadRes = await request<{ uploadUrl: string; key: string; url: string }>({
        url: '/api/claims/upload-url',
        method: 'POST',
        data: { fileName, contentType },
      });

      const env = Taro.getEnv();
      if (env === Taro.ENV_TYPE.WEB) {
        const resp = await fetch(filePath);
        const blob = await resp.blob();
        await fetch(uploadRes.uploadUrl, { method: 'PUT', headers: { 'Content-Type': contentType }, body: blob });
      } else {
        await Taro.uploadFile({ url: uploadRes.uploadUrl, filePath, name: 'file', header: { 'Content-Type': contentType } });
      }

      setCfpScreenshotUrl(uploadRes.url);
      setFieldErrors((prev) => ({ ...prev, cfp: '' }));
    } catch {
      Taro.showToast({ title: t('travel.apply.uploadFailed'), icon: 'none' });
    } finally {
      setCfpUploading(false);
    }
  };

  const handleRemoveImage = () => setCfpScreenshotUrl('');

  const handleTransportInput = (e: any) => {
    const val = e.detail.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) setTransportCost(val);
  };

  const handleHotelInput = (e: any) => {
    const val = e.detail.value;
    if (val === '' || /^\d*\.?\d*$/.test(val)) setHotelCost(val);
  };

  const handleSubmit = async () => {
    setFormError('');
    const errors: Record<string, string> = {};

    if (!communityRole) errors.role = t('travel.apply.errorRoleRequired');
    if (!eventLink.trim() || !isValidUrl(eventLink.trim())) errors.link = t('travel.apply.eventLinkError');
    if (!cfpScreenshotUrl) errors.cfp = t('travel.apply.errorCfpRequired');

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setFormError(t('travel.apply.errorFillRequired'));
      return;
    }
    setFieldErrors({});

    const transport = parseFloat(transportCost) || 0;
    const hotel = parseFloat(hotelCost) || 0;

    if (transport + hotel <= 0) {
      setFieldErrors({ cost: t('travel.apply.errorCostRequired') });
      setFormError(t('travel.apply.errorFillRequired'));
      return;
    }

    setSubmitting(true);
    try {
      const data = {
        category,
        communityRole,
        eventLink: eventLink.trim(),
        cfpScreenshotUrl,
        flightCost: transport,
        hotelCost: hotel,
      };

      if (isEditMode) {
        await request<TravelApplication>({ url: `/api/travel/applications/${applicationId}`, method: 'PUT', data });
      } else {
        await request<TravelApplication>({ url: '/api/travel/apply', method: 'POST', data });
      }

      Taro.showToast({ title: t('travel.apply.submitSuccess'), icon: 'none' });
      setTimeout(() => Taro.redirectTo({ url: '/pages/my-travel/index' }), 800);
    } catch (err) {
      const msg = err instanceof RequestError ? err.message : t('travel.apply.submitFailed');
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    // In edit mode, always go back to my-travel; in new mode, go back to mall
    if (isEditMode) {
      goBack('/pages/my-travel/index');
    } else {
      goBack('/pages/index/index');
    }
  };

  const categoryLabel = category === 'domestic' ? t('travel.apply.categoryDomestic') : t('travel.apply.categoryInternational');
  const CategoryIcon = category === 'domestic' ? LocationIcon : GlobeIcon;
  const categoryColor = category === 'domestic' ? 'var(--accent-primary)' : 'var(--success)';

  if (loading) {
    return (
      <View className='ta-page'>
        <View className='ta-toolbar'>
          <View className='ta-toolbar__back' onClick={handleBack}><Text>{t('travel.apply.backButton')}</Text></View>
          <Text className='ta-toolbar__title'>{isEditMode ? t('travel.apply.editTitle') : t('travel.apply.title')}</Text>
          <View className='ta-toolbar__spacer' />
        </View>
        <View className='admin-loading'><Text>{t('common.loading')}</Text></View>
      </View>
    );
  }

  return (
    <View className='ta-page'>
      {/* Toolbar */}
      <View className='ta-toolbar'>
        <View className='ta-toolbar__back' onClick={handleBack}>
          <Text>{t('travel.apply.backButton')}</Text>
        </View>
        <Text className='ta-toolbar__title'>
          {isEditMode ? t('travel.apply.editTitle') : t('travel.apply.title')}
        </Text>
        <View className='ta-toolbar__spacer' />
      </View>

      {/* Form */}
      <View className='ta-form'>
        {/* Category display — full width, first item in form */}
        <View className='ta-category-display'>
          <View className='ta-category-display__icon'>
            <CategoryIcon size={20} color={categoryColor} />
          </View>
          <Text className='ta-category-display__text' style={{ color: categoryColor }}>{categoryLabel}</Text>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </View>
        {/* Global error */}
        {formError && (
          <View className='ta-error-banner'>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <Text className='ta-error-banner__text'>{formError}</Text>
          </View>
        )}

        {/* Section: 身份信息 */}
        <View className='ta-section'>
          <Text className='ta-section__title'>{t('travel.apply.sectionIdentity')}</Text>

          {/* Community role */}
          <View className='ta-field'>
            <FieldLabel label={t('travel.apply.communityRoleLabel')} />
            <Text className='ta-field__hint'>{t('travel.apply.communityRoleHint')}</Text>
            <View className='ta-role-grid'>
              {COMMUNITY_ROLES.map((role) => (
                <View
                  key={role}
                  className={`ta-role-item ${communityRole === role ? 'ta-role-item--active' : ''} ${fieldErrors.role ? 'ta-role-item--error' : ''}`}
                  onClick={() => { setCommunityRole(role); setFieldErrors((p) => ({ ...p, role: '' })); }}
                >
                  <Text className='ta-role-item__name'>{role}</Text>
                </View>
              ))}
            </View>
            {fieldErrors.role && <Text className='ta-field__error'>{fieldErrors.role}</Text>}
          </View>
        </View>

        {/* Section: 活动信息 */}
        <View className='ta-section'>
          <Text className='ta-section__title'>{t('travel.apply.sectionEvent')}</Text>

          {/* Event link */}
          <View className='ta-field'>
            <FieldLabel label={t('travel.apply.eventLinkLabel')} />
            <Text className='ta-field__hint'>{t('travel.apply.eventLinkHint')}</Text>
            <Input
              className={`ta-input ${fieldErrors.link ? 'ta-input--error' : ''}`}
              value={eventLink}
              onInput={(e) => { setEventLink(e.detail.value); setFieldErrors((p) => ({ ...p, link: '' })); }}
              placeholder={t('travel.apply.eventLinkPlaceholder')}
            />
            {fieldErrors.link && <Text className='ta-field__error'>{fieldErrors.link}</Text>}
          </View>

          {/* CFP screenshot */}
          <View className='ta-field'>
            <FieldLabel label={t('travel.apply.cfpScreenshotLabel')} />
            <Text className='ta-field__hint'>{t('travel.apply.cfpUploadHint')}</Text>
            <View className='ta-upload'>
              {cfpUploading ? (
                <View className='ta-upload__loading'>
                  <View className='ta-upload__spinner' />
                  <Text className='ta-upload__loading-text'>{t('travel.apply.uploading')}</Text>
                </View>
              ) : cfpScreenshotUrl ? (
                <View className='ta-upload__preview'>
                  <Image src={cfpScreenshotUrl} className='ta-upload__img' mode='aspectFill' />
                  <View className='ta-upload__remove' onClick={handleRemoveImage}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </View>
                </View>
              ) : (
                <View
                  className={`ta-upload__add ${fieldErrors.cfp ? 'ta-upload__add--error' : ''}`}
                  onClick={handleChooseImage}
                >
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                  <Text className='ta-upload__add-text'>{t('travel.apply.cfpUploadAction')}</Text>
                </View>
              )}
            </View>
            {fieldErrors.cfp && <Text className='ta-field__error'>{fieldErrors.cfp}</Text>}
          </View>
        </View>

        {/* Section: 费用明细 */}
        <View className='ta-section'>
          <Text className='ta-section__title'>{t('travel.apply.sectionCost')}</Text>
          <Text className='ta-section__desc'>{t('travel.apply.costSectionHint')}</Text>
          <View className='ta-cost-row'>
            {/* Transport cost */}
            <View className='ta-field ta-field--half'>
              <FieldLabel label={t('travel.apply.transportCostLabel')} />
              <View className='ta-input-wrap'>
                <Input
                  className='ta-input ta-input--cost'
                  value={transportCost}
                  onInput={handleTransportInput}
                  placeholder='0'
                  type='digit'
                />
                <Text className='ta-input-wrap__unit'>{t('travel.apply.costUnit')}</Text>
              </View>
            </View>

            {/* Hotel cost */}
            <View className='ta-field ta-field--half'>
              <FieldLabel label={t('travel.apply.hotelCostLabel')} />
              <View className='ta-input-wrap'>
                <Input
                  className='ta-input ta-input--cost'
                  value={hotelCost}
                  onInput={handleHotelInput}
                  placeholder='0'
                  type='digit'
                />
                <Text className='ta-input-wrap__unit'>{t('travel.apply.costUnit')}</Text>
              </View>
            </View>
          </View>

          {/* Total cost */}
          <View className='ta-total'>
            <Text className='ta-total__label'>{t('travel.apply.totalCostLabel')}</Text>
            <View className='ta-total__right'>
              <Text className='ta-total__value'>{totalCost.toLocaleString()}</Text>
              <Text className='ta-total__unit'>{t('travel.apply.costUnit')}</Text>
            </View>
          </View>
          {fieldErrors.cost && <Text className='ta-field__error'>{fieldErrors.cost}</Text>}
        </View>

        {/* Submit */}
        <View
          className={`ta-submit ${submitting ? 'ta-submit--loading' : ''}`}
          onClick={submitting ? undefined : handleSubmit}
        >
          {submitting ? (
            <View className='ta-submit__spinner' />
          ) : null}
          <Text className='ta-submit__text'>
            {submitting
              ? t('travel.apply.submitting')
              : isEditMode
                ? t('travel.apply.editSubmitButton')
                : t('travel.apply.submitButton')}
          </Text>
        </View>
      </View>
    </View>
  );
}
