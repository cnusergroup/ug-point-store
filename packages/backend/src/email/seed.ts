import {
  DynamoDBDocumentClient,
  BatchWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import type { NotificationType, EmailLocale } from './send';
import type { EmailTemplate } from './templates';

// ============================================================
// Default template content
// ============================================================

const FOOTER_ZH = '<p style="font-size:12px;color:#94a3b8;">此邮件由 User Group 积分兑换广场自动发送</p>';
const FOOTER_UNSUB_ZH = '<p style="font-size:12px;color:#94a3b8;">此邮件由 User Group 积分兑换广场自动发送。如不想收到此类邮件，请在设置中关闭订阅。</p>';
const FOOTER_EN = '<p style="font-size:12px;color:#94a3b8;">This email was sent automatically by User Group Builder Store</p>';
const FOOTER_UNSUB_EN = '<p style="font-size:12px;color:#94a3b8;">This email was sent automatically by User Group Builder Store. To unsubscribe, update your settings.</p>';
const FOOTER_JA = '<p style="font-size:12px;color:#94a3b8;">このメールは User Group ポイント交換広場から自動送信されました</p>';
const FOOTER_UNSUB_JA = '<p style="font-size:12px;color:#94a3b8;">このメールは User Group ポイント交換広場から自動送信されました。配信停止は設定から変更できます。</p>';
const FOOTER_KO = '<p style="font-size:12px;color:#94a3b8;">이 이메일은 User Group 포인트 교환 광장에서 자동 발송되었습니다</p>';
const FOOTER_UNSUB_KO = '<p style="font-size:12px;color:#94a3b8;">이 이메일은 User Group 포인트 교환 광장에서 자동 발송되었습니다. 수신 거부는 설정에서 변경할 수 있습니다.</p>';
const FOOTER_ZHTW = '<p style="font-size:12px;color:#94a3b8;">此郵件由 User Group 積分兌換廣場自動發送</p>';
const FOOTER_UNSUB_ZHTW = '<p style="font-size:12px;color:#94a3b8;">此郵件由 User Group 積分兌換廣場自動發送。如不想收到此類郵件，請在設定中關閉訂閱。</p>';

const STORE_LINK = '<p style="margin-top:16px;text-align:center;"><a href="https://store.awscommunity.cn" style="display:inline-block;padding:10px 24px;background:#6366f1;color:#ffffff;text-decoration:none;border-radius:6px;font-weight:600;">Visit Builder Store</a></p>';

const HR = '<hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;" />';

function wrap(inner: string, fontFamily = "'Noto Sans SC',sans-serif"): string {
  return `<div style="max-width:600px;margin:0 auto;font-family:${fontFamily};padding:24px;">${inner}</div>`;
}

// ============================================================
// pointsEarned templates
// ============================================================

const pointsEarnedTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '🎉 积分到账啦，快来积分兑换广场逛逛吧！',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}，你的积分到账啦！</h2>',
      '<p style="font-size:16px;color:#334155;">恭喜你获得了 <strong style="color:#6366f1;">{{points}} 积分</strong>！</p>',
      '<p style="color:#64748b;">来源：{{source}}</p>',
      '<p style="color:#64748b;">当前余额：<strong>{{balance}} 积分</strong></p>',
      '<p style="margin-top:24px;">快去积分兑换广场看看有什么好东西可以兑换吧～ 🛍️</p>',
      HR,
      STORE_LINK,
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
      STORE_LINK,
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
      '<p style="margin-top:24px;">ポイント交換広場で交換できるアイテムをチェックしましょう！ 🛍️</p>',
      HR,
      STORE_LINK,
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
      STORE_LINK,
      FOOTER_KO,
    ].join('\n  ')),
  },
  'zh-TW': {
    subject: '🎉 積分到帳啦，快來積分兌換廣場逛逛吧！',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}，你的積分到帳啦！</h2>',
      '<p style="font-size:16px;color:#334155;">恭喜你獲得了 <strong style="color:#6366f1;">{{points}} 積分</strong>！</p>',
      '<p style="color:#64748b;">來源：{{source}}</p>',
      '<p style="color:#64748b;">目前餘額：<strong>{{balance}} 積分</strong></p>',
      '<p style="margin-top:24px;">快去積分兌換廣場看看有什麼好東西可以兌換吧～ 🛍️</p>',
      HR,
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
      FOOTER_ZHTW,
    ].join('\n  ')),
  },
};

// ============================================================
// newProduct templates
// ============================================================

const newProductTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '🆕 积分兑换广场上新啦，快来看看有什么好东西！',
    body: wrap([
      '<h2 style="color:#6366f1;">积分兑换广场上新提醒 ✨</h2>',
      '<p style="font-size:16px;color:#334155;">以下新周边已上架：</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{productList}}</div>',
      '<p style="margin-top:24px;">快去积分兑换广场逛逛吧～ 🛒</p>',
      HR,
      STORE_LINK,
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
      STORE_LINK,
      FOOTER_UNSUB_EN,
    ].join('\n  ')),
  },
  ja: {
    subject: '🆕 新グッズが入荷しました！',
    body: wrap([
      '<h2 style="color:#6366f1;">新グッズのお知らせ ✨</h2>',
      '<p style="font-size:16px;color:#334155;">以下の新グッズが入荷しました：</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{productList}}</div>',
      '<p style="margin-top:24px;">ポイント交換広場でチェックしましょう！ 🛒</p>',
      HR,
      STORE_LINK,
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
      STORE_LINK,
      FOOTER_UNSUB_KO,
    ].join('\n  ')),
  },
  'zh-TW': {
    subject: '🆕 積分兌換廣場上新啦，快來看看！',
    body: wrap([
      '<h2 style="color:#6366f1;">積分兌換廣場上新提醒 ✨</h2>',
      '<p style="font-size:16px;color:#334155;">以下新周邊已上架：</p>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:16px 0;">{{productList}}</div>',
      '<p style="margin-top:24px;">快去積分兌換廣場逛逛吧～ 🛒</p>',
      HR,
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
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
      STORE_LINK,
      FOOTER_UNSUB_ZHTW,
    ].join('\n  ')),
  },
};

// ============================================================
// contentUpdated templates
// ============================================================

const contentUpdatedTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '📝 您预约的内容有更新，请确认最新版本',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{userName}}，您预约的内容有更新 📝</h2>',
      '<p style="font-size:16px;color:#334155;">您预约的内容 <strong style="color:#6366f1;">{{contentTitle}}</strong> 已被编辑更新。</p>',
      '<p style="color:#64748b;">活动主题：{{activityTopic}}</p>',
      '<p style="color:#64748b;">活动日期：{{activityDate}}</p>',
      '<p style="margin-top:24px;">请查看最新版本，确认内容变更～</p>',
      HR,
      STORE_LINK,
      FOOTER_ZH,
    ].join('\n  ')),
  },
  en: {
    subject: '📝 Reserved content has been updated, please review the latest version',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{userName}}, your reserved content has been updated 📝</h2>',
      '<p style="font-size:16px;color:#334155;">The content <strong style="color:#6366f1;">{{contentTitle}}</strong> you reserved has been edited.</p>',
      '<p style="color:#64748b;">Activity topic: {{activityTopic}}</p>',
      '<p style="color:#64748b;">Activity date: {{activityDate}}</p>',
      '<p style="margin-top:24px;">Please review the latest version to confirm the changes.</p>',
      HR,
      STORE_LINK,
      FOOTER_EN,
    ].join('\n  ')),
  },
  ja: {
    subject: '📝 予約したコンテンツが更新されました。最新版をご確認ください',
    body: wrap([
      '<h2 style="color:#6366f1;">{{userName}} さん、予約したコンテンツが更新されました 📝</h2>',
      '<p style="font-size:16px;color:#334155;">予約したコンテンツ <strong style="color:#6366f1;">{{contentTitle}}</strong> が編集されました。</p>',
      '<p style="color:#64748b;">活動テーマ：{{activityTopic}}</p>',
      '<p style="color:#64748b;">活動日：{{activityDate}}</p>',
      '<p style="margin-top:24px;">最新版をご確認ください。</p>',
      HR,
      STORE_LINK,
      FOOTER_JA,
    ].join('\n  ')),
  },
  ko: {
    subject: '📝 예약한 콘텐츠가 업데이트되었습니다. 최신 버전을 확인해 주세요',
    body: wrap([
      '<h2 style="color:#6366f1;">{{userName}} 님, 예약한 콘텐츠가 업데이트되었습니다 📝</h2>',
      '<p style="font-size:16px;color:#334155;">예약한 콘텐츠 <strong style="color:#6366f1;">{{contentTitle}}</strong>이(가) 편집되었습니다.</p>',
      '<p style="color:#64748b;">활동 주제: {{activityTopic}}</p>',
      '<p style="color:#64748b;">활동 날짜: {{activityDate}}</p>',
      '<p style="margin-top:24px;">최신 버전을 확인해 주세요.</p>',
      HR,
      STORE_LINK,
      FOOTER_KO,
    ].join('\n  ')),
  },
  'zh-TW': {
    subject: '📝 您預約的內容有更新，請確認最新版本',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{userName}}，您預約的內容有更新 📝</h2>',
      '<p style="font-size:16px;color:#334155;">您預約的內容 <strong style="color:#6366f1;">{{contentTitle}}</strong> 已被編輯更新。</p>',
      '<p style="color:#64748b;">活動主題：{{activityTopic}}</p>',
      '<p style="color:#64748b;">活動日期：{{activityDate}}</p>',
      '<p style="margin-top:24px;">請查看最新版本，確認內容變更～</p>',
      HR,
      STORE_LINK,
      FOOTER_ZHTW,
    ].join('\n  ')),
  },
};

// ============================================================
// weeklyDigest templates
// ============================================================

const weeklyDigestTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '📬 本周积分兑换广场新鲜事，快来看看！',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}，本周积分兑换广场精选来啦！</h2>',
      '<p style="font-size:14px;color:#64748b;">{{weekStart}} ~ {{weekEnd}}</p>',
      '<h3 style="color:#334155;margin-top:24px;">🛍️ 新上架商品</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{productList}}</div>',
      '<h3 style="color:#334155;margin-top:24px;">📖 新发布内容</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">快去积分兑换广场逛逛吧～ 🎉</p>',
      HR,
      STORE_LINK,
      FOOTER_UNSUB_ZH,
    ].join('\n  ')),
  },
  en: {
    subject: '📬 Your Weekly Builder Store Digest',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}, here\'s your weekly digest!</h2>',
      '<p style="font-size:14px;color:#64748b;">{{weekStart}} ~ {{weekEnd}}</p>',
      '<h3 style="color:#334155;margin-top:24px;">🛍️ New Products</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{productList}}</div>',
      '<h3 style="color:#334155;margin-top:24px;">📖 New Content</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">Head to the Builder Store and check it out! 🎉</p>',
      HR,
      STORE_LINK,
      FOOTER_UNSUB_EN,
    ].join('\n  ')),
  },
  ja: {
    subject: '📬 今週のポイント交換広場ダイジェスト',
    body: wrap([
      '<h2 style="color:#6366f1;">{{nickname}} さん、今週のダイジェストです！</h2>',
      '<p style="font-size:14px;color:#64748b;">{{weekStart}} ~ {{weekEnd}}</p>',
      '<h3 style="color:#334155;margin-top:24px;">🛍️ 新着グッズ</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{productList}}</div>',
      '<h3 style="color:#334155;margin-top:24px;">📖 新着コンテンツ</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">ポイント交換広場でチェックしましょう！ 🎉</p>',
      HR,
      STORE_LINK,
      FOOTER_UNSUB_JA,
    ].join('\n  ')),
  },
  ko: {
    subject: '📬 이번 주 포인트 교환 광장 다이제스트',
    body: wrap([
      '<h2 style="color:#6366f1;">{{nickname}} 님, 이번 주 다이제스트입니다!</h2>',
      '<p style="font-size:14px;color:#64748b;">{{weekStart}} ~ {{weekEnd}}</p>',
      '<h3 style="color:#334155;margin-top:24px;">🛍️ 새 굿즈</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{productList}}</div>',
      '<h3 style="color:#334155;margin-top:24px;">📖 새 콘텐츠</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">포인트 교환 광장에서 확인해 보세요! 🎉</p>',
      HR,
      STORE_LINK,
      FOOTER_UNSUB_KO,
    ].join('\n  ')),
  },
  'zh-TW': {
    subject: '📬 本週積分兌換廣場新鮮事，快來看看！',
    body: wrap([
      '<h2 style="color:#6366f1;">Hi {{nickname}}，本週積分兌換廣場精選來啦！</h2>',
      '<p style="font-size:14px;color:#64748b;">{{weekStart}} ~ {{weekEnd}}</p>',
      '<h3 style="color:#334155;margin-top:24px;">🛍️ 新上架商品</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{productList}}</div>',
      '<h3 style="color:#334155;margin-top:24px;">📖 新發佈內容</h3>',
      '<div style="background:#f8fafc;border-radius:8px;padding:16px;margin:12px 0;">{{contentList}}</div>',
      '<p style="margin-top:24px;">快去積分兌換廣場逛逛吧～ 🎉</p>',
      HR,
      STORE_LINK,
      FOOTER_UNSUB_ZHTW,
    ].join('\n  ')),
  },
};

// ============================================================
// wishAdopted templates
// ============================================================

const wishAdoptedTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '🎉 你的许愿被采纳啦！',
    body: wrap(['<h2 style="color:#6366f1;">Hi {{nickname}}，好消息！</h2>','<p style="font-size:16px;color:#334155;">你的许愿 <strong style="color:#6366f1;">{{wishTitle}}</strong> 已被管理员采纳！</p>','<p style="color:#64748b;">我们正在努力为你实现这个愿望，请耐心等待上架通知～</p>',HR,STORE_LINK,FOOTER_ZH].join('\n  ')),
  },
  en: {
    subject: '🎉 Your wish has been adopted!',
    body: wrap(['<h2 style="color:#6366f1;">Hi {{nickname}}, great news!</h2>','<p style="font-size:16px;color:#334155;">Your wish <strong style="color:#6366f1;">{{wishTitle}}</strong> has been adopted by the admin!</p>','<p style="color:#64748b;">We are working on making it happen. Stay tuned for the product launch notification!</p>',HR,STORE_LINK,FOOTER_EN].join('\n  ')),
  },
  ja: {
    subject: '🎉 あなたのウィッシュが採用されました！',
    body: wrap(['<h2 style="color:#6366f1;">{{nickname}} さん、朗報です！</h2>','<p style="font-size:16px;color:#334155;">あなたのウィッシュ <strong style="color:#6366f1;">{{wishTitle}}</strong> が管理者に採用されました！</p>','<p style="color:#64748b;">商品化に向けて準備中です。入荷通知をお待ちください！</p>',HR,STORE_LINK,FOOTER_JA].join('\n  ')),
  },
  ko: {
    subject: '🎉 당신의 위시가 채택되었습니다!',
    body: wrap(['<h2 style="color:#6366f1;">{{nickname}} 님, 좋은 소식입니다!</h2>','<p style="font-size:16px;color:#334155;">당신의 위시 <strong style="color:#6366f1;">{{wishTitle}}</strong>이(가) 관리자에 의해 채택되었습니다!</p>','<p style="color:#64748b;">상품화를 위해 준비 중입니다. 출시 알림을 기다려 주세요!</p>',HR,STORE_LINK,FOOTER_KO].join('\n  ')),
  },
  'zh-TW': {
    subject: '🎉 你的許願被採納啦！',
    body: wrap(['<h2 style="color:#6366f1;">Hi {{nickname}}，好消息！</h2>','<p style="font-size:16px;color:#334155;">你的許願 <strong style="color:#6366f1;">{{wishTitle}}</strong> 已被管理員採納！</p>','<p style="color:#64748b;">我們正在努力為你實現這個願望，請耐心等待上架通知～</p>',HR,STORE_LINK,FOOTER_ZHTW].join('\n  ')),
  },
};

// ============================================================
// wishFulfilled templates
// ============================================================

const wishFulfilledTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '🎊 你的许愿实现啦！商品已上架',
    body: wrap(['<h2 style="color:#6366f1;">Hi {{nickname}}，愿望成真！ 🌟</h2>','<p style="font-size:16px;color:#334155;">你的许愿 <strong style="color:#6366f1;">{{wishTitle}}</strong> 已经实现，商品已上架！</p>','<p style="color:#64748b;">作为感谢，你已获得积分奖励，并拥有该商品的优先购买权。</p>','<p style="margin-top:24px;"><a href="{{productUrl}}" style="color:#6366f1;text-decoration:underline;">点击查看商品 →</a></p>',HR,STORE_LINK,FOOTER_ZH].join('\n  ')),
  },
  en: {
    subject: '🎊 Your wish came true! Product is now available',
    body: wrap(['<h2 style="color:#6366f1;">Hi {{nickname}}, your wish came true! 🌟</h2>','<p style="font-size:16px;color:#334155;">Your wish <strong style="color:#6366f1;">{{wishTitle}}</strong> has been fulfilled and the product is now available!</p>','<p style="color:#64748b;">As a thank you, you have received bonus points and priority purchase access.</p>','<p style="margin-top:24px;"><a href="{{productUrl}}" style="color:#6366f1;text-decoration:underline;">View the product →</a></p>',HR,STORE_LINK,FOOTER_EN].join('\n  ')),
  },
  ja: {
    subject: '🎊 あなたのウィッシュが実現しました！商品が入荷しました',
    body: wrap(['<h2 style="color:#6366f1;">{{nickname}} さん、ウィッシュが実現しました！ 🌟</h2>','<p style="font-size:16px;color:#334155;">あなたのウィッシュ <strong style="color:#6366f1;">{{wishTitle}}</strong> が実現し、商品が入荷しました！</p>','<p style="color:#64748b;">感謝の気持ちとして、ボーナスポイントと優先購入権が付与されました。</p>','<p style="margin-top:24px;"><a href="{{productUrl}}" style="color:#6366f1;text-decoration:underline;">商品を見る →</a></p>',HR,STORE_LINK,FOOTER_JA].join('\n  ')),
  },
  ko: {
    subject: '🎊 당신의 위시가 실현되었습니다! 상품이 출시되었습니다',
    body: wrap(['<h2 style="color:#6366f1;">{{nickname}} 님, 위시가 실현되었습니다! 🌟</h2>','<p style="font-size:16px;color:#334155;">당신의 위시 <strong style="color:#6366f1;">{{wishTitle}}</strong>이(가) 실현되어 상품이 출시되었습니다!</p>','<p style="color:#64748b;">감사의 의미로 보너스 포인트와 우선 구매권이 부여되었습니다.</p>','<p style="margin-top:24px;"><a href="{{productUrl}}" style="color:#6366f1;text-decoration:underline;">상품 보기 →</a></p>',HR,STORE_LINK,FOOTER_KO].join('\n  ')),
  },
  'zh-TW': {
    subject: '🎊 你的許願實現啦！商品已上架',
    body: wrap(['<h2 style="color:#6366f1;">Hi {{nickname}}，願望成真！ 🌟</h2>','<p style="font-size:16px;color:#334155;">你的許願 <strong style="color:#6366f1;">{{wishTitle}}</strong> 已經實現，商品已上架！</p>','<p style="color:#64748b;">作為感謝，你已獲得積分獎勵，並擁有該商品的優先購買權。</p>','<p style="margin-top:24px;"><a href="{{productUrl}}" style="color:#6366f1;text-decoration:underline;">點擊查看商品 →</a></p>',HR,STORE_LINK,FOOTER_ZHTW].join('\n  ')),
  },
};

// ============================================================
// wishRejected templates
// ============================================================

const wishRejectedTemplates: Record<EmailLocale, { subject: string; body: string }> = {
  zh: {
    subject: '💬 你的许愿未通过审核',
    body: wrap(['<h2 style="color:#6366f1;">Hi {{nickname}}，关于你的许愿</h2>','<p style="font-size:16px;color:#334155;">很遗憾，你的许愿 <strong>{{wishTitle}}</strong> 未通过审核。</p>','<p style="color:#64748b;">原因：{{closeReason}}</p>','<p style="margin-top:24px;color:#64748b;">你可以修改后重新提交，期待你的下一个许愿～</p>',HR,STORE_LINK,FOOTER_ZH].join('\n  ')),
  },
  en: {
    subject: '💬 Your wish was not approved',
    body: wrap(['<h2 style="color:#6366f1;">Hi {{nickname}}, about your wish</h2>','<p style="font-size:16px;color:#334155;">Unfortunately, your wish <strong>{{wishTitle}}</strong> was not approved.</p>','<p style="color:#64748b;">Reason: {{closeReason}}</p>','<p style="margin-top:24px;color:#64748b;">You can revise and resubmit. We look forward to your next wish!</p>',HR,STORE_LINK,FOOTER_EN].join('\n  ')),
  },
  ja: {
    subject: '💬 あなたのウィッシュは審査を通過しませんでした',
    body: wrap(['<h2 style="color:#6366f1;">{{nickname}} さん、ウィッシュについて</h2>','<p style="font-size:16px;color:#334155;">残念ながら、あなたのウィッシュ <strong>{{wishTitle}}</strong> は審査を通過しませんでした。</p>','<p style="color:#64748b;">理由：{{closeReason}}</p>','<p style="margin-top:24px;color:#64748b;">修正して再提出できます。次のウィッシュをお待ちしています！</p>',HR,STORE_LINK,FOOTER_JA].join('\n  ')),
  },
  ko: {
    subject: '💬 당신의 위시가 승인되지 않았습니다',
    body: wrap(['<h2 style="color:#6366f1;">{{nickname}} 님, 위시에 대해</h2>','<p style="font-size:16px;color:#334155;">안타깝게도 당신의 위시 <strong>{{wishTitle}}</strong>이(가) 승인되지 않았습니다.</p>','<p style="color:#64748b;">사유: {{closeReason}}</p>','<p style="margin-top:24px;color:#64748b;">수정 후 다시 제출할 수 있습니다. 다음 위시를 기대합니다!</p>',HR,STORE_LINK,FOOTER_KO].join('\n  ')),
  },
  'zh-TW': {
    subject: '💬 你的許願未通過審核',
    body: wrap(['<h2 style="color:#6366f1;">Hi {{nickname}}，關於你的許願</h2>','<p style="font-size:16px;color:#334155;">很遺憾，你的許願 <strong>{{wishTitle}}</strong> 未通過審核。</p>','<p style="color:#64748b;">原因：{{closeReason}}</p>','<p style="margin-top:24px;color:#64748b;">你可以修改後重新提交，期待你的下一個許願～</p>',HR,STORE_LINK,FOOTER_ZHTW].join('\n  ')),
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
  contentUpdated: contentUpdatedTemplates,
  weeklyDigest: weeklyDigestTemplates,
  wishAdopted: wishAdoptedTemplates,
  wishFulfilled: wishFulfilledTemplates,
  wishRejected: wishRejectedTemplates,
};

const ALL_LOCALES: EmailLocale[] = ['zh', 'en', 'ja', 'ko', 'zh-TW'];
const ALL_TYPES: NotificationType[] = ['pointsEarned', 'newOrder', 'orderShipped', 'newProduct', 'newContent', 'contentUpdated', 'weeklyDigest', 'wishAdopted', 'wishFulfilled', 'wishRejected'];

// ============================================================
// Public API
// ============================================================

/**
 * Return all 50 default email templates (10 notification types × 5 locales).
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

/** DynamoDB BatchWriteCommand supports max 25 items per request. */
const DYNAMO_BATCH_WRITE_LIMIT = 25;

/**
 * Seed all 50 default templates into DynamoDB using BatchWriteCommand.
 * DynamoDB BatchWriteCommand supports max 25 items per request,
 * so we split into batches of 25.
 */
export async function seedDefaultTemplates(
  dynamoClient: DynamoDBDocumentClient,
  tableName: string,
): Promise<void> {
  const templates = getDefaultTemplates();

  for (let i = 0; i < templates.length; i += DYNAMO_BATCH_WRITE_LIMIT) {
    const batch = templates.slice(i, i + DYNAMO_BATCH_WRITE_LIMIT);

    await dynamoClient.send(
      new BatchWriteCommand({
        RequestItems: {
          [tableName]: batch.map((template) => ({
            PutRequest: {
              Item: template,
            },
          })),
        },
      }),
    );
  }

  console.log(`[EmailSeed] Seeded ${templates.length} default email templates`);
}
