import { createMemo, createResource, createSignal, For, Show, type Component } from 'solid-js';
import type { AuthType } from 'manifest-shared';
import {
  getProviderModels,
  getUsEgressHealth,
  setProviderModelEgress,
  type ProviderModelEgress,
} from '../services/api/providers.js';
import { toast } from '../services/toast-store.js';

interface Props {
  provider: string;
  authType: AuthType;
}

/**
 * Per-model US egress controls for one provider connection group.
 *
 * The policy is tenant-wide (not per API key), so this panel is keyed by
 * provider + auth type rather than by a specific `tenant_providers` row. It is
 * shown only for providers that declare `usEgress` in the shared registry.
 */
const ModelEgressPanel: Component<Props> = (props) => {
  const [search, setSearch] = createSignal('');
  const [saving, setSaving] = createSignal<string | null>(null);

  const [data, { refetch }] = createResource(
    () => ({ provider: props.provider, authType: props.authType }),
    (key) => getProviderModels(key.provider, key.authType),
  );

  // Probe only after the provider confirms it supports US egress, so opening an
  // unrelated connection does not wake the gateway.
  const [health] = createResource(
    () => data()?.supports_us_egress === true,
    (enabled) => (enabled ? getUsEgressHealth().catch(() => null) : null),
  );

  const filtered = createMemo(() => {
    const query = search().trim().toLowerCase();
    const models = data()?.models ?? [];
    if (!query) return models;
    return models.filter(
      (model) =>
        model.model.toLowerCase().includes(query) ||
        (model.display_name ?? '').toLowerCase().includes(query),
    );
  });

  const toggle = async (model: ProviderModelEgress) => {
    const next = model.egress === 'us' ? 'direct' : 'us';
    setSaving(model.model);
    try {
      await setProviderModelEgress(props.provider, model.model, next, props.authType);
      await refetch();
      toast.success(
        next === 'us'
          ? `${model.model} now routes through the US gateway`
          : `${model.model} now routes directly`,
      );
    } catch {
      // fetchMutate already surfaced the server error.
    } finally {
      setSaving(null);
    }
  };

  const healthLabel = () => {
    if (health.loading) return 'Checking US gateway…';
    const value = health();
    if (!value) return 'US gateway unavailable';
    if (!value.configured) return 'US gateway not configured';
    if (value.reachable) {
      return `US gateway online${value.latency_ms != null ? ` (${value.latency_ms} ms)` : ''}`;
    }
    return 'US gateway unreachable';
  };

  const healthClass = () => {
    if (health.loading) return 'model-egress__health--checking';
    const value = health();
    if (!value?.configured) return 'model-egress__health--unconfigured';
    return value.reachable ? 'model-egress__health--online' : 'model-egress__health--offline';
  };

  return (
    <Show when={data()?.supports_us_egress}>
      <div class="panel model-egress" style="margin-bottom: 24px;">
        <div class="model-egress__header">
          <div>
            <div class="panel__title" style="margin-bottom: 4px;">
              Model egress
            </div>
            <p class="model-egress__subtitle">
              Send only the models that reject EU traffic through the US gateway. Everything else
              keeps the direct route. This applies to every key of this provider.
            </p>
          </div>
          <span class={`model-egress__health ${healthClass()}`} title={health()?.target ?? ''}>
            <span class="model-egress__health-dot" />
            {healthLabel()}
          </span>
        </div>

        <Show when={data()?.us_egress_available === false}>
          <div class="model-egress__notice">
            The US gateway is not configured on this deployment. Set
            <code> OPENCODE_GO_PROXY_BASE</code> and <code>OPENCODE_GO_HF_TOKEN</code> to enable
            these switches.
          </div>
        </Show>

        <div class="model-egress__toolbar">
          <input
            class="model-egress__search"
            type="search"
            placeholder="Search models…"
            value={search()}
            onInput={(event) => setSearch(event.currentTarget.value)}
            aria-label="Search models"
          />
          <span class="model-egress__count">
            {filtered().length} model{filtered().length === 1 ? '' : 's'}
          </span>
        </div>

        <Show
          when={!data.loading}
          fallback={<div class="model-egress__empty">Loading models…</div>}
        >
          <Show
            when={filtered().length > 0}
            fallback={<div class="model-egress__empty">No models match this search.</div>}
          >
            <div class="model-egress__list">
              <For each={filtered()}>
                {(model) => (
                  <div class="model-egress__row">
                    <div class="model-egress__model">
                      <span class="model-egress__model-name">
                        {model.display_name && model.display_name !== model.model
                          ? model.display_name
                          : model.model}
                      </span>
                      <Show when={model.display_name && model.display_name !== model.model}>
                        <span class="model-egress__model-id">{model.model}</span>
                      </Show>
                    </div>
                    <div class="model-egress__control">
                      <Show when={!model.explicit && model.egress === 'us'}>
                        <span class="model-egress__auto">Auto</span>
                      </Show>
                      <span
                        class="model-egress__value"
                        classList={{ 'model-egress__value--us': model.egress === 'us' }}
                      >
                        {model.egress === 'us' ? 'US' : 'Direct'}
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={model.egress === 'us'}
                        aria-label={`Route ${model.model} through the US gateway`}
                        class="settings-switch"
                        classList={{ 'settings-switch--on': model.egress === 'us' }}
                        disabled={saving() === model.model || data()?.us_egress_available === false}
                        onClick={() => void toggle(model)}
                      >
                        <span class="settings-switch__track">
                          <span class="settings-switch__thumb" />
                        </span>
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>

        <p class="model-egress__footnote">
          The gateway sees the provider key for the models you enable here. Leave a model on Direct
          unless the provider blocks your region.
        </p>
      </div>
    </Show>
  );
};

export default ModelEgressPanel;
