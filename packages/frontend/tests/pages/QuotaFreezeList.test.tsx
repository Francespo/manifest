import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@solidjs/testing-library';

vi.mock('solid-js/web', async (importOriginal) => {
  const mod = await importOriginal<typeof import('solid-js/web')>();
  return { ...mod, Portal: (props: any) => props.children };
});

const mockList = vi.fn();
const mockResume = vi.fn();
vi.mock('../../src/services/api/quota-freezes.js', () => ({
  listQuotaFreezes: (...args: unknown[]) => mockList(...args),
  resumeQuotaFreeze: (...args: unknown[]) => mockResume(...args),
}));

vi.mock('../../src/services/providers.js', () => ({
  PROVIDERS: [
    { id: 'gemini', name: 'Google' },
    { id: 'opencode-zen', name: 'OpenCode Zen' },
  ],
}));

vi.mock('../../src/components/ProviderIcon.js', () => ({
  providerIcon: () => null,
}));

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();
vi.mock('../../src/services/toast-store.js', () => ({
  toast: { success: (...a: unknown[]) => mockToastSuccess(...a), error: (...a: unknown[]) => mockToastError(...a), warning: vi.fn() },
}));

import QuotaFreezeList from '../../src/pages/QuotaFreezeList';

describe('QuotaFreezeList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue({ freezes: [] });
    mockResume.mockResolvedValue({ ok: true });
  });

  const freezes = [
    {
      provider: 'gemini',
      authType: 'api_key',
      providerKeyLabel: 'Dev',
      reason: 'day' as const,
      message: 'Error body indicates daily quota limit reached',
      exhaustedUntil: Date.now() + 6 * 3600 * 1000,
      remainingMs: 6 * 3600 * 1000,
      remainingLabel: '6h 0m',
    },
    {
      provider: 'opencode-zen',
      authType: 'api_key',
      providerKeyLabel: 'Default',
      reason: 'hour' as const,
      message: 'OpenCode Zen free usage limit reached',
      exhaustedUntil: Date.now() + 45 * 60 * 1000,
      remainingMs: 45 * 60 * 1000,
      remainingLabel: '45m',
    },
  ];

  it('renders nothing when there are no freezes', async () => {
    const { container } = render(() => <QuotaFreezeList agentName={() => 'demo'} />);
    await waitFor(() => expect(mockList).toHaveBeenCalledWith('demo'));
    expect(container.querySelector('.quota-freeze-section')).toBeNull();
  });

  it('renders each freeze with provider, key label, freeze type and remaining time', async () => {
    mockList.mockResolvedValue({ freezes });
    const { container } = render(() => <QuotaFreezeList agentName={() => 'demo'} />);
    await waitFor(() => {
      const items = container.querySelectorAll('.quota-freeze-item');
      expect(items.length).toBe(2);
    });
    expect(container.textContent).toContain('Google');
    expect(container.textContent).toContain('Dev');
    expect(container.textContent).toContain('6h 0m left');
    expect(container.textContent).toContain('OpenCode Zen');
    expect(container.textContent).toContain('45m left');
    // freeze type badges
    expect(container.querySelector('.quota-freeze-item__badge--day')).not.toBeNull();
    expect(container.querySelector('.quota-freeze-item__badge--hour')).not.toBeNull();
  });

  it('resumes a key and refetches the list', async () => {
    mockList
      .mockResolvedValueOnce({ freezes })
      .mockResolvedValueOnce({ freezes: [freezes[1]] });
    const { container } = render(() => <QuotaFreezeList agentName={() => 'demo'} />);
    await waitFor(() => {
      expect(container.querySelectorAll('.quota-freeze-item').length).toBe(2);
    });
    const resumeButtons = container.querySelectorAll('.quota-freeze-item__resume');
    fireEvent.click(resumeButtons[0]);
    await waitFor(() => {
      expect(mockResume).toHaveBeenCalledWith('demo', 'gemini', 'api_key', 'Dev');
      // Refetch happened and the resumed key dropped off the list.
      expect(container.querySelectorAll('.quota-freeze-item').length).toBe(1);
    });
    expect(container.textContent).toContain('OpenCode Zen');
  });

  it('shows an error toast when resume fails', async () => {
    mockResume.mockRejectedValue(new Error('boom'));
    mockList.mockResolvedValue({ freezes });
    const { container } = render(() => <QuotaFreezeList agentName={() => 'demo'} />);
    await waitFor(() => {
      expect(container.querySelectorAll('.quota-freeze-item').length).toBe(2);
    });
    fireEvent.click(container.querySelector('.quota-freeze-item__resume')!);
    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith('Failed to resume "Dev"');
    });
  });
});
