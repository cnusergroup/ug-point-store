import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
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

const TYPE_TABS: { key: TypeFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'points', label: '积分码' },
  { key: 'product', label: '商品码' },
];

export default function AdminCodesPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

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
    if (!count || count <= 0) { setError('请输入有效数量'); return; }
    if (!pointsValue || pointsValue <= 0) { setError('请输入有效积分值'); return; }
    if (!maxUses || maxUses <= 0) { setError('请输入有效最大使用次数'); return; }
    setSubmitting(true); setError('');
    try {
      await request({ url: '/api/admin/codes/batch-generate', method: 'POST', data: { count, pointsValue, maxUses, name: batchName.trim() || undefined } });
      closeForm(); fetchCodes();
      Taro.showToast({ title: `已生成 ${count} 个积分码`, icon: 'none' });
    } catch (err) {
      setError(err instanceof RequestError ? err.message : '生成失败');
    } finally { setSubmitting(false); }
  };

  const handleProductCodeGenerate = async () => {
    const count = Number(prodCodeCount);
    if (!prodCodeProductId.trim()) { setError('请选择商品'); return; }
    if (!count || count <= 0) { setError('请输入有效数量'); return; }
    setSubmitting(true); setError('');
    try {
      await request({ url: '/api/admin/codes/product-code', method: 'POST', data: { productId: prodCodeProductId.trim(), count } });
      closeForm(); fetchCodes();
      Taro.showToast({ title: `已生成 ${count} 个商品码`, icon: 'none' });
    } catch (err) {
      setError(err instanceof RequestError ? err.message : '生成失败');
    } finally { setSubmitting(false); }
  };

  const handleDisable = async (code: CodeInfo) => {
    try {
      await request({ url: `/api/admin/codes/${code.codeId}/disable`, method: 'PATCH' });
      fetchCodes();
    } catch (err) {
      Taro.showToast({ title: err instanceof RequestError ? err.message : '禁用失败', icon: 'none' });
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await request({ url: `/api/admin/codes/${deleteTarget.codeId}`, method: 'DELETE' });
      setDeleteTarget(null);
      fetchCodes();
      Taro.showToast({ title: '已删除', icon: 'none' });
    } catch (err) {
      Taro.showToast({ title: err instanceof RequestError ? err.message : '删除失败', icon: 'none' });
      setDeleteTarget(null);
    }
  };

  const copyCode = (codeValue: string) => {
    Taro.setClipboardData({ data: codeValue });
  };

  const handleBack = () => goBack('/pages/admin/index');

  const statusLabel: Record<string, { text: string; cls: string }> = {
    active: { text: '有效', cls: 'code-status--active' },
    disabled: { text: '已禁用', cls: 'code-status--disabled' },
    exhausted: { text: '已用尽', cls: 'code-status--exhausted' },
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <View className='admin-codes'>
      <View className='admin-codes__toolbar'>
        <View className='admin-codes__back' onClick={handleBack}><Text>‹ 返回</Text></View>
        <Text className='admin-codes__title'>Code 管理</Text>
        <View className='admin-codes__btns'>
          <View className='admin-codes__gen-btn' onClick={openBatchPoints}><Text>+ 积分码</Text></View>
          <View className='admin-codes__gen-btn admin-codes__gen-btn--alt' onClick={openProductCode}><Text>+ 商品码</Text></View>
        </View>
      </View>

      {/* Type Filter Tabs */}
      <View className='code-tabs'>
        {TYPE_TABS.map((tab) => (
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
              <Text className='form-modal__title'>批量生成积分码</Text>
              <View className='form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {error && <View className='form-modal__error'><Text>{error}</Text></View>}
            <View className='form-modal__body'>
              <View className='form-field'>
                <Text className='form-field__label'>积分码名称</Text>
                <Input className='form-field__input' value={batchName}
                  onInput={(e) => setBatchName(e.detail.value)} placeholder='例如: AWS Summit 2026 签到码' />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>生成数量</Text>
                <Input className='form-field__input' type='number' value={batchCount}
                  onInput={(e) => setBatchCount(e.detail.value)} placeholder='例如: 100' />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>每码积分值</Text>
                <Input className='form-field__input' type='number' value={batchPointsValue}
                  onInput={(e) => setBatchPointsValue(e.detail.value)} placeholder='例如: 50' />
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>最大使用次数</Text>
                <Input className='form-field__input' type='number' value={batchMaxUses}
                  onInput={(e) => setBatchMaxUses(e.detail.value)} placeholder='例如: 1' />
              </View>
            </View>
            <View className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
              onClick={handleBatchGenerate}>
              <Text>{submitting ? '生成中...' : '批量生成'}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Product Code Form */}
      {formView === 'product-code' && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>生成商品专属码</Text>
              <View className='form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {error && <View className='form-modal__error'><Text>{error}</Text></View>}
            <View className='form-modal__body'>
              <View className='form-field'>
                <Text className='form-field__label'>选择商品</Text>
                {codeExclusiveProducts.length === 0 ? (
                  <Text className='form-field__hint'>暂无 Code 专属商品，请先在商品管理中创建</Text>
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
                          <View className='form-field__product-img-placeholder'><Text>🎫</Text></View>
                        )}
                        <Text className='form-field__product-name'>{p.name}</Text>
                        {prodCodeProductId === p.productId && <Text className='form-field__product-check'>✓</Text>}
                      </View>
                    ))}
                  </View>
                )}
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>生成数量</Text>
                <Input className='form-field__input' type='number' value={prodCodeCount}
                  onInput={(e) => setProdCodeCount(e.detail.value)} placeholder='例如: 50' />
              </View>
            </View>
            <View className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
              onClick={handleProductCodeGenerate}>
              <Text>{submitting ? '生成中...' : '生成商品码'}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Delete Confirm Dialog */}
      {deleteTarget && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>确认删除</Text>
              <View className='form-modal__close' onClick={() => setDeleteTarget(null)}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <Text className='confirm-text'>确定要删除 Code「{deleteTarget.codeValue}」吗？此操作不可恢复。</Text>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={() => setDeleteTarget(null)}><Text>取消</Text></View>
              <View className='form-modal__submit form-modal__submit--danger' onClick={handleDelete}><Text>确认删除</Text></View>
            </View>
          </View>
        </View>
      )}

      {/* Code List */}
      {loading ? (
        <View className='admin-loading'><Text>加载中...</Text></View>
      ) : filteredCodes.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'>🎟️</Text>
          <Text className='admin-empty__text'>{typeFilter === 'all' ? '暂无 Code，点击上方按钮生成' : '该类别暂无 Code'}</Text>
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
                        {code.type === 'points' ? '积分码' : '商品码'}
                      </Text>
                      <Text className={`code-row__status ${st.cls}`}>{st.text}</Text>
                    </View>
                    <View className='code-row__meta'>
                      {code.type === 'points' && code.pointsValue != null && (
                        <Text className='code-row__meta-item'>◆ {code.pointsValue} 积分</Text>
                      )}
                      {code.type === 'points' && code.name && (
                        <Text className='code-row__meta-item code-row__meta-product'>📋 {code.name}</Text>
                      )}
                      {code.type === 'product' && code.productId && (
                        <Text className='code-row__meta-item code-row__meta-product'>
                          {productMap[code.productId]
                            ? `🏷️ ${productMap[code.productId].name}`
                            : `商品: ${code.productId}`}
                        </Text>
                      )}
                      <Text className='code-row__meta-item'>使用: {code.currentUses}/{code.maxUses}</Text>
                      <Text className='code-row__meta-item'>{formatTime(code.createdAt)}</Text>
                    </View>
                  </View>
                  <View className='code-row__actions'>
                    <View className='code-row__copy-btn' onClick={() => copyCode(code.codeValue)}><Text>复制</Text></View>
                    {code.status === 'active' && (
                      <View className='code-row__disable-btn' onClick={() => handleDisable(code)}><Text>禁用</Text></View>
                    )}
                    <View className='code-row__delete-btn' onClick={() => setDeleteTarget(code)}><Text>删除</Text></View>
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
