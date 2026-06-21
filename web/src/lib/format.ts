// Shared formatting utilities — extracted from inline usage across components

// ---- Locale-aware time formatting (Intl API) ----

/**
 * Resolve the user's preferred locale from the browser.
 * Uses navigator.languages (full preference list) with navigator.language as fallback.
 */
function userLocales(): string[] {
  if (navigator.languages?.length) return [...navigator.languages];
  return [navigator.language || 'en-US'];
}

/**
 * Detect the system's preferred hour cycle.
 * When the browser locale (e.g. en-US) would normally use h12 (AM/PM),
 * but the OS regional settings use 24h, resolvedOptions().hourCycle reflects
 * the OS preference. We detect this and pass it explicitly to all formatters
 * so European users with an English browser still see 24h time.
 */
function systemHourCycle(): 'h23' | 'h12' | undefined {
  try {
    const resolved = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions();
    return resolved.hourCycle as 'h23' | 'h12' | undefined;
  } catch {
    return undefined;
  }
}

// Cached Intl formatters — created lazily, reused across calls.
let _cacheKey: string | undefined;
let _dateTimeFmt: Intl.DateTimeFormat | undefined;
let _timeFmt: Intl.DateTimeFormat | undefined;
let _relativeFmt: Intl.RelativeTimeFormat | undefined;

function ensureFormatters(): void {
  const locales = userLocales();
  const hc = systemHourCycle();
  const key = locales.join(',') + '|' + (hc || '');
  if (key === _cacheKey) return;
  _cacheKey = key;

  // Build options with the detected hourCycle so the OS preference wins
  const hourOpts: Intl.DateTimeFormatOptions = hc ? { hourCycle: hc } : {};

  _dateTimeFmt = new Intl.DateTimeFormat(locales, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...hourOpts,
  });
  _timeFmt = new Intl.DateTimeFormat(locales, {
    hour: '2-digit',
    minute: '2-digit',
    ...hourOpts,
  });
  _relativeFmt = new Intl.RelativeTimeFormat(locales, { numeric: 'auto', style: 'short' });
}

/** Format a date string as localized relative time using Intl.RelativeTimeFormat.
 *  Falls back to compact labels for very recent times. */
export function relativeTime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  ensureFormatters();
  const diffMs = Date.now() - d.getTime();
  const diffSecs = Math.floor(diffMs / 1000);
  if (diffSecs < 60) return _relativeFmt!.format(-diffSecs, 'second');
  const diffMins = Math.floor(diffSecs / 60);
  if (diffMins < 60) return _relativeFmt!.format(-diffMins, 'minute');
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return _relativeFmt!.format(-diffHrs, 'hour');
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return _relativeFmt!.format(-diffDays, 'day');
  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return _relativeFmt!.format(-diffMonths, 'month');
  const diffYears = Math.floor(diffMonths / 12);
  return _relativeFmt!.format(-diffYears, 'year');
}

/** Format a date string as a localized date+time (e.g. "10.04.2026, 14:30:00" in de-DE) */
export function formatDateTime(dateStr: string | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  ensureFormatters();
  return _dateTimeFmt!.format(d);
}

/** Format a timestamp (ms epoch or ISO string) to localized time HH:MM (e.g. "14:30" in 24h locales) */
export function formatTime(ts: number | string): string {
  if (!ts) return '';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (isNaN(d.getTime())) return '';
  ensureFormatters();
  return _timeFmt!.format(d);
}

// ---- Tokens ----

/** Format a token count as a human-readable string (e.g. "1.2M", "45.3k", "500") */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

// ---- Bytes ----

/** Format a byte count as human-readable (e.g. "512 B", "1.5 KB", "3.2 MB") */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// ---- Cost ----

/** Format a dollar cost string (e.g. "$0.0042" → "$0.004", "$1.50") */
export function formatCost(cost: string | number | undefined): string {
  if (cost === undefined || cost === null) return '';
  const n = typeof cost === 'string' ? parseFloat(cost) : cost;
  if (isNaN(n)) return typeof cost === 'string' ? cost : '';
  if (n < 0.01) return `$${n.toFixed(4)}`;
  if (n < 1) return `$${n.toFixed(3)}`;
  return `$${n.toFixed(2)}`;
}

// ---- Phase / Status badges ----

/** Map a K8s resource phase to a badge variant */
export function phaseVariant(
  phase: string | undefined,
): 'success' | 'warning' | 'error' | 'muted' {
  switch (phase) {
    case 'Ready':
    case 'Active':
    case 'Running':
    case 'Completed':
    case 'Succeeded':
      return 'success';
    case 'Pending':
      return 'warning';
    case 'Failed':
      return 'error';
    default:
      return 'muted';
  }
}
