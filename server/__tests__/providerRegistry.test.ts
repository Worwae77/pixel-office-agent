import { describe, expect, it } from 'vitest';

import { createCompatibleHookProvider } from '../src/providers/hook/compatible.js';
import { ProviderRegistry } from '../src/providers/providerRegistry.js';

describe('ProviderRegistry', () => {
  const alpha = createCompatibleHookProvider({ id: 'alpha', displayName: 'Alpha' });
  const beta = createCompatibleHookProvider({ id: 'beta', displayName: 'Beta' });

  it('routes providers and merges UI tool capabilities', () => {
    const registry = new ProviderRegistry([alpha, beta], 'alpha');
    expect(registry.primary).toBe(alpha);
    expect(registry.get('beta')).toBe(beta);
    expect(registry.readingTools.has('Read')).toBe(true);
    expect(registry.subagentToolNames.has('subagent')).toBe(true);
  });

  it('rejects duplicate and missing primary providers', () => {
    expect(() => new ProviderRegistry([alpha, alpha], 'alpha')).toThrow('Duplicate provider id');
    expect(() => new ProviderRegistry([alpha], 'missing')).toThrow(
      'Primary provider is not registered',
    );
  });
});
