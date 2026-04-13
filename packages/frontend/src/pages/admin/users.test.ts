import { describe, it, expect } from 'vitest';
import { canManageUser } from './user-permissions';

describe('canManageUser', () => {
  it('returns false for Admin viewer + Admin target', () => {
    expect(canManageUser(['Admin'], ['Admin'])).toBe(false);
    expect(canManageUser(['Admin', 'Speaker'], ['Admin', 'Volunteer'])).toBe(false);
  });

  it('returns false for Admin viewer + SuperAdmin target', () => {
    expect(canManageUser(['Admin'], ['SuperAdmin'])).toBe(false);
    expect(canManageUser(['Admin', 'Speaker'], ['SuperAdmin', 'Admin'])).toBe(false);
  });

  it('returns true for SuperAdmin viewer + Admin target', () => {
    expect(canManageUser(['SuperAdmin'], ['Admin'])).toBe(true);
    expect(canManageUser(['SuperAdmin', 'Admin'], ['Admin', 'Speaker'])).toBe(true);
  });

  it('returns true for any viewer + regular user target (no admin roles)', () => {
    expect(canManageUser(['Admin'], ['Speaker', 'Volunteer'])).toBe(true);
    expect(canManageUser(['Admin', 'Speaker'], ['UserGroupLeader'])).toBe(true);
    expect(canManageUser(['SuperAdmin'], ['Speaker'])).toBe(true);
    expect(canManageUser(['Speaker'], ['Volunteer'])).toBe(true);
  });

  it('returns true for SuperAdmin viewer + SuperAdmin target', () => {
    expect(canManageUser(['SuperAdmin'], ['SuperAdmin'])).toBe(true);
  });

  it('returns true for any viewer + target with empty roles', () => {
    expect(canManageUser(['Admin'], [])).toBe(true);
    expect(canManageUser(['SuperAdmin'], [])).toBe(true);
  });
});
