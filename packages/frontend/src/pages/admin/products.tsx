import { useState, useEffect, useCallback } from 'react';
import { View, Text, Input, Textarea, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore, UserRole } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
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

  const [products, setProducts] = useState<AdminProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<FormMode>('hidden');
  const [editingId, setEditingId] = useState('');
  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);

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
    if (!editingId) {
      setError('请先保存商品后再上传图片');
      return;
    }
    if (form.images.length >= MAX_IMAGES) return;

    try {
      const chooseRes = await Taro.chooseImage({ count: 1, sizeType: ['compressed'] });
      const filePath = chooseRes.tempFilePaths[0];

      // In H5 mode, filePath is a blob URL without a proper extension.
      // Try to get the real file name from tempFiles, otherwise derive from content type.
      let fileName = 'image.jpg';
      let contentType = 'image/jpeg';

      const tempFile = (chooseRes as any).tempFiles?.[0];
      if (tempFile?.originalFileObj?.name) {
        // H5: File object has the real name
        fileName = tempFile.originalFileObj.name;
      } else if (tempFile?.type) {
        // H5: use MIME type to derive extension
        const typeExtMap: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
        const ext = typeExtMap[tempFile.type] || 'jpg';
        fileName = `image.${ext}`;
        contentType = tempFile.type;
      } else {
        // Fallback: try to extract from path
        const pathName = filePath.split('/').pop() || '';
        if (pathName.includes('.')) {
          fileName = pathName;
        }
      }

      // Determine content type from extension
      const ext = fileName.split('.').pop()?.toLowerCase() || 'jpg';
      const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
      contentType = mimeMap[ext] || contentType;

      setUploading(true);
      setError('');

      // Step 1: Get presigned URL from backend
      // Always use JPEG after resize
      const uploadFileName = fileName.replace(/\.\w+$/, '.jpg');
      const uploadContentType = 'image/jpeg';

      const uploadInfo = await request<{ uploadUrl: string; key: string; url: string }>({
        url: `/api/admin/products/${editingId}/upload-url`,
        method: 'POST',
        data: { fileName: uploadFileName, contentType: uploadContentType },
      });

      // Step 2: Resize and upload
      const env = Taro.getEnv();
      if (env === Taro.ENV_TYPE.WEB) {
        // Web: resize image on canvas, then upload the resized blob
        const resizedBlob = await resizeImage(filePath, MAX_IMAGE_WIDTH, MAX_IMAGE_HEIGHT);
        await fetch(uploadInfo.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': uploadContentType },
          body: resizedBlob,
        });
      } else {
        // Mini-program: upload original (no canvas resize in mini-program context)
        await Taro.uploadFile({
          url: uploadInfo.uploadUrl,
          filePath,
          name: 'file',
          header: { 'Content-Type': uploadContentType },
        });
      }

      // Step 3: Update product images array
      const newImage: ProductImage = { key: uploadInfo.key, url: uploadInfo.url };
      const updatedImages = [...form.images, newImage];
      const newImageUrl = updatedImages[0].url;

      await request({
        url: `/api/admin/products/${editingId}`,
        method: 'PUT',
        data: { images: updatedImages, imageUrl: newImageUrl },
      });

      setForm((p) => ({ ...p, images: updatedImages, imageUrl: newImageUrl }));
      Taro.showToast({ title: '上传成功', icon: 'success' });
    } catch (err) {
      setError(err instanceof RequestError ? err.message : '图片上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteImage = async (index: number) => {
    if (!editingId) return;
    const image = form.images[index];
    if (!image) return;

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
      Taro.showToast({ title: '已删除', icon: 'success' });
    } catch (err) {
      setError(err instanceof RequestError ? err.message : '删除失败');
    }
  };

  const handleMoveImage = async (fromIndex: number, toIndex: number) => {
    if (!editingId || toIndex < 0 || toIndex >= form.images.length) return;

    const updatedImages = [...form.images];
    const [moved] = updatedImages.splice(fromIndex, 1);
    updatedImages.splice(toIndex, 0, moved);
    const newImageUrl = updatedImages.length > 0 ? updatedImages[0].url : '';

    setForm((p) => ({ ...p, images: updatedImages, imageUrl: newImageUrl }));

    try {
      await request({
        url: `/api/admin/products/${editingId}`,
        method: 'PUT',
        data: { images: updatedImages, imageUrl: newImageUrl },
      });
    } catch (err) {
      // Revert on failure
      setForm((p) => ({ ...p, images: form.images, imageUrl: form.imageUrl }));
      setError('排序保存失败');
    }
  };

  const handleAddSize = () => {
    const name = form.newSizeName.trim();
    if (!name) return;
    if (form.sizeOptions.some((s) => s.name === name)) {
      setError('尺码名称不能重复');
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
    if (!form.name.trim()) { setError('请输入商品名称'); return; }
    if (form.sizeEnabled) {
      if (form.sizeOptions.length === 0) { setError('请至少添加一个尺码'); return; }
    } else {
      if (!form.stock || Number(form.stock) < 0) { setError('请输入有效库存'); return; }
    }
    if (form.type === 'points' && (!form.pointsCost || Number(form.pointsCost) <= 0)) {
      setError('请输入有效积分价格');
      return;
    }
    if (form.purchaseLimitEnabled) {
      const limitCount = Number(form.purchaseLimitCount);
      if (!form.purchaseLimitCount || !Number.isInteger(limitCount) || limitCount < 1) {
        setError('请设置有效的限购数量（至少为 1）');
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
      setError(err instanceof RequestError ? err.message : '操作失败');
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
        title: err instanceof RequestError ? err.message : '操作失败',
        icon: 'none',
      });
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-products'>
      <View className='admin-products__toolbar'>
        <View className='admin-products__back' onClick={handleBack}>
          <Text>‹ 返回</Text>
        </View>
        <Text className='admin-products__title'>商品管理</Text>
        <View className='admin-products__add-btn' onClick={openCreate}>
          <Text>+ 创建商品</Text>
        </View>
      </View>

      {/* Product Form Modal */}
      {formMode !== 'hidden' && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>
                {formMode === 'create' ? '创建商品' : '编辑商品'}
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
                <Text className='form-field__label'>商品类型</Text>
                <View className='form-field__type-toggle'>
                  <View
                    className={`form-field__type-opt ${form.type === 'points' ? 'form-field__type-opt--active' : ''}`}
                    onClick={() => setForm((p) => ({ ...p, type: 'points' }))}
                  >
                    <Text>积分商品</Text>
                  </View>
                  <View
                    className={`form-field__type-opt ${form.type === 'code_exclusive' ? 'form-field__type-opt--active' : ''}`}
                    onClick={() => setForm((p) => ({ ...p, type: 'code_exclusive' }))}
                  >
                    <Text>Code 专属</Text>
                  </View>
                </View>
              </View>

              <View className='form-field'>
                <Text className='form-field__label'>商品名称</Text>
                <Input
                  className='form-field__input'
                  value={form.name}
                  onInput={(e) => setForm((p) => ({ ...p, name: e.detail.value }))}
                  placeholder='输入商品名称'
                />
              </View>

              <View className='form-field'>
                <Text className='form-field__label'>描述</Text>
                <Textarea
                  className='form-field__textarea'
                  value={form.description}
                  onInput={(e) => setForm((p) => ({ ...p, description: e.detail.value }))}
                  placeholder='输入商品描述'
                />
              </View>

              <View className='form-field'>
                <Text className='form-field__label'>
                  商品图片 ({form.images.length}/{MAX_IMAGES})
                </Text>
                <Text className='image-upload__size-hint'>建议尺寸 800×500，上传时自动缩放</Text>

                {/* Image thumbnails */}
                {form.images.length > 0 && (
                  <View className='image-upload__list'>
                    {form.images.map((img, idx) => (
                      <View key={img.key} className='image-upload__item'>
                        <Image
                          className='image-upload__thumb'
                          src={`${API_BASE}${img.url}`}
                          mode='aspectFill'
                        />
                        {idx === 0 && (
                          <Text className='image-upload__cover-tag'>封面</Text>
                        )}
                        <View className='image-upload__actions'>
                          {idx > 0 && (
                            <View
                              className='image-upload__action-btn'
                              onClick={() => handleMoveImage(idx, idx - 1)}
                            >
                              <Text>◀</Text>
                            </View>
                          )}
                          {idx < form.images.length - 1 && (
                            <View
                              className='image-upload__action-btn'
                              onClick={() => handleMoveImage(idx, idx + 1)}
                            >
                              <Text>▶</Text>
                            </View>
                          )}
                          <View
                            className='image-upload__action-btn image-upload__action-btn--delete'
                            onClick={() => handleDeleteImage(idx)}
                          >
                            <Text>✕</Text>
                          </View>
                        </View>
                      </View>
                    ))}
                  </View>
                )}

                {/* Upload button - hidden when at max */}
                {formMode === 'edit' && form.images.length < MAX_IMAGES && (
                  <View
                    className={`image-upload__btn ${uploading ? 'image-upload__btn--loading' : ''}`}
                    onClick={!uploading ? handleUploadImage : undefined}
                  >
                    <Text>{uploading ? '上传中...' : '+ 上传图片'}</Text>
                  </View>
                )}

                {formMode === 'create' && (
                  <Text className='image-upload__hint'>请先创建商品后再上传图片</Text>
                )}
              </View>

              {/* Size Options Toggle & Configuration */}
              <View className='form-field'>
                <View
                  className={`form-field__check ${form.sizeEnabled ? 'form-field__check--active' : ''}`}
                  onClick={() => setForm((p) => ({ ...p, sizeEnabled: !p.sizeEnabled }))}
                >
                  <Text>{form.sizeEnabled ? '☑' : '☐'} 启用尺码选项</Text>
                </View>
              </View>

              {form.sizeEnabled ? (
                <View className='form-field'>
                  <Text className='form-field__label'>尺码配置</Text>
                  <View className='size-config'>
                    {form.sizeOptions.map((size, idx) => (
                      <View key={size.name} className='size-config__item'>
                        <Text className='size-config__name'>{size.name}</Text>
                        <Input
                          className='size-config__stock-input'
                          type='number'
                          value={String(size.stock)}
                          onInput={(e) => handleSizeStockChange(idx, e.detail.value)}
                          placeholder='库存'
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
                        placeholder='输入尺码名称，如 S、M、L'
                      />
                      <View className='size-config__add-btn' onClick={handleAddSize}>
                        <Text>添加</Text>
                      </View>
                    </View>
                  </View>
                  <Text className='form-field__label' style={{ marginTop: 'var(--space-2)' }}>
                    总库存：{sizeTotalStock}
                  </Text>
                </View>
              ) : (
                <View className='form-field'>
                  <Text className='form-field__label'>库存</Text>
                  <Input
                    className='form-field__input'
                    type='number'
                    value={form.stock}
                    onInput={(e) => setForm((p) => ({ ...p, stock: e.detail.value }))}
                    placeholder='输入库存数量'
                  />
                </View>
              )}

              {/* Purchase Limit Toggle & Input */}
              <View className='form-field'>
                <View
                  className={`form-field__check ${form.purchaseLimitEnabled ? 'form-field__check--active' : ''}`}
                  onClick={() => setForm((p) => ({ ...p, purchaseLimitEnabled: !p.purchaseLimitEnabled }))}
                >
                  <Text>{form.purchaseLimitEnabled ? '☑' : '☐'} 启用限购</Text>
                </View>
              </View>

              {form.purchaseLimitEnabled && (
                <View className='form-field'>
                  <Text className='form-field__label'>每人限购数量</Text>
                  <Input
                    className='form-field__input'
                    type='number'
                    value={form.purchaseLimitCount}
                    onInput={(e) => setForm((p) => ({ ...p, purchaseLimitCount: e.detail.value }))}
                    placeholder='输入限购数量'
                  />
                </View>
              )}

              {form.type === 'points' && (
                <>
                  <View className='form-field'>
                    <Text className='form-field__label'>所需积分</Text>
                    <Input
                      className='form-field__input'
                      type='number'
                      value={form.pointsCost}
                      onInput={(e) => setForm((p) => ({ ...p, pointsCost: e.detail.value }))}
                      placeholder='输入积分价格'
                    />
                  </View>

                  <View className='form-field'>
                    <Text className='form-field__label'>可兑换身份</Text>
                    <View
                      className={`form-field__check ${form.allRoles ? 'form-field__check--active' : ''}`}
                      onClick={() => setForm((p) => ({ ...p, allRoles: !p.allRoles }))}
                    >
                      <Text>{form.allRoles ? '☑' : '☐'} 所有人可兑换</Text>
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
                  <Text className='form-field__label'>关联活动信息</Text>
                  <Textarea
                    className='form-field__textarea'
                    value={form.eventInfo}
                    onInput={(e) => setForm((p) => ({ ...p, eventInfo: e.detail.value }))}
                    placeholder='输入活动信息'
                  />
                </View>
              )}
            </View>

            <View
              className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
              onClick={handleSubmit}
            >
              <Text>{submitting ? '提交中...' : formMode === 'create' ? '创建' : '保存'}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Product List */}
      {loading ? (
        <View className='admin-loading'>
          <Text>加载中...</Text>
        </View>
      ) : products.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>📦</Text>
          <Text className='admin-empty__text'>暂无商品，点击上方按钮创建</Text>
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
                      {product.type === 'points' ? '积分' : 'CODE'}
                    </Text>
                    <Text className={`product-row__status ${product.status === 'active' ? 'product-row__status--active' : 'product-row__status--inactive'}`}>
                      {product.status === 'active' ? '上架' : '下架'}
                    </Text>
                  </View>
                  <View className='product-row__stats'>
                    <Text className='product-row__stat'>库存: {product.stock}</Text>
                    <Text className='product-row__stat'>兑换: {product.redemptionCount}</Text>
                    {product.type === 'points' && product.pointsCost != null && (
                      <Text className='product-row__stat'>◆ {product.pointsCost}</Text>
                    )}
                  </View>
                </View>
                <View className='product-row__actions'>
                  <View className='product-row__btn' onClick={() => openEdit(product)}>
                    <Text>编辑</Text>
                  </View>
                  <View
                    className={`product-row__btn ${product.status === 'active' ? 'product-row__btn--danger' : 'product-row__btn--success'}`}
                    onClick={() => toggleStatus(product)}
                  >
                    <Text>{product.status === 'active' ? '下架' : '上架'}</Text>
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
