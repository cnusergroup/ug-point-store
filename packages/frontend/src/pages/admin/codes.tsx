import { useState, useEffect, useCallback, useMemo } from 'react';
import { View, Text, Input, Image } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { TicketIcon } from '../../components/icons';
import './codes.scss';

type CodeEmailStatus = 'sent' | 'failed' | 'no_email' | 'pending';

interface CodeInfo {
  codeId: string;
  codeValue: string;
  type: 'points' | 'product';
  name?: string;
  pointsValue?: number;
  productId?: string;
  // Candidate set + distribution batch fields (mirrors shared CodeInfo)
  productIds?: string[];
  allocatedUserId?: string;
  batchId?: string;
  emailStatus?: CodeEmailStatus;
  // Recipient store profile (enriched by GET /api/admin/codes for distribution-batch codes)
  recipientNickname?: string;
  recipientEmail?: string;
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

// A user returned by GET /api/admin/users (paginated user list).
// Mirrors the selection UX used by special-reward-award.
interface UserListItem {
  userId: string;
  nickname: string;
  email: string;
  status: 'active' | 'disabled';
}

/**
 * filterUsersBySearch — substring-contains semantics (case-insensitive).
 * Empty query (after trim) returns the original list (order preserved); otherwise
 * filters by nickname / email toLowerCase substring. Mirrors special-reward-award.
 */
function filterUsersBySearch(users: UserListItem[], query: string): UserListItem[] {
  const q = (query ?? '').trim().toLowerCase();
  if (q.length === 0) return users;
  return users.filter(
    (u) =>
      (u.nickname ?? '').toLowerCase().includes(q) ||
      (u.email ?? '').toLowerCase().includes(q),
  );
}

// Distribution result summary returned by POST /api/admin/codes/distribute.
interface DistributionResultSummary {
  batchId: string;
  totalCodes: number;
  sentSuccess: string[];
  sentFailed: { userId: string; error: string }[];
  skippedNoEmail: string[];
}

type FormView = 'hidden' | 'batch-points' | 'product-code' | 'multi-candidate-distribute';
type TypeFilter = 'all' | 'points' | 'product';

// Role filter for the distribute form user list (mirrors batch-points: Leader/Speaker/Volunteer).
type UserRoleFilter = 'UserGroupLeader' | 'Speaker' | 'Volunteer';

// Role filter tabs for the distribute form (same labels/roles as batch-points ROLE_TABS).
const USER_ROLE_TABS: { key: UserRoleFilter; labelKey: string }[] = [
  { key: 'UserGroupLeader', labelKey: 'batchPoints.page.roleLeader' },
  { key: 'Speaker', labelKey: 'batchPoints.page.roleSpeaker' },
  { key: 'Volunteer', labelKey: 'batchPoints.page.roleVolunteer' },
];

// Max number of candidate products that can be bound to a multi-candidate code (Req 3.2 / 3.3)
const MAX_CANDIDATE_PRODUCTS = 10;

// A positive-integer string check used for per-user allocated counts (Req 5.2 / 5.3).
const isPositiveInt = (v: string): boolean => /^[1-9]\d*$/.test(v.trim());

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

  // Multi-candidate distribute form (multi-select candidate products: 1-10)
  const [candidateProductIds, setCandidateProductIds] = useState<string[]>([]);

  // User selector (mirrors special-reward-award): paginated list + client-side search + selection
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersLastKey, setUsersLastKey] = useState<string | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [userRoleFilter, setUserRoleFilter] = useState<UserRoleFilter>('UserGroupLeader');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Per-user code count (allocatedCount), kept as raw text so non-integer input can be
  // validated on submit (Req 5.1-5.3). Defaults to '1' when a user is first selected.
  const [allocatedCounts, setAllocatedCounts] = useState<Record<string, string>>({});

  // Distribution result summary shown after a successful distribute (12.3)
  const [distributeResult, setDistributeResult] = useState<DistributionResultSummary | null>(null);

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

  const openDistribute = () => {
    setCandidateProductIds([]);
    setUserSearch('');
    setUserRoleFilter('UserGroupLeader');
    setSelectedIds(new Set());
    setAllocatedCounts({});
    setDistributeResult(null);
    setError(''); setFormView('multi-candidate-distribute');
  };

  // Fetch a page of active users from the admin users endpoint (mirrors special-reward-award).
  // When append is false the list is replaced (fresh load); otherwise the next page is appended.
  // A role filter (when set) is forwarded as ?role= so the server returns only that role.
  const fetchUsers = useCallback(async (append: boolean, cursor: string | null) => {
    setUsersLoading(true);
    try {
      const params = new URLSearchParams({ pageSize: '50' });
      if (userRoleFilter) params.set('role', userRoleFilter);
      if (append && cursor) params.set('lastKey', cursor);
      const res = await request<{ users: UserListItem[]; lastKey?: string }>({
        url: `/api/admin/users?${params.toString()}`,
      });
      const activeUsers = (res.users || []).filter((u) => u.status === 'active');
      setUsers((prev) => (append ? [...prev, ...activeUsers] : activeUsers));
      setUsersLastKey(res.lastKey ?? null);
    } catch {
      if (!append) setUsers([]);
      setUsersLastKey(null);
    } finally {
      setUsersLoading(false);
    }
  }, [userRoleFilter]);

  // Load page 1 when the distribute form opens or the role filter changes.
  // Selection (selectedIds) and per-user counts (allocatedCounts) are intentionally
  // preserved across role-filter changes — only the paged list is reset.
  useEffect(() => {
    if (formView !== 'multi-candidate-distribute') return;
    if (distributeResult) return;
    fetchUsers(false, null);
  }, [formView, distributeResult, userRoleFilter, fetchUsers]);

  // Client-side filtered list (substring over nickname/email).
  const filteredUsers = useMemo(
    () => filterUsersBySearch(users, userSearch),
    [users, userSearch],
  );

  const isAllSelected =
    filteredUsers.length > 0 && filteredUsers.every((u) => selectedIds.has(u.userId));

  // Toggle a user in/out of the selection. Newly selected users default to allocatedCount=1 (Req 5.1).
  const toggleUser = (userId: string) => {
    const willSelect = !selectedIds.has(userId);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (willSelect) next.add(userId);
      else next.delete(userId);
      return next;
    });
    if (willSelect) {
      setAllocatedCounts((prev) => (prev[userId] != null ? prev : { ...prev, [userId]: '1' }));
    }
  };

  // Select-all / deselect-all over the currently filtered list (Req 4.x parity with special-reward).
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.delete(u.userId));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filteredUsers.forEach((u) => next.add(u.userId));
        return next;
      });
      setAllocatedCounts((prev) => {
        const next = { ...prev };
        filteredUsers.forEach((u) => {
          if (next[u.userId] == null) next[u.userId] = '1';
        });
        return next;
      });
    }
  };

  const updateAllocatedCount = (userId: string, value: string) => {
    setAllocatedCounts((prev) => ({ ...prev, [userId]: value }));
  };

  // Live Total_Code_Count = Σ allocatedCount over selected users with a valid positive integer (Req 3.4 / 5.4).
  const totalCodeCount = useMemo(() => {
    let sum = 0;
    selectedIds.forEach((id) => {
      const v = allocatedCounts[id] ?? '1';
      if (isPositiveInt(v)) sum += Number(v);
    });
    return sum;
  }, [selectedIds, allocatedCounts]);

  const toggleCandidateProduct = (productId: string) => {
    setCandidateProductIds((prev) =>
      prev.includes(productId)
        ? prev.filter((id) => id !== productId)
        : [...prev, productId],
    );
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

  // Validates candidate product selection for the multi-candidate distribute mode (Req 3.2, 3.3, 3.5).
  // Returns false and sets an error message when the selection is invalid.
  const validateCandidateSelection = (): boolean => {
    if (candidateProductIds.length === 0) {
      setError(t('admin.codes.errorNoCandidateProducts'));
      return false;
    }
    if (candidateProductIds.length > MAX_CANDIDATE_PRODUCTS) {
      setError(t('admin.codes.errorTooManyProducts'));
      return false;
    }
    return true;
  };

  const handleDistributeGenerate = async () => {
    // Candidate product validation (12.1).
    if (!validateCandidateSelection()) return;
    // At least one recipient required (Req 3.6).
    if (selectedIds.size === 0) {
      setError(t('admin.codes.errorNoRecipients'));
      return;
    }
    // Build recipients from the selection; each allocatedCount must be a positive integer (Req 5.3).
    const recipients = [...selectedIds].map((userId) => ({
      userId,
      allocatedCount: allocatedCounts[userId] ?? '1',
    }));
    if (recipients.some((r) => !isPositiveInt(r.allocatedCount))) {
      setError(t('admin.codes.errorInvalidAllocatedCount'));
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await request<DistributionResultSummary>({
        url: '/api/admin/codes/distribute',
        method: 'POST',
        data: {
          productIds: candidateProductIds,
          recipients: recipients.map((r) => ({ userId: r.userId, allocatedCount: Number(r.allocatedCount) })),
        },
      });
      setDistributeResult(res);
      fetchCodes();
    } catch (err) {
      setError(err instanceof RequestError ? err.message : t('admin.codes.generateFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  // Resend the distribution email for a single code (Req 9.2 / 9.5).
  const handleResend = async (code: CodeInfo) => {
    try {
      const res = await request<{ codeId: string; emailStatus: CodeEmailStatus }>({
        url: `/api/admin/codes/${code.codeId}/resend`,
        method: 'POST',
      });
      setCodes((prev) => prev.map((c) => (c.codeId === code.codeId ? { ...c, emailStatus: res.emailStatus } : c)));
      Taro.showToast({ title: t('admin.codes.resendSuccess'), icon: 'none' });
    } catch (err) {
      Taro.showToast({ title: err instanceof RequestError ? err.message : t('admin.codes.resendFailed'), icon: 'none' });
    }
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

  // Email send-status badge for distribution-batch codes (Req 9.1).
  const emailStatusLabel: Record<string, { textKey: string; cls: string }> = {
    sent: { textKey: 'admin.codes.emailStatusSent', cls: 'email-status--sent' },
    failed: { textKey: 'admin.codes.emailStatusFailed', cls: 'email-status--failed' },
    no_email: { textKey: 'admin.codes.emailStatusNoEmail', cls: 'email-status--no-email' },
    pending: { textKey: 'admin.codes.emailStatusPending', cls: 'email-status--pending' },
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
          <View className='admin-codes__gen-btn admin-codes__gen-btn--alt' onClick={openDistribute}><Text>{t('admin.codes.addDistributeCode')}</Text></View>
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

      {/* Multi-Candidate Distribute Form */}
      {formView === 'multi-candidate-distribute' && (
        <View className='form-overlay'>
          <View className='form-modal'>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>
                {distributeResult ? t('admin.codes.distributeResultTitle') : t('admin.codes.distributeTitle')}
              </Text>
              <View className='form-modal__close' onClick={closeForm}><Text>✕</Text></View>
            </View>
            {error && !distributeResult && <View className='form-modal__error'><Text>{error}</Text></View>}

            {distributeResult ? (
              /* Distribution result summary (Req 6.5 / 8.6) */
              <View className='form-modal__body'>
                <View className='distribute-result'>
                  <View className='distribute-result__row distribute-result__row--total'>
                    <Text className='distribute-result__label'>{t('admin.codes.distributeResultTotal')}</Text>
                    <Text className='distribute-result__value'>{distributeResult.totalCodes}</Text>
                  </View>
                  <View className='distribute-result__row'>
                    <Text className='distribute-result__label distribute-result__label--success'>{t('admin.codes.distributeResultSent')}</Text>
                    <Text className='distribute-result__value'>{distributeResult.sentSuccess.length}</Text>
                  </View>
                  <View className='distribute-result__row'>
                    <Text className='distribute-result__label distribute-result__label--failed'>{t('admin.codes.distributeResultFailed')}</Text>
                    <Text className='distribute-result__value'>{distributeResult.sentFailed.length}</Text>
                  </View>
                  <View className='distribute-result__row'>
                    <Text className='distribute-result__label distribute-result__label--skipped'>{t('admin.codes.distributeResultSkipped')}</Text>
                    <Text className='distribute-result__value'>{distributeResult.skippedNoEmail.length}</Text>
                  </View>
                </View>
                <View className='form-modal__submit' onClick={closeForm}>
                  <Text>{t('common.confirm')}</Text>
                </View>
              </View>
            ) : (
              <View className='form-modal__body'>
                {/* Candidate product multi-select: choose 1-10 code_exclusive products (Req 3.2) */}
                <View className='form-field'>
                  <View className='form-field__label-row'>
                    <Text className='form-field__label'>{t('admin.codes.selectCandidateProductsLabel')}</Text>
                    <Text className='form-field__count'>
                      {t('admin.codes.candidateSelectedCount', { count: candidateProductIds.length, max: MAX_CANDIDATE_PRODUCTS })}
                    </Text>
                  </View>
                  {codeExclusiveProducts.length === 0 ? (
                    <Text className='form-field__hint'>{t('admin.codes.noCodeExclusiveProducts')}</Text>
                  ) : (
                    <View className='form-field__product-list'>
                      {codeExclusiveProducts.map((p) => {
                        const selected = candidateProductIds.includes(p.productId);
                        return (
                          <View
                            key={p.productId}
                            className={`form-field__product-option ${selected ? 'form-field__product-option--selected' : ''}`}
                            onClick={() => toggleCandidateProduct(p.productId)}
                          >
                            {p.imageUrl ? (
                              <Image className='form-field__product-img' src={p.imageUrl} mode='aspectFill' />
                            ) : (
                              <View className='form-field__product-img-placeholder'><Text><TicketIcon size={20} color='var(--text-tertiary)' /></Text></View>
                            )}
                            <Text className='form-field__product-name'>{p.name}</Text>
                            {selected && <Text className='form-field__product-check'>✓</Text>}
                          </View>
                        );
                      })}
                    </View>
                  )}
                </View>

                {/* User selector: paginated list + client-side search + select-all (mirrors special-reward-award) */}
                <View className='form-field'>
                  <View className='dist-user-header'>
                    <Text className='form-field__label'>{t('admin.codes.selectRecipientsLabel')}</Text>
                    <Text className='dist-user-header__count'>{selectedIds.size} / {filteredUsers.length}</Text>
                    <View className='dist-select-all' onClick={toggleSelectAll}>
                      <Text className='dist-select-all__text'>
                        {isAllSelected
                          ? t('admin.codes.distributeDeselectAll')
                          : t('admin.codes.distributeSelectAll')}
                      </Text>
                    </View>
                  </View>

                  <View className='dist-role-tabs'>
                    {USER_ROLE_TABS.map((tab) => (
                      <View
                        key={tab.key || 'all'}
                        className={`dist-role-tabs__item ${userRoleFilter === tab.key ? 'dist-role-tabs__item--active' : ''}`}
                        onClick={() => setUserRoleFilter(tab.key)}
                      >
                        <Text>{t(tab.labelKey)}</Text>
                      </View>
                    ))}
                  </View>

                  <View className='dist-search'>
                    <Input
                      className='dist-search__input'
                      value={userSearch}
                      onInput={(e) => setUserSearch(e.detail.value)}
                      placeholder={t('admin.codes.distributeSearchPlaceholder')}
                    />
                  </View>

                  <View className='dist-user-list'>
                    {usersLoading && users.length === 0 ? (
                      <View className='dist-empty'>
                        <Text className='dist-empty__text'>{t('admin.codes.loading')}</Text>
                      </View>
                    ) : filteredUsers.length === 0 ? (
                      <View className='dist-empty'>
                        <Text className='dist-empty__text'>
                          {userSearch.trim()
                            ? t('admin.codes.distributeNoUsersSearch')
                            : t('admin.codes.distributeNoUsers')}
                        </Text>
                      </View>
                    ) : (
                      filteredUsers.map((u) => {
                        const selected = selectedIds.has(u.userId);
                        const countVal = allocatedCounts[u.userId] ?? '1';
                        const invalid = selected && !isPositiveInt(countVal);
                        return (
                          <View
                            key={u.userId}
                            className={`dist-user-item ${selected ? 'dist-user-item--selected' : ''}`}
                            onClick={() => toggleUser(u.userId)}
                          >
                            <View className={`dist-user-item__check ${selected ? 'dist-user-item__check--checked' : ''}`}>
                              {selected && <Text className='dist-user-item__check-icon'>✓</Text>}
                            </View>
                            <View className='dist-user-item__info'>
                              <Text className='dist-user-item__nickname'>{u.nickname || '—'}</Text>
                              <Text className='dist-user-item__email'>{u.email || t('admin.codes.userNoEmail')}</Text>
                            </View>
                            {selected && (
                              <View
                                className='dist-user-item__count'
                                onClick={(e) => e.stopPropagation()}
                              >
                                <Text className='dist-user-item__count-label'>{t('admin.codes.distributeCodeCountLabel')}</Text>
                                <Input
                                  className={`dist-user-item__count-input ${invalid ? 'dist-user-item__count-input--invalid' : ''}`}
                                  type='number'
                                  value={countVal}
                                  onInput={(e) => updateAllocatedCount(u.userId, e.detail.value)}
                                />
                              </View>
                            )}
                          </View>
                        );
                      })
                    )}
                    {usersLastKey && !usersLoading && (
                      <View className='dist-load-more' onClick={() => fetchUsers(true, usersLastKey)}>
                        <Text className='dist-load-more__text'>{t('admin.codes.userLoadMore')}</Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Live summary: selected user count + Total_Code_Count (Req 3.4) */}
                <View className='distribute-summary'>
                  <Text className='distribute-summary__item'>{t('admin.codes.summaryUsers', { count: selectedIds.size })}</Text>
                  <Text className='distribute-summary__item distribute-summary__item--total'>{t('admin.codes.summaryTotalCodes', { count: totalCodeCount })}</Text>
                </View>
              </View>
            )}

            {!distributeResult && (
              <View className={`form-modal__submit ${submitting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleDistributeGenerate}>
                <Text>{submitting ? t('admin.codes.generating') : t('admin.codes.distributeSubmit')}</Text>
              </View>
            )}
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
            // A code belongs to a distribution batch when it has a recipient / batch id (Req 9.1).
            const isDistributed = !!(code.allocatedUserId || code.batchId);
            const es = code.emailStatus ? emailStatusLabel[code.emailStatus] : undefined;
            const candidateIds = code.productIds ?? (code.productId ? [code.productId] : []);
            return (
              <View key={code.codeId} className='code-row'>
                <View className='code-row__main'>
                  {code.type === 'product' && candidateIds.length > 0 && (
                    <View className='code-row__product-imgs'>
                      {candidateIds.map((pid) =>
                        productMap[pid]?.imageUrl ? (
                          <Image
                            key={pid}
                            className='code-row__product-img'
                            src={productMap[pid].imageUrl!}
                            mode='aspectFill'
                          />
                        ) : (
                          <View key={pid} className='code-row__product-img code-row__product-img-placeholder'>
                            <Text><TicketIcon size={20} color='var(--text-tertiary)' /></Text>
                          </View>
                        ),
                      )}
                    </View>
                  )}
                  <View className='code-row__info'>
                    <View className='code-row__top'>
                      <Text className='code-row__value'>{code.codeValue}</Text>
                      <Text className={`code-row__type ${code.type === 'product' ? 'code-row__type--product' : ''}`}>
                        {code.type === 'points' ? t('admin.codes.typePoints') : t('admin.codes.typeProduct')}
                      </Text>
                      <Text className={`code-row__status ${st.cls}`}>{t(st.textKey)}</Text>
                      {isDistributed && es && (
                        <Text className={`code-row__email-status ${es.cls}`}>{t(es.textKey)}</Text>
                      )}
                    </View>
                    <View className='code-row__meta'>
                      {code.type === 'points' && code.pointsValue != null && (
                        <Text className='code-row__meta-item'>◆ {code.pointsValue} {t('common.pointsUnit')}</Text>
                      )}
                      {code.type === 'points' && code.name && (
                        <Text className='code-row__meta-item code-row__meta-product'>{code.name}</Text>
                      )}
                      {code.type === 'product' && candidateIds.length > 0 && (
                        <Text className='code-row__meta-item code-row__meta-product'>
                          {candidateIds.length === 1
                            ? (productMap[candidateIds[0]]
                                ? productMap[candidateIds[0]].name
                                : t('admin.codes.productLabel', { name: candidateIds[0] }))
                            : candidateIds
                                .map((pid) => productMap[pid]?.name ?? pid)
                                .join('、')}
                        </Text>
                      )}
                      {isDistributed && code.allocatedUserId && (
                        <Text className='code-row__meta-item code-row__meta-recipient'>
                          {t('admin.codes.recipientLabel', { name: code.recipientNickname || code.recipientEmail || code.allocatedUserId })}
                        </Text>
                      )}
                      <Text className='code-row__meta-item'>{t('admin.codes.usageLabel', { current: code.currentUses, max: code.maxUses })}</Text>
                      <Text className='code-row__meta-item'>{formatTime(code.createdAt)}</Text>
                    </View>
                  </View>
                  <View className='code-row__actions'>
                    <View className='code-row__copy-btn' onClick={() => copyCode(code.codeValue)}><Text>{t('admin.codes.copyButton')}</Text></View>
                    {isDistributed && code.allocatedUserId && (
                      <View className='code-row__resend-btn' onClick={() => handleResend(code)}><Text>{t('admin.codes.resendButton')}</Text></View>
                    )}
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
