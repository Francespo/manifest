import { render, screen } from 'solid-testing-library';
import { describe, it, expect, beforeEach } from 'vitest';
import AutofixAnnouncement from '../../src/components/AutofixAnnouncement';

describe('AutofixAnnouncement', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it('renders the announcement card with title and benefits', () => {
    const { container } = render(() => <AutofixAnnouncement />);
    expect(screen.getByText('Make sure your APIs no longer crash')).toBeTruthy();
    expect(screen.getByText('Fix API failures automatically')).toBeTruthy();
    expect(screen.getByText('Get notified of root cause')).toBeTruthy();
    expect(screen.getByText('Works across your entire stack')).toBeTruthy();
    expect(container.querySelector('.sidebar-autofix')).not.toBeNull();
  });

  it('renders the Get started button', () => {
    render(() => <AutofixAnnouncement />);
    const btn = screen.getByRole('link', { name: /Get started/i });
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('href')).toBe('https://dashboard.manifest.build');
    expect(btn.getAttribute('target')).toBe('_blank');
  });

  it('hides the card when dismiss button is clicked', async () => {
    const { container } = render(() => <AutofixAnnouncement />);
    const dismissBtn = container.querySelector('.sidebar-autofix__dismiss');
    dismissBtn?.dispatchEvent(new Event('click'));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(container.querySelector('.sidebar-autofix')).toBeNull();
  });

  it('persists dismissal in sessionStorage', () => {
    const { container } = render(() => <AutofixAnnouncement />);
    const dismissBtn = container.querySelector('.sidebar-autofix__dismiss');
    dismissBtn?.dispatchEvent(new Event('click'));
    expect(sessionStorage.getItem('autofix-announcement-dismissed')).toBe('true');
  });

  it('does not render if already dismissed', () => {
    sessionStorage.setItem('autofix-announcement-dismissed', 'true');
    const { container } = render(() => <AutofixAnnouncement />);
    expect(container.querySelector('.sidebar-autofix')).toBeNull();
  });
});
