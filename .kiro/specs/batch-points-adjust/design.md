# Design Document: Distribution Deletion via Full Recipient Removal

## Overview

This design covers the extension of the existing batch-points-adjust feature to support **Distribution Deletion** — the ability for a SuperAdmin to fully undo a distribution by removing all recipients. When the adjusted `recipientIds` list is empty, the system treats the request as a deletion: reversing all awarded points (including skill-claim points), writing correction records for audit trail, and hard-deleting the `Distribution_Record`.

The existing adjustment flow (Requirements 1–12) is already implemented. This design focuses exclusively on:
- Revised validation logic in `validateAdjustmentInput` (Requirement 10.1, 10.6)
- The deletion execution flow (Requirement 13)
- Frontend changes to allow zero-recipient submission with a distinct confirmation dialog

## Architecture

The deletion flow reuses the existing `POST /api/admin/batch-points/{distributionId}/adjust` endpoint. The routing decision happens inside `validateAdjustmentInput`:

```mermaid
flowchart TD
    A[POST /adjust with recipientIds=[]] --> B{validateAdjustmentInput}
    B -->|recipientIds empty| C[Skip speakerType/volunteer/NO_CHANGES checks]
    C --> D[Return valid: true, isDeletion: true]
    D --> E[executeDeletion flow]
    E --> F[Fetch skill claims for activity]
    F --> G[Pre-check: all users have sufficient balance]
    G -->|Any user insufficient| H[Return INSUFFICIENT_BALANCE]
    G -->|All OK| I[Build reversal transaction batches]
    I --> J[Execute batches sequentially]
    J -->|Any batch fails| K[Return ADJUSTMENT_FAILED]
    J -->|All succeed| L[Hard-delete Distribution_Record]
    L --> M[Return success with distributionId + reversedCount]
```

The frontend detects `selectedIds.size === 0` to switch into "deletion mode", showing a distinct confirmation dialog and allowing submission.

## Components and Interfaces

### Backend Changes

#### 1. `validateAdjustmentInput` (modified)

```typescript
export type AdjustmentValidationResult =
  | { valid: true; isDeletion?: boolean }
  | { valid: false; error: { code: string; message: string } };

export function validateAdjustmentInput(
  original: DistributionRecord,
  input: AdjustmentInput,
  config: PointsRuleConfig,
): AdjustmentValidationResult {
  // NEW: Empty recipientIds → deletion mode, skip all other validations
  if (!input.recipientIds || input.recipientIds.length === 0) {
    return { valid: true, isDeletion: true };
  }

  // ... existing validation logic unchanged ...
}
```

#### 2. `executeDeletion` (new function)

```typescript
export interface DeletionResult {
  success: boolean;
  deleted?: boolean;
  distributionId?: string;
  reversedCount?: number;
  error?: { code: string; message: string };
}

export async function executeDeletion(
  input: AdjustmentInput,
  original: DistributionRecord,
  client: DynamoDBDocumentClient,
  tables: {
    usersTable: string;
    pointsRecordsTable: string;
    batchDistributionsTable: string;
    activitySkillClaimsTable?: string;
  },
): Promise<DeletionResult>;
```

#### 3. `executeAdjustment` (modified routing)

After validation returns `{ valid: true, isDeletion: true }`, `executeAdjustment` delegates to `executeDeletion` instead of the normal diff-based flow.

#### 4. `AdjustmentResult` (extended)

```typescript
export interface AdjustmentResult {
  success: boolean;
  deleted?: boolean;
  distributionId?: string;
  reversedCount?: number;
  error?: { code: string; message: string };
}
```

#### 5. Handler response change

When `result.deleted === true`, the handler returns:
```json
{
  "message": "发放记录已删除",
  "deleted": true,
  "distributionId": "dist-xxx",
  "reversedCount": 5
}
```

### Frontend Changes

#### `batch-adjust.tsx` modifications:

1. **`canSubmit` logic**: Allow submission when `selectedIds.size === 0` (deletion mode)
2. **`isDeletionMode` computed**: `selectedIds.size === 0 && originalRecord !== null`
3. **Distinct confirmation dialog**: When `isDeletionMode`, show a red-themed dialog with deletion-specific messaging
4. **`handleSubmit`**: Send `recipientIds: []` when in deletion mode
5. **Success handling**: On `response.deleted === true`, show deletion-specific toast and navigate back

## Data Models

### Transaction Items per User (Deletion)

Each removed user generates 2 transaction items:
1. **Update User_Record**: Decrease `points`, `earnTotal`, and role-specific field by `originalPoints`
2. **Put Correction_Record**: `type: 'adjust'`, `amount: -originalPoints`, `source: '发放删除:...'`

### Transaction Items per Skill Claim (Deletion)

Each skill claim tied to the distribution generates 3 transaction items:
1. **Delete SkillClaim_Record**: Remove from `PointsMall-ActivitySkillClaims`
2. **Update User_Record**: Decrease `points`, `earnTotal`, `earnTotalLeader` by `pointsAwarded`
3. **Put Correction_Record**: `type: 'adjust'`, `amount: -pointsAwarded`, `source: '技能释放(删除):...'`

### Batch Sizing

- Each user = 2 items → 12 users per batch (24 items, within 25 limit)
- Each skill claim = 3 items
- Skill claim items are prepended to the first user batch
- If skill items alone exceed capacity, they get their own batch(es)
- Final step: `DeleteCommand` on `PointsMall-BatchDistributions` (separate from transaction batches)

### Hard-Delete of Distribution_Record

After all user/skill batches succeed, a standalone `DeleteCommand` removes the Distribution_Record:
```typescript
await client.send(new DeleteCommand({
  TableName: tables.batchDistributionsTable,
  Key: { distributionId: input.distributionId },
}));
```

This is consistent with the hard-delete pattern used elsewhere in the system (e.g., code deletion, invite revocation).

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Empty recipientIds bypasses non-deletion validations and enters deletion flow

*For any* valid `DistributionRecord` (of any `targetRole` including Speaker without `speakerType` in the input), when `validateAdjustmentInput` is called with an empty `recipientIds` array, the result SHALL be `{ valid: true, isDeletion: true }` — never `INVALID_REQUEST`, `VOLUNTEER_LIMIT_EXCEEDED`, or `NO_CHANGES`.

**Validates: Requirements 10.1, 10.6**

### Property 2: Deletion reverses exactly originalPoints for every original recipient

*For any* `DistributionRecord` with N recipients and per-person `points` value P, executing a deletion SHALL produce exactly N user balance updates, each decreasing `points`, `earnTotal`, and the role-specific earned total field by P.

**Validates: Requirements 13.1, 13.2**

### Property 3: Skill claims tied to the distribution are fully reversed and removed

*For any* `DistributionRecord` with associated skill claims, executing a deletion SHALL reverse each skill claim's `pointsAwarded` from the claiming user's `points`, `earnTotal`, and `earnTotalLeader`, and SHALL delete the skill-claim record from the `ActivitySkillClaims` table.

**Validates: Requirements 13.3**

### Property 4: Correction records preserve the audit trail without deleting existing records

*For any* deletion of a distribution with N recipients (plus M skill claims), the system SHALL write exactly N + M correction records with `type: 'adjust'` and negative amounts into the `PointsRecords` table, and SHALL never issue a Delete operation against the `PointsRecords` table.

**Validates: Requirements 13.4, 13.5**

### Property 5: Transaction batches never exceed 25 items

*For any* deletion involving K total transaction items (2 per user + 3 per skill claim), each `TransactWriteCommand` batch SHALL contain at most 25 items.

**Validates: Requirements 13.6**

### Property 6: Insufficient balance pre-check rejects before any write

*For any* distribution deletion where at least one original recipient's current `points` balance is less than the reversal amount (originalPoints + any skill-claim pointsAwarded for that user), the system SHALL return `INSUFFICIENT_BALANCE` without executing any `TransactWriteCommand`.

**Validates: Requirements 13.9**

### Property 7: Successful deletion response includes distributionId and reversedCount

*For any* successful distribution deletion, the returned result SHALL contain `deleted: true`, the original `distributionId`, and `reversedCount` equal to the number of original recipients whose points were reversed.

**Validates: Requirements 13.14**

## Error Handling

| Scenario | Error Code | HTTP Status | Behavior |
|----------|-----------|-------------|----------|
| Any user's balance insufficient for reversal | `INSUFFICIENT_BALANCE` | 400 | Pre-check before any writes; no state changes |
| Transaction batch fails (DynamoDB error) | `ADJUSTMENT_FAILED` | 500 | Stop processing further batches; Distribution_Record remains |
| Distribution_Record not found | `DISTRIBUTION_NOT_FOUND` | 404 | Early return before deletion logic |
| Non-SuperAdmin caller | `FORBIDDEN` | 403 | Rejected at handler level (existing gate) |
| Hard-delete of Distribution_Record fails | `ADJUSTMENT_FAILED` | 500 | User reversals already committed; Distribution_Record remains (partial state — acceptable since points are already corrected) |

### Partial Failure Consideration

If user reversal batches succeed but the final `DeleteCommand` for the Distribution_Record fails, the system is in a state where points are reversed but the distribution record still exists. This is acceptable because:
1. The correction records document what happened
2. A retry of the deletion would hit `INSUFFICIENT_BALANCE` (balances already reversed) — so the admin can manually delete the record or the system can be enhanced with idempotency later
3. This matches the existing pattern where `executeAdjustment` updates the Distribution_Record as a separate step after user batches

## Testing Strategy

### Unit Tests (example-based)

- `validateAdjustmentInput` returns `{ valid: true, isDeletion: true }` for empty recipientIds
- `executeDeletion` returns `INSUFFICIENT_BALANCE` when a user has insufficient balance
- `executeDeletion` returns `ADJUSTMENT_FAILED` when a transaction batch fails (mocked)
- `executeDeletion` hard-deletes the Distribution_Record after successful batches
- Handler returns `{ deleted: true, distributionId, reversedCount }` for successful deletion
- Frontend `isDeletionMode` computed correctly when selectedIds is empty
- Frontend shows distinct deletion confirmation dialog

### Property-Based Tests (fast-check, minimum 100 iterations)

Property-based testing is appropriate here because the deletion logic operates over distributions with varying numbers of recipients, varying roles, varying skill claims, and varying user balances — a large input space where universal properties must hold.

**Library**: `fast-check` (already used in the project)

**Configuration**: Each property test runs minimum 100 iterations.

**Tag format**: `Feature: batch-points-adjust, Property {N}: {description}`

Tests to implement:
1. **Property 1**: Generate random DistributionRecords (any role, any speakerType), call `validateAdjustmentInput` with empty recipientIds → always returns `{ valid: true, isDeletion: true }`
2. **Property 2**: Generate random distributions with 1–20 recipients, execute deletion with mocked DynamoDB → verify exactly N Update commands with delta = -originalPoints
3. **Property 3**: Generate distributions with 0–3 skill claims, execute deletion → verify skill claim Delete + user Update + correction Put for each claim
4. **Property 4**: Generate deletions of varying sizes → verify correction record count = N users + M skill claims, no Delete on PointsRecords table
5. **Property 5**: Generate distributions with 1–50 recipients and 0–3 skill claims → verify all transaction batches ≤ 25 items
6. **Property 6**: Generate distributions where at least one user has balance < originalPoints → verify INSUFFICIENT_BALANCE returned and zero TransactWriteCommands sent
7. **Property 7**: Generate successful deletions → verify response shape contains `deleted: true`, correct `distributionId`, and `reversedCount === originalRecipientIds.length`
