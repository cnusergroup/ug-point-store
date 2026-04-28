import { describe, it, expect } from 'vitest';
import {
  renderCredentialPage,
  render404Page,
  buildLinkedInUrl,
  generateQrSvg,
  type RenderOptions,
} from './render';
import type { Credential } from './types';

function makeCredential(overrides: Partial<Credential> = {}): Credential {
  return {
    credentialId: 'ACD-BASE-2026-Summer-VOL-0001',
    recipientName: '张三',
    eventName: 'AWS Community Day Base',
    role: 'Volunteer',
    issueDate: '2026-06-15',
    issuingOrganization: 'AWS User Group China',
    status: 'active',
    locale: 'zh',
    createdAt: '2026-06-15T00:00:00.000Z',
    ...overrides,
  };
}

const BASE_URL = 'https://store.awscommunity.cn';

describe('buildLinkedInUrl', () => {
  it('should build correct LinkedIn URL with encoded parameters', () => {
    const credential = makeCredential();
    const url = buildLinkedInUrl(credential, BASE_URL);

    expect(url).toContain('https://www.linkedin.com/profile/add?');
    expect(url).toContain('startTask=CERTIFICATION_NAME');
    expect(url).toContain('organizationName=');
    expect(url).toContain('issueYear=2026');
    expect(url).toContain('issueMonth=6');
    expect(url).toContain('certId=ACD-BASE-2026-Summer-VOL-0001');
    expect(url).toContain(encodeURIComponent(`${BASE_URL}/c/ACD-BASE-2026-Summer-VOL-0001`));
  });

  it('should use locale-specific role name in cert name', () => {
    const zhUrl = buildLinkedInUrl(makeCredential({ locale: 'zh' }), BASE_URL);
    expect(zhUrl).toContain(encodeURIComponent('志愿者'));

    const enUrl = buildLinkedInUrl(makeCredential({ locale: 'en' }), BASE_URL);
    expect(enUrl).toContain(encodeURIComponent('Volunteer'));
  });
});

describe('generateQrSvg', () => {
  it('should return an SVG string', async () => {
    const svg = await generateQrSvg('https://example.com');
    expect(svg).toContain('<svg');
    expect(svg).toContain('</svg>');
  });
});

describe('renderCredentialPage', () => {
  it('should render a complete HTML page with all required elements', async () => {
    const credential = makeCredential();
    const html = await renderCredentialPage({ credential, baseUrl: BASE_URL });

    // Basic HTML structure
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="zh">');
    expect(html).toContain('<style>');

    // OG meta tags
    expect(html).toContain('og:title');
    expect(html).toContain('og:description');
    expect(html).toContain('og:url');
    expect(html).toContain('og:type');
    expect(html).toContain('og:image');

    // Twitter card meta tags
    expect(html).toContain('twitter:card');
    expect(html).toContain('twitter:title');
    expect(html).toContain('twitter:description');
    expect(html).toContain('twitter:image');

    // Credential data
    expect(html).toContain('张三');
    expect(html).toContain('AWS Community Day Base');
    expect(html).toContain('志愿者');
    expect(html).toContain('2026-06-15');
    expect(html).toContain('ACD-BASE-2026-Summer-VOL-0001');
    expect(html).toContain('AWS User Group China');

    // QR code
    expect(html).toContain('<svg');

    // LinkedIn button (active credential)
    expect(html).toContain('linkedin.com/profile/add');
    expect(html).toContain('添加到 LinkedIn');

    // No external stylesheets or scripts
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('should include optional fields when provided', async () => {
    const credential = makeCredential({
      eventDate: '2026-06-15',
      eventLocation: '北京',
      contribution: '活动志愿者服务',
    });
    const html = await renderCredentialPage({ credential, baseUrl: BASE_URL });

    expect(html).toContain('活动日期');
    expect(html).toContain('2026-06-15');
    expect(html).toContain('活动地点');
    expect(html).toContain('北京');
    expect(html).toContain('贡献描述');
    expect(html).toContain('活动志愿者服务');
  });

  it('should show revocation marker and hide LinkedIn button for revoked credentials', async () => {
    const credential = makeCredential({ status: 'revoked' });
    const html = await renderCredentialPage({ credential, baseUrl: BASE_URL });

    // Revocation marker
    expect(html).toContain('此凭证已被撤销');
    expect(html).toContain('revoked-banner');

    // No LinkedIn button element (CSS class may still exist in <style>)
    expect(html).not.toContain('linkedin.com/profile/add');
    expect(html).not.toContain('class="linkedin-btn"');

    // OG description includes revoked text
    expect(html).toContain('已撤销');
  });

  it('should render English locale correctly', async () => {
    const credential = makeCredential({ locale: 'en' });
    const html = await renderCredentialPage({ credential, baseUrl: BASE_URL });

    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Verified');
    expect(html).toContain('Issue Date');
    expect(html).toContain('Issuing Organization');
    expect(html).toContain('Credential ID');
    expect(html).toContain('Add to LinkedIn');
  });

  it('should produce HTML under 50KB', async () => {
    const credential = makeCredential({
      eventDate: '2026-06-15',
      eventLocation: '北京国际会议中心',
      contribution: '负责活动签到和现场引导工作',
    });
    const html = await renderCredentialPage({ credential, baseUrl: BASE_URL });
    const sizeKB = Buffer.byteLength(html, 'utf-8') / 1024;
    expect(sizeKB).toBeLessThan(50);
  });
});

describe('render404Page', () => {
  it('should render Chinese 404 page', () => {
    const html = render404Page('zh');
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="zh">');
    expect(html).toContain('404');
    expect(html).toContain('页面未找到');
    expect(html).toContain('返回首页');
    expect(html).toContain('href="/"');
    expect(html).toContain('<style>');
    expect(html).not.toMatch(/<link[^>]+rel=["']stylesheet["']/);
    expect(html).not.toMatch(/<script[^>]+src=/);
  });

  it('should render English 404 page', () => {
    const html = render404Page('en');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('Page Not Found');
    expect(html).toContain('Back to Home');
  });
});
