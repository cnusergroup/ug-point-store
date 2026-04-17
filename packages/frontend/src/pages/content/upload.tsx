import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Picker } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { uploadWithRetry, UploadError } from '../../utils/upload';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import TagInput from '../../components/TagInput';
import PageToolbar from '../../components/PageToolbar';
import type { ContentCategory, ContentItem, ContentStatus } from '@points-mall/shared';
import './upload.scss';

/** Allowed file extensions and their MIME types */
const ALLOWED_EXTENSIONS = ['ppt', 'pptx', 'pdf', 'doc', 'docx'];
const EXTENSION_MIME_MAP: Record<string, string> = {
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

interface CategoriesResponse {
  success: boolean;
  categories: ContentCategory[];
}

interface UploadUrlResponse {
  uploadUrl: string;
  fileKey: string;
}

interface CreateContentResponse {
  success: boolean;
  item: { contentId: string };
}

interface ContentDetailResponse {
  success: boolean;
  item: ContentItem;
  hasReserved: boolean;
  hasLiked: boolean;
}

interface EditContentResponse {
  success: boolean;
  item: ContentItem;
}

/** Get file extension from file name */
function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/** Validate URL format */
function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export default function ContentUploadPage() {
  const router = useRouter();
  const editId = router.params.id || '';
  const isEditMode = !!editId;

  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [selectedCategoryIndex, setSelectedCategoryIndex] = useState<number>(-1);
  const [videoUrl, setVideoUrl] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // File state — selectedFile is a newly chosen file; existingFile is the original file in edit mode
  const [selectedFile, setSelectedFile] = useState<{ name: string; size: number; path: string } | null>(null);
  const [existingFile, setExistingFile] = useState<{ name: string; size: number } | null>(null);

  // Content status state (edit mode)
  const [contentStatus, setContentStatus] = useState<ContentStatus | null>(null);
  const [rejectReason, setRejectReason] = useState<string>('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Original data ref for computing changed fields in edit mode
  const originalDataRef = useRef<ContentItem | null>(null);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await request<CategoriesResponse>({ url: '/api/content/categories' });
      setCategories(res.categories || []);
      return res.categories || [];
    } catch {
      setCategories([]);
      return [];
    }
  }, []);

  const fetchContentDetail = useCallback(async (cats: ContentCategory[]) => {
    if (!editId) return;
    setLoadingDetail(true);
    try {
      const res = await request<ContentDetailResponse>({ url: `/api/content/${editId}` });
      const item = res.item;
      originalDataRef.current = item;

      // Pre-fill form fields
      setTitle(item.title);
      setDescription(item.description);
      setVideoUrl(item.videoUrl || '');
      setExistingFile({ name: item.fileName, size: item.fileSize });
      setContentStatus(item.status);
      setRejectReason(item.rejectReason || '');
      setTags(item.tags ?? []);

      // Set category index based on fetched categories
      const catIndex = cats.findIndex((c) => c.categoryId === item.categoryId);
      if (catIndex >= 0) {
        setSelectedCategoryIndex(catIndex);
      }
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('contentHub.upload.submitFailed'), icon: 'none' });
    } finally {
      setLoadingDetail(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchCategories().then((cats) => {
      if (isEditMode) {
        fetchContentDetail(cats);
      }
    });
  }, [isAuthenticated, fetchCategories, isEditMode, fetchContentDetail]);

  const handleBack = () => {
    goBack('/pages/content/index');
  };

  /** Validate all form fields, return true if valid */
  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Title: required, 1~100 chars
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      newErrors.title = t('contentHub.upload.titleRequired');
    } else if (trimmedTitle.length > 100) {
      newErrors.title = t('contentHub.upload.titleTooLong');
    }

    // Description: required, 1~2000 chars
    const trimmedDesc = description.trim();
    if (!trimmedDesc) {
      newErrors.description = t('contentHub.upload.descriptionRequired');
    } else if (trimmedDesc.length > 2000) {
      newErrors.description = t('contentHub.upload.descriptionTooLong');
    }

    // Category: required
    if (selectedCategoryIndex < 0 || selectedCategoryIndex >= categories.length) {
      newErrors.category = t('contentHub.upload.categoryRequired');
    }

    // File: required in create mode; in edit mode, either existing or new file must be present
    if (!isEditMode) {
      if (!selectedFile) {
        newErrors.file = t('contentHub.upload.fileRequired');
      } else {
        const ext = getFileExtension(selectedFile.name);
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          newErrors.file = t('contentHub.upload.fileFormatError');
        }
      }
    } else {
      // Edit mode: new file is optional, but if selected, validate format
      if (selectedFile) {
        const ext = getFileExtension(selectedFile.name);
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          newErrors.file = t('contentHub.upload.fileFormatError');
        }
      } else if (!existingFile) {
        newErrors.file = t('contentHub.upload.fileRequired');
      }
    }

    // Video URL: optional, but must be valid if provided
    const trimmedVideoUrl = videoUrl.trim();
    if (trimmedVideoUrl && !isValidUrl(trimmedVideoUrl)) {
      newErrors.videoUrl = t('contentHub.upload.videoUrlError');
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChooseFile = () => {
    const env = Taro.getEnv();
    if (env === Taro.ENV_TYPE.WEAPP) {
      // Mini program: use chooseMessageFile
      Taro.chooseMessageFile({
        count: 1,
        type: 'file',
        extension: ALLOWED_EXTENSIONS,
      }).then((res) => {
        if (res.tempFiles && res.tempFiles.length > 0) {
          const file = res.tempFiles[0];
          setSelectedFile({
            name: file.name,
            size: file.size,
            path: file.path,
          });
          setErrors((prev) => {
            const next = { ...prev };
            delete next.file;
            return next;
          });
        }
      }).catch(() => {
        Taro.showToast({ title: t('contentHub.upload.fileChooseFailed'), icon: 'none' });
      });
    } else {
      // H5: use file input — must be synchronous to avoid Safari popup blocker
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = '.ppt,.pptx,.pdf,.doc,.docx';
      input.onchange = (e: Event) => {
        const target = e.target as HTMLInputElement;
        if (target.files && target.files.length > 0) {
          const file = target.files[0];
          setSelectedFile({
            name: file.name,
            size: file.size,
            path: URL.createObjectURL(file),
          });
          (window as any).__uploadFile = file;
          setErrors((prev) => {
            const next = { ...prev };
            delete next.file;
            return next;
          });
        }
      };
      input.click();
    }
  };

  /** Upload a new file to S3 and return the fileKey */
  const uploadFileToS3 = async (file: { name: string; size: number; path: string }): Promise<{ fileKey: string }> => {
    const ext = getFileExtension(file.name);
    const contentType = EXTENSION_MIME_MAP[ext] || 'application/octet-stream';

    // Get presigned upload URL
    const uploadUrlRes = await request<UploadUrlResponse>({
      url: '/api/content/upload-url',
      method: 'POST',
      data: { fileName: file.name, contentType },
    });

    const { uploadUrl, fileKey } = uploadUrlRes;

    // Upload file to S3
    const env = Taro.getEnv();
    if (env === Taro.ENV_TYPE.WEB) {
      const rawFile = (window as any).__uploadFile as File;
      if (!rawFile) throw new Error(t('contentHub.upload.fileLost'));
      await uploadWithRetry(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: rawFile,
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        Taro.uploadFile({
          url: uploadUrl,
          filePath: file.path,
          name: 'file',
          header: { 'Content-Type': contentType },
          success: (res) => {
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(new Error(t('contentHub.upload.fileUploadFailed')));
            }
          },
          fail: () => reject(new Error(t('contentHub.upload.fileUploadFailed'))),
        });
      });
    }

    return { fileKey };
  };

  const handleCreateSubmit = async () => {
    if (!user || !selectedFile) return;

    const { fileKey } = await uploadFileToS3(selectedFile);

    const selectedCategory = categories[selectedCategoryIndex];
    const trimmedVideoUrl = videoUrl.trim();

    await request<CreateContentResponse>({
      url: '/api/content',
      method: 'POST',
      data: {
        title: title.trim(),
        description: description.trim(),
        categoryId: selectedCategory.categoryId,
        fileKey,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        ...(trimmedVideoUrl ? { videoUrl: trimmedVideoUrl } : {}),
        ...(tags.length > 0 ? { tags } : {}),
      },
    });

    Taro.showToast({ title: t('contentHub.upload.submitSuccess'), icon: 'success', duration: 2000 });
    setTimeout(() => {
      Taro.navigateBack({ delta: 1 }).catch(() => {
        Taro.redirectTo({ url: '/pages/content/index' });
      });
    }, 1500);
  };

  const handleEditSubmit = async () => {
    if (!user) return;
    const original = originalDataRef.current;
    if (!original) return;

    // Build changed fields only
    const data: Record<string, any> = {};

    const trimmedTitle = title.trim();
    if (trimmedTitle !== original.title) {
      data.title = trimmedTitle;
    }

    const trimmedDesc = description.trim();
    if (trimmedDesc !== original.description) {
      data.description = trimmedDesc;
    }

    const selectedCategory = categories[selectedCategoryIndex];
    if (selectedCategory && selectedCategory.categoryId !== original.categoryId) {
      data.categoryId = selectedCategory.categoryId;
    }

    const trimmedVideoUrl = videoUrl.trim();
    const originalVideoUrl = original.videoUrl || '';
    if (trimmedVideoUrl !== originalVideoUrl) {
      data.videoUrl = trimmedVideoUrl; // empty string means clear
    }

    // Compare tags with original and include if changed
    const originalTags = original.tags ?? [];
    const tagsChanged = tags.length !== originalTags.length || tags.some((t, i) => t !== originalTags[i]);
    if (tagsChanged) {
      data.tags = tags;
    }

    // If a new file was selected, upload it first
    if (selectedFile) {
      const { fileKey } = await uploadFileToS3(selectedFile);
      data.fileKey = fileKey;
      data.fileName = selectedFile.name;
      data.fileSize = selectedFile.size;
    }

    await request<EditContentResponse>({
      url: `/api/content/${editId}`,
      method: 'PUT',
      data,
    });

    Taro.showToast({ title: t('contentHub.upload.editSubmitSuccess'), icon: 'success', duration: 2000 });
    setTimeout(() => {
      // Navigate back to content detail page
      Taro.navigateBack({ delta: 1 }).catch(() => {
        Taro.redirectTo({ url: `/pages/content/detail?id=${editId}` });
      });
    }, 1500);
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (isEditMode) {
        await handleEditSubmit();
      } else {
        await handleCreateSubmit();
      }
    } catch (err: any) {
      if (err instanceof UploadError) {
        switch (err.type) {
          case 'TOKEN_EXPIRED':
            Taro.showToast({ title: t('upload.tokenExpired'), icon: 'none' });
            break;
          case 'NETWORK_ERROR':
            Taro.showToast({ title: t('upload.networkUnstable'), icon: 'none' });
            break;
          case 'SERVER_ERROR':
            Taro.showToast({ title: t('upload.serverError'), icon: 'none' });
            break;
        }
        return;
      }
      const failMsg = isEditMode
        ? t('contentHub.upload.editSubmitFailed')
        : t('contentHub.upload.submitFailed');
      Taro.showToast({ title: err?.message || failMsg, icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleCategoryChange = (e: any) => {
    const index = Number(e.detail.value);
    setSelectedCategoryIndex(index);
    setErrors((prev) => {
      const next = { ...prev };
      delete next.category;
      return next;
    });
  };

  const selectedCategory = selectedCategoryIndex >= 0 && selectedCategoryIndex < categories.length
    ? categories[selectedCategoryIndex]
    : null;

  // Determine which file info to display
  const displayFile = selectedFile || existingFile;
  const hasNewFile = !!selectedFile;

  // Page title and submit button text based on mode
  const pageTitle = isEditMode ? t('contentHub.upload.editTitle') : t('contentHub.upload.title');
  const submitButtonText = isEditMode
    ? (submitting ? t('contentHub.upload.editSubmitting') : t('contentHub.upload.editSubmitButton'))
    : (submitting ? t('contentHub.upload.submitting') : t('contentHub.upload.submitButton'));

  if (isEditMode && loadingDetail) {
    return (
      <View className='upload-page'>
        <PageToolbar title={pageTitle} onBack={handleBack} />
        <View className='upload-body'>
          <View className='upload-loading'>
            <Text className='upload-loading__text'>{t('common.loading')}</Text>
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className='upload-page'>
      {/* Header */}
      <PageToolbar title={pageTitle} onBack={handleBack} />

      <View className='upload-body'>
        {/* Status notice banner (edit mode only) */}
        {isEditMode && contentStatus === 'rejected' && (
          <View className='upload-status-notice upload-status-notice--error'>
            <Text>
              {rejectReason
                ? t('contentHub.upload.statusRejectedNotice', { reason: rejectReason })
                : t('contentHub.upload.statusRejectedGenericNotice')}
            </Text>
          </View>
        )}
        {isEditMode && contentStatus === 'pending' && (
          <View className='upload-status-notice upload-status-notice--warning'>
            <Text>{t('contentHub.upload.statusPendingNotice')}</Text>
          </View>
        )}

        {/* Title */}
        <View className='upload-field'>
          <Text className='upload-field__label'>{t('contentHub.upload.titleLabel')} <Text className='upload-field__required'>{t('contentHub.upload.requiredMark')}</Text></Text>
          <input
            className={`upload-field__input ${errors.title ? 'upload-field__input--error' : ''}`}
            placeholder={t('contentHub.upload.titlePlaceholder')}
            value={title}
            onInput={(e: any) => setTitle(e.target.value || e.detail?.value || '')}
            maxLength={100}
          />
          {errors.title && <Text className='upload-field__error'>{errors.title}</Text>}
        </View>

        {/* Description */}
        <View className='upload-field'>
          <Text className='upload-field__label'>{t('contentHub.upload.descriptionLabel')} <Text className='upload-field__required'>{t('contentHub.upload.requiredMark')}</Text></Text>
          <textarea
            className={`upload-field__textarea ${errors.description ? 'upload-field__textarea--error' : ''}`}
            placeholder={t('contentHub.upload.descriptionPlaceholder')}
            value={description}
            onInput={(e: any) => setDescription(e.target.value || e.detail?.value || '')}
            maxLength={2000}
          />
          <Text className='upload-field__counter'>{description.length}/2000</Text>
          {errors.description && <Text className='upload-field__error'>{errors.description}</Text>}
        </View>

        {/* Category */}
        <View className='upload-field'>
          <Text className='upload-field__label'>{t('contentHub.upload.categoryLabel')} <Text className='upload-field__required'>{t('contentHub.upload.requiredMark')}</Text></Text>
          <Picker
            mode='selector'
            range={categories.map((c) => c.name)}
            value={selectedCategoryIndex >= 0 ? selectedCategoryIndex : 0}
            onChange={handleCategoryChange}
          >
            <View className={`upload-field__select ${errors.category ? 'upload-field__select--error' : ''}`}>
              <Text className={selectedCategory ? 'upload-field__select-text' : 'upload-field__select-placeholder'}>
                {selectedCategory ? selectedCategory.name : t('contentHub.upload.categoryPlaceholder')}
              </Text>
              <Text className='upload-field__select-arrow'>▼</Text>
            </View>
          </Picker>
          {errors.category && <Text className='upload-field__error'>{errors.category}</Text>}
        </View>

        {/* File Upload */}
        <View className='upload-field'>
          <Text className='upload-field__label'>{t('contentHub.upload.fileLabel')} <Text className='upload-field__required'>{t('contentHub.upload.requiredMark')}</Text></Text>
          <View
            className={`upload-file-area ${errors.file ? 'upload-file-area--error' : ''}`}
            onClick={handleChooseFile}
          >
            {displayFile ? (
              <View className='upload-file-area__selected'>
                <Text className='upload-file-area__filename'>{displayFile.name}</Text>
                <Text className='upload-file-area__size'>
                  {(displayFile.size / 1024 / 1024).toFixed(2)} MB
                </Text>
                {isEditMode && !hasNewFile && (
                  <Text className='upload-file-area__hint'>{t('contentHub.upload.replaceFile')}</Text>
                )}
                {isEditMode && hasNewFile && (
                  <Text className='upload-file-area__hint-new'>{t('contentHub.upload.fileChoose')}</Text>
                )}
              </View>
            ) : (
              <View className='upload-file-area__empty'>
                <Text className='upload-file-area__icon'>+</Text>
                <Text className='upload-file-area__hint'>{t('contentHub.upload.fileChoose')}</Text>
                <Text className='upload-file-area__formats'>{t('contentHub.upload.fileFormats')}</Text>
              </View>
            )}
          </View>
          {errors.file && <Text className='upload-field__error'>{errors.file}</Text>}
        </View>

        {/* Video URL */}
        <View className='upload-field'>
          <Text className='upload-field__label'>{t('contentHub.upload.videoUrlLabel')} <Text className='upload-field__optional'>{t('contentHub.upload.videoUrlOptional')}</Text></Text>
          <input
            className={`upload-field__input ${errors.videoUrl ? 'upload-field__input--error' : ''}`}
            placeholder={t('contentHub.upload.videoUrlPlaceholder')}
            value={videoUrl}
            onInput={(e: any) => setVideoUrl(e.target.value || e.detail?.value || '')}
          />
          {errors.videoUrl && <Text className='upload-field__error'>{errors.videoUrl}</Text>}
        </View>

        {/* Tags */}
        <View className='upload-field'>
          <Text className='upload-field__label'>{t('contentHub.upload.tagsLabel')} <Text className='upload-field__optional'>{t('contentHub.upload.videoUrlOptional')}</Text></Text>
          <TagInput value={tags} onChange={setTags} />
        </View>

        {/* Submit Button */}
        <View className='upload-submit'>
          <View
            className={`btn-primary upload-submit__btn ${submitting ? 'btn-primary--disabled' : ''}`}
            onClick={handleSubmit}
          >
            <Text>{submitButtonText}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}
