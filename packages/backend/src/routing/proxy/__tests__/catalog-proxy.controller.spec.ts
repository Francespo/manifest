import { CatalogProxyController } from '../catalog-proxy.controller';
import { CatalogMediaController } from '../../media/catalog-media.controller';

/** Guards the client-facing URL shape: the variant must come before `/v1`. */
describe('scoped catalog controllers', () => {
  it('mounts every proxy route under /catalog/:variant/v1', () => {
    const prefix = Reflect.getMetadata('path', CatalogProxyController) as string;
    expect(prefix).toBe('catalog/:variant/v1');

    const methods = ['models', 'model', 'chatCompletions', 'responses', 'messages'];
    const paths = methods.map((name) => {
      const handler = (
        CatalogProxyController.prototype as unknown as Record<string, () => unknown>
      )[name];
      return Reflect.getMetadata('path', handler) as string;
    });
    expect(paths).toEqual(['models', 'models/*splat', 'chat/completions', 'responses', 'messages']);
  });

  it('mounts media routes under the same prefix', () => {
    expect(Reflect.getMetadata('path', CatalogMediaController)).toBe('catalog/:variant/v1');
    const handler = CatalogMediaController.prototype.images as () => unknown;
    expect(Reflect.getMetadata('path', handler)).toBe('images/generations');
  });
});
