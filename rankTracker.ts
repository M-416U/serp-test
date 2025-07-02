import * as fs from "fs";
import * as path from "path";
import { DriverManager } from "./services/driverManager";
import { CaptchaHandler } from "./services/captchaHandler";
import { SearchResultsParser } from "./services/searchResultsParser";
import type { CaptchaStats, RankJobData, RankResult } from "./types";
import { CONFIG } from "./services/config";
import { buildGoogleSearchUrl, delay, randomDelay } from "./services/helpers";
import ProxyManager from "./proxyManager";
import type { Page } from "playwright";

export class RankTracker {
  private statsFile: string;
  private driverManager: DriverManager;
  private captchaHandler: CaptchaHandler;
  private searchResultsParser: SearchResultsParser;
  private proxyManager: ProxyManager | null;

  constructor(proxyManager?: ProxyManager) {
    this.statsFile = path.join(process.cwd(), "rank_stats.csv");
    if (!fs.existsSync(this.statsFile)) {
      fs.writeFileSync(
        this.statsFile,
        "keyword,target,rank,url,tries,errors,searchUrl,captcha_solved,captcha_errors,proxy\n"
      );
    }

    this.proxyManager = proxyManager || null;
    this.driverManager = new DriverManager();
    this.captchaHandler = new CaptchaHandler(process.env.CAPTCHA_API_KEY!);
    this.searchResultsParser = new SearchResultsParser();
  }

  public async processJob(job: { data: RankJobData }) {
    const startTime = Date.now();
    const { keyword, domain, location, language, deviceType } = job.data;
    let errors: string[] = [];
    let searchUrl = "";
    let captchaSolved = 0;
    let captchaErrors = 0;
    let usedProxyId = "none";

    console.log(`Starting rank check for "${keyword}" on domain "${domain}"`);

    let retries = 0;
    let result: RankResult | null = null;

    while (!result && retries < CONFIG.MAX_RETRIES) {
      try {
        console.log(`Retry ${retries} for "${keyword}"`);

        let proxyConfig = null;
        if (this.proxyManager) {
          const proxyResult = this.proxyManager.getNextProxy();
          proxyConfig = proxyResult.proxy;

          if (!proxyConfig) {
            const waitTime = proxyResult.nextAvailableIn || 5000;
            console.log(
              `No proxy available. Waiting ${waitTime}ms before retry...`
            );
            await delay(waitTime);
            retries++;
            continue;
          }

          usedProxyId = proxyConfig.id;
          console.log(`Using proxy: ${proxyConfig.host}:${proxyConfig.port}`);
        }

        const { result: rankResult, captchaStats } =
          await this.checkKeywordRank(
            keyword,
            domain,
            location!,
            language,
            deviceType,
            proxyConfig
          );

        captchaSolved += captchaStats.solved;
        captchaErrors += captchaStats.errors;

        result = rankResult;

        if (result.rank === 0) {
          console.log(
            `[WARNING] Got result with rank=0 for "${keyword}". Will retry.`
          );
          result = null;
          throw new Error(`Rank is 0 for keyword "${keyword}"`);
        }

        if (this.proxyManager && proxyConfig) {
          this.proxyManager.markProxyUsed(proxyConfig.id);
        }

        searchUrl = buildGoogleSearchUrl(keyword, location!, language!);
      } catch (error: any) {
        errors.push(error.message);
        retries++;
        console.error(`Error checking rank for "${keyword}": ${error.message}`);

        if (
          this.proxyManager &&
          usedProxyId !== "none" &&
          (error.message.includes("captcha") ||
            error.message.includes("detected"))
        ) {
          this.proxyManager.markProxyDetected(usedProxyId);
        }

        await delay(CONFIG.RETRY_DELAY_MS);

        if (retries >= CONFIG.MAX_RETRIES) {
          console.log(
            `[WARNING] Reached maximum retries (${CONFIG.MAX_RETRIES}) for keyword "${keyword}". Saving with null rank.`
          );
          result = {
            keyword,
            domain,
            rank: null,
            url: null,
            error: errors.join(" | "),
            timestamp: new Date(),
            location,
            language,
            deviceType,
          };
        }
      }
    }

    if (result) {
      const statsLine =
        [
          keyword,
          domain,
          result.rank || "",
          result.url || "",
          retries,
          errors.join("|"),
          searchUrl,
          captchaSolved,
          captchaErrors,
          usedProxyId,
        ]
          .map((item) => `"${String(item).replace(/"/g, '""')}"`)
          .join(",") + "\n";

      fs.appendFileSync(this.statsFile, statsLine);
      console.log({
        ...result,
        captchaSolved,
        captchaErrors,
        proxy: usedProxyId,
      });
    }
    const duration = Date.now() - startTime;
    console.log(`Job completed in ${duration}ms`);
    return result;
  }
  private async checkKeywordRank(
    keyword: string,
    domain: string,
    location: string,
    language: string = "en",
    deviceType: "desktop" | "mobile" = "desktop",
    proxyConfig: any = null
  ): Promise<{
    result: RankResult;
    captchaStats: CaptchaStats;
  }> {
    const searchUrl = buildGoogleSearchUrl(keyword, location, language);
    let driver: Page | null = null;
    let captchaSolved = 0;
    let captchaErrors = 0;

    console.log(`[DEBUG] Starting checkKeywordRank for "${keyword}"`);
    console.log(`[DEBUG] Search URL: ${searchUrl}`);

    // Validate URL before proceeding
    try {
      new URL(searchUrl);
      console.log(`[DEBUG] URL validation passed`);
    } catch (urlError) {
      console.error(`[ERROR] Invalid URL: ${searchUrl}`);
      throw new Error(`Invalid search URL: ${searchUrl}`);
    }

    try {
      console.log(
        `[DEBUG] Getting page with proxy: ${proxyConfig?.id || "none"}`
      );

      // Get page with timeout
      const pagePromise = this.driverManager.getPage(proxyConfig);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error("Page creation timeout")), 60000);
      });

      driver = (await Promise.race([pagePromise, timeoutPromise])) as Page;

      if (!driver) {
        throw new Error("Failed to create driver - driver is null");
      }

      console.log(`[DEBUG] Page created successfully`);
      console.log(`[DEBUG] Current URL before navigation: ${driver.url()}`);

      // Add random delay before navigation
      const delay = Math.random() * 3000 + 2000; // 2-5 seconds
      console.log(
        `[DEBUG] Waiting ${Math.round(delay)}ms before navigation...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));

      console.log(`[DEBUG] Starting navigation to: ${searchUrl}`);

      // Navigation with multiple retry attempts
      let navigationSuccess = false;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          console.log(`[DEBUG] Navigation attempt ${attempt}/3`);

          const response = await driver.goto(searchUrl, {
            waitUntil: "domcontentloaded",
            timeout: 90000, // 90 seconds timeout
          });

          console.log(`[DEBUG] Navigation response received`);
          console.log(`[DEBUG] Response status: ${response?.status()}`);
          console.log(`[DEBUG] Final URL: ${driver.url()}`);

          if (!response) {
            throw new Error("Navigation returned null response");
          }

          const status = response.status();
          if (status >= 400) {
            throw new Error(`Navigation failed with HTTP status: ${status}`);
          }

          // Check if we actually navigated to the right place
          const finalUrl = driver.url();
          if (finalUrl === "about:blank" || finalUrl === "") {
            throw new Error("Navigation resulted in blank page");
          }

          navigationSuccess = true;
          console.log(`[DEBUG] Navigation successful on attempt ${attempt}`);
          break;
        } catch (navError: any) {
          console.error(
            `[ERROR] Navigation attempt ${attempt} failed: ${navError.message}`
          );
          lastError = navError;

          if (attempt < 3) {
            console.log(`[DEBUG] Waiting before retry...`);
            await new Promise((resolve) => setTimeout(resolve, 5000));

            // Try to refresh the page context
            try {
              await driver.reload({ timeout: 30000 });
              console.log(`[DEBUG] Page reloaded for retry`);
            } catch (reloadError) {
              console.warn(`[WARNING] Page reload failed: ${reloadError}`);
            }
          }
        }
      }

      if (!navigationSuccess) {
        throw new Error(
          `Navigation failed after 3 attempts. Last error: ${lastError?.message}`
        );
      }

      console.log(`[DEBUG] Waiting for page to be ready...`);

      // Wait for page to be ready with multiple selectors
      const selectors = ["body", "html", "#main"];
      let selectorFound = false;

      for (const selector of selectors) {
        try {
          await driver.waitForSelector(selector, {
            timeout: 30000,
            state: "attached",
          });
          console.log(`[DEBUG] Found selector: ${selector}`);
          selectorFound = true;
          break;
        } catch (selectorError) {
          console.warn(
            `[WARNING] Selector '${selector}' not found: ${selectorError}`
          );
        }
      }

      if (!selectorFound) {
        console.warn(
          `[WARNING] No selectors found, trying to get page content...`
        );
        try {
          const content = await driver.content();
          console.log(`[DEBUG] Page content length: ${content.length}`);
          if (content.length < 100) {
            console.log(`[DEBUG] Page content: ${content}`);
            throw new Error("Page appears to be empty or not loaded properly");
          }
        } catch (contentError) {
          console.error(`[ERROR] Cannot get page content: ${contentError}`);
          throw new Error("Page is not accessible");
        }
      }

      // Additional wait to ensure page is fully loaded
      console.log(`[DEBUG] Waiting additional 3 seconds for page stability...`);
      await driver.waitForTimeout(3000);

      console.log(`[DEBUG] Checking for CAPTCHA...`);

      const { solved, errors, shouldRetry } =
        await this.captchaHandler.detectAndHandleCaptcha(driver);
      captchaSolved = solved;
      captchaErrors = errors;

      if (shouldRetry) {
        throw new Error(`CAPTCHA detected and couldn't be solved. Retrying.`);
      }

      console.log(`[DEBUG] Extracting search results...`);

      const results = await this.searchResultsParser.extractSearchResults(
        driver
      );

      console.log(`[DEBUG] Found ${results.length} search results`);

      let rank = 0;
      let rankUrl = "null";

      for (let i = 0; i < results.length; i++) {
        const { url } = results[i]!;
        if (url && url.includes(domain)) {
          rank = i + 1;
          rankUrl = url;
          console.log(
            `[DEBUG] Found domain "${domain}" at rank ${rank}: ${url}`
          );
          break;
        }
      }

      if (rank === 0) {
        console.log(
          `[WARNING] No rank found for keyword "${keyword}" on domain "${domain}"`
        );
        console.log(
          `[INFO] Found ${results.length} results but none matched domain "${domain}"`
        );

        if (results.length > 0) {
          console.log(`[DEBUG] First ${Math.min(5, results.length)} results:`);
          results.slice(0, 5).forEach((result, idx) => {
            console.log(`  ${idx + 1}. ${result.title} - ${result.url}`);
          });
        } else {
          console.log(`[WARNING] No search results found at all!`);
          // Take a screenshot for debugging
          try {
            await driver.screenshot({
              path: `debug-no-results-${Date.now()}.png`,
            });
            console.log(`[DEBUG] Debug screenshot saved`);
          } catch (screenshotError) {
            console.warn(
              `[WARNING] Could not take debug screenshot: ${screenshotError}`
            );
          }
        }

        rank = 101;
        rankUrl = "not found";
      }

      return {
        result: {
          keyword,
          domain,
          rank,
          url: rankUrl,
          timestamp: new Date(),
          location,
          language,
          deviceType,
          error: null,
        },
        captchaStats: {
          solved: captchaSolved,
          errors: captchaErrors,
        },
      };
    } catch (error: any) {
      console.error(
        `[ERROR] checkKeywordRank failed for "${keyword}":`,
        error.message
      );
      console.error(`[ERROR] Stack trace:`, error.stack);

      // Try to get debug info if driver exists
      if (driver) {
        try {
          const currentUrl = driver.url();
          const title = await driver.title();
          console.log(
            `[DEBUG] Error state - URL: ${currentUrl}, Title: ${title}`
          );

          // Take error screenshot
          await driver.screenshot({ path: `error-${Date.now()}.png` });
          console.log(`[DEBUG] Error screenshot saved`);
        } catch (debugError) {
          console.warn(`[WARNING] Could not get debug info: ${debugError}`);
        }
      }

      throw new Error(`Failed to check rank: ${error.message}`);
    } finally {
      if (driver) {
        try {
          console.log(`[DEBUG] Cleaning up browser...`);
          const browserKey = proxyConfig
            ? `proxy_${proxyConfig.id}`
            : "default";
          await this.driverManager.closeBrowser(browserKey);
          console.log(`[DEBUG] Browser cleanup completed`);
        } catch (cleanupError) {
          console.error(`[ERROR] Browser cleanup failed: ${cleanupError}`);
        }
      }
    }
  }
}
