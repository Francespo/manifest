import { createResource, For, Show, type Component } from 'solid-js';
import { PROVIDERS } from '../services/providers.js';
import { providerIcon } from '../components/ProviderIcon.js';
import {
  listQuotaFreezes,
  resumeQuotaFreeze,
  type QuotaFreeze,
} from '../services/api/quota-freezes.js';
import { toast } from '../services/toast-store.js';

/**
 * Live view of quota freezes applied by the proxy's key-rotation quota guard.
 * Lists which provider keys are frozen (and why / until when), and lets the
 * user resume a key that was frozen by mistake — the freeze is an in-memory
 * process heuristic, so the UI makes it transparent and correctable.
 */
const QuotaFreezeList: Component<{ agentName: () => string }> = (props) => {
  const [freezes, { refetch }] = createResource(
    () => props.agentName(),
    async (name: string) => {
      try {
        const data = await listQuotaFreezes(name);
        return data.freezes ?? [];
      } catch {
        return [];
      }
    },
  );

  const providerName = (providerId: string): string =>
    PROVIDERS.find((p) => p.id === providerId)?.name ?? providerId;

  const labelFor = (f: QuotaFreeze): string => f.providerKeyLabel ?? 'Default';

  const resume = async (f: QuotaFreeze) => {
    try {
      await resumeQuotaFreeze(
        props.agentName(),
        f.provider,
        f.authType,
        f.providerKeyLabel ?? undefined,
      );
      toast.success(`Resumed "${labelFor(f)}" — the key is used again immediately`);
      void refetch();
    } catch {
      toast.error(`Failed to resume "${labelFor(f)}"`);
    }
  };

  const freezeLabel = (reason: QuotaFreeze['reason']): string =>
    reason === 'week' ? 'Week' : reason === 'hour' ? 'Hour' : 'Day';

  return (
    <Show when={(freezes() ?? []).length > 0}>
      <section class="routing-section quota-freeze-section" aria-label="Quota freezes">
        <div class="routing-section__header" style="margin-bottom: 8px;">
          <div>
            <h2 class="routing-section__title">Quota freezes</h2>
            <span class="routing-section__subtitle">
              Free keys whose quota is confirmed exhausted are skipped automatically to avoid wasted
              upstream calls. Resume any key you believe recovered.
            </span>
          </div>
        </div>
        <ul class="quota-freeze-list">
          <For each={freezes() ?? []}>
            {(f) => (
              <li class="quota-freeze-item">
                <span class="quota-freeze-item__icon" title={providerName(f.provider)}>
                  {providerIcon(f.provider, 16)}
                </span>
                <span class="quota-freeze-item__who">
                  <span class="quota-freeze-item__provider">{providerName(f.provider)}</span>
                  <span class="quota-freeze-item__label">{labelFor(f)}</span>
                </span>
                <span
                  class="quota-freeze-item__badge"
                  classList={{
                    'quota-freeze-item__badge--hour': f.reason === 'hour',
                    'quota-freeze-item__badge--day': f.reason === 'day',
                    'quota-freeze-item__badge--week': f.reason === 'week',
                  }}
                  title={f.message}
                >
                  {freezeLabel(f.reason)}
                </span>
                <span class="quota-freeze-item__remaining" title={f.message}>
                  {f.remainingLabel} left
                </span>
                <button
                  type="button"
                  class="btn btn--outline btn--sm quota-freeze-item__resume"
                  onClick={() => void resume(f)}
                >
                  Resume
                </button>
              </li>
            )}
          </For>
        </ul>
      </section>
    </Show>
  );
};

export default QuotaFreezeList;
