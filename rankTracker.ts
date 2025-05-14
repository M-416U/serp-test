import ProxyManager from "./proxyManager";
import type { RankResult } from "./types";
import puppeteer from "puppeteer-extra";
import { Browser, Page } from "puppeteer";
import * as fs from "fs";
import * as path from "path";
const UndetectableBrowser = require("undetected-browser");

// puppeteer extra plugins
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
puppeteer.use(StealthPlugin());

const RecaptchaPlugin = require("puppeteer-extra-plugin-recaptcha");
puppeteer.use(RecaptchaPlugin());
const AnonymizeUA = require("puppeteer-extra-plugin-anonymize-ua");
puppeteer.use(AnonymizeUA({ customFn: (ua: any) => ua }));
const CONFIG = {
  BASE_DELAY_MS: 2000,
  MAX_PAGES_TO_CHECK: 1,
  RESULTS_PER_PAGE: 100,
  MAX_RETRIES: 10,
  USER_AGENTS: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
  ],
  BROWSER_TIMEOUT_MS: 600000, // 10 minuets
  RETRY_DELAY_MS: 5000,
  USE_AXIOS: false,
  VIEWPORT_WIDTHS: [1366, 1440, 1536, 1920, 2560],
  VIEWPORT_HEIGHTS: [768, 900, 864, 1080, 1440],
  SCROLL_BEHAVIORS: ["smooth", "auto"],
  CAPTCHA_API_KEY: process.env.CAPTCHA_API_KEY!,
};

export class RankTrackerWorker {
  private proxyManager: ProxyManager;
  private statsFile: string;

  constructor(proxyManager: ProxyManager) {
    this.proxyManager = proxyManager;
    this.statsFile = path.join(process.cwd(), "stats.csv");
    if (!fs.existsSync(this.statsFile)) {
      fs.writeFileSync(
        this.statsFile,
        "keyword,target,rank,url,tries,errors,proxy,searchUrl,captcha_solved,captcha_errors\n"
      );
    }
  }
  private getRandomUserAgent(): string {
    const index = Math.floor(Math.random() * CONFIG.USER_AGENTS.length);
    return CONFIG.USER_AGENTS[index] || "";
  }
  public async processJob(job: any) {
    const { keyword, domain, location, language, deviceType } = job.data;
    let errors: string[] = [];
    let searchUrl = "";
    let captchaSolved = 0;
    let captchaErrors = 0;

    console.log(`Starting rank check for "${keyword}" on domain "${domain}"`);

    let retries = 0;
    let result: RankResult | null = null;
    let currentProxy: any = null;

    while (!result && retries < CONFIG.MAX_RETRIES) {
      try {
        console.log(`Retry ${retries} for "${keyword}"`);
        const proxyResult = this.proxyManager.getNextProxy();
        if (!proxyResult.proxy) {
          const waitTime = proxyResult.nextAvailableIn || 10000;
          console.log(
            `No proxy available. Waiting ${Math.ceil(
              waitTime / 1000
            )} seconds before retrying... (Next available in: ${Math.ceil(
              waitTime / 1000
            )} seconds)`
          );
          await this.delay(waitTime);
          retries++;
          continue;
        } else {
          currentProxy = proxyResult.proxy;
        }
        const { result: rankResult, captchaStats } =
          await this.checkKeywordRank(
            keyword,
            domain,
            currentProxy,
            location,
            language,
            deviceType
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

        searchUrl = this.buildGoogleSearchUrl(keyword, location, language);
        this.proxyManager.markProxyUsed(currentProxy.id);
      } catch (error: any) {
        this.proxyManager.markProxyDetected(currentProxy.id);
        errors.push(error.message);
        retries++;
        console.error(`Error checking rank for "${keyword}": ${error.message}`);
        if (retries > 1000) {
          console.log(
            `[WARNING] Reached maximum retries (1000) for keyword "${keyword}". Saving with null rank.`
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
          `${currentProxy?.host}:${currentProxy?.port}`,
          searchUrl,
          captchaSolved,
          captchaErrors,
        ]
          .map((item) => `"${String(item).replace(/"/g, '""')}"`)
          .join(",") + "\n";

      fs.appendFileSync(this.statsFile, statsLine);
      console.log({ ...result, captchaSolved, captchaErrors });
    }
    return result;
  }

  private async createBrowser(proxy: any): Promise<any> {
    const viewportIndex = Math.floor(
      Math.random() * CONFIG.VIEWPORT_WIDTHS.length
    );
    try {
      const uniqueId = proxy.id;
      const userDataDir = path.join(
        process.cwd(),
        `browser_profiles/profile_${uniqueId}`
      );

      if (!fs.existsSync(path.dirname(userDataDir))) {
        fs.mkdirSync(path.dirname(userDataDir), { recursive: true });
      }

      const UndetectableBMS = new UndetectableBrowser(
        await puppeteer.launch({
          headless: true,
          executablePath: process.env.BRAVE_PATH!,
          userDataDir: userDataDir,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            `--proxy-server=${proxy.host}:${proxy.port}`,
          ],
        })
      );
      const browser = await UndetectableBMS.getBrowser();
      return browser;
    } catch (error: any) {
      const uniqueId = Math.floor(Math.random() * 1000000);
      const userDataDir = path.join(
        process.cwd(),
        `browser_profiles/profile_no_proxy_${uniqueId}`
      );

      if (!fs.existsSync(path.dirname(userDataDir))) {
        fs.mkdirSync(path.dirname(userDataDir), { recursive: true });
      }

      const UndetectableBMS = new UndetectableBrowser(
        await puppeteer.launch({
          headless: false,
          executablePath: process.env.BRAVE_PATH!,
          userDataDir: userDataDir,
          args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-blink-features=AutomationControlled",
            //  `--proxy-server=${proxy.host}:${proxy.port}`,
          ],
        })
      );
      const browser = await UndetectableBMS.getBrowser();
      console.error(`Error creating proxy: ${error.message}`);
      console.log("Falling back to direct connection without proxy");
      return browser;
    }
  }

  private async checkKeywordRank(
    keyword: string,
    domain: string,
    proxy: {
      id: string;
      host: string;
      port: number;
      username?: string;
      password?: string;
    },
    location: string,
    language: string = "en",
    deviceType: "desktop" | "mobile" = "desktop"
  ): Promise<{
    result: RankResult;
    captchaStats: { solved: number; errors: number };
  }> {
    const searchUrl = this.buildGoogleSearchUrl(keyword, location, language);
    let browser: Browser | null = null;
    let page: Page | null = null;
    let captchaSolved = 0;
    let captchaErrors = 0;

    try {
      browser = await this.createBrowser(proxy);
      if (!browser) {
        throw new Error("Failed to create browser");
      }
      page = await browser.newPage();

      await page.authenticate({
        username: proxy.username!,
        password: proxy.password!,
      });
      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, "webdriver", { get: () => false });
        Object.defineProperty(navigator, "languages", {
          get: () => ["en-US", "en"],
        });
        Object.defineProperty(navigator, "platform", { get: () => "Win32" });
        Object.defineProperty(navigator, "vendor", {
          get: () => "Google Inc.",
        });
      });
      await this.randomDelay();
      console.log("URL:", searchUrl);
      // @ts-ignore
      await page.navigate(searchUrl);

      const { solved, errors, shouldRetryWithNewProxy } =
        await this.detectAndHandleCaptcha(page);
      captchaSolved = solved;
      captchaErrors = errors;
      if (shouldRetryWithNewProxy) {
        throw new Error(
          `CAPTCHA detected and couldn't be solved. Try with new proxy.`
        );
        // @ts-ignore
        return null;
      }

      await this.randomDelay();
      const results = await this.extractSearchResults(page);
      let rank = 0;
      let rankUrl = "null";

      for (let i = 0; i < results.length; i++) {
        const { url } = results[i]!;
        if (url && url.includes(domain)) {
          rank = i + 1;
          rankUrl = url;
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

        // Log the first few results to help with debugging
        if (results.length > 0) {
          console.log(`[DEBUG] First ${Math.min(5, results.length)} results:`);
          results.slice(0, 5).forEach((result, idx) => {
            console.log(`  ${idx + 1}. ${result.title} - ${result.url}`);
          });
        } else {
          console.log(`[WARNING] No search results found at all!`);
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
      throw new Error(`Failed to check rank: ${error.message}`);
    } finally {
      if (browser) {
        try {
          // Safely close all pages first
          const pages = await browser.pages().catch(() => []);
          for (const page of pages) {
            await page
              .close()
              .catch((err) =>
                console.warn(`Error closing page: ${err.message}`)
              );
          }

          // Then close the browser
          await browser
            .close()
            .catch((err) =>
              console.warn(`Error closing browser: ${err.message}`)
            );

          // Clean up browser profile directory if possible
          try {
            const profileDirMatch = /browser_profiles\/profile_\d+/.exec(
              browser?.process()?.spawnargs?.join(" ") || ""
            );
            if (profileDirMatch && profileDirMatch[0]) {
              const profileDir = path.join(process.cwd(), profileDirMatch[0]);
              if (fs.existsSync(profileDir)) {
                fs.rmSync(profileDir, { recursive: true, force: true });
              }
            }
          } catch (err: any) {
            console.warn(`Could not remove profile directory: ${err.message}`);
          }
        } catch (err: any) {
          console.warn(`Error during browser cleanup: ${err.message}`);
        }
      }
    }
  }
  private async randomDelay(): Promise<void> {
    const mean = CONFIG.BASE_DELAY_MS;
    const stdDev = CONFIG.BASE_DELAY_MS * 0.3;
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
    const delay = Math.max(200, mean + z0 * stdDev);
    await this.delay(delay);
  }

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private buildGoogleSearchUrl(
    keyword: string,
    location: string,
    language: string
  ): string {
    // TODO: Implement location and language
    const encodedKeyword = encodeURIComponent(keyword);
    let url = `https://www.google.com/search?q=${encodedKeyword}&hl=ar&num=${CONFIG.RESULTS_PER_PAGE}`;
    if (location) {
      url += `&gl=sa`;
    }
    return url;
  }

  private async extractSearchResults(
    page: any
  ): Promise<Array<{ title: string; url: string }>> {
    return page.evaluate((() => {
      const results: Array<{ title: string; url: string }> = [];

      const searchResultSelectors = [
        "div.g",
        "div.srKDX",
        "div[data-sokoban-feature]",
        "div.MjjYud div.A6K0A div.wHYlTd",
        "div.yuRUbf",
        "div.tF2Cxc",
      ];

      const combinedSelector = searchResultSelectors.join(", ");
      const searchResultElements = Array.from(
        document.querySelectorAll(combinedSelector)
      );

      for (const resultElement of searchResultElements) {
        const linkElement =
          resultElement.querySelector("a[jsname='UWckNb']") ||
          resultElement.querySelector("a[data-ved]") ||
          resultElement.querySelector("a");

        const titleElement =
          resultElement.querySelector("h3.LC20lb") ||
          resultElement.querySelector("h3") ||
          resultElement.querySelector(".DKV0Md");

        if (linkElement && titleElement) {
          const url = (linkElement as HTMLAnchorElement).href;
          const title = titleElement.textContent?.trim() || "";

          if (
            url &&
            !url.startsWith("https://webcache.googleusercontent.com") &&
            !url.startsWith("https://translate.google.com") &&
            !results.some((r) => r.url === url)
          ) {
            results.push({ title, url });
          }
        }
      }

      return results.filter(
        (result, index, self) =>
          index === self.findIndex((r) => r.url === result.url)
      );
    }) as any);
  }
  private async detectAndHandleCaptcha(page: Page): Promise<{
    solved: number;
    errors: number;
    shouldRetryWithNewProxy: boolean;
  }> {
    let solved = 0;
    let errors = 0;
    let shouldRetryWithNewProxy = false;

    try {
      const captchaSelectors = [
        // reCAPTCHA selectors
        "#recaptcha",
        // Image CAPTCHA selectors
        "form#captcha-form",
      ];

      // Check if CAPTCHA is present
      const captchaType = await page.evaluate((selectors: any) => {
        for (const selector of selectors) {
          if (selector.includes(":contains(")) {
            const [tagName, textContent] = selector.split(":contains(");
            const text = textContent.replace(/["')]/g, "");
            const elements = Array.from(document.querySelectorAll(tagName));
            for (const el of elements) {
              if (el.textContent && el.textContent.includes(text)) {
                return "text";
              }
            }
          } else {
            const element = document.querySelector(selector);
            if (element) {
              if (selector.includes("recaptcha")) return "recaptcha";
              if (
                selector.includes("captcha-form") ||
                (selector.includes("img") && selector.includes("captcha"))
              )
                return "image";
              return "recaptcha";
            }
          }
        }
        return null;
      }, captchaSelectors);

      if (!captchaType) {
        return { solved, errors, shouldRetryWithNewProxy: false };
      }

      console.log(
        `CAPTCHA detected (Type: ${captchaType})! Attempting to solve once...`
      );

      try {
        switch (captchaType) {
          case "recaptcha":
            // @ts-ignore
            await page.solveRecaptchas();
            solved++;
            break;

          case "image":
            errors++;
            break;

          default:
            console.log(`Unknown CAPTCHA type: ${captchaType}`);
            errors++;
            break;
        }

        // Try to find and click submit button
        const submitButton = await page.$(
          'button[type="submit"], input[type="submit"]'
        );
        if (submitButton) {
          await submitButton.click();
        }

        await page.waitForNavigation({
          timeout: CONFIG.BROWSER_TIMEOUT_MS,
          waitUntil: ["networkidle0", "domcontentloaded"],
        });

        await this.randomDelay();

        // Check if CAPTCHA is still present after our attempt
        const stillHasCaptcha = await page.evaluate((selectors) => {
          return selectors.some((selector) =>
            selector.includes(":contains(")
              ? document.body.textContent?.includes(
                  selector?.split(":contains(")[1]!.replace(/["')]/g, "")
                )
              : !!document.querySelector(selector)
          );
        }, captchaSelectors);

        if (stillHasCaptcha) {
          console.log(
            "CAPTCHA still present after solving attempt. Will retry with new proxy."
          );
          shouldRetryWithNewProxy = true;
        }
      } catch (error: any) {
        console.error(`Error solving ${captchaType} CAPTCHA:`, error);
        errors++;
        shouldRetryWithNewProxy = true;
      }

      return { solved, errors, shouldRetryWithNewProxy };
    } catch (error: any) {
      console.error(`Error handling CAPTCHA: ${error.message}`);
      errors++;
      return { solved, errors, shouldRetryWithNewProxy: true };
    }
  }
}
