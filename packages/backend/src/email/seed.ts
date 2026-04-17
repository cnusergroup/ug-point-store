import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { NotificationType, EmailLocale } from './send';
import type { EmailTemplate } from './templates';

// ============================================================
// Default template content
// ============================================================

const FOOTER_ZH = '<p style="font-size:12px;color:#94a3b8;">此邮件由 User Group 福利广场自动发送</p>';
const FOOTER_UNSUB_ZH = '<p style="font-size:12px;color:#94a3b8;">此邮件由 User Group 福利广场自动发送。如不想收到此类邮件，请在设置中关闭订阅。</p>';
const FOOTER_EN = '<p style="font-size:12px;color:#94a3b8;">This email was sent automatically by User Group Benefits Plaza</p>';
const FOOTER_UNSUB_EN = '<p style="font-size:12px;color:#94a3b8;">This email was sent automatically by User Group Benefits Plaza. To unsubscribe, update your settings.</p>';
const FOOTER_JA = '<p style="font-size:12px;color:#94a3b8;">このメールは User Group 福利広場から自動送信されました</p>';
const FOOTER_UNSUB_JA = '<p style="font-size:12px;color:#94a3b8;">このメールは User Group 福利広場から自動送信されました。配信停止は設定から変更できます。</p>';
const FOOTER_KO = '<p style="font-size:12px;color:#94a3b8;">이 이메일은 User Group 복지광장에서 자동 발송되었습니다</p>';
const FOOTER_UNSUB_KO = '<p style="font-size:12px;color:#94a3b8;">이 이메일은 User Group 복지광장에서 자동 발송되었습니다. 수신 거부는 설정에서 변경할 수 있습니다.</p>';
const FOOTER_ZHTW = '<p style="font-size:12px;color:#94a3b8;">此郵件由 User Group 福利廣場自動發送</p>';
const FOOTER_UNSUB_ZHTW = '<p style="font-size:12px;color:#94a3b8;">此郵件由 User Group 福利廣場自動發送。如不想收到此類郵件，請在設定中關閉訂閱。</p>';

const HR = '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />';

function wrap(inner: string, fontFamily = "'Noto Sans SC',sans-serif"): string {
  return `<div style="max-width:600px;margin:0 auto;font-family:${fontFamily};padding:24px;">${inner}</div>`;
}

// ============================================================
// pointsEarned templates
// ============================================================

const pointsEarnedTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '🎉 积分到账啦，快来福利广场逛逛吧！',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}，你的积分到账啦！</h2>',
      '<p style="font-size:16px;color:#334155;">恭喜你获得了 <strong style="color:#6366f1;">{{points}} 积分</strong>！</p>',
      '<p style="color:#64748b;">来源：{{source}}</p>',
      '<p style="color:#64748b;">当前余额：<strong>{{balance}} 积分</strong></p>',
      '<p style="margin-top:24px;">快去福利广场看看有什么好东西可以兑换吧～ 🛍️</p>',
      HR,
      FOOTER_ZH,
    ].join('\n  ')),
  },
  en: {
    subject: '🎉 Points credited! Check out the mall!',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}, your points have arrived!</h2>',
      '<p style="font-size:16px;color:#334155;">Congratulations! You earned <strong style="color:#6366f1;">{{points}} points</strong>!</p>',
      '<p style="color:#64748b;">Source: {{source}}</p>',
      '<p style="color:#64748b;">Current balance: <strong>{{balance}} points</strong></p>',
      '<p style="margin-top:24px;">Head to the mall and see what you can redeem! 🛍️</p>',
      HR,
      FOOTER_EN,
    ].join('\n  ')),
  },
  ja: {
    subject: '🎉 ポイントが付与されました！',
    body: wrap([
      '<h2 style="color:#6366f1;">{{nickname}} さん、ポイントが届きました！</h2>',
      '<p style="font-size:16px;color:#334155;"><strong style="color:#6366f1;">{{points}} ポイント</strong>を獲得しました！</p>',
      '<p style="color:#64748b;">獲得元：{{source}}</p>',
      '<p style="color:#64748b;">現在の残高：<strong>{{balance}} ポイント</strong></p>',
      '<p style="margin-top:24px;">福利広場で交換できるアイテムをチェックしましょう！ 🛍️</p>',
      HR,
      FOOTER_JA,
    ].join('\n  ')),
  },
  ko: {
    subject: '🎉 포인트가 적립되었습니다!',
    body: wrap([
      '<h2 style="color:#6366f1;">{{nickname}} 님, 포인트가 도착했습니다!</h2>',
      '<p style="font-size:16px;color:#334155;"><strong style="color:#6366f1;">{{points}} 포인트</strong>를 획득했습니다!</p>',
      '<p style="color:#64748b;">출처: {{source}}</p>',
      '<p style="color:#64748b;">현재 잔액: <strong>{{balance}} 포인트</strong></p>',
      '<p style="margin-top:24px;">몰에서 교환할 수 있는 굿즈를 확인해 보세요! 🛍️</p>',
      HR,
      FOOTER_KO,
    ].join('\n  ')),
  },
  'zh-TW': {
    subject: '🎉 積分到帳啦，快來福利廣場逛逛吧！',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}，你的積分到帳啦！</h2>',
      '<p style="font-size:16px;color:#334155;">恭喜你獲得了 <strong style="color:#6366f1;">{{points}} 積分</strong>！</p>',
      '<p style="color:#64748b;">來源：{{source}}</p>',
      '<p style="color:#64748b;">目前餘額：<strong>{{balance}} 積分</strong></p>',
      '<p style="margin-top:24px;">快去福利廣場看看有什麼好東西可以兌換吧～ 🛍️</p>',
      HR,
      FOOTER_ZHTW,
    ].join('\n  ')),
  },
};

// ============================================================
// newOrder templates
// ============================================================

const newOrderTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '📦 有新订单啦，注意发货哦！',
    body: wrap([
      '<h2 style="color:#6366f1;">新订单提醒 🎯</h2>',
      '<p style="font-size:16px;color:#334155;">用户 <strong>{{buyerNickname}}</strong> 下了一笔新订单！</p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📋 订单信息</h3>',
      '<p style="color:#64748b;">订单号：<strong>{{orderId}}</strong></p>',
      '<p style="color:#64748b;white-space:pre-line;">周边：<strong>{{productNames}}</strong></p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📮 收件信息（快递用）</h3>',
      '<table style="border-collapse:collapse;width:100%;">',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">收件人</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{recipientName}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">手机号</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{phone}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">收件地址</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{detailAddress}}</td></tr>',
      '</table>',
      HR,
      FOOTER_ZH,
    ].join('\n  ')),
  },
  en: {
    subject: '📦 New order received!',
    body: wrap([
      '<h2 style="color:#6366f1;">New Order Alert 🎯</h2>',
      '<p style="font-size:16px;color:#334155;">User <strong>{{buyerNickname}}</strong> placed a new order!</p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📋 Order Details</h3>',
      '<p style="color:#64748b;">Order ID: <strong>{{orderId}}</strong></p>',
      '<p style="color:#64748b;white-space:pre-line;">Products: <strong>{{productNames}}</strong></p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📮 Shipping Info</h3>',
      '<table style="border-collapse:collapse;width:100%;">',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">Recipient</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{recipientName}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">Phone</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{phone}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">Address</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{detailAddress}}</td></tr>',
      '</table>',
      HR,
      FOOTER_EN,
    ].join('\n  ')),
  },
  ja: {
    subject: '📦 新しい注文が入りました！',
    body: wrap([
      '<h2 style="color:#6366f1;">新規注文のお知らせ 🎯</h2>',
      '<p style="font-size:16px;color:#334155;">ユーザー <strong>{{buyerNickname}}</strong> が新しい注文をしました！</p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📋 注文情報</h3>',
      '<p style="color:#64748b;">注文番号：<strong>{{orderId}}</strong></p>',
      '<p style="color:#64748b;white-space:pre-line;">グッズ：<strong>{{productNames}}</strong></p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📮 配送先情報</h3>',
      '<table style="border-collapse:collapse;width:100%;">',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">受取人</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{recipientName}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">電話番号</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{phone}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">住所</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{detailAddress}}</td></tr>',
      '</table>',
      HR,
      FOOTER_JA,
    ].join('\n  ')),
  },
  ko: {
    subject: '📦 새 주문이 들어왔습니다!',
    body: wrap([
      '<h2 style="color:#6366f1;">새 주문 알림 🎯</h2>',
      '<p style="font-size:16px;color:#334155;">사용자 <strong>{{buyerNickname}}</strong> 님이 새 주문을 했습니다!</p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📋 주문 정보</h3>',
      '<p style="color:#64748b;">주문번호: <strong>{{orderId}}</strong></p>',
      '<p style="color:#64748b;white-space:pre-line;">굿즈: <strong>{{productNames}}</strong></p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📮 배송 정보</h3>',
      '<table style="border-collapse:collapse;width:100%;">',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">수령인</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{recipientName}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">전화번호</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{phone}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">주소</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{detailAddress}}</td></tr>',
      '</table>',
      HR,
      FOOTER_KO,
    ].join('\n  ')),
  },
  'zh-TW': {
    subject: '📦 有新訂單啦，注意出貨哦！',
    body: wrap([
      '<h2 style="color:#6366f1;">新訂單提醒 🎯</h2>',
      '<p style="font-size:16px;color:#334155;">用戶 <strong>{{buyerNickname}}</strong> 下了一筆新訂單！</p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📋 訂單資訊</h3>',
      '<p style="color:#64748b;">訂單號：<strong>{{orderId}}</strong></p>',
      '<p style="color:#64748b;white-space:pre-line;">周邊：<strong>{{productNames}}</strong></p>',
      HR,
      '<h3 style="color:#334155;margin-bottom:8px;">📮 收件資訊（快遞用）</h3>',
      '<table style="border-collapse:collapse;width:100%;">',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">收件人</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{recipientName}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">手機號</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{phone}}</td></tr>',
      '<tr><td style="padding:6px 12px 6px 0;color:#64748b;white-space:nowrap;">收件地址</td><td style="padding:6px 0;color:#0f172a;font-weight:600;">{{detailAddress}}</td></tr>',
      '</table>',
      HR,
      FOOTER_ZHTW,
    ].join('\n  ')),
  },
};

// ============================================================
// orderShipped templates
// ============================================================

const orderShippedTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '🚚 你的包裹已发出，注意查收！',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}，你的包裹发出啦！</h2>',
      '<p style="font-size:16px;color:#334155;">订单 <strong>{{orderId}}</strong> 已发货～</p>',
      '<p style="color:#64748b;">物流单号：{{trackingNumber}}</p>',
      '<p style="margin-top:24px;">耐心等待，好物马上到手！ 📬</p>',
      HR,
      FOOTER_ZH,
    ].join('\n  ')),
  },
  en: {
    subject: '🚚 Your package is on the way!',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}, your package has shipped!</h2>',
      '<p style="font-size:16px;color:#334155;">Order <strong>{{orderId}}</strong> has been shipped!</p>',
      '<p style="color:#64748b;">Tracking number: {{trackingNumber}}</p>',
      '<p style="margin-top:24px;">Hang tight, your goodies are on the way! 📬</p>',
      HR,
      FOOTER_EN,
    ].join('\n  ')),
  },
  ja: {
    subject: '🚚 荷物が発送されました！',
    body: wrap([
      '<h2 style="color:#6366f1;">{{nickname}} さん、荷物が発送されました！</h2>',
      '<p style="font-size:16px;color:#334155;">注文 <strong>{{orderId}}</strong> が発送されました！</p>',
      '<p style="color:#64748b;">追跡番号：{{trackingNumber}}</p>',
      '<p style="margin-top:24px;">もうすぐ届きます、お楽しみに！ 📬</p>',
      HR,
      FOOTER_JA,
    ].join('\n  ')),
  },
  ko: {
    subject: '🚚 택배가 발송되었습니다!',
    body: wrap([
      '<h2 style="color:#6366f1;">{{nickname}} 님, 택배가 발송되었습니다!</h2>',
      '<p style="font-size:16px;color:#334155;">주문 <strong>{{orderId}}</strong>이(가) 발송되었습니다!</p>',
      '<p style="color:#64748b;">운송장 번호: {{trackingNumber}}</p>',
      '<p style="margin-top:24px;">곧 도착할 예정이니 조금만 기다려 주세요! 📬</p>',
      HR,
      FOOTER_KO,
    ].join('\n  ')),
  },
  'zh-TW': {
    subject: '🚚 你的包裹已寄出，注意查收！',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}，你的包裹寄出啦！</h2>',
      '<p style="font-size:16px;color:#334155;">訂單 <strong>{{orderId}}</strong> 已出貨～</p>',
      '<p style="color:#64748b;">物流單號：{{trackingNumber}}</p>',
      '<p style="margin-top:24px;">耐心等待，好物馬上到手！ 📬</p>',
      HR,
      FOOTER_ZHTW,
    ].join('\n  ')),
  },
};

// ============================================================
// newProduct templates
// ============================================================

const newProductTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '🆕 福利广场上新啦，快来看看有什么好东西！',
    body: wrap([
      '<h2 style="color:#6366f1;">福利广场上新提醒 ✨</h2>',
      '<p style="font-size:16px;color:#334155;">以下新周边已上架：</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{productList}}</div>',
      '<p style="margin-top:24px;">快去福利广场逛逛吧～ 🛒</p>',
      HR,
      FOOTER_UNSUB_ZH,
    ].join('\n  ')),
  },
  en: {
    subject: '🆕 New products available!',
    body: wrap([
      '<h2 style="color:#6366f1;">New Products Alert ✨</h2>',
      '<p style="font-size:16px;color:#334155;">The following new products are now available:</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{productList}}</div>',
      '<p style="margin-top:24px;">Head to the mall and check them out! 🛒</p>',
      HR,
      FOOTER_UNSUB_EN,
    ].join('\n  ')),
  },
  ja: {
    subject: '🆕 新グッズが入荷しました！',
    body: wrap([
      '<h2 style="color:#6366f1;">新グッズのお知らせ ✨</h2>',
      '<p style="font-size:16px;color:#334155;">以下の新グッズが入荷しました：</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{productList}}</div>',
      '<p style="margin-top:24px;">福利広場でチェックしましょう！ 🛒</p>',
      HR,
      FOOTER_UNSUB_JA,
    ].join('\n  ')),
  },
  ko: {
    subject: '🆕 새 굿즈가 등록되었습니다!',
    body: wrap([
      '<h2 style="color:#6366f1;">새 굿즈 알림 ✨</h2>',
      '<p style="font-size:16px;color:#334155;">다음 새 굿즈가 등록되었습니다:</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{productList}}</div>',
      '<p style="margin-top:24px;">몰에서 확인해 보세요! 🛒</p>',
      HR,
      FOOTER_UNSUB_KO,
    ].join('\n  ')),
  },
  'zh-TW': {
    subject: '🆕 福利廣場上新啦，快來看看！',
    body: wrap([
      '<h2 style="color:#6366f1;">福利廣場上新提醒 ✨</h2>',
      '<p style="font-size:16px;color:#334155;">以下新周邊已上架：</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{productList}}</div>',
      '<p style="margin-top:24px;">快去福利廣場逛逛吧～ 🛒</p>',
      HR,
      FOOTER_UNSUB_ZHTW,
    ].join('\n  ')),
  },
};

// ============================================================
// newContent templates
// ============================================================

const newContentTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '📚 有新内容发布啦，快来看看！',
    body: wrap([
      '<h2 style="color:#6366f1;">新内容上线提醒 📖</h2>',
      '<p style="font-size:16px;color:#334155;">以下新内容已发布：</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">快去内容中心看看吧～ 🎓</p>',
      HR,
      FOOTER_UNSUB_ZH,
    ].join('\n  ')),
  },
  en: {
    subject: '📚 New content published!',
    body: wrap([
      '<h2 style="color:#6366f1;">New Content Alert 📖</h2>',
      '<p style="font-size:16px;color:#334155;">The following new content has been published:</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">Head to the content hub and check it out! 🎓</p>',
      HR,
      FOOTER_UNSUB_EN,
    ].join('\n  ')),
  },
  ja: {
    subject: '📚 新しいコンテンツが公開されました！',
    body: wrap([
      '<h2 style="color:#6366f1;">新コンテンツのお知らせ 📖</h2>',
      '<p style="font-size:16px;color:#334155;">以下の新しいコンテンツが公開されました：</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">コンテンツセンターでチェックしましょう！ 🎓</p>',
      HR,
      FOOTER_UNSUB_JA,
    ].join('\n  ')),
  },
  ko: {
    subject: '📚 새 콘텐츠가 게시되었습니다!',
    body: wrap([
      '<h2 style="color:#6366f1;">새 콘텐츠 알림 📖</h2>',
      '<p style="font-size:16px;color:#334155;">다음 새 콘텐츠가 게시되었습니다:</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">콘텐츠 센터에서 확인해 보세요! 🎓</p>',
      HR,
      FOOTER_UNSUB_KO,
    ].join('\n  ')),
  },
  'zh-TW': {
    subject: '📚 有新內容發佈啦，快來看看！',
    body: wrap([
      '<h2 style="color:#6366f1;">新內容上線提醒 📖</h2>',
      '<p style="font-size:16px;color:#334155;">以下新內容已發佈：</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">快去內容中心看看吧～ 🎓</p>',
      HR,
      FOOTER_UNSUB_ZHTW,
    ].join('\n  ')),
  },
};

// ============================================================
// Template map by notification type
// ============================================================

const TEMPLATE_MAP: Record<NotificationType, Record<EmailLocale, { subject: string; body: string }>> = {
  pointsEarned: pointsEarnedTemplates,
  newOrder: newOrderTemplates,
  orderShipped: orderShippedTemplates,
  newProduct: newProductTemplates,
  newContent: newContentTemplates,
};

const ALL_LOCALES: EmailLocale[] = ['zh', 'en', 'ja', 'ko', 'zh-TW'];
const ALL_TYPES: NotificationType[] = ['pointsEarned', 'newOrder', 'orderShipped', 'newProduct', 'newContent'];

// ============================================================
// Public API
// ============================================================

/**
 * Return all 25 default email templates (5 notification types × 5 locales).
 */
export function getDefaultTemplates(): EmailTemplate[] {
  const now = new Date().toISOString();
  const templates: EmailTemplate[] = [];

  for (const type of ALL_TYPES) {
    for (const locale of ALL_LOCALES) {
      const content = TEMPLATE_MAP[type][locale];
      templates.push({
        templateId: type,
        locale,
        subject: content.subject,
        body: content.body,
        updatedAt: now,
        updatedBy: 'system',
      });
    }
  }

  return templates;
}

/**
 * Seed all 25 default templates into DynamoDB using BatchWriteCommand.
 * DynamoDB BatchWriteCommand supports max 25 items per request,
 * which fits exactly for 5 types × 5 locales.
 */
export async function seedDefaultTemplates(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<void> {
  const templates = getDefaultTemplates();

  await dynamoClient.send(
    new BatchWriteCommand({
      RequestItems: {
        [tableName]: templates.map((template) => ({
          PutRequest: {
            Item: template,
          },
        })),
      },
    }),
  );

  console.log(`[EmailSeed] Seeded ${templates.length} default email templates`);
}
