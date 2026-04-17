import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { ContentIcon } from '../../components/icons';
import { useTranslation } from '../../i18n';
import './email-content.scss';

interface ContentItem {
  contentId: string;
  title: string;
  authorNickname: string;
  createdAt: string;
  status: string;
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

export default function EmailContentPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);

  const [toggleEnabled, setToggleEnabled] = useState<boolean | null>(null);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<SendResult | null>(null);

  // Preview state
  const [showPreview, setShowPreview] = useState(false);
  const [previewSubject, setPreviewSubject] = useState('');
  const [previewBody, setPreviewBody] = useState('');

  // Check feature toggle and fetch content items
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 1. Check feature toggle
      const toggles = await request<Record<string, boolean>>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });

      const enabled = toggles.emailNewContentEnabled === true;
      setToggleEnabled(enabled);

      if (!enabled) {
        setLoading(false);
        return;
      }

      // 2. Fetch approved content items from admin content API
      const res = await request<{ items: ContentItem[] }>({
        url: '/api/admin/content?status=approved',
      });
      const allContent = res.items;

      // Filter to items created within last 7 days
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      const recentContent = allContent.filter(
        (c) => new Date(c.createdAt) >= sevenDaysAgo,
      );

      setContentItems(recentContent);
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
  const toggleSelect = (contentId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contentId)) {
        next.delete(contentId);
      } else {
        next.add(contentId);
      }
      return next;
    });
  };

  // Select all / deselect all
  const toggleSelectAll = () => {
    if (selectedIds.size === contentItems.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(contentItems.map((c) => c.contentId)));
    }
  };

  // Build content list HTML for the email
  const buildContentListHtml = (): string => {
    const selected = contentItems.filter((c) => selectedIds.has(c.contentId));
    return selected
      .map((c) => {
        const author = c.authorNickname ? ` — ${c.authorNickname}` : '';
        return `<p style="margin:4px 0;">• ${c.title}${author}</p>`;
      })
      .join('');
  };

  // Preview email
  const handlePreview = async () => {
    try {
      const res = await request<{
        templates: EmailTemplate[];
      }>({
        url: '/api/admin/email-templates?type=newContent',
      });

      // Use zh locale template as default preview
      const zhTemplate = res.templates.find((tpl) => tpl.locale === 'zh');
      if (!zhTemplate) {
        Taro.showToast({ title: t('emailNotification.noTemplate'), icon: 'none' });
        return;
      }

      const contentListHtml = buildContentListHtml();
      // Replace variables in template
      const subject = zhTemplate.subject.replace(/\{\{contentList\}\}/g, '').replace(/\{\{nickname\}\}/g, '');
      const body = zhTemplate.body
        .replace(/\{\{contentList\}\}/g, contentListHtml)
        .replace(/\{\{nickname\}\}/g, '');

      setPreviewSubject(subject);
      setPreviewBody(body);
      setShowPreview(true);
    } catch {
      Taro.showToast({ title: t('emailNotification.templateLoadFailed'), icon: 'none' });
    }
  };

  // Send notification
  const handleSend = async () => {
    const selected = contentItems.filter((c) => selectedIds.has(c.contentId));
    if (selected.length === 0) return;

    setSending(true);
    try {
      const contentListHtml = buildContentListHtml();
      const res = await request<SendResult>({
        url: '/api/admin/email/send-content-notification',
        method: 'POST',
        data: { contentList: contentListHtml },
      });
      setSendResult(res);
    } catch {
      Taro.showToast({ title: t('emailNotification.sendFailed'), icon: 'none' });
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

  const allSelected = contentItems.length > 0 && selectedIds.size === contentItems.length;
  const hasSelection = selectedIds.size > 0;

  return (
    <View className='email-content'>
      {/* Toolbar */}
      <View className='email-content__toolbar'>
        <View className='email-content__back' onClick={handleBack}>
          <Text>{t('emailNotification.backButton')}</Text>
        </View>
        <Text className='email-content__title'>{t('emailNotification.contentPageTitle')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Loading */}
      {loading && (
        <View className='admin-loading'>
          <Text>{t('emailNotification.loading')}</Text>
        </View>
      )}

      {/* Disabled state */}
      {!loading && toggleEnabled === false && (
        <View className='email-content__disabled'>
          <Text className='email-content__disabled-icon'>
            <ContentIcon size={48} color='var(--text-tertiary)' />
          </Text>
          <Text className='email-content__disabled-text'>
            {t('emailNotification.disabledContentMessage')}
          </Text>
        </View>
      )}

      {/* Send result summary */}
      {!loading && sendResult && (
        <View className='ec-result'>
          <Text className='ec-result__title'>{t('emailNotification.sendResult')}</Text>
          <View className='ec-result__grid'>
            <View className='ec-result__item'>
              <Text className='ec-result__label'>{t('emailNotification.resultSubscribers')}</Text>
              <Text className='ec-result__value'>{sendResult.subscriberCount}</Text>
            </View>
            <View className='ec-result__item'>
              <Text className='ec-result__label'>{t('emailNotification.resultTotalBatches')}</Text>
              <Text className='ec-result__value'>{sendResult.totalBatches}</Text>
            </View>
            <View className='ec-result__item'>
              <Text className='ec-result__label'>{t('emailNotification.resultSuccess')}</Text>
              <Text className='ec-result__value ec-result__value--success'>
                {sendResult.successCount}
              </Text>
            </View>
            <View className='ec-result__item'>
              <Text className='ec-result__label'>{t('emailNotification.resultFailure')}</Text>
              <Text className='ec-result__value ec-result__value--error'>
                {sendResult.failureCount}
              </Text>
            </View>
          </View>
          <View className='ec-result__close' onClick={() => setSendResult(null)}>
            <Text>{t('emailNotification.resultClose')}</Text>
          </View>
        </View>
      )}

      {/* Content list with selection */}
      {!loading && toggleEnabled && !sendResult && (
        <>
          {/* Actions bar */}
          <View className='email-content__actions'>
            <View className='email-content__select-all' onClick={toggleSelectAll}>
              <View
                className={`ec-row__checkbox ${allSelected ? 'ec-row__checkbox--checked' : ''}`}
              >
                {allSelected && <Text className='ec-row__check-mark'>✓</Text>}
              </View>
              <Text>
                {allSelected ? t('emailNotification.deselectAll') : t('emailNotification.selectAll')} ({selectedIds.size}/{contentItems.length})
              </Text>
            </View>
            <View className='email-content__buttons'>
              <View
                className={`email-content__btn email-content__btn--preview ${!hasSelection ? 'email-content__btn--disabled' : ''}`}
                onClick={hasSelection ? handlePreview : undefined}
              >
                <Text>{t('emailNotification.preview')}</Text>
              </View>
              <View
                className={`email-content__btn email-content__btn--send ${!hasSelection ? 'email-content__btn--disabled' : ''} ${sending ? 'email-content__btn--loading' : ''}`}
                onClick={hasSelection && !sending ? handleSend : undefined}
              >
                <Text>{sending ? t('emailNotification.sending') : t('emailNotification.send')}</Text>
              </View>
            </View>
          </View>

          {/* Content count */}
          {contentItems.length > 0 && (
            <View className='email-content__list'>
              <Text className='email-content__count'>
                {t('emailNotification.contentCount', { count: contentItems.length })}
              </Text>

              {contentItems.map((item) => {
                const isSelected = selectedIds.has(item.contentId);
                return (
                  <View
                    key={item.contentId}
                    className={`ec-row ${isSelected ? 'ec-row--selected' : ''}`}
                    onClick={() => toggleSelect(item.contentId)}
                  >
                    <View
                      className={`ec-row__checkbox ${isSelected ? 'ec-row__checkbox--checked' : ''}`}
                    >
                      {isSelected && (
                        <Text className='ec-row__check-mark'>✓</Text>
                      )}
                    </View>
                    <View className='ec-row__info'>
                      <Text className='ec-row__name'>{item.title}</Text>
                      <View className='ec-row__meta'>
                        <Text className='ec-row__author'>
                          {item.authorNickname}
                        </Text>
                        <Text className='ec-row__date'>
                          {formatDate(item.createdAt)}
                        </Text>
                        <Text className='ec-row__status ec-row__status--approved'>
                          {t('emailNotification.statusApproved')}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* Empty state */}
          {contentItems.length === 0 && (
            <View className='admin-empty'>
              <Text className='admin-empty__icon'>
                <ContentIcon size={48} color='var(--text-tertiary)' />
              </Text>
              <Text className='admin-empty__text'>
                {t('emailNotification.noRecentContent')}
              </Text>
            </View>
          )}
        </>
      )}

      {/* Preview modal */}
      {showPreview && (
        <View className='ec-preview'>
          <View className='ec-preview__modal'>
            <View className='ec-preview__header'>
              <Text className='ec-preview__title'>{t('emailNotification.previewTitle')}</Text>
              <View
                className='ec-preview__close'
                onClick={() => setShowPreview(false)}
              >
                <Text>✕</Text>
              </View>
            </View>
            <View className='ec-preview__subject'>
              <Text className='ec-preview__subject-label'>{t('emailNotification.previewSubject')}</Text>
              <Text className='ec-preview__subject-text'>{previewSubject}</Text>
            </View>
            <View className='ec-preview__body'>
              <View
                className='ec-preview__html'
                dangerouslySetInnerHTML={{ __html: previewBody }}
              />
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
