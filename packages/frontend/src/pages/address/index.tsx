import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { LocationIcon } from '../../components/icons';
import './index.scss';

/** Address response from API */
interface AddressResponse {
  addressId: string;
  userId: string;
  recipientName: string;
  phone: string;
  detailAddress: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Form data for add/edit */
interface AddressForm {
  recipientName: string;
  phone: string;
  detailAddress: string;
}

/** Validation errors */
interface FormErrors {
  recipientName?: string;
  phone?: string;
  detailAddress?: string;
}

const PHONE_REGEX = /^1\d{10}$/;
const MAX_NAME_LENGTH = 20;
const MAX_ADDRESS_LENGTH = 200;

function validateForm(form: AddressForm, t: (key: string) => string): FormErrors {
  const errors: FormErrors = {};
  if (!form.recipientName.trim() || form.recipientName.length > MAX_NAME_LENGTH) {
    errors.recipientName = t('address.recipientNameError');
  }
  if (!PHONE_REGEX.test(form.phone)) {
    errors.phone = t('address.phoneError');
  }
  if (!form.detailAddress.trim() || form.detailAddress.length > MAX_ADDRESS_LENGTH) {
    errors.detailAddress = t('address.detailAddressError');
  }
  return errors;
}

export default function AddressPage() {
  const { t } = useTranslation();
  const [addresses, setAddresses] = useState<AddressResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<AddressForm>({ recipientName: '', phone: '', detailAddress: '' });
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);

  const loadAddresses = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const res = await request<AddressResponse[]>({ url: '/api/addresses' });
      setAddresses(res);
    } catch {
      setError(t('address.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAddresses();
  }, [loadAddresses]);

  const handleBack = () => {
    goBack('/pages/profile/index');
  };

  const openAddForm = () => {
    setEditingId(null);
    setForm({ recipientName: '', phone: '', detailAddress: '' });
    setFormErrors({});
    setShowForm(true);
  };

  const openEditForm = (addr: AddressResponse) => {
    setEditingId(addr.addressId);
    setForm({
      recipientName: addr.recipientName,
      phone: addr.phone,
      detailAddress: addr.detailAddress,
    });
    setFormErrors({});
    setShowForm(true);
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const handleSubmit = async () => {
    const errors = validateForm(form, t);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setSubmitting(true);
    try {
      if (editingId) {
        await request({
          url: `/api/addresses/${editingId}`,
          method: 'PUT',
          data: { recipientName: form.recipientName, phone: form.phone, detailAddress: form.detailAddress },
        });
        Taro.showToast({ title: t('address.addressUpdated'), icon: 'success' });
      } else {
        await request({
          url: '/api/addresses',
          method: 'POST',
          data: { recipientName: form.recipientName, phone: form.phone, detailAddress: form.detailAddress },
        });
        Taro.showToast({ title: t('address.addressAdded'), icon: 'success' });
      }
      closeForm();
      await loadAddresses();
    } catch {
      Taro.showToast({ title: editingId ? t('address.updateFailed') : t('address.addFailed'), icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (addressId: string) => {
    try {
      await request({ url: `/api/addresses/${addressId}`, method: 'DELETE' });
      setAddresses((prev) => prev.filter((a) => a.addressId !== addressId));
      Taro.showToast({ title: t('address.deleted'), icon: 'success' });
    } catch {
      Taro.showToast({ title: t('address.deleteFailed'), icon: 'none' });
    }
  };

  const handleSetDefault = async (addressId: string) => {
    try {
      await request({ url: `/api/addresses/${addressId}/default`, method: 'PATCH' });
      await loadAddresses();
      Taro.showToast({ title: t('address.setDefaultSuccess'), icon: 'success' });
    } catch {
      Taro.showToast({ title: t('address.setDefaultFailed'), icon: 'none' });
    }
  };

  if (loading) {
    return (
      <View className='address-page'>
        <View className='address-header'>
          <Text className='address-header__back' onClick={handleBack}>{t('address.backButton')}</Text>
          <Text className='address-header__title'>{t('address.title')}</Text>
          <View className='address-header__placeholder' />
        </View>
        <View className='address-loading'>
          <Text className='address-loading__text'>{t('address.loadingText')}</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className='address-page'>
        <View className='address-header'>
          <Text className='address-header__back' onClick={handleBack}>{t('address.backButton')}</Text>
          <Text className='address-header__title'>{t('address.title')}</Text>
          <View className='address-header__placeholder' />
        </View>
        <View className='address-error'>
          <Text className='address-error__text'>{error}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className='address-page'>
      {/* Header */}
      <View className='address-header'>
        <Text className='address-header__back' onClick={handleBack}>{t('address.backButton')}</Text>
        <Text className='address-header__title'>{t('address.title')}</Text>
        <View className='address-header__placeholder' />
      </View>

      {/* Content */}
      <View className='address-content'>
        {addresses.length === 0 ? (
          <View className='address-empty'>
            <Text className='address-empty__icon'><LocationIcon size={48} color='var(--text-tertiary)' /></Text>
            <Text className='address-empty__text'>{t('address.noAddress')}</Text>
            <Text className='address-empty__hint'>{t('address.noAddressHint')}</Text>
          </View>
        ) : (
          <View className='address-list'>
            {addresses.map((addr) => (
              <View className={`address-card ${addr.isDefault ? 'address-card--default' : ''}`} key={addr.addressId}>
                <View className='address-card__top'>
                  <View className='address-card__info'>
                    <View className='address-card__name-row'>
                      <Text className='address-card__name'>{addr.recipientName}</Text>
                      <Text className='address-card__phone'>{addr.phone}</Text>
                      {addr.isDefault && (
                        <Text className='address-card__badge'>{t('address.defaultBadge')}</Text>
                      )}
                    </View>
                    <Text className='address-card__detail'>{addr.detailAddress}</Text>
                  </View>
                </View>
                <View className='address-card__actions'>
                  {!addr.isDefault && (
                    <Text className='address-card__action address-card__action--default' onClick={() => handleSetDefault(addr.addressId)}>
                      {t('address.setDefault')}
                    </Text>
                  )}
                  <Text className='address-card__action address-card__action--edit' onClick={() => openEditForm(addr)}>
                    {t('address.editButton')}
                  </Text>
                  <Text className='address-card__action address-card__action--delete' onClick={() => handleDelete(addr.addressId)}>
                    {t('address.deleteButton')}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Add button */}
      <View className='address-bottom'>
        <View className='btn-primary address-bottom__btn' onClick={openAddForm}>
          <Text>{t('address.addNewAddress')}</Text>
        </View>
      </View>

      {/* Add/Edit Modal */}
      {showForm && (
        <View className='address-modal-overlay' onClick={closeForm}>
          <View className='address-modal' onClick={(e) => e.stopPropagation()}>
            <Text className='address-modal__title'>
              {editingId ? t('address.editAddressTitle') : t('address.addAddressTitle')}
            </Text>

            <View className='address-modal__field'>
              <Text className='address-modal__label'>{t('address.recipientNameLabel')}</Text>
              <input
                className='address-modal__input'
                type='text'
                placeholder={t('address.recipientNamePlaceholder')}
                value={form.recipientName}
                maxLength={MAX_NAME_LENGTH}
                onInput={(e: any) => setForm((f) => ({ ...f, recipientName: e.target.value || e.detail?.value || '' }))}
              />
              {formErrors.recipientName && (
                <Text className='address-modal__error'>{formErrors.recipientName}</Text>
              )}
            </View>

            <View className='address-modal__field'>
              <Text className='address-modal__label'>{t('address.phoneLabel')}</Text>
              <input
                className='address-modal__input'
                type='tel'
                placeholder={t('address.phonePlaceholder')}
                value={form.phone}
                maxLength={11}
                onInput={(e: any) => setForm((f) => ({ ...f, phone: e.target.value || e.detail?.value || '' }))}
              />
              {formErrors.phone && (
                <Text className='address-modal__error'>{formErrors.phone}</Text>
              )}
            </View>

            <View className='address-modal__field'>
              <Text className='address-modal__label'>{t('address.detailAddressLabel')}</Text>
              <textarea
                className='address-modal__textarea'
                placeholder={t('address.detailAddressPlaceholder')}
                value={form.detailAddress}
                maxLength={MAX_ADDRESS_LENGTH}
                onInput={(e: any) => setForm((f) => ({ ...f, detailAddress: e.target.value || e.detail?.value || '' }))}
              />
              {formErrors.detailAddress && (
                <Text className='address-modal__error'>{formErrors.detailAddress}</Text>
              )}
            </View>

            <View className='address-modal__actions'>
              <View className='btn-secondary address-modal__btn' onClick={closeForm}>
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`btn-primary address-modal__btn ${submitting ? 'btn-primary--disabled' : ''}`}
                onClick={submitting ? undefined : handleSubmit}
              >
                <Text>{submitting ? t('common.submitting') : t('common.confirm')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
