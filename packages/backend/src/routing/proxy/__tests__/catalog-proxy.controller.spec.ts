import { MediaController } from '../../media/media.controller';
import { ProxyController } from '../proxy.controller';

/** Guards the client-facing URL shape: the variant must come before `/v1`. */
describe('scoped catalog routes', () => {
  it('mounts every proxy route under both /v1 and /catalog/:variant/v1', () => {
    const prefixes = Reflect.getMetadata('path', ProxyController) as string[];
    expect(prefixes).toEqual(['v1', 'catalog/:variant/v1']);

    const methods = ['models', 'model', 'chatCompletions', 'responses', 'messages'];
    const paths = methods.map((name) => {
      const handler = (ProxyController.prototype as unknown as Record<string, () => unknown>)[name];
      return Reflect.getMetadata('path', handler) as string;
    });
    expect(paths).toEqual(['models', 'models/*splat', 'chat/completions', 'responses', 'messages']);
  });

  it('mounts media routes under the same two prefixes', () => {
    expect(Reflect.getMetadata('path', MediaController)).toEqual(['v1', 'catalog/:variant/v1']);
    const handler = MediaController.prototype.images as () => unknown;
    expect(Reflect.getMetadata('path', handler)).toBe('images/generations');
  });
});
