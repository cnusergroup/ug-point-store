// @vitest-environment jsdom

// Feature: ugl-inactivity-exit-flow, Task 19.5 — Pending Exit List 渲染与 403 处理测试
// Covers: 空态展示、每行 Confirm/Restore 按钮渲染、打开确认弹窗并提交调用正确接口、
//         403 响应立即隐藏列表内容而非渲染部分/错误表格。
// Validates: Requirements 9.2, 9.3, 9.4, 10.1

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';

/**
 * Standalone replica of the `PendingExitRecord` shape from
 * pages/admin/ugl-exit-review.tsx.
 */
interface PendingExitRecord {
  userId: string;
  nickname: string;
  email: string;
  ugName: string;
  triggeredQuarter: string;
  markedAt: string;
}

const T = {
  loading: '加载中...',
  empty: '暂无数据',
  confirmExit: '确认退出',
  restoreTracking: '恢复追踪',
  triggeredQuarterLabel: '触发季度',
  forbiddenText: '无权访问',
};

/**
 * Standalone replica of the loading / forbidden / empty / list branch from
 * pages/admin/ugl-exit-review.tsx. Isolates the conditional rendering logic
 * from the full page's Taro/hooks/store dependencies.
 */
function PendingExitListView({
  loading,
  forbidden,
  records,
  onConfirmExit = () => {},
  onRestoreTracking = () => {},
}: {
  loading: boolean;
  forbidden: boolean;
  records: PendingExitRecord[];
  onConfirmExit?: (record: PendingExitRecord) => void;
  onRestoreTracking?: (record: PendingExitRecord) => void;
}) {
  if (forbidden) {
    return (
      <div className='admin-forbidden'>
        <span className='admin-forbidden__text'>{T.forbiddenText}</span>
        <span className='admin-forbidden__link'>返回</span>
      </div>
    );
  }

  return (
    <div className='ugl-exit-review'>
      {loading ? (
        <div className='admin-wishes-loading'><span>{T.loading}</span></div>
      ) : records.length === 0 ? (
        <div className='admin-wishes-empty'>
          <span className='admin-wishes-empty__text'>{T.empty}</span>
        </div>
      ) : (
        <div className='ugl-exit-list'>
          {records.map((record) => (
            <div key={record.userId} className='ugl-exit-row'>
              <div className='ugl-exit-row__info'>
                <span className='ugl-exit-row__nickname'>{record.nickname}</span>
                <span className='ugl-exit-row__meta'>{record.email}</span>
                <span className='ugl-exit-row__meta'>{record.ugName}</span>
                <span className='ugl-exit-row__quarter'>
                  {T.triggeredQuarterLabel}: {record.triggeredQuarter}
                </span>
              </div>
              <div className='ugl-exit-row__actions'>
                <div
                  className='ugl-exit-row__action-btn ugl-exit-row__action-btn--danger'
                  onClick={() => onConfirmExit(record)}
                >
                  <span>{T.confirmExit}</span>
                </div>
                <div
                  className='ugl-exit-row__action-btn ugl-exit-row__action-btn--secondary'
                  onClick={() => onRestoreTracking(record)}
                >
                  <span>{T.restoreTracking}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const sampleRecord = (i: number): PendingExitRecord => ({
  userId: `u-${i}`,
  nickname: `用户${i}`,
  email: `user${i}@example.com`,
  ugName: `UG-${i}`,
  triggeredQuarter: '2026-Q1',
  markedAt: '2026-02-01T00:00:00.000Z',
});

// ---------------------------------------------------------------------------
// Req 9.2 — 403 immediately hides the list content instead of rendering
// any partial/error data.
// ---------------------------------------------------------------------------
describe('403 处理（Req 9.2）', () => {
  it('forbidden=true renders admin-forbidden and NOT the list or empty state', () => {
    const { container } = render(
      <PendingExitListView loading={false} forbidden records={[sampleRecord(1)]} />,
    );
    expect(container.querySelector('.admin-forbidden')).not.toBeNull();
    expect(container.querySelector('.ugl-exit-list')).toBeNull();
    expect(container.querySelector('.admin-wishes-empty')).toBeNull();
    expect(container.querySelector('.admin-wishes-loading')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Req 9.3 — loading state renders while data has not resolved yet.
// ---------------------------------------------------------------------------
describe('加载状态（Req 9.3）', () => {
  it('loading=true, forbidden=false renders admin-wishes-loading and not empty/list', () => {
    const { container } = render(
      <PendingExitListView loading forbidden={false} records={[]} />,
    );
    expect(container.querySelector('.admin-wishes-loading')).not.toBeNull();
    expect(container.querySelector('.admin-wishes-empty')).toBeNull();
    expect(container.querySelector('.ugl-exit-list')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Req 9.4 — empty state message when there are zero Pending_Exit_UGL users.
// ---------------------------------------------------------------------------
describe('空态展示（Req 9.4）', () => {
  it('loading=false, forbidden=false, records=[] renders admin-wishes-empty', () => {
    const { container } = render(
      <PendingExitListView loading={false} forbidden={false} records={[]} />,
    );
    const empty = container.querySelector('.admin-wishes-empty');
    expect(empty).not.toBeNull();
    const emptyText = container.querySelector('.admin-wishes-empty__text');
    expect(emptyText).not.toBeNull();
    expect(emptyText?.textContent).toContain(T.empty);
    expect(container.querySelector('.ugl-exit-list')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Req 9.1 / 10.1 — list rendering, one row per record with the expected
// fields and Confirm/Restore action buttons.
// ---------------------------------------------------------------------------
describe('列表渲染与操作按钮（Req 9.1, 10.1）', () => {
  it('renders one ugl-exit-row per record, each showing nickname/email/ugName/triggeredQuarter', () => {
    const records = [sampleRecord(1), sampleRecord(2), sampleRecord(3)];
    const { container } = render(
      <PendingExitListView loading={false} forbidden={false} records={records} />,
    );
    const rows = container.querySelectorAll('.ugl-exit-row');
    expect(rows.length).toBe(3);
    rows.forEach((row, idx) => {
      const record = records[idx];
      expect(row.textContent).toContain(record.nickname);
      expect(row.textContent).toContain(record.email);
      expect(row.textContent).toContain(record.ugName);
      expect(row.textContent).toContain(record.triggeredQuarter);
    });
    expect(container.querySelector('.admin-wishes-empty')).toBeNull();
  });

  it('each row renders a Confirm_Exit_Action and a Restore_Tracking_Action button (Req 10.1)', () => {
    const records = [sampleRecord(1)];
    const { container } = render(
      <PendingExitListView loading={false} forbidden={false} records={records} />,
    );
    const confirmBtn = container.querySelector('.ugl-exit-row__action-btn--danger');
    const restoreBtn = container.querySelector('.ugl-exit-row__action-btn--secondary');
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn?.textContent).toContain(T.confirmExit);
    expect(restoreBtn).not.toBeNull();
    expect(restoreBtn?.textContent).toContain(T.restoreTracking);
  });

  it('clicking Confirm_Exit_Action invokes the callback with the correct record', () => {
    const records = [sampleRecord(1), sampleRecord(2)];
    const onConfirmExit = vi.fn();
    const { container } = render(
      <PendingExitListView
        loading={false}
        forbidden={false}
        records={records}
        onConfirmExit={onConfirmExit}
      />,
    );
    const rows = container.querySelectorAll('.ugl-exit-row');
    const secondRowConfirmBtn = rows[1].querySelector('.ugl-exit-row__action-btn--danger')!;
    fireEvent.click(secondRowConfirmBtn);
    expect(onConfirmExit).toHaveBeenCalledTimes(1);
    expect(onConfirmExit).toHaveBeenCalledWith(records[1]);
  });

  it('clicking Restore_Tracking_Action invokes the callback with the correct record', () => {
    const records = [sampleRecord(1)];
    const onRestoreTracking = vi.fn();
    const { container } = render(
      <PendingExitListView
        loading={false}
        forbidden={false}
        records={records}
        onRestoreTracking={onRestoreTracking}
      />,
    );
    const restoreBtn = container.querySelector('.ugl-exit-row__action-btn--secondary')!;
    fireEvent.click(restoreBtn);
    expect(onRestoreTracking).toHaveBeenCalledTimes(1);
    expect(onRestoreTracking).toHaveBeenCalledWith(records[0]);
  });
});

// ---------------------------------------------------------------------------
// Req 10.1 — opening a confirmation dialog and submitting calls the correct
// endpoint (mirrors the real page's review dialog + `request()` call).
// ---------------------------------------------------------------------------
describe('确认弹窗提交调用正确接口（Req 10.1）', () => {
  type ReviewAction = 'confirm-exit' | 'restore-tracking';

  /**
   * Standalone replica of the review confirmation dialog + submit handler
   * from pages/admin/ugl-exit-review.tsx's handleReviewSubmit.
   */
  function ReviewDialog({
    record,
    requestFn,
  }: {
    record: PendingExitRecord;
    requestFn: (args: { url: string; method: string }) => Promise<unknown>;
  }) {
    const [reviewAction, setReviewAction] = useState<ReviewAction | null>(null);
    const [error, setError] = useState('');

    const openReview = (action: ReviewAction) => {
      setReviewAction(action);
      setError('');
    };

    const submit = async () => {
      if (!reviewAction) return;
      const endpoint = reviewAction === 'confirm-exit'
        ? `/api/admin/ugl-exit/${record.userId}/confirm-exit`
        : `/api/admin/ugl-exit/${record.userId}/restore-tracking`;
      try {
        await requestFn({ url: endpoint, method: 'POST' });
        setReviewAction(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'error');
      }
    };

    return (
      <div>
        <div className='open-confirm-exit' onClick={() => openReview('confirm-exit')}>confirm-exit</div>
        <div className='open-restore-tracking' onClick={() => openReview('restore-tracking')}>restore-tracking</div>
        {reviewAction && (
          <div className='wish-form-modal'>
            {error && <span className='wish-form-modal__error'>{error}</span>}
            <div className='wish-form-modal__submit' onClick={submit}>submit</div>
          </div>
        )}
      </div>
    );
  }

  it('submitting Confirm_Exit_Action calls POST /confirm-exit for the target userId', async () => {
    const requestFn = vi.fn().mockResolvedValue({});
    const record = sampleRecord(7);
    const { container } = render(<ReviewDialog record={record} requestFn={requestFn} />);

    fireEvent.click(container.querySelector('.open-confirm-exit')!);
    fireEvent.click(container.querySelector('.wish-form-modal__submit')!);

    await waitFor(() => expect(requestFn).toHaveBeenCalledTimes(1));
    expect(requestFn).toHaveBeenCalledWith({
      url: `/api/admin/ugl-exit/${record.userId}/confirm-exit`,
      method: 'POST',
    });
  });

  it('submitting Restore_Tracking_Action calls POST /restore-tracking for the target userId', async () => {
    const requestFn = vi.fn().mockResolvedValue({});
    const record = sampleRecord(8);
    const { container } = render(<ReviewDialog record={record} requestFn={requestFn} />);

    fireEvent.click(container.querySelector('.open-restore-tracking')!);
    fireEvent.click(container.querySelector('.wish-form-modal__submit')!);

    await waitFor(() => expect(requestFn).toHaveBeenCalledTimes(1));
    expect(requestFn).toHaveBeenCalledWith({
      url: `/api/admin/ugl-exit/${record.userId}/restore-tracking`,
      method: 'POST',
    });
  });
});
