import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { TagIcon } from '../../components/icons';
import './tags.scss';

/** Tag record returned by the admin API */
interface AdminTagRecord {
  tagId: string;
  tagName: string;
  usageCount: number;
  createdAt: string;
}

export default function AdminTagsPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const user = useAppStore((s) => s.user);

  const [tags, setTags] = useState<AdminTagRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Merge modal state
  const [mergeSource, setMergeSource] = useState<AdminTagRecord | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState<string>('');
  const [merging, setMerging] = useState(false);
  const [mergeError, setMergeError] = useState('');

  // Delete confirm state
  const [deleteTag, setDeleteTag] = useState<AdminTagRecord | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchTags = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<{ tags: AdminTagRecord[] }>({ url: '/api/admin/tags' });
      setTags(res.tags || []);
    } catch {
      setTags([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    const isSuperAdmin = user?.roles?.includes('SuperAdmin');
    if (!isSuperAdmin) {
      Taro.redirectTo({ url: '/pages/admin/index' });
      return;
    }
    fetchTags();
  }, [isAuthenticated, user, fetchTags]);

  // Merge handlers
  const openMerge = (tag: AdminTagRecord) => {
    setMergeSource(tag);
    setMergeTargetId('');
    setMergeError('');
  };

  const closeMerge = () => {
    setMergeSource(null);
    setMergeError('');
  };

  const handleMerge = async () => {
    if (!mergeSource || !mergeTargetId) return;
    setMerging(true);
    setMergeError('');
    try {
      await request({
        url: '/api/admin/tags/merge',
        method: 'POST',
        data: { sourceTagId: mergeSource.tagId, targetTagId: mergeTargetId },
      });
      Taro.showToast({ title: t('contentHub.tagManagement.mergeSuccess'), icon: 'none' });
      closeMerge();
      fetchTags();
    } catch (err) {
      setMergeError(err instanceof RequestError ? err.message : t('common.operationFailed'));
    } finally {
      setMerging(false);
    }
  };

  // Delete handlers
  const openDelete = (tag: AdminTagRecord) => {
    setDeleteTag(tag);
  };

  const closeDelete = () => {
    setDeleteTag(null);
  };

  const handleDelete = async () => {
    if (!deleteTag) return;
    setDeleting(true);
    try {
      await request({
        url: `/api/admin/tags/${deleteTag.tagId}`,
        method: 'DELETE',
      });
      Taro.showToast({ title: t('contentHub.tagManagement.deleteSuccess'), icon: 'none' });
      closeDelete();
      fetchTags();
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('common.operationFailed'),
        icon: 'none',
      });
      closeDelete();
    } finally {
      setDeleting(false);
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-tags'>
      {/* Toolbar */}
      <View className='admin-tags__toolbar'>
        <View className='admin-tags__back' onClick={handleBack}>
          <Text>‹ {t('common.back')}</Text>
        </View>
        <Text className='admin-tags__title'>{t('contentHub.tagManagement.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Tag List */}
      {loading ? (
        <View className='admin-loading'><Text>{t('common.loading')}</Text></View>
      ) : tags.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__icon'><TagIcon size={48} color='var(--text-tertiary)' /></Text>
          <Text className='admin-empty__text'>{t('contentHub.tagCloud.noTags')}</Text>
        </View>
      ) : (
        <View className='tag-list'>
          {tags.map((tag) => (
            <View key={tag.tagId} className='tag-row'>
              <View className='tag-row__main'>
                <View className='tag-row__info'>
                  <Text className='tag-row__name'>{tag.tagName}</Text>
                  <Text className='tag-row__count'>{t('contentHub.tagManagement.usageCount').replace('{count}', String(tag.usageCount))}</Text>
                </View>
                <View className='tag-row__actions'>
                  <View
                    className='tag-row__action-btn tag-row__action-btn--merge'
                    onClick={() => openMerge(tag)}
                  >
                    <Text>{t('contentHub.tagManagement.merge')}</Text>
                  </View>
                  <View
                    className='tag-row__action-btn tag-row__action-btn--danger'
                    onClick={() => openDelete(tag)}
                  >
                    <Text>{t('contentHub.tagManagement.delete')}</Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Merge Modal */}
      {mergeSource && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('contentHub.tagManagement.mergeConfirm')}</Text>
              <View className='form-modal__close' onClick={closeMerge}><Text>✕</Text></View>
            </View>
            {mergeError && (
              <View className='form-modal__error'><Text>{mergeError}</Text></View>
            )}
            <View className='form-modal__body'>
              <View className='merge-source'>
                <Text className='merge-source__label'>{t('contentHub.tagManagement.selectSource')}</Text>
                <Text className='merge-source__name'>{mergeSource.tagName}</Text>
              </View>
              <Text className='confirm-text'>{t('contentHub.tagManagement.selectTarget')}</Text>
              <View className='merge-target-list'>
                {tags
                  .filter((t_) => t_.tagId !== mergeSource.tagId)
                  .map((t_) => (
                    <View
                      key={t_.tagId}
                      className={`merge-target-list__item ${mergeTargetId === t_.tagId ? 'merge-target-list__item--selected' : ''}`}
                      onClick={() => setMergeTargetId(t_.tagId)}
                    >
                      <Text className='merge-target-list__name'>{t_.tagName}</Text>
                      <Text className='merge-target-list__count'>{t('contentHub.tagManagement.usageCount').replace('{count}', String(t_.usageCount))}</Text>
                    </View>
                  ))}
              </View>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeMerge}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`form-modal__submit ${merging || !mergeTargetId ? 'form-modal__submit--loading' : ''}`}
                onClick={handleMerge}
              >
                <Text>{merging ? t('common.submitting') : t('common.confirm')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Delete Confirm Modal */}
      {deleteTag && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>{t('contentHub.tagManagement.delete')}</Text>
              <View className='form-modal__close' onClick={closeDelete}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <Text className='confirm-text'>
                {t('contentHub.tagManagement.deleteConfirm').replace('{name}', deleteTag.tagName)}
              </Text>
            </View>
            <View className='form-modal__actions'>
              <View className='form-modal__cancel' onClick={closeDelete}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`form-modal__submit form-modal__submit--danger ${deleting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleDelete}
              >
                <Text>{deleting ? t('common.submitting') : t('common.confirm')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
