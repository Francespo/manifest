import {
  createEffect,
  createMemo,
  createResource,
  createSignal,
  For,
  Show,
  type Component,
} from 'solid-js';
import {
  MODEL_CATALOG_VARIANTS,
  modelCatalogPath,
  type ModelCatalogOption,
  type ModelCatalogResponse,
} from 'manifest-shared';
import CopyButton from './CopyButton.jsx';
import { getModelCatalog, updateModelCatalog } from '../services/api/model-catalog.js';
import { installOrigin } from '../services/install-endpoints.js';
import { toast } from '../services/toast-store.js';

interface EndpointRow {
  id: string;
  label: string;
  description: string;
  url: string;
}

interface OptionPickerProps {
  title: string;
  description: string;
  testId: string;
  placeholder: string;
  options: ModelCatalogOption[];
  selected: string[];
  onToggle: (id: string, checked: boolean) => void;
}

/** Searchable checkbox list bound to one array of catalog ids. */
const OptionPicker: Component<OptionPickerProps> = (props) => {
  const [filter, setFilter] = createSignal('');
  const filtered = createMemo(() => {
    const query = filter().trim().toLowerCase();
    if (!query) return props.options;
    return props.options.filter(
      (option) =>
        option.label.toLowerCase().includes(query) || option.id.toLowerCase().includes(query),
    );
  });

  return (
    <div class="settings-card__row model-catalog-option-row" data-testid={props.testId}>
      <div class="settings-card__label">
        <span class="settings-card__label-title">{props.title}</span>
        <span class="settings-card__label-desc">{props.description}</span>
      </div>
      <div class="settings-card__control model-catalog-picker">
        <input
          class="settings-card__input"
          type="search"
          aria-label={`Filter ${props.title}`}
          placeholder={props.placeholder}
          value={filter()}
          onInput={(e) => setFilter(e.currentTarget.value)}
        />
        <div class="model-catalog-picker__list">
          <Show
            when={filtered().length > 0}
            fallback={<span class="model-catalog-picker__empty">No matching options</span>}
          >
            <For each={filtered()}>
              {(option) => (
                <label class="model-catalog-picker__option">
                  <input
                    type="checkbox"
                    data-option-id={option.id}
                    checked={props.selected.includes(option.id)}
                    onChange={(e) => props.onToggle(option.id, e.currentTarget.checked)}
                  />
                  <span class="model-catalog-picker__label">{option.label}</span>
                  <code class="model-catalog-picker__id">{option.id}</code>
                </label>
              )}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
};

const sameIds = (a: string[], b: string[]) =>
  a.length === b.length && a.every((id) => b.includes(id));

/**
 * Tenant-level settings for the scoped `/v1/models` catalogs. A client picks a
 * catalog by swapping only its base URL; all other proxy routes behave as they
 * do under the full `/v1` catalog.
 */
const ModelCatalogEndpoints: Component = () => {
  const [catalog, { refetch }] = createResource(getModelCatalog);
  const [poolIds, setPoolIds] = createSignal<string[]>([]);
  const [providerIds, setProviderIds] = createSignal<string[]>([]);
  const [saving, setSaving] = createSignal(false);

  // Seed local selections from the loaded config (and again after a refetch so
  // they always reflect what the server actually stored).
  let seededFrom: ModelCatalogResponse | undefined;
  createEffect(() => {
    const data = catalog();
    if (data && data !== seededFrom) {
      seededFrom = data;
      setPoolIds([...data.pool_model_ids]);
      setProviderIds([...data.custom_provider_ids]);
    }
  });

  const endpoints = createMemo<EndpointRow[]>(() => {
    const origin = installOrigin();
    return [
      {
        id: 'default',
        label: 'Everything (current)',
        description: 'The full catalog — every model available to your workspace.',
        url: `${origin}/v1`,
      },
      {
        id: MODEL_CATALOG_VARIANTS[0],
        label: 'Synthetic only',
        description: 'Synthetic models only.',
        url: `${origin}${modelCatalogPath(MODEL_CATALOG_VARIANTS[0])}`,
      },
      {
        id: MODEL_CATALOG_VARIANTS[1],
        label: 'Synthetic + model pool',
        description: 'Synthetic models plus the manual pool you select below.',
        url: `${origin}${modelCatalogPath(MODEL_CATALOG_VARIANTS[1])}`,
      },
      {
        id: MODEL_CATALOG_VARIANTS[2],
        label: 'Synthetic + custom providers',
        description:
          'Synthetic models plus every model from the custom providers you select below.',
        url: `${origin}${modelCatalogPath(MODEL_CATALOG_VARIANTS[2])}`,
      },
    ];
  });

  const dirty = () => {
    const data = catalog();
    return (
      !!data &&
      (!sameIds(poolIds(), data.pool_model_ids) ||
        !sameIds(providerIds(), data.custom_provider_ids))
    );
  };

  const toggle =
    (setter: (next: string[]) => void, ids: () => string[]) => (id: string, checked: boolean) => {
      setter(checked ? [...ids(), id] : ids().filter((current) => current !== id));
    };

  const revert = () => {
    const data = catalog();
    if (!data) return;
    setPoolIds([...data.pool_model_ids]);
    setProviderIds([...data.custom_provider_ids]);
  };

  const save = async () => {
    if (saving() || catalog.loading) return;
    setSaving(true);
    try {
      const saved = await updateModelCatalog({
        pool_model_ids: poolIds(),
        custom_provider_ids: providerIds(),
      });
      // fetchMutate only toasts on failure, so a success toast is safe here.
      toast.success('Model catalog selection saved');
      setPoolIds([...saved.pool_model_ids]);
      setProviderIds([...saved.custom_provider_ids]);
      await refetch();
    } catch {
      // fetchMutate already showed the backend error — don't toast again.
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <h2 class="settings-section__title" id="model-catalogs">
        Model catalogs
      </h2>
      <div class="settings-card model-catalog-endpoints">
        <div class="settings-card__body">
          <p class="settings-card__desc">
            Clients choose a catalog by changing only their base URL — chat, responses, and the
            other proxy routes keep working exactly as they do under <code>/v1</code>. Only the
            model list returned by <code>/models</code> changes.
          </p>
        </div>
        <For each={endpoints()}>
          {(endpoint) => (
            <div class="settings-card__row model-catalog-row" data-variant={endpoint.id}>
              <div class="settings-card__label">
                <span class="settings-card__label-title">{endpoint.label}</span>
                <span class="settings-card__label-desc">{endpoint.description}</span>
              </div>
              <div class="settings-card__control model-catalog-url">
                <code class="model-catalog-url__value">{endpoint.url}</code>
                <CopyButton text={endpoint.url} />
              </div>
            </div>
          )}
        </For>
      </div>

      <h2 class="settings-section__title">Catalog contents</h2>
      <Show
        when={catalog()}
        fallback={
          <div class="settings-card">
            <div class="settings-card__row">
              <Show
                when={!catalog.error}
                fallback={
                  <span class="model-catalog-error" role="alert">
                    Could not load catalog settings.
                  </span>
                }
              >
                <span class="settings-card__label-desc">Loading catalog settings…</span>
              </Show>
            </div>
          </div>
        }
      >
        {(data) => (
          <div class="settings-card model-catalog-editor">
            <OptionPicker
              title="Manual model pool"
              description="Models from your public catalog that the synthetic + model pool endpoint lists."
              testId="model-catalog-pool"
              placeholder="Filter models…"
              options={data().options.pool_models}
              selected={poolIds()}
              onToggle={toggle(setPoolIds, poolIds)}
            />
            <OptionPicker
              title="Custom providers"
              description="Hand-added providers whose entire model list is published by the synthetic + custom providers endpoint."
              testId="model-catalog-providers"
              placeholder="Filter providers…"
              options={data().options.custom_providers}
              selected={providerIds()}
              onToggle={toggle(setProviderIds, providerIds)}
            />
            <div class="settings-card__footer model-catalog-footer">
              <button
                type="button"
                class="btn btn--outline btn--sm"
                disabled={saving() || !dirty()}
                onClick={revert}
              >
                Revert
              </button>
              <button
                type="button"
                class="btn btn--primary btn--sm"
                disabled={saving()}
                onClick={() => void save()}
              >
                {saving() ? <span class="spinner" /> : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Show>
    </>
  );
};

export default ModelCatalogEndpoints;
