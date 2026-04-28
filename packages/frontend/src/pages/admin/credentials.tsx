import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Input, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import './credentials.scss';

/* ── Types ── */

interface CredentialItem {
  credentialId: string;
  recipientName: string;
  eventName: string;
  role: string;
  issueDate: string;
  status: 'active' | 'revoked';
  locale?: string;
}

interface CredentialListResponse {
  items: CredentialItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface BatchImportResponse {
  batchId: string;
  summary: { total: number; success: number; failed: number };
  credentials: Array<{ credentialId: string; recipientName: string }>;
  errors: Array<{ line: number; message: string }>;
}

type StatusFilter = 'all' | 'active' | 'revoked';

const ROLE_LABELS: Record<string, string> = {
  Volunteer: '志愿者',
  Speaker: '讲师',
  Workshop: '工作坊参与者',
  Organizer: '组织者',
};

const STATUS_OPTIONS = ['全部', '有效', '已撤销'];
const STATUS_MAP: StatusFilter[] = ['all', 'active', 'revoked'];

const SEASON_OPTIONS = ['Spring', 'Summer', 'Fall', 'Winter'];

const DEFAULT_PAGE_SIZE = 20;

export default function AdminCredentialsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');

  /* ── Auth guard ── */
  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    const hasAdminAccess = userRoles.some((r) => r === 'Admin' || r === 'SuperAdmin');
    if (!hasAdminAccess) {
      Taro.redirectTo({ url: '/pages/index/index' });
    }
  }, [isAuthenticated, userRoles]);

  /* ── Credential list state ── */
  const [credentials, setCredentials] = useState<CredentialItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  /* ── Batch import state ── */
  const [showImport, setShowImport] = useState(false);
  const [importEventPrefix, setImportEventPrefix] = useState('');
  const [importYear, setImportYear] = useState(String(new Date().getFullYear()));
  const [importSeason, setImportSeason] = useState('Summer');
  const [csvContent, setCsvContent] = useState('');
  const [csvFileName, setCsvFileName] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<BatchImportResponse | null>(null);
  const [importError, setImportError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  /* ── Revocation state ── */
  const [revokeTarget, setRevokeTarget] = useState<CredentialItem | null>(null);
  const [revokeReason, setRevokeReason] = useState('');
  const [revoking, setRevoking] = useState(false);
  const [revokeError, setRevokeError] = useState('');

  /* ── Detail state ── */
  const [selectedCredential, setSelectedCredential] = useState<CredentialItem | null>(null);

  /* ── Fetch credentials ── */
  const fetchCredentials = useCallback(async (p: number, s: string, status: StatusFilter) => {
    setLoading(true);
    try {
      let url = `/api/admin/credentials?page=${p}&pageSize=${DEFAULT_PAGE_SIZE}`;
      if (s.trim()) url += `&search=${encodeURIComponent(s.trim())}`;
      if (status !== 'all') url += `&status=${status}`;
      const res = await request<CredentialListResponse>({ url });
      setCredentials(res.items || []);
      setTotal(res.total || 0);
    } catch {
      setCredentials([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchCredentials(page, search, statusFilter);
    }
  }, [isAuthenticated, page, search, statusFilter, fetchCredentials]);

  const totalPages = Math.max(1, Math.ceil(total / DEFAULT_PAGE_SIZE));

  /* ── Search handler (debounced via page reset) ── */
  const handleSearchInput = (val: string) => {
    setSearch(val);
    setPage(1);
  };

  /* ── Status filter ── */
  const handleStatusChange = (e: { detail: { value: string | number } }) => {
    const idx = Number(e.detail.value);
    setStatusFilter(STATUS_MAP[idx]);
    setPage(1);
  };

  /* ── Pagination ── */
  const goPage = (p: number) => {
    if (p >= 1 && p <= totalPages) setPage(p);
  };

  /* ── View public page ── */
  const openPublicPage = (credentialId: string) => {
    window.open(`/c/${credentialId}`, '_blank');
  };

  /* ── CSV file handling ── */
  const handleFileRead = (file: File) => {
    setCsvFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setCsvContent(text || '');
    };
    reader.readAsText(file, 'utf-8');
  };

  const handleFileInputChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) handleFileRead(file);
    // Reset so same file can be re-selected
    input.value = '';
  };

  const handleDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
      handleFileRead(file);
    }
  };

  /* ── Batch import submit ── */
  const handleImport = async () => {
    if (!importEventPrefix.trim()) {
      setImportError('请输入活动前缀（eventPrefix）');
      return;
    }
    if (!importYear.trim()) {
      setImportError('请输入年份');
      return;
    }
    if (!csvContent) {
      setImportError('请上传 CSV 文件');
      return;
    }
    setImporting(true);
    setImportError('');
    try {
      const res = await request<BatchImportResponse>({
        url: '/api/admin/credentials/batch',
        method: 'POST',
        data: {
          eventPrefix: importEventPrefix.trim(),
          year: importYear.trim(),
          season: importSeason,
          csvContent,
        },
      });
      setImportResult(res);
      // Refresh list
      fetchCredentials(1, search, statusFilter);
      setPage(1);
    } catch (err) {
      setImportError(err instanceof RequestError ? err.message : '导入失败，请重试');
    } finally {
      setImporting(false);
    }
  };

  const openImportModal = () => {
    setImportEventPrefix('');
    setImportYear(String(new Date().getFullYear()));
    setImportSeason('Summer');
    setCsvContent('');
    setCsvFileName('');
    setImportResult(null);
    setImportError('');
    setShowImport(true);
  };

  const closeImportModal = () => {
    setShowImport(false);
    setImportError('');
    setImportResult(null);
  };

  /* ── Revocation ── */
  const openRevokeDialog = (cred: CredentialItem) => {
    setRevokeTarget(cred);
    setRevokeReason('');
    setRevokeError('');
  };

  const closeRevokeDialog = () => {
    setRevokeTarget(null);
    setRevokeReason('');
    setRevokeError('');
  };

  const handleRevoke = async () => {
    if (!revokeTarget) return;
    if (!revokeReason.trim()) {
      setRevokeError('请输入撤销原因');
      return;
    }
    setRevoking(true);
    setRevokeError('');
    try {
      await request({
        url: `/api/admin/credentials/${revokeTarget.credentialId}/revoke`,
        method: 'PATCH',
        data: { reason: revokeReason.trim() },
      });
      // Update local list
      setCredentials((prev) =>
        prev.map((c) =>
          c.credentialId === revokeTarget.credentialId ? { ...c, status: 'revoked' as const } : c,
        ),
      );
      closeRevokeDialog();
      Taro.showToast({ title: '凭证已撤销', icon: 'none' });
    } catch (err) {
      setRevokeError(err instanceof RequestError ? err.message : '撤销失败，请重试');
    } finally {
      setRevoking(false);
    }
  };

  /* ── Detail view ── */
  const handleRowClick = (cred: CredentialItem) => {
    setSelectedCredential(cred);
  };

  const closeDetail = () => {
    setSelectedCredential(null);
  };

  /* ── Navigation ── */
  const handleBack = () => goBack('/pages/admin/index');

  const currentStatusIdx = STATUS_MAP.indexOf(statusFilter);

  return (
    <View className='admin-credentials'>
      {/* Toolbar */}
      <View className='admin-credentials__toolbar'>
        <View className='admin-credentials__back' onClick={handleBack}>
          <Text>← 返回</Text>
        </View>
        <Text className='admin-credentials__title'>凭证管理</Text>
        <View className='admin-credentials__import-btn' onClick={openImportModal}>
          <Text>批量导入</Text>
        </View>
      </View>

      {/* Search & Filter */}
      <View className='cred-filters'>
        <View className='cred-filters__search'>
          <Input
            className='cred-filters__input'
            placeholder='搜索凭证ID、姓名、活动名称'
            value={search}
            onInput={(e) => handleSearchInput(e.detail.value)}
          />
        </View>
        <Picker mode='selector' range={STATUS_OPTIONS} value={currentStatusIdx} onChange={handleStatusChange}>
          <View className='cred-filters__status-picker'>
            <Text>{STATUS_OPTIONS[currentStatusIdx]}</Text>
            <Text className='cred-filters__arrow'>▾</Text>
          </View>
        </Picker>
      </View>

      {/* Credential List */}
      {loading ? (
        <View className='admin-loading'><Text>加载中...</Text></View>
      ) : credentials.length === 0 ? (
        <View className='admin-empty'>
          <Text className='admin-empty__text'>暂无凭证数据</Text>
        </View>
      ) : (
        <View className='cred-list'>
          {credentials.map((cred) => (
            <View key={cred.credentialId} className='cred-row' onClick={() => handleRowClick(cred)}>
              <View className='cred-row__main'>
                <View className='cred-row__top'>
                  <Text className='cred-row__id'>{cred.credentialId}</Text>
                  <Text className={`cred-status cred-status--${cred.status}`}>
                    {cred.status === 'active' ? '有效' : '已撤销'}
                  </Text>
                </View>
                <View className='cred-row__info'>
                  <Text className='cred-row__name'>{cred.recipientName}</Text>
                  <Text className='cred-row__event'>{cred.eventName}</Text>
                </View>
                <View className='cred-row__meta'>
                  <Text className='cred-row__role'>{ROLE_LABELS[cred.role] || cred.role}</Text>
                  <Text className='cred-row__date'>{cred.issueDate}</Text>
                </View>
              </View>
              {/* Revoke button — SuperAdmin only, active credentials only */}
              {isSuperAdmin && cred.status === 'active' && (
                <View
                  className='cred-row__revoke-btn'
                  onClick={(e) => {
                    e.stopPropagation();
                    openRevokeDialog(cred);
                  }}
                >
                  <Text>撤销</Text>
                </View>
              )}
            </View>
          ))}
        </View>
      )}

      {/* Pagination */}
      {!loading && total > DEFAULT_PAGE_SIZE && (
        <View className='cred-pagination'>
          <View
            className={`cred-pagination__btn ${page <= 1 ? 'cred-pagination__btn--disabled' : ''}`}
            onClick={() => goPage(page - 1)}
          >
            <Text>上一页</Text>
          </View>
          <Text className='cred-pagination__info'>{page} / {totalPages}</Text>
          <View
            className={`cred-pagination__btn ${page >= totalPages ? 'cred-pagination__btn--disabled' : ''}`}
            onClick={() => goPage(page + 1)}
          >
            <Text>下一页</Text>
          </View>
        </View>
      )}

      {/* Detail Modal */}
      {selectedCredential && (
        <View className='form-overlay' onClick={closeDetail}>
          <View className='form-modal' onClick={(e) => e.stopPropagation()}>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>凭证详情</Text>
              <View className='form-modal__close' onClick={closeDetail}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <View className='detail-field'>
                <Text className='detail-field__label'>凭证 ID</Text>
                <Text className='detail-field__value'>{selectedCredential.credentialId}</Text>
              </View>
              <View className='detail-field'>
                <Text className='detail-field__label'>收件人</Text>
                <Text className='detail-field__value'>{selectedCredential.recipientName}</Text>
              </View>
              <View className='detail-field'>
                <Text className='detail-field__label'>活动名称</Text>
                <Text className='detail-field__value'>{selectedCredential.eventName}</Text>
              </View>
              <View className='detail-field'>
                <Text className='detail-field__label'>角色</Text>
                <Text className='detail-field__value'>{ROLE_LABELS[selectedCredential.role] || selectedCredential.role}</Text>
              </View>
              <View className='detail-field'>
                <Text className='detail-field__label'>签发日期</Text>
                <Text className='detail-field__value'>{selectedCredential.issueDate}</Text>
              </View>
              <View className='detail-field'>
                <Text className='detail-field__label'>状态</Text>
                <Text className={`cred-status cred-status--${selectedCredential.status}`}>
                  {selectedCredential.status === 'active' ? '有效' : '已撤销'}
                </Text>
              </View>
            </View>
            <View
              className='form-modal__submit'
              onClick={() => openPublicPage(selectedCredential.credentialId)}
            >
              <Text>查看公开页面</Text>
            </View>
          </View>
        </View>
      )}

      {/* Batch Import Modal */}
      {showImport && (
        <View className='form-overlay' onClick={closeImportModal}>
          <View className='form-modal form-modal--wide' onClick={(e) => e.stopPropagation()}>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>批量导入凭证</Text>
              <View className='form-modal__close' onClick={closeImportModal}><Text>✕</Text></View>
            </View>
            {importError && (
              <View className='form-modal__error'><Text>{importError}</Text></View>
            )}
            <View className='form-modal__body'>
              {/* Event Prefix */}
              <View className='form-field'>
                <Text className='form-field__label'>活动前缀 (eventPrefix)</Text>
                <Input
                  className='form-field__input'
                  placeholder='例如: ACD-BASE'
                  value={importEventPrefix}
                  onInput={(e) => setImportEventPrefix(e.detail.value)}
                />
              </View>
              {/* Year */}
              <View className='form-field'>
                <Text className='form-field__label'>年份</Text>
                <Input
                  className='form-field__input'
                  type='number'
                  placeholder='例如: 2026'
                  value={importYear}
                  onInput={(e) => setImportYear(e.detail.value)}
                />
              </View>
              {/* Season */}
              <View className='form-field'>
                <Text className='form-field__label'>季节</Text>
                <Picker
                  mode='selector'
                  range={SEASON_OPTIONS}
                  value={SEASON_OPTIONS.indexOf(importSeason)}
                  onChange={(e) => setImportSeason(SEASON_OPTIONS[Number(e.detail.value)])}
                >
                  <View className='form-field__picker'>
                    <Text>{importSeason}</Text>
                    <Text className='form-field__picker-arrow'>▾</Text>
                  </View>
                </Picker>
              </View>
              {/* CSV Upload */}
              <View className='form-field'>
                <Text className='form-field__label'>CSV 文件</Text>
                {/* Use native div for drag-and-drop support in H5 */}
                <div
                  className={`csv-upload ${isDragging ? 'csv-upload--dragging' : ''} ${csvFileName ? 'csv-upload--has-file' : ''}`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver as any}
                  onDragLeave={handleDragLeave as any}
                  onDrop={handleDrop as any}
                >
                  {csvFileName ? (
                    <View className='csv-upload__file'>
                      <Text className='csv-upload__filename'>{csvFileName}</Text>
                      <Text className='csv-upload__hint'>点击重新选择</Text>
                    </View>
                  ) : (
                    <View className='csv-upload__placeholder'>
                      <Text className='csv-upload__icon'>📄</Text>
                      <Text className='csv-upload__text'>点击选择或拖拽 CSV 文件到此处</Text>
                      <Text className='csv-upload__hint'>支持 UTF-8 编码的 CSV 文件</Text>
                    </View>
                  )}
                </div>
                {/* Hidden file input for H5 */}
                <input
                  ref={fileInputRef}
                  type='file'
                  accept='.csv,text/csv'
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileInputChange(e as unknown as Event)}
                />
              </View>
            </View>

            {/* Import Results */}
            {importResult && (
              <View className='import-result'>
                <View className='import-result__summary'>
                  <View className='import-result__stat'>
                    <Text className='import-result__stat-label'>总计</Text>
                    <Text className='import-result__stat-value'>{importResult.summary.total}</Text>
                  </View>
                  <View className='import-result__stat import-result__stat--success'>
                    <Text className='import-result__stat-label'>成功</Text>
                    <Text className='import-result__stat-value'>{importResult.summary.success}</Text>
                  </View>
                  <View className='import-result__stat import-result__stat--failed'>
                    <Text className='import-result__stat-label'>失败</Text>
                    <Text className='import-result__stat-value'>{importResult.summary.failed}</Text>
                  </View>
                </View>
                {/* Generated credential IDs */}
                {importResult.credentials.length > 0 && (
                  <View className='import-result__ids'>
                    <Text className='import-result__ids-title'>生成的凭证</Text>
                    {importResult.credentials.map((c) => (
                      <View key={c.credentialId} className='import-result__id-row'>
                        <Text className='import-result__id'>{c.credentialId}</Text>
                        <Text className='import-result__id-name'>{c.recipientName}</Text>
                      </View>
                    ))}
                  </View>
                )}
                {/* Errors */}
                {importResult.errors.length > 0 && (
                  <View className='import-result__errors'>
                    <Text className='import-result__errors-title'>错误详情</Text>
                    {importResult.errors.map((err, idx) => (
                      <View key={idx} className='import-result__error-row'>
                        <Text className='import-result__error-line'>第 {err.line} 行</Text>
                        <Text className='import-result__error-msg'>{err.message}</Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            {/* Submit / Done */}
            {!importResult ? (
              <View
                className={`form-modal__submit ${importing ? 'form-modal__submit--loading' : ''}`}
                onClick={handleImport}
              >
                <Text>{importing ? '导入中...' : '开始导入'}</Text>
              </View>
            ) : (
              <View className='form-modal__submit' onClick={closeImportModal}>
                <Text>完成</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Revocation Confirmation Dialog */}
      {revokeTarget && (
        <View className='form-overlay' onClick={closeRevokeDialog}>
          <View className='form-modal' onClick={(e) => e.stopPropagation()}>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>撤销凭证</Text>
              <View className='form-modal__close' onClick={closeRevokeDialog}><Text>✕</Text></View>
            </View>
            {revokeError && (
              <View className='form-modal__error'><Text>{revokeError}</Text></View>
            )}
            <View className='form-modal__body'>
              <View className='detail-field'>
                <Text className='detail-field__label'>凭证 ID</Text>
                <Text className='detail-field__value'>{revokeTarget.credentialId}</Text>
              </View>
              <View className='detail-field'>
                <Text className='detail-field__label'>收件人</Text>
                <Text className='detail-field__value'>{revokeTarget.recipientName}</Text>
              </View>
              <View className='form-field'>
                <Text className='form-field__label'>撤销原因（必填）</Text>
                <Input
                  className='form-field__input'
                  placeholder='请输入撤销原因'
                  value={revokeReason}
                  onInput={(e) => setRevokeReason(e.detail.value)}
                />
              </View>
            </View>
            <View
              className={`form-modal__submit form-modal__submit--danger ${revoking ? 'form-modal__submit--loading' : ''}`}
              onClick={handleRevoke}
            >
              <Text>{revoking ? '撤销中...' : '确认撤销'}</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
