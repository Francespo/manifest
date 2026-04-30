import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@solidjs/testing-library";
import type { HeaderTier } from "../../src/services/api/header-tiers";

const setHeaderTierFallbacksMock = vi.fn();
const clearHeaderTierFallbacksMock = vi.fn();
vi.mock("../../src/services/api/header-tiers.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    setHeaderTierFallbacks: (...args: unknown[]) => setHeaderTierFallbacksMock(...args),
    clearHeaderTierFallbacks: (...args: unknown[]) => clearHeaderTierFallbacksMock(...args),
  };
});

// Capture FallbackList props (and let the test invoke its closures).
const fallbackListCalls: Record<string, unknown>[] = [];
vi.mock("../../src/components/FallbackList.js", () => ({
  default: (props: Record<string, unknown>) => {
    fallbackListCalls.push(props);
    return (
      <div data-testid="mock-fallback-list">
        <button
          data-testid="invoke-persist-with-routes"
          onClick={() =>
            void (props.persistFallbacks as (
              agent: string,
              tierId: string,
              models: string[],
              routes?: unknown[],
            ) => Promise<unknown>)("ignored-agent", "cb-tier", ["m1"], [
              { provider: "openai", authType: "api_key", model: "m1" },
            ])
          }
        >
          persist
        </button>
      </div>
    );
  },
}));

vi.mock("../../src/components/ModelPickerModal.js", () => ({
  default: () => null,
}));

vi.mock("../../src/components/HeaderTierSnippetModal.js", () => ({
  default: () => null,
}));

vi.mock("../../src/components/ProviderIcon.js", () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

vi.mock("../../src/components/AuthBadge.js", () => ({
  authBadgeFor: () => null,
  authLabel: () => "API Key",
}));

import HeaderTierCard from "../../src/components/HeaderTierCard";

const baseTier: HeaderTier = {
  id: "ht-1",
  agent_id: "a1",
  name: "Premium",
  header_key: "x-manifest-tier",
  header_value: "premium",
  badge_color: "violet",
  sort_order: 0,
  enabled: true,
  override_model: "gpt-4o",
  override_provider: "openai",
  override_auth_type: "api_key",
  fallback_models: ["claude-opus-4-6"],
  created_at: "2026-04-21",
  updated_at: "2026-04-21",
};

describe("HeaderTierCard route prop forwarding", () => {
  beforeEach(() => {
    fallbackListCalls.length = 0;
    vi.clearAllMocks();
  });

  it("passes tier.fallback_routes down to FallbackList and exposes a route-aware persistFallbacks closure", async () => {
    setHeaderTierFallbacksMock.mockResolvedValue([]);
    const tier: HeaderTier = {
      ...baseTier,
      fallback_routes: [
        { provider: "anthropic", authType: "subscription", model: "claude-opus-4-6" },
      ],
    };

    const { getByTestId } = render(() => (
      <HeaderTierCard
        agentName="my-agent"
        tier={tier}
        models={[] as never}
        customProviders={[] as never}
        connectedProviders={[] as never}
        onOverride={vi.fn()}
        onFallbacksUpdate={vi.fn()}
      />
    ));

    expect(fallbackListCalls.length).toBe(1);
    // Routes are threaded through unchanged.
    expect(fallbackListCalls[0].fallbackRoutes).toEqual([
      { provider: "anthropic", authType: "subscription", model: "claude-opus-4-6" },
    ]);

    // The persistFallbacks closure forwards the card's agentName and the
    // 4th `routes` arg to setHeaderTierFallbacks (route-aware).
    fireEvent.click(getByTestId("invoke-persist-with-routes"));
    await waitFor(() =>
      expect(setHeaderTierFallbacksMock).toHaveBeenCalledWith(
        "my-agent",
        "cb-tier",
        ["m1"],
        [{ provider: "openai", authType: "api_key", model: "m1" }],
      ),
    );
  });
});
