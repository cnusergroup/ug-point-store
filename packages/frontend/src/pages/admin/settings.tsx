import { useState, useEffect, useCallback } from 'react';
import { View, Text, Switch, Input } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import {
  SettingsIcon,
  KeyIcon,
  ProfileIcon,
  MailIcon,
  PlaneIcon,
  GiftIcon,
  AdminIcon,
  ArrowLeftIcon,
  HelpIcon,
  UsersIcon,
  RefreshIcon,
  TagIcon,
} from '../../components/icons';
import './settings.scss';

interface RolePermissions {
  canAccess: boolean;
  canUpload: boolean;
  canDownload: boolean;
  canReserve: boolean;
}

interface ContentRolePermissions {
  Speaker: RolePermissions;
  UserGroupLeader: RolePermissions;
  Volunteer: RolePermissions;
}

interface FeatureToggles {
  codeRedemptionEnabled: boolean;
  pointsClaimEnabled: boolean;
  adminProductsEnabled: boolean;
  adminOrdersEnabled: boolean;
  adminContentReviewEnabled: boolean;
  adminCategoriesEnabled: boolean;
  adminEmailProductsEnabled: boolean;
  adminEmailContentEnabled: boolean;
  contentRolePermissions: ContentRolePermissions;
  emailPointsEarnedEnabled: boolean;
  emailNewOrderEnabled: boolean;
  emailOrderShippedEnabled: boolean;
  emailNewProductEnabled: boolean;
  emailNewContentEnabled: boolean;
  emailContentUpdatedEnabled: boolean;
  emailWeeklyDigestEnabled: boolean;
  reservationApprovalPoints: number;
  leaderboardRankingEnabled: boolean;
  leaderboardAnnouncementEnabled: boolean;
  leaderboardUpdateFrequency: 'realtime' | 'daily' | 'weekly' | 'monthly';
  pointsRuleConfig?: PointsRuleConfig;
  brandLogoListEnabled: boolean;
  brandLogoDetailEnabled: boolean;
}

interface PointsRuleConfig {
  uglPointsPerEvent: number;
  volunteerPointsPerEvent: number;
  volunteerMaxPerEvent: number;
  speakerTypeAPoints: number;
  speakerTypeBPoints: number;
  speakerRoundtablePoints: number;
}

type NotificationType = 'pointsEarned' | 'newOrder' | 'orderShipped' | 'newProduct' | 'newContent' | 'contentUpdated' | 'weeklyDigest';

interface EmailToggleConfig {
  key: keyof FeatureToggles;
  notificationType: NotificationType;
  labelKey: string;
  descKey: string;
}

interface TravelSponsorshipSettings {
  travelSponsorshipEnabled: boolean;
  domesticThreshold: number;
  internationalThreshold: number;
}

type EmailLocale = 'zh' | 'en' | 'ja' | 'ko' | 'zh-TW';

interface EmailTemplate {
  templateId: string;
  locale: EmailLocale;
  subject: string;
  body: string;
  updatedAt?: string;
  updatedBy?: string;
}

const LOCALE_TABS: { key: EmailLocale; label: string }[] = [
  { key: 'zh', label: '中文' },
  { key: 'en', label: 'English' },
  { key: 'ja', label: '日本語' },
  { key: 'ko', label: '한국어' },
  { key: 'zh-TW', label: '繁體中文' },
];

const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  pointsEarned: 'admin.settings.email.pointsEarnedLabel',
  newOrder: 'admin.settings.email.newOrderLabel',
  orderShipped: 'admin.settings.email.orderShippedLabel',
  newProduct: 'admin.settings.email.newProductLabel',
  newContent: 'admin.settings.email.newContentLabel',
  contentUpdated: 'admin.settings.email.contentUpdatedLabel',
  weeklyDigest: 'admin.settings.email.weeklyDigestLabel',
};

interface MeetupSyncConfigState {
  groups: { urlname: string; displayName: string }[];
  meetupToken: string;
  meetupCsrf: string;
  meetupSession: string;
  autoSyncEnabled: boolean;
  lastSyncTime?: string;
  lastSyncResult?: string;
}

interface CategoryConfig {
  key: string;
  labelKey: string;
  icon: React.ComponentType<{ size: number; color: string }>;
}

const SETTINGS_CATEGORIES: CategoryConfig[] = [
  { key: 'feature-toggles', labelKey: 'admin.settings.categoryFeatureToggles', icon: SettingsIcon },
  { key: 'admin-permissions', labelKey: 'admin.settings.categoryAdminPermissions', icon: KeyIcon },
  { key: 'content-roles', labelKey: 'admin.settings.categoryContentRoles', icon: ProfileIcon },
  { key: 'email-notifications', labelKey: 'admin.settings.categoryEmailNotifications', icon: MailIcon },
  { key: 'travel-sponsorship', labelKey: 'admin.settings.categoryTravelSponsorship', icon: PlaneIcon },
  { key: 'invite-settings', labelKey: 'admin.settings.categoryInviteSettings', icon: GiftIcon },
  { key: 'ug-management', labelKey: 'admin.settings.categoryUGManagement', icon: UsersIcon },
  { key: 'activity-sync', labelKey: 'admin.settings.categoryActivitySync', icon: RefreshIcon },
  { key: 'points-rule', labelKey: 'admin.settings.categoryPointsRule', icon: TagIcon },
  { key: 'superadmin', labelKey: 'admin.settings.categorySuperAdmin', icon: AdminIcon },
  { key: 'help', labelKey: 'admin.settings.categoryHelp', icon: HelpIcon },
];

function CategoryNav({
  categories,
  activeCategory,
  onCategoryChange,
}: {
  categories: CategoryConfig[];
  activeCategory: string;
  onCategoryChange: (key: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <View className='category-nav'>
      {categories.map((cat) => {
        const isActive = activeCategory === cat.key;
        const IconComp = cat.icon;
        return (
          <View
            key={cat.key}
            className={`category-nav__item${isActive ? ' category-nav__item--active' : ''}`}
            onClick={() => onCategoryChange(cat.key)}
          >
            <View className='category-nav__icon'>
              <IconComp size={18} color={isActive ? 'var(--text-inverse)' : 'var(--text-secondary)'} />
            </View>
            <Text className='category-nav__label'>{t(cat.labelKey as any)}</Text>
          </View>
        );
      })}
    </View>
  );
}

function CollapsibleSection({
  title,
  description,
  defaultExpanded = true,
  children,
}: {
  title: string;
  description?: string;
  defaultExpanded?: boolean;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <View className='collapsible-section'>
      <View className='collapsible-section__header' onClick={() => setExpanded(!expanded)}>
        <View className='collapsible-section__header-text'>
          <Text className='collapsible-section__title'>{title}</Text>
          {description && (
            <Text className='collapsible-section__description'>{description}</Text>
          )}
        </View>
        <Text className={`collapsible-section__chevron${expanded ? ' collapsible-section__chevron--expanded' : ''}`}>
          ›
        </Text>
      </View>
      <View className={`collapsible-section__content${expanded ? ' collapsible-section__content--expanded' : ''}`}>
        {children}
      </View>
    </View>
  );
}

function EmailTemplateEditorModal({
  notificationType,
  onClose,
}: {
  notificationType: NotificationType;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [requiredVariables, setRequiredVariables] = useState<string[]>([]);
  const [activeLocale, setActiveLocale] = useState<EmailLocale>('zh');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [validationError, setValidationError] = useState('');

  const fetchTemplates = useCallback(async () => {
    setLoadingTemplates(true);
    try {
      const res = await request<{ templates: EmailTemplate[]; requiredVariables?: string[] }>({
        url: `/api/admin/email-templates?type=${notificationType}`,
      });
      setTemplates(res.templates || []);
      if (res.requiredVariables) {
        setRequiredVariables(res.requiredVariables);
      }
    } catch {
      Taro.showToast({ title: t('admin.settings.email.templateLoadFailed'), icon: 'none' });
    } finally {
      setLoadingTemplates(false);
    }
  }, [notificationType]);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  // When templates load or locale changes, populate the fields
  useEffect(() => {
    const tpl = templates.find((t) => t.locale === activeLocale);
    setSubject(tpl?.subject ?? '');
    setBody(tpl?.body ?? '');
    setDirty(false);
    setValidationError('');
  }, [templates, activeLocale]);

  const handleSubjectChange = (val: string) => {
    setSubject(val);
    setDirty(true);
    setValidationError('');
  };

  const handleBodyChange = (val: string) => {
    setBody(val);
    setDirty(true);
    setValidationError('');
  };

  const validate = (): boolean => {
    if (subject.length < 1 || subject.length > 200) {
      setValidationError(t('admin.settings.email.templateValidationSubject'));
      return false;
    }
    if (body.length < 1 || body.length > 10000) {
      setValidationError(t('admin.settings.email.templateValidationBody'));
      return false;
    }
    return true;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await request<{ template: EmailTemplate }>({
        url: `/api/admin/email-templates/${notificationType}/${activeLocale}`,
        method: 'PUT',
        data: { subject, body },
      });
      // Update local templates list with the saved template
      setTemplates((prev) => {
        const idx = prev.findIndex((t) => t.locale === activeLocale);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = res.template;
          return updated;
        }
        return [...prev, res.template];
      });
      setDirty(false);
      Taro.showToast({ title: t('admin.settings.email.templateSaved'), icon: 'none' });
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('admin.settings.email.templateSaveFailed'), icon: 'none' });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = () => {
    onClose();
  };

  return (
    <View className='template-editor-overlay' onClick={handleOverlayClick}>
      <View className='template-editor' onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <View className='template-editor__header'>
          <Text className='template-editor__title'>
            {t(NOTIFICATION_TYPE_LABELS[notificationType] as any)} — {t('admin.settings.email.templateEditorTitle')}
          </Text>
          <View className='template-editor__close' onClick={onClose}>
            <Text>✕</Text>
          </View>
        </View>

        {/* Locale Tabs */}
        <View className='template-editor__tabs'>
          {LOCALE_TABS.map((tab) => (
            <View
              key={tab.key}
              className={`template-editor__tab${activeLocale === tab.key ? ' template-editor__tab--active' : ''}`}
              onClick={() => setActiveLocale(tab.key)}
            >
              <Text className='template-editor__tab-text'>{tab.label}</Text>
            </View>
          ))}
        </View>

        {loadingTemplates ? (
          <View className='template-editor__loading'>
            <Text>{t('admin.settings.loading')}</Text>
          </View>
        ) : (
          <View className='template-editor__body'>
            {/* Subject Field */}
            <View className='template-editor__field'>
              <View className='template-editor__field-header'>
                <Text className='template-editor__field-label'>{t('admin.settings.email.templateSubjectLabel')}</Text>
                <Text className='template-editor__field-count'>
                  {subject.length}/200
                </Text>
              </View>
              <Input
                className='template-editor__input'
                value={subject}
                onInput={(e) => handleSubjectChange(e.detail.value)}
                placeholder={t('admin.settings.email.templateSubjectPlaceholder')}
                maxlength={200}
              />
            </View>

            {/* Body Field */}
            <View className='template-editor__field'>
              <View className='template-editor__field-header'>
                <Text className='template-editor__field-label'>{t('admin.settings.email.templateBodyLabel')}</Text>
                <Text className='template-editor__field-count'>
                  {body.length}/10000
                </Text>
              </View>
              <textarea
                className='template-editor__textarea'
                value={body}
                onInput={(e: any) => handleBodyChange(e.target.value || e.detail?.value || '')}
                placeholder={t('admin.settings.email.templateBodyPlaceholder')}
                maxLength={10000}
              />
            </View>

            {/* Variable Reference Panel */}
            {requiredVariables.length > 0 && (
              <View className='template-editor__variables'>
                <Text className='template-editor__variables-title'>{t('admin.settings.email.templateVariablesTitle')}</Text>
                <View className='template-editor__variables-list'>
                  {requiredVariables.map((v) => (
                    <View key={v} className='template-editor__variable-tag'>
                      <Text className='template-editor__variable-text'>{`{{${v}}}`}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}

            {/* Validation Error */}
            {validationError && (
              <View className='template-editor__error'>
                <Text className='template-editor__error-text'>{validationError}</Text>
              </View>
            )}
          </View>
        )}

        {/* Footer */}
        {!loadingTemplates && (
          <View className='template-editor__footer'>
            <View className='template-editor__cancel-btn' onClick={onClose}>
              <Text className='template-editor__cancel-btn-text'>{t('common.cancel')}</Text>
            </View>
            <View
              className={`template-editor__save-btn${(!dirty || saving) ? ' template-editor__save-btn--disabled' : ''}`}
              onClick={(!dirty || saving) ? undefined : handleSave}
            >
              <Text className='template-editor__save-btn-text'>
                {saving ? t('admin.settings.email.templateSaving') : t('common.save')}
              </Text>
            </View>
          </View>
        )}
      </View>
    </View>
  );
}

interface InviteSettings {
  inviteExpiryDays: 1 | 3 | 7;
}

interface AdminUserItem {
  userId: string;
  nickname: string;
  email: string;
}

export default function AdminSettingsPage() {
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);
  const userRoles = useAppStore((s) => s.user?.roles || []);
  const isSuperAdmin = userRoles.includes('SuperAdmin');
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<FeatureToggles>({
    codeRedemptionEnabled: false,
    pointsClaimEnabled: false,
    adminProductsEnabled: true,
    adminOrdersEnabled: true,
    adminContentReviewEnabled: false,
    adminCategoriesEnabled: false,
    adminEmailProductsEnabled: false,
    adminEmailContentEnabled: false,
    contentRolePermissions: {
      Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
      Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
    },
    emailPointsEarnedEnabled: false,
    emailNewOrderEnabled: false,
    emailOrderShippedEnabled: false,
    emailNewProductEnabled: false,
    emailNewContentEnabled: false,
    emailContentUpdatedEnabled: false,
    emailWeeklyDigestEnabled: false,
    reservationApprovalPoints: 10,
    leaderboardRankingEnabled: false,
    leaderboardAnnouncementEnabled: false,
    leaderboardUpdateFrequency: 'weekly',
    brandLogoListEnabled: true,
    brandLogoDetailEnabled: true,
  });


  const [contentRolePermissions, setContentRolePermissions] = useState<ContentRolePermissions>({
    Speaker: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
    UserGroupLeader: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
    Volunteer: { canAccess: true, canUpload: true, canDownload: true, canReserve: true },
  });

  const [travelSettings, setTravelSettings] = useState<TravelSponsorshipSettings>({
    travelSponsorshipEnabled: false,
    domesticThreshold: 0,
    internationalThreshold: 0,
  });
  const [travelLoading, setTravelLoading] = useState(true);
  const [domesticInput, setDomesticInput] = useState('');
  const [internationalInput, setInternationalInput] = useState('');

  const [inviteSettings, setInviteSettings] = useState<InviteSettings>({ inviteExpiryDays: 1 });

  const [adminUsers, setAdminUsers] = useState<AdminUserItem[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
  const [transferPassword, setTransferPassword] = useState('');
  const [transferring, setTransferring] = useState(false);
  const [transferError, setTransferError] = useState('');

  // Email template editor state
  const [editingTemplateType, setEditingTemplateType] = useState<NotificationType | null>(null);

  // UG management state
  const [ugList, setUgList] = useState<{ ugId: string; name: string; status: 'active' | 'inactive'; leaderId?: string; leaderNickname?: string; createdAt: string; updatedAt: string }[]>([]);
  const [ugLoading, setUgLoading] = useState(false);
  const [ugCreating, setUgCreating] = useState(false);
  const [ugNewName, setUgNewName] = useState('');
  const [ugShowCreate, setUgShowCreate] = useState(false);
  const [ugDeleteTarget, setUgDeleteTarget] = useState<string | null>(null);
  const [leaderModalUgId, setLeaderModalUgId] = useState<string | null>(null);
  const [adminUsersList, setAdminUsersList] = useState<{ userId: string; nickname: string; email: string }[]>([]);
  const [leaderSearch, setLeaderSearch] = useState('');
  const [leaderAssigning, setLeaderAssigning] = useState(false);

  // UG rename state
  const [ugEditTarget, setUgEditTarget] = useState<string | null>(null);
  const [ugEditName, setUgEditName] = useState('');
  const [ugRenaming, setUgRenaming] = useState(false);

  // Activity sync config state
  const [syncConfig, setSyncConfig] = useState<{
    syncIntervalDays: number;
    feishuTableUrl: string;
    feishuAppId: string;
    feishuAppSecret: string;
    lastSyncTime?: string;
    lastSyncResult?: string;
  }>({
    syncIntervalDays: 1,
    feishuTableUrl: '',
    feishuAppId: '',
    feishuAppSecret: '',
  });
  const [syncConfigLoading, setSyncConfigLoading] = useState(false);
  const [syncConfigSaving, setSyncConfigSaving] = useState(false);
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncedActivities, setSyncedActivities] = useState<{
    activityId: string;
    activityType: string;
    ugName: string;
    topic: string;
    activityDate: string;
  }[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesLastKey, setActivitiesLastKey] = useState<string | undefined>(undefined);
  const [activitiesHasMore, setActivitiesHasMore] = useState(false);
  const [syncActiveTab, setSyncActiveTab] = useState<'config' | 'meetup' | 'website' | 'actions'>('config');

  // Website sync config state (Taiwan UG)
  const [websiteConfig, setWebsiteConfig] = useState<{
    sources: { url: string; displayName: string }[];
    lastSyncTime?: string;
    lastSyncResult?: string;
  }>({
    sources: [],
  });
  const [websiteConfigLoading, setWebsiteConfigLoading] = useState(false);
  const [websiteConfigSaving, setWebsiteConfigSaving] = useState(false);
  const [websiteSyncing, setWebsiteSyncing] = useState(false);
  const [websiteNewSourceUrl, setWebsiteNewSourceUrl] = useState('');
  const [websiteNewSourceDisplayName, setWebsiteNewSourceDisplayName] = useState('');

  // Meetup sync config state
  const [meetupConfig, setMeetupConfig] = useState<MeetupSyncConfigState>({
    groups: [],
    meetupToken: '',
    meetupCsrf: '',
    meetupSession: '',
    autoSyncEnabled: false,
  });
  const [meetupConfigLoading, setMeetupConfigLoading] = useState(false);
  const [meetupConfigSaving, setMeetupConfigSaving] = useState(false);
  const [meetupTesting, setMeetupTesting] = useState(false);
  const [meetupSyncing, setMeetupSyncing] = useState(false);
  const [meetupNewGroupUrlname, setMeetupNewGroupUrlname] = useState('');
  const [meetupNewGroupDisplayName, setMeetupNewGroupDisplayName] = useState('');

  // Points rule config state
  const [pointsRuleConfig, setPointsRuleConfig] = useState<PointsRuleConfig>({
    uglPointsPerEvent: 50,
    volunteerPointsPerEvent: 30,
    volunteerMaxPerEvent: 10,
    speakerTypeAPoints: 100,
    speakerTypeBPoints: 50,
    speakerRoundtablePoints: 50,
  });
  const [pointsRuleSaving, setPointsRuleSaving] = useState(false);

  const [activeCategory, setActiveCategory] = useState<string>('feature-toggles');
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const toggleSection = (sectionKey: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionKey)) {
        next.delete(sectionKey);
      } else {
        next.add(sectionKey);
      }
      return next;
    });
  };

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request<FeatureToggles>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });
      setSettings(res);
      if (res.contentRolePermissions) {
        setContentRolePermissions(res.contentRolePermissions);
      }
      if (res.pointsRuleConfig) {
        setPointsRuleConfig(res.pointsRuleConfig);
      }
    } catch {
      // On failure, keep defaults (false)
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTravelSettings = useCallback(async () => {
    setTravelLoading(true);
    try {
      const res = await request<TravelSponsorshipSettings>({
        url: '/api/settings/travel-sponsorship',
        skipAuth: true,
      });
      setTravelSettings(res);
      setDomesticInput(res.domesticThreshold > 0 ? String(res.domesticThreshold) : '');
      setInternationalInput(res.internationalThreshold > 0 ? String(res.internationalThreshold) : '');
    } catch {
      // On failure, keep defaults
    } finally {
      setTravelLoading(false);
    }
  }, []);

  const fetchInviteSettings = useCallback(async () => {
    try {
      const res = await request<InviteSettings>({
        url: '/api/settings/invite-settings',
        skipAuth: true,
      });
      const days = res.inviteExpiryDays;
      if (days === 1 || days === 3 || days === 7) {
        setInviteSettings({ inviteExpiryDays: days });
      }
    } catch {
      // On failure, keep default (1 day)
    }
  }, []);

  const fetchAdminUsers = useCallback(async () => {
    try {
      const res = await request<{ users: AdminUserItem[] }>({
        url: '/api/admin/users?role=Admin',
      });
      setAdminUsers(res.users || []);
    } catch {
      // On failure, keep empty list
    }
  }, []);

  const fetchUGs = useCallback(async () => {
    setUgLoading(true);
    try {
      const res = await request<{ ugs: typeof ugList }>({
        url: '/api/admin/ugs',
      });
      setUgList(res.ugs || []);
    } catch {
      // On failure, keep empty list
    } finally {
      setUgLoading(false);
    }
  }, []);

  const handleCreateUG = async () => {
    const trimmed = ugNewName.trim();
    if (!trimmed) return;
    setUgCreating(true);
    try {
      await request({
        url: '/api/admin/ugs',
        method: 'POST',
        data: { name: trimmed },
      });
      Taro.showToast({ title: t('ugManagement.createSuccess' as any), icon: 'none' });
      setUgNewName('');
      setUgShowCreate(false);
      fetchUGs();
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('ugManagement.createFailed' as any), icon: 'none' });
      }
    } finally {
      setUgCreating(false);
    }
  };

  const handleToggleUGStatus = async (ugId: string, currentStatus: 'active' | 'inactive') => {
    const newStatus = currentStatus === 'active' ? 'inactive' : 'active';
    // Optimistic update
    setUgList((prev) => prev.map((ug) => ug.ugId === ugId ? { ...ug, status: newStatus } : ug));
    try {
      await request({
        url: `/api/admin/ugs/${ugId}/status`,
        method: 'PUT',
        data: { status: newStatus },
      });
      Taro.showToast({ title: t('ugManagement.statusUpdated' as any), icon: 'none' });
    } catch (err) {
      // Revert on failure
      setUgList((prev) => prev.map((ug) => ug.ugId === ugId ? { ...ug, status: currentStatus } : ug));
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('ugManagement.statusUpdateFailed' as any), icon: 'none' });
      }
    }
  };

  const handleDeleteUG = async (ugId: string) => {
    try {
      await request({
        url: `/api/admin/ugs/${ugId}`,
        method: 'DELETE',
      });
      Taro.showToast({ title: t('ugManagement.deleted' as any), icon: 'none' });
      setUgDeleteTarget(null);
      setUgList((prev) => prev.filter((ug) => ug.ugId !== ugId));
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('ugManagement.deleteFailed' as any), icon: 'none' });
      }
    }
  };

  // Leader modal: fetch admin users when modal opens
  const fetchAdminUsersForLeader = useCallback(async () => {
    try {
      const res = await request<{ users: { userId: string; nickname: string; email: string }[] }>({
        url: '/api/admin/users?role=Admin',
      });
      setAdminUsersList(res.users || []);
    } catch {
      setAdminUsersList([]);
    }
  }, []);

  useEffect(() => {
    if (leaderModalUgId) {
      setLeaderSearch('');
      fetchAdminUsersForLeader();
    }
  }, [leaderModalUgId, fetchAdminUsersForLeader]);

  const handleAssignLeader = async (userId: string) => {
    if (!leaderModalUgId || leaderAssigning) return;
    setLeaderAssigning(true);
    try {
      await request({
        url: `/api/admin/ugs/${leaderModalUgId}/leader`,
        method: 'PUT',
        data: { leaderId: userId },
      });
      Taro.showToast({ title: t('ugManagement.assignSuccess' as any), icon: 'none' });
      setLeaderModalUgId(null);
      fetchUGs();
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('ugManagement.assignFailed' as any), icon: 'none' });
      }
    } finally {
      setLeaderAssigning(false);
    }
  };

  const handleRemoveLeader = async () => {
    if (!leaderModalUgId || leaderAssigning) return;
    setLeaderAssigning(true);
    try {
      await request({
        url: `/api/admin/ugs/${leaderModalUgId}/leader`,
        method: 'DELETE',
      });
      Taro.showToast({ title: t('ugManagement.removeSuccess' as any), icon: 'none' });
      setLeaderModalUgId(null);
      fetchUGs();
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('ugManagement.removeFailed' as any), icon: 'none' });
      }
    } finally {
      setLeaderAssigning(false);
    }
  };

  const handleStartEditUG = (ugId: string, currentName: string) => {
    setUgEditTarget(ugId);
    setUgEditName(currentName);
  };

  const handleCancelEditUG = () => {
    setUgEditTarget(null);
    setUgEditName('');
  };

  const handleSaveRenameUG = async (ugId: string) => {
    const trimmed = ugEditName.trim();
    if (!trimmed) return;
    setUgRenaming(true);
    try {
      await request({
        url: `/api/admin/ugs/${ugId}`,
        method: 'PUT',
        data: { name: trimmed },
      });
      Taro.showToast({ title: t('ugManagement.renameSuccess' as any), icon: 'none' });
      setUgEditTarget(null);
      setUgEditName('');
      fetchUGs();
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('ugManagement.renameFailed' as any), icon: 'none' });
      }
    } finally {
      setUgRenaming(false);
    }
  };

  // Activity sync config handlers
  const fetchSyncConfig = useCallback(async () => {
    setSyncConfigLoading(true);
    try {
      const res = await request<{
        syncIntervalDays: number;
        feishuTableUrl: string;
        feishuAppId: string;
        feishuAppSecret: string;
        lastSyncTime?: string;
        lastSyncResult?: string;
      }>({
        url: '/api/admin/settings/activity-sync-config',
      });
      setSyncConfig({
        syncIntervalDays: res.syncIntervalDays || 1,
        feishuTableUrl: res.feishuTableUrl || '',
        feishuAppId: res.feishuAppId || '',
        feishuAppSecret: res.feishuAppSecret || '',
        lastSyncTime: res.lastSyncTime,
        lastSyncResult: res.lastSyncResult,
      });
    } catch {
      // Keep defaults on failure
    } finally {
      setSyncConfigLoading(false);
    }
  }, []);

  const handleSaveSyncConfig = async () => {
    setSyncConfigSaving(true);
    try {
      await request({
        url: '/api/admin/settings/activity-sync-config',
        method: 'PUT',
        data: {
          syncIntervalDays: syncConfig.syncIntervalDays,
          feishuTableUrl: syncConfig.feishuTableUrl,
          feishuAppId: syncConfig.feishuAppId,
          feishuAppSecret: syncConfig.feishuAppSecret,
        },
      });
      Taro.showToast({ title: t('activitySync.saveSuccess' as any), icon: 'none' });
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('activitySync.saveFailed' as any), icon: 'none' });
      }
    } finally {
      setSyncConfigSaving(false);
    }
  };

  const handleManualSync = async () => {
    setSyncRunning(true);
    try {
      const res = await request<{ syncedCount?: number; skippedCount?: number }>({
        url: '/api/admin/sync/activities',
        method: 'POST',
      });
      const msg = `${t('activitySync.fetchSuccess' as any)}：${res.syncedCount ?? 0} / ${res.skippedCount ?? 0}`;
      Taro.showToast({ title: msg, icon: 'none', duration: 3000 });
      fetchSyncConfig();
      fetchSyncedActivities(true);
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('activitySync.fetchFailed' as any), icon: 'none' });
      }
    } finally {
      setSyncRunning(false);
    }
  };

  const fetchMeetupSyncConfig = useCallback(async () => {
    setMeetupConfigLoading(true);
    try {
      const res = await request<{
        groups?: { urlname: string; displayName: string }[];
        meetupToken?: string;
        meetupCsrf?: string;
        meetupSession?: string;
        autoSyncEnabled?: boolean;
        lastSyncTime?: string;
        lastSyncResult?: string;
      }>({ url: '/api/admin/settings/meetup-sync-config' });
      setMeetupConfig({
        groups: res.groups || [],
        meetupToken: res.meetupToken || '',
        meetupCsrf: res.meetupCsrf || '',
        meetupSession: res.meetupSession || '',
        autoSyncEnabled: res.autoSyncEnabled || false,
        lastSyncTime: res.lastSyncTime,
        lastSyncResult: res.lastSyncResult,
      });
    } catch { /* Keep defaults */ } finally { setMeetupConfigLoading(false); }
  }, []);

  const fetchWebsiteSyncConfig = useCallback(async () => {
    setWebsiteConfigLoading(true);
    try {
      const res = await request<{
        sources?: { url: string; displayName: string }[];
        lastSyncTime?: string;
        lastSyncResult?: string;
      }>({ url: '/api/admin/settings/website-sync-config' });
      setWebsiteConfig({
        sources: res.sources || [],
        lastSyncTime: res.lastSyncTime,
        lastSyncResult: res.lastSyncResult,
      });
    } catch { /* Keep defaults */ } finally { setWebsiteConfigLoading(false); }
  }, []);

  const handleSaveWebsiteConfig = async () => {
    for (const source of websiteConfig.sources) {
      if (!source.url.startsWith('https://')) { Taro.showToast({ title: t('activitySync.websiteUrlValidation' as any), icon: 'none' }); return; }
      if (!source.displayName.trim()) { Taro.showToast({ title: t('activitySync.websiteSourceDisplayNamePlaceholder' as any), icon: 'none' }); return; }
    }
    setWebsiteConfigSaving(true);
    try {
      await request({ url: '/api/admin/settings/website-sync-config', method: 'PUT', data: { sources: websiteConfig.sources } });
      Taro.showToast({ title: t('activitySync.saveSuccess' as any), icon: 'none' });
      fetchWebsiteSyncConfig();
    } catch (err) {
      Taro.showToast({ title: err instanceof RequestError ? err.message : t('activitySync.saveFailed' as any), icon: 'none' });
    } finally { setWebsiteConfigSaving(false); }
  };

  const handleWebsiteSync = async () => {
    setWebsiteSyncing(true);
    try {
      const res = await request<{ syncedCount?: number; skippedCount?: number; warnings?: string[] }>({ url: '/api/admin/sync/website', method: 'POST' });
      const msg = `${t('activitySync.websiteSyncSuccess' as any)}：${res.syncedCount ?? 0} / ${res.skippedCount ?? 0}`;
      Taro.showToast({ title: msg, icon: 'none', duration: 3000 });
      fetchWebsiteSyncConfig();
      fetchSyncedActivities(true);
    } catch (err) {
      Taro.showToast({ title: err instanceof RequestError ? err.message : t('activitySync.websiteSyncFailed' as any), icon: 'none' });
    } finally { setWebsiteSyncing(false); }
  };

  const handleSaveMeetupConfig = async () => {
    setMeetupConfigSaving(true);
    try {
      await request({ url: '/api/admin/settings/meetup-sync-config', method: 'PUT', data: { groups: meetupConfig.groups, meetupToken: meetupConfig.meetupToken, meetupCsrf: meetupConfig.meetupCsrf, meetupSession: meetupConfig.meetupSession, autoSyncEnabled: meetupConfig.autoSyncEnabled } });
      Taro.showToast({ title: t('activitySync.saveSuccess' as any), icon: 'none' });
      fetchMeetupSyncConfig();
    } catch (err) {
      Taro.showToast({ title: err instanceof RequestError ? err.message : t('activitySync.saveFailed' as any), icon: 'none' });
    } finally { setMeetupConfigSaving(false); }
  };

  const handleTestMeetupConnection = async () => {
    setMeetupTesting(true);
    try {
      const res = await request<{ success: boolean; error?: { code: string; message: string } }>({ url: '/api/admin/settings/meetup-sync-config/test', method: 'POST', data: { meetupToken: meetupConfig.meetupToken, meetupCsrf: meetupConfig.meetupCsrf, meetupSession: meetupConfig.meetupSession } });
      if (res.success) { Taro.showToast({ title: t('activitySync.meetupTestSuccess' as any), icon: 'none' }); }
      else { Taro.showToast({ title: res.error?.code === 'MEETUP_AUTH_EXPIRED' ? t('activitySync.meetupAuthExpired' as any) : t('activitySync.meetupTestFailed' as any), icon: 'none' }); }
    } catch (err) {
      Taro.showToast({ title: err instanceof RequestError ? err.message : t('activitySync.meetupTestFailed' as any), icon: 'none' });
    } finally { setMeetupTesting(false); }
  };

  const handleMeetupSync = async () => {
    setMeetupSyncing(true);
    try {
      const res = await request<{ syncedCount?: number; skippedCount?: number; warnings?: string[] }>({ url: '/api/admin/sync/meetup', method: 'POST' });
      const msg = `${t('activitySync.meetupSyncSuccess' as any)}：${res.syncedCount ?? 0} / ${res.skippedCount ?? 0}`;
      Taro.showToast({ title: msg, icon: 'none', duration: 3000 });
      fetchMeetupSyncConfig();
      fetchSyncedActivities(true);
    } catch (err) {
      const msg = (err instanceof RequestError && err.code === 'MEETUP_AUTH_EXPIRED') ? t('activitySync.meetupAuthExpired' as any) : (err instanceof RequestError ? err.message : t('activitySync.meetupSyncFailed' as any));
      Taro.showToast({ title: msg, icon: 'none' });
    } finally { setMeetupSyncing(false); }
  };

  const fetchSyncedActivities = useCallback(async (reset = false, lastKeyOverride?: string) => {
    setActivitiesLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('pageSize', '20');
      if (!reset && lastKeyOverride) {
        params.set('lastKey', lastKeyOverride);
      }
      const res = await request<{
        activities: typeof syncedActivities;
        lastKey?: string;
      }>({
        url: `/api/admin/activities?${params.toString()}`,
      });
      if (reset) {
        setSyncedActivities(res.activities || []);
      } else {
        setSyncedActivities((prev) => [...prev, ...(res.activities || [])]);
      }
      setActivitiesLastKey(res.lastKey);
      setActivitiesHasMore(!!res.lastKey);
    } catch {
      // Keep current list on failure
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    if (!isSuperAdmin) {
      Taro.redirectTo({ url: '/pages/admin/index' });
      return;
    }
    fetchSettings();
    fetchTravelSettings();
    fetchInviteSettings();
    fetchAdminUsers();
    fetchUGs();
    fetchSyncConfig();
    fetchMeetupSyncConfig();
    fetchWebsiteSyncConfig();
    fetchSyncedActivities(true);
  }, [isAuthenticated, isSuperAdmin, fetchSettings, fetchTravelSettings, fetchInviteSettings, fetchAdminUsers, fetchUGs, fetchSyncConfig, fetchMeetupSyncConfig, fetchWebsiteSyncConfig, fetchSyncedActivities]);

  const handleToggle = async (key: keyof FeatureToggles, newValue: boolean) => {
    const prev = { ...settings };
    const updated = { ...settings, [key]: newValue };
    setSettings(updated);

    try {
      await request({
        url: '/api/admin/settings/feature-toggles',
        method: 'PUT',
        data: {
          codeRedemptionEnabled: updated.codeRedemptionEnabled,
          pointsClaimEnabled: updated.pointsClaimEnabled,
          adminProductsEnabled: updated.adminProductsEnabled,
          adminOrdersEnabled: updated.adminOrdersEnabled,
          adminContentReviewEnabled: updated.adminContentReviewEnabled,
          adminCategoriesEnabled: updated.adminCategoriesEnabled,
          adminEmailProductsEnabled: updated.adminEmailProductsEnabled,
          adminEmailContentEnabled: updated.adminEmailContentEnabled,
          emailPointsEarnedEnabled: updated.emailPointsEarnedEnabled,
          emailNewOrderEnabled: updated.emailNewOrderEnabled,
          emailOrderShippedEnabled: updated.emailOrderShippedEnabled,
          emailNewProductEnabled: updated.emailNewProductEnabled,
          emailNewContentEnabled: updated.emailNewContentEnabled,
          emailContentUpdatedEnabled: updated.emailContentUpdatedEnabled,
          emailWeeklyDigestEnabled: updated.emailWeeklyDigestEnabled,
          reservationApprovalPoints: updated.reservationApprovalPoints,
          leaderboardRankingEnabled: updated.leaderboardRankingEnabled,
          leaderboardAnnouncementEnabled: updated.leaderboardAnnouncementEnabled,
          leaderboardUpdateFrequency: updated.leaderboardUpdateFrequency,
          brandLogoListEnabled: updated.brandLogoListEnabled,
          brandLogoDetailEnabled: updated.brandLogoDetailEnabled,
        },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      // Revert on failure
      setSettings(prev);
      Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
    }
  };

  const handleFrequencyChange = async (newFrequency: 'daily' | 'weekly' | 'monthly') => {
    if (newFrequency === settings.leaderboardUpdateFrequency) return;
    const prev = { ...settings };
    const updated = { ...settings, leaderboardUpdateFrequency: newFrequency };
    setSettings(updated);

    try {
      await request({
        url: '/api/admin/settings/feature-toggles',
        method: 'PUT',
        data: {
          codeRedemptionEnabled: updated.codeRedemptionEnabled,
          pointsClaimEnabled: updated.pointsClaimEnabled,
          adminProductsEnabled: updated.adminProductsEnabled,
          adminOrdersEnabled: updated.adminOrdersEnabled,
          adminContentReviewEnabled: updated.adminContentReviewEnabled,
          adminCategoriesEnabled: updated.adminCategoriesEnabled,
          adminEmailProductsEnabled: updated.adminEmailProductsEnabled,
          adminEmailContentEnabled: updated.adminEmailContentEnabled,
          emailPointsEarnedEnabled: updated.emailPointsEarnedEnabled,
          emailNewOrderEnabled: updated.emailNewOrderEnabled,
          emailOrderShippedEnabled: updated.emailOrderShippedEnabled,
          emailNewProductEnabled: updated.emailNewProductEnabled,
          emailNewContentEnabled: updated.emailNewContentEnabled,
          emailContentUpdatedEnabled: updated.emailContentUpdatedEnabled,
          emailWeeklyDigestEnabled: updated.emailWeeklyDigestEnabled,
          reservationApprovalPoints: updated.reservationApprovalPoints,
          leaderboardRankingEnabled: updated.leaderboardRankingEnabled,
          leaderboardAnnouncementEnabled: updated.leaderboardAnnouncementEnabled,
          leaderboardUpdateFrequency: updated.leaderboardUpdateFrequency,
          brandLogoListEnabled: updated.brandLogoListEnabled,
          brandLogoDetailEnabled: updated.brandLogoDetailEnabled,
        },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      setSettings(prev);
      Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
    }
  };

  const handlePermissionToggle = async (
    role: keyof ContentRolePermissions,
    perm: keyof RolePermissions,
    newValue: boolean,
  ) => {
    const prev = { ...contentRolePermissions };
    const updated = {
      ...contentRolePermissions,
      [role]: { ...contentRolePermissions[role], [perm]: newValue },
    };
    setContentRolePermissions(updated);

    try {
      await request({
        url: '/api/admin/settings/content-role-permissions',
        method: 'PUT',
        data: { contentRolePermissions: updated },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      setContentRolePermissions(prev);
      Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
    }
  };

  const isValidPositiveInteger = (value: string): boolean => {
    const num = Number(value);
    return Number.isInteger(num) && num >= 1;
  };

  const updateTravelSettings = async (newSettings: TravelSponsorshipSettings) => {
    const prev = { ...travelSettings };
    const prevDomestic = domesticInput;
    const prevInternational = internationalInput;
    setTravelSettings(newSettings);

    try {
      await request({
        url: '/api/admin/settings/travel-sponsorship',
        method: 'PUT',
        data: {
          travelSponsorshipEnabled: newSettings.travelSponsorshipEnabled,
          domesticThreshold: newSettings.domesticThreshold,
          internationalThreshold: newSettings.internationalThreshold,
        },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      // Revert on failure
      setTravelSettings(prev);
      setDomesticInput(prevDomestic);
      setInternationalInput(prevInternational);
      Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
    }
  };

  const handleTravelToggle = (newValue: boolean) => {
    // When enabling, thresholds must be valid positive integers first
    if (newValue) {
      const domesticOk = isValidPositiveInteger(domesticInput);
      const internationalOk = isValidPositiveInteger(internationalInput);
      if (!domesticOk || !internationalOk) {
        Taro.showToast({ title: t('admin.settings.thresholdRequiredBeforeEnable'), icon: 'none' });
        return;
      }
      updateTravelSettings({
        ...travelSettings,
        travelSponsorshipEnabled: true,
        domesticThreshold: Number(domesticInput),
        internationalThreshold: Number(internationalInput),
      });
    } else {
      // When disabling, use current valid thresholds (fallback to 1 if still 0)
      const domestic = travelSettings.domesticThreshold > 0 ? travelSettings.domesticThreshold : 1;
      const international = travelSettings.internationalThreshold > 0 ? travelSettings.internationalThreshold : 1;
      updateTravelSettings({
        ...travelSettings,
        travelSponsorshipEnabled: false,
        domesticThreshold: domestic,
        internationalThreshold: international,
      });
    }
  };

  const handleDomesticBlur = () => {
    if (!isValidPositiveInteger(domesticInput)) {
      Taro.showToast({ title: t('admin.settings.thresholdError'), icon: 'none' });
      setDomesticInput(travelSettings.domesticThreshold > 0 ? String(travelSettings.domesticThreshold) : '');
      return;
    }
    const newValue = Number(domesticInput);
    if (newValue !== travelSettings.domesticThreshold) {
      updateTravelSettings({
        ...travelSettings,
        domesticThreshold: newValue,
      });
    }
  };

  const handleInternationalBlur = () => {
    if (!isValidPositiveInteger(internationalInput)) {
      Taro.showToast({ title: t('admin.settings.thresholdError'), icon: 'none' });
      setInternationalInput(travelSettings.internationalThreshold > 0 ? String(travelSettings.internationalThreshold) : '');
      return;
    }
    const newValue = Number(internationalInput);
    if (newValue !== travelSettings.internationalThreshold) {
      updateTravelSettings({
        ...travelSettings,
        internationalThreshold: newValue,
      });
    }
  };

  const handleInviteExpiryChange = async (days: 1 | 3 | 7) => {
    if (days === inviteSettings.inviteExpiryDays) return;
    const prev = inviteSettings;
    setInviteSettings({ inviteExpiryDays: days });
    try {
      await request({
        url: '/api/admin/settings/invite-settings',
        method: 'PUT',
        data: { inviteExpiryDays: days },
      });
      Taro.showToast({ title: t('admin.settings.updateSuccess'), icon: 'none' });
    } catch {
      setInviteSettings(prev);
      Taro.showToast({ title: t('admin.settings.updateFailed'), icon: 'none' });
    }
  };

  const handleTransfer = async () => {
    setTransferError('');
    if (!selectedTarget) {
      setTransferError(t('admin.settings.errorSelectTarget'));
      return;
    }
    if (!transferPassword) {
      setTransferError(t('admin.settings.errorPasswordRequired'));
      return;
    }
    setTransferring(true);
    try {
      await request({
        url: '/api/admin/superadmin/transfer',
        method: 'POST',
        data: { targetUserId: selectedTarget, password: transferPassword },
      });
      // Update local store: remove SuperAdmin, keep Admin
      const currentUser = useAppStore.getState().user;
      if (currentUser) {
        const newRoles = currentUser.roles.filter((r) => r !== 'SuperAdmin');
        useAppStore.getState().updateUser({ roles: newRoles });
      }
      Taro.showToast({ title: t('admin.settings.transferSuccess'), icon: 'none' });
      setTimeout(() => {
        Taro.redirectTo({ url: '/pages/admin/index' });
      }, 2000);
    } catch (err) {
      if (err instanceof RequestError) {
        const errorKey = (() => {
          switch (err.code) {
            case 'INVALID_CURRENT_PASSWORD': return 'admin.settings.errorPasswordIncorrect';
            case 'TRANSFER_TARGET_NOT_ADMIN': return 'admin.settings.errorTargetNotAdmin';
            case 'TRANSFER_TARGET_NOT_FOUND': return 'admin.settings.errorTargetNotFound';
            default: return null;
          }
        })();
        setTransferError(errorKey ? t(errorKey as any) : err.message);
      } else {
        setTransferError(t('common.operationFailed'));
      }
    } finally {
      setTransferring(false);
    }
  };

  const handleSavePointsRuleConfig = async () => {
    // Validate all values are positive integers
    const fields = [
      pointsRuleConfig.uglPointsPerEvent,
      pointsRuleConfig.volunteerPointsPerEvent,
      pointsRuleConfig.volunteerMaxPerEvent,
      pointsRuleConfig.speakerTypeAPoints,
      pointsRuleConfig.speakerTypeBPoints,
      pointsRuleConfig.speakerRoundtablePoints,
    ];
    if (fields.some(v => !Number.isInteger(v) || v < 1)) {
      Taro.showToast({ title: t('admin.settings.pointsRuleValidationError' as any), icon: 'none' });
      return;
    }
    setPointsRuleSaving(true);
    try {
      await request({
        url: '/api/admin/settings/feature-toggles',
        method: 'PUT',
        data: {
          codeRedemptionEnabled: settings.codeRedemptionEnabled,
          pointsClaimEnabled: settings.pointsClaimEnabled,
          adminProductsEnabled: settings.adminProductsEnabled,
          adminOrdersEnabled: settings.adminOrdersEnabled,
          adminContentReviewEnabled: settings.adminContentReviewEnabled,
          adminCategoriesEnabled: settings.adminCategoriesEnabled,
          adminEmailProductsEnabled: settings.adminEmailProductsEnabled,
          adminEmailContentEnabled: settings.adminEmailContentEnabled,
          emailPointsEarnedEnabled: settings.emailPointsEarnedEnabled,
          emailNewOrderEnabled: settings.emailNewOrderEnabled,
          emailOrderShippedEnabled: settings.emailOrderShippedEnabled,
          emailNewProductEnabled: settings.emailNewProductEnabled,
          emailNewContentEnabled: settings.emailNewContentEnabled,
          emailContentUpdatedEnabled: settings.emailContentUpdatedEnabled,
          emailWeeklyDigestEnabled: settings.emailWeeklyDigestEnabled,
          reservationApprovalPoints: settings.reservationApprovalPoints,
          leaderboardRankingEnabled: settings.leaderboardRankingEnabled,
          leaderboardAnnouncementEnabled: settings.leaderboardAnnouncementEnabled,
          leaderboardUpdateFrequency: settings.leaderboardUpdateFrequency,
          brandLogoListEnabled: settings.brandLogoListEnabled,
          brandLogoDetailEnabled: settings.brandLogoDetailEnabled,
          pointsRuleConfig,
        },
      });
      Taro.showToast({ title: t('admin.settings.pointsRuleSaveSuccess' as any), icon: 'none' });
    } catch (err) {
      if (err instanceof RequestError) {
        Taro.showToast({ title: err.message, icon: 'none' });
      } else {
        Taro.showToast({ title: t('admin.settings.pointsRuleSaveFailed' as any), icon: 'none' });
      }
    } finally {
      setPointsRuleSaving(false);
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  return (
    <View className='admin-settings'>
      {/* Toolbar */}
      <View className='admin-settings__toolbar'>
        <View className='admin-settings__back' onClick={handleBack}>
          <ArrowLeftIcon size={16} color='var(--accent-primary)' />
          <Text className='admin-settings__back-text'>{t('admin.settings.backButton')}</Text>
        </View>
        <Text className='admin-settings__title'>{t('admin.settings.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {loading ? (
        <View className='settings-loading'>
          <Text>{t('admin.settings.loading')}</Text>
        </View>
      ) : (
        <View className='settings-layout'>
          <CategoryNav
            categories={SETTINGS_CATEGORIES}
            activeCategory={activeCategory}
            onCategoryChange={setActiveCategory}
          />
          <View className='settings-content'>
            {/* Feature Toggles */}
            {activeCategory === 'feature-toggles' && (
              <>
                <Text className='settings-content__category-title'>{t('admin.settings.categoryFeatureToggles')}</Text>
                <CollapsibleSection title={t('admin.settings.sectionFeatureTogglesTitle')} description={t('admin.settings.sectionFeatureTogglesDesc')}>
                  <View className='toggle-list'>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.codeRedemptionLabel')}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.codeRedemptionDesc')}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.codeRedemptionEnabled}
                          onChange={(e) => handleToggle('codeRedemptionEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.pointsClaimLabel')}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.pointsClaimDesc')}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.pointsClaimEnabled}
                          onChange={(e) => handleToggle('pointsClaimEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                  </View>
                </CollapsibleSection>

                {/* Leaderboard Configuration */}
                <CollapsibleSection title={t('admin.settings.sectionLeaderboardTitle' as any)} description={t('admin.settings.sectionLeaderboardDesc' as any)}>
                  <View className='toggle-list'>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.leaderboardRankingLabel' as any)}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.leaderboardRankingDesc' as any)}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.leaderboardRankingEnabled}
                          onChange={(e) => handleToggle('leaderboardRankingEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.leaderboardAnnouncementLabel' as any)}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.leaderboardAnnouncementDesc' as any)}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.leaderboardAnnouncementEnabled}
                          onChange={(e) => handleToggle('leaderboardAnnouncementEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                    <View className='frequency-item'>
                      <View className='frequency-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.leaderboardUpdateFrequencyLabel' as any)}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.leaderboardUpdateFrequencyDesc' as any)}</Text>
                      </View>
                      <View className='frequency-item__options'>
                        {(['realtime', 'daily', 'weekly', 'monthly'] as const).map((freq) => (
                          <View
                            key={freq}
                            className={`frequency-option${settings.leaderboardUpdateFrequency === freq ? ' frequency-option--active' : ''}`}
                            onClick={() => handleFrequencyChange(freq)}
                          >
                            <Text className='frequency-option__label'>
                              {t(`admin.settings.frequency${freq.charAt(0).toUpperCase() + freq.slice(1)}` as any)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>
                </CollapsibleSection>

                {/* Brand Logo Display */}
                <CollapsibleSection title={t('admin.settings.brandLogoSectionTitle' as any)} description={t('admin.settings.brandLogoSectionDesc' as any)}>
                  <View className='toggle-list'>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.brandLogoDetailLabel' as any)}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.brandLogoDetailDesc' as any)}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.brandLogoDetailEnabled}
                          onChange={(e) => handleToggle('brandLogoDetailEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.brandLogoListLabel' as any)}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.brandLogoListDesc' as any)}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.brandLogoListEnabled}
                          onChange={(e) => handleToggle('brandLogoListEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                  </View>
                </CollapsibleSection>
              </>
            )}

            {/* Admin Permissions */}
            {activeCategory === 'admin-permissions' && (
              <>
                <Text className='settings-content__category-title'>{t('admin.settings.categoryAdminPermissions')}</Text>
                <CollapsibleSection title={t('admin.settings.sectionAdminPermissionsTitle')} description={t('admin.settings.sectionAdminPermissionsDesc')}>
                  <View className='toggle-list'>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.adminProductsLabel')}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.adminProductsDesc')}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.adminProductsEnabled}
                          onChange={(e) => handleToggle('adminProductsEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.adminOrdersLabel')}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.adminOrdersDesc')}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.adminOrdersEnabled}
                          onChange={(e) => handleToggle('adminOrdersEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.adminContentReviewLabel')}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.adminContentReviewDesc')}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.adminContentReviewEnabled}
                          onChange={(e) => handleToggle('adminContentReviewEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.adminCategoriesLabel')}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.adminCategoriesDesc')}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.adminCategoriesEnabled}
                          onChange={(e) => handleToggle('adminCategoriesEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.adminEmailProductsLabel')}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.adminEmailProductsDesc')}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.adminEmailProductsEnabled}
                          onChange={(e) => handleToggle('adminEmailProductsEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                    <View className='toggle-item'>
                      <View className='toggle-item__info'>
                        <Text className='toggle-item__label'>{t('admin.settings.adminEmailContentLabel')}</Text>
                        <Text className='toggle-item__desc'>{t('admin.settings.adminEmailContentDesc')}</Text>
                      </View>
                      <View className='toggle-item__switch'>
                        <Switch
                          checked={settings.adminEmailContentEnabled}
                          onChange={(e) => handleToggle('adminEmailContentEnabled', e.detail.value)}
                          color='var(--accent-primary)'
                        />
                      </View>
                    </View>
                  </View>
                </CollapsibleSection>
              </>
            )}

            {/* Content Role Permissions */}
            {activeCategory === 'content-roles' && (
              <>
                <Text className='settings-content__category-title'>{t('admin.settings.categoryContentRoles')}</Text>
                <CollapsibleSection title={t('admin.settings.sectionContentRolesTitle')} description={t('admin.settings.sectionContentRolesDesc')}>
                  <View className='toggle-list'>
                    <View className='permissions-matrix'>
                      <View className='permissions-matrix__header'>
                        <View className='permissions-matrix__role-col' />
                        {(['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const).map((perm) => (
                          <View key={perm} className='permissions-matrix__perm-col'>
                            <Text className='permissions-matrix__perm-label'>
                              {t(`admin.settings.permission${perm.charAt(0).toUpperCase() + perm.slice(1)}` as any)}
                            </Text>
                          </View>
                        ))}
                      </View>
                      {(['Speaker', 'UserGroupLeader', 'Volunteer'] as const).map((role) => (
                        <View key={role} className='permissions-matrix__row'>
                          <View className='permissions-matrix__role-col'>
                            <Text className='permissions-matrix__role-label'>
                              {t(`admin.settings.role${role}` as any)}
                            </Text>
                          </View>
                          {(['canAccess', 'canUpload', 'canDownload', 'canReserve'] as const).map((perm) => (
                            <View key={perm} className='permissions-matrix__perm-col'>
                              <Switch
                                checked={contentRolePermissions[role][perm]}
                                onChange={(e) => handlePermissionToggle(role, perm, e.detail.value)}
                                color='var(--accent-primary)'
                              />
                            </View>
                          ))}
                        </View>
                      ))}
                    </View>
                  </View>
                </CollapsibleSection>
              </>
            )}

            {/* Email Notifications */}
            {activeCategory === 'email-notifications' && (
              <>
                <Text className='settings-content__category-title'>{t('admin.settings.categoryEmailNotifications')}</Text>
                <CollapsibleSection title={t('admin.settings.sectionEmailToggleTitle')} description={t('admin.settings.sectionEmailToggleDesc')}>
                  <View className='toggle-list'>
                    {([
                      {
                        key: 'emailPointsEarnedEnabled' as keyof FeatureToggles,
                        notificationType: 'pointsEarned' as NotificationType,
                        labelKey: 'admin.settings.email.pointsEarnedLabel',
                        descKey: 'admin.settings.email.pointsEarnedDesc',
                      },
                      {
                        key: 'emailNewOrderEnabled' as keyof FeatureToggles,
                        notificationType: 'newOrder' as NotificationType,
                        labelKey: 'admin.settings.email.newOrderLabel',
                        descKey: 'admin.settings.email.newOrderDesc',
                      },
                      {
                        key: 'emailOrderShippedEnabled' as keyof FeatureToggles,
                        notificationType: 'orderShipped' as NotificationType,
                        labelKey: 'admin.settings.email.orderShippedLabel',
                        descKey: 'admin.settings.email.orderShippedDesc',
                      },
                      {
                        key: 'emailNewProductEnabled' as keyof FeatureToggles,
                        notificationType: 'newProduct' as NotificationType,
                        labelKey: 'admin.settings.email.newProductLabel',
                        descKey: 'admin.settings.email.newProductDesc',
                      },
                      {
                        key: 'emailNewContentEnabled' as keyof FeatureToggles,
                        notificationType: 'newContent' as NotificationType,
                        labelKey: 'admin.settings.email.newContentLabel',
                        descKey: 'admin.settings.email.newContentDesc',
                      },
                      {
                        key: 'emailContentUpdatedEnabled' as keyof FeatureToggles,
                        notificationType: 'contentUpdated' as NotificationType,
                        labelKey: 'admin.settings.email.contentUpdatedLabel',
                        descKey: 'admin.settings.email.contentUpdatedDesc',
                      },
                      {
                        key: 'emailWeeklyDigestEnabled' as keyof FeatureToggles,
                        notificationType: 'weeklyDigest' as NotificationType,
                        labelKey: 'admin.settings.email.weeklyDigestLabel',
                        descKey: 'admin.settings.email.weeklyDigestDesc',
                      },
                    ] as { key: keyof FeatureToggles; notificationType: NotificationType; labelKey: string; descKey: string }[]).map((item) => (
                      <View key={item.key} className='email-toggle-item'>
                        <View className='email-toggle-item__main'>
                          <View className='toggle-item__info'>
                            <Text className='toggle-item__label'>{t(item.labelKey as any)}</Text>
                            <Text className='toggle-item__desc'>{t(item.descKey as any)}</Text>
                          </View>
                          <View className='toggle-item__switch'>
                            <Switch
                              checked={settings[item.key] as boolean}
                              onChange={(e) => handleToggle(item.key, e.detail.value)}
                              color='var(--accent-primary)'
                            />
                          </View>
                        </View>
                        <View
                          className='email-toggle-item__edit-btn'
                          onClick={() => setEditingTemplateType(item.notificationType)}
                        >
                          <Text className='email-toggle-item__edit-btn-text'>{t('admin.settings.email.editTemplateButton')}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                </CollapsibleSection>
                <CollapsibleSection title={t('admin.settings.sectionEmailTemplateTitle')} description={t('admin.settings.sectionEmailTemplateDesc')}>
                  <View className='toggle-list'>
                    <View
                      className='email-seed-btn'
                      onClick={async () => {
                        try {
                          await request({
                            url: '/api/admin/email-templates/seed',
                            method: 'POST',
                          });
                          Taro.showToast({ title: t('admin.settings.seedTemplateSuccess'), icon: 'none' });
                        } catch {
                          Taro.showToast({ title: t('admin.settings.seedTemplateFailed'), icon: 'none' });
                        }
                      }}
                    >
                      <Text className='email-seed-btn__text'>{t('admin.settings.seedTemplateButton')}</Text>
                      <Text className='email-seed-btn__hint'>{t('admin.settings.seedTemplateHint')}</Text>
                    </View>
                  </View>
                </CollapsibleSection>
              </>
            )}

            {/* Travel Sponsorship */}
            {activeCategory === 'travel-sponsorship' && (
              <>
                <Text className='settings-content__category-title'>{t('admin.settings.categoryTravelSponsorship')}</Text>
                <CollapsibleSection title={t('admin.settings.sectionTravelTitle')} description={t('admin.settings.sectionTravelDesc')}>
                  {travelLoading ? (
                    <View className='settings-loading'>
                      <Text>{t('admin.settings.loading')}</Text>
                    </View>
                  ) : (
                    <View className='toggle-list'>
                      <View className='toggle-item'>
                        <View className='toggle-item__info'>
                          <Text className='toggle-item__label'>{t('admin.settings.travelSponsorshipLabel')}</Text>
                          <Text className='toggle-item__desc'>{t('admin.settings.travelSponsorshipDesc')}</Text>
                        </View>
                        <View className='toggle-item__switch'>
                          <Switch
                            checked={travelSettings.travelSponsorshipEnabled}
                            onChange={(e) => handleTravelToggle(e.detail.value)}
                            color='var(--accent-primary)'
                          />
                        </View>
                      </View>
                      <View className='threshold-item'>
                        <View className='threshold-item__info'>
                          <Text className='threshold-item__label'>{t('admin.settings.domesticThresholdLabel')}</Text>
                          <Text className='threshold-item__desc'>{t('admin.settings.domesticThresholdDesc')}</Text>
                        </View>
                        <View className='threshold-item__input'>
                          <Input
                            type='number'
                            value={domesticInput}
                            placeholder={t('admin.settings.thresholdPlaceholder')}
                            onInput={(e) => setDomesticInput(e.detail.value)}
                            onBlur={handleDomesticBlur}
                            className='threshold-input'
                          />
                        </View>
                      </View>
                      <View className='threshold-item'>
                        <View className='threshold-item__info'>
                          <Text className='threshold-item__label'>{t('admin.settings.internationalThresholdLabel')}</Text>
                          <Text className='threshold-item__desc'>{t('admin.settings.internationalThresholdDesc')}</Text>
                        </View>
                        <View className='threshold-item__input'>
                          <Input
                            type='number'
                            value={internationalInput}
                            placeholder={t('admin.settings.thresholdPlaceholder')}
                            onInput={(e) => setInternationalInput(e.detail.value)}
                            onBlur={handleInternationalBlur}
                            className='threshold-input'
                          />
                        </View>
                      </View>
                    </View>
                  )}
                </CollapsibleSection>
              </>
            )}

            {/* Invite Settings */}
            {activeCategory === 'invite-settings' && (
              <>
                <Text className='settings-content__category-title'>{t('admin.settings.categoryInviteSettings')}</Text>
                <CollapsibleSection title={t('admin.settings.sectionInviteExpiryTitle')} description={t('admin.settings.sectionInviteExpiryDesc')}>
                  <View className='toggle-list'>
                    <View className='invite-expiry-item'>
                      <Text className='invite-expiry-item__desc'>{t('admin.settings.inviteExpiryDesc')}</Text>
                      <View className='invite-expiry-item__options'>
                        {([1, 3, 7] as const).map((days) => (
                          <View
                            key={days}
                            className={`invite-expiry-option${inviteSettings.inviteExpiryDays === days ? ' invite-expiry-option--active' : ''}`}
                            onClick={() => handleInviteExpiryChange(days)}
                          >
                            <Text className='invite-expiry-option__label'>
                              {t(`admin.settings.inviteExpiryDays${days}` as any)}
                            </Text>
                          </View>
                        ))}
                      </View>
                    </View>
                  </View>
                </CollapsibleSection>
              </>
            )}

            {/* UG Management */}
            {activeCategory === 'ug-management' && (
              <>
                <Text className='settings-content__category-title'>{t('ugManagement.title' as any)}</Text>
                <CollapsibleSection title={t('ugManagement.sectionTitle' as any)} description={t('ugManagement.sectionDesc' as any)}>
                  <View className='toggle-list'>
                    {/* Create UG button */}
                    <View
                      className='ug-create-btn'
                      onClick={() => setUgShowCreate(true)}
                    >
                      <Text className='ug-create-btn__text'>{t('ugManagement.createButton' as any)}</Text>
                    </View>

                    {/* Create UG popup */}
                    {ugShowCreate && (
                      <View className='ug-create-form'>
                        <View className='ug-create-form__field'>
                          <Input
                            className='ug-create-form__input'
                            value={ugNewName}
                            onInput={(e) => setUgNewName(e.detail.value)}
                            placeholder={t('ugManagement.namePlaceholder' as any)}
                            maxlength={50}
                          />
                        </View>
                        <View className='ug-create-form__actions'>
                          <View
                            className='ug-create-form__cancel'
                            onClick={() => { setUgShowCreate(false); setUgNewName(''); }}
                          >
                            <Text className='ug-create-form__cancel-text'>{t('ugManagement.cancelButton' as any)}</Text>
                          </View>
                          <View
                            className={`ug-create-form__submit${(!ugNewName.trim() || ugCreating) ? ' ug-create-form__submit--disabled' : ''}`}
                            onClick={(!ugNewName.trim() || ugCreating) ? undefined : handleCreateUG}
                          >
                            <Text className='ug-create-form__submit-text'>
                              {ugCreating ? t('ugManagement.creating' as any) : t('ugManagement.createSubmit' as any)}
                            </Text>
                          </View>
                        </View>
                      </View>
                    )}

                    {/* UG list */}
                    {ugLoading ? (
                      <View className='settings-loading'>
                        <Text>{t('ugManagement.loading' as any)}</Text>
                      </View>
                    ) : ugList.length === 0 ? (
                      <View className='ug-empty'>
                        <Text className='ug-empty__text'>{t('ugManagement.empty' as any)}</Text>
                      </View>
                    ) : (
                      <View className='ug-list'>
                        {ugList.map((ug) => (
                          <View key={ug.ugId} className='ug-item'>
                            <View className='ug-item__info'>
                              {ugEditTarget === ug.ugId ? (
                                <View className='ug-item__edit-row'>
                                  <Input
                                    className='ug-item__edit-input'
                                    value={ugEditName}
                                    onInput={(e) => setUgEditName(e.detail.value)}
                                    maxlength={50}
                                    focus
                                  />
                                  <View
                                    className={`ug-item__edit-save${(!ugEditName.trim() || ugRenaming) ? ' ug-item__edit-save--disabled' : ''}`}
                                    onClick={(!ugEditName.trim() || ugRenaming) ? undefined : () => handleSaveRenameUG(ug.ugId)}
                                  >
                                    <Text className='ug-item__edit-save-text'>{ugRenaming ? '...' : '✓'}</Text>
                                  </View>
                                  <View className='ug-item__edit-cancel' onClick={handleCancelEditUG}>
                                    <Text className='ug-item__edit-cancel-text'>✕</Text>
                                  </View>
                                </View>
                              ) : (
                                <View className='ug-item__name-row'>
                                  <Text className='ug-item__name'>{ug.name}</Text>
                                  <View className={`ug-item__badge ug-item__badge--${ug.status}`}>
                                    <Text className='ug-item__badge-text'>
                                      {ug.status === 'active' ? t('ugManagement.statusActive' as any) : t('ugManagement.statusInactive' as any)}
                                    </Text>
                                  </View>
                                  <View
                                    className='ug-item__edit-btn'
                                    onClick={() => handleStartEditUG(ug.ugId, ug.name)}
                                  >
                                    <Text className='ug-item__edit-btn-text'>✎</Text>
                                  </View>
                                </View>
                              )}
                              <View className='ug-item__leader-row'>
                                <Text className='ug-item__leader-label'>{t('ugManagement.leaderLabel' as any)}：</Text>
                                <Text className={`ug-item__leader-name${ug.leaderNickname ? '' : ' ug-item__leader-name--empty'}`}>
                                  {ug.leaderNickname || t('ugManagement.leaderUnassigned' as any)}
                                </Text>
                                <View
                                  className='ug-item__leader-btn'
                                  onClick={() => setLeaderModalUgId(ug.ugId)}
                                >
                                  <Text className='ug-item__leader-btn-text'>
                                    {ug.leaderId ? t('ugManagement.changeLeader' as any) : t('ugManagement.assignLeader' as any)}
                                  </Text>
                                </View>
                              </View>
                              <Text className='ug-item__time'>
                                {t('ugManagement.createdAt' as any)} {new Date(ug.createdAt).toLocaleDateString('zh-CN')}
                              </Text>
                            </View>
                            <View className='ug-item__actions'>
                              <View className='ug-item__switch'>
                                <Switch
                                  checked={ug.status === 'active'}
                                  onChange={() => handleToggleUGStatus(ug.ugId, ug.status)}
                                  color='var(--accent-primary)'
                                />
                              </View>
                              <View
                                className='ug-item__delete'
                                onClick={() => setUgDeleteTarget(ug.ugId)}
                              >
                                <Text className='ug-item__delete-text'>{t('ugManagement.deleteButton' as any)}</Text>
                              </View>
                            </View>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                </CollapsibleSection>

                {/* Delete confirmation dialog */}
                {ugDeleteTarget && (
                  <View className='ug-delete-overlay' onClick={() => setUgDeleteTarget(null)}>
                    <View className='ug-delete-dialog' onClick={(e) => e.stopPropagation()}>
                      <Text className='ug-delete-dialog__title'>{t('ugManagement.deleteTitle' as any)}</Text>
                      <Text className='ug-delete-dialog__message'>
                        {t('ugManagement.deleteMessage' as any, { name: ugList.find(u => u.ugId === ugDeleteTarget)?.name || '' })}
                      </Text>
                      <View className='ug-delete-dialog__actions'>
                        <View
                          className='ug-delete-dialog__cancel'
                          onClick={() => setUgDeleteTarget(null)}
                        >
                          <Text className='ug-delete-dialog__cancel-text'>{t('ugManagement.deleteCancel' as any)}</Text>
                        </View>
                        <View
                          className='ug-delete-dialog__confirm'
                          onClick={() => handleDeleteUG(ugDeleteTarget)}
                        >
                          <Text className='ug-delete-dialog__confirm-text'>{t('ugManagement.deleteConfirm' as any)}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                )}

                {/* Leader Selector Modal */}
                {leaderModalUgId && (
                  <View className='leader-modal__overlay' onClick={() => setLeaderModalUgId(null)}>
                    <View className='leader-modal__container' onClick={(e) => e.stopPropagation()}>
                      {/* Header */}
                      <View className='leader-modal__header'>
                        <Text className='leader-modal__title'>{t('leaderSelector.title' as any)}</Text>
                        <View className='leader-modal__close' onClick={() => setLeaderModalUgId(null)}>
                          <Text>✕</Text>
                        </View>
                      </View>

                      {/* Search */}
                      <View className='leader-modal__search'>
                        <Input
                          className='leader-modal__search-input'
                          value={leaderSearch}
                          onInput={(e) => setLeaderSearch(e.detail.value)}
                          placeholder={t('leaderSelector.searchPlaceholder' as any)}
                        />
                      </View>

                      {/* User list */}
                      <View className='leader-modal__list'>
                        {(() => {
                          const keyword = leaderSearch.trim().toLowerCase();
                          const filtered = keyword
                            ? adminUsersList.filter(
                                (u) =>
                                  u.nickname.toLowerCase().includes(keyword) ||
                                  u.email.toLowerCase().includes(keyword),
                              )
                            : adminUsersList;

                          if (filtered.length === 0) {
                            return (
                              <View className='leader-modal__empty'>
                                <Text className='leader-modal__empty-text'>
                                  {adminUsersList.length === 0 ? t('leaderSelector.noAdminUsers' as any) : t('leaderSelector.noMatchingUsers' as any)}
                                </Text>
                              </View>
                            );
                          }

                          return filtered.map((user) => (
                            <View
                              key={user.userId}
                              className={`leader-modal__user${leaderAssigning ? ' leader-modal__user--disabled' : ''}`}
                              onClick={leaderAssigning ? undefined : () => handleAssignLeader(user.userId)}
                            >
                              <View className='leader-modal__user-info'>
                                <Text className='leader-modal__user-nickname'>{user.nickname}</Text>
                                <Text className='leader-modal__user-email'>{user.email}</Text>
                              </View>
                            </View>
                          ));
                        })()}
                      </View>

                      {/* Remove leader button (only when UG has existing leader) */}
                      {(() => {
                        const currentUg = ugList.find((ug) => ug.ugId === leaderModalUgId);
                        if (currentUg?.leaderId) {
                          return (
                            <View className='leader-modal__footer'>
                              <View
                                className={`leader-modal__remove-btn${leaderAssigning ? ' leader-modal__remove-btn--disabled' : ''}`}
                                onClick={leaderAssigning ? undefined : handleRemoveLeader}
                              >
                                <Text className='leader-modal__remove-btn-text'>
                                  {leaderAssigning ? t('leaderSelector.processing' as any) : t('leaderSelector.removeLeader' as any)}
                                </Text>
                              </View>
                            </View>
                          );
                        }
                        return null;
                      })()}
                    </View>
                  </View>
                )}
              </>
            )}

            {/* Activity Sync Config */}
            {activeCategory === 'activity-sync' && (
              <>
                <Text className='settings-content__category-title'>{t('activitySync.title' as any)}</Text>

                {/* Source tabs */}
                <View className='sync-source-tabs'>
                  <View className={`sync-source-tabs__tab${syncActiveTab === 'config' ? ' sync-source-tabs__tab--active' : ''}`} onClick={() => setSyncActiveTab('config')}>
                    <Text className='sync-source-tabs__tab-text'>Feishu</Text>
                  </View>
                  <View className={`sync-source-tabs__tab${syncActiveTab === 'meetup' ? ' sync-source-tabs__tab--active' : ''}`} onClick={() => setSyncActiveTab('meetup')}>
                    <Text className='sync-source-tabs__tab-text'>Meetup</Text>
                  </View>
                  <View className={`sync-source-tabs__tab${syncActiveTab === 'website' ? ' sync-source-tabs__tab--active' : ''}`} onClick={() => setSyncActiveTab('website')}>
                    <Text className='sync-source-tabs__tab-text'>Website</Text>
                  </View>
                  <View className={`sync-source-tabs__tab${syncActiveTab === 'actions' ? ' sync-source-tabs__tab--active' : ''}`} onClick={() => setSyncActiveTab('actions')}>
                    <Text className='sync-source-tabs__tab-text'>{t('activitySync.sectionActivitiesTitle' as any)}</Text>
                  </View>
                </View>

                {/* ── Feishu Tab ── */}
                {syncActiveTab === 'config' && (
                  <View className='sync-panel'>
                    <View className='sync-panel__header'>
                      <View className='sync-panel__header-info'>
                        <Text className='sync-panel__title'>{t('activitySync.sectionConfigTitle' as any)}</Text>
                        <Text className='sync-panel__desc'>{t('activitySync.sectionConfigDesc' as any)}</Text>
                      </View>
                      <View className='sync-panel__header-actions'>
                        <View className={`sync-panel__action-btn sync-panel__action-btn--primary${syncRunning ? ' sync-panel__action-btn--disabled' : ''}`} onClick={syncRunning ? undefined : handleManualSync}>
                          <RefreshIcon size={14} color='var(--text-inverse)' />
                          <Text className='sync-panel__action-btn-text'>{syncRunning ? t('activitySync.feishuSyncing' as any) : t('activitySync.feishuSyncButton' as any)}</Text>
                        </View>
                      </View>
                    </View>
                    {syncConfig.lastSyncTime && (
                      <View className='sync-panel__status-bar'>
                        <Text className='sync-panel__status-label'>{t('activitySync.lastSyncLabel' as any)}</Text>
                        <Text className='sync-panel__status-time'>{new Date(syncConfig.lastSyncTime).toLocaleString('zh-CN')}</Text>
                        {syncConfig.lastSyncResult && (
                          <View className={`sync-panel__status-badge sync-panel__status-badge--${syncConfig.lastSyncResult === 'success' ? 'success' : 'error'}`}>
                            <Text className='sync-panel__status-badge-text'>{syncConfig.lastSyncResult === 'success' ? t('activitySync.syncStatusSuccess' as any) : t('activitySync.syncStatusFailed' as any)}</Text>
                          </View>
                        )}
                      </View>
                    )}
                    {syncConfigLoading ? (
                      <View className='sync-panel__loading'><Text>{t('activitySync.loading' as any)}</Text></View>
                    ) : (
                      <View className='sync-panel__body'>
                        <View className='sync-field-grid'>
                          <View className='sync-field'>
                            <Text className='sync-field__label'>{t('activitySync.syncIntervalLabel' as any)}</Text>
                            <Text className='sync-field__hint'>{t('activitySync.syncIntervalDesc' as any)}</Text>
                            <Input type='number' value={String(syncConfig.syncIntervalDays)} onInput={(e) => { const val = parseInt(e.detail.value, 10); if (!isNaN(val) && val >= 1 && val <= 30) setSyncConfig((prev) => ({ ...prev, syncIntervalDays: val })); }} placeholder='1~30' className='sync-field__input' />
                          </View>
                          <View className='sync-field'>
                            <Text className='sync-field__label'>{t('activitySync.feishuUrlLabel' as any)}</Text>
                            <Text className='sync-field__hint'>{t('activitySync.feishuUrlDesc' as any)}</Text>
                            <Input type='text' value={syncConfig.feishuTableUrl} onInput={(e) => setSyncConfig((prev) => ({ ...prev, feishuTableUrl: e.detail.value }))} placeholder='https://...' className='sync-field__input' />
                          </View>
                          <View className='sync-field'>
                            <Text className='sync-field__label'>{t('activitySync.feishuAppIdLabel' as any)}</Text>
                            <Text className='sync-field__hint'>{t('activitySync.feishuAppIdDesc' as any)}</Text>
                            <Input type='text' value={syncConfig.feishuAppId} onInput={(e) => setSyncConfig((prev) => ({ ...prev, feishuAppId: e.detail.value }))} placeholder='cli_xxxxx' className='sync-field__input' />
                          </View>
                          <View className='sync-field'>
                            <Text className='sync-field__label'>{t('activitySync.feishuAppSecretLabel' as any)}</Text>
                            <Text className='sync-field__hint'>{t('activitySync.feishuAppSecretDesc' as any)}</Text>
                            <Input type='text' password value={syncConfig.feishuAppSecret} onInput={(e) => setSyncConfig((prev) => ({ ...prev, feishuAppSecret: e.detail.value }))} placeholder='••••••••' className='sync-field__input' />
                          </View>
                        </View>
                        <View className='sync-panel__footer'>
                          <View className={`sync-panel__action-btn sync-panel__action-btn--save${syncConfigSaving ? ' sync-panel__action-btn--disabled' : ''}`} onClick={syncConfigSaving ? undefined : handleSaveSyncConfig}>
                            <Text className='sync-panel__action-btn-text'>{syncConfigSaving ? t('activitySync.saving' as any) : t('activitySync.saveButton' as any)}</Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {/* ── Meetup Tab ── */}
                {syncActiveTab === 'meetup' && (
                  <View className='sync-panel'>
                    <View className='sync-panel__header'>
                      <View className='sync-panel__header-info'>
                        <Text className='sync-panel__title'>{t('activitySync.meetupSectionTitle' as any)}</Text>
                        <Text className='sync-panel__desc'>{t('activitySync.meetupSectionDesc' as any)}</Text>
                      </View>
                      <View className='sync-panel__header-actions'>
                        <View className={`sync-panel__action-btn sync-panel__action-btn--outline${meetupTesting ? ' sync-panel__action-btn--disabled' : ''}`} onClick={meetupTesting ? undefined : handleTestMeetupConnection}>
                          <Text className='sync-panel__action-btn-text'>{meetupTesting ? t('activitySync.meetupTesting' as any) : t('activitySync.meetupTestButton' as any)}</Text>
                        </View>
                        <View className={`sync-panel__action-btn sync-panel__action-btn--primary${meetupSyncing ? ' sync-panel__action-btn--disabled' : ''}`} onClick={meetupSyncing ? undefined : handleMeetupSync}>
                          <RefreshIcon size={14} color='var(--text-inverse)' />
                          <Text className='sync-panel__action-btn-text'>{meetupSyncing ? t('activitySync.meetupSyncing' as any) : t('activitySync.meetupSyncButton' as any)}</Text>
                        </View>
                      </View>
                    </View>
                    {meetupConfig.lastSyncTime && (
                      <View className='sync-panel__status-bar'>
                        <Text className='sync-panel__status-label'>{t('activitySync.meetupLastSyncLabel' as any)}</Text>
                        <Text className='sync-panel__status-time'>{new Date(meetupConfig.lastSyncTime).toLocaleString('zh-CN')}</Text>
                        {meetupConfig.lastSyncResult && (<View className={`sync-panel__status-badge sync-panel__status-badge--${meetupConfig.lastSyncResult === 'success' ? 'success' : 'error'}`}><Text className='sync-panel__status-badge-text'>{meetupConfig.lastSyncResult === 'success' ? t('activitySync.syncStatusSuccess' as any) : t('activitySync.syncStatusFailed' as any)}</Text></View>)}
                      </View>
                    )}
                    {meetupConfigLoading ? (<View className='sync-panel__loading'><Text>{t('activitySync.loading' as any)}</Text></View>) : (
                      <View className='sync-panel__body'>
                        <View className='sync-panel__section'>
                          <Text className='sync-panel__section-title'>{t('activitySync.meetupGroupsLabel' as any)}</Text>
                          {meetupConfig.groups.length === 0 ? (<View className='sync-panel__empty'><Text className='sync-panel__empty-text'>{t('activitySync.meetupNoGroups' as any)}</Text></View>) : (
                            <View className='sync-source-list'>
                              {meetupConfig.groups.map((group, idx) => (
                                <View key={idx} className='sync-source-item'>
                                  <View className='sync-source-item__info'><Text className='sync-source-item__name'>{group.displayName}</Text><Text className='sync-source-item__url'>{group.urlname}</Text></View>
                                  <View className='sync-source-item__remove' onClick={() => setMeetupConfig((prev) => ({ ...prev, groups: prev.groups.filter((_, i) => i !== idx) }))}><Text className='sync-source-item__remove-text'>{t('activitySync.meetupRemoveGroup' as any)}</Text></View>
                                </View>
                              ))}
                            </View>
                          )}
                          <View className='sync-add-row'>
                            <Input className='sync-add-row__input' value={meetupNewGroupUrlname} onInput={(e) => setMeetupNewGroupUrlname(e.detail.value)} placeholder={t('activitySync.meetupGroupUrlnamePlaceholder' as any)} />
                            <Input className='sync-add-row__input' value={meetupNewGroupDisplayName} onInput={(e) => setMeetupNewGroupDisplayName(e.detail.value)} placeholder={t('activitySync.meetupGroupDisplayNamePlaceholder' as any)} />
                            <View className={`sync-add-row__btn${(!meetupNewGroupUrlname.trim() || !meetupNewGroupDisplayName.trim()) ? ' sync-add-row__btn--disabled' : ''}`} onClick={(!meetupNewGroupUrlname.trim() || !meetupNewGroupDisplayName.trim()) ? undefined : () => { setMeetupConfig((prev) => ({ ...prev, groups: [...prev.groups, { urlname: meetupNewGroupUrlname.trim(), displayName: meetupNewGroupDisplayName.trim() }] })); setMeetupNewGroupUrlname(''); setMeetupNewGroupDisplayName(''); }}><Text className='sync-add-row__btn-text'>{t('activitySync.meetupAddGroup' as any)}</Text></View>
                          </View>
                        </View>
                        <View className='sync-panel__section'>
                          <Text className='sync-panel__section-title'>{t('activitySync.meetupTokenLabel' as any)}</Text>
                          <View className='sync-field-grid'>
                            <View className='sync-field'><Text className='sync-field__label'>Access Token</Text><Input type='text' password value={meetupConfig.meetupToken} onInput={(e) => setMeetupConfig((prev) => ({ ...prev, meetupToken: e.detail.value }))} placeholder={t('activitySync.meetupTokenPlaceholder' as any)} className='sync-field__input' /></View>
                            <View className='sync-field'><Text className='sync-field__label'>CSRF Token</Text><Input type='text' password value={meetupConfig.meetupCsrf} onInput={(e) => setMeetupConfig((prev) => ({ ...prev, meetupCsrf: e.detail.value }))} placeholder={t('activitySync.meetupCsrfPlaceholder' as any)} className='sync-field__input' /></View>
                            <View className='sync-field'><Text className='sync-field__label'>Session</Text><Input type='text' password value={meetupConfig.meetupSession} onInput={(e) => setMeetupConfig((prev) => ({ ...prev, meetupSession: e.detail.value }))} placeholder={t('activitySync.meetupSessionPlaceholder' as any)} className='sync-field__input' /></View>
                          </View>
                        </View>
                        <View className='sync-panel__toggle-row'>
                          <View className='sync-panel__toggle-info'><Text className='sync-panel__toggle-label'>{t('activitySync.meetupAutoSyncLabel' as any)}</Text><Text className='sync-panel__toggle-desc'>{t('activitySync.meetupAutoSyncDesc' as any)}</Text></View>
                          <Switch checked={meetupConfig.autoSyncEnabled} onChange={(e) => setMeetupConfig((prev) => ({ ...prev, autoSyncEnabled: e.detail.value }))} color='var(--accent-primary)' />
                        </View>
                        <View className='sync-panel__footer'>
                          <View className={`sync-panel__action-btn sync-panel__action-btn--save${meetupConfigSaving ? ' sync-panel__action-btn--disabled' : ''}`} onClick={meetupConfigSaving ? undefined : handleSaveMeetupConfig}><Text className='sync-panel__action-btn-text'>{meetupConfigSaving ? t('activitySync.saving' as any) : t('activitySync.saveButton' as any)}</Text></View>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {/* ── Website Tab ── */}
                {syncActiveTab === 'website' && (
                  <View className='sync-panel'>
                    <View className='sync-panel__header'>
                      <View className='sync-panel__header-info'><Text className='sync-panel__title'>{t('activitySync.websiteSyncSectionTitle' as any)}</Text><Text className='sync-panel__desc'>{t('activitySync.websiteSyncSectionDesc' as any)}</Text></View>
                      <View className='sync-panel__header-actions'>
                        <View className={`sync-panel__action-btn sync-panel__action-btn--primary${websiteSyncing ? ' sync-panel__action-btn--disabled' : ''}`} onClick={websiteSyncing ? undefined : handleWebsiteSync}><RefreshIcon size={14} color='var(--text-inverse)' /><Text className='sync-panel__action-btn-text'>{websiteSyncing ? t('activitySync.websiteSyncing' as any) : t('activitySync.websiteSyncButton' as any)}</Text></View>
                      </View>
                    </View>
                    {websiteConfig.lastSyncTime && (
                      <View className='sync-panel__status-bar'>
                        <Text className='sync-panel__status-label'>{t('activitySync.websiteLastSyncLabel' as any)}</Text>
                        <Text className='sync-panel__status-time'>{new Date(websiteConfig.lastSyncTime).toLocaleString('zh-CN')}</Text>
                        {websiteConfig.lastSyncResult && (<View className={`sync-panel__status-badge sync-panel__status-badge--${websiteConfig.lastSyncResult === 'success' ? 'success' : 'error'}`}><Text className='sync-panel__status-badge-text'>{websiteConfig.lastSyncResult === 'success' ? t('activitySync.syncStatusSuccess' as any) : t('activitySync.syncStatusFailed' as any)}</Text></View>)}
                      </View>
                    )}
                    {websiteConfigLoading ? (<View className='sync-panel__loading'><Text>{t('activitySync.loading' as any)}</Text></View>) : (
                      <View className='sync-panel__body'>
                        <View className='sync-panel__section'>
                          <Text className='sync-panel__section-title'>{t('activitySync.websiteSourceUrlLabel' as any)}</Text>
                          {websiteConfig.sources.length === 0 ? (<View className='sync-panel__empty'><Text className='sync-panel__empty-text'>{t('activitySync.websiteNoSources' as any)}</Text></View>) : (
                            <View className='sync-source-list'>
                              {websiteConfig.sources.map((source, idx) => (
                                <View key={idx} className='sync-source-item'>
                                  <View className='sync-source-item__info'><Text className='sync-source-item__name'>{source.displayName}</Text><Text className='sync-source-item__url'>{source.url}</Text></View>
                                  <View className='sync-source-item__remove' onClick={() => setWebsiteConfig((prev) => ({ ...prev, sources: prev.sources.filter((_, i) => i !== idx) }))}><Text className='sync-source-item__remove-text'>{t('activitySync.websiteRemoveSource' as any)}</Text></View>
                                </View>
                              ))}
                            </View>
                          )}
                          <View className='sync-add-row'>
                            <Input className='sync-add-row__input' value={websiteNewSourceUrl} onInput={(e) => setWebsiteNewSourceUrl(e.detail.value)} placeholder={t('activitySync.websiteSourceUrlPlaceholder' as any)} />
                            <Input className='sync-add-row__input' value={websiteNewSourceDisplayName} onInput={(e) => setWebsiteNewSourceDisplayName(e.detail.value)} placeholder={t('activitySync.websiteSourceDisplayNamePlaceholder' as any)} />
                            <View className={`sync-add-row__btn${(!websiteNewSourceUrl.trim().startsWith('https://') || !websiteNewSourceDisplayName.trim() || websiteConfig.sources.length >= 20) ? ' sync-add-row__btn--disabled' : ''}`} onClick={(!websiteNewSourceUrl.trim().startsWith('https://') || !websiteNewSourceDisplayName.trim() || websiteConfig.sources.length >= 20) ? undefined : () => { setWebsiteConfig((prev) => ({ ...prev, sources: [...prev.sources, { url: websiteNewSourceUrl.trim(), displayName: websiteNewSourceDisplayName.trim() }] })); setWebsiteNewSourceUrl(''); setWebsiteNewSourceDisplayName(''); }}><Text className='sync-add-row__btn-text'>{t('activitySync.websiteAddSource' as any)}</Text></View>
                          </View>
                          {websiteNewSourceUrl.trim() && !websiteNewSourceUrl.trim().startsWith('https://') && (<Text className='sync-panel__validation-error'>{t('activitySync.websiteUrlValidation' as any)}</Text>)}
                        </View>
                        <View className='sync-panel__footer'>
                          <View className={`sync-panel__action-btn sync-panel__action-btn--save${websiteConfigSaving ? ' sync-panel__action-btn--disabled' : ''}`} onClick={websiteConfigSaving ? undefined : handleSaveWebsiteConfig}><Text className='sync-panel__action-btn-text'>{websiteConfigSaving ? t('activitySync.saving' as any) : t('activitySync.saveButton' as any)}</Text></View>
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {/* ── Activities Tab ── */}
                {syncActiveTab === 'actions' && (
                  <View className='sync-panel'>
                    <View className='sync-panel__header'>
                      <View className='sync-panel__header-info'><Text className='sync-panel__title'>{t('activitySync.sectionActivitiesTitle' as any)}</Text></View>
                      <Text className='sync-panel__count'>{syncedActivities.length} 条</Text>
                    </View>
                    <View className='sync-panel__activities-list'>
                      {activitiesLoading && syncedActivities.length === 0 ? (<View className='sync-panel__loading'><Text>{t('activitySync.loading' as any)}</Text></View>) : syncedActivities.length === 0 ? (<View className='sync-panel__empty'><Text className='sync-panel__empty-text'>{t('activitySync.empty' as any)}</Text></View>) : (
                        <>
                          {syncedActivities.map((activity) => (
                            <View key={activity.activityId} className='activity-item'>
                              <View className='activity-item__header'>
                                <View className={`activity-item__type-badge activity-item__type-badge--${activity.activityType === '线上活动' ? 'online' : 'offline'}`}><Text className='activity-item__type-text'>{activity.activityType}</Text></View>
                                <Text className='activity-item__ug'>{activity.ugName}</Text>
                              </View>
                              <Text className='activity-item__topic'>{activity.topic}</Text>
                              <Text className='activity-item__date'>{activity.activityDate}</Text>
                            </View>
                          ))}
                          {activitiesHasMore && (<View className={`sync-load-more${activitiesLoading ? ' sync-load-more--loading' : ''}`} onClick={activitiesLoading ? undefined : () => fetchSyncedActivities(false, activitiesLastKey)}><Text className='sync-load-more__text'>{activitiesLoading ? t('activitySync.loading' as any) : t('activitySync.loadMore' as any)}</Text></View>)}
                        </>
                      )}
                    </View>
                  </View>
                )}
              </>
            )}

            {/* SuperAdmin */}
            {activeCategory === 'superadmin' && (
              <>
                <Text className='settings-content__category-title'>{t('admin.settings.categorySuperAdmin')}</Text>
                <CollapsibleSection title={t('admin.settings.sectionTransferTitle')} description={t('admin.settings.sectionTransferDesc')}>
                  <View className='toggle-list'>
                    <View className='transfer-section'>
                      <Text className='transfer-section__desc'>{t('admin.settings.transferDesc')}</Text>
                      {adminUsers.length === 0 ? (
                        <View className='transfer-section__empty'>
                          <Text className='transfer-section__empty-text'>{t('admin.settings.noEligibleTargets')}</Text>
                        </View>
                      ) : (
                        <View className='transfer-user-list'>
                          {adminUsers.map((user) => (
                            <View
                              key={user.userId}
                              className={`transfer-user-item${selectedTarget === user.userId ? ' transfer-user-item--selected' : ''}`}
                              onClick={() => setSelectedTarget(user.userId)}
                            >
                              <View className='transfer-user-item__check'>
                                {selectedTarget === user.userId && <Text className='transfer-user-item__check-icon'>✓</Text>}
                              </View>
                              <View className='transfer-user-item__info'>
                                <Text className='transfer-user-item__nickname'>{user.nickname}</Text>
                                <Text className='transfer-user-item__email'>{user.email}</Text>
                              </View>
                            </View>
                          ))}
                        </View>
                      )}
                      <View className='transfer-section__field'>
                        <Text className='transfer-section__label'>{t('admin.settings.passwordLabel')}</Text>
                        <Input
                          type='text'
                          password
                          value={transferPassword}
                          placeholder={t('admin.settings.passwordPlaceholder')}
                          onInput={(e) => setTransferPassword(e.detail.value)}
                          className='transfer-input'
                        />
                      </View>
                      {transferError ? (
                        <View className='transfer-section__error'>
                          <Text className='transfer-section__error-text'>{transferError}</Text>
                        </View>
                      ) : null}
                      <View
                        className={`transfer-section__btn${(!selectedTarget || !transferPassword || transferring || adminUsers.length === 0) ? ' transfer-section__btn--disabled' : ''}`}
                        onClick={(!selectedTarget || !transferPassword || transferring || adminUsers.length === 0) ? undefined : handleTransfer}
                      >
                        <Text className='transfer-section__btn-text'>
                          {transferring ? t('admin.settings.transferring') : t('admin.settings.confirmTransfer')}
                        </Text>
                      </View>
                    </View>
                  </View>
                </CollapsibleSection>
              </>
            )}

            {/* Points Rule Config */}
            {activeCategory === 'points-rule' && (
              <>
                <Text className='settings-content__category-title'>{t('admin.settings.categoryPointsRule' as any)}</Text>
                <CollapsibleSection title={t('admin.settings.pointsRuleTitle' as any)} description={t('admin.settings.pointsRuleDesc' as any)}>
                  <View className='toggle-list'>
                    {([
                      { key: 'uglPointsPerEvent', labelKey: 'admin.settings.uglPointsPerEvent' },
                      { key: 'volunteerPointsPerEvent', labelKey: 'admin.settings.volunteerPointsPerEvent' },
                      { key: 'volunteerMaxPerEvent', labelKey: 'admin.settings.volunteerMaxPerEvent' },
                      { key: 'speakerTypeAPoints', labelKey: 'admin.settings.speakerTypeAPoints' },
                      { key: 'speakerTypeBPoints', labelKey: 'admin.settings.speakerTypeBPoints' },
                      { key: 'speakerRoundtablePoints', labelKey: 'admin.settings.speakerRoundtablePoints' },
                    ] as const).map((field) => (
                      <View key={field.key} className='toggle-item'>
                        <View className='toggle-item__info'>
                          <Text className='toggle-item__label'>{t(field.labelKey as any)}</Text>
                        </View>
                        <Input
                          type='number'
                          value={String(pointsRuleConfig[field.key])}
                          onInput={(e) => {
                            const val = parseInt(e.detail.value, 10);
                            if (!isNaN(val)) {
                              setPointsRuleConfig((prev) => ({ ...prev, [field.key]: val }));
                            }
                          }}
                          style={{
                            width: '120px',
                            textAlign: 'right',
                            color: 'var(--text-primary)',
                            background: 'var(--bg-void)',
                            border: '1px solid var(--card-border)',
                            borderRadius: 'var(--radius-sm)',
                            padding: 'var(--space-2) var(--space-3)',
                            fontSize: 'var(--text-body-sm)',
                          }}
                        />
                      </View>
                    ))}
                    <View
                      className={`btn-primary${pointsRuleSaving ? ' btn-primary--disabled' : ''}`}
                      onClick={pointsRuleSaving ? undefined : handleSavePointsRuleConfig}
                      style={{ marginTop: 'var(--space-16)', padding: 'var(--space-12) var(--space-24)' }}
                    >
                      <Text>{pointsRuleSaving ? t('admin.settings.pointsRuleSaving' as any) : t('admin.settings.pointsRuleSaveButton' as any)}</Text>
                    </View>
                  </View>
                </CollapsibleSection>
              </>
            )}

            {/* Easter Egg: Help */}
            {activeCategory === 'help' && (
              <View className='easter-egg'>
                <View className='easter-egg__fireworks'>
                  {Array.from({ length: 30 }).map((_, i) => (
                    <View key={i} className={`easter-egg__spark easter-egg__spark--${i % 6}`} style={{ left: `${10 + Math.random() * 80}%`, animationDelay: `${Math.random() * 3}s` }} />
                  ))}
                </View>
                <View className='easter-egg__emoji'>?</View>
                <Text className='easter-egg__title'>有新需求了？系统遇到问题了？</Text>
                <Text className='easter-egg__text'>
                  可以随时通过 moonstar.lxf@gmail.com 与我联系～
                </Text>
                <Text className='easter-egg__text easter-egg__text--muted'>
                  （小声说一句：如果 SuperAdmin 只能通过邮件联系到我…那可能我们还没建立更高效的沟通方式😏）
                </Text>
                <Text className='easter-egg__text easter-egg__text--small'>
                  mail 来的需求我会尽快完成并确保在下一个 5 月 1 日前能上～
                </Text>
                <Text className='easter-egg__text easter-egg__text--small'>
                  别问我为什么是 5 月 1 日 哈哈哈哈哈
                </Text>
                <View className='easter-egg__divider' />
                <Text className='easter-egg__text'>
                  开发商城和 Content Hub 的过程真的很有趣，
                </Text>
                <Text className='easter-egg__text'>
                  也希望它能为我们的 Community 带来一点小小的改变 ✨
                </Text>
                <View className='easter-egg__divider' />
                <Text className='easter-egg__subtitle'>A community-driven project</Text>
                <Text className='easter-egg__credit'>Co-designed by  <Text className='easter-egg__name easter-egg__name--yanglin'>Yanglin Liu</Text> & <Text className='easter-egg__name easter-egg__name--ping'>Ping Ma</Text></Text>
                <Text className='easter-egg__credit'>Built with ❤️ by  <Text className='easter-egg__name easter-egg__name--kiro'>Kiro</Text> & <Text className='easter-egg__name easter-egg__name--xiaofei'>Xiaofei Li</Text></Text>
                <Text className='easter-egg__credit'>Proudly supported by the community</Text>
              </View>
            )}
          </View>
        </View>
      )}

      {/* Email Template Editor Modal */}
      {editingTemplateType && (
        <EmailTemplateEditorModal
          notificationType={editingTemplateType}
          onClose={() => setEditingTemplateType(null)}
        />
      )}
    </View>
  );
}
