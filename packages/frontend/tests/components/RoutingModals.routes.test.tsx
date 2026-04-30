import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";

vi.mock("../../src/components/ProviderSelectModal.js", () => ({
  default: () => <div data-testid="provider-modal" />,
}));

vi.mock("../../src/services/api.js", () => ({
  getModelPrices: vi.fn().mockResolvedValue({ models: [], lastSyncedAt: null }),
  getAgentKey: vi.fn().mockResolvedValue({ keyPrefix: "mnfst_abc", apiKey: "mnfst_abc123" }),
  getHealth: vi.fn().mockResolvedValue({ mode: "cloud" }),
}));

import RoutingModals from "../../src/components/RoutingModals";
import type {
  TierAssignment,
  AvailableModel,
  CustomProviderData,
  RoutingProvider,
} from "../../src/services/api.js";

/**
 * The fallback picker filter for RoutingModals lives inline in the component
 * (no extracted helper) — these tests pin that the picker:
 *   1. Filters using the structured `fallback_routes` when present, so the
 *      same model under a different auth_type stays selectable (issue #1708).
 *   2. Falls back to plain model-name filtering for unmigrated tiers.
 *   3. Hides only the exact (provider, auth, model) tuple of the primary route
 *      — not every entry sharing the model name.
 */

const baseModels: AvailableModel[] = [
  {
    model_name: "gpt-4o",
    provider: "OpenAI",
    auth_type: "api_key",
    display_name: "GPT-4o (API Key)",
    input_price_per_token: 0.0000025,
    output_price_per_token: 0.00001,
    context_window: 128000,
    capability_reasoning: false,
    capability_code: true,
  },
  {
    model_name: "gpt-4o",
    provider: "OpenAI",
    auth_type: "subscription",
    display_name: "GPT-4o (Subscription)",
    input_price_per_token: 0,
    output_price_per_token: 0,
    context_window: 128000,
    capability_reasoning: false,
    capability_code: true,
  },
  {
    model_name: "claude-opus-4-6",
    provider: "Anthropic",
    auth_type: "api_key",
    display_name: "Claude Opus 4.6",
    input_price_per_token: 0.000015,
    output_price_per_token: 0.000075,
    context_window: 200000,
    capability_reasoning: true,
    capability_code: true,
  },
];

// Single-auth-type connection set keeps the picker tabless (no tab strip)
// and lets all models — regardless of their own auth_type — pass the
// per-tab filter. That isolates the test to the route-vs-name dedup logic.
const baseProviders: RoutingProvider[] = [
  {
    id: "p1",
    provider: "openai",
    auth_type: "api_key",
    is_active: true,
    has_api_key: true,
    connected_at: "2025-01-01",
  },
  {
    id: "p3",
    provider: "anthropic",
    auth_type: "api_key",
    is_active: true,
    has_api_key: true,
    connected_at: "2025-01-01",
  },
];

interface MountOpts {
  fallbackTier: string;
  tier: TierAssignment;
}

function mount(opts: MountOpts) {
  const [dropdownTier] = createSignal<string | null>(null);
  const [specificityDropdown] = createSignal<string | null>(null);
  const [fallbackPickerTier] = createSignal<string | null>(opts.fallbackTier);
  const [showProviderModal] = createSignal(false);
  const [instructionModal] = createSignal<"enable" | "disable" | null>(null);
  const [instructionProvider] = createSignal<string | null>(null);

  return render(() => (
    <RoutingModals
      agentName={() => "test-agent"}
      dropdownTier={dropdownTier}
      onDropdownClose={vi.fn()}
      specificityDropdown={specificityDropdown}
      onSpecificityDropdownClose={vi.fn()}
      onSpecificityOverride={vi.fn()}
      fallbackPickerTier={fallbackPickerTier}
      onFallbackPickerClose={vi.fn()}
      showProviderModal={showProviderModal}
      onProviderModalClose={vi.fn()}
      instructionModal={instructionModal}
      instructionProvider={instructionProvider}
      onInstructionClose={vi.fn()}
      models={() => baseModels}
      tiers={() => [opts.tier]}
      customProviders={() => [] as CustomProviderData[]}
      connectedProviders={() => baseProviders}
      getTier={(id) => (id === opts.tier.tier ? opts.tier : undefined)}
      onOverride={vi.fn()}
      onAddFallback={vi.fn()}
      onProviderUpdate={vi.fn().mockResolvedValue(undefined)}
      onOpenProviderModal={vi.fn()}
    />
  ));
}

function getModelLabels(container: HTMLElement): string[] {
  const buttons = container.querySelectorAll<HTMLButtonElement>(".routing-modal__model");
  // The label is the first element span; pull its raw text.
  return Array.from(buttons).map((btn) => {
    const label = btn.querySelector(".routing-modal__model-label");
    return label?.childNodes[0]?.textContent?.trim() ?? "";
  });
}

describe("RoutingModals fallback picker (route-aware)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not deduplicate by model name when fallback_routes carries the auth tuple", () => {
    // Fix for #1708: the existing fallback is the SUBSCRIPTION variant of
    // gpt-4o, so the api_key gpt-4o entry MUST still be offered. Legacy
    // model-name dedup would have hidden it.
    const tier: TierAssignment = {
      id: "1",
      agent_id: "a1",
      tier: "simple",
      override_model: null,
      override_provider: null,
      override_auth_type: null,
      auto_assigned_model: "claude-opus-4-6",
      auto_assigned_route: {
        provider: "Anthropic",
        authType: "api_key",
        model: "claude-opus-4-6",
      },
      fallback_models: ["gpt-4o"],
      fallback_routes: [
        { provider: "OpenAI", authType: "subscription", model: "gpt-4o" },
      ],
      updated_at: "2026-04-21",
    };

    const { container } = mount({ fallbackTier: "simple", tier });

    const labels = getModelLabels(container);
    // gpt-4o api_key entry is still selectable.
    expect(labels).toContain("GPT-4o (API Key)");
    // gpt-4o subscription entry is hidden (already a fallback).
    expect(labels).not.toContain("GPT-4o (Subscription)");
    // Auto-assigned primary (claude) is also hidden.
    expect(labels).not.toContain("Claude Opus 4.6");
  });

  it("falls back to legacy model-name dedup when fallback_routes are absent", () => {
    // Unmigrated tier: only fallback_models, no routes — both gpt-4o entries
    // should be filtered out (the legacy behavior). This pins the fallback
    // path so we don't accidentally regress for users whose data hasn't been
    // backfilled yet.
    const tier: TierAssignment = {
      id: "1",
      agent_id: "a1",
      tier: "simple",
      override_model: null,
      override_provider: null,
      override_auth_type: null,
      auto_assigned_model: "claude-opus-4-6",
      fallback_models: ["gpt-4o"],
      fallback_routes: null,
      updated_at: "2026-04-21",
    };

    const { container } = mount({ fallbackTier: "simple", tier });

    const labels = getModelLabels(container);
    expect(labels).not.toContain("GPT-4o (API Key)");
    expect(labels).not.toContain("GPT-4o (Subscription)");
    // Other models still selectable.
    expect(labels).not.toContain("Claude Opus 4.6"); // primary, hidden
  });

  it("hides only the exact primary tuple when override_route is set", () => {
    // Primary points at gpt-4o under subscription. The api_key variant must
    // remain selectable as a fallback (different auth_type).
    const tier: TierAssignment = {
      id: "1",
      agent_id: "a1",
      tier: "simple",
      override_model: "gpt-4o",
      override_provider: "OpenAI",
      override_auth_type: "subscription",
      override_route: {
        provider: "OpenAI",
        authType: "subscription",
        model: "gpt-4o",
      },
      auto_assigned_model: null,
      fallback_models: [],
      fallback_routes: [],
      updated_at: "2026-04-21",
    };

    const { container } = mount({ fallbackTier: "simple", tier });

    const labels = getModelLabels(container);
    expect(labels).toContain("GPT-4o (API Key)");
    expect(labels).not.toContain("GPT-4o (Subscription)");
    // Unrelated model is still there.
    expect(labels).toContain("Claude Opus 4.6");
  });

  it("hides any gpt-4o entry by name when only the legacy override_model is set (no route)", () => {
    // Regression-lock: pre-route tier with override_model='gpt-4o' should
    // continue hiding ALL gpt-4o variants because we can't disambiguate.
    const tier: TierAssignment = {
      id: "1",
      agent_id: "a1",
      tier: "simple",
      override_model: "gpt-4o",
      override_provider: "OpenAI",
      override_auth_type: null,
      override_route: null,
      auto_assigned_model: null,
      auto_assigned_route: null,
      fallback_models: [],
      fallback_routes: null,
      updated_at: "2026-04-21",
    };

    const { container } = mount({ fallbackTier: "simple", tier });

    const labels = getModelLabels(container);
    // Both gpt-4o entries hidden because legacy filter is name-only.
    expect(labels).not.toContain("GPT-4o (API Key)");
    expect(labels).not.toContain("GPT-4o (Subscription)");
    // Unrelated model still selectable.
    expect(labels).toContain("Claude Opus 4.6");
  });
});
