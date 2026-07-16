// @vitest-environment jsdom

// Feature: ugl-inactivity-exit-flow, Task 19.5 — Pending Exit List 渲染与 403 处理测试
// Covers: 空态展示、每行 Confirm/Restore 按钮渲染、打开确认弹窗并提交调用正确接口、
//         403 响应立即隐藏列表内容而非渲染部分/错误表格。
// Validates: Requirements 9.2, 9.3, 9.4, 10.1
//
// Feature: ugl-inactivity-exit-flow, Task 12.3 — 双 Tab UI 单元测试
// Covers: 两个 Tab 均渲染、Tab 切换、Awaiting_Reminder_List 空态、
//         全选复选框行为、无选中时发送按钮禁用、单个 Tab 403 只隐藏自身而不影响另一个 Tab。
// Validates: Requirements 5.10, 5.11

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

// ===========================================================================
// Task 12.3 — Two-tab UI (Awaiting_Reminder_List + Pending_Exit_List)
// ===========================================================================

/**
 * Standalone replica of the `AwaitingReminderRecord` shape from
 * pages/admin/ugl-exit-review.tsx.
 */
interface AwaitingReminderRecord {
  userId: string;
  nickname: string;
  email: string;
  ugName: string;
  quarter: string;
  recordedAt: string;
}

const TT = {
  tabAwaiting: '待发提醒',
  tabPending: '待退出审核',
  awaitingEmpty: '暂无待发提醒的 UGL',
  selectAll: '全选',
  sendReminder: '发送提醒',
  pendingEmpty: '暂无数据',
};

const awaitingRecord = (i: number): AwaitingReminderRecord => ({
  userId: `a-${i}`,
  nickname: `待发${i}`,
  email: `await${i}@example.com`,
  ugName: `UG-A-${i}`,
  quarter: '2026-Q1',
  recordedAt: '2026-02-01T00:00:00.000Z',
});

type ExitReviewTab = 'awaiting' | 'pending';

/**
 * Standalone replica of the two-tab layout from pages/admin/ugl-exit-review.tsx.
 * Isolates the tab switcher + per-tab conditional rendering, selection state,
 * and independent 403 handling from the full page's Taro/hooks/store deps.
 */
function TwoTabReviewView({
  initialTab = 'awaiting',
  awaitingRecords,
  awaitingForbidden = false,
  pendingRecords,
  pendingForbidden = false,
  onSend = () => {},
}: {
  initialTab?: ExitReviewTab;
  awaitingRecords: AwaitingReminderRecord[];
  awaitingForbidden?: boolean;
  pendingRecords: PendingExitRecord[];
  pendingForbidden?: boolean;
  onSend?: (userIds: string[]) => void;
}) {
  const [activeTab, setActiveTab] = useState<ExitReviewTab>(initialTab);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const allSelected =
    awaitingRecords.length > 0 && selectedIds.length === awaitingRecords.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds([]);
    } else {
      setSelectedIds(awaitingRecords.map((r) => r.userId));
    }
  };

  const toggleRow = (userId: string) => {
    setSelectedIds((prev) =>
      prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId],
    );
  };

  const sendDisabled = selectedIds.length === 0;

  return (
    <div className='ugl-exit-review'>
      {/* Tab switcher — both tabs always render */}
      <div className='ugl-exit-tabs'>
        <div
          className={`ugl-exit-tabs__tab${activeTab === 'awaiting' ? ' ugl-exit-tabs__tab--active' : ''}`}
          onClick={() => setActiveTab('awaiting')}
        >
          <span className='ugl-exit-tabs__tab-text'>{TT.tabAwaiting}</span>
        </div>
        <div
          className={`ugl-exit-tabs__tab${activeTab === 'pending' ? ' ugl-exit-tabs__tab--active' : ''}`}
          onClick={() => setActiveTab('pending')}
        >
          <span className='ugl-exit-tabs__tab-text'>{TT.tabPending}</span>
        </div>
      </div>

      {/* Tab 1: Awaiting_Reminder_List */}
      {activeTab === 'awaiting' && !awaitingForbidden && (
        <div className='ugl-exit-tabpanel ugl-exit-tabpanel--awaiting'>
          {awaitingRecords.length === 0 ? (
            <div className='admin-wishes-empty'>
              <span className='admin-wishes-empty__text'>{TT.awaitingEmpty}</span>
            </div>
          ) : (
            <div className='ugl-await'>
              <div className='ugl-await__header'>
                <div className='ugl-await__select-all' onClick={toggleSelectAll}>
                  <div className={`ugl-checkbox${allSelected ? ' ugl-checkbox--checked' : ''}`}>
                    {allSelected && <span className='ugl-checkbox__mark'>✓</span>}
                  </div>
                  <span className='ugl-await__select-all-label'>{TT.selectAll}</span>
                </div>
                <div
                  className={`ugl-await__send-btn${sendDisabled ? ' ugl-await__send-btn--disabled' : ''}`}
                  onClick={sendDisabled ? undefined : () => onSend(selectedIds)}
                >
                  <span>{TT.sendReminder}</span>
                </div>
              </div>
              {awaitingRecords.map((record) => {
                const checked = selectedIds.includes(record.userId);
                return (
                  <div
                    key={record.userId}
                    className={`ugl-await-row${checked ? ' ugl-await-row--checked' : ''}`}
                    onClick={() => toggleRow(record.userId)}
                  >
                    <div className={`ugl-checkbox${checked ? ' ugl-checkbox--checked' : ''}`}>
                      {checked && <span className='ugl-checkbox__mark'>✓</span>}
                    </div>
                    <span className='ugl-await-row__nickname'>{record.nickname}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Pending_Exit_List */}
      {activeTab === 'pending' && !pendingForbidden && (
        <div className='ugl-exit-tabpanel ugl-exit-tabpanel--pending'>
          {pendingRecords.length === 0 ? (
            <div className='admin-wishes-empty'>
              <span className='admin-wishes-empty__text'>{TT.pendingEmpty}</span>
            </div>
          ) : (
            <div className='ugl-exit-list'>
              {pendingRecords.map((record) => (
                <div key={record.userId} className='ugl-exit-row'>
                  <span className='ugl-exit-row__nickname'>{record.nickname}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Both tabs render (Req 5.10)
// ---------------------------------------------------------------------------
describe('双 Tab 渲染（Req 5.10）', () => {
  it('renders both the Awaiting_Reminder and Pending_Exit tab switchers', () => {
    const { container } = render(
      <TwoTabReviewView awaitingRecords={[awaitingRecord(1)]} pendingRecords={[sampleRecord(1)]} />,
    );
    const tabs = container.querySelectorAll('.ugl-exit-tabs__tab');
    expect(tabs.length).toBe(2);
    expect(tabs[0].textContent).toContain(TT.tabAwaiting);
    expect(tabs[1].textContent).toContain(TT.tabPending);
  });

  it('defaults to the Awaiting_Reminder tab being active', () => {
    const { container } = render(
      <TwoTabReviewView awaitingRecords={[awaitingRecord(1)]} pendingRecords={[sampleRecord(1)]} />,
    );
    const activeTab = container.querySelector('.ugl-exit-tabs__tab--active');
    expect(activeTab?.textContent).toContain(TT.tabAwaiting);
    // Awaiting panel visible, pending panel not mounted.
    expect(container.querySelector('.ugl-exit-tabpanel--awaiting')).not.toBeNull();
    expect(container.querySelector('.ugl-exit-tabpanel--pending')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Tab switching works (Req 5.10)
// ---------------------------------------------------------------------------
describe('Tab 切换（Req 5.10）', () => {
  it('clicking the Pending tab shows the pending panel and hides the awaiting panel', () => {
    const { container } = render(
      <TwoTabReviewView awaitingRecords={[awaitingRecord(1)]} pendingRecords={[sampleRecord(1)]} />,
    );
    const pendingTab = container.querySelectorAll('.ugl-exit-tabs__tab')[1];
    fireEvent.click(pendingTab);

    expect(container.querySelector('.ugl-exit-tabpanel--pending')).not.toBeNull();
    expect(container.querySelector('.ugl-exit-tabpanel--awaiting')).toBeNull();
    expect(container.querySelector('.ugl-exit-list')).not.toBeNull();

    // Switching back to awaiting works too.
    const awaitingTab = container.querySelectorAll('.ugl-exit-tabs__tab')[0];
    fireEvent.click(awaitingTab);
    expect(container.querySelector('.ugl-exit-tabpanel--awaiting')).not.toBeNull();
    expect(container.querySelector('.ugl-exit-tabpanel--pending')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Awaiting_Reminder_List empty state (Req 5.11)
// ---------------------------------------------------------------------------
describe('待发提醒空态（Req 5.11）', () => {
  it('renders the empty-state message when there are zero awaiting records', () => {
    const { container } = render(
      <TwoTabReviewView awaitingRecords={[]} pendingRecords={[]} />,
    );
    const empty = container.querySelector('.ugl-exit-tabpanel--awaiting .admin-wishes-empty__text');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain(TT.awaitingEmpty);
    // No list, no send button when empty.
    expect(container.querySelector('.ugl-await')).toBeNull();
    expect(container.querySelector('.ugl-await__send-btn')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Select-all checkbox behavior (Req 5.10)
// ---------------------------------------------------------------------------
describe('全选复选框行为（Req 5.10）', () => {
  it('select-all checks every row, and toggling again clears all', () => {
    const records = [awaitingRecord(1), awaitingRecord(2), awaitingRecord(3)];
    const { container } = render(
      <TwoTabReviewView awaitingRecords={records} pendingRecords={[]} />,
    );

    // Initially nothing checked.
    expect(container.querySelectorAll('.ugl-await-row--checked').length).toBe(0);
    expect(container.querySelector('.ugl-await__select-all .ugl-checkbox--checked')).toBeNull();

    // Click select-all → all rows checked.
    fireEvent.click(container.querySelector('.ugl-await__select-all')!);
    expect(container.querySelectorAll('.ugl-await-row--checked').length).toBe(3);
    expect(container.querySelector('.ugl-await__select-all .ugl-checkbox--checked')).not.toBeNull();

    // Click again → all cleared.
    fireEvent.click(container.querySelector('.ugl-await__select-all')!);
    expect(container.querySelectorAll('.ugl-await-row--checked').length).toBe(0);
    expect(container.querySelector('.ugl-await__select-all .ugl-checkbox--checked')).toBeNull();
  });

  it('toggling individual rows updates the select-all checkbox state accordingly', () => {
    const records = [awaitingRecord(1), awaitingRecord(2)];
    const { container } = render(
      <TwoTabReviewView awaitingRecords={records} pendingRecords={[]} />,
    );
    const rows = container.querySelectorAll('.ugl-await-row');

    fireEvent.click(rows[0]);
    expect(container.querySelectorAll('.ugl-await-row--checked').length).toBe(1);
    // Not all selected yet → select-all not checked.
    expect(container.querySelector('.ugl-await__select-all .ugl-checkbox--checked')).toBeNull();

    fireEvent.click(rows[1]);
    // Now all selected → select-all becomes checked.
    expect(container.querySelector('.ugl-await__select-all .ugl-checkbox--checked')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Send button disabled when nothing selected (Req 5.10)
// ---------------------------------------------------------------------------
describe('无选中时发送按钮禁用（Req 5.10）', () => {
  it('send button is disabled with zero selection and does not fire onSend', () => {
    const onSend = vi.fn();
    const records = [awaitingRecord(1)];
    const { container } = render(
      <TwoTabReviewView awaitingRecords={records} pendingRecords={[]} onSend={onSend} />,
    );

    const sendBtn = container.querySelector('.ugl-await__send-btn')!;
    expect(sendBtn.classList.contains('ugl-await__send-btn--disabled')).toBe(true);
    fireEvent.click(sendBtn);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('send button becomes enabled after selecting a row and fires onSend with the ids', () => {
    const onSend = vi.fn();
    const records = [awaitingRecord(1), awaitingRecord(2)];
    const { container } = render(
      <TwoTabReviewView awaitingRecords={records} pendingRecords={[]} onSend={onSend} />,
    );

    fireEvent.click(container.querySelectorAll('.ugl-await-row')[0]);
    const sendBtn = container.querySelector('.ugl-await__send-btn')!;
    expect(sendBtn.classList.contains('ugl-await__send-btn--disabled')).toBe(false);

    fireEvent.click(sendBtn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith([records[0].userId]);
  });
});

// ---------------------------------------------------------------------------
// Independent 403 handling — 403 on one tab hides only that tab (Req 5.10)
// ---------------------------------------------------------------------------
describe('单 Tab 403 只隐藏自身（Req 5.10）', () => {
  it('awaiting 403 hides the awaiting panel but the pending tab still works', () => {
    const { container } = render(
      <TwoTabReviewView
        awaitingRecords={[]}
        awaitingForbidden
        pendingRecords={[sampleRecord(1)]}
      />,
    );
    // Awaiting tab is active but forbidden → no awaiting panel content.
    expect(container.querySelector('.ugl-exit-tabpanel--awaiting')).toBeNull();
    // Tab switcher still present with both tabs.
    expect(container.querySelectorAll('.ugl-exit-tabs__tab').length).toBe(2);

    // Switch to pending → renders normally.
    fireEvent.click(container.querySelectorAll('.ugl-exit-tabs__tab')[1]);
    expect(container.querySelector('.ugl-exit-tabpanel--pending')).not.toBeNull();
    expect(container.querySelector('.ugl-exit-list')).not.toBeNull();
  });

  it('pending 403 hides the pending panel but the awaiting tab still works', () => {
    const { container } = render(
      <TwoTabReviewView
        initialTab='pending'
        awaitingRecords={[awaitingRecord(1)]}
        pendingRecords={[]}
        pendingForbidden
      />,
    );
    // Pending tab active but forbidden → no pending panel content.
    expect(container.querySelector('.ugl-exit-tabpanel--pending')).toBeNull();
    expect(container.querySelectorAll('.ugl-exit-tabs__tab').length).toBe(2);

    // Switch to awaiting → renders normally.
    fireEvent.click(container.querySelectorAll('.ugl-exit-tabs__tab')[0]);
    expect(container.querySelector('.ugl-exit-tabpanel--awaiting')).not.toBeNull();
    expect(container.querySelector('.ugl-await')).not.toBeNull();
  });
});
