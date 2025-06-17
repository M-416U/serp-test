import * as fs from "fs";
import * as path from "path";
import { By, until, WebDriver } from "selenium-webdriver";
import { DriverManager } from "./selenium/driverManager";
import { CaptchaHandler } from "./selenium/captchaHandler";
import { SearchResultsParser } from "./selenium/searchResultsParser";
import type { CaptchaStats, RankJobData, RankResult } from "./types";
import { CONFIG } from "./selenium/config";
import { buildGoogleSearchUrl, delay, randomDelay } from "./selenium/helpers";
import ProxyManager from "./proxyManager";

export class SeleniumRankTracker {
  private statsFile: string;
  private driverManager: DriverManager;
  private captchaHandler: CaptchaHandler;
  private searchResultsParser: SearchResultsParser;
  private proxyManager: ProxyManager | null;

  constructor(proxyManager?: ProxyManager) {
    this.statsFile = path.join(process.cwd(), "selenium_stats.csv");
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
    let driver: WebDriver | null = null;
    let captchaSolved = 0;
    let captchaErrors = 0;

    try {
      // Make sure to pass the proxyConfig to getDriver
      driver = await this.driverManager.getDriver(proxyConfig);
      if (!driver) {
        throw new Error("Failed to create driver");
      }

      await randomDelay();
      console.log("URL:", searchUrl);

      await driver.get(searchUrl);

      await driver.wait(until.elementLocated(By.css("body")), 30000);

      const { solved, errors, shouldRetry } =
        await this.captchaHandler.detectAndHandleCaptcha(driver);
      captchaSolved = solved;
      captchaErrors = errors;

      if (shouldRetry) {
        throw new Error(`CAPTCHA detected and couldn't be solved. Retrying.`);
      }

      const results = await this.searchResultsParser.extractSearchResults(
        driver
      );
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
      if (driver) {
        try {
          await this.driverManager.closeDriver(
            proxyConfig ? `proxy_${proxyConfig.id}` : "default_driver"
          );
        } catch (error) {
          console.error("Error during driver cleanup:", error);
        }
      }
    }
  }
}
