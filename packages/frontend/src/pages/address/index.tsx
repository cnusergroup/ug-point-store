import { useState, useEffect, useCallback } from 'react';
import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
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

function validateForm(form: AddressForm): FormErrors {
  const errors: FormErrors = {};
  if (!form.recipientName.trim() || form.recipientName.length > MAX_NAME_LENGTH) {
    errors.recipientName = `收件人姓名需为 1-${MAX_NAME_LENGTH} 个字符`;
  }
  if (!PHONE_REGEX.test(form.phone)) {
    errors.phone = '请输入正确的 11 位手机号';
  }
  if (!form.detailAddress.trim() || form.detailAddress.length > MAX_ADDRESS_LENGTH) {
    errors.detailAddress = `详细地址需为 1-${MAX_ADDRESS_LENGTH} 个字符`;
  }
  return errors;
}

export default function AddressPage() {
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
      setError('地址加载失败');
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
    const errors = validateForm(form);
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
        Taro.showToast({ title: '地址已更新', icon: 'success' });
      } else {
        await request({
          url: '/api/addresses',
          method: 'POST',
          data: { recipientName: form.recipientName, phone: form.phone, detailAddress: form.detailAddress },
        });
        Taro.showToast({ title: '地址已添加', icon: 'success' });
      }
      closeForm();
      await loadAddresses();
    } catch {
      Taro.showToast({ title: editingId ? '更新失败' : '添加失败', icon: 'none' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (addressId: string) => {
    try {
      await request({ url: `/api/addresses/${addressId}`, method: 'DELETE' });
      setAddresses((prev) => prev.filter((a) => a.addressId !== addressId));
      Taro.showToast({ title: '已删除', icon: 'success' });
    } catch {
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  };

  const handleSetDefault = async (addressId: string) => {
    try {
      await request({ url: `/api/addresses/${addressId}/default`, method: 'PATCH' });
      await loadAddresses();
      Taro.showToast({ title: '已设为默认', icon: 'success' });
    } catch {
      Taro.showToast({ title: '设置失败', icon: 'none' });
    }
  };

  if (loading) {
    return (
      <View className='address-page'>
        <View className='address-header'>
          <Text className='address-header__back' onClick={handleBack}>← 返回</Text>
          <Text className='address-header__title'>收货地址</Text>
          <View className='address-header__placeholder' />
        </View>
        <View className='address-loading'>
          <Text className='address-loading__text'>加载中...</Text>
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View className='address-page'>
        <View className='address-header'>
          <Text className='address-header__back' onClick={handleBack}>← 返回</Text>
          <Text className='address-header__title'>收货地址</Text>
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
        <Text className='address-header__back' onClick={handleBack}>← 返回</Text>
        <Text className='address-header__title'>收货地址</Text>
        <View className='address-header__placeholder' />
      </View>

      {/* Content */}
      <View className='address-content'>
        {addresses.length === 0 ? (
          <View className='address-empty'>
            <Text className='address-empty__icon'>📍</Text>
            <Text className='address-empty__text'>暂无收货地址</Text>
            <Text className='address-empty__hint'>添加一个地址以便下单时使用</Text>
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
                        <Text className='address-card__badge'>默认</Text>
                      )}
                    </View>
                    <Text className='address-card__detail'>{addr.detailAddress}</Text>
                  </View>
                </View>
                <View className='address-card__actions'>
                  {!addr.isDefault && (
                    <Text className='address-card__action address-card__action--default' onClick={() => handleSetDefault(addr.addressId)}>
                      设为默认
                    </Text>
                  )}
                  <Text className='address-card__action address-card__action--edit' onClick={() => openEditForm(addr)}>
                    编辑
                  </Text>
                  <Text className='address-card__action address-card__action--delete' onClick={() => handleDelete(addr.addressId)}>
                    删除
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
          <Text>+ 添加新地址</Text>
        </View>
      </View>

      {/* Add/Edit Modal */}
      {showForm && (
        <View className='address-modal-overlay' onClick={closeForm}>
          <View className='address-modal' onClick={(e) => e.stopPropagation()}>
            <Text className='address-modal__title'>
              {editingId ? '编辑地址' : '添加地址'}
            </Text>

            <View className='address-modal__field'>
              <Text className='address-modal__label'>收件人姓名</Text>
              <input
                className='address-modal__input'
                type='text'
                placeholder='请输入收件人姓名'
                value={form.recipientName}
                maxLength={MAX_NAME_LENGTH}
                onInput={(e: any) => setForm((f) => ({ ...f, recipientName: e.target.value || e.detail?.value || '' }))}
              />
              {formErrors.recipientName && (
                <Text className='address-modal__error'>{formErrors.recipientName}</Text>
              )}
            </View>

            <View className='address-modal__field'>
              <Text className='address-modal__label'>手机号码</Text>
              <input
                className='address-modal__input'
                type='tel'
                placeholder='请输入 11 位手机号'
                value={form.phone}
                maxLength={11}
                onInput={(e: any) => setForm((f) => ({ ...f, phone: e.target.value || e.detail?.value || '' }))}
              />
              {formErrors.phone && (
                <Text className='address-modal__error'>{formErrors.phone}</Text>
              )}
            </View>

            <View className='address-modal__field'>
              <Text className='address-modal__label'>详细地址</Text>
              <textarea
                className='address-modal__textarea'
                placeholder='请输入详细地址'
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
                <Text>取消</Text>
              </View>
              <View
                className={`btn-primary address-modal__btn ${submitting ? 'btn-primary--disabled' : ''}`}
                onClick={submitting ? undefined : handleSubmit}
              >
                <Text>{submitting ? '提交中...' : '确认'}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
