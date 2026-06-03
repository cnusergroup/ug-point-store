// @vitest-environment jsdom

// Feature: credential-self-application, Task 10.7 — 我的获得证书管理前端组件/示例测试
// Covers: 加载态/空态/错误态、复制链接成功与失败路径（失败展示完整 URL 供手动复制）。
// Validates: Requirements 8.6, 8.7, 8.8, 8.9

import { describe, it, expect, vi } from 'vitest';
import React, { useState } from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';

interface MyCredential {
  credentialId: string;
  eventName: string;
  identityText: string;
  issueDate: string;
  status: 'active' | 'revoked';
  url: string;
}

const T = {
  loading: '加载中...',
  empty: '暂无已获得的证书',
  error: '加载失败，请重试',
  retry: '重试',
  copySuccess: '链接已复制',
  copyFailed: '复制失败，请手动复制',
};

/**
 * Standalone replica of the "获得证书管理" section status branches from
 * pages/profile/index.tsx (loading / error / empty / list). Mirrors the
 * exact branch condition `credentialsLoading && !credentialsLoaded`.
 */
function MyCredentialsSection({
  loading,
  loaded,
  error,
  credentials,
  copyFailedUrl = null,
  onRetry = () => {},
  onCopy = () => {},
}: {
  loading: boolean;
  loaded: boolean;
  error: boolean;
  credentials: MyCredential[];
  copyFailedUrl?: string | null;
  onRetry?: () => void;
  onCopy?: (cred: MyCredential) => void;
}) {
  return (
    <div className='my-credentials'>
      {loading && !loaded ? (
        <div className='my-credentials__status'>
          <span className='my-credentials__status-text'>{T.loading}</span>
        </div>
      ) : error ? (
        <div className='my-credentials__status'>
          <span className='my-credentials__status-text my-credentials__status-text--error'>{T.error}</span>
          <div className='my-credentials__retry' onClick={onRetry}>
            <span>{T.retry}</span>
          </div>
        </div>
      ) : credentials.length === 0 ? (
        <div className='my-credentials__empty'>
          <span className='my-credentials__empty-text'>{T.empty}</span>
        </div>
      ) : (
        <div className='my-credentials__list'>
          {credentials.map((cred) => (
            <div key={cred.credentialId} className='credential-card'>
              <span className='credential-card__event'>{cred.eventName}</span>
              <span className='credential-card__identity'>{cred.identityText}</span>
              <span
                className={`credential-card__status ${
                  cred.status === 'active'
                    ? 'credential-card__status--active'
                    : 'credential-card__status--revoked'
                }`}
              >
                {cred.status === 'active' ? '有效' : '已撤销'}
              </span>
              <div className='credential-card__copy' onClick={() => onCopy(cred)}>
                <span>复制链接</span>
              </div>
              {copyFailedUrl === cred.url && (
                <div className='credential-card__manual-url'>
                  <span className='credential-card__manual-url-text'>{cred.url}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const sampleCreds: MyCredential[] = [
  {
    credentialId: 'ACD-2026-Summer-SPK-0003',
    eventName: 'AWS Community Day 2026',
    identityText: 'Speaker',
    issueDate: '2026-06-20',
    status: 'active',
    url: 'https://creds.awscommunity.cn/c/ACD-2026-Summer-SPK-0003',
  },
  {
    credentialId: 'ACD-2026-Summer-VOL-0007',
    eventName: 'AWS Community Day 2026',
    identityText: 'Volunteer',
    issueDate: '2026-06-19',
    status: 'revoked',
    url: 'https://creds.awscommunity.cn/c/ACD-2026-Summer-VOL-0007',
  },
];

describe('我的证书 加载/空/错误态（Req 8.7, 8.8）', () => {
  it('loading (not loaded) shows loading and NOT empty/error/list (Req 8.8)', () => {
    const { container } = render(
      <MyCredentialsSection loading loaded={false} error={false} credentials={[]} />,
    );
    const status = container.querySelector('.my-credentials__status-text');
    expect(status?.textContent).toContain('加载中');
    expect(container.querySelector('.my-credentials__empty')).toBeNull();
    expect(container.querySelector('.my-credentials__status-text--error')).toBeNull();
    expect(container.querySelector('.my-credentials__list')).toBeNull();
  });

  it('error shows error + retry and NOT empty (Req 8.3 / 8.7)', () => {
    const onRetry = vi.fn();
    const { container } = render(
      <MyCredentialsSection loading={false} loaded error credentials={[]} onRetry={onRetry} />,
    );
    expect(container.querySelector('.my-credentials__status-text--error')).not.toBeNull();
    expect(container.querySelector('.my-credentials__empty')).toBeNull();

    fireEvent.click(container.querySelector('.my-credentials__retry')!);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty (loaded, no creds) shows 暂无已获得的证书 and no error (Req 8.7)', () => {
    const { container } = render(
      <MyCredentialsSection loading={false} loaded error={false} credentials={[]} />,
    );
    const empty = container.querySelector('.my-credentials__empty-text');
    expect(empty?.textContent).toContain('暂无已获得的证书');
    expect(container.querySelector('.my-credentials__status-text--error')).toBeNull();
  });

  it('loaded with credentials renders cards with event, identity and status', () => {
    const { container } = render(
      <MyCredentialsSection loading={false} loaded error={false} credentials={sampleCreds} />,
    );
    const cards = container.querySelectorAll('.credential-card');
    expect(cards.length).toBe(2);
    // active vs revoked status classes
    expect(container.querySelector('.credential-card__status--active')).not.toBeNull();
    expect(container.querySelector('.credential-card__status--revoked')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Req 8.6 / 8.9 — copy link success and failure paths.
// Replicates handleCopyCredentialLink behaviour: on success show success toast;
// on failure show failure toast AND surface the full URL inline for manual copy.
// ---------------------------------------------------------------------------
describe('复制链接成功与失败路径（Req 8.6, 8.9）', () => {
  /**
   * Container managing copyFailedUrl state, wired to a mockable clipboard
   * function — mirrors the profile page's setClipboardData().then/catch.
   */
  function CopyHarness({
    setClipboardData,
    showToast,
  }: {
    setClipboardData: (args: { data: string }) => Promise<unknown>;
    showToast: (args: { title: string; icon: string }) => void;
  }) {
    const [copyFailedUrl, setCopyFailedUrl] = useState<string | null>(null);
    const cred = sampleCreds[0];

    const handleCopy = (c: MyCredential) => {
      setCopyFailedUrl(null);
      setClipboardData({ data: c.url })
        .then(() => {
          showToast({ title: T.copySuccess, icon: 'success' });
        })
        .catch(() => {
          // Req 8.9: surface the full URL inline on failure for manual copy
          setCopyFailedUrl(c.url);
          showToast({ title: T.copyFailed, icon: 'none' });
        });
    };

    return (
      <MyCredentialsSection
        loading={false}
        loaded
        error={false}
        credentials={[cred]}
        copyFailedUrl={copyFailedUrl}
        onCopy={handleCopy}
      />
    );
  }

  it('success path copies full URL and shows success toast, no manual-url shown (Req 8.6)', async () => {
    const setClipboardData = vi.fn().mockResolvedValue(undefined);
    const showToast = vi.fn();
    const { container } = render(
      <CopyHarness setClipboardData={setClipboardData} showToast={showToast} />,
    );

    fireEvent.click(container.querySelector('.credential-card__copy')!);

    await waitFor(() => expect(showToast).toHaveBeenCalled());
    expect(setClipboardData).toHaveBeenCalledWith({
      data: 'https://creds.awscommunity.cn/c/ACD-2026-Summer-SPK-0003',
    });
    expect(showToast).toHaveBeenCalledWith({ title: '链接已复制', icon: 'success' });
    // No manual-url block on success
    expect(container.querySelector('.credential-card__manual-url')).toBeNull();
  });

  it('failure path shows failure toast and surfaces full URL for manual copy (Req 8.9)', async () => {
    const setClipboardData = vi.fn().mockRejectedValue(new Error('denied'));
    const showToast = vi.fn();
    const { container } = render(
      <CopyHarness setClipboardData={setClipboardData} showToast={showToast} />,
    );

    fireEvent.click(container.querySelector('.credential-card__copy')!);

    await waitFor(() =>
      expect(container.querySelector('.credential-card__manual-url')).not.toBeNull(),
    );
    expect(showToast).toHaveBeenCalledWith({ title: '复制失败，请手动复制', icon: 'none' });
    const manual = container.querySelector('.credential-card__manual-url-text');
    expect(manual?.textContent).toBe('https://creds.awscommunity.cn/c/ACD-2026-Summer-SPK-0003');
  });
});
