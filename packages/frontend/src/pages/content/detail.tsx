import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { useAppStore } from '../../store';
import { request } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import type { ContentItem, ContentComment } from '@points-mall/shared';
import './detail.scss';

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

interface DownloadResponse {
  success: boolean;
  downloadUrl: string;
}

interface CommentCreateResponse {
  success: boolean;
  comment: ContentComment;
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

/** Get full public URL for external services like Office Online Viewer */
function getFileFullUrl(fileKey: string): string {
  if (typeof window !== 'undefined') {
    return `${window.location.origin}/${fileKey}`;
  }
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

  const [item, setItem] = useState<ContentItem | null>(null);
  const [hasReserved, setHasReserved] = useState(false);
  const [hasLiked, setHasLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

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

  useEffect(() => {
    if (!isAuthenticated) {
      Taro.redirectTo({ url: '/pages/login/index' });
      return;
    }
    fetchDetail();
    fetchComments(true);
  }, [isAuthenticated, fetchDetail, fetchComments]);

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
    if (reserving) return;
    setReserving(true);
    try {
      await request<ReserveResponse>({
        url: `/api/content/${contentId}/reserve`,
        method: 'POST',
      });
      setHasReserved(true);
      setItem((prev) => prev ? { ...prev, reservationCount: prev.reservationCount + 1 } : prev);
      Taro.showToast({ title: t('contentHub.detail.reserveSuccess'), icon: 'success' });
    } catch (err: any) {
      Taro.showToast({ title: err?.message || t('contentHub.detail.reserveFailed'), icon: 'none' });
    } finally {
      setReserving(false);
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
        <View className='detail-header'>
          <Text className='detail-header__back' onClick={handleBack}>{t('contentHub.detail.backButton')}</Text>
          <Text className='detail-header__title'>{t('contentHub.detail.title')}</Text>
          <View className='detail-header__spacer' />
        </View>
        <View className='detail-loading'>
          <Text className='detail-loading__text'>{t('contentHub.detail.loading')}</Text>
        </View>
      </View>
    );
  }

  if (error || !item) {
    return (
      <View className='detail-page'>
        <View className='detail-header'>
          <Text className='detail-header__back' onClick={handleBack}>{t('contentHub.detail.backButton')}</Text>
          <Text className='detail-header__title'>{t('contentHub.detail.title')}</Text>
          <View className='detail-header__spacer' />
        </View>
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
      <View className='detail-header'>
        <Text className='detail-header__back' onClick={handleBack}>{t('contentHub.detail.backButton')}</Text>
        <Text className='detail-header__title'>{t('contentHub.detail.title')}</Text>
        <View className='detail-header__spacer' />
      </View>

      <ScrollView className='detail-body' scrollY>
        {/* Content Info */}
        <View className='detail-info'>
          <Text className='detail-info__title'>{item.title}</Text>
          <View className='detail-info__meta'>
            <Text className='detail-info__uploader'>{item.uploaderNickname}</Text>
            <Text className={getRoleBadgeClass(item.uploaderRole)}>
              {getRoleBadgeLabel(item.uploaderRole)}
            </Text>
            <Text className='detail-info__category'>{item.categoryName}</Text>
            <Text className='detail-info__time'>{formatTime(item.createdAt)}</Text>
          </View>
          <Text className='detail-info__desc'>{item.description}</Text>

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
              {item.reservationCount === 0 && (
                <View className='detail-owner__edit-btn btn-secondary' onClick={handleEdit}>
                  <Text>{t('contentHub.detail.editButton')}</Text>
                </View>
              )}
            </View>
          )}
        </View>

        {/* Stats */}
        <View className='detail-stats'>
          <View className='detail-stats__item'>
            <Text className='detail-stats__icon detail-stats__icon--heart'>♥</Text>
            <Text className='detail-stats__value'>{likeCount}</Text>
            <Text className='detail-stats__label'>{t('contentHub.detail.statLikes')}</Text>
          </View>
          <View className='detail-stats__item'>
            <Text className='detail-stats__icon'>💬</Text>
            <Text className='detail-stats__value'>{item.commentCount}</Text>
            <Text className='detail-stats__label'>{t('contentHub.detail.statComments')}</Text>
          </View>
          <View className='detail-stats__item'>
            <Text className='detail-stats__icon'>📋</Text>
            <Text className='detail-stats__value'>{item.reservationCount}</Text>
            <Text className='detail-stats__label'>{t('contentHub.detail.statReservations')}</Text>
          </View>
        </View>

        {/* Document Preview */}
        {item.fileKey && (
          <View className='detail-preview'>
            <Text className='detail-preview__label'>{t('contentHub.detail.previewLabel')} · {item.fileName}</Text>
            {isPdf(item.fileName) ? (
              <iframe
                className='detail-preview__frame'
                src={`${getFilePublicUrl(item.fileKey)}#toolbar=0&navpanes=0&scrollbar=1`}
                title={item.fileName}
              />
            ) : isOfficeDoc(item.fileName) ? (
              <iframe
                className='detail-preview__frame'
                src={`https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(getFileFullUrl(item.fileKey))}`}
                title={item.fileName}
              />
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
            {hasReserved ? (
              <View className='btn-primary' onClick={handleDownload}>
                <Text>{t('contentHub.detail.downloadButton')}</Text>
              </View>
            ) : (
              <View
                className={`btn-primary ${reserving ? 'btn-primary--disabled' : ''}`}
                onClick={handleReserve}
              >
                <Text>{reserving ? t('contentHub.detail.reserving') : t('contentHub.detail.reserveButton')}</Text>
              </View>
            )}
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
    </View>
  );
}
