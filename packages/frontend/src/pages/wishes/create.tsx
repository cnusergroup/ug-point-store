import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { uploadWithRetry } from '../../utils/upload';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import PageToolbar from '../../components/PageToolbar';
import './create.scss';

/** Max character limits */
const TITLE_MAX_LENGTH = 50;
const DESCRIPTION_MAX_LENGTH = 500;
const MONTHLY_LIMIT = 3;

/** Allowed image extensions */
const ALLOWED_IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'webp'];
const IMAGE_MIME_MAP: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

interface MonthlyCountResponse {
  success: boolean;
  count: number;
}

interface CreateWishResponse {
  success: boolean;
  wish: {
    wishId: string;
    status: string;
  };
}

interface UploadUrlResponse {
  uploadUrl: string;
  key: string;
  url: string;
}

/** Get file extension from file name */
function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

export default function WishCreatePage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [imageFile, setImageFile] = useState<{ name: string; path: string; url?: string } | null>(null);
  const [imagePreview, setImagePreview] = useState<string>('');

  // Monthly count state
  const [monthlyCount, setMonthlyCount] = useState<number>(0);
  const [loadingCount, setLoadingCount] = useState(true);

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const remainingWishes = Math.max(0, MONTHLY_LIMIT - monthlyCount);

  const fetchMonthlyCount = useCallback(async () => {
    setLoadingCount(true);
    try {
      const res = await request<MonthlyCountResponse>({ url: '/api/wishes/mine/monthly-count' });
      setMonthlyCount(res.count || 0);
    } catch {
      setMonthlyCount(0);
    } finally {
      setLoadingCount(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchMonthlyCount();
  }, [isAuthenticated, fetchMonthlyCount]);

  const handleBack = () => {
    goBack('/pages/wishes/index');
  };

  /** Validate all form fields, return true if valid */
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      newErrors.title = t('wishPool.create.titleRequired');
    } else if (trimmedTitle.length > TITLE_MAX_LENGTH) {
      newErrors.title = t('wishPool.create.titleTooLong');
    }

    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      newErrors.description = t('wishPool.create.descriptionRequired');
    } else if (trimmedDesc.length > DESCRIPTION_MAX_LENGTH) {
      newErrors.description = t('wishPool.create.descriptionTooLong');
    }

    if (remainingWishes <= 0) {
      newErrors.limit = t('wishPool.create.monthlyLimitReached');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChooseImage = () => {
    const env = Taro.getEnv();
    if (env === Taro.ENV_TYPE.WEB) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/jpeg,image/png,image/webp';
      input.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files.length > 0) {
          const file = target.files[0];
          const ext = getFileExtension(file.name);
          if (!ALLOWED_IMAGE_EXTENSIONS.includes(ext)) {
            Taro.showToast({ title: t('wishPool.create.imageFormatError'), icon: 'none' });
            return;
          }
          const objectUrl = URL.createObjectURL(file);
          setImageFile({ name: file.name, path: objectUrl });
          setImagePreview(objectUrl);
          (window as any).__wishImageFile = file;
        }
      };
      input.click();
    } else {
      Taro.chooseImage({
        count: 1,
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      }).then((res) => {
        if (res.tempFilePaths && res.tempFilePaths.length > 0) {
          const filePath = res.tempFilePaths[0];
          const fileName = filePath.split('/').pop() || 'image.jpg';
          setImageFile({ name: fileName, path: filePath });
          setImagePreview(filePath);
        }
      }).catch(() => {
        // User cancelled
      });
    }
  };

  const handleRemoveImage = () => {
    setImageFile(null);
    setImagePreview('');
    if ((window as any).__wishImageFile) {
      delete (window as any).__wishImageFile;
    }
  };

  /** Upload image to S3 and return the URL */
  const uploadImage = async (): Promise<string | undefined> => {
    if (!imageFile) return undefined;

    const ext = getFileExtension(imageFile.name);
    const contentType = IMAGE_MIME_MAP[ext] || 'image/jpeg';

    // Get presigned upload URL
    const uploadInfo = await request<UploadUrlResponse>({
      url: '/api/admin/images/upload-url',
      method: 'POST',
      data: { fileName: imageFile.name, contentType, purpose: 'wish' },
    });

    const env = Taro.getEnv();
    if (env === Taro.ENV_TYPE.WEB) {
      const rawFile = (window as any).__wishImageFile as File;
      if (!rawFile) throw new Error(t('wishPool.create.imageLost'));
      await uploadWithRetry(uploadInfo.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: rawFile,
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        Taro.uploadFile({
          url: uploadInfo.uploadUrl,
          filePath: imageFile.path,
          name: 'file',
          header: { 'Content-Type': contentType },
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(t('wishPool.create.imageUploadFailed')));
            }
          },
          fail: () => reject(new Error(t('wishPool.create.imageUploadFailed'))),
        });
      });
    }

    return uploadInfo.url;
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      // Upload image if selected
      let imageUrl: string | undefined;
      if (imageFile) {
        imageUrl = await uploadImage();
      }

      // Submit wish
      await request<CreateWishResponse>({
        url: '/api/wishes',
        method: 'POST',
        data: {
          title: title.trim(),
          description: description.trim(),
          ...(imageUrl ? { imageUrl } : {}),
        },
      });

      Taro.showToast({ title: t('wishPool.create.submitSuccess'), icon: 'success', duration: 2000 });
      setTimeout(() => {
        Taro.navigateBack({ delta: 1 }).catch(() => {
          Taro.redirectTo({ url: '/pages/wishes/index' });
        });
      }, 1500);
    } catch (err: any) {
      if (err instanceof RequestError) {
        switch (err.code) {
          case 'MONTHLY_LIMIT_EXCEEDED':
            Taro.showToast({ title: t('wishPool.create.monthlyLimitReached'), icon: 'none' });
            // Refresh count
            fetchMonthlyCount();
            break;
          case 'FEATURE_DISABLED':
            Taro.showToast({ title: t('wishPool.create.featureDisabled'), icon: 'none' });
            break;
          case 'INVALID_WISH_TITLE':
            setErrors((prev) => ({ ...prev, title: t('wishPool.create.titleInvalid') }));
            break;
          case 'INVALID_WISH_DESCRIPTION':
            setErrors((prev) => ({ ...prev, description: t('wishPool.create.descriptionInvalid') }));
            break;
          default:
            Taro.showToast({ title: err.message || t('common.operationFailed'), icon: 'none' });
        }
      } else {
        Taro.showToast({ title: t('common.operationFailed'), icon: 'none' });
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View className='wish-create-page'>
      <PageToolbar title={t('wishPool.create.title')} onBack={handleBack} />

      <View className='wish-create-body'>
        {/* Remaining wish count */}
        <View className='wish-create-quota'>
          <Text className='wish-create-quota__label'>{t('wishPool.create.remainingLabel')}</Text>
          <Text className={`wish-create-quota__count ${remainingWishes === 0 ? 'wish-create-quota__count--zero' : ''}`}>
            {loadingCount ? '-' : `${remainingWishes}/${MONTHLY_LIMIT}`}
          </Text>
        </View>

        {/* Title */}
        <View className='wish-create-field'>
          <Text className='wish-create-field__label'>
            {t('wishPool.create.titleLabel')} <Text className='wish-create-field__required'>*</Text>
          </Text>
          <input
            className={`wish-create-field__input ${errors.title ? 'wish-create-field__input--error' : ''}`}
            placeholder={t('wishPool.create.titlePlaceholder')}
            value={title}
            onInput={(e: any) => {
              const val = e.target.value || e.detail?.value || '';
              setTitle(val);
              if (errors.title) {
                setErrors((prev) => { const next = { ...prev }; delete next.title; return next; });
              }
            }}
            maxLength={TITLE_MAX_LENGTH}
          />
          <Text className='wish-create-field__counter'>{title.length}/{TITLE_MAX_LENGTH}</Text>
          {errors.title && <Text className='wish-create-field__error'>{errors.title}</Text>}
        </View>

        {/* Description */}
        <View className='wish-create-field'>
          <Text className='wish-create-field__label'>
            {t('wishPool.create.descriptionLabel')} <Text className='wish-create-field__required'>*</Text>
          </Text>
          <textarea
            className={`wish-create-field__textarea ${errors.description ? 'wish-create-field__textarea--error' : ''}`}
            placeholder={t('wishPool.create.descriptionPlaceholder')}
            value={description}
            onInput={(e: any) => {
              const val = e.target.value || e.detail?.value || '';
              setDescription(val);
              if (errors.description) {
                setErrors((prev) => { const next = { ...prev }; delete next.description; return next; });
              }
            }}
            maxLength={DESCRIPTION_MAX_LENGTH}
          />
          <Text className='wish-create-field__counter'>{description.length}/{DESCRIPTION_MAX_LENGTH}</Text>
          {errors.description && <Text className='wish-create-field__error'>{errors.description}</Text>}
        </View>

        {/* Image upload (optional) */}
        <View className='wish-create-field'>
          <Text className='wish-create-field__label'>
            {t('wishPool.create.imageLabel')} <Text className='wish-create-field__optional'>{t('wishPool.create.imageOptional')}</Text>
          </Text>
          <View className='wish-create-image-area' onClick={!imageFile ? handleChooseImage : undefined}>
            {imagePreview ? (
              <View className='wish-create-image-area__preview'>
                <img src={imagePreview} className='wish-create-image-area__img' alt='' />
                <View className='wish-create-image-area__remove' onClick={(e) => { e.stopPropagation(); handleRemoveImage(); }}>
                  <Text>×</Text>
                </View>
              </View>
            ) : (
              <View className='wish-create-image-area__empty'>
                <Text className='wish-create-image-area__icon'>+</Text>
                <Text className='wish-create-image-area__hint'>{t('wishPool.create.imageHint')}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Limit error */}
        {errors.limit && (
          <View className='wish-create-limit-error'>
            <Text className='wish-create-field__error'>{errors.limit}</Text>
          </View>
        )}

        {/* Submit Button */}
        <View className='wish-create-submit'>
          <View
            className={`btn-primary wish-create-submit__btn ${submitting || remainingWishes === 0 ? 'btn-primary--disabled' : ''}`}
            onClick={handleSubmit}
          >
            <Text>{submitting ? t('common.submitting') : t('wishPool.create.submitButton')}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
