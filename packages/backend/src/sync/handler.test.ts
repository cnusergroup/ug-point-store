import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Mocks — must be set up before importing handler
// ============================================================

vi.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: vi.fn().mockImplementation(() => ({})),
}));

const { mockDynamoSend } = vi.hoisted(() => ({
  mockDynamoSend: vi.fn(),
}));

vi.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: { from: vi.fn().mockReturnValue({ send: mockDynamoSend }) },
  GetCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'GetCommand', input })),
  PutCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'PutCommand', input })),
  QueryCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'QueryCommand', input })),
  UpdateCommand: vi.fn().mockImplementation((input: any) => ({ _type: 'UpdateCommand', input })),
}));

vi.mock('ulid', () => ({
  ulid: vi.fn(() => 'mock-ulid-' + Math.random().toString(36).slice(2, 8)),
}));

const mockScrapeFeishu = vi.fn();
vi.mock('./feishu-scraper', () => ({
  scrapeFeishuBitable: (...args: any[]) => mockScrapeFeishu(...args),
}));

const mockFetchFeishuApi = vi.fn();
vi.mock('./feishu-api', () => ({
  fetchFeishuBitableApi: (...args: any[]) => mockFetchFeishuApi(...args),
}));

const mockFetchMeetupGroupEvents = vi.fn();
vi.mock('./meetup-api', () => ({
  fetchMeetupGroupEvents: (...args: any[]) => mockFetchMeetupGroupEvents(...args),
}));

import { handler } from './handler';

// ============================================================
// Helpers
// ============================================================

/**
 * Helper to set up DynamoDB mock responses in sequence.
 * The handler reads configs via GetCommand, then does QueryCommand + PutCommand for each event.
 */
function mockGetConfig(feishuConfig: Record<string, any> | null, meetupConfig: Record<string, any> | null) {
  // The handler calls getSyncConfig (for feishu) and getMeetupSyncConfig (for meetup).
  // Both use GetCommand. We need to mock based on the key.
  mockDynamoSend.mockImplementation(async (cmd: any) => {
    if (cmd._type === 'GetCommand') {
      const key = cmd.input?.Key?.userId;
      if (key === 'activity-sync-config') {
        return { Item: feishuConfig };
      }
      if (key === 'meetup-sync-config') {
        return { Item: meetupConfig };
      }
      return { Item: null };
    }
    if (cmd._type === 'QueryCommand') {
      // dedupeKey check — default: not found (new event)
      return { Count: 0, Items: [] };
    }
    if (cmd._type === 'PutCommand') {
      return {};
    }
    if (cmd._type === 'UpdateCommand') {
      return {};
    }
    return {};
  });
}

// ============================================================
// Tests
// ============================================================

describe('Sync Lambda Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockScrapeFeishu.mockReset();
    mockFetchFeishuApi.mockReset();
    mockFetchMeetupGroupEvents.mockReset();
  });

  // ── Source Routing ──

  describe('source routing', () => {
    it('source=feishu runs only Feishu sync', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123' },
        { groups: [{ urlname: 'g1', displayName: 'G1' }], meetupToken: 't', meetupCsrf: 'c', meetupSession: 's', autoSyncEnabled: true },
      );
      mockScrapeFeishu.mockResolvedValue({ success: true, activities: [] });

      const result = await handler({ source: 'feishu' });
      const body = JSON.parse(result.body);

      expect(mockScrapeFeishu).toHaveBeenCalled();
      expect(mockFetchMeetupGroupEvents).not.toHaveBeenCalled();
      expect(body.source).toBe('feishu');
    });

    it('source=meetup runs only Meetup sync', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123' },
        {
          groups: [{ urlname: 'test-group', displayName: 'Test' }],
          meetupToken: 'tok',
          meetupCsrf: 'csrf',
          meetupSession: 'sess',
          autoSyncEnabled: true,
        },
      );
      mockFetchMeetupGroupEvents.mockResolvedValue({ success: true, events: [] });

      const result = await handler({ source: 'meetup' });
      const body = JSON.parse(result.body);

      expect(mockScrapeFeishu).not.toHaveBeenCalled();
      expect(mockFetchFeishuApi).not.toHaveBeenCalled();
      expect(mockFetchMeetupGroupEvents).toHaveBeenCalled();
      expect(body.source).toBe('meetup');
    });

    it('source=all runs both Feishu and Meetup sync', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123' },
        {
          groups: [{ urlname: 'g1', displayName: 'G1' }],
          meetupToken: 'tok',
          meetupCsrf: 'csrf',
          meetupSession: 'sess',
          autoSyncEnabled: true,
        },
      );
      mockScrapeFeishu.mockResolvedValue({ success: true, activities: [] });
      mockFetchMeetupGroupEvents.mockResolvedValue({ success: true, events: [] });

      const result = await handler({ source: 'all' });
      const body = JSON.parse(result.body);

      expect(mockScrapeFeishu).toHaveBeenCalled();
      expect(mockFetchMeetupGroupEvents).toHaveBeenCalled();
      expect(body.source).toBe('all');
    });

    it('defaults to source=all when no source specified', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123' },
        {
          groups: [{ urlname: 'g1', displayName: 'G1' }],
          meetupToken: 'tok',
          meetupCsrf: 'csrf',
          meetupSession: 'sess',
          autoSyncEnabled: true,
        },
      );
      mockScrapeFeishu.mockResolvedValue({ success: true, activities: [] });
      mockFetchMeetupGroupEvents.mockResolvedValue({ success: true, events: [] });

      const result = await handler({});
      const body = JSON.parse(result.body);

      expect(body.source).toBe('all');
    });
  });

  // ── Config Not Found ──

  describe('config not found behavior', () => {
    it('skips Meetup sync when no meetup-sync-config exists (source=all)', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123' },
        null, // no meetup config
      );
      mockScrapeFeishu.mockResolvedValue({ success: true, activities: [] });

      const result = await handler({ source: 'all' });
      const body = JSON.parse(result.body);

      expect(mockFetchMeetupGroupEvents).not.toHaveBeenCalled();
      expect(body.success).toBe(true);
    });

    it('returns failure when source=meetup but no config exists', async () => {
      mockGetConfig(null, null);

      const result = await handler({ source: 'meetup' });
      const body = JSON.parse(result.body);

      expect(body.success).toBe(false);
      expect(body.error).toBeDefined();
    });
  });

  // ── Empty Cookies ──

  describe('empty cookies behavior', () => {
    it('skips Meetup sync when cookies are empty (source=all)', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123' },
        {
          groups: [{ urlname: 'g1', displayName: 'G1' }],
          meetupToken: '',
          meetupCsrf: '',
          meetupSession: '',
          autoSyncEnabled: true,
        },
      );
      mockScrapeFeishu.mockResolvedValue({ success: true, activities: [] });

      const result = await handler({ source: 'all' });
      const body = JSON.parse(result.body);

      expect(mockFetchMeetupGroupEvents).not.toHaveBeenCalled();
      expect(body.success).toBe(true);
      // Should have a warning about empty cookies
      expect(body.warnings).toBeDefined();
      expect(body.warnings.some((w: string) => w.toLowerCase().includes('empty') || w.toLowerCase().includes('cookie'))).toBe(true);
    });

    it('returns failure when source=meetup and cookies are empty', async () => {
      mockGetConfig(
        null,
        {
          groups: [{ urlname: 'g1', displayName: 'G1' }],
          meetupToken: '',
          meetupCsrf: '',
          meetupSession: '',
          autoSyncEnabled: true,
        },
      );

      const result = await handler({ source: 'meetup' });
      const body = JSON.parse(result.body);

      expect(body.success).toBe(false);
    });
  });

  // ── autoSyncEnabled ──

  describe('autoSyncEnabled flag', () => {
    it('skips Meetup sync when autoSyncEnabled=false and source=all', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123' },
        {
          groups: [{ urlname: 'g1', displayName: 'G1' }],
          meetupToken: 'tok',
          meetupCsrf: 'csrf',
          meetupSession: 'sess',
          autoSyncEnabled: false,
        },
      );
      mockScrapeFeishu.mockResolvedValue({ success: true, activities: [] });

      const result = await handler({ source: 'all' });
      const body = JSON.parse(result.body);

      expect(mockFetchMeetupGroupEvents).not.toHaveBeenCalled();
      expect(body.success).toBe(true);
    });

    it('runs Meetup sync when autoSyncEnabled=false but source=meetup (explicit trigger)', async () => {
      mockGetConfig(
        null,
        {
          groups: [{ urlname: 'g1', displayName: 'G1' }],
          meetupToken: 'tok',
          meetupCsrf: 'csrf',
          meetupSession: 'sess',
          autoSyncEnabled: false,
        },
      );
      mockFetchMeetupGroupEvents.mockResolvedValue({ success: true, events: [] });

      const result = await handler({ source: 'meetup' });
      const body = JSON.parse(result.body);

      expect(mockFetchMeetupGroupEvents).toHaveBeenCalled();
      expect(body.success).toBe(true);
    });
  });

  // ── Combined Result Structure ──

  describe('combined result structure', () => {
    it('returns combined syncedCount and skippedCount for source=all', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123' },
        {
          groups: [{ urlname: 'g1', displayName: 'G1' }],
          meetupToken: 'tok',
          meetupCsrf: 'csrf',
          meetupSession: 'sess',
          autoSyncEnabled: true,
        },
      );

      // Feishu returns 2 activities
      mockScrapeFeishu.mockResolvedValue({
        success: true,
        activities: [
          { activityType: '线下活动', ugName: 'UG1', topic: 'Feishu Event 1', activityDate: '2024-01-01' },
          { activityType: '线下活动', ugName: 'UG1', topic: 'Feishu Event 2', activityDate: '2024-01-02' },
        ],
      });

      // Meetup returns 1 event
      mockFetchMeetupGroupEvents.mockResolvedValue({
        success: true,
        events: [
          {
            activityType: '线下活动',
            ugName: 'G1',
            topic: 'Meetup Event 1',
            activityDate: '2024-03-01',
            dedupeKey: 'meetup#e1',
            meetupEventId: 'e1',
            meetupEventUrl: 'https://meetup.com/e1',
            meetupGoingCount: 10,
          },
        ],
      });

      const result = await handler({ source: 'all' });
      const body = JSON.parse(result.body);

      expect(body.source).toBe('all');
      expect(body.success).toBe(true);
      expect(body.syncedCount).toBe(3); // 2 feishu + 1 meetup
      expect(body.skippedCount).toBe(0);
    });
  });

  // ── Feishu record_id deduplication ──

  describe('feishu record_id deduplication', () => {
    it('uses feishu#recordId as dedupeKey when feishuRecordId is present', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123', feishuAppId: 'app1', feishuAppSecret: 'secret1' },
        null,
      );

      mockFetchFeishuApi.mockResolvedValue({
        success: true,
        activities: [
          { activityType: '线下活动', ugName: 'UG1', topic: 'Event A', activityDate: '2024-06-01', feishuRecordId: 'rec_abc123' },
        ],
      });

      const result = await handler({ source: 'feishu' });
      const body = JSON.parse(result.body);

      expect(body.success).toBe(true);
      expect(body.syncedCount).toBe(1);

      // Verify PutCommand was called with feishu# prefixed dedupeKey
      const putCalls = mockDynamoSend.mock.calls.filter((c: any) => c[0]._type === 'PutCommand');
      expect(putCalls.length).toBe(1);
      expect(putCalls[0][0].input.Item.dedupeKey).toBe('feishu#rec_abc123');
    });

    it('falls back to old dedupeKey format when feishuRecordId is absent', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123' },
        null,
      );

      mockScrapeFeishu.mockResolvedValue({
        success: true,
        activities: [
          { activityType: '线下活动', ugName: 'UG1', topic: 'Event B', activityDate: '2024-06-02' },
        ],
      });

      const result = await handler({ source: 'feishu' });
      const body = JSON.parse(result.body);

      expect(body.success).toBe(true);
      expect(body.syncedCount).toBe(1);

      // Verify PutCommand was called with old-format dedupeKey
      const putCalls = mockDynamoSend.mock.calls.filter((c: any) => c[0]._type === 'PutCommand');
      expect(putCalls.length).toBe(1);
      expect(putCalls[0][0].input.Item.dedupeKey).toBe('Event B#2024-06-02#UG1');
    });

    it('updates existing record when feishu record_id matches but fields changed', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123', feishuAppId: 'app1', feishuAppSecret: 'secret1' },
        null,
      );

      mockFetchFeishuApi.mockResolvedValue({
        success: true,
        activities: [
          { activityType: '线下活动', ugName: 'UG1', topic: 'Updated Topic', activityDate: '2024-07-01', feishuRecordId: 'rec_existing' },
        ],
      });

      // Mock: dedupeKey exists, and query returns the existing item with old values
      mockDynamoSend.mockImplementation(async (cmd: any) => {
        if (cmd._type === 'GetCommand') {
          const key = cmd.input?.Key?.userId;
          if (key === 'activity-sync-config') {
            return { Item: { feishuTableUrl: 'https://feishu.cn/table/123', feishuAppId: 'app1', feishuAppSecret: 'secret1' } };
          }
          return { Item: null };
        }
        if (cmd._type === 'QueryCommand') {
          // First query is checkDedupeKeyExists (Select: COUNT), second is the inline query for update
          if (cmd.input?.Select === 'COUNT') {
            return { Count: 1 };
          }
          // Inline query returns existing item with old topic
          return {
            Count: 1,
            Items: [{
              activityId: 'existing-id-123',
              topic: 'Old Topic',
              activityDate: '2024-07-01',
              ugName: 'UG1',
              activityType: '线下活动',
              dedupeKey: 'feishu#rec_existing',
            }],
          };
        }
        if (cmd._type === 'UpdateCommand') {
          return {};
        }
        if (cmd._type === 'PutCommand') {
          return {};
        }
        return {};
      });

      const result = await handler({ source: 'feishu' });
      const body = JSON.parse(result.body);

      expect(body.success).toBe(true);
      expect(body.syncedCount).toBe(1); // Updated counts as synced

      // Verify UpdateCommand was called (not PutCommand)
      const updateCalls = mockDynamoSend.mock.calls.filter((c: any) => c[0]._type === 'UpdateCommand');
      const putCalls = mockDynamoSend.mock.calls.filter((c: any) => c[0]._type === 'PutCommand');
      expect(updateCalls.length).toBe(1);
      expect(putCalls.length).toBe(0);
      expect(updateCalls[0][0].input.Key.activityId).toBe('existing-id-123');
      expect(updateCalls[0][0].input.ExpressionAttributeValues[':topic']).toBe('Updated Topic');
    });

    it('skips when feishu record_id matches and no fields changed', async () => {
      mockGetConfig(
        { feishuTableUrl: 'https://feishu.cn/table/123', feishuAppId: 'app1', feishuAppSecret: 'secret1' },
        null,
      );

      mockFetchFeishuApi.mockResolvedValue({
        success: true,
        activities: [
          { activityType: '线下活动', ugName: 'UG1', topic: 'Same Topic', activityDate: '2024-07-01', feishuRecordId: 'rec_unchanged' },
        ],
      });

      // Mock: dedupeKey exists, and query returns the existing item with same values
      mockDynamoSend.mockImplementation(async (cmd: any) => {
        if (cmd._type === 'GetCommand') {
          const key = cmd.input?.Key?.userId;
          if (key === 'activity-sync-config') {
            return { Item: { feishuTableUrl: 'https://feishu.cn/table/123', feishuAppId: 'app1', feishuAppSecret: 'secret1' } };
          }
          return { Item: null };
        }
        if (cmd._type === 'QueryCommand') {
          if (cmd.input?.Select === 'COUNT') {
            return { Count: 1 };
          }
          return {
            Count: 1,
            Items: [{
              activityId: 'existing-id-456',
              topic: 'Same Topic',
              activityDate: '2024-07-01',
              ugName: 'UG1',
              activityType: '线下活动',
              dedupeKey: 'feishu#rec_unchanged',
            }],
          };
        }
        if (cmd._type === 'UpdateCommand') {
          return {};
        }
        return {};
      });

      const result = await handler({ source: 'feishu' });
      const body = JSON.parse(result.body);

      expect(body.success).toBe(true);
      expect(body.syncedCount).toBe(0);
      expect(body.skippedCount).toBe(1);

      // Verify no UpdateCommand or PutCommand was called
      const updateCalls = mockDynamoSend.mock.calls.filter((c: any) => c[0]._type === 'UpdateCommand');
      const putCalls = mockDynamoSend.mock.calls.filter((c: any) => c[0]._type === 'PutCommand');
      expect(updateCalls.length).toBe(0);
      expect(putCalls.length).toBe(0);
    });
  });
});
