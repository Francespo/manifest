import {
  createSignal,
  createResource,
  createMemo,
  onCleanup,
  Show,
  For,
  type Component,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import { getModelQuotaStatus } from '../services/api/model-quotas.js';
import { routingPing } from '../services/sse.js';
import { providerIcon } from './ProviderIcon.jsx';
import type { KeyQuotaBucketStatus } from 'manifest-shared';
import '../styles/quota-buckets-drawer.css';

export interface QuotaBucketsDrawerProps {
  open: boolean;
  onClose: () => void;
}

function formatTokens(t: number): string {
  if (t >= 1_000_000) return `${(t / 1_000_000).toFixed(1)}M`;
  if (t >= 1_000) return `${(t / 1_000).toFixed(0)}k`;
  return String(t);
}

function formatTpmLimit(t: number | null): string {
  if (t == null) return '—';
  return formatTokens(t);
}

/**
 * Remaining cooldown seconds for a bucket in 'cooldown' status, derived from
 * the shared type's `frozenUntil` ms-epoch timestamp (the shared type has no
 * `cooldownRemainingSeconds` field). Returns 0 unless frozenUntil is set, in
 * the future, and the bucket is actually cooling down.
 */
function cooldownSeconds(b: KeyQuotaBucketStatus): number {
  if (b.status !== 'cooldown' || b.frozenUntil == null) return 0;
  return Math.max(0, Math.ceil((b.frozenUntil - Date.now()) / 1000));
}

function computeUtcMidnightCountdown(): string {
  const now = new Date();
  const nextUtcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0),
  );
  const diffMs = Math.max(0, nextUtcMidnight.getTime() - now.getTime());
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${mins}m`;
}

export const QuotaBucketsDrawer: Component<QuotaBucketsDrawerProps> = (props) => {
  const [tick, setTick] = createSignal(0);
  const [searchQuery, setSearchQuery] = createSignal('');
  const [statusFilter, setStatusFilter] = createSignal<'all' | 'active' | 'cooldown' | 'exhausted'>(
    'all',
  );
  const [providerFilter, setProviderFilter] = createSignal<string>('all');

  // Poll every 5 seconds for live sliding window updates
  const interval = setInterval(() => setTick((t) => t + 1), 5_000);
  onCleanup(() => clearInterval(interval));

  // Escape key handler
  if (typeof document !== 'undefined') {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && props.open) {
        props.onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    onCleanup(() => document.removeEventListener('keydown', onKeyDown));
  }

  const [data, { refetch }] = createResource(
    () => ({ _ping: routingPing(), _t: tick(), _open: props.open }),
    async (src) => {
      if (!src._open) return [];
      try {
        const res = await getModelQuotaStatus();
        return res.buckets ?? [];
      } catch {
        return [];
      }
    },
  );

  const buckets = () => data() ?? [];

  // Summary counts
  const totalCount = () => buckets().length;
  const activeCount = () => buckets().filter((b) => b.status === 'active').length;
  const cooldownCount = () => buckets().filter((b) => b.status === 'cooldown').length;
  const exhaustedCount = () => buckets().filter((b) => b.status === 'exhausted').length;

  // Available providers for filter
  const availableProviders = () => {
    const set = new Set<string>();
    for (const b of buckets()) {
      if (b.provider) set.add(b.provider.toLowerCase());
    }
    return Array.from(set);
  };

  // Filtered buckets
  const filteredBuckets = createMemo(() => {
    const q = searchQuery().toLowerCase().trim();
    const status = statusFilter();
    const prov = providerFilter();

    return buckets().filter((b) => {
      if (status !== 'all' && b.status !== status) return false;
      if (prov !== 'all' && b.provider?.toLowerCase() !== prov) return false;
      if (q) {
        const matchKey = b.keyLabel?.toLowerCase().includes(q);
        const matchModel = b.model?.toLowerCase().includes(q);
        const matchProv = b.provider?.toLowerCase().includes(q);
        if (!matchKey && !matchModel && !matchProv) return false;
      }
      return true;
    });
  });

  return (
    <Portal>
      {/* Backdrop */}
      <div
        class="quota-drawer-backdrop"
        classList={{ 'quota-drawer-backdrop--open': props.open }}
        onClick={props.onClose}
        aria-hidden="true"
      />

      {/* Large Slide-Over Panel */}
      <aside
        class="drawer quota-drawer"
        classList={{ 'drawer--open': props.open }}
        aria-label="Quota Buckets & Rate Limits Panel"
        aria-modal="true"
        role="dialog"
      >
        {/* Header */}
        <div class="drawer__header quota-drawer__header">
          <div class="drawer__title-row">
            <div class="quota-drawer__title-group">
              <div class="quota-drawer__icon">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="20"
                  height="20"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
                </svg>
              </div>
              <div>
                <h3 class="drawer__title">Quota Buckets & Rate Limits</h3>
                <p class="quota-drawer__subtitle">
                  Live pre-flight rate limiting & cross-harness quota monitoring
                </p>
              </div>
            </div>

            <div class="quota-drawer__header-actions">
              <button
                type="button"
                class="quota-drawer__refresh-btn"
                onClick={() => refetch()}
                title="Refresh live buckets"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  viewBox="0 0 24 24"
                >
                  <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                </svg>
                <span>Refresh</span>
              </button>

              <button
                type="button"
                class="drawer__close"
                onClick={props.onClose}
                aria-label="Close panel"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Quick KPI Stats Bar */}
          <div class="quota-kpi-grid">
            <div class="quota-kpi-card">
              <div class="quota-kpi-card__label">Total Buckets</div>
              <div class="quota-kpi-card__value">{totalCount()}</div>
            </div>
            <div class="quota-kpi-card quota-kpi-card--active">
              <div class="quota-kpi-card__label">Active</div>
              <div class="quota-kpi-card__value">{activeCount()}</div>
            </div>
            <div class="quota-kpi-card quota-kpi-card--cooldown">
              <div class="quota-kpi-card__label">In Cooldown</div>
              <div class="quota-kpi-card__value">{cooldownCount()}</div>
            </div>
            <div class="quota-kpi-card quota-kpi-card--exhausted">
              <div class="quota-kpi-card__label">Daily Exhausted</div>
              <div class="quota-kpi-card__value">{exhaustedCount()}</div>
            </div>
          </div>
        </div>

        {/* Toolbar (Search & Filters) */}
        <div class="quota-drawer__toolbar">
          <div class="quota-drawer__search-wrap">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              viewBox="0 0 24 24"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
            <input
              type="search"
              class="quota-drawer__search"
              placeholder="Search keys, models, or providers…"
              value={searchQuery()}
              onInput={(e) => setSearchQuery(e.currentTarget.value)}
            />
          </div>

          <div class="quota-drawer__filter-pills">
            <button
              type="button"
              class="quota-filter-pill"
              classList={{ 'quota-filter-pill--active': statusFilter() === 'all' }}
              onClick={() => setStatusFilter('all')}
            >
              All ({totalCount()})
            </button>
            <button
              type="button"
              class="quota-filter-pill quota-filter-pill--active-status"
              classList={{ 'quota-filter-pill--active': statusFilter() === 'active' }}
              onClick={() => setStatusFilter('active')}
            >
              Active ({activeCount()})
            </button>
            <button
              type="button"
              class="quota-filter-pill quota-filter-pill--cooldown-status"
              classList={{ 'quota-filter-pill--active': statusFilter() === 'cooldown' }}
              onClick={() => setStatusFilter('cooldown')}
            >
              Cooldown ({cooldownCount()})
            </button>
            <button
              type="button"
              class="quota-filter-pill quota-filter-pill--exhausted-status"
              classList={{ 'quota-filter-pill--active': statusFilter() === 'exhausted' }}
              onClick={() => setStatusFilter('exhausted')}
            >
              Exhausted ({exhaustedCount()})
            </button>
          </div>

          <Show when={availableProviders().length > 1}>
            <select
              class="quota-drawer__provider-select"
              value={providerFilter()}
              onChange={(e) => setProviderFilter(e.currentTarget.value)}
            >
              <option value="all">All Providers</option>
              <For each={availableProviders()}>
                {(prov) => (
                  <option value={prov}>{prov.charAt(0).toUpperCase() + prov.slice(1)}</option>
                )}
              </For>
            </select>
          </Show>
        </div>

        {/* Scrollable Content Body */}
        <div class="quota-drawer__body">
          <Show
            when={filteredBuckets().length > 0}
            fallback={
              <div class="quota-drawer__empty">
                <div class="quota-drawer__empty-icon">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="32"
                    height="32"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    viewBox="0 0 24 24"
                  >
                    <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                </div>
                <div class="quota-drawer__empty-title">
                  {data.loading ? 'Loading quota buckets…' : 'No matching quota buckets'}
                </div>
                <div class="quota-drawer__empty-desc">
                  {buckets().length === 0
                    ? 'No rate limit buckets have been tracked yet. Buckets are dynamically created and updated as requests flow through Manifest.'
                    : 'Try clearing your search query or status filter.'}
                </div>
              </div>
            }
          >
            <div class="quota-bucket-list">
              <For each={filteredBuckets()}>
                {(b) => {
                  const isGeminiQuota = () => b.rpdLimit != null || b.rpmLimit != null;
                  const rpdPct = () =>
                    b.rpdLimit ? Math.min(100, (b.rpdUsed / b.rpdLimit) * 100) : 0;
                  const rpmPct = () =>
                    b.rpmLimit ? Math.min(100, (b.rpmUsed / b.rpmLimit) * 100) : 0;
                  const tpmPct = () =>
                    b.tpmLimit ? Math.min(100, (b.tpmUsed / b.tpmLimit) * 100) : 0;

                  return (
                    <div
                      class="quota-detail-card"
                      classList={{
                        'quota-detail-card--exhausted': b.status === 'exhausted',
                        'quota-detail-card--cooldown': b.status === 'cooldown',
                        'quota-detail-card--active': b.status === 'active',
                      }}
                    >
                      {/* Card Header */}
                      <div class="quota-detail-card__header">
                        <div class="quota-detail-card__identity">
                          <span class="quota-detail-card__provider-icon">
                            {providerIcon(b.provider, 18)}
                          </span>
                          <div>
                            <div class="quota-detail-card__key-label">{b.keyLabel}</div>
                            <div class="quota-detail-card__model-name">{b.model}</div>
                          </div>
                        </div>

                        <div class="quota-detail-card__badges">
                          <span class={`quota-status-badge quota-status-badge--${b.status}`}>
                            <span class="quota-status-badge__dot" />
                            {b.status === 'exhausted'
                              ? 'Daily Exhausted'
                              : b.status === 'cooldown'
                                ? `Cooldown (${cooldownSeconds(b)}s)`
                                : 'Active'}
                          </span>
                        </div>
                      </div>

                      {/* Meter Gauges */}
                      <Show
                        when={isGeminiQuota()}
                        fallback={
                          <div class="quota-detail-card__generic-stats">
                            <div class="quota-generic-stat">
                              <span class="quota-generic-stat__label">Current Load</span>
                              <span class="quota-generic-stat__value">{b.rpmUsed} RPM</span>
                            </div>
                            <div class="quota-generic-stat">
                              <span class="quota-generic-stat__label">Token Throughput</span>
                              <span class="quota-generic-stat__value">
                                {formatTokens(b.tpmUsed)} TPM
                              </span>
                            </div>
                            <div class="quota-generic-stat">
                              <span class="quota-generic-stat__label">Requests Today</span>
                              <span class="quota-generic-stat__value">{b.rpdUsed}</span>
                            </div>
                          </div>
                        }
                      >
                        <div class="quota-meters-grid">
                          {/* Requests Per Minute */}
                          <div class="quota-meter">
                            <div class="quota-meter__header">
                              <span class="quota-meter__title">Requests / Min (RPM)</span>
                              <span class="quota-meter__values">
                                <strong>{b.rpmUsed}</strong> / {b.rpmLimit}
                                <span class="quota-meter__pct">({rpmPct().toFixed(0)}%)</span>
                              </span>
                            </div>
                            <div class="quota-meter__track">
                              <div
                                class="quota-meter__fill"
                                classList={{
                                  'quota-meter__fill--warn': rpmPct() >= 80,
                                  'quota-meter__fill--danger': rpmPct() >= 100,
                                }}
                                style={{ width: `${rpmPct()}%` }}
                              />
                            </div>
                            <div class="quota-meter__footer">Sliding 60-second window</div>
                          </div>

                          {/* Tokens Per Minute */}
                          <div class="quota-meter">
                            <div class="quota-meter__header">
                              <span class="quota-meter__title">Tokens / Min (TPM)</span>
                              <span class="quota-meter__values">
                                <strong>{formatTokens(b.tpmUsed)}</strong> /{' '}
                                {formatTpmLimit(b.tpmLimit)}
                                <span class="quota-meter__pct">({tpmPct().toFixed(0)}%)</span>
                              </span>
                            </div>
                            <div class="quota-meter__track">
                              <div
                                class="quota-meter__fill"
                                classList={{
                                  'quota-meter__fill--warn': tpmPct() >= 80,
                                  'quota-meter__fill--danger': tpmPct() >= 100,
                                }}
                                style={{ width: `${tpmPct()}%` }}
                              />
                            </div>
                            <div class="quota-meter__footer">Sliding 60-second window</div>
                          </div>

                          {/* Requests Per Day */}
                          <div class="quota-meter">
                            <div class="quota-meter__header">
                              <span class="quota-meter__title">Requests / Day (RPD)</span>
                              <span class="quota-meter__values">
                                <strong>{b.rpdUsed}</strong> / {b.rpdLimit}
                                <span class="quota-meter__pct">({rpdPct().toFixed(0)}%)</span>
                              </span>
                            </div>
                            <div class="quota-meter__track">
                              <div
                                class="quota-meter__fill"
                                classList={{
                                  'quota-meter__fill--warn': rpdPct() >= 80,
                                  'quota-meter__fill--danger': rpdPct() >= 100,
                                }}
                                style={{ width: `${rpdPct()}%` }}
                              />
                            </div>
                            <div class="quota-meter__footer">
                              Resets in {computeUtcMidnightCountdown()} (00:00 UTC)
                            </div>
                          </div>
                        </div>
                      </Show>

                      {/* Cooldown or Freeze Notice Box */}
                      <Show when={b.status === 'exhausted' || b.status === 'cooldown'}>
                        <div
                          class="quota-notice-box"
                          classList={{
                            'quota-notice-box--danger': b.status === 'exhausted',
                            'quota-notice-box--warn': b.status === 'cooldown',
                          }}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            fill="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z" />
                          </svg>
                          <div class="quota-notice-box__text">
                            <strong>
                              {b.status === 'exhausted'
                                ? 'Key Temporarily Frozen'
                                : 'Rate Limit Cooldown Active'}
                            </strong>
                            <p>
                              {b.freezeReason ||
                                (b.status === 'cooldown'
                                  ? `Upstream provider returned 429 rate limit. Pausing calls on this key for ${cooldownSeconds(b)}s.`
                                  : 'Daily quota has been reached. Calls to this key will be skipped in 0ms and fall back immediately.')}
                            </p>
                          </div>
                        </div>
                      </Show>

                      {/* Footer Metadata */}
                      <div class="quota-detail-card__footer">
                        <span class="quota-detail-card__meta-item">
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="12"
                            height="12"
                            fill="none"
                            stroke="currentColor"
                            stroke-width="2"
                            viewBox="0 0 24 24"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <path d="M12 6v6l4 2" />
                          </svg>
                          Shared across all harnesses & agents
                        </span>
                        <span class="quota-detail-card__meta-item">
                          Max payload: 250k input tokens
                        </span>
                      </div>
                    </div>
                  );
                }}
              </For>
            </div>
          </Show>
        </div>
      </aside>
    </Portal>
  );
};
export default QuotaBucketsDrawer;
