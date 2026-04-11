import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { ContentCategory } from '@points-mall/shared';
import './categories.scss';

export default function AdminCategoriesPage() {
  const { t } = useTranslation();
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [loading, setLoading] = useState(true);

  // Create/Edit modal
  const [showForm, setShowForm] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ContentCategory | null>(null);
  const [formName, setFormName] = useState('');
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Delete confirm modal
  const [deleteCategory, setDeleteCategory] = useState<ContentCategory | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchCategories = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<{ success: boolean; categories: ContentCategory[] }>({
        url: '/api/content/categories',
      });
      setCategories(res.categories || []);
    } catch {
      setCategories([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchCategories();
  }, [isAuthenticated, fetchCategories]);

  // Open create modal
  const openCreate = () => {
    setEditingCategory(null);
    setFormName('');
    setFormError('');
    setShowForm(true);
  };

  // Open edit modal
  const openEdit = (cat: ContentCategory) => {
    setEditingCategory(cat);
    setFormName(cat.name);
    setFormError('');
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setFormError('');
  };

  const handleSubmit = async () => {
    const name = formName.trim();
    if (!name) {
      setFormError(t('contentHub.categories.nameRequired'));
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      if (editingCategory) {
        await request({
          url: `/api/admin/content/categories/${editingCategory.categoryId}`,
          method: 'PUT',
          data: { name },
        });
        Taro.showToast({ title: t('contentHub.categories.updateSuccess'), icon: 'none' });
      } else {
        await request({
          url: '/api/admin/content/categories',
          method: 'POST',
          data: { name },
        });
        Taro.showToast({ title: t('contentHub.categories.createSuccess'), icon: 'none' });
      }
      closeForm();
      fetchCategories();
    } catch (err) {
      setFormError(err instanceof RequestError ? err.message : t('contentHub.categories.operationFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // Delete actions
  const openDelete = (cat: ContentCategory) => {
    setDeleteCategory(cat);
  };

  const closeDelete = () => {
    setDeleteCategory(null);
  };

  const handleDelete = async () => {
    if (!deleteCategory) return;
    setDeleting(true);
    try {
      await request({
        url: `/api/admin/content/categories/${deleteCategory.categoryId}`,
        method: 'DELETE',
      });
      Taro.showToast({ title: t('contentHub.categories.deleted'), icon: 'none' });
      closeDelete();
      fetchCategories();
    } catch (err) {
      Taro.showToast({
        title: err instanceof RequestError ? err.message : t('contentHub.categories.deleteFailed'),
        icon: 'none',
      });
    } finally {
      setDeleting(false);
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-categories'>
      {/* Toolbar */}
      <View className='admin-categories__toolbar'>
        <View className='admin-categories__back' onClick={handleBack}>
          <Text>{t('contentHub.categories.backButton')}</Text>
        </View>
        <Text className='admin-categories__title'>{t('contentHub.categories.title')}</Text>
        <View className='admin-categories__add-btn' onClick={openCreate}>
          <Text>{t('contentHub.categories.createButton')}</Text>
        </View>
      </View>

      {/* Category List */}
      {loading ? (
        <View className='admin-categories-loading'><Text>{t('contentHub.categories.loading')}</Text></View>
      ) : categories.length === 0 ? (
        <View className='admin-categories-empty'>
          <Text className='admin-categories-empty__icon'>{t('contentHub.categories.emptyIcon')}</Text>
          <Text className='admin-categories-empty__text'>{t('contentHub.categories.empty')}</Text>
        </View>
      ) : (
        <View className='category-list'>
          {categories.map((cat) => (
            <View key={cat.categoryId} className='category-row'>
              <View className='category-row__main'>
                <View className='category-row__info'>
                  <Text className='category-row__name'>{cat.name}</Text>
                  <Text className='category-row__time'>{formatTime(cat.createdAt)}</Text>
                </View>
                <View className='category-row__actions'>
                  <View className='category-row__edit-btn' onClick={() => openEdit(cat)}>
                    <Text>{t('contentHub.categories.editButton')}</Text>
                  </View>
                  <View className='category-row__delete-btn' onClick={() => openDelete(cat)}>
                    <Text>{t('contentHub.categories.deleteButton')}</Text>
                  </View>
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <View className='category-form-overlay'>
          <View className='category-form-modal'>
            <View className='category-form-modal__header'>
              <Text className='category-form-modal__title'>
                {editingCategory ? t('contentHub.categories.editTitle') : t('contentHub.categories.createTitle')}
              </Text>
              <View className='category-form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {formError && (
              <View className='category-form-modal__error'><Text>{formError}</Text></View>
            )}
            <View className='category-form-modal__body'>
              <View className='category-form-field'>
                <Text className='category-form-field__label'>{t('contentHub.categories.nameLabel')}</Text>
                <input
                  className='category-form-field__input'
                  value={formName}
                  onInput={(e: any) => setFormName(e.target.value || e.detail?.value || '')}
                  placeholder={t('contentHub.categories.namePlaceholder')}
                  maxLength={50}
                />
              </View>
            </View>
            <View className='category-form-modal__actions'>
              <View className='category-form-modal__cancel' onClick={closeForm}>
                <Text>{t('contentHub.categories.cancelButton')}</Text>
              </View>
              <View
                className={`category-form-modal__submit ${submitting ? 'category-form-modal__submit--loading' : ''}`}
                onClick={handleSubmit}
              >
                <Text>{submitting ? t('contentHub.categories.submitting') : t('contentHub.categories.submitButton')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Delete Confirm Modal */}
      {deleteCategory && (
        <View className='category-form-overlay'>
          <View className='category-form-modal'>
            <View className='category-form-modal__header'>
              <Text className='category-form-modal__title'>{t('contentHub.categories.deleteTitle')}</Text>
              <View className='category-form-modal__close' onClick={closeDelete}><Text>✕</Text></View>
            </View>
            <View className='category-form-modal__body'>
              <Text className='category-confirm-text'>
                {t('contentHub.categories.deleteConfirmText')}
              </Text>
            </View>
            <View className='category-form-modal__actions'>
              <View className='category-form-modal__cancel' onClick={closeDelete}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`category-form-modal__submit category-form-modal__submit--danger ${deleting ? 'category-form-modal__submit--loading' : ''}`}
                onClick={handleDelete}
              >
                <Text>{deleting ? t('contentHub.categories.deleting') : t('contentHub.categories.confirmDelete')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
