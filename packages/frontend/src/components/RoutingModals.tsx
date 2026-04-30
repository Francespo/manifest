import { Show, type Accessor, type Component } from 'solid-js';
import ModelPickerModal from './ModelPickerModal.js';
import ProviderSelectModal from './ProviderSelectModal.js';
import RoutingInstructionModal from './RoutingInstructionModal.js';
import type {
  TierAssignment,
  AuthType,
  CustomProviderData,
  AvailableModel,
  RoutingProvider,
  SpecificityAssignment,
} from '../services/api.js';
import type { CustomProviderPrefill, ProviderDeepLink } from '../services/routing-params.js';

interface RoutingModalsProps {
  agentName: () => string;
  dropdownTier: Accessor<string | null>;
  onDropdownClose: () => void;
  specificityDropdown?: Accessor<string | null>;
  onSpecificityDropdownClose?: () => void;
  onSpecificityOverride?: (
    category: string,
    model: string,
    provider: string,
    authType?: AuthType,
  ) => void;
  fallbackPickerTier: Accessor<string | null>;
  onFallbackPickerClose: () => void;
  showProviderModal: Accessor<boolean>;
  onProviderModalClose: () => void;
  customProviderPrefill?: CustomProviderPrefill | null;
  providerDeepLink?: ProviderDeepLink | null;
  instructionModal: Accessor<'enable' | 'disable' | null>;
  instructionProvider: Accessor<string | null>;
  onInstructionClose: () => void;
  models: () => AvailableModel[];
  tiers: () => TierAssignment[];
  specificityAssignments?: () => SpecificityAssignment[];
  customProviders: () => CustomProviderData[];
  connectedProviders: () => RoutingProvider[];
  getTier: (tierId: string) => TierAssignment | undefined;
  onOverride: (tierId: string, modelName: string, providerId: string, authType?: AuthType) => void;
  onAddFallback: (
    tierId: string,
    modelName: string,
    providerId: string,
    authType?: AuthType,
  ) => void;
  onProviderUpdate: () => Promise<void>;
  onOpenProviderModal: () => void;
}

const RoutingModals: Component<RoutingModalsProps> = (props) => (
  <>
    <Show when={props.dropdownTier()}>
      {(tierId) => (
        <ModelPickerModal
          tierId={tierId()}
          models={props.models()}
          tiers={props.tiers()}
          customProviders={props.customProviders()}
          connectedProviders={props.connectedProviders()}
          onSelect={props.onOverride}
          onClose={props.onDropdownClose}
          onConnectProviders={() => {
            props.onDropdownClose();
            props.onOpenProviderModal();
          }}
        />
      )}
    </Show>

    <Show when={props.specificityDropdown?.()}>
      {(category) => {
        const specificityTiers = (): TierAssignment[] =>
          (props.specificityAssignments?.() ?? [])
            .filter((a) => a.is_active)
            .map((a) => ({ ...a, tier: a.category }));
        return (
          <ModelPickerModal
            tierId={category()}
            models={props.models()}
            tiers={specificityTiers()}
            customProviders={props.customProviders()}
            connectedProviders={props.connectedProviders()}
            onSelect={(_, model, provider, authType) =>
              props.onSpecificityOverride?.(category(), model, provider, authType)
            }
            onClose={() => props.onSpecificityDropdownClose?.()}
            onConnectProviders={() => {
              props.onSpecificityDropdownClose?.();
              props.onOpenProviderModal();
            }}
          />
        );
      }}
    </Show>

    <Show when={props.fallbackPickerTier()}>
      {(tierId) => {
        const currentTier = () => props.getTier(tierId());
        const currentFallbackRoutes = () => currentTier()?.fallback_routes ?? [];
        const effectiveRoute = () => {
          const t = currentTier();
          return t ? (t.override_route ?? t.auto_assigned_route ?? null) : null;
        };
        // Filter out the model entry whose (model, provider, authType) matches
        // the current primary route, plus any entry already in the fallback
        // list. Identity is keyed on the full route tuple — same model name
        // on different auth types is intentionally NOT filtered (they're
        // distinct routing slots).
        const isPrimaryEntry = (m: {
          model_name: string;
          provider: string;
          auth_type?: AuthType;
        }) => {
          const route = effectiveRoute();
          if (!route || !m.auth_type) return false;
          return (
            m.model_name === route.model &&
            m.provider.toLowerCase() === route.provider.toLowerCase() &&
            m.auth_type === route.authType
          );
        };
        const isAlreadyFallback = (m: {
          model_name: string;
          provider: string;
          auth_type?: AuthType;
        }) => {
          const routes = currentFallbackRoutes();
          if (routes.length === 0 || !m.auth_type) return false;
          return routes.some(
            (r) =>
              r.model === m.model_name &&
              r.provider.toLowerCase() === m.provider.toLowerCase() &&
              r.authType === m.auth_type,
          );
        };
        const filteredModels = () =>
          props.models().filter((m) => !isPrimaryEntry(m) && !isAlreadyFallback(m));
        return (
          <ModelPickerModal
            tierId={tierId()}
            models={filteredModels()}
            tiers={props.tiers()}
            customProviders={props.customProviders()}
            connectedProviders={props.connectedProviders()}
            onSelect={props.onAddFallback}
            onClose={props.onFallbackPickerClose}
            onConnectProviders={() => {
              props.onFallbackPickerClose();
              props.onOpenProviderModal();
            }}
          />
        );
      }}
    </Show>

    <Show when={props.showProviderModal()}>
      <ProviderSelectModal
        agentName={props.agentName()}
        providers={props.connectedProviders()}
        customProviders={props.customProviders()}
        customProviderPrefill={props.customProviderPrefill}
        providerDeepLink={props.providerDeepLink}
        onClose={props.onProviderModalClose}
        onUpdate={props.onProviderUpdate}
      />
    </Show>

    <RoutingInstructionModal
      open={props.instructionModal() !== null}
      mode={props.instructionModal() ?? 'enable'}
      agentName={props.agentName()}
      connectedProvider={props.instructionProvider()}
      onClose={props.onInstructionClose}
    />
  </>
);

export default RoutingModals;
