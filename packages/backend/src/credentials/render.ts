// HTML renderer for community credential pages
// Redesigned to match the reference credential page at creds.awscommunityday.com
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
 */
export function buildLinkedInUrl(credential: Credential, baseUrl: string): string {
  const strings = getStrings(credential.locale);
  const roleName = strings.roles[credential.role] || credential.role;
  // Collapse any admin-entered line breaks in the event name to single spaces —
  // this value is embedded in a LinkedIn URL parameter.
  const eventNameOneLine = credential.eventName.replace(/\s+/g, ' ').trim();
  const certName = `${roleName} - ${eventNameOneLine}`;
  const credentialUrl = `${baseUrl}/c/${credential.credentialId}`;

  const dateParts = credential.issueDate.split('-');
  const issueYear = dateParts[0];
  const issueMonth = dateParts[1] ? String(parseInt(dateParts[1], 10)) : '1';

  const params = new URLSearchParams({
    startTask: 'CERTIFICATION_NAME',
    name: certName,
    organizationName: 'AWS User Group China', // Always use English name for LinkedIn company page matching
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

/**
 * Escape HTML, then convert newlines to <br> for inline display.
 * Used for the event name, which admins may enter with manual line breaks.
 * CRLF/CR are normalized to LF first so a single <br> is produced per break.
 */
function escapeHtmlWithBreaks(str: string): string {
  return escapeHtml(str).replace(/\r\n|\r|\n/g, '<br>');
}

/** Collapse any newlines/whitespace runs into single spaces (for <title>/OG meta). */
function singleLine(str: string): string {
  return str.replace(/\s+/g, ' ').trim();
}


/* ── SVG Icons (inline, no external deps) ── */

const ICON_CALENDAR = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`;

const ICON_LOCATION = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>`;

const ICON_ORG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`;

const ICON_ID = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`;

const ICON_SHIELD = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="url(#shieldGrad)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><defs><linearGradient id="shieldGrad" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#8b5cf6"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4" stroke="#22c55e" stroke-width="2"/></svg>`;

const ICON_WARNING = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`;

const LINKEDIN_SVG = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`;

const ICON_SHIELD_PILL = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;

const ICON_COPY = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>`;

const ICON_DOWNLOAD = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;


/** Inline CSS matching the reference credential page design */
function getInlineStyles(baseUrl: string): string {
  return `
    :root {
      --bg: #07131f;
      --card-bg: #071c31;
      --border: rgba(255,255,255,0.08);
      --text: #ffffff;
      --muted: #8899aa;
      --purple: #8b5cf6;
      --pink: #ec4899;
      --orange: #f97316;
      --radius: 20px;
    }
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{
      font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;
      min-height:100vh;
      background:var(--bg);
      color:var(--text);
      display:flex;align-items:center;justify-content:center;
      padding:40px 24px;
      position:relative;overflow-x:hidden;
    }
    body::before{
      content:'';position:fixed;top:-40%;left:50%;transform:translateX(-50%);
      width:120%;height:80%;
      background:radial-gradient(ellipse at center,rgba(139,92,246,0.10) 0%,rgba(139,92,246,0.03) 40%,transparent 70%);
      pointer-events:none;z-index:0;
    }
    .page-wrapper{width:100%;max-width:1104px;position:relative;z-index:1}
    .credential-shell{
      background:var(--card-bg) url("${baseUrl}/products/cert-bg.png") center top / 100% auto no-repeat;
      border-radius:var(--radius);border:1px solid var(--border);
      overflow:hidden;position:relative;
    }
    .hero{text-align:center;padding:108px 56px 36px}
    .verified-pill{
      display:inline-flex;align-items:center;gap:6px;
      background:rgba(139,92,246,0.12);border:1px solid rgba(139,92,246,0.25);
      border-radius:100px;padding:6px 16px;
      font-size:12px;font-weight:700;color:var(--purple);
      margin-bottom:28px;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap;
    }
    .recipient-name{
      font-size:clamp(40px,6vw,72px);font-weight:700;line-height:1.1;
      letter-spacing:-0.5px;margin-bottom:20px;color:var(--text);
    }
    .gradient-divider{
      width:120px;height:3px;margin:0 auto 20px;border-radius:2px;
      background:linear-gradient(90deg,var(--purple),var(--pink),var(--orange));
    }
    .verb-line{font-size:16px;color:var(--muted);margin-bottom:8px;line-height:1.5;text-transform:lowercase}
    .event-name{
      font-size:clamp(28px,3.6vw,40px);font-weight:700;
      background:linear-gradient(90deg,var(--purple),var(--pink),var(--orange));
      -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
      line-height:1.3;margin-bottom:16px;
    }
    .appreciation{font-size:14px;color:var(--muted);max-width:480px;margin:0 auto;line-height:1.6}
    .hosted-by{font-size:15px;color:var(--muted);margin-bottom:12px;letter-spacing:0.3px;text-transform:lowercase}
    .contribution-text{font-size:14px;color:var(--muted);margin-top:8px;max-width:480px;margin-left:auto;margin-right:auto;line-height:1.6}
    .info-grid{
      display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));
      border-top:1px solid var(--border);border-bottom:1px solid var(--border);
    }
    .info-cell{padding:20px 16px;text-align:center;position:relative}
    .info-cell+.info-cell::before{
      content:'';position:absolute;left:0;top:20%;height:60%;width:1px;background:var(--border);
    }
    .info-cell .icon{color:var(--muted);margin-bottom:8px;display:flex;justify-content:center}
    .info-cell .label{
      font-size:11px;font-weight:600;color:var(--muted);
      text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px;
    }
    .info-cell .value{font-size:14px;font-weight:500;color:var(--text);word-break:break-word}
    .verification-section{padding:28px 56px}
    .verification-panel{
      background:rgba(255,255,255,0.04);border:1px solid var(--border);
      border-radius:16px;padding:24px;display:flex;gap:24px;align-items:flex-start;
    }
    .shield-badge{flex-shrink:0;width:48px;height:48px;display:flex;align-items:center;justify-content:center}
    .verification-body{flex:1;min-width:0}
    .verification-title{font-size:16px;font-weight:600;color:var(--text);margin-bottom:6px}
    .verification-desc{font-size:13px;color:var(--muted);line-height:1.6;margin-bottom:10px}
    .verify-link{font-size:13px;color:var(--purple);text-decoration:none;font-weight:500;word-break:break-all}
    .verify-link:hover{text-decoration:underline}
    .verify-online-label{font-size:12px;color:var(--muted);font-weight:600;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px}
    .qr-box{
      flex-shrink:0;background:#ffffff;border-radius:12px;padding:8px;
      display:flex;align-items:center;justify-content:center;
    }
    .qr-box svg{display:block;width:96px;height:96px}
    .revoked-banner{
      position:absolute;top:0;right:0;width:150px;height:150px;
      overflow:hidden;pointer-events:none;z-index:10;
    }
    .revoked-banner span{
      display:block;position:absolute;top:28px;right:-40px;width:200px;
      text-align:center;padding:6px 0;background:#dc2626;color:#fff;
      font-size:12px;font-weight:700;letter-spacing:1px;text-transform:uppercase;
      transform:rotate(45deg);box-shadow:0 2px 8px rgba(220,38,38,0.4);
    }
    .revoked-pill{
      display:inline-flex;align-items:center;gap:6px;
      background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.25);
      border-radius:100px;padding:6px 16px;
      font-size:12px;font-weight:700;color:#f87171;
      margin-bottom:28px;letter-spacing:1.5px;text-transform:uppercase;white-space:nowrap;
    }
    .warning-panel{
      background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.2);
      border-radius:16px;padding:24px;display:flex;gap:16px;align-items:flex-start;
    }
    .warning-panel .warning-icon{flex-shrink:0}
    .warning-panel .warning-title{font-size:16px;font-weight:600;color:#f87171;margin-bottom:4px}
    .warning-panel .warning-desc{font-size:13px;color:var(--muted);line-height:1.6}
    .actions{padding:0 56px 28px;display:flex;gap:12px;flex-wrap:wrap}
    .linkedin-btn{
      display:inline-flex;align-items:center;gap:8px;
      background:linear-gradient(135deg,var(--purple),var(--pink),var(--orange));
      color:#fff;text-decoration:none;padding:12px 28px;border-radius:12px;
      font-size:14px;font-weight:600;border:none;cursor:pointer;transition:opacity 0.2s;
    }
    .linkedin-btn:hover{opacity:0.9}
    .btn-copy{
      display:inline-flex;align-items:center;gap:8px;
      background:transparent;color:var(--muted);border:1px solid var(--border);
      padding:12px 28px;border-radius:12px;font-size:14px;font-weight:500;
      cursor:pointer;transition:border-color 0.2s,color 0.2s;font-family:inherit;
    }
    .btn-copy:hover{border-color:rgba(255,255,255,0.3);color:var(--text)}
    .credential-footer{text-align:center;padding:20px 56px 28px;border-top:1px solid var(--border)}
    .credential-footer p{font-size:12px;color:rgba(136,153,170,0.6);line-height:1.6}
    /* No mobile breakpoints — viewport meta forces desktop layout on all devices */
    @media print{
      @page{size:landscape;margin:0}
      body{background:#071c31!important;padding:0;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
      body::before{display:none}
      .page-wrapper{max-width:100%;width:100%}
      .verification-section,.actions,.credential-footer,.revoked-banner{display:none!important}
      .credential-shell{border:none;box-shadow:none;border-radius:0;background-color:#071c31!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .hero{padding-top:80px}
      .info-grid{break-inside:avoid}
      .verified-pill,.gradient-divider,.recipient-name,.verb-line,.event-name,.appreciation,.contribution-text,.info-cell,.info-cell .label,.info-cell .value,.info-cell .icon{-webkit-print-color-adjust:exact;print-color-adjust:exact;color-adjust:exact}
    }
  `;
}


/**
 * Render the full credential HTML page.
 * Returns a self-contained HTML string with inline CSS, OG/Twitter meta tags,
 * QR code SVG, and i18n text. Matches the reference design at creds.awscommunityday.com.
 */
export async function renderCredentialPage(options: RenderOptions): Promise<string> {
  const { credential, baseUrl } = options;
  const s = getStrings(credential.locale);
  const isRevoked = credential.status === 'revoked';
  const credentialUrl = `${baseUrl}/c/${credential.credentialId}`;
  // Self-applied credentials persist an admin-configured identityText to display as
  // the credential identity. Prefer it when present (non-empty); otherwise fall back
  // to the existing translated role name. Batch credentials have no identityText and
  // therefore render exactly as before (backward compatibility — Requirement 11.6).
  const roleName = credential.identityText || s.roles[credential.role] || credential.role;

  // Page title & description for OG tags — must be single-line (no manual breaks)
  const singleLineEvent = singleLine(credential.eventName);
  const pageTitle = s.pageTitle
    .replace('{name}', credential.recipientName)
    .replace('{role}', roleName)
    .replace('{event}', singleLineEvent);
  const ogDescription = isRevoked
    ? `${s.revoked} — ${roleName} | ${singleLineEvent}`
    : `${s.verified} — ${roleName} | ${singleLineEvent}`;
  const ogImage = `${baseUrl}/products/cert-bg.png`;

  // Generate QR code SVG
  const qrSvg = await generateQrSvg(credentialUrl);

  // LinkedIn URL (only for active)
  const linkedInUrl = isRevoked ? '' : buildLinkedInUrl(credential, baseUrl);

  // Escaped user content
  const eName = escapeHtml(credential.recipientName);
  // Event name displayed in the hero — preserve admin-entered line breaks as <br>
  const eEvent = escapeHtmlWithBreaks(credential.eventName);
  const eOrg = escapeHtml(credential.locale === 'zh' && credential.issuingOrganization === 'AWS User Group China'
    ? '\u4e9a\u9a6c\u900a\u4e91\u79d1\u6280 User Group China'
    : credential.issuingOrganization);
  const eCredId = escapeHtml(credential.credentialId);
  const eIssueDate = escapeHtml(credential.issueDate);
  const eRole = escapeHtml(roleName);
  const eEventDate = credential.eventDate ? escapeHtml(credential.eventDate) : '';
  const eEventLocation = credential.eventLocation ? escapeHtml(credential.eventLocation) : '';
  const eContribution = credential.contribution ? escapeHtml(credential.contribution) : '';

  // Build info grid cells — always show Issue Date, Organized By, Credential ID
  // Optionally show Event Date and Event Location when provided
  const infoCells: string[] = [];

  if (credential.eventDate) {
    infoCells.push(`<div class="info-cell"><div class="icon">${ICON_CALENDAR}</div><div class="label">${escapeHtml(s.eventDate)}</div><div class="value">${eEventDate}</div></div>`);
  }
  if (credential.eventLocation) {
    infoCells.push(`<div class="info-cell"><div class="icon">${ICON_LOCATION}</div><div class="label">${escapeHtml(s.eventLocation)}</div><div class="value">${eEventLocation}</div></div>`);
  }
  infoCells.push(`<div class="info-cell"><div class="icon">${ICON_CALENDAR}</div><div class="label">${escapeHtml(s.issueDate)}</div><div class="value">${eIssueDate}</div></div>`);
  infoCells.push(`<div class="info-cell"><div class="icon">${ICON_ORG}</div><div class="label">${escapeHtml(s.issuingOrganization)}</div><div class="value">${eOrg}</div></div>`);
  infoCells.push(`<div class="info-cell"><div class="icon">${ICON_ID}</div><div class="label">${escapeHtml(s.credentialId)}</div><div class="value">${eCredId}</div></div>`);

  // Verification description with org placeholder
  const verificationDesc = escapeHtml(s.verificationDescription).replace('{org}', eOrg);

  // Footer issued text
  const footerIssued = escapeHtml(s.footerIssued).replace('{date}', eIssueDate);

  // Status pill
  const statusPill = isRevoked
    ? `<div class="revoked-pill">${ICON_SHIELD_PILL} ${escapeHtml(s.revokedNotice)}</div>`
    : `<div class="verified-pill">${ICON_SHIELD_PILL} ${escapeHtml(s.verifiedCredential)}</div>`;

  // Revoked banner (diagonal corner)
  const revokedBanner = isRevoked
    ? `<div class="revoked-banner"><span>${escapeHtml(s.revoked)}</span></div>`
    : '';

  // Verb line
  const verbLine = s.verbLine[credential.role] || '';

  // Verification or warning panel
  let panelHtml: string;
  if (isRevoked) {
    panelHtml = `
      <div class="verification-section">
        <div class="warning-panel">
          <div class="warning-icon">${ICON_WARNING}</div>
          <div>
            <div class="warning-title">${escapeHtml(s.revokedWarningTitle)}</div>
            <div class="warning-desc">${escapeHtml(s.revokedWarningDescription)}</div>
          </div>
        </div>
      </div>`;
  } else {
    panelHtml = `
      <div class="verification-section">
        <div class="verification-panel">
          <div class="shield-badge">${ICON_SHIELD}</div>
          <div class="verification-body">
            <div class="verification-title">${escapeHtml(s.verificationTitle)}</div>
            <div class="verification-desc">${verificationDesc}</div>
            <div class="verify-online-label">${escapeHtml(s.verifyOnline)}</div>
            <a class="verify-link" href="${escapeHtml(credentialUrl)}" target="_blank" rel="noopener">${escapeHtml(credentialUrl)}</a>
          </div>
          <div class="qr-box">${qrSvg}</div>
        </div>
      </div>`;
  }

  // Action buttons
  let actionsHtml = '';
  if (!isRevoked) {
    actionsHtml = `
      <div class="actions">
        <a class="linkedin-btn" href="${escapeHtml(linkedInUrl)}" target="_blank" rel="noopener">${LINKEDIN_SVG} ${escapeHtml(s.addToLinkedIn)}</a>
        <button class="btn-copy" id="copyBtn" type="button">${ICON_COPY} ${escapeHtml(s.copyLink)}</button>
        <button class="btn-copy" id="downloadBtn" type="button">${ICON_DOWNLOAD} ${escapeHtml(s.downloadCert)}</button>
      </div>`;
  }

  // Contribution text
  const contributionHtml = eContribution
    ? `<div class="contribution-text">${escapeHtml(s.contribution)}: ${eContribution}</div>`
    : '';

  // Copy script (inline, no external)
  const copyScript = !isRevoked ? `
<script>
(function(){
  var btn=document.getElementById('copyBtn');
  if(!btn)return;
  btn.addEventListener('click',function(){
    var url=${JSON.stringify(credentialUrl)};
    if(navigator.clipboard){navigator.clipboard.writeText(url).then(function(){btn.textContent='${s.copiedLink}';setTimeout(function(){btn.innerHTML='${ICON_COPY} ${escapeHtml(s.copyLink)}'},2000)});}
  });
})();
(function(){
  var dl=document.getElementById('downloadBtn');
  if(!dl)return;
  dl.addEventListener('click',function(){
    dl.textContent='${credential.locale === 'zh' ? '\u751F\u6210\u4E2D...' : 'Generating...'}';
    dl.disabled=true;
    var el=document.getElementById('cert-body');
    // Hide sections not needed in PDF
    var hide=['.verification-section','.actions','.credential-footer'];
    var hidden=[];
    hide.forEach(function(s){var e=el.querySelector(s);if(e){hidden.push({el:e,d:e.style.display});e.style.display='none';}});
    // Convert background image to base64 to avoid CORS issues with html-to-image
    var origBg=el.style.backgroundImage;
    function doCapture(){
      htmlToImage.toPng(el,{pixelRatio:2,backgroundColor:null}).then(function(dataUrl){
        // Restore DOM
        hidden.forEach(function(h){h.el.style.display=h.d;});
        el.style.backgroundImage=origBg;
        var img=new Image();
        img.onload=function(){
          var pdf=new jspdf.jsPDF({orientation:'landscape',unit:'px',format:[img.width/2,img.height/2]});
          pdf.addImage(dataUrl,'PNG',0,0,img.width/2,img.height/2);
          pdf.save('${escapeHtml(credential.credentialId)}.pdf');
          dl.innerHTML='${ICON_DOWNLOAD} ${escapeHtml(s.downloadCert)}';
          dl.disabled=false;
        };
        img.src=dataUrl;
      }).catch(function(err){
        console.error('PDF generation failed:',err);
        hidden.forEach(function(h){h.el.style.display=h.d;});
        el.style.backgroundImage=origBg;
        dl.innerHTML='${ICON_DOWNLOAD} ${escapeHtml(s.downloadCert)}';
        dl.disabled=false;
      });
    }
    // Fetch bg image and inline as data URL
    var bgUrl='${baseUrl}/products/cert-bg.png';
    fetch(bgUrl).then(function(r){return r.blob()}).then(function(blob){
      var reader=new FileReader();
      reader.onloadend=function(){
        var cs=getComputedStyle(el);
        var bgPos=cs.backgroundPosition||'center top';
        var bgSize=cs.backgroundSize||'100% auto';
        var bgRepeat=cs.backgroundRepeat||'no-repeat';
        var bgColor=cs.backgroundColor||'#071c31';
        el.style.background=bgColor+' url('+reader.result+') '+bgPos+'/'+bgSize+' '+bgRepeat;
        doCapture();
      };
      reader.readAsDataURL(blob);
    }).catch(function(){doCapture()});
  });
})();
</script>
<script src="https://cdn.jsdelivr.net/npm/html-to-image@1.11.11/dist/html-to-image.js"></script>
<script src="https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"></script>` : '';

  return `<!DOCTYPE html>
<html lang="${credential.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=1200">
<title>${escapeHtml(pageTitle)}</title>
<meta property="og:title" content="${escapeHtml(pageTitle)}">
<meta property="og:description" content="${escapeHtml(ogDescription)}">
<meta property="og:url" content="${escapeHtml(credentialUrl)}">
<meta property="og:type" content="website">
<meta property="og:image" content="${escapeHtml(ogImage)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(pageTitle)}">
<meta name="twitter:description" content="${escapeHtml(ogDescription)}">
<meta name="twitter:image" content="${escapeHtml(ogImage)}">
<style>${getInlineStyles(baseUrl)}</style>
</head>
<body>
<div class="page-wrapper">
  <div class="credential-shell" id="cert-body">
    ${revokedBanner}
    <div class="hero">
      ${statusPill}
      <div class="recipient-name">${eName}</div>
      <div class="gradient-divider"></div>
      <div class="verb-line">${escapeHtml(verbLine)}</div>
      <div class="event-name">${eEvent}</div>
      <div class="hosted-by">hosted by ${credential.hostByLine ? escapeHtml(credential.hostByLine) : 'User Group China'}</div>
      <div class="appreciation">${escapeHtml(s.appreciationText)}</div>
      ${contributionHtml}
    </div>
    <div class="info-grid">
      ${infoCells.join('\n      ')}
    </div>
    ${panelHtml}
    ${actionsHtml}
    <div class="credential-footer">
      <p>${footerIssued}</p>
      <p>${escapeHtml(s.footerImmutable)}</p>
    </div>
  </div>
</div>
${copyScript}
</body>
</html>`;
}


/**
 * Render a 404 page for unknown credential IDs.
 * Synchronous — returns a plain HTML string.
 */
export function render404Page(locale: Locale): string {
  const isZh = locale === 'zh';
  const title = isZh ? '页面未找到' : 'Page Not Found';
  const message = isZh ? '您访问的凭证不存在或已被删除。' : 'The credential you are looking for does not exist or has been removed.';
  const backText = isZh ? '返回首页' : 'Back to Home';

  return `<!DOCTYPE html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>404 - ${title}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;min-height:100vh;background:#07131f;color:#fff;display:flex;align-items:center;justify-content:center;padding:40px 24px;text-align:center}
.code{font-size:96px;font-weight:700;background:linear-gradient(90deg,#8b5cf6,#ec4899,#f97316);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;line-height:1}
.msg-title{font-size:24px;font-weight:600;margin:16px 0 8px}
.msg-desc{font-size:14px;color:#8899aa;margin-bottom:24px;line-height:1.6}
.back-link{display:inline-block;padding:10px 24px;border-radius:10px;background:linear-gradient(135deg,#8b5cf6,#ec4899);color:#fff;text-decoration:none;font-size:14px;font-weight:600;transition:opacity 0.2s}
.back-link:hover{opacity:0.9}
</style>
</head>
<body>
<div>
  <div class="code">404</div>
  <div class="msg-title">${title}</div>
  <div class="msg-desc">${message}</div>
  <a class="back-link" href="/">${backText}</a>
</div>
</body>
</html>`;
}
