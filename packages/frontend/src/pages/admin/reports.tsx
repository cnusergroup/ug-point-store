import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, Picker } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { request, RequestError } from '../../utils/request';
import { goBack } from '../../utils/navigation';
import { useTranslation } from '../../i18n';
import { useSuperAdminGuard } from '../../hooks/useSuperAdminGuard';
import { ClockIcon } from '../../components/icons';
import './reports.scss';

/* ─── Types ─────────────────────────────────────────────── */

type ReportTab = 'points-detail' | 'ug-activity' | 'user-ranking' | 'activity-summary'
  | 'popular-products' | 'hot-content' | 'content-contributors' | 'inventory-alert' | 'travel-statistics' | 'invite-conversion';

interface TabFilterState {
  'points-detail': {
    startDate: string;
    endDate: string;
    ugName: string;
    targetRole: string;
    activityId: string;
    type: string;
  };
  'ug-activity': {
    startDate: string;
    endDate: string;
  };
  'user-ranking': {
    startDate: string;
    endDate: string;
    targetRole: string;
  };
  'activity-summary': {
    startDate: string;
    endDate: string;
    ugName: string;
  };
  'popular-products': {
    startDate: string;
    endDate: string;
    productType: string;
  };
  'hot-content': {
    startDate: string;
    endDate: string;
    categoryId: string;
  };
  'content-contributors': {
    startDate: string;
    endDate: string;
  };
  'inventory-alert': {
    stockThreshold: string;
    productType: string;
    productStatus: string;
  };
  'travel-statistics': {
    startDate: string;
    endDate: string;
    periodType: string;
    category: string;
  };
  'invite-conversion': {
    startDate: string;
    endDate: string;
  };
}

interface PointsDetailRecord {
  recordId: string;
  createdAt: string;
  userId: string;
  nickname: string;
  amount: number;
  type: 'earn' | 'spend';
  source: string;
  activityUG: string;
  activityTopic: string;
  activityId: string;
  targetRole: string;
  distributorNickname: string;
}

interface UGActivitySummaryRecord {
  ugName: string;
  activityCount: number;
  totalPoints: number;
  participantCount: number;
}

interface UserRankingRecord {
  rank: number;
  userId: string;
  nickname: string;
  totalEarnPoints: number;
  targetRole: string;
}

interface ActivitySummaryRecord {
  activityId: string;
  activityTopic: string;
  activityDate: string;
  activityUG: string;
  totalPoints: number;
  participantCount: number;
  uglCount: number;
  speakerCount: number;
  volunteerCount: number;
}

interface PopularProductRecord {
  productId: string;
  productName: string;
  productType: 'points' | 'code_exclusive';
  redemptionCount: number;
  totalPointsSpent: number;
  currentStock: number;
  stockConsumptionRate: number;
}

interface HotContentRecord {
  contentId: string;
  title: string;
  uploaderNickname: string;
  categoryName: string;
  likeCount: number;
  commentCount: number;
  reservationCount: number;
  engagementScore: number;
}

interface ContentContributorRecord {
  rank: number;
  userId: string;
  nickname: string;
  approvedCount: number;
  totalLikes: number;
  totalComments: number;
}

interface InventoryAlertRecord {
  productId: string;
  productName: string;
  productType: 'points' | 'code_exclusive';
  currentStock: number;
  totalStock: number;
  productStatus: 'active' | 'inactive';
}

interface TravelStatisticsRecord {
  period: string;
  totalApplications: number;
  approvedCount: number;
  rejectedCount: number;
  pendingCount: number;
  approvalRate: number;
  totalSponsoredAmount: number;
}

interface InviteConversionRecord {
  totalInvites: number;
  usedCount: number;
  expiredCount: number;
  pendingCount: number;
  conversionRate: number;
}

interface UGOption {
  ugId: string;
  ugName: string;
}

interface ActivityOption {
  activityId: string;
  topic: string;
}

interface CategoryOption {
  categoryId: string;
  name: string;
}

/* ─── Helpers ───────────────────────────────────────────── */

const REPORT_TABS: { key: ReportTab; labelKey: string }[] = [
  { key: 'points-detail', labelKey: 'admin.reports.tabPointsDetail' },
  { key: 'ug-activity', labelKey: 'admin.reports.tabUGActivity' },
  { key: 'user-ranking', labelKey: 'admin.reports.tabUserRanking' },
  { key: 'activity-summary', labelKey: 'admin.reports.tabActivitySummary' },
  { key: 'popular-products', labelKey: 'admin.reports.tabPopularProducts' },
  { key: 'hot-content', labelKey: 'admin.reports.tabHotContent' },
  { key: 'content-contributors', labelKey: 'admin.reports.tabContentContributors' },
  { key: 'inventory-alert', labelKey: 'admin.reports.tabInventoryAlert' },
  { key: 'travel-statistics', labelKey: 'admin.reports.tabTravelStatistics' },
  { key: 'invite-conversion', labelKey: 'admin.reports.tabInviteConversion' },
];

const ROLE_OPTIONS = ['UserGroupLeader', 'Speaker', 'Volunteer'];
const TYPE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'all', labelKey: 'admin.reports.filterTypeAll' },
  { value: 'earn', labelKey: 'admin.reports.filterTypeEarn' },
  { value: 'spend', labelKey: 'admin.reports.filterTypeSpend' },
];

const PRODUCT_TYPE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'all', labelKey: 'admin.reports.filterProductTypeAll' },
  { value: 'points', labelKey: 'admin.reports.filterProductTypePoints' },
  { value: 'code_exclusive', labelKey: 'admin.reports.filterProductTypeCodeExclusive' },
];

const PRODUCT_STATUS_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'all', labelKey: 'admin.reports.filterProductStatusAll' },
  { value: 'active', labelKey: 'admin.reports.filterProductStatusActive' },
  { value: 'inactive', labelKey: 'admin.reports.filterProductStatusInactive' },
];

const PERIOD_TYPE_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'month', labelKey: 'admin.reports.filterPeriodTypeMonth' },
  { value: 'quarter', labelKey: 'admin.reports.filterPeriodTypeQuarter' },
];

const TRAVEL_CATEGORY_OPTIONS: { value: string; labelKey: string }[] = [
  { value: 'all', labelKey: 'admin.reports.filterTravelCategoryAll' },
  { value: 'domestic', labelKey: 'admin.reports.filterTravelCategoryDomestic' },
  { value: 'international', labelKey: 'admin.reports.filterTravelCategoryInternational' },
];

function getDefaultFilters(): TabFilterState {
  return {
    'points-detail': { startDate: '', endDate: '', ugName: '', targetRole: '', activityId: '', type: 'all' },
    'ug-activity': { startDate: '', endDate: '' },
    'user-ranking': { startDate: '', endDate: '', targetRole: '' },
    'activity-summary': { startDate: '', endDate: '', ugName: '' },
    'popular-products': { startDate: '', endDate: '', productType: 'all' },
    'hot-content': { startDate: '', endDate: '', categoryId: '' },
    'content-contributors': { startDate: '', endDate: '' },
    'inventory-alert': { stockThreshold: '5', productType: 'all', productStatus: 'all' },
    'travel-statistics': { startDate: '', endDate: '', periodType: 'month', category: 'all' },
    'invite-conversion': { startDate: '', endDate: '' },
  };
}

/** Map tab key to API report type */
function tabToReportType(tab: ReportTab): string {
  const map: Record<ReportTab, string> = {
    'points-detail': 'points-detail',
    'ug-activity': 'ug-activity-summary',
    'user-ranking': 'user-points-ranking',
    'activity-summary': 'activity-points-summary',
    'popular-products': 'popular-products',
    'hot-content': 'hot-content',
    'content-contributors': 'content-contributors',
    'inventory-alert': 'inventory-alert',
    'travel-statistics': 'travel-statistics',
    'invite-conversion': 'invite-conversion',
  };
  return map[tab];
}

/** Map tab key to API endpoint path */
function tabToEndpoint(tab: ReportTab): string {
  const map: Record<ReportTab, string> = {
    'points-detail': '/api/admin/reports/points-detail',
    'ug-activity': '/api/admin/reports/ug-activity-summary',
    'user-ranking': '/api/admin/reports/user-points-ranking',
    'activity-summary': '/api/admin/reports/activity-points-summary',
    'popular-products': '/api/admin/reports/popular-products',
    'hot-content': '/api/admin/reports/hot-content',
    'content-contributors': '/api/admin/reports/content-contributors',
    'inventory-alert': '/api/admin/reports/inventory-alert',
    'travel-statistics': '/api/admin/reports/travel-statistics',
    'invite-conversion': '/api/admin/reports/invite-conversion',
  };
  return map[tab];
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(iso: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Build query string from filter state */
function buildQueryString(tab: ReportTab, filters: TabFilterState, lastKey?: string | null): string {
  const params: string[] = [];
  const f = filters[tab];

  if ('startDate' in f && f.startDate) params.push(`startDate=${encodeURIComponent(f.startDate)}`);
  if ('endDate' in f && f.endDate) params.push(`endDate=${encodeURIComponent(f.endDate)}`);
  if ('ugName' in f && (f as any).ugName) params.push(`ugName=${encodeURIComponent((f as any).ugName)}`);
  if ('targetRole' in f && (f as any).targetRole) params.push(`targetRole=${encodeURIComponent((f as any).targetRole)}`);
  if ('activityId' in f && (f as any).activityId) params.push(`activityId=${encodeURIComponent((f as any).activityId)}`);
  if ('type' in f && (f as any).type && (f as any).type !== 'all') params.push(`type=${encodeURIComponent((f as any).type)}`);
  if ('productType' in f && (f as any).productType && (f as any).productType !== 'all') params.push(`productType=${encodeURIComponent((f as any).productType)}`);
  if ('categoryId' in f && (f as any).categoryId) params.push(`categoryId=${encodeURIComponent((f as any).categoryId)}`);
  if ('stockThreshold' in f && (f as any).stockThreshold) params.push(`stockThreshold=${encodeURIComponent((f as any).stockThreshold)}`);
  if ('productStatus' in f && (f as any).productStatus && (f as any).productStatus !== 'all') params.push(`productStatus=${encodeURIComponent((f as any).productStatus)}`);
  if ('periodType' in f && (f as any).periodType) params.push(`periodType=${encodeURIComponent((f as any).periodType)}`);
  if ('category' in f && (f as any).category && (f as any).category !== 'all') params.push(`category=${encodeURIComponent((f as any).category)}`);
  if (lastKey) params.push(`lastKey=${encodeURIComponent(lastKey)}`);

  return params.length > 0 ? `?${params.join('&')}` : '';
}


/* ─── FilterPanel Component ─────────────────────────────── */

interface FilterPanelProps {
  activeTab: ReportTab;
  filters: TabFilterState;
  onFilterChange: (tab: ReportTab, key: string, value: string) => void;
  ugOptions: UGOption[];
  activityOptions: ActivityOption[];
  categoryOptions: CategoryOption[];
  exporting: boolean;
  onExport: (format: 'csv' | 'xlsx') => void;
}

function FilterPanel({ activeTab, filters, onFilterChange, ugOptions, activityOptions, categoryOptions, exporting, onExport }: FilterPanelProps) {
  const { t } = useTranslation();
  const currentFilters = filters[activeTab];

  // Original tabs
  const showUG = activeTab === 'points-detail' || activeTab === 'activity-summary';
  const showRole = activeTab === 'points-detail' || activeTab === 'user-ranking';
  const showActivity = activeTab === 'points-detail';
  const showType = activeTab === 'points-detail';

  // New insight tabs — date range for all except inventory-alert
  const showDateRange = activeTab !== 'inventory-alert';

  // New insight tab filters
  const showProductType = activeTab === 'popular-products' || activeTab === 'inventory-alert';
  const showCategorySelector = activeTab === 'hot-content';
  const showStockThreshold = activeTab === 'inventory-alert';
  const showProductStatus = activeTab === 'inventory-alert';
  const showPeriodType = activeTab === 'travel-statistics';
  const showTravelCategory = activeTab === 'travel-statistics';

  // Build range arrays for Picker components
  const ugRangeLabels = [t('admin.reports.filterUGAll'), ...ugOptions.map((ug) => ug.ugName)];
  const ugRangeValues = ['', ...ugOptions.map((ug) => ug.ugName)];
  const selectedUGIndex = Math.max(0, ugRangeValues.indexOf((currentFilters as any).ugName || ''));

  const roleRangeLabels = [t('admin.reports.filterRoleAll'), ...ROLE_OPTIONS];
  const roleRangeValues = ['', ...ROLE_OPTIONS];
  const selectedRoleIndex = Math.max(0, roleRangeValues.indexOf((currentFilters as any).targetRole || ''));

  const activityRangeLabels = [t('admin.reports.filterActivityAll'), ...activityOptions.map((act) => act.topic)];
  const activityRangeValues = ['', ...activityOptions.map((act) => act.activityId)];
  const selectedActivityIndex = Math.max(0, activityRangeValues.indexOf((currentFilters as any).activityId || ''));

  const typeRangeLabels = TYPE_OPTIONS.map((opt) => t(opt.labelKey));
  const typeRangeValues = TYPE_OPTIONS.map((opt) => opt.value);
  const selectedTypeIndex = Math.max(0, typeRangeValues.indexOf((currentFilters as any).type || 'all'));

  // Product type picker
  const productTypeLabels = PRODUCT_TYPE_OPTIONS.map((opt) => t(opt.labelKey));
  const productTypeValues = PRODUCT_TYPE_OPTIONS.map((opt) => opt.value);
  const selectedProductTypeIndex = Math.max(0, productTypeValues.indexOf((currentFilters as any).productType || 'all'));

  // Category picker
  const categoryLabels = [t('admin.reports.filterCategoryAll'), ...categoryOptions.map((c) => c.name)];
  const categoryValues = ['', ...categoryOptions.map((c) => c.categoryId)];
  const selectedCategoryIndex = Math.max(0, categoryValues.indexOf((currentFilters as any).categoryId || ''));

  // Product status picker
  const productStatusLabels = PRODUCT_STATUS_OPTIONS.map((opt) => t(opt.labelKey));
  const productStatusValues = PRODUCT_STATUS_OPTIONS.map((opt) => opt.value);
  const selectedProductStatusIndex = Math.max(0, productStatusValues.indexOf((currentFilters as any).productStatus || 'all'));

  // Period type picker
  const periodTypeLabels = PERIOD_TYPE_OPTIONS.map((opt) => t(opt.labelKey));
  const periodTypeValues = PERIOD_TYPE_OPTIONS.map((opt) => opt.value);
  const selectedPeriodTypeIndex = Math.max(0, periodTypeValues.indexOf((currentFilters as any).periodType || 'month'));

  // Travel category picker
  const travelCategoryLabels = TRAVEL_CATEGORY_OPTIONS.map((opt) => t(opt.labelKey));
  const travelCategoryValues = TRAVEL_CATEGORY_OPTIONS.map((opt) => opt.value);
  const selectedTravelCategoryIndex = Math.max(0, travelCategoryValues.indexOf((currentFilters as any).category || 'all'));

  return (
    <View className='report-filter'>
      {/* Date Range — all tabs except inventory-alert */}
      {showDateRange && (
        <>
          <View className='report-filter__group'>
            <Text className='report-filter__label'>{t('admin.reports.filterStartDate')}</Text>
            <Picker
              mode='date'
              value={(currentFilters as any).startDate || ''}
              onChange={(e) => onFilterChange(activeTab, 'startDate', e.detail.value)}
            >
              <View className='report-filter__select'>
                {(currentFilters as any).startDate || t('admin.reports.filterStartDate')}
              </View>
            </Picker>
          </View>
          <View className='report-filter__group'>
            <Text className='report-filter__label'>{t('admin.reports.filterEndDate')}</Text>
            <Picker
              mode='date'
              value={(currentFilters as any).endDate || ''}
              onChange={(e) => onFilterChange(activeTab, 'endDate', e.detail.value)}
            >
              <View className='report-filter__select'>
                {(currentFilters as any).endDate || t('admin.reports.filterEndDate')}
              </View>
            </Picker>
          </View>
        </>
      )}

      {/* UG Selector */}
      {showUG && (
        <View className='report-filter__group'>
          <Text className='report-filter__label'>{t('admin.reports.filterUG')}</Text>
          <Picker
            mode='selector'
            range={ugRangeLabels}
            value={selectedUGIndex}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              onFilterChange(activeTab, 'ugName', ugRangeValues[idx]);
            }}
          >
            <View className='report-filter__select'>
              {ugRangeLabels[selectedUGIndex] || t('admin.reports.filterUGAll')}
            </View>
          </Picker>
        </View>
      )}

      {/* Role Selector */}
      {showRole && (
        <View className='report-filter__group'>
          <Text className='report-filter__label'>{t('admin.reports.filterRole')}</Text>
          <Picker
            mode='selector'
            range={roleRangeLabels}
            value={selectedRoleIndex}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              onFilterChange(activeTab, 'targetRole', roleRangeValues[idx]);
            }}
          >
            <View className='report-filter__select'>
              {roleRangeLabels[selectedRoleIndex] || t('admin.reports.filterRoleAll')}
            </View>
          </Picker>
        </View>
      )}

      {/* Activity Selector */}
      {showActivity && (
        <View className='report-filter__group'>
          <Text className='report-filter__label'>{t('admin.reports.filterActivity')}</Text>
          <Picker
            mode='selector'
            range={activityRangeLabels}
            value={selectedActivityIndex}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              onFilterChange(activeTab, 'activityId', activityRangeValues[idx]);
            }}
          >
            <View className='report-filter__select'>
              {activityRangeLabels[selectedActivityIndex] || t('admin.reports.filterActivityAll')}
            </View>
          </Picker>
        </View>
      )}

      {/* Type Selector */}
      {showType && (
        <View className='report-filter__group'>
          <Text className='report-filter__label'>{t('admin.reports.filterType')}</Text>
          <Picker
            mode='selector'
            range={typeRangeLabels}
            value={selectedTypeIndex}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              onFilterChange(activeTab, 'type', typeRangeValues[idx]);
            }}
          >
            <View className='report-filter__select'>
              {typeRangeLabels[selectedTypeIndex] || t('admin.reports.filterTypeAll')}
            </View>
          </Picker>
        </View>
      )}

      {/* Product Type Selector — popular-products & inventory-alert */}
      {showProductType && (
        <View className='report-filter__group'>
          <Text className='report-filter__label'>{t('admin.reports.filterProductType')}</Text>
          <Picker
            mode='selector'
            range={productTypeLabels}
            value={selectedProductTypeIndex}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              onFilterChange(activeTab, 'productType', productTypeValues[idx]);
            }}
          >
            <View className='report-filter__select'>
              {productTypeLabels[selectedProductTypeIndex] || t('admin.reports.filterProductTypeAll')}
            </View>
          </Picker>
        </View>
      )}

      {/* Category Selector — hot-content */}
      {showCategorySelector && (
        <View className='report-filter__group'>
          <Text className='report-filter__label'>{t('admin.reports.filterCategoryId')}</Text>
          <Picker
            mode='selector'
            range={categoryLabels}
            value={selectedCategoryIndex}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              onFilterChange(activeTab, 'categoryId', categoryValues[idx]);
            }}
          >
            <View className='report-filter__select'>
              {categoryLabels[selectedCategoryIndex] || t('admin.reports.filterCategoryAll')}
            </View>
          </Picker>
        </View>
      )}

      {/* Stock Threshold Input — inventory-alert */}
      {showStockThreshold && (() => {
        const thresholdOptions = ['3', '5', '8', '10', '15', '20', '50', '100'];
        const thresholdLabels = thresholdOptions.map(v => `< ${v}`);
        const currentVal = (currentFilters as any).stockThreshold || '5';
        const selectedIdx = Math.max(0, thresholdOptions.indexOf(currentVal));
        return (
          <View className='report-filter__group'>
            <Text className='report-filter__label'>{t('admin.reports.filterStockThreshold')}</Text>
            <Picker
              mode='selector'
              range={thresholdLabels}
              value={selectedIdx}
              onChange={(e) => {
                const idx = Number(e.detail.value);
                onFilterChange(activeTab, 'stockThreshold', thresholdOptions[idx]);
              }}
            >
              <View className='report-filter__select'>
                {`< ${currentVal}`}
              </View>
            </Picker>
          </View>
        );
      })()}

      {/* Product Status Selector — inventory-alert */}
      {showProductStatus && (
        <View className='report-filter__group'>
          <Text className='report-filter__label'>{t('admin.reports.filterProductStatus')}</Text>
          <Picker
            mode='selector'
            range={productStatusLabels}
            value={selectedProductStatusIndex}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              onFilterChange(activeTab, 'productStatus', productStatusValues[idx]);
            }}
          >
            <View className='report-filter__select'>
              {productStatusLabels[selectedProductStatusIndex] || t('admin.reports.filterProductStatusAll')}
            </View>
          </Picker>
        </View>
      )}

      {/* Period Type Selector — travel-statistics */}
      {showPeriodType && (
        <View className='report-filter__group'>
          <Text className='report-filter__label'>{t('admin.reports.filterPeriodType')}</Text>
          <Picker
            mode='selector'
            range={periodTypeLabels}
            value={selectedPeriodTypeIndex}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              onFilterChange(activeTab, 'periodType', periodTypeValues[idx]);
            }}
          >
            <View className='report-filter__select'>
              {periodTypeLabels[selectedPeriodTypeIndex] || t('admin.reports.filterPeriodTypeMonth')}
            </View>
          </Picker>
        </View>
      )}

      {/* Travel Category Selector — travel-statistics */}
      {showTravelCategory && (
        <View className='report-filter__group'>
          <Text className='report-filter__label'>{t('admin.reports.filterTravelCategory')}</Text>
          <Picker
            mode='selector'
            range={travelCategoryLabels}
            value={selectedTravelCategoryIndex}
            onChange={(e) => {
              const idx = Number(e.detail.value);
              onFilterChange(activeTab, 'category', travelCategoryValues[idx]);
            }}
          >
            <View className='report-filter__select'>
              {travelCategoryLabels[selectedTravelCategoryIndex] || t('admin.reports.filterTravelCategoryAll')}
            </View>
          </Picker>
        </View>
      )}

      {/* Export Buttons */}
      <View className='report-filter__actions'>
        <View
          className={`report-export-btn report-export-btn--primary ${exporting ? 'report-export-btn--disabled' : ''}`}
          onClick={() => !exporting && onExport('xlsx')}
        >
          <Text>{t('admin.reports.exportExcel')}</Text>
        </View>
        <View
          className={`report-export-btn report-export-btn--secondary ${exporting ? 'report-export-btn--disabled' : ''}`}
          onClick={() => !exporting && onExport('csv')}
        >
          <Text>{t('admin.reports.exportCSV')}</Text>
        </View>
      </View>
    </View>
  );
}


/* ─── DataTable Component ───────────────────────────────── */

interface ColumnDef {
  key: string;
  labelKey: string;
  width: string;
  render?: (record: any) => React.ReactNode;
}

function getColumns(tab: ReportTab, t: (key: string) => string): ColumnDef[] {
  switch (tab) {
    case 'points-detail':
      return [
        { key: 'createdAt', labelKey: 'admin.reports.colTime', width: '140px', render: (r: PointsDetailRecord) => <Text>{formatTime(r.createdAt)}</Text> },
        { key: 'nickname', labelKey: 'admin.reports.colNickname', width: '100px' },
        { key: 'amount', labelKey: 'admin.reports.colAmount', width: '80px', render: (r: PointsDetailRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.type === 'earn' ? `+${r.amount}` : `-${r.amount}`}</Text> },
        { key: 'type', labelKey: 'admin.reports.colType', width: '70px', render: (r: PointsDetailRecord) => <Text className={`type-badge type-badge--${r.type}`}>{r.type === 'earn' ? t('admin.reports.filterTypeEarn') : t('admin.reports.filterTypeSpend')}</Text> },
        { key: 'source', labelKey: 'admin.reports.colSource', width: '100px' },
        { key: 'activityUG', labelKey: 'admin.reports.colUG', width: '100px' },
        { key: 'activityTopic', labelKey: 'admin.reports.colTopic', width: '140px' },
        { key: 'targetRole', labelKey: 'admin.reports.colTargetRole', width: '100px' },
        { key: 'distributorNickname', labelKey: 'admin.reports.colDistributor', width: '100px' },
      ];
    case 'ug-activity':
      return [
        { key: 'ugName', labelKey: 'admin.reports.colUGName', width: '160px' },
        { key: 'activityCount', labelKey: 'admin.reports.colActivityCount', width: '120px' },
        { key: 'totalPoints', labelKey: 'admin.reports.colTotalPoints', width: '140px', render: (r: UGActivitySummaryRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.totalPoints}</Text> },
        { key: 'participantCount', labelKey: 'admin.reports.colParticipantCount', width: '120px' },
      ];
    case 'user-ranking':
      return [
        { key: 'rank', labelKey: 'admin.reports.colRank', width: '60px', render: (r: UserRankingRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '700', color: 'var(--accent-primary)' }}>{r.rank}</Text> },
        { key: 'nickname', labelKey: 'admin.reports.colNickname', width: '160px' },
        { key: 'totalEarnPoints', labelKey: 'admin.reports.colTotalEarnPoints', width: '140px', render: (r: UserRankingRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.totalEarnPoints}</Text> },
        { key: 'targetRole', labelKey: 'admin.reports.colRole', width: '140px' },
      ];
    case 'activity-summary':
      return [
        { key: 'activityTopic', labelKey: 'admin.reports.colTopic', width: '160px' },
        { key: 'activityDate', labelKey: 'admin.reports.colActivityDate', width: '110px', render: (r: ActivitySummaryRecord) => <Text>{formatDate(r.activityDate)}</Text> },
        { key: 'activityUG', labelKey: 'admin.reports.colUG', width: '100px' },
        { key: 'totalPoints', labelKey: 'admin.reports.colTotalPoints', width: '120px', render: (r: ActivitySummaryRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.totalPoints}</Text> },
        { key: 'participantCount', labelKey: 'admin.reports.colParticipantCount', width: '80px' },
        { key: 'uglCount', labelKey: 'admin.reports.colUGLCount', width: '80px' },
        { key: 'speakerCount', labelKey: 'admin.reports.colSpeakerCount', width: '90px' },
        { key: 'volunteerCount', labelKey: 'admin.reports.colVolunteerCount', width: '100px' },
      ];
    case 'popular-products':
      return [
        { key: 'productName', labelKey: 'admin.reports.colProductName', width: '160px' },
        { key: 'productType', labelKey: 'admin.reports.colProductType', width: '120px', render: (r: PopularProductRecord) => <Text>{r.productType === 'points' ? t('admin.reports.filterProductTypePoints') : t('admin.reports.filterProductTypeCodeExclusive')}</Text> },
        { key: 'redemptionCount', labelKey: 'admin.reports.colRedemptionCount', width: '100px', render: (r: PopularProductRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.redemptionCount}</Text> },
        { key: 'totalPointsSpent', labelKey: 'admin.reports.colTotalPointsSpent', width: '120px', render: (r: PopularProductRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.totalPointsSpent}</Text> },
        { key: 'currentStock', labelKey: 'admin.reports.colCurrentStock', width: '100px' },
        { key: 'stockConsumptionRate', labelKey: 'admin.reports.colStockConsumptionRate', width: '120px', render: (r: PopularProductRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{(r.stockConsumptionRate ?? 0).toFixed(1)}%</Text> },
      ];
    case 'hot-content':
      return [
        { key: 'title', labelKey: 'admin.reports.colTitle', width: '180px' },
        { key: 'uploaderNickname', labelKey: 'admin.reports.colUploaderNickname', width: '120px' },
        { key: 'categoryName', labelKey: 'admin.reports.colCategoryName', width: '100px' },
        { key: 'likeCount', labelKey: 'admin.reports.colLikeCount', width: '80px' },
        { key: 'commentCount', labelKey: 'admin.reports.colCommentCount', width: '80px' },
        { key: 'reservationCount', labelKey: 'admin.reports.colReservationCount', width: '80px' },
        { key: 'engagementScore', labelKey: 'admin.reports.colEngagementScore', width: '100px', render: (r: HotContentRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '700', color: 'var(--accent-primary)' }}>{r.engagementScore}</Text> },
      ];
    case 'content-contributors':
      return [
        { key: 'rank', labelKey: 'admin.reports.colRank', width: '60px', render: (r: ContentContributorRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '700', color: 'var(--accent-primary)' }}>{r.rank}</Text> },
        { key: 'nickname', labelKey: 'admin.reports.colNickname', width: '160px' },
        { key: 'approvedCount', labelKey: 'admin.reports.colApprovedCount', width: '140px', render: (r: ContentContributorRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.approvedCount}</Text> },
        { key: 'totalLikes', labelKey: 'admin.reports.colTotalLikes', width: '120px' },
        { key: 'totalComments', labelKey: 'admin.reports.colTotalComments', width: '120px' },
      ];
    case 'inventory-alert':
      return [
        { key: 'productName', labelKey: 'admin.reports.colProductName', width: '160px' },
        { key: 'productType', labelKey: 'admin.reports.colProductType', width: '120px', render: (r: InventoryAlertRecord) => <Text>{r.productType === 'points' ? t('admin.reports.filterProductTypePoints') : t('admin.reports.filterProductTypeCodeExclusive')}</Text> },
        { key: 'currentStock', labelKey: 'admin.reports.colCurrentStock', width: '100px', render: (r: InventoryAlertRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.currentStock}</Text> },
        { key: 'totalStock', labelKey: 'admin.reports.colTotalStock', width: '100px' },
        { key: 'productStatus', labelKey: 'admin.reports.colProductStatus', width: '100px', render: (r: InventoryAlertRecord) => <Text>{r.productStatus === 'active' ? t('admin.reports.filterProductStatusActive') : t('admin.reports.filterProductStatusInactive')}</Text> },
      ];
    case 'travel-statistics':
      return [
        { key: 'period', labelKey: 'admin.reports.colPeriod', width: '120px' },
        { key: 'totalApplications', labelKey: 'admin.reports.colTotalApplications', width: '100px', render: (r: TravelStatisticsRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.totalApplications}</Text> },
        { key: 'approvedCount', labelKey: 'admin.reports.colApprovedCount', width: '100px' },
        { key: 'rejectedCount', labelKey: 'admin.reports.colRejectedCount', width: '100px' },
        { key: 'pendingCount', labelKey: 'admin.reports.colPendingCount', width: '100px' },
        { key: 'approvalRate', labelKey: 'admin.reports.colApprovalRate', width: '110px', render: (r: TravelStatisticsRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{(r.approvalRate ?? 0).toFixed(1)}%</Text> },
        { key: 'totalSponsoredAmount', labelKey: 'admin.reports.colTotalSponsoredAmount', width: '120px', render: (r: TravelStatisticsRecord) => <Text style={{ fontFamily: 'var(--font-display)', fontWeight: '600' }}>{r.totalSponsoredAmount}</Text> },
      ];
    default:
      return [];
  }
}

interface DataTableProps {
  activeTab: ReportTab;
  records: any[];
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  loadingMore: boolean;
}

function DataTable({ activeTab, records, loading, hasMore, onLoadMore, loadingMore }: DataTableProps) {
  const { t } = useTranslation();
  const columns = getColumns(activeTab, t);

  if (loading) {
    return <View className='admin-loading'><Text>{t('admin.reports.loading')}</Text></View>;
  }

  if (records.length === 0) {
    return (
      <View className='admin-empty'>
        <Text className='admin-empty__icon'><ClockIcon size={48} color='var(--text-tertiary)' /></Text>
        <Text className='admin-empty__text'>{t('admin.reports.noData')}</Text>
      </View>
    );
  }

  /** Get row CSS class for conditional highlighting */
  const getRowClass = (record: any): string => {
    if (activeTab === 'popular-products' && record.stockConsumptionRate > 80) {
      return 'report-table__row report-table__row--warning';
    }
    if (activeTab === 'inventory-alert' && record.currentStock === 0) {
      return 'report-table__row report-table__row--error';
    }
    return 'report-table__row';
  };

  return (
    <View className='report-table'>
      <View className='report-table__wrapper'>
        {/* Header */}
        <View className='report-table__header'>
          {columns.map((col) => (
            <Text key={col.key} className='report-table__header-cell' style={{ width: col.width, minWidth: col.width }}>
              {t(col.labelKey)}
            </Text>
          ))}
        </View>

        {/* Body */}
        <View className='report-table__body'>
          {records.map((record, idx) => (
            <View key={record.recordId || record.activityId || record.userId || record.ugName || record.productId || record.contentId || record.period || idx} className={getRowClass(record)}>
              {columns.map((col) => (
                <View key={col.key} className='report-table__cell' style={{ width: col.width, minWidth: col.width }}>
                  {col.render ? col.render(record) : <Text>{record[col.key] ?? '-'}</Text>}
                </View>
              ))}
            </View>
          ))}
        </View>
      </View>

      {/* Load More */}
      {loadingMore && (
        <View className='report-loading-more'><Text>{t('admin.reports.loading')}</Text></View>
      )}
      {hasMore && !loadingMore && (
        <View className='report-table__load-more' onClick={onLoadMore}>
          <Text>{t('admin.reports.loadMore')}</Text>
        </View>
      )}
    </View>
  );
}

/* ─── MetricCards Component ──────────────────────────────── */

function MetricCards({ record }: { record: InviteConversionRecord | null }) {
  const { t } = useTranslation();

  if (!record) {
    return (
      <View className='admin-empty'>
        <Text className='admin-empty__icon'><ClockIcon size={48} color='var(--text-tertiary)' /></Text>
        <Text className='admin-empty__text'>{t('admin.reports.noData')}</Text>
      </View>
    );
  }

  const metrics = [
    { labelKey: 'admin.reports.metricTotalInvites', value: record.totalInvites, highlight: false },
    { labelKey: 'admin.reports.metricUsedCount', value: record.usedCount, highlight: false },
    { labelKey: 'admin.reports.metricExpiredCount', value: record.expiredCount, highlight: false },
    { labelKey: 'admin.reports.metricPendingCount', value: record.pendingCount, highlight: false },
    { labelKey: 'admin.reports.metricConversionRate', value: `${(record.conversionRate ?? 0).toFixed(1)}%`, highlight: true },
  ];

  return (
    <View className='metric-cards'>
      {metrics.map((m) => (
        <View key={m.labelKey} className={`metric-card ${m.highlight ? 'metric-card--highlight' : ''}`}>
          <Text className='metric-card__label'>{t(m.labelKey)}</Text>
          <Text className='metric-card__value'>{m.value}</Text>
        </View>
      ))}
    </View>
  );
}


/* ─── Main Page Component ───────────────────────────────── */

export default function AdminReportsPage() {
  const { isSuperAdmin, ready } = useSuperAdminGuard();
  const { t } = useTranslation();

  // Tab state
  const [activeTab, setActiveTab] = useState<ReportTab>('points-detail');

  // Independent filter state per tab
  const [filters, setFilters] = useState<TabFilterState>(getDefaultFilters);

  // Data state
  const [records, setRecords] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [lastKey, setLastKey] = useState<string | null>(null);

  // Dropdown options
  const [ugOptions, setUGOptions] = useState<UGOption[]>([]);
  const [activityOptions, setActivityOptions] = useState<ActivityOption[]>([]);
  const [categoryOptions, setCategoryOptions] = useState<CategoryOption[]>([]);

  // Export state
  const [exporting, setExporting] = useState(false);

  // Track current fetch to avoid stale responses
  const fetchIdRef = useRef(0);

  /* ─── Load dropdown options ─── */
  useEffect(() => {
    if (!ready || !isSuperAdmin) return;

    // Load UG options
    request<{ ugs: UGOption[] }>({ url: '/api/admin/ugs' })
      .then((res) => setUGOptions((res.ugs || []).filter((ug: any) => ug.status === 'active' || !ug.status)))
      .catch(() => setUGOptions([]));

    // Load activity options
    request<{ activities: ActivityOption[] }>({ url: '/api/admin/activities' })
      .then((res) => setActivityOptions(res.activities || []))
      .catch(() => setActivityOptions([]));

    // Load content categories for hot-content tab
    request<{ categories: CategoryOption[] }>({ url: '/api/admin/content/categories' })
      .then((res) => setCategoryOptions(res.categories || []))
      .catch(() => setCategoryOptions([]));
  }, [ready, isSuperAdmin]);

  /* ─── Fetch report data ─── */
  const fetchData = useCallback(async (tab: ReportTab, currentFilters: TabFilterState, append = false, cursor?: string | null) => {
    const fetchId = ++fetchIdRef.current;

    if (!append) {
      setLoading(true);
      setRecords([]);
      setLastKey(null);
    } else {
      setLoadingMore(true);
    }

    try {
      const endpoint = tabToEndpoint(tab);
      const qs = buildQueryString(tab, currentFilters, append ? cursor : null);
      const res = await request<{ success: boolean; records?: any[]; record?: any; lastKey?: string }>({
        url: `${endpoint}${qs}`,
      });

      // Ignore stale responses
      if (fetchId !== fetchIdRef.current) return;

      if (tab === 'invite-conversion') {
        // invite-conversion returns a single record, not an array
        setRecords(res.record ? [res.record] : []);
        setLastKey(null);
      } else if (append) {
        setRecords((prev) => [...prev, ...(res.records || [])]);
        setLastKey(res.lastKey || null);
      } else {
        setRecords(res.records || []);
        setLastKey(res.lastKey || null);
      }
    } catch {
      if (fetchId !== fetchIdRef.current) return;
      if (!append) setRecords([]);
    } finally {
      if (fetchId === fetchIdRef.current) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, []);

  /* ─── Auto-fetch on tab or filter change ─── */
  useEffect(() => {
    if (!ready || !isSuperAdmin) return;
    fetchData(activeTab, filters);
  }, [ready, isSuperAdmin, activeTab, filters, fetchData]);

  /* ─── Handlers ─── */
  const handleTabChange = (tab: ReportTab) => {
    setActiveTab(tab);
  };

  const handleFilterChange = (tab: ReportTab, key: string, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [tab]: { ...prev[tab], [key]: value },
    }));
  };

  const handleLoadMore = () => {
    if (lastKey && !loadingMore) {
      fetchData(activeTab, filters, true, lastKey);
    }
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (exporting) return;
    setExporting(true);
    Taro.showToast({ title: t('admin.reports.exporting'), icon: 'none', duration: 30000 });

    try {
      const reportType = tabToReportType(activeTab);
      const currentFilters = filters[activeTab];
      const filterPayload: Record<string, string> = {};

      if ('startDate' in currentFilters && (currentFilters as any).startDate) filterPayload.startDate = (currentFilters as any).startDate;
      if ('endDate' in currentFilters && (currentFilters as any).endDate) filterPayload.endDate = (currentFilters as any).endDate;
      if ('ugName' in currentFilters && (currentFilters as any).ugName) filterPayload.ugName = (currentFilters as any).ugName;
      if ('targetRole' in currentFilters && (currentFilters as any).targetRole) filterPayload.targetRole = (currentFilters as any).targetRole;
      if ('activityId' in currentFilters && (currentFilters as any).activityId) filterPayload.activityId = (currentFilters as any).activityId;
      if ('type' in currentFilters && (currentFilters as any).type && (currentFilters as any).type !== 'all') filterPayload.type = (currentFilters as any).type;
      if ('productType' in currentFilters && (currentFilters as any).productType && (currentFilters as any).productType !== 'all') filterPayload.productType = (currentFilters as any).productType;
      if ('categoryId' in currentFilters && (currentFilters as any).categoryId) filterPayload.categoryId = (currentFilters as any).categoryId;
      if ('stockThreshold' in currentFilters && (currentFilters as any).stockThreshold) filterPayload.stockThreshold = (currentFilters as any).stockThreshold;
      if ('productStatus' in currentFilters && (currentFilters as any).productStatus && (currentFilters as any).productStatus !== 'all') filterPayload.productStatus = (currentFilters as any).productStatus;
      if ('periodType' in currentFilters && (currentFilters as any).periodType) filterPayload.periodType = (currentFilters as any).periodType;
      if ('category' in currentFilters && (currentFilters as any).category && (currentFilters as any).category !== 'all') filterPayload.category = (currentFilters as any).category;

      const res = await request<{ downloadUrl?: string }>({
        url: '/api/admin/reports/export',
        method: 'POST',
        data: { reportType, format, filters: filterPayload },
      });

      Taro.hideToast();

      if (res.downloadUrl) {
        // Create a temporary link and click it to trigger download (avoids popup blocker)
        const link = document.createElement('a');
        link.href = res.downloadUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        Taro.showToast({ title: t('admin.reports.exportSuccess'), icon: 'none' });
      } else {
        Taro.showToast({ title: t('admin.reports.exportFailed'), icon: 'none' });
      }
    } catch (err) {
      Taro.hideToast();
      let errorMsg = t('admin.reports.exportFailed');
      if (err instanceof RequestError) {
        if (err.code === 'EXPORT_LIMIT_EXCEEDED') {
          errorMsg = t('admin.reports.exportLimitExceeded');
        } else if (err.code === 'EXPORT_TIMEOUT') {
          errorMsg = t('admin.reports.exportTimeout');
        } else {
          errorMsg = err.message;
        }
      }
      Taro.showToast({ title: errorMsg, icon: 'none' });
    } finally {
      setExporting(false);
    }
  };

  const handleBack = () => goBack('/pages/admin/index');

  /* ─── Auth guard: redirect non-SuperAdmin ─── */
  if (!ready) {
    return <View className='admin-loading'><Text>{t('admin.reports.loading')}</Text></View>;
  }

  if (!isSuperAdmin) {
    // Redirect to admin index
    Taro.redirectTo({ url: '/pages/admin/index' });
    return (
      <View className='admin-forbidden'>
        <Text className='admin-forbidden__text'>{t('common.forbidden') || 'Access denied'}</Text>
        <Text className='admin-forbidden__link' onClick={() => Taro.redirectTo({ url: '/pages/admin/index' })}>
          {t('admin.reports.backButton')}
        </Text>
      </View>
    );
  }

  const hasPagination = activeTab === 'points-detail' || activeTab === 'user-ranking';
  const isInviteConversion = activeTab === 'invite-conversion';

  return (
    <View className='admin-reports'>
      {/* Toolbar */}
      <View className='admin-reports__toolbar'>
        <View className='admin-reports__back' onClick={handleBack}>
          <Text>{t('admin.reports.backButton')}</Text>
        </View>
        <Text className='admin-reports__title'>{t('admin.reports.title')}</Text>
        <View style={{ width: '60px' }} />
      </View>

      {/* Tab Bar */}
      <View className='report-tabs'>
        {REPORT_TABS.map((tab) => (
          <View
            key={tab.key}
            className={`report-tabs__item ${activeTab === tab.key ? 'report-tabs__item--active' : ''}`}
            onClick={() => handleTabChange(tab.key)}
          >
            <Text>{t(tab.labelKey)}</Text>
          </View>
        ))}
      </View>

      {/* Filter Panel */}
      <FilterPanel
        activeTab={activeTab}
        filters={filters}
        onFilterChange={handleFilterChange}
        ugOptions={ugOptions}
        activityOptions={activityOptions}
        categoryOptions={categoryOptions}
        exporting={exporting}
        onExport={handleExport}
      />

      {/* Content: MetricCards for invite-conversion, DataTable for others */}
      {isInviteConversion ? (
        loading ? (
          <View className='admin-loading'><Text>{t('admin.reports.loading')}</Text></View>
        ) : (
          <MetricCards record={records.length > 0 ? (records[0] as InviteConversionRecord) : null} />
        )
      ) : (
        <DataTable
          activeTab={activeTab}
          records={records}
          loading={loading}
          hasMore={hasPagination && !!lastKey}
          onLoadMore={handleLoadMore}
          loadingMore={loadingMore}
        />
      )}
    </View>
  );
}