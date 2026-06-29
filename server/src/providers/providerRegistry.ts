import type { HookProvider } from '../../../core/src/provider.js';

export class ProviderRegistry {
  private readonly providers = new Map<string, HookProvider>();

  constructor(providers: Iterable<HookProvider>, readonly primaryProviderId = 'claude') {
    for (const provider of providers) {
      if (this.providers.has(provider.id)) {
        throw new Error(`Duplicate provider id: ${provider.id}`);
      }
      this.providers.set(provider.id, provider);
    }
    if (!this.providers.has(primaryProviderId)) {
      throw new Error(`Primary provider is not registered: ${primaryProviderId}`);
    }
  }

  get(id: string): HookProvider | undefined {
    return this.providers.get(id);
  }

  get primary(): HookProvider {
    return this.providers.get(this.primaryProviderId)!;
  }

  values(): IterableIterator<HookProvider> {
    return this.providers.values();
  }

  get readingTools(): ReadonlySet<string> {
    return new Set([...this.providers.values()].flatMap((provider) => [...provider.readingTools]));
  }

  get subagentToolNames(): ReadonlySet<string> {
    return new Set(
      [...this.providers.values()].flatMap((provider) => [...provider.subagentToolNames]),
    );
  }
}
