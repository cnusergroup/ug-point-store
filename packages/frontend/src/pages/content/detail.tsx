import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { View, Text, ScrollView, Input } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';

/** Hook: disable right-click, Ctrl+S, and drag on the page to deter casual downloading */
function useDownloadPrevention() {
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // Block Ctrl+S / Cmd+S
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
      }
      // Block Ctrl+Shift+S (Save As)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'S') {
        e.preventDefault();
      }
    };

    const handleDragStart = (e: DragEvent) => {
      e.preventDefault();
    };

    document.addEventListener('contextmenu', handleContextMenu);
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('dragstart', handleDragStart);

    return () => {
      document.removeEventListener('contextmenu', handleContextMenu);
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('dragstart', handleDragStart);
    };
  }, []);
}


import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { ContentItem, ContentComment } from '@points-mall/shared';
import PageToolbar from '../../components/PageToolbar';
import PdfViewer from '../../components/PdfViewer';
import './detail.scss';

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

interface FeatureTogglesResponse {
  contentRolePermissions?: ContentRolePermissions;
}

const CONTENT_ROLES = ['Speaker', 'UserGroupLeader', 'Volunteer'] as const;
type ContentRole = typeof CONTENT_ROLES[number];

function computePermission(
  userRoles: string[],
  permission: keyof RolePermissions,
  crp: ContentRolePermissions,
): boolean {
  if (userRoles.includes('SuperAdmin')) return true;
  const contentRoles = userRoles.filter((r): r is ContentRole =>
    (CONTENT_ROLES as readonly string[]).includes(r),
  );
  if (contentRoles.length === 0) return false;
  return contentRoles.some((role) => crp[role][permission]);
}

/** Role display config for badges */
const ROLE_CONFIG: Record<string, { label: string; className: string }> = {
  UserGroupLeader: { label: 'Leader', className: 'role-badge--leader' },
  // [DISABLED] CommunityBuilder
  // CommunityBuilder: { label: 'Builder', className: 'role-badge--builder' },
  Speaker: { label: 'Speaker', className: 'role-badge--speaker' },
  Volunteer: { label: 'Volunteer', className: 'role-badge--volunteer' },
  Admin: { label: 'Admin', className: 'role-badge--admin' },
  SuperAdmin: { label: 'SuperAdmin', className: 'role-badge--superadmin' },
};

interface ContentDetailResponse {
  success: boolean;
  item: ContentItem;
  hasReserved: boolean;
  hasLiked: boolean;
}

interface CommentsResponse {
  success: boolean;
  comments: ContentComment[];
  lastKey?: string;
}

interface LikeResponse {
  success: boolean;
  liked: boolean;
  likeCount: number;
}

interface ReserveResponse {
  success: boolean;
  alreadyReserved?: boolean;
}

/** Activity record from reservation-activities API */
interface ActivityRecord {
  activityId: string;
  activityType: string;
  ugName: string;
  topic: string;
  activityDate: string;
}

interface ActivitiesResponse {
  success: boolean;
  activities: ActivityRecord[];
  lastKey?: string;
}

interface DownloadResponse {
  success: boolean;
  downloadUrl: string;
}

interface CommentCreateResponse {
  success: boolean;
  comment: ContentComment;
}

/** Inline SVG icons for stats — feather-style, self-contained */
function HeartIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
    </svg>
  );
}

function CommentIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ClipboardIcon({ size = 16, color = 'currentColor' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color}
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}

/** Get file extension from fileName */
function getFileExtension(fileName: string): string {
  const parts = fileName.split('.');
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : '';
}

/** Get public URL for a file via CloudFront */
function getFilePublicUrl(fileKey: string): string {
  // For same-origin access (PDF iframe), relative path works
  return `/${fileKey}`;
}

/** Check if file is PDF */
function isPdf(fileName: string): boolean {
  return getFileExtension(fileName) === 'pdf';
}

/** Check if file is an Office document (PPT/PPTX/DOC/DOCX) */
function isOfficeDoc(fileName: string): boolean {
  const ext = getFileExtension(fileName);
  return ['ppt', 'pptx', 'doc', 'docx'].includes(ext);
}

export default function ContentDetailPage() {
  const router = useRouter();
  const contentId = router.params.id || '';
  const { t } = useTranslation();
  const user = useAppStore((s) => s.user);
  const isAuthenticated = useAppStore((s) => s.isAuthenticated);

  // Activate download prevention (right-click, Ctrl+S, drag)
  useDownloadPrevention();

  const [item, setItem] = useState<ContentItem | null>(null);
  const [hasReserved, setHasReserved] = useState(false);
  const [hasLiked, setHasLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Permission state
  const [canDownload, setCanDownload] = useState(true); // default true (conservative)
  const [canReserve, setCanReserve] = useState(true); // default true (conservative)

  // Comments state
  const [comments, setComments] = useState<ContentComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentsHasMore, setCommentsHasMore] = useState(true);
  const commentsLastKeyRef = useRef<string | undefined>(undefined);
  const [commentText, setCommentText] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // Action loading states
  const [liking, setLiking] = useState(false);
  const [reserving, setReserving] = useState(false);

  // Activity selector state
  const [showActivitySelector, setShowActivitySelector] = useState(false);
  const [activities, setActivities] = useState<ActivityRecord[]>([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitySearch, setActivitySearch] = useState('');
  const [selectedActivity, setSelectedActivity] = useState<ActivityRecord | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!contentId) return;
    setLoading(true);
    setError('');
    try {
      const res = await request<ContentDetailResponse>({ url: `/api/content/${contentId}` });
      setItem(res.item);
      setHasReserved(res.hasReserved);
      setHasLiked(res.hasLiked);
      setLikeCount(res.item.likeCount);
    } catch (err: any) {
      setError(err?.message || t('contentHub.detail.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [contentId]);

  const fetchComments = useCallback(async (reset = false) => {
    if (!contentId) return;
    if (reset) {
      commentsLastKeyRef.current = undefined;
      setCommentsLoading(true);
    }
    try {
      let url = `/api/content/${contentId}/comments?pageSize=20`;
      if (!reset && commentsLastKeyRef.current) {
        url += `&lastKey=${encodeURIComponent(commentsLastKeyRef.current)}`;
      }
      const res = await request<CommentsResponse>({ url });
      const newComments = res.comments || [];
      if (reset) {
        setComments(newComments);
      } else {
        setComments((prev) => [...prev, ...newComments]);
      }
      commentsLastKeyRef.current = res.lastKey;
      setCommentsHasMore(!!res.lastKey);
    } catch {
      if (reset) setComments([]);
    } finally {
      setCommentsLoading(false);
    }
  }, [contentId]);

  const fetchPermissions = useCallback(async () => {
    if (!user) return;
    try {
      const res = await request<FeatureTogglesResponse>({
        url: '/api/settings/feature-toggles',
        skipAuth: true,
      });
      const crp = res.contentRolePermissions;
      if (!crp) {
        setCanDownload(true);
        setCanReserve(true);
        return;
      }
      const roles = user.roles || [];
      setCanDownload(computePermission(roles, 'canDownload', crp));
      setCanReserve(computePermission(roles, 'canReserve', crp));
    } catch {
      // On fetch failure, degrade conservatively: hide both buttons
      setCanDownload(false);
      setCanReserve(false);
    }
  }, [user]);

  /** Fetch activities for the activity selector */
  const fetchActivities = useCallback(async () => {
    setActivitiesLoading(true);
    try {
      const res = await request<ActivitiesResponse>({
        url: '/api/content/reservation-activities?pageSize=200',
      });
      setActivities(res.activities || []);
    } catch {
      setActivities([]);
    } finally {
      setActivitiesLoading(false);
    }
  }, []);

  /** Client-side search filtering on activities */
  const filteredActivities = useMemo(() => {
    const query = activitySearch.trim().toLowerCase();
    if (!query) return activities;
    return activities.filter((a) =>
      a.ugName.toLowerCase().includes(query) ||
      a.topic.toLowerCase().includes(query) ||
      a.activityDate.toLowerCase().includes(query),
    );
  }, [activities, activitySearch]);

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchDetail();
    fetchComments(true);
    fetchPermissions();
  }, [isAuthenticated, fetchDetail, fetchComments, fetchPermissions]);

  const isOwner = !!user && !!item && user.userId === item.uploaderId;

  const handleBack = () => {
    goBack('/pages/content/index');
  };

  const handleEdit = () => {
    if (!item) return;
    Taro.navigateTo({ url: `/pages/content/upload?id=${item.contentId}` });
  };

  const handleLike = async () => {
    if (liking) return;
    setLiking(true);
    try {
      const res = await request<LikeResponse>({
        url: `/api/content/${contentId}/like`,
        method: 'POST',
      });
      setHasLiked(res.liked);
      setLikeCount(res.likeCount);
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('contentHub.detail.operationFailed'), icon: 'none' });
    } finally {
      setLiking(false);
    }
  };

  const handleReserve = async () => {
    // Open activity selector modal instead of directly reserving
    setShowActivitySelector(true);
    setSelectedActivity(null);
    setActivitySearch('');
    fetchActivities();
  };

  /** Called when user confirms activity selection in the modal */
  const handleConfirmReservation = async () => {
    if (!selectedActivity || reserving) return;
    setReserving(true);
    try {
      await request<ReserveResponse>({
        url: `/api/content/${contentId}/reserve`,
        method: 'POST',
        data: {
          activityId: selectedActivity.activityId,
          activityType: selectedActivity.activityType,
          activityUG: selectedActivity.ugName,
          activityTopic: selectedActivity.topic,
          activityDate: selectedActivity.activityDate,
        },
      });
      setHasReserved(true);
      setItem((prev) => prev ? { ...prev, reservationCount: prev.reservationCount + 1 } : prev);
      setShowActivitySelector(false);
      Taro.showToast({ title: t('contentHub.detail.reserveSuccess'), icon: 'success' });
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('contentHub.detail.reserveFailed'), icon: 'none' });
    } finally {
      setReserving(false);
    }
  };

  const handleCloseActivitySelector = () => {
    if (!reserving) {
      setShowActivitySelector(false);
    }
  };

  const handleDownload = async () => {
    try {
      const res = await request<DownloadResponse>({
        url: `/api/content/${contentId}/download`,
      });
      if (res.downloadUrl) {
        const env = Taro.getEnv();
        if (env === Taro.ENV_TYPE.WEB) {
          window.open(res.downloadUrl, '_blank');
        } else {
          Taro.downloadFile({
            url: res.downloadUrl,
            success: (dlRes) => {
              if (dlRes.statusCode === 200) {
                Taro.openDocument({ filePath: dlRes.tempFilePath });
              }
            },
          });
        }
      }
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('contentHub.detail.downloadFailed'), icon: 'none' });
    }
  };

  const handleSubmitComment = async () => {
    const trimmed = commentText.trim();
    if (!trimmed || submittingComment) return;
    setSubmittingComment(true);
    try {
      const res = await request<CommentCreateResponse>({
        url: `/api/content/${contentId}/comments`,
        method: 'POST',
        data: { content: trimmed },
      });
      setComments((prev) => [res.comment, ...prev]);
      setCommentText('');
      setItem((prev) => prev ? { ...prev, commentCount: prev.commentCount + 1 } : prev);
      Taro.showToast({ title: t('contentHub.detail.commentSuccess'), icon: 'success' });
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('contentHub.detail.commentFailed'), icon: 'none' });
    } finally {
      setSubmittingComment(false);
    }
  };

  const handleLoadMoreComments = () => {
    if (!commentsLoading && commentsHasMore) {
      fetchComments(false);
    }
  };

  const handleVideoClick = (url: string) => {
    const env = Taro.getEnv();
    if (env === Taro.ENV_TYPE.WEB) {
      window.open(url, '_blank');
    } else {
      Taro.setClipboardData({ data: url });
      Taro.showToast({ title: t('contentHub.detail.videoCopied'), icon: 'success' });
    }
  };

  const formatTime = (iso: string) => {
    const d = new Date(iso);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const min = String(d.getMinutes()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}`;
  };

  const getRoleBadgeClass = (role: string): string => {
    const config = ROLE_CONFIG[role];
    return config ? `role-badge ${config.className}` : 'role-badge';
  };

  const getRoleBadgeLabel = (role: string): string => {
    return ROLE_CONFIG[role]?.label || role;
  };

  // ---- Render ----

  if (loading) {
    return (
      <View className='detail-page'>
        <PageToolbar title={t('contentHub.detail.title')} onBack={handleBack} />
        <View className='detail-loading'>
          <Text className='detail-loading__text'>{t('contentHub.detail.loading')}</Text>
        </View>
      </View>
    );
  }

  if (error || !item) {
    return (
      <View className='detail-page'>
        <PageToolbar title={t('contentHub.detail.title')} onBack={handleBack} />
        <View className='detail-error'>
          <Text className='detail-error__text'>{error || t('contentHub.detail.notFound')}</Text>
          <Text className='detail-error__retry' onClick={fetchDetail}>{t('contentHub.detail.retry')}</Text>
        </View>
      </View>
    );
  }

  return (
    <View className='detail-page'>
      {/* Header */}
      <PageToolbar title={t('contentHub.detail.title')} onBack={handleBack} />

      <ScrollView className='detail-body' scrollY>
        {/* Content Info */}
        <View className='detail-info'>
          <Text className='detail-info__title'>{item.title}</Text>
          <View className='detail-info__meta'>
            <Text className='detail-info__uploader'>{item.uploaderNickname}</Text>
            {ROLE_CONFIG[item.uploaderRole] && (
              <Text className={getRoleBadgeClass(item.uploaderRole)}>
                {getRoleBadgeLabel(item.uploaderRole)}
              </Text>
            )}
            <Text className='detail-info__category'>{item.categoryName}</Text>
            <Text className='detail-info__time'>{formatTime(item.createdAt)}</Text>
          </View>
          <Text className='detail-info__desc'>{item.description}</Text>

          {/* Tags */}
          {(item.tags ?? []).length > 0 && (
            <View className='detail-info__tags'>
              {(item.tags ?? []).map((tag) => (
                <View key={tag} className='detail-info__tag-chip'>
                  <Text className='detail-info__tag-chip-text'>{tag}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Owner: Status display + Edit button */}
          {isOwner && (
            <View className='detail-owner'>
              <View className='detail-owner__status'>
                <Text className='detail-owner__status-label'>{t('contentHub.detail.statusLabel')}:</Text>
                <Text className={`detail-owner__status-badge detail-owner__status-badge--${item.status}`}>
                  {item.status === 'pending' && t('contentHub.detail.statusPending')}
                  {item.status === 'approved' && t('contentHub.detail.statusApproved')}
                  {item.status === 'rejected' && t('contentHub.detail.statusRejected')}
                </Text>
              </View>
              {item.status === 'rejected' && item.rejectReason && (
                <View className='detail-owner__reject'>
                  <Text className='detail-owner__reject-label'>{t('contentHub.detail.rejectReasonLabel')}:</Text>
                  <Text className='detail-owner__reject-text'>{item.rejectReason}</Text>
                </View>
              )}
              <View className='detail-owner__edit-btn btn-secondary' onClick={handleEdit}>
                <Text>{t('contentHub.detail.editButton')}</Text>
              </View>
            </View>
          )}
        </View>

        {/* Stats */}
        <View className='detail-stats'>
          <View className='detail-stats__item'>
            <View className='detail-stats__icon detail-stats__icon--heart'>
              <HeartIcon size={16} color="var(--error)" />
            </View>
            <Text className='detail-stats__value'>{likeCount}</Text>
            <Text className='detail-stats__label'>{t('contentHub.detail.statLikes')}</Text>
          </View>
          <View className='detail-stats__item'>
            <View className='detail-stats__icon'>
              <CommentIcon size={16} color="currentColor" />
            </View>
            <Text className='detail-stats__value'>{item.commentCount}</Text>
            <Text className='detail-stats__label'>{t('contentHub.detail.statComments')}</Text>
          </View>
          <View className='detail-stats__item'>
            <View className='detail-stats__icon'>
              <ClipboardIcon size={16} color="currentColor" />
            </View>
            <Text className='detail-stats__value'>{item.reservationCount}</Text>
            <Text className='detail-stats__label'>{t('contentHub.detail.statReservations')}</Text>
          </View>
        </View>

        {/* Document Preview */}
        {item.fileKey && (
          <View className='detail-preview'>
            <Text className='detail-preview__label'>{t('contentHub.detail.previewLabel')} · {item.fileName}</Text>
            {item.previewStatus === 'pending' ? (
              <View className='detail-preview__pending'>
                <View className='detail-preview__spinner' />
                <Text className='detail-preview__pending-text'>{t('contentHub.detail.previewPending')}</Text>
              </View>
            ) : item.previewStatus === 'failed' ? (
              <View className='detail-preview__failed'>
                <Text className='detail-preview__failed-text'>{t('contentHub.detail.previewFailed')}</Text>
              </View>
            ) : item.previewFileKey ? (
              <PdfViewer url={getFilePublicUrl(item.previewFileKey)} />
            ) : isPdf(item.fileName) ? (
              <PdfViewer url={getFilePublicUrl(item.fileKey)} />
            ) : (
              <View className='detail-preview__unsupported'>
                <Text className='detail-preview__unsupported-text'>{t('contentHub.detail.previewUnsupported')}</Text>
              </View>
            )}
          </View>
        )}

        {/* Video Link */}
        {item.videoUrl && (
          <View className='detail-video'>
            <Text className='detail-video__label'>{t('contentHub.detail.videoLabel')}</Text>
            <Text
              className='detail-video__link'
              onClick={() => handleVideoClick(item.videoUrl!)}
            >
              {item.videoUrl}
            </Text>
          </View>
        )}

        {/* Actions: Reserve/Download + Like */}
        <View className='detail-actions'>
          <View className='detail-actions__reserve-btn'>
            {(() => {
              const isAdminUser = user?.roles?.includes('SuperAdmin');
              if (isAdminUser) {
                // SuperAdmin/Admin: always show download button, no reservation required
                return (
                  <View className='btn-primary' onClick={handleDownload}>
                    <Text>{t('contentHub.detail.downloadButton')}</Text>
                  </View>
                );
              }
              return (
                <>
                  {canReserve && !hasReserved && (
                    <View
                      className={`btn-primary ${reserving ? 'btn-primary--disabled' : ''}`}
                      onClick={handleReserve}
                    >
                      <Text>{reserving ? t('contentHub.detail.reserving') : t('contentHub.detail.reserveButton')}</Text>
                    </View>
                  )}
                  {canDownload && hasReserved && (
                    <View className='btn-primary' onClick={handleDownload}>
                      <Text>{t('contentHub.detail.downloadButton')}</Text>
                    </View>
                  )}
                </>
              );
            })()}
          </View>
          <View
            className={`detail-actions__like-btn ${hasLiked ? 'detail-actions__like-btn--liked' : ''}`}
            onClick={handleLike}
          >
            <Text className='detail-actions__like-icon'>{hasLiked ? '♥' : '♡'}</Text>
            <Text className='detail-actions__like-count'>{likeCount}</Text>
          </View>
        </View>

        {/* Comments Section */}
        <View className='detail-comments'>
          <Text className='detail-comments__title'>{t('contentHub.detail.commentsTitle')} ({item.commentCount})</Text>

          {/* Comment Input */}
          {user && (
            <View className='comment-input'>
              <textarea
                className='comment-input__field'
                placeholder={t('contentHub.detail.commentPlaceholder')}
                value={commentText}
                onInput={(e: any) => setCommentText(e.target.value || e.detail?.value || '')}
                maxLength={500}
              />
              <View
                className={`btn-primary comment-input__submit ${(!commentText.trim() || submittingComment) ? 'btn-primary--disabled' : ''}`}
                onClick={handleSubmitComment}
              >
                <Text>{submittingComment ? t('contentHub.detail.commentSubmitting') : t('contentHub.detail.commentSubmit')}</Text>
              </View>
            </View>
          )}

          {/* Comment List */}
          <View className='comment-list'>
            {comments.length === 0 && !commentsLoading ? (
              <View className='comment-list__empty'>
                <Text className='comment-list__empty-text'>{t('contentHub.detail.commentEmpty')}</Text>
              </View>
            ) : (
              comments.map((c) => (
                <View key={c.commentId} className='comment-item'>
                  <View className='comment-item__header'>
                    <Text className='comment-item__nickname'>{c.userNickname}</Text>
                    <Text className={getRoleBadgeClass(c.userRole)}>
                      {getRoleBadgeLabel(c.userRole)}
                    </Text>
                    <Text className='comment-item__time'>{formatTime(c.createdAt)}</Text>
                  </View>
                  <Text className='comment-item__content'>{c.content}</Text>
                </View>
              ))
            )}
          </View>

          {/* Load More Comments */}
          {commentsHasMore && comments.length > 0 && (
            <View className='comment-load-more'>
              <Text className='comment-load-more__btn' onClick={handleLoadMoreComments}>
                {commentsLoading ? t('contentHub.detail.commentLoading') : t('contentHub.detail.commentLoadMore')}
              </Text>
            </View>
          )}

          {!commentsHasMore && comments.length > 0 && (
            <View className='comment-load-more'>
              <Text className='comment-load-more__text'>{t('contentHub.detail.commentNoMore')}</Text>
            </View>
          )}
        </View>
      </ScrollView>

      {/* Activity Selector Modal */}
      {showActivitySelector && (
        <View className='activity-selector-overlay' onClick={handleCloseActivitySelector}>
          <View className='activity-selector' onClick={(e) => e.stopPropagation()}>
            <View className='activity-selector__header'>
              <Text className='activity-selector__title'>{t('activitySelector.title')}</Text>
              <Text className='activity-selector__close' onClick={handleCloseActivitySelector}>✕</Text>
            </View>

            <View className='activity-selector__search'>
              <Input
                className='activity-selector__search-input'
                placeholder={t('activitySelector.searchPlaceholder')}
                value={activitySearch}
                onInput={(e) => setActivitySearch(e.detail.value)}
              />
            </View>

            <ScrollView className='activity-selector__list' scrollY>
              {activitiesLoading ? (
                <View className='activity-selector__loading'>
                  <Text className='activity-selector__loading-text'>{t('common.loading')}</Text>
                </View>
              ) : filteredActivities.length === 0 ? (
                <View className='activity-selector__empty'>
                  <Text className='activity-selector__empty-text'>{t('activitySelector.empty')}</Text>
                </View>
              ) : (
                filteredActivities.map((activity) => {
                  const isSelected = selectedActivity?.activityId === activity.activityId;
                  return (
                    <View
                      key={activity.activityId}
                      className={`activity-selector__item ${isSelected ? 'activity-selector__item--selected' : ''}`}
                      onClick={() => setSelectedActivity(activity)}
                    >
                      <View className='activity-selector__radio'>
                        <View className={`activity-selector__radio-dot ${isSelected ? 'activity-selector__radio-dot--active' : ''}`} />
                      </View>
                      <View className='activity-selector__item-content'>
                        <View className='activity-selector__item-top'>
                          <Text className={`activity-selector__type-badge activity-selector__type-badge--${activity.activityType === '线上' ? 'online' : 'offline'}`}>
                            {activity.activityType}
                          </Text>
                          <Text className='activity-selector__ug-name'>{activity.ugName}</Text>
                        </View>
                        <Text className='activity-selector__topic'>{activity.topic}</Text>
                        <Text className='activity-selector__date'>{activity.activityDate}</Text>
                      </View>
                    </View>
                  );
                })
              )}
            </ScrollView>

            <View className='activity-selector__footer'>
              <View
                className='btn-secondary activity-selector__cancel-btn'
                onClick={handleCloseActivitySelector}
              >
                <Text>{t('common.cancel')}</Text>
              </View>
              <View
                className={`btn-primary activity-selector__confirm-btn ${(!selectedActivity || reserving) ? 'btn-primary--disabled' : ''}`}
                onClick={handleConfirmReservation}
              >
                <Text>{reserving ? t('contentHub.detail.reserving') : t('common.confirm')}</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}
