import { describe, it, expect, vi } from "vitest";
import { render } from "@solidjs/testing-library";
import type { TierAssignment } from "../../src/services/api.js";

vi.mock("../../src/services/api.js", () => ({
  setFallbacks: vi.fn(),
}));

vi.mock("../../src/services/toast-store.js", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/components/ProviderIcon.js", () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

vi.mock("../../src/components/AuthBadge.js", () => ({
  authBadgeFor: () => null,
  authLabel: () => "API Key",
}));

vi.mock("../../src/services/providers.js", () => ({
  PROVIDERS: [{ id: "openai", name: "OpenAI", models: [] }],
}));

vi.mock("../../src/services/routing-utils.js", () => ({
  pricePerM: (v: number) => `$${(v * 1_000_000).toFixed(2)}`,
  resolveProviderId: (p: string) => p.toLowerCase(),
  inferProviderFromModel: (_n: string) => null,
}));

vi.mock("../../src/services/provider-utils.js", () => ({
  getModelLabel: (_id: string, model: string) => model,
}));

vi.mock("../../src/services/formatters.js", () => ({
  customProviderColor: () => "#000",
}));

// Capture the props the FallbackList receives so we can assert on the
// `fallbackRoutes` prop the parent threads through.
const fallbackListProps: Record<string, unknown>[] = [];
vi.mock("../../src/components/FallbackList.js", () => ({
  default: (props: Record<string, unknown>) => {
    fallbackListProps.push(props);
    return <div data-testid="mock-fallback-list" />;
  },
}));

import RoutingTierCard from "../../src/pages/RoutingTierCard";

const stage = { id: "simple", label: "Simple" } as never;

const baseTier: TierAssignment = {
  id: "1",
  agent_id: "a1",
  tier: "simple",
  override_model: "gpt-4o",
  override_provider: "openai",
  override_auth_type: "api_key",
  auto_assigned_model: null,
  fallback_models: ["claude-opus-4-6"],
  updated_at: "2026-04-21",
};

describe("RoutingTierCard route prop forwarding", () => {
  it("passes tier.fallback_routes down to FallbackList when present", () => {
    fallbackListProps.length = 0;
    const tier: TierAssignment = {
      ...baseTier,
      fallback_routes: [
        { provider: "anthropic", authType: "subscription", model: "claude-opus-4-6" },
      ],
    };
    render(() => (
      <RoutingTierCard
        stage={stage}
        tier={() => tier}
        models={() => []}
        customProviders={() => []}
        activeProviders={() => []}
        connectedProviders={() => []}
        tiersLoading={false}
        changingTier={() => null}
        resettingTier={() => null}
        resettingAll={() => false}
        addingFallback={() => null}
        agentName={() => "test-agent"}
        onDropdownOpen={vi.fn()}
        onOverride={vi.fn()}
        onReset={vi.fn()}
        onFallbackUpdate={vi.fn()}
        onAddFallback={vi.fn()}
        getFallbacksFor={() => ["claude-opus-4-6"]}
      />
    ));

    expect(fallbackListProps.length).toBe(1);
    expect(fallbackListProps[0].fallbackRoutes).toEqual([
      { provider: "anthropic", authType: "subscription", model: "claude-opus-4-6" },
    ]);
  });

  it("passes null for fallbackRoutes when tier.fallback_routes is undefined", () => {
    fallbackListProps.length = 0;
    render(() => (
      <RoutingTierCard
        stage={stage}
        tier={() => baseTier}
        models={() => []}
        customProviders={() => []}
        activeProviders={() => []}
        connectedProviders={() => []}
        tiersLoading={false}
        changingTier={() => null}
        resettingTier={() => null}
        resettingAll={() => false}
        addingFallback={() => null}
        agentName={() => "test-agent"}
        onDropdownOpen={vi.fn()}
        onOverride={vi.fn()}
        onReset={vi.fn()}
        onFallbackUpdate={vi.fn()}
        onAddFallback={vi.fn()}
        getFallbacksFor={() => ["claude-opus-4-6"]}
      />
    ));

    expect(fallbackListProps.length).toBe(1);
    expect(fallbackListProps[0].fallbackRoutes).toBeNull();
  });
});
