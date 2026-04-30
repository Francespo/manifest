import { describe, it, expect, vi } from "vitest";
import { render, fireEvent, screen } from "@solidjs/testing-library";

vi.mock("../../src/components/ProviderIcon.js", () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

vi.mock("../../src/services/routing-utils.js", () => ({
  pricePerM: (v: number) => `$${(v * 1_000_000).toFixed(2)}`,
  resolveProviderId: (provider: string) => {
    const map: Record<string, string> = {
      OpenAI: "openai",
      openai: "openai",
      Anthropic: "anthropic",
      anthropic: "anthropic",
    };
    return map[provider] ?? null;
  },
  inferProviderFromModel: (modelName: string) => {
    const slash = modelName.indexOf("/");
    if (slash !== -1) return modelName.substring(0, slash).toLowerCase();
    return null;
  },
}));

import ModelPickerModal from "../../src/components/ModelPickerModal";

/**
 * The picker decorates each row with two route-aware tags:
 *   - "(recommended)" — when the row matches `auto_assigned_route`.
 *   - role tag ("Primary" / "Fallback N") — when the row matches
 *     `override_route` or sits inside `fallback_routes`.
 *
 * Both checks key on the full (model, provider, auth_type) tuple. The picker
 * passes its current `activeTab` as the auth_type to those checks, so a row
 * for `gpt-4o` under the API Keys tab is checked against tuple
 * `(gpt-4o, openai, api_key)`. Tests below pin the route-aware vs.
 * legacy-name-only behaviors.
 */

const baseModels = [
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
];

// Two providers of different auth types → tab strip renders, models filter
// per tab. This isolates the routing tag logic to the active tab's auth type.
const dualAuthProviders = [
  {
    id: "p1",
    provider: "openai",
    auth_type: "api_key",
    is_active: true,
    has_api_key: true,
    connected_at: "2025-01-01",
  },
  {
    id: "p2",
    provider: "openai",
    auth_type: "subscription",
    is_active: true,
    has_api_key: false,
    connected_at: "2025-01-01",
  },
];

const onSelect = vi.fn();
const onClose = vi.fn();

describe("ModelPickerModal route-aware role/recommended tagging", () => {
  it("(recommended) tag appears only when the active tab matches auto_assigned_route", () => {
    const tiers = [
      {
        id: "1",
        agent_id: "a1",
        tier: "simple",
        override_model: null,
        override_provider: null,
        auto_assigned_model: "gpt-4o",
        auto_assigned_route: {
          provider: "openai",
          authType: "subscription",
          model: "gpt-4o",
        },
        updated_at: "2026-04-21",
      },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels as never}
        tiers={tiers as never}
        connectedProviders={dualAuthProviders as never}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    // Default tab is subscription (it has priority), and the route's authType
    // matches → the visible subscription row gets the recommended badge.
    expect(container.querySelectorAll(".routing-modal__recommended").length).toBe(1);

    // Switch to API Keys: the visible row is api_key → no match → no badge.
    fireEvent.click(screen.getByText("API Keys"));
    expect(container.querySelectorAll(".routing-modal__recommended").length).toBe(0);
  });

  it("Primary role tag appears only when the active tab matches override_route", () => {
    const tiers = [
      {
        id: "1",
        agent_id: "a1",
        tier: "simple",
        override_model: "gpt-4o",
        override_provider: "openai",
        override_auth_type: "api_key",
        override_route: {
          provider: "openai",
          authType: "api_key",
          model: "gpt-4o",
        },
        auto_assigned_model: null,
        updated_at: "2026-04-21",
      },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels as never}
        tiers={tiers as never}
        connectedProviders={dualAuthProviders as never}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    // Default tab is subscription (priority) → visible row is subscription
    // gpt-4o, but the override_route authType is api_key → no Primary tag.
    expect(container.querySelectorAll(".routing-modal__role-tag").length).toBe(0);

    // Click API Keys → visible row matches the route → Primary tag appears.
    fireEvent.click(screen.getByText("API Keys"));
    const roleTags = container.querySelectorAll(".routing-modal__role-tag");
    expect(roleTags.length).toBe(1);
    expect(roleTags[0].textContent).toBe("Primary");
  });

  it("Fallback N tag appears only on the route-matching variant", () => {
    const tiers = [
      {
        id: "1",
        agent_id: "a1",
        tier: "simple",
        override_model: null,
        override_provider: null,
        auto_assigned_model: null,
        fallback_models: ["gpt-4o"],
        fallback_routes: [
          { provider: "openai", authType: "subscription", model: "gpt-4o" },
        ],
        updated_at: "2026-04-21",
      },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels as never}
        tiers={tiers as never}
        connectedProviders={dualAuthProviders as never}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    // Default tab is subscription → matches the fallback route → tag shown.
    let roleTags = container.querySelectorAll(".routing-modal__role-tag");
    expect(roleTags.length).toBe(1);
    expect(roleTags[0].textContent).toBe("Fallback 1");

    // Switching to API Keys hides the tag (different auth_type, no match).
    fireEvent.click(screen.getByText("API Keys"));
    roleTags = container.querySelectorAll(".routing-modal__role-tag");
    expect(roleTags.length).toBe(0);
  });

  it("legacy auto_assigned_model (no route) recommends rows on every tab by name", () => {
    const tiers = [
      {
        id: "1",
        agent_id: "a1",
        tier: "simple",
        override_model: null,
        override_provider: null,
        auto_assigned_model: "gpt-4o",
        auto_assigned_route: null,
        updated_at: "2026-04-21",
      },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels as never}
        tiers={tiers as never}
        connectedProviders={dualAuthProviders as never}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    // Subscription tab: gpt-4o matches by name → recommended.
    expect(container.querySelectorAll(".routing-modal__recommended").length).toBe(1);
    fireEvent.click(screen.getByText("API Keys"));
    // API Keys tab: same gpt-4o name → recommended again. Pre-route fallback.
    expect(container.querySelectorAll(".routing-modal__recommended").length).toBe(1);
  });

  it("legacy override_model (no route) tags Primary on every tab by name", () => {
    const tiers = [
      {
        id: "1",
        agent_id: "a1",
        tier: "simple",
        override_model: "gpt-4o",
        override_provider: "openai",
        override_route: null,
        auto_assigned_model: null,
        updated_at: "2026-04-21",
      },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels as never}
        tiers={tiers as never}
        connectedProviders={dualAuthProviders as never}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));

    // Subscription tab.
    let roleTags = container.querySelectorAll(".routing-modal__role-tag");
    expect(roleTags.length).toBe(1);
    expect(roleTags[0].textContent).toBe("Primary");

    // API Keys tab — same Primary tag (legacy name-only path).
    fireEvent.click(screen.getByText("API Keys"));
    roleTags = container.querySelectorAll(".routing-modal__role-tag");
    expect(roleTags.length).toBe(1);
    expect(roleTags[0].textContent).toBe("Primary");
  });
});
