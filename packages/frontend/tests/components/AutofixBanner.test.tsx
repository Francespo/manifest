import { render, screen } from 'solid-testing-library';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AutofixBanner from '../../src/components/AutofixBanner';

describe('AutofixBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders the banner with text and button', () => {
    const { container } = render(() => <AutofixBanner />);
    expect(screen.getByText(/Reduce your API errors with Autofix/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /Get started/i })).toBeTruthy();
    expect(container.querySelector('.autofix-banner')).not.toBeNull();
  });

  it('hides the banner when close button is clicked', async () => {
    const { container } = render(() => <AutofixBanner />);
    const closeBtn = container.querySelector('.autofix-banner__close');
    closeBtn?.dispatchEvent(new Event('click'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.querySelector('.autofix-banner')).toBeNull();
  });

  it('persists dismissal in sessionStorage', () => {
    const { container } = render(() => <AutofixBanner />);
    const closeBtn = container.querySelector('.autofix-banner__close');
    closeBtn?.dispatchEvent(new Event('click'));
    expect(sessionStorage.getItem('autofix-banner-dismissed')).toBe('true');
  });

  it('does not render if already dismissed', () => {
    sessionStorage.setItem('autofix-banner-dismissed', 'true');
    const { container } = render(() => <AutofixBanner />);
    expect(container.querySelector('.autofix-banner')).toBeNull();
  });
});
