import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@solidjs/testing-library';
import QuotaBucketsDrawer from '../../src/components/QuotaBucketsDrawer';
import * as modelQuotasApi from '../../src/services/api/model-quotas';


describe('QuotaBucketsDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing visible when open is false', () => {
    vi.spyOn(modelQuotasApi, 'getModelQuotaStatus').mockResolvedValue({
      buckets: [],
      timestamp: '2026-08-21T00:00:00.000Z',
    });

    const { container } = render(() => <QuotaBucketsDrawer open={false} onClose={() => {}} />);

    const drawer = document.body.querySelector('.quota-drawer');
    expect(drawer).not.toBeNull();
    expect(drawer?.classList.contains('drawer--open')).toBe(false);
  });

  it('renders large panel with KPI cards, search, and metrics when open', async () => {
    vi.spyOn(modelQuotasApi, 'getModelQuotaStatus').mockResolvedValue({
      buckets: [
        {
          provider: 'google',
          model: 'gemini-3.7-flash',
          modelFamily: 'gemini-3.7',
          keyLabel: 'Mario Key',
          keyIdentity: 'mario-hash',
          rpmUsed: 4,
          rpmLimit: 5,
          tpmUsed: 150_000,
          tpmLimit: 250_000,
          rpdUsed: 19,
          rpdLimit: 20,
          frozenUntil: null,
          freezeReason: null,
          status: 'active',
          lastUsedAt: null,
        },
      ],
      timestamp: '2026-08-21T00:00:00.000Z',
    });

    render(() => <QuotaBucketsDrawer open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(document.body.textContent).toContain('Quota Buckets & Rate Limits');
      expect(document.body.textContent).toContain('Mario Key');
      expect(document.body.textContent).toContain('gemini-3.7-flash');
      expect(document.body.textContent).toContain('Requests / Min (RPM)');
      expect(document.body.textContent).toContain('Tokens / Min (TPM)');
      expect(document.body.textContent).toContain('Requests / Day (RPD)');
      expect(document.body.textContent).toContain('Active');
    });
  });

  it('filters buckets by search term in large panel', async () => {
    vi.spyOn(modelQuotasApi, 'getModelQuotaStatus').mockResolvedValue({
      buckets: [
        {
          provider: 'google',
          model: 'gemini-3.7-flash',
          modelFamily: 'gemini-3.7',
          keyLabel: 'Mario Key',
          keyIdentity: 'mario-hash',
          rpmUsed: 1,
          rpmLimit: 5,
          tpmUsed: 50_000,
          tpmLimit: 250_000,
          rpdUsed: 10,
          rpdLimit: 20,
          frozenUntil: null,
          freezeReason: null,
          status: 'active',
          lastUsedAt: null,
        },
        {
          provider: 'google',
          model: 'gemini-2.5-flash-lite',
          modelFamily: 'gemini-2.5',
          keyLabel: 'Luigi Key',
          keyIdentity: 'luigi-hash',
          rpmUsed: 2,
          rpmLimit: 15,
          tpmUsed: 30_000,
          tpmLimit: 250_000,
          rpdUsed: 5,
          rpdLimit: 500,
          frozenUntil: null,
          freezeReason: null,
          status: 'active',
          lastUsedAt: null,
        },
      ],
      timestamp: '2026-08-21T00:00:00.000Z',
    });

    render(() => <QuotaBucketsDrawer open={true} onClose={() => {}} />);

    await waitFor(() => {
      expect(document.body.textContent).toContain('Mario Key');
      expect(document.body.textContent).toContain('Luigi Key');
    });

    const searchInput = document.body.querySelector('.quota-drawer__search') as HTMLInputElement;
    expect(searchInput).not.toBeNull();

    fireEvent.input(searchInput, { target: { value: 'luigi' } });

    await waitFor(() => {
      expect(document.body.textContent).not.toContain('Mario Key');
      expect(document.body.textContent).toContain('Luigi Key');
    });

  });

  it('calls onClose when close button clicked', async () => {
    const onClose = vi.fn();
    render(() => <QuotaBucketsDrawer open={true} onClose={onClose} />);

    const closeBtn = document.body.querySelector('.drawer__close') as HTMLButtonElement;
    expect(closeBtn).not.toBeNull();
    closeBtn.click();

    expect(onClose).toHaveBeenCalled();
  });
});
