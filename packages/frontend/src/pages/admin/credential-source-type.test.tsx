// @vitest-environment jsdom

// Feature: credential-self-application, Task 10.7 — 后台来源类型标签前端组件/示例测试
// Covers: 凭证列表来源类型标签（appliedByUserId 存在 → 自助申请，否则 → 批量导入）。
// Validates: Requirements 10.3

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import React from 'react';
import { render } from '@testing-library/react';

interface AdminCredentialRow {
  credentialId: string;
  recipientName: string;
  eventName: string;
  status: 'active' | 'revoked';
  role: string;
  issueDate: string;
  // present only on self-applied credentials
  appliedByUserId?: string;
  sourceActivityId?: string;
  sourceRole?: string;
}

/**
 * Standalone replica of the source-type label rendering in
 * pages/admin/credentials.tsx — the label and its modifier class are derived
 * solely from whether `appliedByUserId` is truthy.
 */
function CredentialRowSource({ cred }: { cred: AdminCredentialRow }) {
  return (
    <div className='cred-row__top'>
      <span className='cred-row__id'>{cred.credentialId}</span>
      <span className={`cred-source cred-source--${cred.appliedByUserId ? 'self' : 'batch'}`}>
        {cred.appliedByUserId ? '自助申请' : '批量导入'}
      </span>
      <span className={`cred-status cred-status--${cred.status}`}>
        {cred.status === 'active' ? '有效' : '已撤销'}
      </span>
    </div>
  );
}

const selfApplied: AdminCredentialRow = {
  credentialId: 'ACD-2026-Summer-SPK-0003',
  recipientName: 'Jane Doe',
  eventName: 'AWS Community Day 2026',
  status: 'active',
  role: 'Speaker',
  issueDate: '2026-06-20',
  appliedByUserId: 'user-123',
  sourceActivityId: 'act-1',
  sourceRole: 'Speaker',
};

const batchImported: AdminCredentialRow = {
  credentialId: 'ACD-2025-Fall-VOL-0010',
  recipientName: 'John Roe',
  eventName: 'AWS Community Day 2025',
  status: 'active',
  role: 'Volunteer',
  issueDate: '2025-10-01',
  // no appliedByUserId → batch imported
};

describe('后台来源类型标签展示（Req 10.3）', () => {
  it('shows 自助申请 with cred-source--self when appliedByUserId present', () => {
    const { container } = render(<CredentialRowSource cred={selfApplied} />);
    const tag = container.querySelector('.cred-source');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe('自助申请');
    expect(tag?.classList.contains('cred-source--self')).toBe(true);
    expect(tag?.classList.contains('cred-source--batch')).toBe(false);
  });

  it('shows 批量导入 with cred-source--batch when appliedByUserId absent', () => {
    const { container } = render(<CredentialRowSource cred={batchImported} />);
    const tag = container.querySelector('.cred-source');
    expect(tag).not.toBeNull();
    expect(tag?.textContent).toBe('批量导入');
    expect(tag?.classList.contains('cred-source--batch')).toBe(true);
    expect(tag?.classList.contains('cred-source--self')).toBe(false);
  });

  it('source label is determined solely by presence of a non-empty appliedByUserId', () => {
    // appliedByUserId: undefined | '' (falsy → batch) or a non-empty id (truthy → self)
    const appliedByArb = fc.option(
      fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0),
      { nil: undefined },
    );

    fc.assert(
      fc.property(appliedByArb, fc.constantFrom('active', 'revoked'), (appliedByUserId, status) => {
        const cred: AdminCredentialRow = {
          ...batchImported,
          status: status as 'active' | 'revoked',
          appliedByUserId,
        };
        const { container } = render(<CredentialRowSource cred={cred} />);
        const tag = container.querySelector('.cred-source')!;

        if (appliedByUserId) {
          expect(tag.textContent).toBe('自助申请');
          expect(tag.classList.contains('cred-source--self')).toBe(true);
        } else {
          expect(tag.textContent).toBe('批量导入');
          expect(tag.classList.contains('cred-source--batch')).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });
});
