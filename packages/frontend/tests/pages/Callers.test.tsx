import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";

vi.mock("@solidjs/router", () => ({
  useParams: () => ({ agentName: "main" }),
}));

vi.mock("@solidjs/meta", () => ({
  Title: (props: any) => <title>{props.children}</title>,
  Meta: (props: any) => <meta name={props.name ?? ""} content={props.content ?? ""} />,
}));

const mockGetCallers = vi.fn();
vi.mock("../../src/services/api.js", () => ({
  getCallers: (range: string, agentName?: string) => mockGetCallers(range, agentName),
}));

vi.mock("../../src/services/toast-store.js", () => ({
  toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import Callers from "../../src/pages/Callers";

describe("Callers page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders heading and breadcrumb", () => {
    mockGetCallers.mockResolvedValue({
      callers: [],
      sdks: [],
      total_messages: 0,
      attributed_messages: 0,
    });
    render(() => <Callers />);
    expect(screen.getByText("Callers")).toBeDefined();
    expect(
      screen.getByText(/Apps and SDKs calling this agent/i),
    ).toBeDefined();
  });

  it("shows empty state when no messages recorded", async () => {
    mockGetCallers.mockResolvedValue({
      callers: [],
      sdks: [],
      total_messages: 0,
      attributed_messages: 0,
    });
    render(() => <Callers />);
    await vi.waitFor(() => {
      expect(
        screen.getByText(/No messages recorded in the last 24 hours/i),
      ).toBeDefined();
    });
  });

  it("renders caller rows and SDK breakdown with attribution rate", async () => {
    mockGetCallers.mockResolvedValue({
      callers: [
        {
          app_name: "OpenClaw",
          app_url: "https://openclaw.ai",
          sdk: "openai-js",
          message_count: 12,
          input_tokens: 1200,
          output_tokens: 400,
          cost_usd: 0.15,
          first_seen: "2026-04-10T09:00:00",
          last_seen: "2026-04-10T10:00:00",
        },
        {
          app_name: null,
          app_url: null,
          sdk: "curl",
          message_count: 4,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          first_seen: "2026-04-10T09:00:00",
          last_seen: "2026-04-10T10:00:00",
        },
      ],
      sdks: [
        { sdk: "openai-js", message_count: 12, cost_usd: 0.15 },
        { sdk: "curl", message_count: 4, cost_usd: 0 },
      ],
      total_messages: 20,
      attributed_messages: 16,
    });
    render(() => <Callers />);

    await vi.waitFor(() => {
      expect(screen.getByText("OpenClaw")).toBeDefined();
    });
    // Unattributed row falls back to sdk label "curl" in the name column
    expect(screen.getAllByText("curl").length).toBeGreaterThan(0);
    // 16/20 = 80% attribution rate
    expect(screen.getByText(/\(80%\)/)).toBeDefined();
  });

  it("renders 'Unknown' label for callers with no app_name/app_url/sdk", async () => {
    mockGetCallers.mockResolvedValue({
      callers: [
        {
          app_name: null,
          app_url: null,
          sdk: null,
          message_count: 3,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          first_seen: "2026-04-10T09:00:00",
          last_seen: "2026-04-10T10:00:00",
        },
      ],
      sdks: [{ sdk: null, message_count: 3, cost_usd: 0 }],
      total_messages: 3,
      attributed_messages: 0,
    });
    render(() => <Callers />);
    await vi.waitFor(() => {
      expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
    });
  });

  it("falls back to app_url as caller label when app_name is missing", async () => {
    mockGetCallers.mockResolvedValue({
      callers: [
        {
          app_name: null,
          app_url: "https://example.com",
          sdk: null,
          message_count: 1,
          input_tokens: 0,
          output_tokens: 0,
          cost_usd: 0,
          first_seen: "2026-04-10T09:00:00",
          last_seen: "2026-04-10T10:00:00",
        },
      ],
      sdks: [{ sdk: null, message_count: 1, cost_usd: 0 }],
      total_messages: 1,
      attributed_messages: 1,
    });
    render(() => <Callers />);
    await vi.waitFor(() => {
      // "https://example.com" appears once in the name column and once in URL column
      expect(screen.getAllByText("https://example.com").length).toBeGreaterThanOrEqual(1);
    });
  });
});
