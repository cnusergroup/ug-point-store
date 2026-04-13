import { useState, useEffect, useCallback } from 'react';
import { View, Text, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { PackageIcon } from '../../components/icons';
import './email-products.scss';

interface Product {
  productId: string;
  name: string;
  description: string;
  imageUrl: string;
  type: 'points' | 'code_exclusive';
  status: 'active' | 'inactive';
  pointsCost?: number;
  createdAt: string;
}

interface EmailTemplate {
  templateId: string;
  locale: string;
  subject: string;
  body: string;
}

interface SendResult {
  subscriberCount: number;
  totalBatches: number;
  successCount: number;
  failureCount: number;
}

export default function EmailProductsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);

  const [toggleEnabled, setToggleEnabled] = useState<boolean | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  // Preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewSubject, setPreviewSubject] = useState('');
  const [previewBody, setPreviewBody] = useState('');

  // Check feature toggle and fetch products
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Check feature toggle
      const toggles = await request<Record<string, boolean>>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });

      const enabled = toggles.emailNewProductEnabled === true;
      setToggleEnabled(enabled);

      if (!enabled) {
        setLoading(false);
        return;
      }

      // 2. Fetch all products (use public products API with includeInactive)
      const res = await request<{ items: Product[] }>({
        url: '/api/products?pageSize=200&includeInactive=true',
      });
      const allProducts = res.items;

      // Filter to products created within last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentProducts = allProducts.filter(
        (p) => new Date(p.createdAt) >= sevenDaysAgo,
      );

      setProducts(recentProducts);
    } catch {
      setToggleEnabled(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    const hasAccess = user?.roles?.some(
      (r) => r === 'Admin' || r === 'SuperAdmin',
    );
    if (!hasAccess) {
      Taro.redirectTo({ url: '/pages/index/index' });
      return;
    }
    fetchData();
  }, [isAuthenticated, user, fetchData]);

  // Toggle selection
  const toggleSelect = (productId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(productId)) {
        next.delete(productId);
      } else {
        next.add(productId);
      }
      return next;
    });
  };

  // Select all / deselect all
  const toggleSelectAll = () => {
    if (selectedIds.size === products.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map((p) => p.productId)));
    }
  };

  // Build product list HTML for the email
  const buildProductListHtml = (): string => {
    const selected = products.filter((p) => selectedIds.has(p.productId));
    return selected
      .map((p) => {
        const cost =
          p.type === 'points' && p.pointsCost
            ? ` — ${p.pointsCost} 积分`
            : '';
        return `<p style="margin:4px 0;">• ${p.name}${cost}</p>`;
      })
      .join('');
  };

  // Preview email
  const handlePreview = async () => {
    try {
      const res = await request<{
        templates: EmailTemplate[];
      }>({
        url: '/api/admin/email-templates?type=newProduct',
      });

      // Use zh locale template as default preview
      const zhTemplate = res.templates.find((t) => t.locale === 'zh');
      if (!zhTemplate) {
        Taro.showToast({ title: '未找到模板', icon: 'none' });
        return;
      }

      const productListHtml = buildProductListHtml();
      // Replace variables in template
      const subject = zhTemplate.subject.replace(/\{\{productList\}\}/g, '').replace(/\{\{nickname\}\}/g, '');
      const body = zhTemplate.body
        .replace(/\{\{productList\}\}/g, productListHtml)
        .replace(/\{\{nickname\}\}/g, '');

      setPreviewSubject(subject);
      setPreviewBody(body);
      setShowPreview(true);
    } catch {
      Taro.showToast({ title: '加载模板失败', icon: 'none' });
    }
  };

  // Send notification
  const handleSend = async () => {
    const selected = products.filter((p) => selectedIds.has(p.productId));
    if (selected.length === 0) return;

    setSending(true);
    try {
      const productListHtml = buildProductListHtml();
      const res = await request<SendResult>({
        url: '/api/admin/email/send-product-notification',
        method: 'POST',
        data: { productList: productListHtml },
      });
      setSendResult(res);
    } catch {
      Taro.showToast({ title: '发送失败', icon: 'none' });
    } finally {
      setSending(false);
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };

  const allSelected = products.length > 0 && selectedIds.size === products.length;
  const hasSelection = selectedIds.size > 0;

  return (
    <View className='email-products'>
      {/* Toolbar */}
      <View className='email-products__toolbar'>
        <View className='email-products__back' onClick={handleBack}>
          <Text>← 返回</Text>
        </View>
        <Text className='email-products__title'>新商品邮件通知</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Loading */}
      {loading && (
        <View className='admin-loading'>
          <Text>加载中...</Text>
        </View>
      )}

      {/* Disabled state */}
      {!loading && toggleEnabled === false && (
        <View className='email-products__disabled'>
          <Text className='email-products__disabled-icon'>
            <PackageIcon size={48} color='var(--text-tertiary)' />
          </Text>
          <Text className='email-products__disabled-text'>
            新商品邮件通知功能已关闭，请在设置中开启「新商品通知」开关后再使用此功能。
          </Text>
        </View>
      )}

      {/* Send result summary */}
      {!loading && sendResult && (
        <View className='ep-result'>
          <Text className='ep-result__title'>发送结果</Text>
          <View className='ep-result__grid'>
            <View className='ep-result__item'>
              <Text className='ep-result__label'>订阅用户数</Text>
              <Text className='ep-result__value'>{sendResult.subscriberCount}</Text>
            </View>
            <View className='ep-result__item'>
              <Text className='ep-result__label'>总批次</Text>
              <Text className='ep-result__value'>{sendResult.totalBatches}</Text>
            </View>
            <View className='ep-result__item'>
              <Text className='ep-result__label'>成功批次</Text>
              <Text className='ep-result__value ep-result__value--success'>
                {sendResult.successCount}
              </Text>
            </View>
            <View className='ep-result__item'>
              <Text className='ep-result__label'>失败批次</Text>
              <Text className='ep-result__value ep-result__value--error'>
                {sendResult.failureCount}
              </Text>
            </View>
          </View>
          <View className='ep-result__close' onClick={() => setSendResult(null)}>
            <Text>关闭</Text>
          </View>
        </View>
      )}

      {/* Product list with selection */}
      {!loading && toggleEnabled && !sendResult && (
        <>
          {/* Actions bar */}
          <View className='email-products__actions'>
            <View className='email-products__select-all' onClick={toggleSelectAll}>
              <View
                className={`ep-row__checkbox ${allSelected ? 'ep-row__checkbox--checked' : ''}`}
              >
                {allSelected && <Text className='ep-row__check-mark'>✓</Text>}
              </View>
              <Text>
                {allSelected ? '取消全选' : '全选'} ({selectedIds.size}/{products.length})
              </Text>
            </View>
            <View className='email-products__buttons'>
              <View
                className={`email-products__btn email-products__btn--preview ${!hasSelection ? 'email-products__btn--disabled' : ''}`}
                onClick={hasSelection ? handlePreview : undefined}
              >
                <Text>预览</Text>
              </View>
              <View
                className={`email-products__btn email-products__btn--send ${!hasSelection ? 'email-products__btn--disabled' : ''} ${sending ? 'email-products__btn--loading' : ''}`}
                onClick={hasSelection && !sending ? handleSend : undefined}
              >
                <Text>{sending ? '发送中...' : '发送通知'}</Text>
              </View>
            </View>
          </View>

          {/* Product count */}
          {products.length > 0 && (
            <View className='email-products__list'>
              <Text className='email-products__count'>
                最近 7 天新增商品（{products.length} 件）
              </Text>

              {products.map((product) => {
                const isSelected = selectedIds.has(product.productId);
                return (
                  <View
                    key={product.productId}
                    className={`ep-row ${isSelected ? 'ep-row--selected' : ''}`}
                    onClick={() => toggleSelect(product.productId)}
                  >
                    <View
                      className={`ep-row__checkbox ${isSelected ? 'ep-row__checkbox--checked' : ''}`}
                    >
                      {isSelected && (
                        <Text className='ep-row__check-mark'>✓</Text>
                      )}
                    </View>
                    {product.imageUrl && (
                      <Image
                        className='ep-row__image'
                        src={product.imageUrl}
                        mode='aspectFill'
                      />
                    )}
                    <View className='ep-row__info'>
                      <Text className='ep-row__name'>{product.name}</Text>
                      <View className='ep-row__meta'>
                        {product.type === 'points' && product.pointsCost && (
                          <Text className='ep-row__price'>
                            {product.pointsCost} 积分
                          </Text>
                        )}
                        <Text className='ep-row__date'>
                          {formatDate(product.createdAt)}
                        </Text>
                        <Text
                          className={`ep-row__status ep-row__status--${product.status}`}
                        >
                          {product.status === 'active' ? '上架' : '下架'}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Empty state */}
          {products.length === 0 && (
            <View className='admin-empty'>
              <Text className='admin-empty__icon'>
                <PackageIcon size={48} color='var(--text-tertiary)' />
              </Text>
              <Text className='admin-empty__text'>
                最近 7 天没有新增商品
              </Text>
            </View>
          )}
        </>
      )}

      {/* Preview modal */}
      {showPreview && (
        <View className='ep-preview'>
          <View className='ep-preview__modal'>
            <View className='ep-preview__header'>
              <Text className='ep-preview__title'>邮件预览</Text>
              <View
                className='ep-preview__close'
                onClick={() => setShowPreview(false)}
              >
                <Text>✕</Text>
              </View>
            </View>
            <View className='ep-preview__subject'>
              <Text className='ep-preview__subject-label'>主题</Text>
              <Text className='ep-preview__subject-text'>{previewSubject}</Text>
            </View>
            <View className='ep-preview__body'>
              <View
                className='ep-preview__html'
                dangerouslySetInnerHTML={{ __html: previewBody }}
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
