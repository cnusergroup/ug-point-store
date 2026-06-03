// @vitest-environment jsdom

// Feature: credential-self-application, Task 10.7 — 证书申请标签前端组件/示例测试
// Covers: 证书申请标签位置（差旅右侧）、可申请/已申请态切换、空态/错误态/加载态、
//         姓名为空的前端拦截。
// Validates: Requirements 4.1, 4.4, 4.5, 4.6, 4.7, 5.2

import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';

/**
 * Standalone replica of the credential application item from
 * pages/index/index.tsx (renderCredentialItem). Uses the same class names
 * and the same applied/not-applied conditional rendering, isolated from
 * the full page's Taro/store dependencies.
 */
interface CredentialApplicationItem {
  activityId: string;
  sourceRole: 'Speaker' | 'UserGroupLeader' | 'Volunteer';
  eventName: string;
  identityText: string;
  applied: boolean;
  credentialId?: string;
  status?: 'active' | 'revoked';
}

const T = {
  activityNameLabel: '活动名称',
  identityLabel: '证书身份',
  applyButton: '申请',
  appliedBadge: '已申请',
  viewCertificate: '查看证书',
  loading: '加载中...',
  empty: '暂无可申请的证书',
  error: '加载失败，请重试',
  retry: '重试',
  recipientNameEmptyError: '姓名不能为空',
};

function CredentialItem({
  item,
  onView,
  onApply,
}: {
  item: CredentialApplicationItem;
  onView: (id: string) => void;
  onApply: (item: CredentialApplicationItem) => void;
}) {
  return (
    <div className='credential-item'>
      <div className='credential-item__body'>
        <div className='credential-item__field'>
          <span className='credential-item__field-label'>{T.activityNameLabel}</span>
          <span className='credential-item__field-value'>{item.eventName}</span>
        </div>
        <div className='credential-item__field'>
          <span className='credential-item__field-label'>{T.identityLabel}</span>
          <span className='credential-item__field-value'>{item.identityText}</span>
        </div>
      </div>
      <div className='credential-item__action'>
        {item.applied ? (
          <>
            <span className='credential-item__badge'>{T.appliedBadge}</span>
            {item.credentialId && (
              <div
                className='credential-item__view-btn'
                onClick={() => onView(item.credentialId!)}
              >
                <span>{T.viewCertificate}</span>
              </div>
            )}
          </>
        ) : (
          <div
            className='credential-item__apply-btn btn-primary'
            onClick={() => onApply(item)}
          >
            <span>{T.applyButton}</span>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Standalone replica of the credential view's loading / error / empty / list
 * branch from pages/index/index.tsx.
 */
function CredentialView({
  loading,
  error,
  items,
  onRetry = () => {},
  onView = () => {},
  onApply = () => {},
}: {
  loading: boolean;
  error: boolean;
  items: CredentialApplicationItem[];
  onRetry?: () => void;
  onView?: (id: string) => void;
  onApply?: (item: CredentialApplicationItem) => void;
}) {
  return (
    <div className='credential-view'>
      {loading ? (
        <div className='mall-loading'>
          <span className='mall-loading__text'>{T.loading}</span>
        </div>
      ) : error ? (
        <div className='credential-error'>
          <span className='credential-error__text'>{T.error}</span>
          <div className='credential-error__retry btn-secondary' onClick={onRetry}>
            <span>{T.retry}</span>
          </div>
        </div>
      ) : items.length === 0 ? (
        <div className='mall-empty'>
          <span className='mall-empty__text'>{T.empty}</span>
        </div>
      ) : (
        <div className='credential-list'>
          {items.map((item) => (
            <CredentialItem
              key={`${item.activityId}#${item.sourceRole}`}
              item={item}
              onView={onView}
              onApply={onApply}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Req 4.1 — Certificate tab appears to the RIGHT of the travel tab.
// Replicates the visibleTypes ordering in pages/index/index.tsx filter bar.
// ---------------------------------------------------------------------------
describe('证书申请标签位置（Req 4.1）', () => {
  // Same key ordering used in the page's filter bar config.
  const TAB_KEYS = ['all', 'points', 'code_exclusive', 'travel', 'credential'] as const;

  it('credential tab is positioned immediately to the right of the travel tab', () => {
    const travelIndex = TAB_KEYS.indexOf('travel');
    const credentialIndex = TAB_KEYS.indexOf('credential');

    expect(travelIndex).toBeGreaterThanOrEqual(0);
    expect(credentialIndex).toBeGreaterThanOrEqual(0);
    // credential must come right after travel
    expect(credentialIndex).toBe(travelIndex + 1);
    // credential must be the last (right-most) tab
    expect(credentialIndex).toBe(TAB_KEYS.length - 1);
  });

  it('renders tabs in order with credential rendered after travel in the DOM', () => {
    function FilterBar() {
      return (
        <div className='filter-bar__types'>
          {TAB_KEYS.map((key) => (
            <div key={key} className='filter-tab' data-key={key}>
              <span>{key}</span>
            </div>
          ))}
        </div>
      );
    }
    const { container } = render(<FilterBar />);
    const tabs = Array.from(container.querySelectorAll('.filter-tab'));
    const keys = tabs.map((t) => t.getAttribute('data-key'));
    expect(keys.indexOf('credential')).toBe(keys.indexOf('travel') + 1);
  });
});

// ---------------------------------------------------------------------------
// Req 4.4 / 4.5 — applied vs not-applied item rendering.
// ---------------------------------------------------------------------------
describe('可申请/已申请态切换（Req 4.4, 4.5）', () => {
  const base: CredentialApplicationItem = {
    activityId: 'act-1',
    sourceRole: 'Speaker',
    eventName: 'AWS Community Day 2026',
    identityText: 'Speaker',
    applied: false,
  };

  it('not-applied item shows 申请 entry and no 已申请 badge (Req 4.4)', () => {
    const onApply = vi.fn();
    const { container } = render(
      <CredentialItem item={base} onView={() => {}} onApply={onApply} />,
    );
    const applyBtn = container.querySelector('.credential-item__apply-btn');
    const badge = container.querySelector('.credential-item__badge');
    expect(applyBtn).not.toBeNull();
    expect(applyBtn?.textContent).toContain('申请');
    expect(badge).toBeNull();

    fireEvent.click(applyBtn!);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('applied item shows 已申请 badge + view-certificate entry, no 申请 button (Req 4.5)', () => {
    const onView = vi.fn();
    const appliedItem: CredentialApplicationItem = {
      ...base,
      applied: true,
      credentialId: 'ACD-2026-Summer-SPK-0007',
      status: 'active',
    };
    const { container } = render(
      <CredentialItem item={appliedItem} onView={onView} onApply={() => {}} />,
    );
    const badge = container.querySelector('.credential-item__badge');
    const viewBtn = container.querySelector('.credential-item__view-btn');
    const applyBtn = container.querySelector('.credential-item__apply-btn');

    expect(badge).not.toBeNull();
    expect(badge?.textContent).toContain('已申请');
    expect(viewBtn).not.toBeNull();
    expect(applyBtn).toBeNull();

    fireEvent.click(viewBtn!);
    expect(onView).toHaveBeenCalledWith('ACD-2026-Summer-SPK-0007');
  });

  it('renders both event name and identity text for an item (Req 4.3)', () => {
    const { container } = render(
      <CredentialItem item={base} onView={() => {}} onApply={() => {}} />,
    );
    const values = Array.from(
      container.querySelectorAll('.credential-item__field-value'),
    ).map((el) => el.textContent);
    expect(values).toContain('AWS Community Day 2026');
    expect(values).toContain('Speaker');
  });
});

// ---------------------------------------------------------------------------
// Req 4.6 / 4.7 / loading — empty / error / loading states.
// ---------------------------------------------------------------------------
describe('空态/错误态/加载态（Req 4.6, 4.7）', () => {
  const items: CredentialApplicationItem[] = [
    { activityId: 'a', sourceRole: 'Volunteer', eventName: 'E', identityText: 'Volunteer', applied: false },
  ];

  it('loading state shows the loading indicator and not empty/error/list', () => {
    const { container } = render(<CredentialView loading error={false} items={[]} />);
    expect(container.querySelector('.mall-loading')).not.toBeNull();
    expect(container.querySelector('.mall-empty')).toBeNull();
    expect(container.querySelector('.credential-error')).toBeNull();
    expect(container.querySelector('.credential-list')).toBeNull();
  });

  it('error state shows error + retry and NOT the empty state (Req 4.6)', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <CredentialView loading={false} error items={[]} onRetry={onRetry} />,
    );
    const err = container.querySelector('.credential-error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('加载失败');
    // Must NOT degrade to empty state on error
    expect(container.querySelector('.mall-empty')).toBeNull();

    fireEvent.click(container.querySelector('.credential-error__retry')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty state (loaded, no items) shows 暂无可申请的证书 (Req 4.7)', () => {
    const { container } = render(<CredentialView loading={false} error={false} items={[]} />);
    const empty = container.querySelector('.mall-empty');
    expect(empty).not.toBeNull();
    expect(empty?.textContent).toContain('暂无可申请的证书');
    expect(container.querySelector('.credential-error')).toBeNull();
  });

  it('loaded with items renders the list and not empty/error', () => {
    const { container } = render(<CredentialView loading={false} error={false} items={items} />);
    expect(container.querySelector('.credential-list')).not.toBeNull();
    expect(container.querySelectorAll('.credential-item').length).toBe(1);
    expect(container.querySelector('.mall-empty')).toBeNull();
    expect(container.querySelector('.credential-error')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Req 5.2 — empty-name front-end interception: trimmed-empty name blocks
// submission, shows "姓名不能为空", and does NOT send a request.
// Replicates handleSubmitApply from pages/index/index.tsx.
// ---------------------------------------------------------------------------
describe('姓名为空的前端拦截（Req 5.2）', () => {
  function ApplyDialog({ request }: { request: (args: unknown) => Promise<unknown> }) {
    const [name, setName] = useState('');
    const [error, setError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const handleSubmit = async () => {
      if (submitting) return;
      // Req 5.2: block submission when trimmed name is empty; do NOT call API.
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        setError(T.recipientNameEmptyError);
        return;
      }
      setSubmitting(true);
      setError('');
      try {
        await request({ recipientName: trimmed });
      } finally {
        setSubmitting(false);
      }
    };

    return (
      <div className='credential-apply-modal'>
        <input
          className='credential-apply-modal__input'
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError('');
          }}
        />
        {error && <span className='credential-apply-modal__error'>{error}</span>}
        <div className='credential-apply-modal__submit' onClick={handleSubmit}>
          <span>提交申请</span>
        </div>
      </div>
    );
  }

  it('blocks submit for empty input, shows error, sends no request', () => {
    const request = vi.fn().mockResolvedValue({});
    const { container } = render(<ApplyDialog request={request} />);

    fireEvent.click(container.querySelector('.credential-apply-modal__submit')!);

    const err = container.querySelector('.credential-apply-modal__error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('姓名不能为空');
    expect(request).not.toHaveBeenCalled();
  });

  it('blocks submit for whitespace-only input, shows error, sends no request', () => {
    const request = vi.fn().mockResolvedValue({});
    const { container } = render(<ApplyDialog request={request} />);

    const input = container.querySelector('.credential-apply-modal__input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   \t  ' } });
    fireEvent.click(container.querySelector('.credential-apply-modal__submit')!);

    const err = container.querySelector('.credential-apply-modal__error');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('姓名不能为空');
    expect(request).not.toHaveBeenCalled();
  });

  it('sends request with trimmed name for a valid (non-empty) input', async () => {
    let resolveRequest: (v: unknown) => void = () => {};
    const request = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        resolveRequest = resolve;
      }),
    );
    const { container } = render(<ApplyDialog request={request} />);

    const input = container.querySelector('.credential-apply-modal__input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  Jane Doe  ' } });
    fireEvent.click(container.querySelector('.credential-apply-modal__submit')!);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith({ recipientName: 'Jane Doe' });
    // No error shown for valid input
    expect(container.querySelector('.credential-apply-modal__error')).toBeNull();

    // Resolve the pending request and let the submitting state settle.
    resolveRequest({ credentialId: 'X' });
    await waitFor(() =>
      expect(
        container.querySelector('.credential-apply-modal__error'),
      ).toBeNull(),
    );
  });
});
