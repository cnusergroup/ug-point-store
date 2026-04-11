import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { PackageIcon } from '../../components/icons';
import './products.scss';

interface ProductImage {
  key: string;
  url: string;
}

const MAX_IMAGES = 5;
const API_BASE = process.env.TARO_APP_API_BASE_URL || '';
const MAX_IMAGE_WIDTH = 800;
const MAX_IMAGE_HEIGHT = 500;

/**
 * Resize an image blob to fit within maxWidth × maxHeight, maintaining aspect ratio.
 * Returns a JPEG blob. Only runs in H5 (web) environment.
 */
async function resizeImage(blobUrl: string, maxW: number, maxH: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => {
      let { width, height } = img;
      // Scale down proportionally if exceeds max dimensions
      if (width > maxW || height > maxH) {
        const ratio = Math.min(maxW / width, maxH / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas not supported')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => blob ? resolve(blob) : reject(new Error('toBlob failed')),
        'image/jpeg',
        0.85,
      );
    };
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = blobUrl;
  });
}

interface SizeOption {
  name: string;
  stock: number;
}

interface AdminProduct {
  productId: string;
  name: string;
  description: string;
  imageUrl: string;
  type: 'points' | 'code_exclusive';
  status: 'active' | 'inactive';
  stock: number;
  redemptionCount: number;
  pointsCost?: number;
  allowedRoles?: UserRole[] | 'all';
  eventInfo?: string;
  images?: ProductImage[];
  sizeOptions?: SizeOption[];
  purchaseLimitEnabled?: boolean;
  purchaseLimitCount?: number;
}

const ALL_ROLES: UserRole[] = ['UserGroupLeader', 'CommunityBuilder', 'Speaker', 'Volunteer'];
const ROLE_LABELS: Record<UserRole, string> = {
  UserGroupLeader: 'Leader',
  CommunityBuilder: 'Builder',
  Speaker: 'Speaker',
  Volunteer: 'Volunteer',
  Admin: 'Admin',
  SuperAdmin: 'SuperAdmin',
};

type FormMode = 'hidden' | 'create' | 'edit';

const EMPTY_FORM = {
  name: '',
  description: '',
  imageUrl: '',
  type: 'points' as 'points' | 'code_exclusive',
  stock: '',
  pointsCost: '',
  allowedRoles: [] as UserRole[],
  allRoles: true,
  eventInfo: '',
  images: [] as ProductImage[],
  sizeEnabled: false,
  sizeOptions: [] as SizeOption[],
  newSizeName: '',
  purchaseLimitEnabled: false,
  purchaseLimitCount: '',
};

export default function AdminProductsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();

  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<FormMode>('hidden');
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<{ items: AdminProduct[] }>({
        url: '/api/products?pageSize=200&includeInactive=true',
      });
      setProducts(res.items);
    } catch {
      setProducts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchProducts();
  }, [isAuthenticated, fetchProducts]);

  const openCreate = () => {
    setForm({ ...EMPTY_FORM });
    setEditingId('');
    setFormMode('create');
    setError('');
  };

  const openEdit = (product: AdminProduct) => {
    const hasSizes = Array.isArray(product.sizeOptions) && product.sizeOptions.length > 0;
    setForm({
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      type: product.type,
      stock: String(product.stock),
      pointsCost: product.pointsCost != null ? String(product.pointsCost) : '',
      allowedRoles: product.allowedRoles === 'all' ? [] : (product.allowedRoles || []),
      allRoles: product.allowedRoles === 'all',
      eventInfo: product.eventInfo || '',
      images: product.images || [],
      sizeEnabled: hasSizes,
      sizeOptions: hasSizes ? product.sizeOptions! : [],
      newSizeName: '',
      purchaseLimitEnabled: product.purchaseLimitEnabled || false,
      purchaseLimitCount: product.purchaseLimitCount != null ? String(product.purchaseLimitCount) : '',
    });
    setEditingId(product.productId);
    setFormMode('edit');
    setError('');
  };

  const closeForm = () => {
    setFormMode('hidden');
    setError('');
  };

  const toggleRole = (role: UserRole) => {
    setForm((prev) => {
      const has = prev.allowedRoles.includes(role);
      return {
        ...prev,
        allowedRoles: has
          ? prev.allowedRoles.filter((r) => r !== role)
          : [...prev.allowedRoles, role],
      };
    });
  };

  const handleUploadImage = async () => {
    if (formMode === 'edit' && !editingId) {
      setError(t('admin.products.saveBeforeUpload'));
      return;
    }
    if (form.images.length >= MAX_IMAGES) return;

    try {
      const remaining = MAX_IMAGES - form.images.length;
      const chooseRes = await Taro.chooseImage({ count: remaining, sizeType: ['compressed'] });
      if (!chooseRes.tempFilePaths || chooseRes.tempFilePaths.length === 0) return;

      // Upload all selected files sequentially
      let currentImages = [...form.images];
      for (let i = 0; i < chooseRes.tempFilePaths.length; i++) {
        if (currentImages.length >= MAX_IMAGES) break;
        const filePath = chooseRes.tempFilePaths[i];

        // In H5 mode, filePath is a blob URL without a proper extension.
        // Try to get the real file name from tempFiles, otherwise derive from content type.
        let fileName = 'image.jpg';
        let contentType = 'image/jpeg';

        const tempFile = (chooseRes as any).tempFiles?.[i];
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

        setUploading(true);
        setError('');

        const uploadFileName = fileName.replace(/\.\w+$/, '.jpg');
        const uploadContentType = 'image/jpeg';

        const uploadUrlEndpoint = formMode === 'create'
          ? '/api/admin/images/upload-url'
          : `/api/admin/products/${editingId}/upload-url`;

        const uploadInfo = await request<{ uploadUrl: string; key: string; url: string }>({
          url: uploadUrlEndpoint,
          method: 'POST',
          data: { fileName: uploadFileName, contentType: uploadContentType },
        });

        const env = Taro.getEnv();
        if (env === Taro.ENV_TYPE.WEB) {
          const fileObj = (chooseRes as any).tempFiles?.[i]?.originalFileObj as File | undefined;
          let uploadBody: Blob;
          if (fileObj) {
            try {
              const blobUrl = URL.createObjectURL(fileObj);
              uploadBody = await resizeImage(blobUrl, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT);
              URL.revokeObjectURL(blobUrl);
            } catch {
              uploadBody = fileObj;
            }
          } else {
            const resp = await fetch(filePath);
            uploadBody = await resp.blob();
          }
          await fetch(uploadInfo.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': uploadContentType },
            body: uploadBody,
          });
        } else {
          await Taro.uploadFile({
            url: uploadInfo.uploadUrl,
            filePath,
            name: 'file',
            header: { 'Content-Type': uploadContentType },
          });
        }

        const newImage: ProductImage = { key: uploadInfo.key, url: uploadInfo.url };
        currentImages = [...currentImages, newImage];

        if (formMode === 'edit') {
          const newImageUrl = currentImages[0].url;
          await request({
            url: `/api/admin/products/${editingId}`,
            method: 'PUT',
            data: { images: currentImages, imageUrl: newImageUrl },
          });
        }
      }

      const newImageUrl = currentImages[0]?.url || '';
      setForm((p) => ({ ...p, images: currentImages, imageUrl: newImageUrl }));
      Taro.showToast({ title: t('admin.products.uploadSuccess'), icon: 'success' });
    } catch (err: any) {
      // Silently ignore user cancellation (errMsg contains 'cancel' or 'fail cancel')
      const msg = err?.errMsg || err?.message || '';
      if (msg.includes('cancel') || msg.includes('Cancel') || msg.includes('取消')) return;
      setError(err instanceof RequestError ? err.message : t('admin.products.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (index: number) => {
    const image = form.images[index];
    if (!image) return;

    // In create mode, images are only in local state (not yet saved to backend)
    if (formMode === 'create') {
      const updatedImages = form.images.filter((_, i) => i !== index);
      const newImageUrl = updatedImages.length > 0 ? updatedImages[0].url : '';
      setForm((p) => ({ ...p, images: updatedImages, imageUrl: newImageUrl }));
      return;
    }

    if (!editingId) return;

    try {
      // Extract the filename part from the key for the DELETE API
      const keyParts = image.key.split('/');
      const imageFileName = keyParts[keyParts.length - 1];
      await request({
        url: `/api/admin/products/${editingId}/images/${imageFileName}`,
        method: 'DELETE',
      });

      const updatedImages = form.images.filter((_, i) => i !== index);
      const newImageUrl = updatedImages.length > 0 ? updatedImages[0].url : '';
      setForm((p) => ({ ...p, images: updatedImages, imageUrl: newImageUrl }));
      Taro.showToast({ title: t('admin.products.deleted'), icon: 'success' });
    } catch (err) {
      setError(err instanceof RequestError ? err.message : t('admin.products.deleteFailed'));
    }
  };

  const handleMoveImage = async (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= form.images.length) return;

    const updatedImages = [...form.images];
    const [moved] = updatedImages.splice(fromIndex, 1);
    updatedImages.splice(toIndex, 0, moved);
    const newImageUrl = updatedImages.length > 0 ? updatedImages[0].url : '';

    setForm((p) => ({ ...p, images: updatedImages, imageUrl: newImageUrl }));

    // In create mode, no backend call needed
    if (formMode === 'create' || !editingId) return;

    try {
      await request({
        url: `/api/admin/products/${editingId}`,
        method: 'PUT',
        data: { images: updatedImages, imageUrl: newImageUrl },
      });
    } catch (err) {
      // Revert on failure
      setForm((p) => ({ ...p, images: form.images, imageUrl: form.imageUrl }));
      setError(t('admin.products.sortFailed'));
    }
  };

  const handleAddSize = () => {
    const name = form.newSizeName.trim();
    if (!name) return;
    if (form.sizeOptions.some((s) => s.name === name)) {
      setError(t('admin.products.sizeDuplicate'));
      return;
    }
    setForm((p) => ({
      ...p,
      sizeOptions: [...p.sizeOptions, { name, stock: 0 }],
      newSizeName: '',
    }));
    setError('');
  };

  const handleDeleteSize = (index: number) => {
    setForm((p) => ({
      ...p,
      sizeOptions: p.sizeOptions.filter((_, i) => i !== index),
    }));
  };

  const handleSizeStockChange = (index: number, value: string) => {
    const stock = Math.max(0, Math.floor(Number(value) || 0));
    setForm((p) => {
      const updated = [...p.sizeOptions];
      updated[index] = { ...updated[index], stock };
      return { ...p, sizeOptions: updated };
    });
  };

  const sizeTotalStock = form.sizeOptions.reduce((sum, s) => sum + s.stock, 0);

  const handleSubmit = async () => {
    if (!form.name.trim()) { setError(t('admin.products.errorNameRequired')); return; }
    if (form.sizeEnabled) {
      if (form.sizeOptions.length === 0) { setError(t('admin.products.errorSizeRequired')); return; }
    } else {
      if (!form.stock || Number(form.stock) < 0) { setError(t('admin.products.errorStockRequired')); return; }
    }
    if (form.type === 'points' && (!form.pointsCost || Number(form.pointsCost) <= 0)) {
      setError(t('admin.products.errorPointsCostRequired'));
      return;
    }
    if (form.purchaseLimitEnabled) {
      const limitCount = Number(form.purchaseLimitCount);
      if (!form.purchaseLimitCount || !Number.isInteger(limitCount) || limitCount < 1) {
        setError(t('admin.products.purchaseLimitError'));
        return;
      }
    }

    setSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        description: form.description.trim(),
        imageUrl: form.imageUrl.trim(),
        type: form.type,
        stock: form.sizeEnabled ? sizeTotalStock : Number(form.stock),
        images: form.images,
      };
      if (form.sizeEnabled) {
        body.sizeOptions = form.sizeOptions;
      } else {
        body.sizeOptions = undefined;
      }
      if (form.type === 'points') {
        body.pointsCost = Number(form.pointsCost);
        body.allowedRoles = form.allRoles ? 'all' : form.allowedRoles;
      } else {
        body.eventInfo = form.eventInfo.trim();
      }

      if (form.purchaseLimitEnabled) {
        body.purchaseLimitEnabled = true;
        body.purchaseLimitCount = Number(form.purchaseLimitCount);
      } else {
        body.purchaseLimitEnabled = false;
      }

      if (formMode === 'create') {
        await request({ url: '/api/admin/products', method: 'POST', data: body });
      } else {
        await request({ url: `/api/admin/products/${editingId}`, method: 'PUT', data: body });
      }
      closeForm();
      fetchProducts();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : t('common.operationFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  const toggleStatus = async (product: AdminProduct) => {
    const newStatus = product.status === 'active' ? 'inactive' : 'active';
    try {
      await request({
        url: `/api/admin/products/${product.productId}/status`,
        method: 'PATCH',
        data: { status: newStatus },
      });
      fetchProducts();
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('common.operationFailed'),
        icon: 'none',
      });
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-products'>
      <View className='admin-products__toolbar'>
        <View className='admin-products__back' onClick={handleBack}>
          <Text>{t('admin.products.backButton')}</Text>
        </View>
        <Text className='admin-products__title'>{t('admin.products.title')}</Text>
        <View className='admin-products__add-btn' onClick={openCreate}>
          <Text>{t('admin.products.createProduct')}</Text>
        </View>
      </View>

      {/* Product Form Modal */}
      {formMode !== 'hidden' && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>
                {formMode === 'create' ? t('admin.products.createTitle') : t('admin.products.editTitle')}
              </Text>
              <View className='form-modal__close' onClick={closeForm}>
                <Text>✕</Text>
              </View>
            </View>

            {error && (
              <View className='form-modal__error'>
                <Text>{error}</Text>
              </View>
            )}

            <View className='form-modal__body'>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.products.productTypeLabel')}</Text>
                <View className='form-field__type-toggle'>
                  <View
                    className={`form-field__type-opt ${form.type === 'points' ? 'form-field__type-opt--active' : ''}`}
                    onClick={() => setForm((p) => ({ ...p, type: 'points' }))}
                  >
                    <Text>{t('admin.products.typePoints')}</Text>
                  </View>
                  <View
                    className={`form-field__type-opt ${form.type === 'code_exclusive' ? 'form-field__type-opt--active' : ''}`}
                    onClick={() => setForm((p) => ({ ...p, type: 'code_exclusive' }))}
                  >
                    <Text>{t('admin.products.typeCodeExclusive')}</Text>
                  </View>
                </View>
              </View>

              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.products.nameLabel')}</Text>
                <Input
                  className='form-field__input'
                  value={form.name}
                  onInput={(e) => setForm((p) => ({ ...p, name: e.detail.value }))}
                  placeholder={t('admin.products.namePlaceholder')}
                />
              </View>

              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.products.descriptionLabel')}</Text>
                <textarea
                  className='form-field__textarea'
                  value={form.description}
                  onChange={(e) => setForm((p) => ({ ...p, description: (e.target as HTMLTextAreaElement).value }))}
                  placeholder={t('admin.products.descriptionPlaceholder')}
                />
              </View>

              <View className='form-field'>
                <Text className='form-field__label'>
                  {t('admin.products.imagesLabel')} ({form.images.length}/{MAX_IMAGES})
                </Text>
                <Text className='image-upload__size-hint'>{t('admin.products.imageSizeHint')}</Text>

                {/* Image thumbnails */}
                {form.images.length > 0 && (
                  <View className='image-upload__list'>
                    {form.images.map((img, idx) => (
                      <View key={img.key} className='image-upload__item'>
                        <Image
                          className='image-upload__thumb'
                          src={`${API_BASE}${img.url}`}
                          mode='aspectFill'
                          onClick={() => setPreviewUrl(`${API_BASE}${img.url}`)}
                        />
                        {idx === 0 && (
                          <Text className='image-upload__cover-tag'>{t('admin.products.coverTag')}</Text>
                        )}
                        <View className='image-upload__actions'>
                          {idx > 0 && (
                            <View
                              className='image-upload__action-btn'
                              onClick={(e) => { e.stopPropagation(); handleMoveImage(idx, idx - 1); }}
                            >
                              <Text>◀</Text>
                            </View>
                          )}
                          {idx < form.images.length - 1 && (
                            <View
                              className='image-upload__action-btn'
                              onClick={(e) => { e.stopPropagation(); handleMoveImage(idx, idx + 1); }}
                            >
                              <Text>▶</Text>
                            </View>
                          )}
                          <View
                            className='image-upload__action-btn image-upload__action-btn--delete'
                            onClick={(e) => { e.stopPropagation(); handleDeleteImage(idx); }}
                          >
                            <Text>✕</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Upload button - hidden when at max */}
                {form.images.length < MAX_IMAGES && (
                  <View
                    className={`image-upload__btn ${uploading ? 'image-upload__btn--loading' : ''}`}
                    onClick={!uploading ? handleUploadImage : undefined}
                  >
                    <Text>{uploading ? t('admin.products.uploading') : t('admin.products.uploadImage')}</Text>
                  </View>
                )}
              </View>

              {/* Size Options Toggle & Configuration */}
              <View className='form-field'>
                <View
                  className={`form-field__check ${form.sizeEnabled ? 'form-field__check--active' : ''}`}
                  onClick={() => setForm((p) => ({ ...p, sizeEnabled: !p.sizeEnabled }))}
                >
                  <Text>{form.sizeEnabled ? '☑' : '☐'} {t('admin.products.enableSizeOptions')}</Text>
                </View>
              </View>

              {form.sizeEnabled ? (
                <View className='form-field'>
                  <Text className='form-field__label'>{t('admin.products.sizeConfigLabel')}</Text>
                  <View className='size-config'>
                    {form.sizeOptions.map((size, idx) => (
                      <View key={size.name} className='size-config__item'>
                        <Text className='size-config__name'>{size.name}</Text>
                        <Input
                          className='size-config__stock-input'
                          type='number'
                          value={String(size.stock)}
                          onInput={(e) => handleSizeStockChange(idx, e.detail.value)}
                          placeholder={t('admin.products.stockLabel')}
                        />
                        <View
                          className='size-config__delete'
                          onClick={() => handleDeleteSize(idx)}
                        >
                          <Text>✕</Text>
                        </View>
                      </View>
                    ))}
                    <View className='size-config__add'>
                      <Input
                        className='size-config__add-input'
                        value={form.newSizeName}
                        onInput={(e) => setForm((p) => ({ ...p, newSizeName: e.detail.value }))}
                        placeholder={t('admin.products.sizeNamePlaceholder')}
                      />
                      <View className='size-config__add-btn' onClick={handleAddSize}>
                        <Text>{t('admin.products.addSize')}</Text>
                      </View>
                    </View>
                  </View>
                  <Text className='form-field__label' style={{ marginTop: 'var(--space-2)' }}>
                    {t('admin.products.totalStock', { count: sizeTotalStock })}
                  </Text>
                </View>
              ) : (
                <View className='form-field'>
                  <Text className='form-field__label'>{t('admin.products.stockLabel')}</Text>
                  <Input
                    className='form-field__input'
                    type='number'
                    value={form.stock}
                    onInput={(e) => setForm((p) => ({ ...p, stock: e.detail.value }))}
                    placeholder={t('admin.products.stockPlaceholder')}
                  />
                </View>
              )}

              {/* Purchase Limit Toggle & Input */}
              <View className='form-field'>
                <View
                  className={`form-field__check ${form.purchaseLimitEnabled ? 'form-field__check--active' : ''}`}
                  onClick={() => setForm((p) => ({ ...p, purchaseLimitEnabled: !p.purchaseLimitEnabled }))}
                >
                  <Text>{form.purchaseLimitEnabled ? '☑' : '☐'} {t('admin.products.enablePurchaseLimit')}</Text>
                </View>
              </View>

              {form.purchaseLimitEnabled && (
                <View className='form-field'>
                  <Text className='form-field__label'>{t('admin.products.purchaseLimitLabel')}</Text>
                  <Input
                    className='form-field__input'
                    type='number'
                    value={form.purchaseLimitCount}
                    onInput={(e) => setForm((p) => ({ ...p, purchaseLimitCount: e.detail.value }))}
                    placeholder={t('admin.products.purchaseLimitPlaceholder')}
                  />
                </View>
              )}

              {form.type === 'points' && (
                <>
                  <View className='form-field'>
                    <Text className='form-field__label'>{t('admin.products.pointsCostLabel')}</Text>
                    <Input
                      className='form-field__input'
                      type='number'
                      value={form.pointsCost}
                      onInput={(e) => setForm((p) => ({ ...p, pointsCost: e.detail.value }))}
                      placeholder={t('admin.products.pointsCostPlaceholder')}
                    />
                  </View>

                  <View className='form-field'>
                    <Text className='form-field__label'>{t('admin.products.allowedRolesLabel')}</Text>
                    <View
                      className={`form-field__check ${form.allRoles ? 'form-field__check--active' : ''}`}
                      onClick={() => setForm((p) => ({ ...p, allRoles: !p.allRoles }))}
                    >
                      <Text>{form.allRoles ? '☑' : '☐'} {t('admin.products.allRolesRedeemable')}</Text>
                    </View>
                    {!form.allRoles && (
                      <View className='form-field__roles'>
                        {ALL_ROLES.map((role) => (
                          <View
                            key={role}
                            className={`form-field__check ${form.allowedRoles.includes(role) ? 'form-field__check--active' : ''}`}
                            onClick={() => toggleRole(role)}
                          >
                            <Text>
                              {form.allowedRoles.includes(role) ? '☑' : '☐'} {ROLE_LABELS[role]}
                            </Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </>
              )}

              {form.type === 'code_exclusive' && (
                <View className='form-field'>
                  <Text className='form-field__label'>{t('admin.products.eventInfoLabel')}</Text>
                  <textarea
                    className='form-field__textarea'
                    value={form.eventInfo}
                    onChange={(e) => setForm((p) => ({ ...p, eventInfo: (e.target as HTMLTextAreaElement).value }))}
                    placeholder={t('admin.products.eventInfoPlaceholder')}
                  />
                </View>
              )}
            </View>

            <View
              className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
              onClick={handleSubmit}
            >
              <Text>{submitting ? t('admin.products.submitting') : formMode === 'create' ? t('admin.products.submitCreate') : t('admin.products.submitSave')}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Image Preview Lightbox */}
      {previewUrl && (
        <View
          className='image-preview-overlay'
          onClick={() => setPreviewUrl(null)}
        >
          <img
            className='image-preview-img'
            src={previewUrl}
            onClick={(e) => e.stopPropagation()}
            alt='preview'
          />
          <View className='image-preview-close' onClick={() => setPreviewUrl(null)}>
            <Text>✕</Text>
          </View>
        </View>
      )}

      {/* Product List */}
      {loading ? (
        <View className='admin-loading'>
          <Text>{t('admin.products.loading')}</Text>
        </View>
      ) : products.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'><PackageIcon size={48} color='var(--text-tertiary)' /></Text>
          <Text className='admin-empty__text'>{t('admin.products.noProducts')}</Text>
        </View>
      ) : (
        <View className='product-list'>
          {products.map((product) => (
            <View key={product.productId} className='product-row'>
              <View className='product-row__main'>
                <View className='product-row__info'>
                  <View className='product-row__name-line'>
                    <Text className='product-row__name'>{product.name}</Text>
                    <Text className={`product-row__type ${product.type === 'code_exclusive' ? 'product-row__type--code' : ''}`}>
                      {product.type === 'points' ? t('admin.products.typePoints') : 'CODE'}
                    </Text>
                    <Text className={`product-row__status ${product.status === 'active' ? 'product-row__status--active' : 'product-row__status--inactive'}`}>
                      {product.status === 'active' ? t('admin.products.statusActive') : t('admin.products.statusInactive')}
                    </Text>
                  </View>
                  <View className='product-row__stats'>
                    <Text className='product-row__stat'>{t('admin.products.stockStat', { count: product.stock })}</Text>
                    <Text className='product-row__stat'>{t('admin.products.redemptionStat', { count: product.redemptionCount })}</Text>
                    {product.type === 'points' && product.pointsCost != null && (
                      <Text className='product-row__stat'>◆ {product.pointsCost}</Text>
                    )}
                  </View>
                </View>
                <View className='product-row__actions'>
                  <View className='product-row__btn' onClick={() => openEdit(product)}>
                    <Text>{t('admin.products.actionEdit')}</Text>
                  </View>
                  <View
                    className={`product-row__btn ${product.status === 'active' ? 'product-row__btn--danger' : 'product-row__btn--success'}`}
                    onClick={() => toggleStatus(product)}
                  >
                    <Text>{product.status === 'active' ? t('admin.products.actionDeactivate') : t('admin.products.actionActivate')}</Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}
