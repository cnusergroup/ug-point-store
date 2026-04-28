// HTML renderer for community credential pages
// Self-contained HTML with inline CSS, OG meta tags, QR code SVG, i18n text

import QRCode from 'qrcode';
import { getStrings, type Locale } from './i18n';
import type { Credential } from './types';

export interface RenderOptions {
  credential: Credential;
  baseUrl: string; // e.g. "https://store.awscommunity.cn"
}

/**
 * Build LinkedIn "Add Certification" URL with encoded parameters.
 * Format: https://www.linkedin.com/profile/add?startTask=CERTIFICATION_NAME
 *   &name=...&organizationName=...&issueYear=...&issueMonth=...&certUrl=...&certId=...
 */
export function buildLinkedInUrl(credential: Credential, baseUrl: string): string {
  const strings = getStrings(credential.locale);
  const roleName = strings.roles[credential.role] || credential.role;
  const certName = `${roleName} - ${credential.eventName}`;
  const credentialUrl = `${baseUrl}/c/${credential.credentialId}`;

  // Parse year and month from issueDate (ISO format: YYYY-MM-DD)
  const dateParts = credential.issueDate.split('-');
  const issueYear = dateParts[0];
  const issueMonth = dateParts[1] ? String(parseInt(dateParts[1], 10)) : '1';

  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: certName,
    organizationName: credential.issuingOrganization,
    issueYear,
    issueMonth,
    certUrl: credentialUrl,
    certId: credential.credentialId,
  });

  return `https://www.linkedin.com/profile/add?${params.toString()}`;
}

/**
 * Generate QR code as inline SVG string using the qrcode library.
 */
export async function generateQrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: 'svg', margin: 1, width: 120 });
}

/** Escape HTML special characters to prevent XSS */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}


/** Inline CSS for the credential page */
function getInlineStyles(): string {
  return `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #1e293b;
    }
    .credential-wrapper {
      width: 100%;
      max-width: 640px;
    }
    .credential-card {
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.3), 0 0 0 1px rgba(255,255,255,0.1);
      overflow: hidden;
    }
    .card-header {
      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
      padding: 32px 32px 24px;
      color: #ffffff;
      position: relative;
    }
    .card-header.revoked {
      background: linear-gradient(135deg, #64748b 0%, #475569 100%);
    }
    .org-name {
      font-size: 13px;
      font-weight: 500;
      opacity: 0.9;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-bottom: 12px;
    }
    .recipient-name {
      font-size: 28px;
      font-weight: 700;
      line-height: 1.2;
      margin-bottom: 8px;
    }
    .role-badge {
      display: inline-block;
      background: rgba(255,255,255,0.2);
      border-radius: 20px;
      padding: 4px 14px;
      font-size: 14px;
      font-weight: 500;
    }
    .revoked-banner {
      background: #dc2626;
      color: #ffffff;
      text-align: center;
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }
    .card-body {
      padding: 28px 32px;
    }
    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 20px;
    }
    .detail-item {
      display: flex;
      flex-direction: column;
    }
    .detail-item.full-width {
      grid-column: 1 / -1;
    }
    .detail-label {
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }
    .detail-value {
      font-size: 15px;
      font-weight: 500;
      color: #1e293b;
      word-break: break-word;
    }
    .divider {
      height: 1px;
      background: #e2e8f0;
      margin: 24px 0;
    }
    .verification-panel {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      display: flex;
      gap: 20px;
      align-items: flex-start;
    }
    .verification-info { flex: 1; }
    .verification-title {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .status-dot {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      display: inline-block;
    }
    .status-dot.active { background: #22c55e; }
    .status-dot.revoked { background: #dc2626; }
    .verification-desc {
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }
    .verification-url {
      font-size: 12px;
      color: #94a3b8;
      word-break: break-all;
      margin-top: 8px;
    }
    .qr-code {
      flex-shrink: 0;
    }
    .qr-code svg {
      display: block;
      width: 100px;
      height: 100px;
    }
    .card-footer {
      padding: 0 32px 28px;
    }
    .linkedin-btn {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: #0a66c2;
      color: #ffffff;
      text-decoration: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      transition: background 0.2s;
      cursor: pointer;
    }
    .linkedin-btn:hover { background: #004182; }
    .linkedin-icon {
      width: 18px;
      height: 18px;
      fill: currentColor;
    }
    @media (max-width: 480px) {
      body { padding: 16px; }
      .card-header { padding: 24px 20px 20px; }
      .recipient-name { font-size: 22px; }
      .card-body { padding: 20px; }
      .detail-grid { grid-template-columns: 1fr; gap: 16px; }
      .verification-panel { flex-direction: column; align-items: center; text-align: center; }
      .card-footer { padding: 0 20px 20px; }
      .linkedin-btn { width: 100%; justify-content: center; }
    }
  `;
}

/** LinkedIn SVG icon (inline) */
const LINKEDIN_SVG = `<svg class="linkedin-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`;

/**
 * Render a complete HTML credential page.
 * Self-contained: inline CSS, no external stylesheets or scripts.
 */
export async function renderCredentialPage(options: RenderOptions): Promise<string> {
  const { credential, baseUrl } = options;
  const strings = getStrings(credential.locale);
  const roleName = strings.roles[credential.role] || credential.role;
  const credentialUrl = `${baseUrl}/c/${credential.credentialId}`;
  const isRevoked = credential.status === 'revoked';

  // Page title from i18n template
  const pageTitle = strings.pageTitle
    .replace('{name}', credential.recipientName)
    .replace('{role}', roleName)
    .replace('{event}', credential.eventName);

  // OG description
  const ogDescription = isRevoked
    ? `${credential.eventName} | ${credential.issuingOrganization} | ${strings.revoked}`
    : `${credential.eventName} | ${credential.issuingOrganization}`;

  const ogImageUrl = `${baseUrl}/og-credential.png`;

  // QR code SVG
  const qrSvg = await generateQrSvg(credentialUrl);

  // Verification description with org name
  const verificationDesc = strings.verificationDescription.replace('{org}', credential.issuingOrganization);

  // LinkedIn URL (only for active credentials)
  const linkedInUrl = isRevoked ? '' : buildLinkedInUrl(credential, baseUrl);

  // Build optional detail items
  const optionalDetails: string[] = [];
  if (credential.eventDate) {
    optionalDetails.push(`
      <div class="detail-item">
        <span class="detail-label">${escapeHtml(strings.eventDate)}</span>
        <span class="detail-value">${escapeHtml(credential.eventDate)}</span>
      </div>`);
  }
  if (credential.eventLocation) {
    optionalDetails.push(`
      <div class="detail-item">
        <span class="detail-label">${escapeHtml(strings.eventLocation)}</span>
        <span class="detail-value">${escapeHtml(credential.eventLocation)}</span>
      </div>`);
  }
  if (credential.contribution) {
    optionalDetails.push(`
      <div class="detail-item full-width">
        <span class="detail-label">${escapeHtml(strings.contribution)}</span>
        <span class="detail-value">${escapeHtml(credential.contribution)}</span>
      </div>`);
  }

  return `<!DOCTYPE html>
<html lang="${credential.locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(pageTitle)}</title>
  <meta property="og:title" content="${escapeHtml(`${credential.recipientName} - ${roleName}`)}" />
  <meta property="og:description" content="${escapeHtml(ogDescription)}" />
  <meta property="og:url" content="${escapeHtml(credentialUrl)}" />
  <meta property="og:type" content="website" />
  <meta property="og:image" content="${escapeHtml(ogImageUrl)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${escapeHtml(`${credential.recipientName} - ${roleName}`)}" />
  <meta name="twitter:description" content="${escapeHtml(ogDescription)}" />
  <meta name="twitter:image" content="${escapeHtml(ogImageUrl)}" />
  <style>${getInlineStyles()}</style>
</head>
<body>
  <div class="credential-wrapper">
    <div class="credential-card">
      <div class="card-header${isRevoked ? ' revoked' : ''}">
        <div class="org-name">${escapeHtml(credential.issuingOrganization)}</div>
        <div class="recipient-name">${escapeHtml(credential.recipientName)}</div>
        <span class="role-badge">${escapeHtml(roleName)}</span>
      </div>${isRevoked ? `
      <div class="revoked-banner">${escapeHtml(strings.revokedNotice)}</div>` : ''}
      <div class="card-body">
        <div class="detail-grid">
          <div class="detail-item">
            <span class="detail-label">${escapeHtml(strings.issueDate)}</span>
            <span class="detail-value">${escapeHtml(credential.issueDate)}</span>
          </div>
          <div class="detail-item">
            <span class="detail-label">${escapeHtml(strings.issuingOrganization)}</span>
            <span class="detail-value">${escapeHtml(credential.issuingOrganization)}</span>
          </div>
          <div class="detail-item full-width">
            <span class="detail-label">${escapeHtml(strings.credentialId)}</span>
            <span class="detail-value">${escapeHtml(credential.credentialId)}</span>
          </div>${optionalDetails.join('')}
        </div>
        <div class="divider"></div>
        <div class="verification-panel">
          <div class="verification-info">
            <div class="verification-title">
              <span class="status-dot ${isRevoked ? 'revoked' : 'active'}"></span>
              ${escapeHtml(isRevoked ? strings.revoked : strings.verified)}
            </div>
            <div class="verification-desc">${escapeHtml(verificationDesc)}</div>
            <div class="verification-url">${escapeHtml(credentialUrl)}</div>
          </div>
          <div class="qr-code">${qrSvg}</div>
        </div>
      </div>${!isRevoked ? `
      <div class="card-footer">
        <a class="linkedin-btn" href="${escapeHtml(linkedInUrl)}" target="_blank" rel="noopener noreferrer">
          ${LINKEDIN_SVG}
          ${escapeHtml(strings.addToLinkedIn)}
        </a>
      </div>` : ''}
    </div>
  </div>
</body>
</html>`;
}


/**
 * Render a friendly 404 page with back-to-home link.
 */
export function render404Page(locale: Locale): string {
  const isZh = locale === 'zh';
  const title = isZh ? '页面未找到' : 'Page Not Found';
  const heading = '404';
  const message = isZh
    ? '您访问的凭证页面不存在或已被移除。'
    : 'The credential page you are looking for does not exist or has been removed.';
  const backText = isZh ? '返回首页' : 'Back to Home';

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      min-height: 100vh;
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #334155 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
      color: #e2e8f0;
    }
    .error-container {
      text-align: center;
      max-width: 480px;
    }
    .error-code {
      font-size: 96px;
      font-weight: 800;
      color: #f97316;
      line-height: 1;
      margin-bottom: 16px;
    }
    .error-message {
      font-size: 16px;
      color: #94a3b8;
      line-height: 1.6;
      margin-bottom: 32px;
    }
    .back-link {
      display: inline-block;
      background: #f97316;
      color: #ffffff;
      text-decoration: none;
      padding: 12px 28px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      transition: background 0.2s;
    }
    .back-link:hover { background: #ea580c; }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-code">${heading}</div>
    <p class="error-message">${escapeHtml(message)}</p>
    <a class="back-link" href="/">${escapeHtml(backText)}</a>
  </div>
</body>
</html>`;
}
