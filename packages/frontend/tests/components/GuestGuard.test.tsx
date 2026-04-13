import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";

const mockNavigate = vi.fn();
const mockCheckNeedsSetup = vi.fn();
let mockSessionData: any = { data: null, isPending: false };

vi.mock("@solidjs/router", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("../../src/services/auth-client.js", () => ({
  authClient: {
    useSession: () => () => mockSessionData,
  },
}));

vi.mock("../../src/services/setup-status.js", () => ({
  checkNeedsSetup: (...args: unknown[]) => mockCheckNeedsSetup(...args),
}));

import GuestGuard from "../../src/components/GuestGuard";

describe("GuestGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionData = { data: null, isPending: false };
    mockCheckNeedsSetup.mockResolvedValue(false);
  });

  it("renders children when no session and setup is complete", async () => {
    render(() => (
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>
    ));
    await vi.waitFor(() => {
      expect(screen.queryByText("Guest content")).toBeDefined();
    });
  });

  it("redirects to home when session exists", async () => {
    mockSessionData = {
      data: { user: { id: "u1", name: "Test" } },
      isPending: false,
    };
    render(() => (
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>
    ));
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/", { replace: true });
    });
  });

  it("redirects to /setup when setup is incomplete", async () => {
    mockCheckNeedsSetup.mockResolvedValue(true);
    render(() => (
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>
    ));
    await vi.waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith("/setup", { replace: true });
    });
  });

  it("does not render children while setup check is pending", () => {
    // checkNeedsSetup hangs — we should see no content rendered yet
    mockCheckNeedsSetup.mockReturnValue(new Promise(() => undefined));
    const { container } = render(() => (
      <GuestGuard>
        <span>Guest content</span>
      </GuestGuard>
    ));
    expect(container.textContent).not.toContain("Guest content");
  });
});
