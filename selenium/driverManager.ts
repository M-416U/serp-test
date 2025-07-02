import { WebDriver, Builder, Capabilities, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome";
import { Options } from "selenium-webdriver/chrome";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import { CONFIG } from "./config";
import type { Proxy } from "../proxyManager";
require("chromedriver-undetected");

interface TabInfo {
  handle: string;
  proxyId: string;
  isActive: boolean;
  lastUsed: number;
  createdAt: number;
}

export class DriverManager {
  private driver: WebDriver | null = null;
  private tabs: Map<string, TabInfo> = new Map();
  private maxTabs: number = 10;
  private readonly tabTTL: number = 2 * 60 * 1000; // 2 min
  private tabCleanupInterval: number = 300000;
  private readonly profileBaseDir = path.join(
    process.cwd(),
    "selenium_profiles"
  );
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(maxTabs: number = 10) {
    this.maxTabs = maxTabs;
    this.cleanupOldProfiles();
    this.startTabCleanup();
  }

  private startTabCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupInactiveTabs();
    }, this.tabCleanupInterval);
  }
  private async cleanupInactiveTabs(): Promise<void> {
    if (!this.driver) return;

    const now = Date.now();
    const handles = await this.driver.getAllWindowHandles();
    const tabsToClose: string[] = [];

    for (const [tabId, tabInfo] of this.tabs.entries()) {
      const isTabClosed = !handles.includes(tabInfo.handle);
      if (isTabClosed) {
        this.tabs.delete(tabId);
        continue;
      }

      try {
        await this.driver.switchTo().window(tabInfo.handle);
        const currentUrl = await this.driver.getCurrentUrl();
        const isAboutBlank = currentUrl === "about:blank";

        const shouldClose =
          !tabInfo.isActive &&
          (now - tabInfo.lastUsed > this.tabCleanupInterval ||
            now - tabInfo.createdAt > this.tabTTL ||
            isAboutBlank);

        if (shouldClose) {
          tabsToClose.push(tabId);
        }
      } catch (err: any) {
        console.warn(`Skipping invalid tab ${tabId}: ${err.message}`);
        this.tabs.delete(tabId);
      }
    }

    for (const tabId of tabsToClose) {
      await this.closeTab(tabId);
    }

    const inactiveTabs = Array.from(this.tabs.entries())
      .filter(([_, info]) => !info.isActive)
      .sort(([_, a], [__, b]) => a.lastUsed - b.lastUsed);

    if (inactiveTabs.length > this.maxTabs) {
      const excessTabs = inactiveTabs.slice(
        0,
        inactiveTabs.length - this.maxTabs
      );
      for (const [tabId] of excessTabs) {
        await this.closeTab(tabId);
      }
    }
  }

  private cleanupOldProfiles(maxAge: number = 600000): void {
    try {
      if (!fs.existsSync(this.profileBaseDir)) {
        return;
      }

      const now = Date.now();
      const files = fs.readdirSync(this.profileBaseDir);

      for (const file of files) {
        const profilePath = path.join(this.profileBaseDir, file);
        const stats = fs.statSync(profilePath);

        if (now - stats.mtimeMs > maxAge) {
          try {
            fs.rmSync(profilePath, { recursive: true, force: true });
            console.log(`Removed old profile directory: ${profilePath}`);
          } catch (err: any) {
            console.warn(
              `Failed to remove old profile: ${profilePath}, Error: ${err.message}`
            );
          }
        }
      }
    } catch (err: any) {
      console.error(`Error during profile cleanup: ${err.message}`);
    }
  }

  public async initializeBrowser(
    proxyConfig: Proxy | null = null
  ): Promise<void> {
    if (this.driver) {
      return;
    }
    try {
      // const uniqueId = randomBytes(8).toString("hex");
      // const userDataDir = path.join(this.profileBaseDir, `profile_${uniqueId}`);

      // if (!fs.existsSync(path.dirname(userDataDir))) {
      //   fs.mkdirSync(path.dirname(userDataDir), { recursive: true });
      // }

      const options = new Options();
      options.addArguments(
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--start-maximized",
        "--log-level=3",
        "--silent",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--window-size=1920,1080",
        "--enable-features=TabDiscarding,AutoDiscardableTabs",
        "--force-fieldtrials=TabDiscarding/Enabled/"
      );

      if (proxyConfig) {
        const proxyUrl = `${proxyConfig.host}:${proxyConfig.port}`;
        // const proxyArg = `--proxy-server=${proxyUrl}`;
        // options.addArguments(proxyArg);
        options.addArguments(`--proxy-server=${proxyUrl}`);
      }

      const loggingPrefs = new logging.Preferences();
      loggingPrefs.setLevel(logging.Type.BROWSER, logging.Level.OFF);
      loggingPrefs.setLevel(logging.Type.DRIVER, logging.Level.OFF);
      loggingPrefs.setLevel(logging.Type.CLIENT, logging.Level.OFF);
      loggingPrefs.setLevel(logging.Type.SERVER, logging.Level.OFF);

      const capabilities = Capabilities.chrome();
      capabilities.set("goog:loggingPrefs", loggingPrefs);

      options.addArguments(`--user-agent=${this.getRandomUserAgent()}`);

      const serviceBuilder = new chrome.ServiceBuilder();

      this.driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .withCapabilities(capabilities)
        .setChromeService(serviceBuilder)
        .build();

      await this.driver.manage().setTimeouts({
        script: CONFIG.BROWSER_TIMEOUT_MS,
        pageLoad: CONFIG.BROWSER_TIMEOUT_MS,
        implicit: 10000,
      });

      await this.addAntiDetectionMeasures(this.driver);
      console.log("Browser initialized successfully");
    } catch (error: any) {
      console.error(`Error initializing browser: ${error.message}`);
      throw new Error(`Failed to initialize browser: ${error.message}`);
    }
  }

  public async getTab(
    proxyConfig: Proxy | null = null
  ): Promise<{ driver: WebDriver; tabId: string }> {
    if (!this.driver) {
      await this.initializeBrowser(proxyConfig);
    }

    let existingTabId: string | null = null;
    for (const [tabId, tabInfo] of this.tabs.entries()) {
      if (tabInfo.proxyId === proxyConfig?.id && !tabInfo.isActive) {
        existingTabId = tabId;
        break;
      }
    }

    if (existingTabId) {
      const tabInfo = this.tabs.get(existingTabId)!;
      tabInfo.isActive = true;
      tabInfo.lastUsed = Date.now();

      await this.driver!.switchTo().window(tabInfo.handle);
      try {
        await (this.driver as any).sendDevToolsCommand("Page.enable");
        await (this.driver as any).sendDevToolsCommand(
          "Page.setAutoDiscardable",
          {
            discardable: true,
          }
        );
        console.log(`Marked tab ${existingTabId} as auto-discardable`);
      } catch (err: any) {
        console.warn(
          `Failed to set tab ${existingTabId} as discardable: ${err.message}`
        );
      }
      console.log(
        `Reusing existing tab ${existingTabId} for proxy ${proxyConfig?.id}`
      );
      return { driver: this.driver!, tabId: existingTabId };
    }

    const tabId = `tab_${randomBytes(4).toString("hex")}`;

    await this.driver!.executeScript("window.open('about:blank', '_blank');");
    const handles = await this.driver!.getAllWindowHandles();
    const newHandle = handles[handles.length - 1]!;

    await this.driver!.switchTo().window(newHandle);

    if (proxyConfig?.id !== "default") {
      await this.setProxy(proxyConfig);
    }

    this.tabs.set(tabId, {
      handle: newHandle,
      proxyId: proxyConfig?.id || "default",
      isActive: true,
      lastUsed: Date.now(),
      createdAt: Date.now(),
    });

    console.log(`Created new tab ${tabId} for proxy ${proxyConfig?.id}`);
    return { driver: this.driver!, tabId };
  }

  public async releaseTab(tabId: string): Promise<void> {
    console.log(`release tab ${tabId}`);
    const tabInfo = this.tabs.get(tabId);
    if (tabInfo) {
      tabInfo.isActive = false;
      tabInfo.lastUsed = Date.now();
      if (this.tabs.size > 1) {
        this.closeTab(tabId);
        console.log(`closing tab ${tabId}`);
      }
    }
  }

  private async closeTab(tabId: string): Promise<void> {
    const tabInfo = this.tabs.get(tabId);
    if (!tabInfo || !this.driver) return;

    try {
      const currentHandles = await this.driver.getAllWindowHandles();
      if (currentHandles.includes(tabInfo.handle)) {
        await this.driver.switchTo().window(tabInfo.handle);
        await this.driver.close();

        const remainingHandles = await this.driver.getAllWindowHandles();
        if (remainingHandles.length > 0) {
          await this.driver.switchTo().window(remainingHandles[0]!);
        }
      }

      this.tabs.delete(tabId);
      console.log(`Closed tab ${tabId}`);
    } catch (error: any) {
      console.warn(`Error closing tab ${tabId}: ${error.message}`);
      this.tabs.delete(tabId);
    }
  }

  private async setProxy(proxyConfig: Proxy | null): Promise<void> {
    await this.closeBrowser();
    this.tabs.clear();
    await this.initializeBrowser(proxyConfig);
    console.log(
      `Browser restarted with new proxy: ${
        proxyConfig ? proxyConfig.host + ":" + proxyConfig.port : "none"
      }`
    );
  }

  private getRandomUserAgent(): string {
    const index = Math.floor(Math.random() * CONFIG.USER_AGENTS.length);
    return CONFIG.USER_AGENTS[index] || "";
  }

  private async addAntiDetectionMeasures(driver: WebDriver): Promise<void> {
    try {
      await driver.executeScript(`
        // Overwrite the navigator properties
        Object.defineProperty(navigator, 'webdriver', {
          get: () => false
        });
        
        // Overwrite user agent if needed
        Object.defineProperty(navigator, 'userAgent', {
          get: () => "${this.getRandomUserAgent()}"
        });
        
        // Add language preferences
        Object.defineProperty(navigator, 'languages', {
          get: () => ['en-US', 'en']
        });
        
        // Set platform
        Object.defineProperty(navigator, 'platform', {
          get: () => 'Win32'
        });
        
        // Set vendor
        Object.defineProperty(navigator, 'vendor', {
          get: () => 'Google Inc.'
        });
        
        // Hide automation
        window.navigator.chrome = { runtime: {} };
        
        // Remove driver flags
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Array;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Promise;
        delete window.cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
      `);
    } catch (error: any) {
      console.warn(`Failed to add anti-detection measures: ${error.message}`);
    }
  }

  public async closeAllTabs(): Promise<void> {
    const tabIds = Array.from(this.tabs.keys());
    for (const tabId of tabIds) {
      await this.closeTab(tabId);
    }
  }

  public async closeBrowser(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    if (this.driver) {
      try {
        await this.driver.quit();
        this.driver = null;
        this.tabs.clear();
        console.log("Browser closed successfully");
      } catch (error: any) {
        console.warn(`Error closing browser: ${error.message}`);
      }
    }
  }

  public getActiveTabsCount(): number {
    return Array.from(this.tabs.values()).filter((tab) => tab.isActive).length;
  }

  public getTotalTabsCount(): number {
    return this.tabs.size;
  }
}
