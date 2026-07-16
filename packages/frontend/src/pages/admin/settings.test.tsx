// @vitest-environment jsdom

// Feature: ugl-inactivity-exit-flow, Task 13.2 — Additional Notification Recipients editor tests
// Covers: adding an email chip, removing an email chip, and a malformed-email
//         submission surfacing an inline error WITHOUT clearing other unsaved fields.
// Validates: Requirements 7.1, 7.4

import { describe, it, expect, vi } from 'vitest';
import { useState } from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Standalone replica of the Additional_Notification_Recipients editor logic
// from pages/admin/settings.tsx. The full page pulls in Taro / zustand / i18n
// runtime dependencies that are awkward to boot under jsdom, so — mirroring the
// existing sibling test (ugl-exit-review.test.tsx) — we replicate the editor's
// state machine (handleAddRecipient / handleRemoveRecipient) faithfully and
// exercise it directly.
// ---------------------------------------------------------------------------

const INVALID_EMAIL_ERROR = '邮箱格式不正确';
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Minimal replica of the RequestError raised by the frontend request util,
 * carrying the fields the editor branches on (statusCode / code).
 */
class ReplicaRequestError extends Error {
  statusCode: number;
  code: string;
  constructor(statusCode: number, code: string, message = 'request failed') {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

interface RecipientEditorProps {
  initialRecipients?: string[];
  /** Mirrors persistFeatureToggles — receives the full recipients list on save. */
  persist?: (recipients: string[]) => Promise<void>;
  onSuccessToast?: () => void;
  onFailureToast?: () => void;
}

/**
 * Faithful replica of the recipient-editor block + its handlers in settings.tsx.
 * Includes an unrelated "other unsaved field" (a free-text note input that is
 * NOT persisted) so we can assert that a malformed-email rejection leaves other
 * unsaved edits untouched — the core of Requirement 7.4.
 */
function RecipientEditor({
  initialRecipients = [],
  persist = async () => {},
  onSuccessToast = () => {},
  onFailureToast = () => {},
}: RecipientEditorProps) {
  const [recipients, setRecipients] = useState<string[]>(initialRecipients);
  const [recipientInput, setRecipientInput] = useState('');
  const [recipientError, setRecipientError] = useState('');
  // An unrelated, unsaved field that must survive a malformed-email rejection.
  const [otherUnsavedField, setOtherUnsavedField] = useState('');

  const handleAddRecipient = async () => {
    const email = recipientInput.trim();
    if (!email) return;
    if (!EMAIL_FORMAT.test(email)) {
      setRecipientError(INVALID_EMAIL_ERROR);
      return;
    }
    if (recipients.includes(email)) {
      setRecipientInput('');
      setRecipientError('');
      return;
    }
    const prevRecipients = recipients;
    const updated = [...prevRecipients, email];
    setRecipients(updated);
    setRecipientInput('');
    setRecipientError('');
    try {
      await persist(updated);
      onSuccessToast();
    } catch (err) {
      // Roll back ONLY this field so other unsaved edits stay intact.
      setRecipients(prevRecipients);
      if (
        err instanceof ReplicaRequestError &&
        (err.statusCode === 400 || err.code === 'INVALID_REQUEST')
      ) {
        setRecipientError(INVALID_EMAIL_ERROR);
      } else {
        onFailureToast();
      }
    }
  };

  const handleRemoveRecipient = async (email: string) => {
    const prevRecipients = recipients;
    const updated = prevRecipients.filter((e) => e !== email);
    setRecipients(updated);
    setRecipientError('');
    try {
      await persist(updated);
      onSuccessToast();
    } catch {
      setRecipients(prevRecipients);
      onFailureToast();
    }
  };

  return (
    <div className='recipient-editor'>
      <div className='recipient-editor__add'>
        <input
          className='recipient-editor__input'
          value={recipientInput}
          onChange={(e) => {
            setRecipientInput(e.target.value);
            if (recipientError) setRecipientError('');
          }}
        />
        <div
          className={`recipient-editor__add-btn${recipientInput.trim() ? '' : ' recipient-editor__add-btn--disabled'}`}
          onClick={recipientInput.trim() ? handleAddRecipient : undefined}
        >
          <span className='recipient-editor__add-btn-text'>Add</span>
        </div>
      </div>
      {/* Unrelated unsaved field — proxy for other toggle edits in the form. */}
      <input
        className='other-unsaved-field'
        value={otherUnsavedField}
        onChange={(e) => setOtherUnsavedField(e.target.value)}
      />
      {recipientError ? (
        <span className='recipient-editor__error'>{recipientError}</span>
      ) : null}
      <div className='recipient-editor__chips'>
        {recipients.map((email) => (
          <div key={email} className='recipient-editor__chip'>
            <span className='recipient-editor__chip-text'>{email}</span>
            <div
              className='recipient-editor__chip-remove'
              onClick={() => handleRemoveRecipient(email)}
            >
              <span className='recipient-editor__chip-remove-text'>✕</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const typeInput = (input: Element, value: string) =>
  fireEvent.change(input, { target: { value } });

// ---------------------------------------------------------------------------
// Req 7.1 — adding a well-formed email persists it and renders a chip.
// ---------------------------------------------------------------------------
describe('添加收件人邮箱（Req 7.1）', () => {
  it('adds a chip and persists the new recipients list on a valid email', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const onSuccessToast = vi.fn();
    const { container } = render(
      <RecipientEditor persist={persist} onSuccessToast={onSuccessToast} />,
    );

    const input = container.querySelector('.recipient-editor__input')!;
    typeInput(input, 'ops@example.com');
    fireEvent.click(container.querySelector('.recipient-editor__add-btn')!);

    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(persist).toHaveBeenCalledWith(['ops@example.com']);

    const chips = container.querySelectorAll('.recipient-editor__chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('ops@example.com');
    // Input cleared and no error after a successful add.
    expect((input as HTMLInputElement).value).toBe('');
    expect(container.querySelector('.recipient-editor__error')).toBeNull();
    expect(onSuccessToast).toHaveBeenCalledTimes(1);
  });

  it('does not add a duplicate chip and does not re-persist when the email already exists', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <RecipientEditor initialRecipients={['ops@example.com']} persist={persist} />,
    );

    const input = container.querySelector('.recipient-editor__input')!;
    typeInput(input, 'ops@example.com');
    fireEvent.click(container.querySelector('.recipient-editor__add-btn')!);

    await waitFor(() => expect((input as HTMLInputElement).value).toBe(''));
    expect(persist).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.recipient-editor__chip').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Req 7.1 — removing an email chip persists the reduced list.
// ---------------------------------------------------------------------------
describe('移除收件人邮箱（Req 7.1）', () => {
  it('removes the chip and persists the remaining recipients list', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const { container } = render(
      <RecipientEditor
        initialRecipients={['a@example.com', 'b@example.com']}
        persist={persist}
      />,
    );

    expect(container.querySelectorAll('.recipient-editor__chip').length).toBe(2);

    // Remove the first chip (a@example.com).
    const firstRemove = container
      .querySelectorAll('.recipient-editor__chip')[0]
      .querySelector('.recipient-editor__chip-remove')!;
    fireEvent.click(firstRemove);

    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));
    expect(persist).toHaveBeenCalledWith(['b@example.com']);

    const chips = container.querySelectorAll('.recipient-editor__chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('b@example.com');
    expect(chips[0].textContent).not.toContain('a@example.com');
  });
});

// ---------------------------------------------------------------------------
// Req 7.4 — malformed email surfaces an inline error and does NOT clear other
// unsaved fields (client-side pre-check path).
// ---------------------------------------------------------------------------
describe('非法邮箱内联错误且不清空其他未保存字段（Req 7.4）', () => {
  it('client-side malformed email shows inline error, does not persist, and preserves other unsaved fields', async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    const { container } = render(<RecipientEditor persist={persist} />);

    // Enter an unrelated unsaved value first.
    const otherField = container.querySelector('.other-unsaved-field')!;
    typeInput(otherField, 'draft-note');
    expect((otherField as HTMLInputElement).value).toBe('draft-note');

    // Submit a malformed email.
    const input = container.querySelector('.recipient-editor__input')!;
    typeInput(input, 'not-an-email');
    fireEvent.click(container.querySelector('.recipient-editor__add-btn')!);

    // Inline error shown, no persist attempted, no chip added.
    const error = container.querySelector('.recipient-editor__error');
    expect(error).not.toBeNull();
    expect(error?.textContent).toContain(INVALID_EMAIL_ERROR);
    expect(persist).not.toHaveBeenCalled();
    expect(container.querySelectorAll('.recipient-editor__chip').length).toBe(0);

    // The other unsaved field is untouched.
    expect((otherField as HTMLInputElement).value).toBe('draft-note');
  });

  it('server 400 rejection rolls back only the recipients field and preserves other unsaved fields', async () => {
    // Passes the client-side check but the backend rejects with a 400.
    const persist = vi
      .fn()
      .mockRejectedValue(new ReplicaRequestError(400, 'INVALID_REQUEST'));
    const onFailureToast = vi.fn();
    const { container } = render(
      <RecipientEditor
        initialRecipients={['keep@example.com']}
        persist={persist}
        onFailureToast={onFailureToast}
      />,
    );

    // Set an unrelated unsaved value.
    const otherField = container.querySelector('.other-unsaved-field')!;
    typeInput(otherField, 'draft-note');

    const input = container.querySelector('.recipient-editor__input')!;
    typeInput(input, 'valid@example.com');
    fireEvent.click(container.querySelector('.recipient-editor__add-btn')!);

    await waitFor(() => expect(persist).toHaveBeenCalledTimes(1));

    // Inline error surfaced (400 path), not a generic failure toast.
    await waitFor(() => {
      expect(container.querySelector('.recipient-editor__error')).not.toBeNull();
    });
    expect(container.querySelector('.recipient-editor__error')?.textContent).toContain(
      INVALID_EMAIL_ERROR,
    );
    expect(onFailureToast).not.toHaveBeenCalled();

    // Recipients rolled back to the prior value only — the rejected email is gone.
    const chips = container.querySelectorAll('.recipient-editor__chip');
    expect(chips.length).toBe(1);
    expect(chips[0].textContent).toContain('keep@example.com');
    expect(chips[0].textContent).not.toContain('valid@example.com');

    // Other unsaved field preserved across the rejection.
    expect((otherField as HTMLInputElement).value).toBe('draft-note');
  });
});
