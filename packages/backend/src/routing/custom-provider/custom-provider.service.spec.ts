jest.mock('../../common/utils/url-validation', () => ({
  validatePublicUrl: jest.fn(),
}));

import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { CustomProviderService } from './custom-provider.service';
import { CustomProvider } from '../../entities/custom-provider.entity';
import { ProviderService } from '../routing-core/provider.service';
import { RoutingCacheService } from '../routing-core/routing-cache.service';
import { TierAutoAssignService } from '../routing-core/tier-auto-assign.service';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { validatePublicUrl } = require('../../common/utils/url-validation');

function makeDeps(overrides: {
  findOneResults?: (CustomProvider | null)[];
  findResult?: CustomProvider[];
  cached?: CustomProvider[] | null;
}) {
  const findOne = jest.fn();
  const find = jest.fn().mockResolvedValue(overrides.findResult ?? []);
  const insert = jest.fn().mockResolvedValue(undefined);
  const save = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockResolvedValue(undefined);

  const results = overrides.findOneResults ?? [];
  findOne.mockImplementation(() => Promise.resolve(results.shift() ?? null));

  const repo = { findOne, find, insert, save, remove } as unknown as Repository<CustomProvider>;

  const upsertProvider = jest.fn().mockResolvedValue({ provider: {} });
  const removeProvider = jest.fn().mockResolvedValue(undefined);
  const providerService = { upsertProvider, removeProvider } as unknown as ProviderService;

  const getCustomProviders = jest.fn().mockReturnValue(overrides.cached ?? null);
  const setCustomProviders = jest.fn();
  const invalidateAgent = jest.fn();
  const routingCache = {
    getCustomProviders,
    setCustomProviders,
    invalidateAgent,
  } as unknown as RoutingCacheService;

  const recalculate = jest.fn().mockResolvedValue(undefined);
  const autoAssign = { recalculate } as unknown as TierAutoAssignService;

  const svc = new CustomProviderService(repo, providerService, routingCache, autoAssign);

  return {
    svc,
    findOne,
    find,
    insert,
    save,
    remove,
    upsertProvider,
    removeProvider,
    getCustomProviders,
    setCustomProviders,
    invalidateAgent,
    recalculate,
  };
}

describe('CustomProviderService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (validatePublicUrl as jest.Mock).mockReset();
    (validatePublicUrl as jest.Mock).mockResolvedValue(undefined);
  });

  describe('static helpers', () => {
    it('composes and parses provider keys and model keys', () => {
      expect(CustomProviderService.providerKey('abc')).toBe('custom:abc');
      expect(CustomProviderService.modelKey('abc', 'model')).toBe('custom:abc/model');
      // rawModelName strips through the first "/" so the proxy sends just the upstream name.
      expect(CustomProviderService.rawModelName('custom:abc/model')).toBe('model');
      expect(CustomProviderService.rawModelName('plain-model')).toBe('plain-model');
    });

    it('detects custom provider keys and extracts their id', () => {
      expect(CustomProviderService.isCustom('custom:abc')).toBe(true);
      expect(CustomProviderService.isCustom('anthropic')).toBe(false);
      expect(CustomProviderService.extractId('custom:abc')).toBe('abc');
    });
  });

  describe('list', () => {
    it('returns the cached result when present', async () => {
      const cached = [{ id: 'cp1' } as CustomProvider];
      const { svc, find, setCustomProviders } = makeDeps({ cached });
      const result = await svc.list('agent-1');
      expect(result).toBe(cached);
      expect(find).not.toHaveBeenCalled();
      expect(setCustomProviders).not.toHaveBeenCalled();
    });

    it('falls back to the DB and populates the cache on a miss', async () => {
      const rows = [{ id: 'cp1' } as CustomProvider];
      const { svc, find, setCustomProviders } = makeDeps({
        cached: null,
        findResult: rows,
      });
      const result = await svc.list('agent-1');
      expect(result).toBe(rows);
      expect(find).toHaveBeenCalledWith({ where: { agent_id: 'agent-1' } });
      expect(setCustomProviders).toHaveBeenCalledWith('agent-1', rows);
    });
  });

  describe('create', () => {
    const dto = {
      name: 'my-openai',
      base_url: 'https://openai.example.com',
      apiKey: 'sk-x',
      models: [
        {
          model_name: 'gpt-custom',
          input_price_per_million_tokens: 1,
          output_price_per_million_tokens: 2,
          // context_window omitted → default 128_000
        },
      ],
    };

    it('throws Conflict when an agent already has a provider with the same name', async () => {
      const { svc } = makeDeps({ findOneResults: [{ id: 'existing' } as CustomProvider] });
      await expect(svc.create('agent-1', 'user-1', dto)).rejects.toBeInstanceOf(ConflictException);
    });

    it('throws BadRequest when the base URL fails validation', async () => {
      (validatePublicUrl as jest.Mock).mockRejectedValue(new Error('not public'));
      const { svc } = makeDeps({ findOneResults: [null] });
      await expect(svc.create('agent-1', 'user-1', dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('inserts the row, upserts a UserProvider, and defaults context_window to 128k', async () => {
      const { svc, insert, upsertProvider } = makeDeps({ findOneResults: [null] });
      const cp = await svc.create('agent-1', 'user-1', dto);

      expect(insert).toHaveBeenCalledTimes(1);
      expect(cp.agent_id).toBe('agent-1');
      expect(cp.name).toBe('my-openai');
      expect(cp.models[0].context_window).toBe(128_000);
      expect(upsertProvider).toHaveBeenCalledWith('agent-1', 'user-1', `custom:${cp.id}`, 'sk-x');
    });
  });

  describe('update', () => {
    it('throws NotFound when the provider does not exist for the agent', async () => {
      const { svc } = makeDeps({ findOneResults: [null] });
      await expect(
        svc.update('agent-1', 'missing', 'user-1', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws Conflict when renaming collides with an existing provider', async () => {
      const existing = { id: 'cp1', agent_id: 'agent-1', name: 'old' } as CustomProvider;
      const { svc } = makeDeps({
        findOneResults: [existing, { id: 'other', name: 'new' } as CustomProvider],
      });
      await expect(svc.update('agent-1', 'cp1', 'user-1', { name: 'new' })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('renames and persists when no collision', async () => {
      const existing = { id: 'cp1', agent_id: 'agent-1', name: 'old' } as CustomProvider;
      const { svc, save, invalidateAgent } = makeDeps({
        findOneResults: [existing, null],
      });
      await svc.update('agent-1', 'cp1', 'user-1', { name: 'new' });
      expect(existing.name).toBe('new');
      expect(save).toHaveBeenCalledWith(existing);
      expect(invalidateAgent).toHaveBeenCalledWith('agent-1');
    });

    it('validates and updates base_url when provided', async () => {
      const existing = {
        id: 'cp1',
        agent_id: 'agent-1',
        name: 'n',
        base_url: 'a',
      } as CustomProvider;
      const { svc } = makeDeps({ findOneResults: [existing] });
      await svc.update('agent-1', 'cp1', 'user-1', { base_url: 'https://b.example' });
      expect(validatePublicUrl).toHaveBeenCalledWith('https://b.example');
      expect(existing.base_url).toBe('https://b.example');
    });

    it('throws BadRequest when the new base_url fails validation', async () => {
      const existing = { id: 'cp1', agent_id: 'agent-1', name: 'n' } as CustomProvider;
      const { svc } = makeDeps({ findOneResults: [existing] });
      (validatePublicUrl as jest.Mock).mockRejectedValue(new Error('bad url'));
      await expect(
        svc.update('agent-1', 'cp1', 'user-1', { base_url: 'http://bad' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rewrites models (defaulting context_window) and recalculates tiers when the api key is not touched', async () => {
      const existing = { id: 'cp1', agent_id: 'agent-1', name: 'n' } as CustomProvider;
      const { svc, recalculate, upsertProvider } = makeDeps({ findOneResults: [existing] });
      await svc.update('agent-1', 'cp1', 'user-1', {
        models: [
          {
            model_name: 'm1',
            input_price_per_million_tokens: 1,
            output_price_per_million_tokens: 1,
          },
        ],
      });
      expect(existing.models[0].context_window).toBe(128_000);
      expect(recalculate).toHaveBeenCalledWith('agent-1');
      expect(upsertProvider).not.toHaveBeenCalled();
    });

    it('delegates tier recalculation to provider upsert when the api key is also updated', async () => {
      const existing = { id: 'cp1', agent_id: 'agent-1', name: 'n' } as CustomProvider;
      const { svc, recalculate, upsertProvider } = makeDeps({ findOneResults: [existing] });
      await svc.update('agent-1', 'cp1', 'user-1', {
        apiKey: 'sk-new',
        models: [
          {
            model_name: 'm1',
            input_price_per_million_tokens: 1,
            output_price_per_million_tokens: 1,
            context_window: 64_000,
          },
        ],
      });
      expect(upsertProvider).toHaveBeenCalledWith('agent-1', 'user-1', 'custom:cp1', 'sk-new');
      // When api key is updated, the upsert triggers its own recalc — service should not double-call.
      expect(recalculate).not.toHaveBeenCalled();
      expect(existing.models[0].context_window).toBe(64_000);
    });
  });

  describe('remove', () => {
    it('throws NotFound when the provider is missing', async () => {
      const { svc } = makeDeps({ findOneResults: [null] });
      await expect(svc.remove('agent-1', 'cp1')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('deletes the row and attempts provider removal', async () => {
      const cp = { id: 'cp1', agent_id: 'agent-1' } as CustomProvider;
      const { svc, removeProvider, remove } = makeDeps({ findOneResults: [cp] });
      await svc.remove('agent-1', 'cp1');
      expect(removeProvider).toHaveBeenCalledWith('agent-1', 'custom:cp1');
      expect(remove).toHaveBeenCalledWith(cp);
    });

    it('swallows errors from provider removal (partial-state cleanup)', async () => {
      const cp = { id: 'cp1', agent_id: 'agent-1' } as CustomProvider;
      const { svc, removeProvider, remove } = makeDeps({ findOneResults: [cp] });
      removeProvider.mockRejectedValue(new Error('not linked'));
      await expect(svc.remove('agent-1', 'cp1')).resolves.toBeUndefined();
      expect(remove).toHaveBeenCalledWith(cp);
    });
  });

  describe('getById', () => {
    it('returns the provider directly from the repository', async () => {
      const cp = { id: 'cp1' } as CustomProvider;
      const { svc, findOne } = makeDeps({ findOneResults: [cp] });
      await expect(svc.getById('cp1')).resolves.toBe(cp);
      expect(findOne).toHaveBeenCalledWith({ where: { id: 'cp1' } });
    });
  });
});
