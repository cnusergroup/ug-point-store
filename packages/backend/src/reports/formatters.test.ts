import { describe, it, expect } from 'vitest';
import {
  getColumnDefs,
  generateCSV,
  generateExcel,
  formatPointsDetailForExport,
  formatUGSummaryForExport,
  formatUserRankingForExport,
  formatActivitySummaryForExport,
  formatPopularProductsForExport,
  formatHotContentForExport,
  formatContentContributorsForExport,
  formatInventoryAlertForExport,
  formatTravelStatisticsForExport,
  formatInviteConversionForExport,
} from './formatters';
import type { ReportType } from './formatters';
import type {
  PointsDetailRecord,
  UGActivitySummaryRecord,
  UserRankingRecord,
  ActivitySummaryRecord,
} from './query';
import type {
  PopularProductRecord,
  HotContentRecord,
  ContentContributorRecord,
  InventoryAlertRecord,
  TravelStatisticsRecord,
  InviteConversionRecord,
} from './insight-query';

// ============================================================
// getColumnDefs
// ============================================================

describe('getColumnDefs', () => {
  it('returns correct columns for points-detail', () => {
    const cols = getColumnDefs('points-detail');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual([
      'createdAt', 'nickname', 'amount', 'type', 'source',
      'activityUG', 'activityTopic', 'targetRole', 'distributorNickname', 'isEmployee',
    ]);
    expect(cols.find(c => c.key === 'createdAt')!.label).toBe('时间');
    expect(cols.find(c => c.key === 'type')!.label).toBe('类型');
    expect(cols.find(c => c.key === 'isEmployee')!.label).toBe('是否AWS员工');
  });

  it('returns correct columns for ug-activity-summary', () => {
    const cols = getColumnDefs('ug-activity-summary');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual(['ugName', 'activityCount', 'totalPoints', 'participantCount']);
    expect(cols.find(c => c.key === 'ugName')!.label).toBe('UG名称');
  });

  it('returns correct columns for user-points-ranking', () => {
    const cols = getColumnDefs('user-points-ranking');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual(['rank', 'nickname', 'userId', 'totalEarnPoints', 'targetRole', 'isEmployee']);
    expect(cols.find(c => c.key === 'rank')!.label).toBe('排名');
    expect(cols.find(c => c.key === 'isEmployee')!.label).toBe('是否AWS员工');
  });

  it('returns correct columns for activity-points-summary', () => {
    const cols = getColumnDefs('activity-points-summary');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual([
      'activityTopic', 'activityDate', 'activityUG', 'totalPoints',
      'participantCount', 'uglCount', 'speakerCount', 'volunteerCount',
    ]);
    expect(cols.find(c => c.key === 'activityTopic')!.label).toBe('活动主题');
  });

  it('all report types return non-empty column arrays', () => {
    const types: ReportType[] = [
      'points-detail', 'ug-activity-summary',
      'user-points-ranking', 'activity-points-summary',
      'popular-products', 'hot-content',
      'content-contributors', 'inventory-alert',
      'travel-statistics', 'invite-conversion',
    ];
    for (const t of types) {
      const cols = getColumnDefs(t);
      expect(cols.length).toBeGreaterThan(0);
      // Every column has both key and label
      for (const c of cols) {
        expect(c.key).toBeTruthy();
        expect(c.label).toBeTruthy();
      }
    }
  });

  it('returns correct columns for popular-products', () => {
    const cols = getColumnDefs('popular-products');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual([
      'productName', 'productType', 'redemptionCount',
      'totalPointsSpent', 'currentStock', 'stockConsumptionRate',
    ]);
    expect(cols.find(c => c.key === 'productName')!.label).toBe('商品名称');
    expect(cols.find(c => c.key === 'stockConsumptionRate')!.label).toBe('库存消耗率');
  });

  it('returns correct columns for hot-content', () => {
    const cols = getColumnDefs('hot-content');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual([
      'title', 'uploaderNickname', 'categoryName',
      'likeCount', 'commentCount', 'reservationCount', 'engagementScore',
    ]);
    expect(cols.find(c => c.key === 'title')!.label).toBe('标题');
    expect(cols.find(c => c.key === 'engagementScore')!.label).toBe('互动总分');
  });

  it('returns correct columns for content-contributors', () => {
    const cols = getColumnDefs('content-contributors');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual([
      'rank', 'nickname', 'approvedCount', 'totalLikes', 'totalComments',
    ]);
    expect(cols.find(c => c.key === 'rank')!.label).toBe('排名');
    expect(cols.find(c => c.key === 'approvedCount')!.label).toBe('已审核通过内容数量');
  });

  it('returns correct columns for inventory-alert', () => {
    const cols = getColumnDefs('inventory-alert');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual([
      'productName', 'productType', 'currentStock', 'totalStock', 'productStatus',
    ]);
    expect(cols.find(c => c.key === 'productStatus')!.label).toBe('商品状态');
  });

  it('returns correct columns for travel-statistics', () => {
    const cols = getColumnDefs('travel-statistics');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual([
      'period', 'totalApplications', 'approvedCount',
      'rejectedCount', 'pendingCount', 'approvalRate', 'totalSponsoredAmount',
    ]);
    expect(cols.find(c => c.key === 'period')!.label).toBe('时间周期');
    expect(cols.find(c => c.key === 'approvalRate')!.label).toBe('审批通过率');
  });

  it('returns correct columns for invite-conversion', () => {
    const cols = getColumnDefs('invite-conversion');
    const keys = cols.map(c => c.key);
    expect(keys).toEqual([
      'totalInvites', 'usedCount', 'expiredCount', 'pendingCount', 'conversionRate',
    ]);
    expect(cols.find(c => c.key === 'conversionRate')!.label).toBe('转化率');
  });
});

// ============================================================
// Format functions
// ============================================================

describe('formatPointsDetailForExport', () => {
  it('formats createdAt to YYYY-MM-DD HH:mm:ss', () => {
    const records: (PointsDetailRecord & { isEmployee?: boolean })[] = [{
      recordId: 'r1',
      createdAt: '2024-03-15T10:30:45.000Z',
      userId: 'u1',
      nickname: 'Alice',
      amount: 100,
      type: 'earn',
      source: 'batch',
      activityUG: 'UG1',
      activityTopic: 'Topic1',
      activityId: 'a1',
      targetRole: 'Speaker',
      distributorNickname: 'Admin1',
    }];
    const rows = formatPointsDetailForExport(records);
    expect(rows).toHaveLength(1);
    // Should be formatted as YYYY-MM-DD HH:mm:ss
    expect(rows[0].createdAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('maps type "earn" to "获取" and "spend" to "消费"', () => {
    const earnRecord: PointsDetailRecord & { isEmployee?: boolean } = {
      recordId: 'r1', createdAt: '2024-01-01T00:00:00Z', userId: 'u1',
      nickname: 'A', amount: 10, type: 'earn', source: 's', activityUG: 'UG',
      activityTopic: 'T', activityId: 'a1', targetRole: 'Speaker', distributorNickname: 'D',
    };
    const spendRecord: PointsDetailRecord & { isEmployee?: boolean } = {
      ...earnRecord, recordId: 'r2', type: 'spend',
    };
    const rows = formatPointsDetailForExport([earnRecord, spendRecord]);
    expect(rows[0].type).toBe('获取');
    expect(rows[1].type).toBe('消费');
  });

  it('preserves all other fields correctly', () => {
    const record: PointsDetailRecord & { isEmployee?: boolean } = {
      recordId: 'r1', createdAt: '2024-06-01T12:00:00Z', userId: 'u1',
      nickname: 'Bob', amount: 50, type: 'earn', source: 'activity',
      activityUG: 'UG-Test', activityTopic: 'Test Topic', activityId: 'a1',
      targetRole: 'Volunteer', distributorNickname: 'Admin2',
    };
    const rows = formatPointsDetailForExport([record]);
    expect(rows[0].nickname).toBe('Bob');
    expect(rows[0].amount).toBe(50);
    expect(rows[0].source).toBe('activity');
    expect(rows[0].activityUG).toBe('UG-Test');
    expect(rows[0].activityTopic).toBe('Test Topic');
    expect(rows[0].targetRole).toBe('Volunteer');
    expect(rows[0].distributorNickname).toBe('Admin2');
  });

  it('maps isEmployee true to "是"', () => {
    const record: PointsDetailRecord & { isEmployee?: boolean } = {
      recordId: 'r1', createdAt: '2024-01-01T00:00:00Z', userId: 'u1',
      nickname: 'A', amount: 10, type: 'earn', source: 's', activityUG: 'UG',
      activityTopic: 'T', activityId: 'a1', targetRole: 'Speaker', distributorNickname: 'D',
      isEmployee: true,
    };
    const rows = formatPointsDetailForExport([record]);
    expect(rows[0].isEmployee).toBe('是');
  });

  it('maps isEmployee false to "否"', () => {
    const record: PointsDetailRecord & { isEmployee?: boolean } = {
      recordId: 'r1', createdAt: '2024-01-01T00:00:00Z', userId: 'u1',
      nickname: 'A', amount: 10, type: 'earn', source: 's', activityUG: 'UG',
      activityTopic: 'T', activityId: 'a1', targetRole: 'Speaker', distributorNickname: 'D',
      isEmployee: false,
    };
    const rows = formatPointsDetailForExport([record]);
    expect(rows[0].isEmployee).toBe('否');
  });

  it('maps undefined isEmployee to "否"', () => {
    const record: PointsDetailRecord & { isEmployee?: boolean } = {
      recordId: 'r1', createdAt: '2024-01-01T00:00:00Z', userId: 'u1',
      nickname: 'A', amount: 10, type: 'earn', source: 's', activityUG: 'UG',
      activityTopic: 'T', activityId: 'a1', targetRole: 'Speaker', distributorNickname: 'D',
    };
    const rows = formatPointsDetailForExport([record]);
    expect(rows[0].isEmployee).toBe('否');
  });
});

describe('formatUGSummaryForExport', () => {
  it('maps all fields correctly', () => {
    const records: UGActivitySummaryRecord[] = [{
      ugName: 'UG-Alpha', activityCount: 5, totalPoints: 200, participantCount: 15,
    }];
    const rows = formatUGSummaryForExport(records);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      ugName: 'UG-Alpha', activityCount: 5, totalPoints: 200, participantCount: 15,
    });
  });
});

describe('formatUserRankingForExport', () => {
  it('maps all fields correctly (non-employee)', () => {
    const records: (UserRankingRecord & { isEmployee?: boolean })[] = [{
      rank: 1, userId: 'u1', nickname: 'TopUser', totalEarnPoints: 999, targetRole: 'Speaker',
    }];
    const rows = formatUserRankingForExport(records);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      rank: 1, nickname: 'TopUser', userId: 'u1', totalEarnPoints: 999, targetRole: 'Speaker', isEmployee: '否',
    });
  });

  it('maps isEmployee true to "是"', () => {
    const records: (UserRankingRecord & { isEmployee?: boolean })[] = [{
      rank: 1, userId: 'u1', nickname: 'Employee', totalEarnPoints: 500, targetRole: 'Speaker', isEmployee: true,
    }];
    const rows = formatUserRankingForExport(records);
    expect(rows[0].isEmployee).toBe('是');
  });

  it('maps isEmployee false to "否"', () => {
    const records: (UserRankingRecord & { isEmployee?: boolean })[] = [{
      rank: 1, userId: 'u1', nickname: 'Community', totalEarnPoints: 500, targetRole: 'Speaker', isEmployee: false,
    }];
    const rows = formatUserRankingForExport(records);
    expect(rows[0].isEmployee).toBe('否');
  });

  it('maps undefined isEmployee to "否"', () => {
    const records: (UserRankingRecord & { isEmployee?: boolean })[] = [{
      rank: 1, userId: 'u1', nickname: 'OldUser', totalEarnPoints: 500, targetRole: 'Speaker',
    }];
    const rows = formatUserRankingForExport(records);
    expect(rows[0].isEmployee).toBe('否');
  });
});

describe('formatActivitySummaryForExport', () => {
  it('maps all fields correctly', () => {
    const records: ActivitySummaryRecord[] = [{
      activityId: 'a1', activityTopic: 'Workshop', activityDate: '2024-03-15',
      activityUG: 'UG1', totalPoints: 300, participantCount: 20,
      uglCount: 2, speakerCount: 5, volunteerCount: 13,
    }];
    const rows = formatActivitySummaryForExport(records);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      activityTopic: 'Workshop', activityDate: '2024-03-15', activityUG: 'UG1',
      totalPoints: 300, participantCount: 20, uglCount: 2, speakerCount: 5, volunteerCount: 13,
    });
  });
});

// ============================================================
// New insight report format functions
// ============================================================

describe('formatPopularProductsForExport', () => {
  it('maps productType "points" to "积分商品"', () => {
    const records: PopularProductRecord[] = [{
      productId: 'p1', productName: 'Product A', productType: 'points',
      redemptionCount: 10, totalPointsSpent: 500, currentStock: 20, stockConsumptionRate: 33.3,
    }];
    const rows = formatPopularProductsForExport(records);
    expect(rows[0].productType).toBe('积分商品');
  });

  it('maps productType "code_exclusive" to "Code 专属商品"', () => {
    const records: PopularProductRecord[] = [{
      productId: 'p2', productName: 'Product B', productType: 'code_exclusive',
      redemptionCount: 5, totalPointsSpent: 200, currentStock: 10, stockConsumptionRate: 33.3,
    }];
    const rows = formatPopularProductsForExport(records);
    expect(rows[0].productType).toBe('Code 专属商品');
  });

  it('formats stockConsumptionRate as "XX.X%"', () => {
    const records: PopularProductRecord[] = [{
      productId: 'p1', productName: 'A', productType: 'points',
      redemptionCount: 10, totalPointsSpent: 500, currentStock: 20, stockConsumptionRate: 33.3,
    }];
    const rows = formatPopularProductsForExport(records);
    expect(rows[0].stockConsumptionRate).toBe('33.3%');
  });

  it('formats 0% stockConsumptionRate correctly', () => {
    const records: PopularProductRecord[] = [{
      productId: 'p1', productName: 'A', productType: 'points',
      redemptionCount: 0, totalPointsSpent: 0, currentStock: 10, stockConsumptionRate: 0,
    }];
    const rows = formatPopularProductsForExport(records);
    expect(rows[0].stockConsumptionRate).toBe('0.0%');
  });

  it('preserves all other fields correctly', () => {
    const records: PopularProductRecord[] = [{
      productId: 'p1', productName: 'Test Product', productType: 'points',
      redemptionCount: 15, totalPointsSpent: 750, currentStock: 5, stockConsumptionRate: 75.0,
    }];
    const rows = formatPopularProductsForExport(records);
    expect(rows[0].productName).toBe('Test Product');
    expect(rows[0].redemptionCount).toBe(15);
    expect(rows[0].totalPointsSpent).toBe(750);
    expect(rows[0].currentStock).toBe(5);
  });
});

describe('formatHotContentForExport', () => {
  it('maps all fields correctly', () => {
    const records: HotContentRecord[] = [{
      contentId: 'c1', title: 'Great Article', uploaderNickname: 'Author1',
      categoryName: 'Tech', likeCount: 100, commentCount: 50,
      reservationCount: 20, engagementScore: 170,
    }];
    const rows = formatHotContentForExport(records);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      title: 'Great Article', uploaderNickname: 'Author1',
      categoryName: 'Tech', likeCount: 100, commentCount: 50,
      reservationCount: 20, engagementScore: 170,
    });
  });
});

describe('formatContentContributorsForExport', () => {
  it('maps all fields correctly', () => {
    const records: ContentContributorRecord[] = [{
      rank: 1, userId: 'u1', nickname: 'TopContributor',
      approvedCount: 25, totalLikes: 300, totalComments: 150,
    }];
    const rows = formatContentContributorsForExport(records);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      rank: 1, nickname: 'TopContributor',
      approvedCount: 25, totalLikes: 300, totalComments: 150,
    });
  });
});

describe('formatInventoryAlertForExport', () => {
  it('maps productType "points" to "积分商品"', () => {
    const records: InventoryAlertRecord[] = [{
      productId: 'p1', productName: 'Low Stock Item', productType: 'points',
      currentStock: 2, totalStock: 100, productStatus: 'active',
    }];
    const rows = formatInventoryAlertForExport(records);
    expect(rows[0].productType).toBe('积分商品');
  });

  it('maps productType "code_exclusive" to "Code 专属商品"', () => {
    const records: InventoryAlertRecord[] = [{
      productId: 'p2', productName: 'Code Item', productType: 'code_exclusive',
      currentStock: 1, totalStock: 50, productStatus: 'active',
    }];
    const rows = formatInventoryAlertForExport(records);
    expect(rows[0].productType).toBe('Code 专属商品');
  });

  it('maps productStatus "active" to "上架中"', () => {
    const records: InventoryAlertRecord[] = [{
      productId: 'p1', productName: 'A', productType: 'points',
      currentStock: 3, totalStock: 50, productStatus: 'active',
    }];
    const rows = formatInventoryAlertForExport(records);
    expect(rows[0].productStatus).toBe('上架中');
  });

  it('maps productStatus "inactive" to "已下架"', () => {
    const records: InventoryAlertRecord[] = [{
      productId: 'p1', productName: 'A', productType: 'points',
      currentStock: 0, totalStock: 50, productStatus: 'inactive',
    }];
    const rows = formatInventoryAlertForExport(records);
    expect(rows[0].productStatus).toBe('已下架');
  });

  it('preserves numeric fields correctly', () => {
    const records: InventoryAlertRecord[] = [{
      productId: 'p1', productName: 'Test', productType: 'points',
      currentStock: 3, totalStock: 100, productStatus: 'active',
    }];
    const rows = formatInventoryAlertForExport(records);
    expect(rows[0].currentStock).toBe(3);
    expect(rows[0].totalStock).toBe(100);
  });
});

describe('formatTravelStatisticsForExport', () => {
  it('formats approvalRate as "XX.X%"', () => {
    const records: TravelStatisticsRecord[] = [{
      period: '2024-03', totalApplications: 10, approvedCount: 7,
      rejectedCount: 2, pendingCount: 1, approvalRate: 70.0, totalSponsoredAmount: 35000,
    }];
    const rows = formatTravelStatisticsForExport(records);
    expect(rows[0].approvalRate).toBe('70.0%');
  });

  it('formats 0% approvalRate correctly', () => {
    const records: TravelStatisticsRecord[] = [{
      period: '2024-01', totalApplications: 0, approvedCount: 0,
      rejectedCount: 0, pendingCount: 0, approvalRate: 0, totalSponsoredAmount: 0,
    }];
    const rows = formatTravelStatisticsForExport(records);
    expect(rows[0].approvalRate).toBe('0.0%');
  });

  it('preserves all other fields correctly', () => {
    const records: TravelStatisticsRecord[] = [{
      period: '2024-Q1', totalApplications: 20, approvedCount: 15,
      rejectedCount: 3, pendingCount: 2, approvalRate: 75.0, totalSponsoredAmount: 50000,
    }];
    const rows = formatTravelStatisticsForExport(records);
    expect(rows[0].period).toBe('2024-Q1');
    expect(rows[0].totalApplications).toBe(20);
    expect(rows[0].approvedCount).toBe(15);
    expect(rows[0].rejectedCount).toBe(3);
    expect(rows[0].pendingCount).toBe(2);
    expect(rows[0].totalSponsoredAmount).toBe(50000);
  });
});

describe('formatInviteConversionForExport', () => {
  it('formats conversionRate as "XX.X%"', () => {
    const records: InviteConversionRecord[] = [{
      totalInvites: 100, usedCount: 45, expiredCount: 30,
      pendingCount: 25, conversionRate: 45.0,
    }];
    const rows = formatInviteConversionForExport(records);
    expect(rows[0].conversionRate).toBe('45.0%');
  });

  it('formats 0% conversionRate correctly', () => {
    const records: InviteConversionRecord[] = [{
      totalInvites: 0, usedCount: 0, expiredCount: 0,
      pendingCount: 0, conversionRate: 0,
    }];
    const rows = formatInviteConversionForExport(records);
    expect(rows[0].conversionRate).toBe('0.0%');
  });

  it('preserves all other fields correctly', () => {
    const records: InviteConversionRecord[] = [{
      totalInvites: 200, usedCount: 80, expiredCount: 60,
      pendingCount: 60, conversionRate: 40.0,
    }];
    const rows = formatInviteConversionForExport(records);
    expect(rows[0].totalInvites).toBe(200);
    expect(rows[0].usedCount).toBe(80);
    expect(rows[0].expiredCount).toBe(60);
    expect(rows[0].pendingCount).toBe(60);
  });
});

// ============================================================
// generateCSV
// ============================================================

describe('generateCSV', () => {
  const columns = getColumnDefs('points-detail');

  it('starts with UTF-8 BOM', () => {
    const buf = generateCSV([], columns);
    const str = buf.toString('utf-8');
    expect(str.startsWith('\uFEFF')).toBe(true);
  });

  it('header row contains Chinese column names', () => {
    const buf = generateCSV([], columns);
    const str = buf.toString('utf-8');
    const headerLine = str.replace('\uFEFF', '').split('\r\n')[0];
    expect(headerLine).toContain('时间');
    expect(headerLine).toContain('用户昵称');
    expect(headerLine).toContain('积分数额');
    expect(headerLine).toContain('类型');
    expect(headerLine).toContain('来源');
    expect(headerLine).toContain('所属UG');
    expect(headerLine).toContain('活动主题');
    expect(headerLine).toContain('目标身份');
    expect(headerLine).toContain('发放者昵称');
  });

  it('produces correct number of data rows', () => {
    const rows = [
      { createdAt: '2024-01-01', nickname: 'A', amount: 10, type: '获取', source: 's', activityUG: 'UG', activityTopic: 'T', targetRole: 'Speaker', distributorNickname: 'D' },
      { createdAt: '2024-01-02', nickname: 'B', amount: 20, type: '消费', source: 's2', activityUG: 'UG2', activityTopic: 'T2', targetRole: 'Volunteer', distributorNickname: 'D2' },
    ];
    const buf = generateCSV(rows, columns);
    const str = buf.toString('utf-8').replace('\uFEFF', '');
    const lines = str.split('\r\n').filter(l => l.length > 0);
    // 1 header + 2 data rows
    expect(lines).toHaveLength(3);
  });

  it('escapes values containing commas', () => {
    const rows = [{ createdAt: 'date,with,commas', nickname: 'N', amount: 1, type: 'T', source: 'S', activityUG: 'U', activityTopic: 'T', targetRole: 'R', distributorNickname: 'D' }];
    const buf = generateCSV(rows, columns);
    const str = buf.toString('utf-8');
    // Value with commas should be wrapped in double quotes
    expect(str).toContain('"date,with,commas"');
  });

  it('escapes values containing double quotes', () => {
    const rows = [{ createdAt: 'has"quote', nickname: 'N', amount: 1, type: 'T', source: 'S', activityUG: 'U', activityTopic: 'T', targetRole: 'R', distributorNickname: 'D' }];
    const buf = generateCSV(rows, columns);
    const str = buf.toString('utf-8');
    // Double quotes should be escaped by doubling
    expect(str).toContain('"has""quote"');
  });

  it('works with all report types', () => {
    const types: ReportType[] = [
      'points-detail', 'ug-activity-summary', 'user-points-ranking', 'activity-points-summary',
      'popular-products', 'hot-content', 'content-contributors', 'inventory-alert',
      'travel-statistics', 'invite-conversion',
    ];
    for (const t of types) {
      const cols = getColumnDefs(t);
      const buf = generateCSV([], cols);
      const str = buf.toString('utf-8');
      expect(str.startsWith('\uFEFF')).toBe(true);
      // Header should have correct number of columns
      const headerLine = str.replace('\uFEFF', '').split('\r\n')[0];
      const headerCols = headerLine.split(',');
      expect(headerCols).toHaveLength(cols.length);
    }
  });
});

// ============================================================
// generateExcel
// ============================================================

describe('generateExcel', () => {
  it('returns a Buffer', () => {
    const columns = getColumnDefs('points-detail');
    const buf = generateExcel([], columns);
    expect(Buffer.isBuffer(buf)).toBe(true);
  });

  it('returns a non-empty Buffer even with no data rows', () => {
    const columns = getColumnDefs('ug-activity-summary');
    const buf = generateExcel([], columns);
    expect(buf.length).toBeGreaterThan(0);
  });

  it('returns a valid xlsx Buffer with data rows', () => {
    const columns = getColumnDefs('user-points-ranking');
    const rows = [
      { rank: 1, nickname: 'User1', userId: 'u1', totalEarnPoints: 500, targetRole: 'Speaker' },
    ];
    const buf = generateExcel(rows, columns);
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
    // xlsx files start with PK zip signature (50 4B)
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4B);
  });

  it('works with all report types', () => {
    const types: ReportType[] = [
      'points-detail', 'ug-activity-summary', 'user-points-ranking', 'activity-points-summary',
      'popular-products', 'hot-content', 'content-contributors', 'inventory-alert',
      'travel-statistics', 'invite-conversion',
    ];
    for (const t of types) {
      const cols = getColumnDefs(t);
      const buf = generateExcel([], cols);
      expect(Buffer.isBuffer(buf)).toBe(true);
      expect(buf.length).toBeGreaterThan(0);
    }
  });

  it('accepts custom sheet name', () => {
    const columns = getColumnDefs('points-detail');
    const buf = generateExcel([], columns, '自定义名称');
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.length).toBeGreaterThan(0);
  });
});
