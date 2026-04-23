/**
 * Rewrites Open Graph and Twitter card URL/image tags in the SPA's
 * index.html so self-hosted instances expose their own URL in shared
 * link previews instead of the Cloud Manifest defaults.
 *
 * Only the leading `https://app.manifest.build` is replaced, preserving
 * any path suffix on `og:image` (e.g. `/og-image.png`). When `baseUrl`
 * is empty, invalid, or matches the default, the input is returned
 * unchanged.
 */
const DEFAULT_BASE = 'https://app.manifest.build';

export function rewriteOgTags(html: string, baseUrl: string): string {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed || trimmed === DEFAULT_BASE) return html;

  // Parse and accept only a clean origin. Anything with HTML/JS payload,
  // credentials, path, query, or fragment would otherwise be injected
  // verbatim into the served index.html and could break tag balancing
  // or add external `src=` URLs that sidestep the CSP.
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return html;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return html;
  if (parsed.username || parsed.password) return html;
  if (parsed.pathname !== '/' && parsed.pathname !== '') return html;
  if (parsed.search || parsed.hash) return html;

  const origin = parsed.origin;
  return html.split(DEFAULT_BASE).join(origin);
}
