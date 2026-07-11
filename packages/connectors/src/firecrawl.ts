import { loadEnv } from '@brandpilot/config';
import { AppError } from '@brandpilot/core';

/**
 * Firecrawl website scraper. Turns a public URL into clean markdown for the
 * Discovery Engine to chunk + embed. Uses the Firecrawl v1 `/scrape` endpoint.
 *
 * @see https://docs.firecrawl.dev/api-reference/endpoint/scrape
 */

const FIRECRAWL_API_URL = 'https://api.firecrawl.dev/v1/scrape';

export interface ScrapeResult {
  title?: string;
  markdown: string;
}

/** Shape of the subset of the Firecrawl response we consume. */
interface FirecrawlScrapeResponse {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: string;
    metadata?: {
      title?: string;
      [key: string]: unknown;
    };
  };
}

/**
 * Reject obvious SSRF targets before a (user-supplied) URL is scraped: only
 * http(s), and never a loopback/private/link-local host (incl. the cloud
 * metadata IP 169.254.169.254). Defense-in-depth — the fetch itself goes via
 * Firecrawl, but the URL originates from discovery input, so validate at this
 * boundary. (Does not resolve DNS, so DNS-rebinding is out of scope here.)
 */
function assertScrapableUrl(raw: string): void {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError('bad_request', 'Invalid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new AppError('bad_request', 'Only http(s) URLs can be scraped');
  }
  if (isBlockedHost(parsed.hostname)) {
    throw new AppError('bad_request', 'Refusing to scrape a private or loopback address');
  }
}

/** True for loopback/private/link-local hostnames and IPv4/IPv6 literals. */
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) {
    return true;
  }
  // IPv6 loopback (::1), link-local (fe80::/10), unique-local (fc00::/7).
  if (h === '::1' || h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb') || h.startsWith('fc') || h.startsWith('fd')) {
    return true;
  }
  const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/);
  if (!m) return false;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (a === 0 || a === 10 || a === 127) return true; // this-host / RFC1918 10/8 / loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918 172.16/12
  if (a === 192 && b === 168) return true; // RFC1918 192.168/16
  return false;
}

/**
 * Scrape a single URL and return its title + markdown content.
 * Throws {@link AppError} `bad_request` when the URL is unsafe/invalid, the API
 * key is missing, or the remote call fails / returns no markdown.
 */
export async function scrapeUrl(url: string): Promise<ScrapeResult> {
  assertScrapableUrl(url);
  const apiKey = loadEnv().FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new AppError('bad_request', 'FIRECRAWL_API_KEY is not configured; cannot scrape URLs');
  }

  let response: Response;
  try {
    response = await fetch(FIRECRAWL_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url, formats: ['markdown'] }),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown network error';
    throw new AppError('bad_request', `Firecrawl request failed: ${message}`);
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new AppError('bad_request', `Firecrawl returned ${response.status}: ${body.slice(0, 500)}`);
  }

  const json = (await response.json()) as FirecrawlScrapeResponse;
  const markdown = json.data?.markdown;
  if (!markdown) {
    throw new AppError('bad_request', `Firecrawl returned no markdown for ${url}`);
  }

  const title = json.data?.metadata?.title;
  return title === undefined ? { markdown } : { title, markdown };
}
