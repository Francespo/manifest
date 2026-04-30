import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@solidjs/testing-library";

vi.mock("../../src/components/ProviderIcon.js", () => ({
  providerIcon: () => null,
  customProviderLogo: () => null,
}));

vi.mock("../../src/services/providers.js", () => ({
  PROVIDERS: [
    {
      id: "openai",
      name: "OpenAI",
      models: [
        { value: "gpt-4o", label: "GPT-4o" },
        { value: "gpt-4o-mini", label: "GPT-4o mini" },
      ],
    },
    {
      id: "anthropic",
      name: "Anthropic",
      models: [{ value: "claude-opus", label: "Claude Opus" }],
    },
  ],
  STAGES: [
    { id: "simple", label: "Simple" },
    { id: "complex", label: "Complex" },
  ],
  SPECIFICITY_STAGES: [{ id: "coding", label: "Coding" }],
}));

vi.mock("../../src/services/routing-utils.js", () => ({
  resolveProviderId: (p: string) => p.toLowerCase(),
  inferProviderFromModel: (m: string) => {
    if (m.startsWith("gpt")) return "openai";
    if (m.startsWith("claude")) return "anthropic";
    return undefined;
  },
  pricePerM: (n: number) => `$${(Number(n) * 1_000_000).toFixed(2)}`,
}));

vi.mock("../../src/services/formatters.js", () => ({
  customProviderColor: () => "#000",
}));

import ModelPickerModal from "../../src/components/ModelPickerModal";
import type {
  AvailableModel,
  CustomProviderData,
  RoutingProvider,
  TierAssignment,
} from "../../src/services/api";

const baseModels: AvailableModel[] = [
  {
    model_name: "gpt-4o",
    provider: "OpenAI",
    auth_type: "api_key",
    input_price_per_token: 0.000005,
    output_price_per_token: 0.000015,
    context_window: 128000,
    capability_reasoning: false,
    capability_code: true,
    quality_score: 8,
    display_name: "GPT-4o",
  },
  {
    model_name: "gpt-4o-mini",
    provider: "OpenAI",
    auth_type: "api_key",
    input_price_per_token: 0,
    output_price_per_token: 0,
    context_window: 128000,
    capability_reasoning: false,
    capability_code: true,
    quality_score: 6,
    display_name: "GPT-4o mini",
  },
  {
    model_name: "claude-opus",
    provider: "Anthropic",
    auth_type: "subscription",
    input_price_per_token: 0.000015,
    output_price_per_token: 0.000075,
    context_window: 200000,
    capability_reasoning: false,
    capability_code: true,
    quality_score: 9,
    display_name: "Claude Opus",
  },
];

const apiKeyOnly: RoutingProvider[] = [
  {
    id: "p1",
    provider: "openai",
    auth_type: "api_key",
    is_active: true,
    has_api_key: true,
    connected_at: "2025-01-01",
  },
];

const subAndApi: RoutingProvider[] = [
  ...apiKeyOnly,
  {
    id: "p2",
    provider: "anthropic",
    auth_type: "subscription",
    is_active: true,
    has_api_key: false,
    connected_at: "2025-01-01",
  },
];

const tiers: TierAssignment[] = [
  {
    id: "t1",
    agent_id: "a1",
    tier: "simple",
    override_route: null,
    auto_assigned_route: { provider: "openai", authType: "api_key", model: "gpt-4o" },
    fallback_routes: [
      { provider: "openai", authType: "api_key", model: "gpt-4o-mini" },
    ],
    updated_at: "2025-01-01",
  },
];

describe("ModelPickerModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the tier label as subtitle when the tier matches a STAGES entry", () => {
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    expect(container.querySelector(".routing-modal__subtitle")?.textContent).toContain("Simple");
  });

  it("renders the SPECIFICITY_STAGES label when the tier matches a specificity stage", () => {
    const { container } = render(() => (
      <ModelPickerModal
        tierId="coding"
        models={baseModels}
        tiers={[]}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    expect(container.querySelector(".routing-modal__subtitle")?.textContent).toContain("Coding");
  });

  it("hides tabs when only one auth category is connected", () => {
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    expect(container.querySelector(".panel__tabs")).toBeNull();
  });

  it("shows tabs when multiple auth categories are connected", () => {
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={subAndApi}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    expect(container.querySelector(".panel__tabs")).not.toBeNull();
    expect(container.textContent).toContain("Subscription");
    expect(container.textContent).toContain("API Keys");
  });

  it("defaults to the subscription tab when subscription is connected", () => {
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={subAndApi}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const subTab = container.querySelector('[role="tab"][aria-selected="true"]');
    expect(subTab?.textContent).toContain("Subscription");
  });

  it("switches to api_key tab when clicked", () => {
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={subAndApi}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const apiTab = Array.from(container.querySelectorAll('[role="tab"]')).find((t) =>
      t.textContent?.includes("API Keys"),
    ) as HTMLButtonElement;
    fireEvent.click(apiTab);
    expect(apiTab.getAttribute("aria-selected")).toBe("true");
  });

  it("toggles the Free models filter on api_key tab", () => {
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const pill = container.querySelector(".routing-modal__filter-pill") as HTMLButtonElement;
    expect(pill).not.toBeNull();
    fireEvent.click(pill);
    expect(pill.classList.contains("routing-modal__filter-pill--active")).toBe(true);
    // Only gpt-4o-mini is free → only one model rendered
    const modelButtons = container.querySelectorAll(".routing-modal__model");
    expect(modelButtons.length).toBe(1);
    expect(modelButtons[0].textContent).toContain("GPT-4o mini");
  });

  it("renders the recommendation tag for the auto-assigned route", () => {
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const recommended = container.querySelector(".routing-modal__recommended");
    expect(recommended?.textContent).toContain("recommended");
  });

  it("tags the primary model with 'Primary' when override_route matches", () => {
    const tiersWithOverride: TierAssignment[] = [
      {
        ...tiers[0],
        override_route: { provider: "openai", authType: "api_key", model: "gpt-4o" },
      },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiersWithOverride}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const tags = Array.from(container.querySelectorAll(".routing-modal__role-tag")).map(
      (t) => t.textContent,
    );
    expect(tags).toContain("Primary");
  });

  it("tags fallback rows with their 1-based index", () => {
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const tags = Array.from(container.querySelectorAll(".routing-modal__role-tag")).map(
      (t) => t.textContent,
    );
    expect(tags).toContain("Fallback 1");
  });

  it("does NOT cross-tag primary with fallback when route tuples differ on authType", () => {
    // Same model name on a different auth type must NOT be flagged as Primary
    // when filtered to the api_key tab if the override is on subscription.
    const tiersSubOverride: TierAssignment[] = [
      {
        ...tiers[0],
        override_route: { provider: "openai", authType: "subscription", model: "gpt-4o" },
        auto_assigned_route: null,
        fallback_routes: null,
      },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiersSubOverride}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const tags = Array.from(container.querySelectorAll(".routing-modal__role-tag")).map(
      (t) => t.textContent,
    );
    expect(tags).not.toContain("Primary");
  });

  it("invokes onSelect with (tierId, model, providerId, authType) on click", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    ));
    const firstModel = container.querySelector(".routing-modal__model") as HTMLButtonElement;
    fireEvent.click(firstModel);
    expect(onSelect).toHaveBeenCalledWith(
      "simple",
      expect.any(String),
      expect.any(String),
      "api_key",
    );
  });

  it("shows the search input only when more than 5 models are available", () => {
    const onlyOne: AvailableModel[] = [baseModels[0]];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={onlyOne}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    expect(container.querySelector(".routing-modal__search")).toBeNull();
  });

  it("filters by search term against model labels", () => {
    const many: AvailableModel[] = [
      ...baseModels,
      { ...baseModels[0], model_name: "gpt-extra-1", display_name: "extra-1" },
      { ...baseModels[0], model_name: "gpt-extra-2", display_name: "extra-2" },
      { ...baseModels[0], model_name: "gpt-extra-3", display_name: "extra-3" },
      { ...baseModels[0], model_name: "gpt-extra-4", display_name: "extra-4" },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={many}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const search = container.querySelector(".routing-modal__search") as HTMLInputElement;
    expect(search).not.toBeNull();
    fireEvent.input(search, { target: { value: "extra-1" } });
    const labels = Array.from(container.querySelectorAll(".routing-modal__model-label")).map(
      (e) => e.textContent,
    );
    expect(labels.some((l) => l?.includes("extra-1"))).toBe(true);
    expect(labels.some((l) => l?.includes("extra-2"))).toBe(false);
  });

  it("renders the empty state with a Connect providers button when handler is provided and nothing is connected", () => {
    const onConnect = vi.fn();
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={[]}
        tiers={tiers}
        connectedProviders={[]}
        onSelect={vi.fn()}
        onClose={vi.fn()}
        onConnectProviders={onConnect}
      />
    ));
    const empty = container.querySelector(".routing-modal__empty");
    expect(empty?.textContent).toMatch(/No API key providers connected/);
    const btn = empty?.querySelector("button") as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onConnect).toHaveBeenCalled();
  });

  it("calls onClose on overlay click and Escape key", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    ));
    fireEvent.click(container.querySelector(".modal-overlay") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(container.querySelector(".modal-overlay") as HTMLElement, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("calls onClose on the explicit close button", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={baseModels}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    ));
    fireEvent.click(container.querySelector(".modal__close") as HTMLButtonElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders Included in subscription / Runs on your machine in non-paid tabs", () => {
    const localOnly: RoutingProvider[] = [
      {
        id: "p3",
        provider: "ollama",
        auth_type: "local",
        is_active: true,
        has_api_key: false,
        connected_at: "2025-01-01",
      },
    ];
    const localModels: AvailableModel[] = [
      {
        ...baseModels[0],
        model_name: "llama3",
        provider: "ollama",
        auth_type: "local",
        display_name: "Llama 3",
      },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={localModels}
        tiers={tiers}
        connectedProviders={localOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    expect(container.textContent).toContain("Runs on your machine");
  });

  it("filters the list by group name when search matches the group label", () => {
    const many: AvailableModel[] = [
      ...baseModels,
      { ...baseModels[0], model_name: "extra-1", display_name: "Extra 1" },
      { ...baseModels[0], model_name: "extra-2", display_name: "Extra 2" },
      { ...baseModels[0], model_name: "extra-3", display_name: "Extra 3" },
      { ...baseModels[0], model_name: "extra-4", display_name: "Extra 4" },
    ];
    const { container } = render(() => (
      <ModelPickerModal
        tierId="simple"
        models={many}
        tiers={tiers}
        connectedProviders={apiKeyOnly}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    ));
    const search = container.querySelector(".routing-modal__search") as HTMLInputElement;
    fireEvent.input(search, { target: { value: "openai" } });
    const groups = container.querySelectorAll(".routing-modal__group-name");
    expect(Array.from(groups).some((g) => g.textContent?.toLowerCase().includes("openai"))).toBe(true);
  });
});
