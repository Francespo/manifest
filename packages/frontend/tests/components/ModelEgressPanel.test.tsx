import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@solidjs/testing-library';

const { mockGetProviderModels, mockSetProviderModelEgress, mockGetUsEgressHealth, mockToast } =
  vi.hoisted(() => ({
    mockGetProviderModels: vi.fn(),
    mockSetProviderModelEgress: vi.fn(),
    mockGetUsEgressHealth: vi.fn(),
    mockToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
  }));

vi.mock('../../src/services/api/providers.js', () => ({
  getProviderModels: (...args: unknown[]) => mockGetProviderModels(...args),
  setProviderModelEgress: (...args: unknown[]) => mockSetProviderModelEgress(...args),
  getUsEgressHealth: (...args: unknown[]) => mockGetUsEgressHealth(...args),
}));

vi.mock('../../src/services/toast-store.js', () => ({ toast: mockToast }));

import ModelEgressPanel from '../../src/components/ModelEgressPanel';

const response = {
  provider: 'opencode-go',
  auth_type: 'subscription' as const,
  supports_us_egress: true,
  us_egress_available: true,
  models: [
    {
      model: 'crouton-alpha-free',
      display_name: 'Crouton Alpha Free',
      egress: 'us' as const,
      explicit: false,
    },
    {
      model: 'muse-spark-1.2-contributor',
      display_name: 'Muse Spark 1.2 Contributor',
      egress: 'direct' as const,
      explicit: false,
    },
  ],
};

describe('ModelEgressPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetProviderModels.mockResolvedValue(response);
    mockGetUsEgressHealth.mockResolvedValue({
      configured: true,
      reachable: true,
      status: 'ok',
      target: 'https://opencode.ai/zen/go',
      latency_ms: 12,
    });
    mockSetProviderModelEgress.mockResolvedValue({
      provider: 'opencode-go',
      auth_type: 'subscription',
      model: 'crouton-alpha-free',
      egress: 'direct',
    });
  });

  it('lists models with their effective egress and marks auto-US models', async () => {
    render(() => <ModelEgressPanel provider="opencode-go" authType="subscription" />);

    expect(await screen.findByText('Crouton Alpha Free')).toBeTruthy();
    expect(screen.getByText('Muse Spark 1.2 Contributor')).toBeTruthy();
    expect(screen.getByText('Auto')).toBeTruthy();
    expect(screen.getByText('US gateway online (12 ms)')).toBeTruthy();

    const crouton = screen.getByRole('switch', { name: /crouton-alpha-free/i });
    const muse = screen.getByRole('switch', { name: /muse-spark-1.2-contributor/i });
    expect(crouton.getAttribute('aria-checked')).toBe('true');
    expect(muse.getAttribute('aria-checked')).toBe('false');
  });

  it('writes an explicit policy when a switch is toggled', async () => {
    render(() => <ModelEgressPanel provider="opencode-go" authType="subscription" />);

    const crouton = await screen.findByRole('switch', { name: /crouton-alpha-free/i });
    fireEvent.click(crouton);

    await waitFor(() => {
      expect(mockSetProviderModelEgress).toHaveBeenCalledWith(
        'opencode-go',
        'crouton-alpha-free',
        'direct',
        'subscription',
      );
    });
    await waitFor(() => {
      expect(mockToast.success).toHaveBeenCalledWith('crouton-alpha-free now routes directly');
    });
  });

  it('renders nothing for a provider without US egress', async () => {
    mockGetProviderModels.mockResolvedValue({
      ...response,
      supports_us_egress: false,
      models: [],
    });

    const { container } = render(() => (
      <ModelEgressPanel provider="anthropic" authType="api_key" />
    ));

    await waitFor(() => expect(mockGetProviderModels).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('disables switches when the gateway is not configured', async () => {
    mockGetProviderModels.mockResolvedValue({ ...response, us_egress_available: false });

    render(() => <ModelEgressPanel provider="opencode-go" authType="subscription" />);

    const crouton = await screen.findByRole('switch', { name: /crouton-alpha-free/i });
    expect(crouton.hasAttribute('disabled')).toBe(true);
  });
});
