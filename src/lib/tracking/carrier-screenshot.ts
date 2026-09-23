import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import { existsSync } from 'node:fs';
import { resolveCarrierTrackingUrl } from '@/lib/shopify/carrier-tracking';

const SUPPORTED_DEEP_LINK_HOSTS = new Set([
  'hub.envia.co',
  'rastreo.coordinadora.com',
  'www.andreani.com',
  'www.correoargentino.com.ar',
]);

export async function captureCarrierScreenshot(input: {
  carrier: string;
  guide: string;
}): Promise<{ png: Buffer; url: string; pageText: string }> {
  const url = resolveCarrierTrackingUrl(input.carrier, input.guide);
  if (!url) throw new Error('carrier_without_tracking_url');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !SUPPORTED_DEEP_LINK_HOSTS.has(parsed.hostname)) {
    throw new Error('carrier_capture_not_supported');
  }

  const browser = await puppeteer.launch({
    args: process.platform === 'win32' ? ['--no-sandbox'] : chromium.args,
    defaultViewport: { width: 1280, height: 1100, deviceScaleFactor: 1 },
    executablePath: await browserExecutablePath(),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-CO,es;q=0.9' });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45_000 });
    await new Promise((resolve) => setTimeout(resolve, 4_000));
    const pageText = await page.evaluate(() => document.body?.innerText ?? '');
    const png = Buffer.from(await page.screenshot({ type: 'png', fullPage: true }));
    if (png.length < 10_000) throw new Error('carrier_screenshot_empty');
    return { png, url: page.url(), pageText: pageText.slice(0, 30_000) };
  } finally {
    await browser.close();
  }
}

async function browserExecutablePath(): Promise<string> {
  if (process.platform !== 'win32') return chromium.executablePath();
  const candidates = [
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}/Google/Chrome/Application/chrome.exe`,
    process.env['PROGRAMFILES(X86)'] && `${process.env['PROGRAMFILES(X86)']}/Google/Chrome/Application/chrome.exe`,
    process.env.LOCALAPPDATA && `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
    process.env.PROGRAMFILES && `${process.env.PROGRAMFILES}/Microsoft/Edge/Application/msedge.exe`,
  ].filter((value): value is string => Boolean(value));
  const executable = candidates.find(existsSync);
  if (!executable) throw new Error('local_chromium_unavailable');
  return executable;
}
