import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent } from '@solidjs/testing-library';

const checkIsLocalMode = vi.fn();
const checkIsOllamaAvailable = vi.fn();

vi.mock('../../src/services/setup-status.js', () => ({
  checkIsLocalMode: () => checkIsLocalMode(),
  checkIsOllamaAvailable: () => checkIsOllamaAvailable(),
}));

import ProviderApiKeyTab from '../../src/components/ProviderApiKeyTab';
import type { ProviderDef } from '../../src/services/providers';

const provider = (overrides: Partial<ProviderDef> & { id: string; name: string }): ProviderDef =>
  ({
    color: '#333',
    initial: overrides.name.charAt(0),
    docUrl: 'https://docs.example',
    keyPlaceholder: 'key',
    ...overrides,
  }) as ProviderDef;

function flushMicrotasks() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  checkIsLocalMode.mockReset();
  checkIsOllamaAvailable.mockReset();
});

describe('ProviderApiKeyTab', () => {
  it('sorts standard and custom providers alphabetically in the merged list', async () => {
    checkIsLocalMode.mockResolvedValue(false);
    checkIsOllamaAvailable.mockResolvedValue(false);

    const { container } = render(() => (
      <ProviderApiKeyTab
        apiKeyProviders={[provider({ id: 'zee', name: 'Zeta' }), provider({ id: 'ant', name: 'Anthropic' })]}
        customProviders={[{ id: 'c1', name: 'Custom-B', base_url: 'https://b', models: [] } as never]}
        isConnected={() => false}
        isNoKeyConnected={() => false}
        onOpenDetail={vi.fn()}
        onOpenCustomForm={vi.fn()}
        onEditCustom={vi.fn()}
      />
    ));
    await flushMicrotasks();

    const names = Array.from(container.querySelectorAll('.provider-toggle__name')).map(
      (n) => n.textContent?.trim() ?? '',
    );
    // Sorted by name: Anthropic, Custom-B (has a "Custom" tag suffix), Zeta.
    expect(names[0]).toContain('Anthropic');
    expect(names[1]).toContain('Custom-B');
    expect(names[2]).toContain('Zeta');
  });

  it('disables local-only providers when not in local mode and shows the hint', async () => {
    checkIsLocalMode.mockResolvedValue(false);
    checkIsOllamaAvailable.mockResolvedValue(false);

    const onOpenDetail = vi.fn();
    const { container } = render(() => (
      <ProviderApiKeyTab
        apiKeyProviders={[
          provider({ id: 'ollama', name: 'Ollama', localOnly: true } as ProviderDef),
        ]}
        customProviders={[]}
        isConnected={() => false}
        isNoKeyConnected={() => false}
        onOpenDetail={onOpenDetail}
        onOpenCustomForm={vi.fn()}
        onEditCustom={vi.fn()}
      />
    ));
    await flushMicrotasks();

    const btn = container.querySelector('button.provider-toggle') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(container.textContent).toContain('Only available on Manifest Local');
    fireEvent.click(btn);
    expect(onOpenDetail).not.toHaveBeenCalled();
  });

  it('shows the Ollama "enable with docker compose" hint when in local mode but Ollama is unreachable', async () => {
    checkIsLocalMode.mockResolvedValue(true);
    checkIsOllamaAvailable.mockResolvedValue(false);

    const { container } = render(() => (
      <ProviderApiKeyTab
        apiKeyProviders={[
          provider({ id: 'ollama', name: 'Ollama', localOnly: true } as ProviderDef),
        ]}
        customProviders={[]}
        isConnected={() => false}
        isNoKeyConnected={() => false}
        onOpenDetail={vi.fn()}
        onOpenCustomForm={vi.fn()}
        onEditCustom={vi.fn()}
      />
    ));
    await flushMicrotasks();

    const btn = container.querySelector('button.provider-toggle') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(container.textContent).toContain(
      'Enable with: docker compose --profile ollama up',
    );
  });

  it('enables Ollama when local mode is on and the daemon is reachable, then invokes onOpenDetail', async () => {
    checkIsLocalMode.mockResolvedValue(true);
    checkIsOllamaAvailable.mockResolvedValue(true);

    const onOpenDetail = vi.fn();
    const { container } = render(() => (
      <ProviderApiKeyTab
        apiKeyProviders={[
          provider({ id: 'ollama', name: 'Ollama', localOnly: true } as ProviderDef),
        ]}
        customProviders={[]}
        isConnected={() => true}
        isNoKeyConnected={() => false}
        onOpenDetail={onOpenDetail}
        onOpenCustomForm={vi.fn()}
        onEditCustom={vi.fn()}
      />
    ));
    await flushMicrotasks();

    const btn = container.querySelector('button.provider-toggle') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(container.querySelector('.provider-toggle__switch--on')).not.toBeNull();
    fireEvent.click(btn);
    expect(onOpenDetail).toHaveBeenCalledWith('ollama', 'api_key');
  });

  it('renders a letter badge for custom providers with no logo, and wires onEditCustom', async () => {
    checkIsLocalMode.mockResolvedValue(false);
    checkIsOllamaAvailable.mockResolvedValue(false);

    const onEditCustom = vi.fn();
    const customProvider = {
      id: 'c1',
      name: 'acme-host',
      base_url: 'https://api.example',
      models: [],
    } as never;

    const { container } = render(() => (
      <ProviderApiKeyTab
        apiKeyProviders={[]}
        customProviders={[customProvider]}
        isConnected={() => false}
        isNoKeyConnected={() => false}
        onOpenDetail={vi.fn()}
        onOpenCustomForm={vi.fn()}
        onEditCustom={onEditCustom}
      />
    ));
    await flushMicrotasks();

    const letter = container.querySelector('.provider-card__logo-letter');
    expect(letter?.textContent).toBe('A');
    fireEvent.click(container.querySelector('button.provider-toggle') as HTMLElement);
    expect(onEditCustom).toHaveBeenCalledWith(customProvider);
  });

  it('fires onOpenCustomForm when the "Add custom provider" chip is clicked', async () => {
    checkIsLocalMode.mockResolvedValue(false);
    checkIsOllamaAvailable.mockResolvedValue(false);

    const onOpenCustomForm = vi.fn();
    const { container } = render(() => (
      <ProviderApiKeyTab
        apiKeyProviders={[]}
        customProviders={[]}
        isConnected={() => false}
        isNoKeyConnected={() => false}
        onOpenDetail={vi.fn()}
        onOpenCustomForm={onOpenCustomForm}
        onEditCustom={vi.fn()}
      />
    ));
    await flushMicrotasks();

    fireEvent.click(container.querySelector('.provider-modal__add-custom-chip') as HTMLElement);
    expect(onOpenCustomForm).toHaveBeenCalled();
  });
});
