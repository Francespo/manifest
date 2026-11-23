import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, configure } from '@solidjs/testing-library';
import type { ModelCatalogResponse } from 'manifest-shared';

const mockGetModelCatalog = vi.fn();
const mockUpdateModelCatalog = vi.fn();
const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();

vi.mock('../../src/services/api/model-catalog.js', () => ({
  getModelCatalog: (...args: unknown[]) => mockGetModelCatalog(...args),
  updateModelCatalog: (...args: unknown[]) => mockUpdateModelCatalog(...args),
}));
vi.mock('../../src/services/toast-store.js', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}));
vi.mock('../../src/services/install-endpoints.js', () => ({
  installOrigin: () => 'https://catalog.test',
}));

import ModelCatalogEndpoints from '../../src/components/ModelCatalogEndpoints';

const config = (): ModelCatalogResponse => ({
  pool_model_ids: ['openai/gpt-4o'],
  custom_provider_ids: ['cp-1'],
  options: {
    pool_models: [
      { id: 'openai/gpt-4o', label: 'GPT-4o' },
      { id: 'anthropic/claude', label: 'Claude' },
    ],
    custom_providers: [
      { id: 'cp-1', label: 'Acme' },
      { id: 'cp-2', label: 'Beta' },
    ],
  },
});

const waitForEditor = (container: HTMLElement) =>
  waitFor(() => expect(container.querySelector('[data-testid="model-catalog-pool"]')).not.toBeNull());

describe('ModelCatalogEndpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelCatalog.mockReset().mockResolvedValue(config());
    mockUpdateModelCatalog.mockReset().mockResolvedValue(config());
    configure({ asyncUtilTimeout: 5000 });
  });
  afterEach(() => {
    configure({ asyncUtilTimeout: 1000 });
  });

  it('renders the default base URL and all three catalog variant URLs with copy buttons', () => {
    const { container } = render(() => <ModelCatalogEndpoints />);

    const urls = Array.from(container.querySelectorAll('.model-catalog-url__value')).map(
      (node) => node.textContent?.trim(),
    );
    expect(urls).toEqual([
      'https://catalog.test/v1',
      'https://catalog.test/catalog/synthetic/v1',
      'https://catalog.test/catalog/synthetic-pool/v1',
      'https://catalog.test/catalog/synthetic-providers/v1',
    ]);
    expect(container.querySelectorAll('.model-catalog-endpoints .modal-terminal__copy')).toHaveLength(
      4,
    );
    expect(screen.getByText('Everything (current)')).toBeTruthy();
    expect(screen.getByText('Synthetic only')).toBeTruthy();
  });

  it('selects pool models and custom providers and saves them', async () => {
    const { container } = render(() => <ModelCatalogEndpoints />);
    await waitForEditor(container);

    const poolCheckbox = container.querySelector(
      'input[data-option-id="anthropic/claude"]',
    ) as HTMLInputElement;
    const providerCheckbox = container.querySelector(
      'input[data-option-id="cp-2"]',
    ) as HTMLInputElement;
    expect(poolCheckbox).not.toBeNull();
    expect(providerCheckbox).not.toBeNull();

    fireEvent.click(poolCheckbox);
    fireEvent.click(providerCheckbox);
    expect(poolCheckbox.checked).toBe(true);
    expect(providerCheckbox.checked).toBe(true);

    const saved: ModelCatalogResponse = {
      pool_model_ids: ['openai/gpt-4o', 'anthropic/claude'],
      custom_provider_ids: ['cp-1', 'cp-2'],
      options: config().options,
    };
    mockUpdateModelCatalog.mockResolvedValueOnce(saved);
    mockGetModelCatalog.mockResolvedValueOnce(saved); // the refetch after save

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(mockUpdateModelCatalog).toHaveBeenCalledWith({
        pool_model_ids: ['openai/gpt-4o', 'anthropic/claude'],
        custom_provider_ids: ['cp-1', 'cp-2'],
      }),
    );
    await waitFor(() =>
      expect(mockToastSuccess).toHaveBeenCalledWith('Model catalog selection saved'),
    );
    await waitFor(() => expect(mockGetModelCatalog).toHaveBeenCalledTimes(2));
  });

  it('filters the options and reverts unsaved changes', async () => {
    const { container } = render(() => <ModelCatalogEndpoints />);
    await waitForEditor(container);

    const filter = container.querySelector(
      'input[aria-label="Filter Manual model pool"]',
    ) as HTMLInputElement;
    fireEvent.input(filter, { target: { value: 'Claude' } });
    await waitFor(() =>
      expect(
        container.querySelectorAll('[data-testid="model-catalog-pool"] input[type="checkbox"]'),
      ).toHaveLength(1),
    );

    fireEvent.click(
      container.querySelector('input[data-option-id="anthropic/claude"]') as HTMLInputElement,
    );
    const revert = screen.getByRole('button', { name: 'Revert' }) as HTMLButtonElement;
    expect(revert.disabled).toBe(false);
    fireEvent.click(revert);

    await waitFor(() =>
      expect(
        (container.querySelector('input[data-option-id="anthropic/claude"]') as HTMLInputElement)
          .checked,
      ).toBe(false),
    );
    expect(mockUpdateModelCatalog).not.toHaveBeenCalled();
  });

  it('shows a saving state and disables Save while the request is in flight', async () => {
    const { container } = render(() => <ModelCatalogEndpoints />);
    await waitForEditor(container);

    let resolveSave!: (value: ModelCatalogResponse) => void;
    mockUpdateModelCatalog.mockReturnValueOnce(
      new Promise<ModelCatalogResponse>((resolve) => {
        resolveSave = resolve;
      }),
    );

    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    fireEvent.click(save);
    await waitFor(() => expect(save.disabled).toBe(true));
    expect(save.querySelector('.spinner')).not.toBeNull();

    resolveSave(config());
    await waitFor(() => expect(save.disabled).toBe(false));
    expect(container.querySelector('.model-catalog-editor')).not.toBeNull();
  });
});
