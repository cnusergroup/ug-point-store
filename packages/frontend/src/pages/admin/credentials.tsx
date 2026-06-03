import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Input, Textarea, Picker } from '@tarojs/components';
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
  // Self-applied source markers (present only on self-applied credentials).
  // `appliedByUserId` being truthy identifies a self-applied credential;
  // its absence means the credential was batch-imported.
  appliedByUserId?: string;
  sourceActivityId?: string;
  sourceRole?: string;
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

/* ── Activity-credential template association types ── */
type SourceRole = 'Speaker' | 'UserGroupLeader' | 'Volunteer';

interface AllowedRoleConfig {
  role: SourceRole;
  roleCode: string;
  identityText: string;
}

interface ActivityTemplateAssociation {
  associationId: string;
  activityId: string;
  eventName: string;
  eventPrefix: string;
  year: string;
  season: string;
  allowedRoles: AllowedRoleConfig[];
  locale?: string;
  issuingOrganization?: string;
  eventDate?: string;
  eventLocation?: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
  updatedBy?: string;
}

interface AssociationActivityItem {
  activityId: string;
  activityType?: string;
  ugName?: string;
  topic?: string;
  activityDate?: string;
}

/** Per-role form state for the allowed-roles editor. */
interface RoleFormState {
  selected: boolean;
  identityText: string;
}
type AllowedRolesForm = Record<SourceRole, RoleFormState>;

const ROLE_LABELS: Record<string, string> = {
  Volunteer: '志愿者',
  Speaker: '讲师',
  Workshop: '工作坊参与者',
  Organizer: '组织者',
  UserGroupLeader: '社区负责人',
};

const STATUS_OPTIONS = ['全部', '有效', '已撤销'];
const STATUS_MAP: StatusFilter[] = ['all', 'active', 'revoked'];

const SEASON_OPTIONS = ['Spring', 'Summer', 'Fall', 'Winter'];

/** Source roles selectable for an association (with display labels). */
const SOURCE_ROLE_OPTIONS: { role: SourceRole; label: string }[] = [
  { role: 'Speaker', label: '讲师 (Speaker)' },
  { role: 'UserGroupLeader', label: '社区负责人 (UserGroupLeader)' },
  { role: 'Volunteer', label: '志愿者 (Volunteer)' },
];

/** Fixed Source_Role → Role_Code mapping (mirrors backend SOURCE_ROLE_CODES). */
const SOURCE_ROLE_CODE: Record<SourceRole, string> = {
  Speaker: 'SPK',
  UserGroupLeader: 'UGL',
  Volunteer: 'VOL',
};

const DEFAULT_ISSUING_ORG = 'AWS User Group China';

const EVENT_PREFIX_REGEX = /^[A-Z-]{1,20}$/;
const YEAR_REGEX = /^\d{4}$/;

const emptyAllowedRolesForm = (): AllowedRolesForm => ({
  Speaker: { selected: false, identityText: '' },
  UserGroupLeader: { selected: false, identityText: '' },
  Volunteer: { selected: false, identityText: '' },
});

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

  /* ── Feishu export state ── */
  const [showExport, setShowExport] = useState(false);
  const [exportFields, setExportFields] = useState<string[]>(['recipientName', 'role', 'verifyUrl']);
  const [exportTitle, setExportTitle] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<{ tableUrl: string; recordCount: number } | null>(null);
  const [exportError, setExportError] = useState('');

  /* ── Activity-credential template association state (SuperAdmin only) ── */
  const [associations, setAssociations] = useState<ActivityTemplateAssociation[]>([]);
  const [assocLoading, setAssocLoading] = useState(false);
  const [assocLoadError, setAssocLoadError] = useState('');

  // Form modal (create/edit). `assocFormMode` null means the modal is closed.
  const [assocFormMode, setAssocFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingAssoc, setEditingAssoc] = useState<ActivityTemplateAssociation | null>(null);
  const [assocSaving, setAssocSaving] = useState(false);
  const [assocFormError, setAssocFormError] = useState('');

  // Form fields
  const [assocActivityId, setAssocActivityId] = useState('');
  const [assocEventName, setAssocEventName] = useState('');
  const [assocEventDate, setAssocEventDate] = useState('');
  const [assocEventLocation, setAssocEventLocation] = useState('');
  const [assocIssuingOrg, setAssocIssuingOrg] = useState('');
  const [assocEventPrefix, setAssocEventPrefix] = useState('');
  const [assocYear, setAssocYear] = useState(String(new Date().getFullYear()));
  const [assocSeason, setAssocSeason] = useState('Summer');
  const [assocRolesForm, setAssocRolesForm] = useState<AllowedRolesForm>(emptyAllowedRolesForm());

  // Activity selector (inline dropdown inside the form)
  const [assocActivities, setAssocActivities] = useState<AssociationActivityItem[]>([]);
  const [assocActivitiesLastKey, setAssocActivitiesLastKey] = useState<string | null>(null);
  const [assocActivitiesLoading, setAssocActivitiesLoading] = useState(false);
  const [showAssocActivityList, setShowAssocActivityList] = useState(false);
  const [assocActivitySearch, setAssocActivitySearch] = useState('');

  // Detail view + delete confirmation
  const [assocDetail, setAssocDetail] = useState<ActivityTemplateAssociation | null>(null);
  const [assocDeleteTarget, setAssocDeleteTarget] = useState<ActivityTemplateAssociation | null>(null);
  const [assocDeleting, setAssocDeleting] = useState(false);
  const [assocDeleteError, setAssocDeleteError] = useState('');

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

  /* ── Download CSV template ── */
  const downloadCsvTemplate = () => {
    const header = 'recipientName,role,eventName,locale,eventDate,eventLocation,contribution,issuingOrganization';
    const exampleZh = '张三,Volunteer,亚马逊云科技 Community Day 2026 Summer,zh,2026-06-28,杭州,活动签到引导,AWS User Group China';
    const exampleEn = 'John Doe,Speaker,AWS Community Day 2026 Summer,en,2026-06-28,Hangzhou,Keynote presentation,AWS User Group China';
    const csvText = `${header}\n${exampleZh}\n${exampleEn}\n`;
    const blob = new Blob(['\uFEFF' + csvText], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'credential-template.csv';
    a.click();
    URL.revokeObjectURL(url);
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

  /* ── Feishu export ── */
  const EXPORT_FIELD_OPTIONS: { key: string; label: string }[] = [
    { key: 'recipientName', label: '姓名' },
    { key: 'role', label: '身份' },
    { key: 'verifyUrl', label: '验证链接' },
    { key: 'credentialId', label: '凭证 ID' },
    { key: 'eventName', label: '活动名称' },
    { key: 'issueDate', label: '签发日期' },
    { key: 'eventDate', label: '活动日期' },
    { key: 'eventLocation', label: '活动地点' },
    { key: 'status', label: '状态' },
  ];

  const toggleExportField = (key: string) => {
    setExportFields((prev) =>
      prev.includes(key) ? prev.filter((f) => f !== key) : [...prev, key],
    );
  };

  const openExportModal = () => {
    setExportFields(['recipientName', 'role', 'verifyUrl']);
    setExportTitle('');
    setExportResult(null);
    setExportError('');
    setShowExport(true);
  };

  const closeExportModal = () => {
    setShowExport(false);
    setExportError('');
    setExportResult(null);
  };

  const handleExportFeishu = async () => {
    if (exportFields.length === 0) {
      setExportError('请至少选择一个导出字段');
      return;
    }
    setExporting(true);
    setExportError('');
    try {
      const res = await request<{ tableUrl: string; recordCount: number }>({
        url: '/api/admin/credentials/export-feishu',
        method: 'POST',
        data: {
          fields: exportFields,
          statusFilter: statusFilter !== 'all' ? statusFilter : undefined,
          search: search.trim() || undefined,
          title: exportTitle.trim() || undefined,
        },
      });
      setExportResult(res);
    } catch (err) {
      setExportError(err instanceof RequestError ? err.message : '导出失败，请重试');
    } finally {
      setExporting(false);
    }
  };

  /* ── Activity-credential template association handlers (SuperAdmin only) ── */

  // Fetch the association list. Surfaces an error message (instead of an empty
  // state) when the request fails so SuperAdmin can retry.
  const fetchAssociations = useCallback(async () => {
    setAssocLoading(true);
    setAssocLoadError('');
    try {
      const res = await request<{ associations: ActivityTemplateAssociation[] }>({
        url: '/api/admin/credential-associations',
      });
      setAssociations(res.associations || []);
    } catch (err) {
      setAssociations([]);
      setAssocLoadError(err instanceof RequestError ? err.message : '加载关联列表失败，请重试');
    } finally {
      setAssocLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && isSuperAdmin) {
      fetchAssociations();
    }
  }, [isAuthenticated, isSuperAdmin, fetchAssociations]);

  // Fetch activities for the inline selector (paginated, append on "load more").
  const fetchAssocActivities = useCallback(async (append = false, cursor?: string | null) => {
    if (!append) setAssocActivitiesLoading(true);
    try {
      let url = '/api/admin/activities?pageSize=50';
      if (append && cursor) url += `&lastKey=${encodeURIComponent(cursor)}`;
      const res = await request<{ activities: AssociationActivityItem[]; lastKey?: string }>({ url });
      setAssocActivities((prev) => (append ? [...prev, ...(res.activities || [])] : res.activities || []));
      setAssocActivitiesLastKey(res.lastKey ?? null);
    } catch {
      if (!append) setAssocActivities([]);
    } finally {
      setAssocActivitiesLoading(false);
    }
  }, []);

  const resetAssocForm = () => {
    setAssocActivityId('');
    setAssocEventName('');
    setAssocEventDate('');
    setAssocEventLocation('');
    setAssocIssuingOrg('');
    setAssocEventPrefix('');
    setAssocYear(String(new Date().getFullYear()));
    setAssocSeason('Summer');
    setAssocRolesForm(emptyAllowedRolesForm());
    setAssocFormError('');
    setShowAssocActivityList(false);
    setAssocActivitySearch('');
  };

  const openAssocCreate = () => {
    setEditingAssoc(null);
    resetAssocForm();
    setAssocFormMode('create');
    if (assocActivities.length === 0) fetchAssocActivities(false);
  };

  const openAssocEdit = (assoc: ActivityTemplateAssociation) => {
    setEditingAssoc(assoc);
    setAssocActivityId(assoc.activityId);
    setAssocEventName(assoc.eventName);
    setAssocEventDate(assoc.eventDate || '');
    setAssocEventLocation(assoc.eventLocation || '');
    setAssocIssuingOrg(assoc.issuingOrganization || '');
    setAssocEventPrefix(assoc.eventPrefix);
    setAssocYear(assoc.year);
    setAssocSeason(assoc.season);
    const form = emptyAllowedRolesForm();
    (assoc.allowedRoles || []).forEach((r) => {
      if (form[r.role]) {
        form[r.role] = { selected: true, identityText: r.identityText };
      }
    });
    setAssocRolesForm(form);
    setAssocFormError('');
    setShowAssocActivityList(false);
    setAssocActivitySearch('');
    setAssocFormMode('edit');
    if (assocActivities.length === 0) fetchAssocActivities(false);
  };

  const closeAssocForm = () => {
    setAssocFormMode(null);
    setEditingAssoc(null);
    setAssocFormError('');
  };

  const toggleAssocRole = (role: SourceRole) => {
    setAssocRolesForm((prev) => ({
      ...prev,
      [role]: { ...prev[role], selected: !prev[role].selected },
    }));
  };

  const setAssocRoleIdentityText = (role: SourceRole, value: string) => {
    setAssocRolesForm((prev) => ({
      ...prev,
      [role]: { ...prev[role], identityText: value },
    }));
  };

  const handleSelectAssocActivity = (activity: AssociationActivityItem) => {
    setAssocActivityId(activity.activityId);
    // Pre-fill event name from the activity topic when empty for convenience.
    if (!assocEventName.trim() && activity.topic) {
      setAssocEventName(activity.topic);
    }
    setShowAssocActivityList(false);
    setAssocActivitySearch('');
  };

  const selectedAssocActivity = assocActivities.find((a) => a.activityId === assocActivityId);

  const filteredAssocActivities = (() => {
    const q = assocActivitySearch.trim().toLowerCase();
    if (!q) return assocActivities;
    return assocActivities.filter(
      (a) =>
        (a.topic || '').toLowerCase().includes(q) ||
        (a.ugName || '').toLowerCase().includes(q) ||
        (a.activityId || '').toLowerCase().includes(q),
    );
  })();

  // Build the association payload from the form and validate client-side.
  const buildAssocPayload = (): { ok: true; data: Record<string, unknown> } | { ok: false; message: string } => {
    const activityId = assocActivityId.trim();
    const eventName = assocEventName.trim();
    const eventPrefix = assocEventPrefix.trim().toUpperCase();
    const year = assocYear.trim();

    if (!activityId) return { ok: false, message: '请选择关联活动' };
    if (!eventName) return { ok: false, message: '请输入活动名称' };
    if (eventName.length > 200) return { ok: false, message: '活动名称长度需为 1–200 个字符' };
    if (!eventPrefix) return { ok: false, message: '请输入凭证 ID 前缀（eventPrefix）' };
    if (!EVENT_PREFIX_REGEX.test(eventPrefix)) {
      return { ok: false, message: '前缀仅可包含大写字母 A–Z 与连字符，长度 1–20' };
    }
    if (!YEAR_REGEX.test(year) || Number(year) < 2000 || Number(year) > 2100) {
      return { ok: false, message: '年份需为 2000–2100 之间的四位数字' };
    }
    if (!SEASON_OPTIONS.includes(assocSeason)) {
      return { ok: false, message: '请选择有效的季节' };
    }

    const allowedRoles: Array<{ role: SourceRole; identityText: string }> = [];
    (Object.keys(assocRolesForm) as SourceRole[]).forEach((role) => {
      const cfg = assocRolesForm[role];
      if (cfg.selected) {
        allowedRoles.push({ role, identityText: cfg.identityText.trim() });
      }
    });
    if (allowedRoles.length === 0) {
      return { ok: false, message: '请至少选择一个允许申请的身份' };
    }
    const missingText = allowedRoles.find((r) => !r.identityText);
    if (missingText) {
      return { ok: false, message: `请填写「${ROLE_LABELS[missingText.role] || missingText.role}」的证书身份文案` };
    }
    const tooLong = allowedRoles.find((r) => r.identityText.length > 100);
    if (tooLong) {
      return { ok: false, message: '证书身份文案长度需为 1–100 个字符' };
    }
    if (assocEventLocation.trim() && assocEventLocation.trim().length > 200) {
      return { ok: false, message: '活动地点长度需为 1–200 个字符' };
    }
    if (assocIssuingOrg.trim() && assocIssuingOrg.trim().length > 200) {
      return { ok: false, message: '签发组织长度需为 1–200 个字符' };
    }

    const data: Record<string, unknown> = {
      activityId,
      eventName,
      eventPrefix,
      year,
      season: assocSeason,
      allowedRoles,
    };
    if (assocEventDate.trim()) data.eventDate = assocEventDate.trim();
    if (assocEventLocation.trim()) data.eventLocation = assocEventLocation.trim();
    if (assocIssuingOrg.trim()) data.issuingOrganization = assocIssuingOrg.trim();
    return { ok: true, data };
  };

  const handleSaveAssoc = async () => {
    const built = buildAssocPayload();
    if (!built.ok) {
      setAssocFormError(built.message);
      return;
    }
    setAssocSaving(true);
    setAssocFormError('');
    try {
      if (assocFormMode === 'edit' && editingAssoc) {
        await request({
          url: `/api/admin/credential-associations/${editingAssoc.associationId}`,
          method: 'PUT',
          data: built.data,
        });
        Taro.showToast({ title: '关联已更新', icon: 'none' });
      } else {
        await request({
          url: '/api/admin/credential-associations',
          method: 'POST',
          data: built.data,
        });
        Taro.showToast({ title: '关联已创建', icon: 'none' });
      }
      closeAssocForm();
      fetchAssociations();
    } catch (err) {
      setAssocFormError(err instanceof RequestError ? err.message : '保存失败，请重试');
    } finally {
      setAssocSaving(false);
    }
  };

  const openAssocDetail = (assoc: ActivityTemplateAssociation) => setAssocDetail(assoc);
  const closeAssocDetail = () => setAssocDetail(null);

  const openAssocDelete = (assoc: ActivityTemplateAssociation) => {
    setAssocDeleteTarget(assoc);
    setAssocDeleteError('');
  };
  const closeAssocDelete = () => {
    setAssocDeleteTarget(null);
    setAssocDeleteError('');
  };

  const handleDeleteAssoc = async () => {
    if (!assocDeleteTarget) return;
    setAssocDeleting(true);
    setAssocDeleteError('');
    try {
      await request({
        url: `/api/admin/credential-associations/${assocDeleteTarget.associationId}`,
        method: 'DELETE',
      });
      setAssociations((prev) => prev.filter((a) => a.associationId !== assocDeleteTarget.associationId));
      closeAssocDelete();
      Taro.showToast({ title: '关联已删除', icon: 'none' });
    } catch (err) {
      setAssocDeleteError(err instanceof RequestError ? err.message : '删除失败，请重试');
    } finally {
      setAssocDeleting(false);
    }
  };

  const formatAllowedRolesSummary = (roles: AllowedRoleConfig[]): string =>
    (roles || [])
      .map((r) => `${ROLE_LABELS[r.role] || r.role}「${r.identityText}」`)
      .join('、');

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
        <View className='admin-credentials__export-btn' onClick={openExportModal}>
          <Text>导出飞书</Text>
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
                  <Text
                    className={`cred-source cred-source--${cred.appliedByUserId ? 'self' : 'batch'}`}
                  >
                    {cred.appliedByUserId ? '自助申请' : '批量导入'}
                  </Text>
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

      {/* ── Activity-credential template association management (SuperAdmin only) ── */}
      {isSuperAdmin && (
        <View className='assoc-section'>
          <View className='assoc-section__header'>
            <View className='assoc-section__heading'>
              <Text className='assoc-section__title'>活动-证书模版关联</Text>
              <Text className='assoc-section__subtitle'>配置可自助申请证书的活动及允许身份</Text>
            </View>
            <View className='assoc-section__create-btn' onClick={openAssocCreate}>
              <Text>新建关联</Text>
            </View>
          </View>

          {assocLoading ? (
            <View className='assoc-loading'><Text>加载中...</Text></View>
          ) : assocLoadError ? (
            <View className='assoc-error'>
              <Text className='assoc-error__text'>{assocLoadError}</Text>
              <View className='assoc-error__retry' onClick={fetchAssociations}>
                <Text>重试</Text>
              </View>
            </View>
          ) : associations.length === 0 ? (
            <View className='assoc-empty'>
              <Text className='assoc-empty__text'>暂无活动-证书模版关联</Text>
            </View>
          ) : (
            <View className='assoc-list'>
              {associations.map((assoc) => (
                <View key={assoc.associationId} className='assoc-row' onClick={() => openAssocDetail(assoc)}>
                  <View className='assoc-row__main'>
                    <View className='assoc-row__top'>
                      <Text className='assoc-row__event'>{assoc.eventName}</Text>
                      <Text className='assoc-row__prefix'>
                        {assoc.eventPrefix}-{assoc.year}-{assoc.season}
                      </Text>
                    </View>
                    <Text className='assoc-row__activity'>活动 ID：{assoc.activityId}</Text>
                    <Text className='assoc-row__roles'>{formatAllowedRolesSummary(assoc.allowedRoles)}</Text>
                  </View>
                  <View className='assoc-row__actions'>
                    <View
                      className='assoc-row__action'
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssocDetail(assoc);
                      }}
                    >
                      <Text>查看</Text>
                    </View>
                    <View
                      className='assoc-row__action'
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssocEdit(assoc);
                      }}
                    >
                      <Text>编辑</Text>
                    </View>
                    <View
                      className='assoc-row__action assoc-row__action--danger'
                      onClick={(e) => {
                        e.stopPropagation();
                        openAssocDelete(assoc);
                      }}
                    >
                      <Text>删除</Text>
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
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
                <View className='form-field__label-row'>
                  <Text className='form-field__label'>CSV 文件</Text>
                  <Text className='form-field__download-link' onClick={downloadCsvTemplate}>下载模板</Text>
                </View>
                {/* Use native div for drag-and-drop support in H5 */}
                <label
                  htmlFor='csvFileInput'
                  className={`csv-upload ${isDragging ? 'csv-upload--dragging' : ''} ${csvFileName ? 'csv-upload--has-file' : ''}`}
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
                </label>
                {/* Hidden file input for H5 */}
                <input
                  ref={fileInputRef}
                  id='csvFileInput'
                  type='file'
                  accept='.csv,text/csv'
                  style={{ display: 'none' }}
                  onChange={(e) => handleFileInputChange(e as unknown as Event)}
                />
                <View className='csv-hints'>
                  <Text className='csv-hints__title'>CSV 列说明</Text>
                  <Text className='csv-hints__item'>• role: Volunteer / Speaker / Workshop / Organizer</Text>
                  <Text className='csv-hints__item'>• locale: zh（中文）/ en（English），默认 zh</Text>
                  <Text className='csv-hints__item'>• eventDate: 可选，格式 YYYY-MM-DD</Text>
                  <Text className='csv-hints__item'>• issuingOrganization: 可选，默认 AWS User Group China</Text>
                </View>
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

      {/* Feishu Export Modal */}
      {showExport && (
        <View className='form-overlay' onClick={closeExportModal}>
          <View className='form-modal' onClick={(e) => e.stopPropagation()}>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>导出到飞书</Text>
              <View className='form-modal__close' onClick={closeExportModal}><Text>✕</Text></View>
            </View>
            {exportError && (
              <View className='form-modal__error'><Text>{exportError}</Text></View>
            )}
            <View className='form-modal__body'>
              {/* Export title */}
              <View className='form-field'>
                <Text className='form-field__label'>表格标题（可选）</Text>
                <Input
                  className='form-field__input'
                  placeholder={`凭证导出 ${new Date().toISOString().split('T')[0]}`}
                  value={exportTitle}
                  onInput={(e) => setExportTitle(e.detail.value)}
                />
              </View>
              {/* Field selection */}
              <View className='form-field'>
                <Text className='form-field__label'>选择导出字段</Text>
                <View className='export-fields'>
                  {EXPORT_FIELD_OPTIONS.map((opt) => (
                    <View
                      key={opt.key}
                      className={`export-fields__item ${exportFields.includes(opt.key) ? 'export-fields__item--selected' : ''}`}
                      onClick={() => toggleExportField(opt.key)}
                    >
                      <View className={`export-fields__check ${exportFields.includes(opt.key) ? 'export-fields__check--on' : ''}`}>
                        <Text>{exportFields.includes(opt.key) ? '✓' : ''}</Text>
                      </View>
                      <Text className='export-fields__label'>{opt.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
              {/* Scope hint */}
              <View className='export-scope'>
                <Text className='export-scope__text'>
                  导出范围：{statusFilter === 'all' ? '全部' : statusFilter === 'active' ? '有效' : '已撤销'}
                  {search.trim() ? ` · 搜索「${search.trim()}」` : ''}
                  {` · 共 ${total} 条`}
                </Text>
              </View>
            </View>

            {/* Export result */}
            {exportResult && (
              <View className='export-result'>
                <Text className='export-result__success'>导出成功！共 {exportResult.recordCount} 条记录</Text>
                <View className='export-result__url-box'>
                  <Text className='export-result__url-label'>飞书表格链接</Text>
                  <Text
                    className='export-result__url'
                    onClick={() => window.open(exportResult.tableUrl, '_blank')}
                  >
                    {exportResult.tableUrl}
                  </Text>
                </View>
                <View
                  className='export-result__copy-btn'
                  onClick={() => {
                    navigator.clipboard?.writeText(exportResult.tableUrl);
                    Taro.showToast({ title: '链接已复制', icon: 'none' });
                  }}
                >
                  <Text>复制链接</Text>
                </View>
              </View>
            )}

            {/* Submit / Done */}
            {!exportResult ? (
              <View
                className={`form-modal__submit ${exporting ? 'form-modal__submit--loading' : ''}`}
                onClick={handleExportFeishu}
              >
                <Text>{exporting ? '导出中...' : '开始导出'}</Text>
              </View>
            ) : (
              <View className='form-modal__submit' onClick={closeExportModal}>
                <Text>完成</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* ── Association Create/Edit Modal ── */}
      {assocFormMode && (
        <View className='form-overlay' onClick={closeAssocForm}>
          <View className='form-modal form-modal--wide' onClick={(e) => e.stopPropagation()}>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>
                {assocFormMode === 'edit' ? '编辑活动关联' : '新建活动关联'}
              </Text>
              <View className='form-modal__close' onClick={closeAssocForm}><Text>✕</Text></View>
            </View>
            {assocFormError && (
              <View className='form-modal__error'><Text>{assocFormError}</Text></View>
            )}
            <View className='form-modal__body'>
              {/* Activity selector */}
              <View className='form-field'>
                <Text className='form-field__label'>关联活动</Text>
                {assocFormMode === 'edit' ? (
                  <View className='assoc-activity-picker assoc-activity-picker--locked'>
                    <Text className='assoc-activity-picker__text'>
                      {selectedAssocActivity
                        ? `${selectedAssocActivity.topic || selectedAssocActivity.activityId}`
                        : assocActivityId}
                    </Text>
                    <Text className='assoc-activity-picker__locked-hint'>不可更改</Text>
                  </View>
                ) : (
                  <View
                    className={`assoc-activity-picker ${assocActivityId ? '' : 'assoc-activity-picker--placeholder'}`}
                    onClick={() => setShowAssocActivityList((v) => !v)}
                  >
                    <Text className='assoc-activity-picker__text'>
                      {selectedAssocActivity
                        ? `${selectedAssocActivity.topic || ''}${selectedAssocActivity.ugName ? ` · ${selectedAssocActivity.ugName}` : ''}${selectedAssocActivity.activityDate ? ` · ${selectedAssocActivity.activityDate}` : ''}`
                        : assocActivityId || '点击选择活动'}
                    </Text>
                    <Text className='assoc-activity-picker__arrow'>▾</Text>
                  </View>
                )}

                {assocFormMode === 'create' && showAssocActivityList && (
                  <View className='assoc-activity-dropdown'>
                    <Input
                      className='assoc-activity-dropdown__search'
                      placeholder='搜索活动主题 / 社区 / ID'
                      value={assocActivitySearch}
                      onInput={(e) => setAssocActivitySearch(e.detail.value)}
                    />
                    <View className='assoc-activity-dropdown__list'>
                      {assocActivitiesLoading && assocActivities.length === 0 ? (
                        <View className='assoc-activity-dropdown__empty'><Text>加载中...</Text></View>
                      ) : filteredAssocActivities.length === 0 ? (
                        <View className='assoc-activity-dropdown__empty'><Text>未找到活动</Text></View>
                      ) : (
                        filteredAssocActivities.map((activity) => (
                          <View
                            key={activity.activityId}
                            className={`assoc-activity-dropdown__item ${activity.activityId === assocActivityId ? 'assoc-activity-dropdown__item--selected' : ''}`}
                            onClick={() => handleSelectAssocActivity(activity)}
                          >
                            <Text className='assoc-activity-dropdown__item-topic'>
                              {activity.topic || activity.activityId}
                            </Text>
                            <Text className='assoc-activity-dropdown__item-meta'>
                              {[activity.activityType, activity.ugName, activity.activityDate].filter(Boolean).join(' · ')}
                            </Text>
                          </View>
                        ))
                      )}
                      {assocActivitiesLastKey && !assocActivitiesLoading && (
                        <View
                          className='assoc-activity-dropdown__more'
                          onClick={() => fetchAssocActivities(true, assocActivitiesLastKey)}
                        >
                          <Text>加载更多</Text>
                        </View>
                      )}
                    </View>
                  </View>
                )}
              </View>

              {/* Event name */}
              <View className='form-field'>
                <Text className='form-field__label'>活动名称</Text>
                <Textarea
                  className='form-field__input form-field__textarea'
                  placeholder='例如: AWS Community Day 2026 Summer（按回车可换行，证书将按此换行显示）'
                  value={assocEventName}
                  maxlength={200}
                  autoHeight
                  onInput={(e) => setAssocEventName(e.detail.value)}
                />
                <Text className='form-field__hint'>支持换行：在需要换行处按回车，证书与列表将按此分行显示</Text>
              </View>

              {/* Event date */}
              <View className='form-field'>
                <Text className='form-field__label'>活动日期（可选）</Text>
                <Picker
                  mode='date'
                  value={assocEventDate}
                  onChange={(e) => setAssocEventDate(e.detail.value)}
                >
                  <View className='form-field__picker'>
                    <Text>{assocEventDate || '选择日期'}</Text>
                    <Text className='form-field__picker-arrow'>▾</Text>
                  </View>
                </Picker>
              </View>

              {/* Event location */}
              <View className='form-field'>
                <Text className='form-field__label'>活动地点（可选）</Text>
                <Input
                  className='form-field__input'
                  placeholder='例如: 杭州 / Hangzhou'
                  value={assocEventLocation}
                  onInput={(e) => setAssocEventLocation(e.detail.value)}
                />
              </View>

              {/* Issuing organization */}
              <View className='form-field'>
                <Text className='form-field__label'>签发组织（可选）</Text>
                <Input
                  className='form-field__input'
                  placeholder={DEFAULT_ISSUING_ORG}
                  value={assocIssuingOrg}
                  onInput={(e) => setAssocIssuingOrg(e.detail.value)}
                />
              </View>

              {/* Event prefix */}
              <View className='form-field'>
                <Text className='form-field__label'>凭证 ID 前缀 (eventPrefix)</Text>
                <Input
                  className='form-field__input'
                  placeholder='例如: ACD'
                  value={assocEventPrefix}
                  onInput={(e) => setAssocEventPrefix(e.detail.value)}
                />
              </View>

              {/* Year */}
              <View className='form-field'>
                <Text className='form-field__label'>年份</Text>
                <Input
                  className='form-field__input'
                  type='number'
                  placeholder='例如: 2026'
                  value={assocYear}
                  onInput={(e) => setAssocYear(e.detail.value)}
                />
              </View>

              {/* Season */}
              <View className='form-field'>
                <Text className='form-field__label'>季节</Text>
                <Picker
                  mode='selector'
                  range={SEASON_OPTIONS}
                  value={SEASON_OPTIONS.indexOf(assocSeason)}
                  onChange={(e) => setAssocSeason(SEASON_OPTIONS[Number(e.detail.value)])}
                >
                  <View className='form-field__picker'>
                    <Text>{assocSeason}</Text>
                    <Text className='form-field__picker-arrow'>▾</Text>
                  </View>
                </Picker>
              </View>

              {/* Allowed roles */}
              <View className='form-field'>
                <Text className='form-field__label'>允许申请的身份及证书身份文案</Text>
                <View className='assoc-roles'>
                  {SOURCE_ROLE_OPTIONS.map(({ role, label }) => {
                    const cfg = assocRolesForm[role];
                    return (
                      <View key={role} className='assoc-roles__item'>
                        <View
                          className='assoc-roles__toggle'
                          onClick={() => toggleAssocRole(role)}
                        >
                          <View className={`assoc-roles__check ${cfg.selected ? 'assoc-roles__check--on' : ''}`}>
                            <Text>{cfg.selected ? '✓' : ''}</Text>
                          </View>
                          <Text className='assoc-roles__label'>{label}</Text>
                          <Text className='assoc-roles__code'>{SOURCE_ROLE_CODE[role]}</Text>
                        </View>
                        {cfg.selected && (
                          <Input
                            className='assoc-roles__identity-input'
                            placeholder='证书身份文案，如 Speaker / Volunteer / User Group Leader'
                            value={cfg.identityText}
                            onInput={(e) => setAssocRoleIdentityText(role, e.detail.value)}
                          />
                        )}
                      </View>
                    );
                  })}
                </View>
              </View>
            </View>

            <View
              className={`form-modal__submit ${assocSaving ? 'form-modal__submit--loading' : ''}`}
              onClick={handleSaveAssoc}
            >
              <Text>{assocSaving ? '保存中...' : assocFormMode === 'edit' ? '保存修改' : '创建关联'}</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Association Detail Modal ── */}
      {assocDetail && (
        <View className='form-overlay' onClick={closeAssocDetail}>
          <View className='form-modal' onClick={(e) => e.stopPropagation()}>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>关联详情</Text>
              <View className='form-modal__close' onClick={closeAssocDetail}><Text>✕</Text></View>
            </View>
            <View className='form-modal__body'>
              <View className='detail-field'>
                <Text className='detail-field__label'>活动名称</Text>
                <Text className='detail-field__value'>{assocDetail.eventName}</Text>
              </View>
              <View className='detail-field'>
                <Text className='detail-field__label'>关联活动 ID</Text>
                <Text className='detail-field__value'>{assocDetail.activityId}</Text>
              </View>
              <View className='detail-field'>
                <Text className='detail-field__label'>凭证 ID 前缀</Text>
                <Text className='detail-field__value'>
                  {assocDetail.eventPrefix}-{assocDetail.year}-{assocDetail.season}
                </Text>
              </View>
              {assocDetail.eventDate ? (
                <View className='detail-field'>
                  <Text className='detail-field__label'>活动日期</Text>
                  <Text className='detail-field__value'>{assocDetail.eventDate}</Text>
                </View>
              ) : null}
              {assocDetail.eventLocation ? (
                <View className='detail-field'>
                  <Text className='detail-field__label'>活动地点</Text>
                  <Text className='detail-field__value'>{assocDetail.eventLocation}</Text>
                </View>
              ) : null}
              <View className='detail-field'>
                <Text className='detail-field__label'>签发组织</Text>
                <Text className='detail-field__value'>{assocDetail.issuingOrganization || DEFAULT_ISSUING_ORG}</Text>
              </View>
              <View className='detail-field'>
                <Text className='detail-field__label'>允许申请的身份</Text>
                <View className='assoc-detail-roles'>
                  {(assocDetail.allowedRoles || []).map((r) => (
                    <View key={r.role} className='assoc-detail-roles__item'>
                      <Text className='assoc-detail-roles__role'>
                        {ROLE_LABELS[r.role] || r.role} · {r.roleCode || SOURCE_ROLE_CODE[r.role]}
                      </Text>
                      <Text className='assoc-detail-roles__identity'>{r.identityText}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </View>
            <View
              className='form-modal__submit'
              onClick={() => {
                const target = assocDetail;
                closeAssocDetail();
                if (target) openAssocEdit(target);
              }}
            >
              <Text>编辑此关联</Text>
            </View>
          </View>
        </View>
      )}

      {/* ── Association Delete Confirmation ── */}
      {assocDeleteTarget && (
        <View className='form-overlay' onClick={closeAssocDelete}>
          <View className='form-modal' onClick={(e) => e.stopPropagation()}>
            <View className='form-modal__header'>
              <Text className='form-modal__title'>删除活动关联</Text>
              <View className='form-modal__close' onClick={closeAssocDelete}><Text>✕</Text></View>
            </View>
            {assocDeleteError && (
              <View className='form-modal__error'><Text>{assocDeleteError}</Text></View>
            )}
            <View className='form-modal__body'>
              <Text className='assoc-delete-warning'>
                确定要删除「{assocDeleteTarget.eventName}」的证书模版关联吗？删除后该活动将无法自助申请证书，但已生成的证书不受影响。
              </Text>
              <View className='detail-field'>
                <Text className='detail-field__label'>关联活动 ID</Text>
                <Text className='detail-field__value'>{assocDeleteTarget.activityId}</Text>
              </View>
            </View>
            <View
              className={`form-modal__submit form-modal__submit--danger ${assocDeleting ? 'form-modal__submit--loading' : ''}`}
              onClick={handleDeleteAssoc}
            >
              <Text>{assocDeleting ? '删除中...' : '确认删除'}</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
