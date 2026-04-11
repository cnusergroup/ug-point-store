import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { TicketIcon, ClaimIcon } from '../../components/icons';
import './codes.scss';

interface CodeInfo {
  codeId: string;
  codeValue: string;
  type: 'points' | 'product';
  name?: string;
  pointsValue?: number;
  productId?: string;
  maxUses: number;
  currentUses: number;
  status: 'active' | 'disabled' | 'exhausted';
  createdAt: string;
}

interface ProductInfo {
  productId: string;
  name: string;
  imageUrl?: string;
  type: 'points' | 'code_exclusive';
}

type FormView = 'hidden' | 'batch-points' | 'product-code';
type TypeFilter = 'all' | 'points' | 'product';

export default function AdminCodesPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const { t } = useTranslation();

  const [codes, setCodes] = useState<CodeInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [formView, setFormView] = useState<FormView>('hidden');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Product map for displaying product names/images instead of IDs
  const [productMap, setProductMap] = useState<Record<string, ProductInfo>>({});

  // Batch points code form
  const [batchCount, setBatchCount] = useState('');
  const [batchPointsValue, setBatchPointsValue] = useState('');
  const [batchMaxUses, setBatchMaxUses] = useState('');
  const [batchName, setBatchName] = useState('');

  // Product code form
  const [prodCodeProductId, setProdCodeProductId] = useState('');
  const [prodCodeCount, setProdCodeCount] = useState('');

  // Code-exclusive products for the product code form dropdown
  const codeExclusiveProducts = useMemo(() => {
    return Object.values(productMap).filter((p) => p.type === 'code_exclusive');
  }, [productMap]);

  // Confirm delete
  const [deleteTarget, setDeleteTarget] = useState<CodeInfo | null>(null);

  const fetchCodes = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<{ codes: CodeInfo[]; lastKey?: string }>({ url: '/api/admin/codes' });
      setCodes(res.codes || []);
    } catch {
      setCodes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchProducts = useCallback(async () => {
    try {
      const res = await request<{ items: ProductInfo[] }>({ url: '/api/products?pageSize=200&includeInactive=true' });
      const map: Record<string, ProductInfo> = {};
      for (const p of (res.items || [])) {
        map[p.productId] = p;
      }
      setProductMap(map);
    } catch {
      // non-blocking
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchCodes();
    fetchProducts();
  }, [isAuthenticated, fetchCodes, fetchProducts]);

  // Filter codes by type
  const filteredCodes = useMemo(() => {
    if (typeFilter === 'all') return codes;
    return codes.filter((c) => c.type === typeFilter);
  }, [codes, typeFilter]);

  const openBatchPoints = () => {
    setBatchCount(''); setBatchPointsValue(''); setBatchMaxUses(''); setBatchName('');
    setError(''); setFormView('batch-points');
  };

  const openProductCode = () => {
    setProdCodeProductId(''); setProdCodeCount('');
    setError(''); setFormView('product-code');
  };

  const closeForm = () => { setFormView('hidden'); setError(''); };

  const handleBatchGenerate = async () => {
    const count = Number(batchCount);
    const pointsValue = Number(batchPointsValue);
    const maxUses = Number(batchMaxUses);
    if (!count || count <= 0) { setError(t('admin.codes.errorCountRequired')); return; }
    if (!pointsValue || pointsValue <= 0) { setError(t('admin.codes.errorPointsRequired')); return; }
    if (!maxUses || maxUses <= 0) { setError(t('admin.codes.errorMaxUsesRequired')); return; }
    setSubmitting(true); setError('');
    try {
      await request({ url: '/api/admin/codes/batch-generate', method: 'POST', data: { count, pointsValue, maxUses, name: batchName.trim() || undefined } });
      closeForm(); fetchCodes();
      Taro.showToast({ title: t('admin.codes.generatedPointsCodes', { count }), icon: 'none' });
    } catch (err) {
      setError(err instanceof RequestError ? err.message : t('admin.codes.generateFailed'));
    } finally { setSubmitting(false); }
  };

  const handleProductCodeGenerate = async () => {
    const count = Number(prodCodeCount);
    if (!prodCodeProductId.trim()) { setError(t('admin.codes.errorSelectProduct')); return; }
    if (!count || count <= 0) { setError(t('admin.codes.errorCountRequired')); return; }
    setSubmitting(true); setError('');
    try {
      await request({ url: '/api/admin/codes/product-code', method: 'POST', data: { productId: prodCodeProductId.trim(), count } });
      closeForm(); fetchCodes();
      Taro.showToast({ title: t('admin.codes.generatedProductCodes', { count }), icon: 'none' });
    } catch (err) {
      setError(err instanceof RequestError ? err.message : t('admin.codes.generateFailed'));
    } finally { setSubmitting(false); }
  };

  const handleDisable = async (code: CodeInfo) => {
    try {
      await request({ url: `/api/admin/codes/${code.codeId}/disable`, method: 'PATCH' });
      fetchCodes();
    } catch (err) {
      Taro.showToast({ title: err instanceof RequestError ? err.message : t('admin.codes.disableFailed'), icon: 'none' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await request({ url: `/api/admin/codes/${deleteTarget.codeId}`, method: 'DELETE' });
      setDeleteTarget(null);
      fetchCodes();
      Taro.showToast({ title: t('common.deleteSuccess'), icon: 'none' });
    } catch (err) {
      Taro.showToast({ title: err instanceof RequestError ? err.message : t('admin.codes.deleteFailed'), icon: 'none' });
      setDeleteTarget(null);
    }
  };

  const copyCode = (codeValue: string) => {
    Taro.setClipboardData({ data: codeValue });
  };

  const handleBack = () => goBack('/pages/admin/index');

  const statusLabel: Record<string, { textKey: string; cls: string }> = {
    active: { textKey: 'admin.codes.statusActive', cls: 'code-status--active' },
    disabled: { textKey: 'admin.codes.statusDisabled', cls: 'code-status--disabled' },
    exhausted: { textKey: 'admin.codes.statusExhausted', cls: 'code-status--exhausted' },
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <View className='admin-codes'>
      <View className='admin-codes__toolbar'>
        <View className='admin-codes__back' onClick={handleBack}><Text>{t('admin.codes.backButton')}</Text></View>
        <Text className='admin-codes__title'>{t('admin.codes.title')}</Text>
        <View className='admin-codes__btns'>
          <View className='admin-codes__gen-btn' onClick={openBatchPoints}><Text>{t('admin.codes.addPointsCode')}</Text></View>
          <View className='admin-codes__gen-btn admin-codes__gen-btn--alt' onClick={openProductCode}><Text>{t('admin.codes.addProductCode')}</Text></View>
        </View>
      </View>

      {/* Type Filter Tabs */}
      <View className='code-tabs'>
        {([
          { key: 'all' as TypeFilter, label: t('admin.codes.filterAll') },
          { key: 'points' as TypeFilter, label: t('admin.codes.filterPoints') },
          { key: 'product' as TypeFilter, label: t('admin.codes.filterProduct') },
        ]).map((tab) => (
          <View
            key={tab.key}
            className={`code-tabs__item ${typeFilter === tab.key ? 'code-tabs__item--active' : ''}`}
            onClick={() => setTypeFilter(tab.key)}
          >
            <Text>{tab.label}</Text>
          </View>
        ))}
      </View>

      {/* Batch Points Code Form */}
      {formView === 'batch-points' && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('admin.codes.batchGenerateTitle')}</Text>
              <View className='form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {error && <View className='form-modal__error'><Text>{error}</Text></View>}
            <View className='form-modal__body'>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.codes.codeNameLabel')}</Text>
                <Input className='form-field__input' value={batchName}
                  onInput={(e) => setBatchName(e.detail.value)} placeholder={t('admin.codes.codeNamePlaceholder')} />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.codes.countLabel')}</Text>
                <Input className='form-field__input' type='number' value={batchCount}
                  onInput={(e) => setBatchCount(e.detail.value)} placeholder={t('admin.codes.countPlaceholder')} />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.codes.pointsValueLabel')}</Text>
                <Input className='form-field__input' type='number' value={batchPointsValue}
                  onInput={(e) => setBatchPointsValue(e.detail.value)} placeholder={t('admin.codes.pointsValuePlaceholder')} />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.codes.maxUsesLabel')}</Text>
                <Input className='form-field__input' type='number' value={batchMaxUses}
                  onInput={(e) => setBatchMaxUses(e.detail.value)} placeholder={t('admin.codes.maxUsesPlaceholder')} />
              </View>
            </View>
            <View className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
              onClick={handleBatchGenerate}>
              <Text>{submitting ? t('admin.codes.generating') : t('admin.codes.batchGenerate')}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Product Code Form */}
      {formView === 'product-code' && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('admin.codes.productCodeTitle')}</Text>
              <View className='form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {error && <View className='form-modal__error'><Text>{error}</Text></View>}
            <View className='form-modal__body'>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.codes.selectProductLabel')}</Text>
                {codeExclusiveProducts.length === 0 ? (
                  <Text className='form-field__hint'>{t('admin.codes.noCodeExclusiveProducts')}</Text>
                ) : (
                  <View className='form-field__product-list'>
                    {codeExclusiveProducts.map((p) => (
                      <View
                        key={p.productId}
                        className={`form-field__product-option ${prodCodeProductId === p.productId ? 'form-field__product-option--selected' : ''}`}
                        onClick={() => setProdCodeProductId(p.productId)}
                      >
                        {p.imageUrl ? (
                          <Image className='form-field__product-img' src={p.imageUrl} mode='aspectFill' />
                        ) : (
                          <View className='form-field__product-img-placeholder'><Text><TicketIcon size={20} color='var(--text-tertiary)' /></Text></View>
                        )}
                        <Text className='form-field__product-name'>{p.name}</Text>
                        {prodCodeProductId === p.productId && <Text className='form-field__product-check'>✓</Text>}
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>{t('admin.codes.countLabel')}</Text>
                <Input className='form-field__input' type='number' value={prodCodeCount}
                  onInput={(e) => setProdCodeCount(e.detail.value)} placeholder={t('admin.codes.countPlaceholder')} />
              </View>
            </View>
            <View className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
              onClick={handleProductCodeGenerate}>
              <Text>{submitting ? t('admin.codes.generating') : t('admin.codes.generateProductCode')}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('admin.codes.confirmDeleteTitle')}</Text>
              <View className='form-modal__close' onClick={() => setDeleteTarget(null)}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <Text className='confirm-text'>{t('admin.codes.confirmDeleteMessage', { code: deleteTarget.codeValue })}</Text>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={() => setDeleteTarget(null)}><Text>{t('common.cancel')}</Text></View>
              <View className='form-modal__submit form-modal__submit--danger' onClick={handleDelete}><Text>{t('admin.codes.confirmDeleteButton')}</Text></View>
            </View>
          </View>
        </View>
      )}

      {/* Code List */}
      {loading ? (
        <View className='admin-loading'><Text>{t('admin.codes.loading')}</Text></View>
      ) : filteredCodes.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'><TicketIcon size={48} color='var(--text-tertiary)' /></Text>
          <Text className='admin-empty__text'>{typeFilter === 'all' ? t('admin.codes.noCodesAll') : t('admin.codes.noCodesFiltered')}</Text>
        </View>
      ) : (
        <View className='code-list'>
          {filteredCodes.map((code) => {
            const st = statusLabel[code.status] || statusLabel.active;
            return (
              <View key={code.codeId} className='code-row'>
                <View className='code-row__main'>
                  {code.type === 'product' && code.productId && productMap[code.productId]?.imageUrl && (
                    <Image
                      className='code-row__product-img'
                      src={productMap[code.productId].imageUrl!}
                      mode='aspectFill'
                    />
                  )}
                  <View className='code-row__info'>
                    <View className='code-row__top'>
                      <Text className='code-row__value'>{code.codeValue}</Text>
                      <Text className={`code-row__type ${code.type === 'product' ? 'code-row__type--product' : ''}`}>
                        {code.type === 'points' ? t('admin.codes.typePoints') : t('admin.codes.typeProduct')}
                      </Text>
                      <Text className={`code-row__status ${st.cls}`}>{t(st.textKey)}</Text>
                    </View>
                    <View className='code-row__meta'>
                      {code.type === 'points' && code.pointsValue != null && (
                        <Text className='code-row__meta-item'>◆ {code.pointsValue} {t('common.pointsUnit')}</Text>
                      )}
                      {code.type === 'points' && code.name && (
                        <Text className='code-row__meta-item code-row__meta-product'>{code.name}</Text>
                      )}
                      {code.type === 'product' && code.productId && (
                        <Text className='code-row__meta-item code-row__meta-product'>
                          {productMap[code.productId]
                            ? productMap[code.productId].name
                            : t('admin.codes.productLabel', { name: code.productId })}
                        </Text>
                      )}
                      <Text className='code-row__meta-item'>{t('admin.codes.usageLabel', { current: code.currentUses, max: code.maxUses })}</Text>
                      <Text className='code-row__meta-item'>{formatTime(code.createdAt)}</Text>
                    </View>
                  </View>
                  <View className='code-row__actions'>
                    <View className='code-row__copy-btn' onClick={() => copyCode(code.codeValue)}><Text>{t('admin.codes.copyButton')}</Text></View>
                    {code.status === 'active' && (
                      <View className='code-row__disable-btn' onClick={() => handleDisable(code)}><Text>{t('admin.codes.disableButton')}</Text></View>
                    )}
                    <View className='code-row__delete-btn' onClick={() => setDeleteTarget(code)}><Text>{t('admin.codes.deleteButton')}</Text></View>
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}
