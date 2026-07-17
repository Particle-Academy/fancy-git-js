import type { GitProvider, GitRemote, ProviderKind, ProviderRepositoryRef } from "./types.js";

export class ProviderRegistry {
  private readonly providers = new Map<ProviderKind, GitProvider>();

  register(provider: GitProvider): this {
    this.providers.set(provider.kind, provider);
    return this;
  }

  get(kind: ProviderKind): GitProvider | undefined {
    return this.providers.get(kind);
  }

  identify(remote: GitRemote): { provider: GitProvider; ref: ProviderRepositoryRef } | null {
    for (const provider of this.providers.values()) {
      const ref = provider.identify(remote);
      if (ref) return { provider, ref };
    }
    return null;
  }
}
