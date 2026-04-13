# Design Document: SuperAdmin Settings

## Overview

This feature adds two SuperAdmin-exclusive sections to the **existing** admin settings page (`/pages/admin/settings`):

1. **SuperAdmin Transfer** — A password-confirmed workflow that atomically swaps the SuperAdmin role from the current holder to a chosen Admin user, ensuring exactly one SuperAdmin exists at all times.
2. **Invite Link Expiry Configuration** — A global setting (stored in DynamoDB) that controls the default expiry duration for all invite links. SuperAdmin sets it once; all Admin users who generate invites automatically use the configured value.

No new pages or menu items are created. Both features are added as new sections in the existing settings page, visible only to SuperAdmin.

### Key Design Decisions

- **DynamoDB TransactWriteItems** for the role swap: guarantees atomicity — both user records update or neither does.
- **Password verification reuse**: the transfer endpoint reuses `bcryptjs.compare` from the login flow.
- **Invite expiry as global config**: stored in the Users table under key `invite-settings` (same pattern as `feature-toggles` and `travel-sponsorship`). Backend reads it at invite generation time — no per-request parameter needed.
- **No new DynamoDB tables**: all changes operate on the existing Users and Invites tables.
- **No new frontend pages or menu items**: both features are sections in the existing `/pages/admin/settings` page.

## Architecture

### SuperAdmin Transfer Flow

```
SuperAdmin selects target Admin → enters password → submits
→ POST /api/admin/superadmin/transfer {targetUserId, password}
→ Backend: fetch caller (verify SuperAdmin + password) → fetch target (verify Admin)
→ DynamoDB TransactWriteItems: demote caller + promote target (atomic)
→ Frontend: update local store roles → show success → redirect to dashboard
```

### Invite Expiry Flow

```
SuperAdmin selects 1/3/7 days in settings page
→ PUT /api/admin/settings/invite-settings {inviteExpiryDays: 3}
→ DynamoDB PutCommand: {userId: 'invite-settings', inviteExpiryDays: 3}

Admin generates invites
→ POST /api/admin/invites/batch {count, roles}
→ Backend: GetCommand {userId: 'invite-settings'} → read inviteExpiryDays (default 1)
→ expiresAt = now + inviteExpiryDays * 86400000
```

## Components and Interfaces

### Backend Components

#### 1. New Module: `packages/backend/src/admin/superadmin-transfer.ts`

```typescript
export interface TransferSuperAdminInput {
  callerId: string;
  targetUserId: string;
  password: string;
}

export interface TransferSuperAdminResult {
  success: boolean;
  error?: { code: string; message: string };
}

export async function transferSuperAdmin(
  input: TransferSuperAdminInput,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<TransferSuperAdminResult>;
```

Flow:
1. Fetch caller record → verify SuperAdmin role → `bcryptjs.compare(password, passwordHash)`
2. Fetch target record → verify Admin role → verify target ≠ caller
3. `TransactWriteItems`: demote caller (remove SuperAdmin, ensure Admin), promote target (add SuperAdmin)
4. Update `rolesVersion` (ms timestamp) and `updatedAt` on both records

#### 2. New Module: `packages/backend/src/settings/invite-settings.ts`

```typescript
export interface InviteSettings {
  inviteExpiryDays: 1 | 3 | 7;
}

const ALLOWED_EXPIRY_DAYS = [1, 3, 7] as const;
const INVITE_SETTINGS_KEY = 'invite-settings';
const DEFAULT_EXPIRY_DAYS = 1;

export async function getInviteSettings(
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<InviteSettings>;

export async function updateInviteSettings(
  inviteExpiryDays: number,
  updatedBy: string,
  dynamoClient: DynamoDBDocumentClient,
  usersTable: string,
): Promise<{ success: boolean; error?: { code: string; message: string } }>;
```

#### 3. Modified: `packages/backend/src/auth/invite.ts`

`createInviteRecord` reads the global expiry setting instead of using a hardcoded value. Since `createInviteRecord` doesn't have access to DynamoDB directly in all call paths, the expiry is passed as an optional parameter (resolved by the handler before calling):

```typescript
export async function createInviteRecord(
  roles: UserRole[],
  dynamoClient: DynamoDBDocumentClient,
  invitesTable: string,
  registerBaseUrl: string,
  expiryMs?: number,  // resolved from invite-settings by handler; defaults to 86400000
): Promise<CreateInviteResult>;
```

#### 4. Modified: `packages/backend/src/admin/invites.ts`

```typescript
export async function batchGenerateInvites(
  count: number,
  roles: UserRole[],
  dynamoClient: DynamoDBDocumentClient,
  invitesTable: string,
  registerBaseUrl: string,
  expiryMs?: number,  // passed from handler after reading invite-settings
): Promise<BatchGenerateInvitesResult>;
```

#### 5. Modified: `packages/backend/src/admin/handler.ts`

New routes:
```typescript
// POST /api/admin/superadmin/transfer — SuperAdmin only
if (method === 'POST' && path === '/api/admin/superadmin/transfer') {
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse('FORBIDDEN', '需要超级管理员权限', 403);
  }
  return await handleTransferSuperAdmin(event);
}

// PUT /api/admin/settings/invite-settings — SuperAdmin only
if (method === 'PUT' && path === '/api/admin/settings/invite-settings') {
  if (!isSuperAdmin(event.user.roles as UserRole[])) {
    return errorResponse('FORBIDDEN', '需要超级管理员权限', 403);
  }
  return await handleUpdateInviteSettings(event);
}
```

Modified `handleBatchGenerateInvites`: reads `invite-settings` before calling `batchGenerateInvites`:
```typescript
async function handleBatchGenerateInvites(event): Promise<APIGatewayProxyResult> {
  // ... existing validation ...
  const inviteSettings = await getInviteSettings(dynamoClient, USERS_TABLE);
  const expiryMs = inviteSettings.inviteExpiryDays * 86400000;
  const result = await batchGenerateInvites(count, roles, dynamoClient, INVITES_TABLE, REGISTER_BASE_URL, expiryMs);
  // ...
}
```

Also add GET route for reading invite settings (used by settings page on load):
```typescript
// GET /api/settings/invite-settings — public (no auth needed, same as feature-toggles)
```

This is in the public settings handler, not the admin handler.

#### 6. Modified: `packages/backend/src/settings/handler.ts` (public settings)

Add GET endpoint for invite settings (readable without auth, like feature-toggles):
```typescript
if (method === 'GET' && path === '/api/settings/invite-settings') {
  const settings = await getInviteSettings(dynamoClient, USERS_TABLE);
  return jsonResponse(200, settings);
}
```

### Frontend Components

#### 7. Modified: `packages/frontend/src/pages/admin/settings.tsx`

Add two new sections at the bottom of the settings page, visible only to SuperAdmin:

**Invite Expiry Section:**
```typescript
// New state
const [inviteSettings, setInviteSettings] = useState<{ inviteExpiryDays: 1 | 3 | 7 }>({ inviteExpiryDays: 1 });

// Fetch on mount (alongside existing settings)
const res = await request<{ inviteExpiryDays: number }>({ url: '/api/settings/invite-settings', skipAuth: true });

// Three option buttons: 1 day / 3 days / 7 days
// On click: PUT /api/admin/settings/invite-settings {inviteExpiryDays}
```

**SuperAdmin Transfer Section:**
```typescript
// New state
const [adminUsers, setAdminUsers] = useState<UserListItem[]>([]);
const [selectedTarget, setSelectedTarget] = useState<string | null>(null);
const [transferPassword, setTransferPassword] = useState('');
const [transferring, setTransferring] = useState(false);
const [transferError, setTransferError] = useState('');

// Fetch Admin users on mount (only if isSuperAdmin)
// POST /api/admin/superadmin/transfer {targetUserId, password}
// On success: update store roles, show success, redirect to dashboard
```

Both sections are conditionally rendered: `{isSuperAdmin && <View>...</View>}`

#### 8. Modified: `packages/frontend/src/i18n/types.ts`

Add new keys under `admin.settings`:
```typescript
// Invite expiry section
inviteExpiryTitle: string;
inviteExpiryDesc: string;
inviteExpiryDays1: string;
inviteExpiryDays3: string;
inviteExpiryDays7: string;

// SuperAdmin transfer section
transferTitle: string;
transferDesc: string;
selectTargetLabel: string;
noEligibleTargets: string;
passwordLabel: string;
passwordPlaceholder: string;
confirmTransfer: string;
transferring: string;
transferSuccess: string;
errorPasswordRequired: string;
errorSelectTarget: string;
errorPasswordIncorrect: string;
errorTargetNotAdmin: string;
errorTargetNotFound: string;
```

### API Contracts

#### POST /api/admin/superadmin/transfer

**Auth**: Required (SuperAdmin only)

**Request Body**:
```json
{ "targetUserId": "string", "password": "string" }
```

**Success Response** (200): `{ "success": true }`

**Error Responses**:
| Code | HTTP | Condition |
|------|------|-----------|
| `FORBIDDEN` | 403 | Caller is not SuperAdmin |
| `INVALID_CURRENT_PASSWORD` | 400 | Password verification failed |
| `TRANSFER_TARGET_NOT_FOUND` | 404 | Target userId does not exist |
| `TRANSFER_TARGET_NOT_ADMIN` | 400 | Target does not hold Admin role |
| `TRANSFER_TARGET_IS_SELF` | 400 | Target is the caller |

#### PUT /api/admin/settings/invite-settings

**Auth**: Required (SuperAdmin only)

**Request Body**:
```json
{ "inviteExpiryDays": 3 }
```

**Success Response** (200): `{ "inviteExpiryDays": 3 }`

**Error**: `INVALID_EXPIRY_VALUE` (400) if `inviteExpiryDays` not in {1, 3, 7}

#### GET /api/settings/invite-settings (public)

**Response** (200): `{ "inviteExpiryDays": 1 }`

## Data Models

### Users Table — New Record: `invite-settings`

```
{ userId: 'invite-settings', inviteExpiryDays: 1 | 3 | 7, updatedAt: string, updatedBy: string }
```

Default (when record absent): `inviteExpiryDays = 1`

### Users Table — Transfer Modifications

Two existing user records updated atomically via `TransactWriteItems`:

| Field | Caller (former SuperAdmin) | Target (new SuperAdmin) |
|-------|---------------------------|------------------------|
| `roles` | Remove `SuperAdmin`, ensure `Admin` | Add `SuperAdmin` |
| `rolesVersion` | `Date.now()` | `Date.now()` |
| `updatedAt` | `new Date().toISOString()` | `new Date().toISOString()` |

**ConditionExpression** on each item:
- Caller: `contains(#roles, :superAdmin)` — ensures caller still has SuperAdmin at execution time
- Target: `contains(#roles, :admin)` — ensures target still has Admin at execution time

## Correctness Properties

### Property 1: Incorrect passwords are always rejected

For any string that does not match the caller's bcrypt password hash, the transfer API SHALL reject with `INVALID_CURRENT_PASSWORD` and leave both user records unchanged.

**Validates: Requirements 2.5**

### Property 2: Valid transfer correctly swaps roles and updates metadata

For any valid SuperAdmin caller and Admin target, after a successful transfer: (a) caller's roles contain `Admin` and NOT `SuperAdmin`, (b) caller's other roles are preserved, (c) target's roles contain `SuperAdmin`, (d) both `rolesVersion` values increased, (e) both `updatedAt` values updated.

**Validates: Requirements 3.1, 3.2, 3.4**

### Property 3: Invalid transfer targets are rejected

For any target that doesn't exist or lacks Admin role, the transfer API SHALL reject with the appropriate error and leave all records unchanged.

**Validates: Requirements 3.5**

### Property 4: Valid inviteExpiryDays produces correct expiresAt

For any value in {1, 3, 7}, when used to compute `expiresAt`, the result SHALL equal `createdAt + inviteExpiryDays * 86400000` (within execution time tolerance).

**Validates: Requirements 6.1**

### Property 5: Invalid inviteExpiryDays values are rejected

For any numeric value NOT in {1, 3, 7}, the update invite settings API SHALL reject with `INVALID_EXPIRY_VALUE` and leave the stored setting unchanged.

**Validates: Requirements 5.5**

## Error Handling

| Error Code | HTTP | Trigger |
|------------|------|---------|
| `FORBIDDEN` | 403 | Non-SuperAdmin caller on SuperAdmin-only routes |
| `INVALID_CURRENT_PASSWORD` | 400 | bcrypt.compare returns false |
| `TRANSFER_TARGET_IS_SELF` | 400 | targetUserId === callerId |
| `TRANSFER_TARGET_NOT_FOUND` | 404 | Target user record not found |
| `TRANSFER_TARGET_NOT_ADMIN` | 400 | Target lacks Admin role |
| `INVALID_EXPIRY_VALUE` | 400 | inviteExpiryDays not in {1, 3, 7} |
| `TransactionCanceledException` | 500 | DynamoDB transaction conflict — return retry error |
