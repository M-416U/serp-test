interface Proxy {
  id: string;
  host: string;
  port: number;
  username: string;
  password: string;
  location?: string;
  isActive: boolean;
}

interface ProxyUsage {
  proxy: Proxy;
  lastUsed: number;
  usageCount: number;
  cooldownUntil: number;
  consecutiveDetections: number;
}

interface ProxyManagerOptions {
  requestsPerMinute: number;
  cooldownPeriod: number; // milliseconds
  rotationStrategy: "round-robin" | "least-used";
}

interface ProxyResult {
  proxy: Proxy | null;
  nextAvailableIn: number | null;
}
class ProxyManager {
  private proxies: Proxy[] = [];
  private proxyUsage: Map<string, ProxyUsage> = new Map();
  private currentIndex: number = 0;
  private options: ProxyManagerOptions;

  /**
   * Creates a new ProxyManager instance
   * @param options Configuration options for the proxy manager
   */
  constructor(options: Partial<ProxyManagerOptions> = {}) {
    this.options = {
      requestsPerMinute: 2,
      cooldownPeriod: 300000, // 3 min cooldown when detected
      rotationStrategy: "round-robin",
      ...options,
    };
  }

  /**
   * Add a single proxy to the manager
   * @param proxy Proxy configuration object
   * @returns The added proxy
   */
  public addProxy(proxy: Proxy): Proxy {
    this.proxies.push(proxy);
    this.proxyUsage.set(proxy.id, {
      proxy,
      lastUsed: 0,
      usageCount: 0,
      cooldownUntil: 0,
      consecutiveDetections: 0,
    });
    return proxy;
  }

  /**
   * Add multiple proxies to the manager
   * @param proxies Array of proxy configuration objects
   * @returns The current instance for chaining
   */
  public addProxies(proxies: Proxy[]): ProxyManager {
    proxies.forEach((proxy) => this.addProxy(proxy));
    return this;
  }

  /**
   * Remove a proxy from the rotation
   * @param proxyId ID of the proxy to remove
   * @returns boolean indicating if removal was successful
   */
  public removeProxy(proxyId: string): boolean {
    const index = this.proxies.findIndex((p) => p.id === proxyId);
    if (index !== -1) {
      this.proxies.splice(index, 1);
      this.proxyUsage.delete(proxyId);
      return true;
    }
    return false;
  }

  /**
   * Deactivate a proxy (keep it in the list but mark as inactive)
   * @param proxyId ID of the proxy to deactivate
   * @returns boolean indicating if deactivation was successful
   */
  public deactivateProxy(proxyId: string): boolean {
    const proxy = this.proxies.find((p) => p.id === proxyId);
    if (proxy) {
      proxy.isActive = false;
      return true;
    }
    return false;
  }

  /**
   * Reactivate a previously deactivated proxy
   * @param proxyId ID of the proxy to reactivate
   * @returns boolean indicating if reactivation was successful
   */
  public reactivateProxy(proxyId: string): boolean {
    const proxy = this.proxies.find((p) => p.id === proxyId);
    if (proxy) {
      proxy.isActive = true;
      return true;
    }
    return false;
  }

  /**
   * Get the next available proxy based on the rotation strategy and rate limits
   * @returns A proxy object or null if no proxy is available
   */
  public getNextProxy(): ProxyResult {
    const now = Date.now();
    const availableProxies = this.proxies.filter((proxy) => {
      if (!proxy.isActive) return false;

      const usage = this.proxyUsage.get(proxy.id);
      if (!usage) return true;

      if (usage.cooldownUntil > now) return false;

      const oneMinuteAgo = now - 60000;
      if (usage.lastUsed > oneMinuteAgo) {
        if (usage.usageCount >= this.options.requestsPerMinute) {
          usage.cooldownUntil = now + this.options.cooldownPeriod;
          return false;
        }
      } else {
        usage.usageCount = 0;
      }

      return true;
    });

    if (availableProxies.length === 0) {
      let nextAvailableIn: number | null = null;

      for (const usage of this.proxyUsage.values()) {
        if (!usage.proxy.isActive) continue;

        const timeUntilAvailable = usage.cooldownUntil - now;

        if (timeUntilAvailable > 0) {
          if (
            nextAvailableIn === null ||
            timeUntilAvailable < nextAvailableIn
          ) {
            nextAvailableIn = timeUntilAvailable;
          }
        }
      }

      return { proxy: null, nextAvailableIn };
    }

    let selectedProxy: Proxy | undefined;

    if (this.options.rotationStrategy === "least-used") {
      selectedProxy = availableProxies.reduce((least, current) => {
        const leastUsage = this.proxyUsage.get(least?.id!)!;
        const currentUsage = this.proxyUsage.get(current.id)!;
        return currentUsage.usageCount < leastUsage.usageCount
          ? current
          : least;
      }, availableProxies[0])!;
    } else {
      let attempts = 0;
      let index = this.currentIndex;

      do {
        index = (index + 1) % this.proxies.length;
        if (availableProxies.some((p) => p.id === this.proxies[index]?.id)) {
          selectedProxy = this.proxies[index]!;
          this.currentIndex = index;
          break;
        }
        attempts++;
      } while (attempts < this.proxies.length);

      if (!selectedProxy) {
        selectedProxy = availableProxies[0]!;
      }
    }

    const usage = this.proxyUsage.get(selectedProxy.id)!;
    usage.lastUsed = now;
    usage.usageCount++;

    return { proxy: selectedProxy, nextAvailableIn: null };
  }

  /**
   * Mark a proxy as having completed its request (useful for tracking)
   * @param proxyId ID of the proxy to mark
   */
  public markProxyUsed(proxyId: string): void {
    const usage = this.proxyUsage.get(proxyId);
    if (usage) {
      usage.usageCount++;
      usage.lastUsed = Date.now();
      this.resetConsecutiveDetections(proxyId);
    }
  }

  /**
   * Mark a proxy as having encountered an error or been detected
   * @param proxyId ID of the proxy to mark
   * @param cooldownPeriod Optional custom cooldown period in milliseconds
   */
  public markProxyDetected(proxyId: string, cooldownPeriod?: number): void {
    const usage = this.proxyUsage.get(proxyId);
    if (usage) {
      usage.consecutiveDetections++;
      let period = cooldownPeriod || this.options.cooldownPeriod;
      if (usage.consecutiveDetections >= 2) {
        period = period * usage.consecutiveDetections;
      }

      usage.cooldownUntil = Date.now() + period;
    }
  }
  public resetConsecutiveDetections(proxyId: string): void {
    const usage = this.proxyUsage.get(proxyId);
    if (usage) {
      usage.consecutiveDetections = 0;
    }
  }
  /**
   * Get all proxies with their current status
   * @returns Array of proxies with their usage statistics
   */
  public getProxyStatus(): Array<{
    proxy: Proxy;
    usage: Omit<ProxyUsage, "proxy">;
  }> {
    return Array.from(this.proxyUsage.values()).map((usage) => {
      const { proxy, ...usageStats } = usage;
      return {
        proxy,
        usage: usageStats,
      };
    });
  }

  /**
   * Get all active and available proxies
   * @returns Array of proxies that are not in cooldown and are active
   */
  public getAvailableProxies(): Proxy[] {
    const now = Date.now();
    return this.proxies.filter((proxy) => {
      if (!proxy.isActive) return false;

      const usage = this.proxyUsage.get(proxy.id);
      if (!usage) return true;

      if (usage.cooldownUntil > now) return false;

      const oneMinuteAgo = now - 60000;
      if (
        usage.lastUsed > oneMinuteAgo &&
        usage.usageCount >= this.options.requestsPerMinute
      ) {
        return false;
      }

      return true;
    });
  }
}

export default ProxyManager;
