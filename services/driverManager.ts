import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
  type LaunchOptions,
} from "playwright";
import { CONFIG } from "./config";

interface ProxyConfig {
  id: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export class DriverManager {
  private browserPool: Map<string, Browser> = new Map();
  private contextPool: Map<string, BrowserContext> = new Map();
  private maxBrowserAge: number = 300000; // 5 minutes
  private browserCreationTimes: Map<string, number> = new Map();
  private readonly maxConcurrentBrowsers = 5;

  constructor() {
    this.setupCleanupInterval();
  }

  private setupCleanupInterval(): void {
    setInterval(() => {
      this.cleanupStaleBrowsers();
    }, 120000);
  }

  private async cleanupStaleBrowsers(): Promise<void> {
    const now = Date.now();
    const staleKeys: string[] = [];

    for (const [key, creationTime] of this.browserCreationTimes.entries()) {
      if (now - creationTime > this.maxBrowserAge) {
        staleKeys.push(key);
      }
    }

    for (const key of staleKeys) {
      await this.closeBrowser(key);
    }
  }

  public async getPage(proxyConfig: ProxyConfig | null = null): Promise<Page> {
    const browser = await chromium.launchPersistentContext("./profile", {
      headless: false,
    });
    // const context = await browser.newContext();

    const page = await browser.newPage();
    return page;
    // console.log(
    //   `[DEBUG] getPage called with proxy: ${proxyConfig?.id || "none"}`
    // );

    // if (this.browserPool.size >= this.maxConcurrentBrowsers) {
    //   console.log(`[DEBUG] Max browsers reached, cleaning up oldest...`);
    //   await this.cleanupOldestBrowser();
    // }

    // try {
    //   const browserKey = proxyConfig ? `proxy_${proxyConfig.id}` : "default";
    //   console.log(`[DEBUG] Browser key: ${browserKey}`);

    //   let browser = this.browserPool.get(browserKey);
    //   let context = this.contextPool.get(browserKey);

    //   if (!browser || !context) {
    //     console.log(`[DEBUG] Creating new browser and context...`);
    //     const result = await this.createBrowserAndContext(proxyConfig);
    //     browser = result.browser;
    //     // context = result.context;
    //     console.log(`[DEBUG] Browser and context created successfully`);
    //   } else {
    //     console.log(`[DEBUG] Reusing existing browser and context`);
    //   }

    //   console.log(`[DEBUG] Creating new page...`);
    //   const page = await browser.newPage();
    //   console.log(`[DEBUG] Page created, setting up stealth...`);

    //   await this.setupPageStealth(page);
    //   console.log(`[DEBUG] Stealth setup complete`);

    //   return page;
    // } catch (error: any) {
    //   console.error(`[ERROR] getPage failed: ${error.message}`);
    //   console.error(`[ERROR] Stack trace: ${error.stack}`);
    //   throw new Error(`Failed to get page: ${error.message}`);
    // }
  }

  private async cleanupOldestBrowser(): Promise<void> {
    let oldestKey = "";
    let oldestTime = Date.now();

    for (const [key, time] of this.browserCreationTimes.entries()) {
      if (time < oldestTime) {
        oldestTime = time;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      await this.closeBrowser(oldestKey);
    }
  }

  private getRandomUserAgent(): string {
    const userAgents = CONFIG.USER_AGENTS;
    return userAgents[Math.floor(Math.random() * userAgents.length)]!;
  }

  private async createBrowserAndContext(proxyConfig: ProxyConfig | null) {
    const browserKey = proxyConfig ? `proxy_${proxyConfig.id}` : "default";
    console.log(`[DEBUG] createBrowserAndContext for key: ${browserKey}`);

    if (this.browserPool.has(browserKey)) {
      console.log(`[DEBUG] Closing existing browser for key: ${browserKey}`);
      await this.closeBrowser(browserKey);
    }

    const launchOptions: LaunchOptions = {
      headless: true,
      // args: [
      //   "--no-sandbox",
      //   "--disable-setuid-sandbox",
      //   "--disable-dev-shm-usage",
      //   "--disable-background-timer-throttling",
      //   "--disable-backgrounding-occluded-windows",
      //   "--disable-renderer-backgrounding",
      //   "--disable-features=TranslateUI",
      //   "--disable-extensions",
      //   "--no-first-run",
      //   "--no-default-browser-check",
      //   "--disable-default-apps",
      //   "--disable-component-extensions-with-background-pages",
      //   "--memory-pressure-off",
      //   "--max_old_space_size=512",
      //   "--optimize-for-size",
      //   "--ignore-certificate-errors",
      //   "--ignore-ssl-errors",
      //   "--disable-web-security",
      //   "--allow-running-insecure-content",
      //   "--disable-features=VizDisplayCompositor",
      //   "--disable-blink-features=AutomationControlled",
      // ],
      // timeout: 60000,
    };

    console.log(`[DEBUG] Launching browser...`);

    // let browser: Browser;
    // try {
    const browser = await chromium.launch();
    console.log(`[DEBUG] Browser launched successfully`);
    // } catch (launchError: any) {
    //   console.error(`[ERROR] Failed to launch browser: ${launchError.message}`);
    //   throw new Error(`Browser launch failed: ${launchError.message}`);
    // }

    const contextOptions: any = {
      userAgent: this.getRandomUserAgent(),
      viewport: { width: 1366, height: 768 },
      locale: "en-US",
      timezoneId: "America/New_York",
      permissions: [],
      javaScriptEnabled: true,
      acceptDownloads: false,
      recordVideo: undefined,
      recordHar: undefined,
      ignoreHTTPSErrors: true,
      bypassCSP: true,
    };

    if (proxyConfig?.host && proxyConfig?.port) {
      console.log(
        `[DEBUG] Setting up proxy: ${proxyConfig.host}:${proxyConfig.port}`
      );
      contextOptions.proxy = {
        server: `http://${proxyConfig.host}:${proxyConfig.port}`,
        // username: proxyConfig.username,
        // password: proxyConfig.password,
      };
    }

    console.log(`[DEBUG] Creating browser context...`);

    // let context: BrowserContext;
    // try {
    //   context = await browser.newContext(contextOptions);
    //   console.log(`[DEBUG] Browser context created successfully`);
    // } catch (contextError: any) {
    //   console.error(
    //     `[ERROR] Failed to create context: ${contextError.message}`
    //   );
    //   await browser.close();
    //   throw new Error(`Context creation failed: ${contextError.message}`);
    // }

    // try {
    //   console.log(`[DEBUG] Testing browser responsiveness...`);
    //   const testPage = await context.newPage();
    //   await testPage.goto("about:blank", { timeout: 10000 });
    //   await testPage.close();
    //   console.log(`[DEBUG] Browser responsiveness test passed`);
    // } catch (testError: any) {
    //   console.error(
    //     `[ERROR] Browser responsiveness test failed: ${testError.message}`
    //   );
    //   await context.close();
    //   await browser.close();
    //   throw new Error(`Browser not responsive: ${testError.message}`);
    // }

    this.browserPool.set(browserKey, browser);
    // this.contextPool.set(browserKey, context);
    this.browserCreationTimes.set(browserKey, Date.now());

    return { browser };
  }

  private async setupPageStealth(page: Page): Promise<void> {
    console.log(`[DEBUG] Setting up page stealth...`);

    try {
      await page.setExtraHTTPHeaders({
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "max-age=0",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
        "Sec-Fetch-User": "?1",
      });

      await page.addInitScript(() => {
        // Remove webdriver property
        Object.defineProperty(navigator, "webdriver", {
          get: () => false,
        });

        // Add chrome object
        (window as any).chrome = {
          runtime: {},
          loadTimes: function () {
            return {
              commitLoadTime: Date.now() / 1000 - Math.random() * 2,
              finishDocumentLoadTime: Date.now() / 1000 - Math.random(),
              finishLoadTime: Date.now() / 1000 - Math.random(),
              firstPaintAfterLoadTime: 0,
              firstPaintTime: Date.now() / 1000 - Math.random(),
              navigationType: "Other",
              npnNegotiatedProtocol: "http/1.1",
              requestTime: Date.now() / 1000 - Math.random() * 3,
              startLoadTime: Date.now() / 1000 - Math.random() * 2,
              wasAlternateProtocolAvailable: false,
              wasFetchedViaSpdy: false,
              wasNpnNegotiated: false,
            };
          },
          csi: function () {
            return {
              onloadT: Date.now(),
              pageT: Date.now() - performance.timing.navigationStart,
              startE: Date.now(),
              tran: 15,
            };
          },
        };

        // Override permissions
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) =>
          parameters.name === "notifications"
            ? Promise.resolve({ state: Notification.permission } as any)
            : originalQuery(parameters);

        // Override plugins
        Object.defineProperty(navigator, "plugins", {
          get: () => [1, 2, 3, 4, 5],
        });

        // Override languages
        Object.defineProperty(navigator, "languages", {
          get: () => ["en-US", "en"],
        });

        // Override platform
        Object.defineProperty(navigator, "platform", {
          get: () => "Win32",
        });

        // Override hardwareConcurrency
        Object.defineProperty(navigator, "hardwareConcurrency", {
          get: () => 4,
        });
      });

      page.setDefaultTimeout(60000);
      page.setDefaultNavigationTimeout(60000);

      console.log(`[DEBUG] Page stealth setup completed`);
    } catch (error: any) {
      console.error(`[ERROR] Failed to setup page stealth: ${error.message}`);
      throw error;
    }
  }

  public async closeBrowser(browserKey: string): Promise<void> {
    console.log(`[DEBUG] Closing browser: ${browserKey}`);

    try {
      const context = this.contextPool.get(browserKey);
      const browser = this.browserPool.get(browserKey);

      if (context) {
        await context.close().catch((err) => {
          console.warn(`[WARNING] Error closing context: ${err.message}`);
        });
        this.contextPool.delete(browserKey);
      }

      if (browser) {
        await browser.close().catch((err) => {
          console.warn(`[WARNING] Error closing browser: ${err.message}`);
        });
        this.browserPool.delete(browserKey);
      }

      this.browserCreationTimes.delete(browserKey);

      console.log(`[DEBUG] Browser ${browserKey} closed successfully`);
    } catch (err: any) {
      console.error(
        `[ERROR] Error closing browser ${browserKey}: ${err.message}`
      );
    }
  }

  public async closeAllBrowsers(): Promise<void> {
    console.log(`[DEBUG] Closing all browsers...`);
    const browserKeys = Array.from(this.browserPool.keys());
    await Promise.all(browserKeys.map((key) => this.closeBrowser(key)));
    console.log(`[DEBUG] All browsers closed`);
  }

  public getBrowserStats(): {
    activeBrowsers: number;
    contexts: number;
  } {
    return {
      activeBrowsers: this.browserPool.size,
      contexts: this.contextPool.size,
    };
  }

  public async shutdown(): Promise<void> {
    console.log("Shutting down DriverManager...");
    await this.closeAllBrowsers();
    console.log("DriverManager shutdown complete");
  }
}
