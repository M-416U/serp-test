import { WebDriver, Builder, Capabilities, logging } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome";
import { Options } from "selenium-webdriver/chrome";
import * as fs from "fs";
import * as path from "path";
import { randomBytes } from "crypto";
import { CONFIG } from "./config";
require("chromedriver-undetected");
export class DriverManager {
  private driverPool: Map<string, WebDriver> = new Map();
  private maxDriverAge: number = 300000;
  private driverCreationTimes: Map<string, number> = new Map();

  public async getDriver(proxyConfig: any = null): Promise<WebDriver> {
    try {
      return await this.createDriver(proxyConfig);
    } catch (error: any) {
      console.error(`Error getting driver: ${error.message}`);
      throw new Error(`Failed to get driver: ${error.message}`);
    }
  }

  public async closeDriver(driverKey: string): Promise<void> {
    const driver = this.driverPool.get(driverKey);
    if (driver) {
      try {
        await driver.quit();
        this.driverPool.delete(driverKey);
        this.driverCreationTimes.delete(driverKey);

        try {
          const profileDirMatch = /selenium_profiles\/profile_[a-f0-9]+/.exec(
            driverKey
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
        console.warn(`Error during driver cleanup: ${err.message}`);
      }
    }
  }

  private getRandomUserAgent(): string {
    const index = Math.floor(Math.random() * CONFIG.USER_AGENTS.length);
    return CONFIG.USER_AGENTS[index] || "";
  }

  private async createDriver(proxyConfig: any = null): Promise<WebDriver> {
    const driverKey = proxyConfig
      ? `proxy_${proxyConfig.id}`
      : `default_driver`;
    const existingDriver = this.driverPool.get(driverKey);
    const creationTime = this.driverCreationTimes.get(driverKey) || 0;
    const driverAge = Date.now() - creationTime;

    if (existingDriver && driverAge < this.maxDriverAge) {
      try {
        await existingDriver.getTitle();
        return existingDriver;
      } catch (err) {
        console.log(`Driver is no longer usable, creating new one`);
        await this.closeDriver(driverKey);
      }
    } else if (existingDriver) {
      console.log(
        `Driver is too old (${Math.round(driverAge / 1000)}s), creating new one`
      );
      await this.closeDriver(driverKey);
    }

    try {
      const uniqueId = randomBytes(8).toString("hex");
      const userDataDir = path.join(
        process.cwd(),
        `selenium_profiles/profile_${uniqueId}`
      );

      if (!fs.existsSync(path.dirname(userDataDir))) {
        fs.mkdirSync(path.dirname(userDataDir), { recursive: true });
      }

      // Set up Chrome options
      const options = new Options();
      options.addArguments(
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--disable-infobars",
        "--start-maximized",
        "--headless=new",
        "--log-level=3",
        "--silent"
      );
      const loggingPrefs = new logging.Preferences();
      loggingPrefs.setLevel(logging.Type.BROWSER, logging.Level.OFF);
      loggingPrefs.setLevel(logging.Type.DRIVER, logging.Level.OFF);
      loggingPrefs.setLevel(logging.Type.CLIENT, logging.Level.OFF);
      loggingPrefs.setLevel(logging.Type.SERVER, logging.Level.OFF);

      const capabilities = Capabilities.chrome();
      capabilities.set("goog:loggingPrefs", loggingPrefs);

      options.addArguments(`--user-agent=${this.getRandomUserAgent()}`);
      options.addArguments(`--user-data-dir=${userDataDir}`);

      if (proxyConfig) {
        if (
          proxyConfig.host &&
          proxyConfig.port &&
          proxyConfig.username &&
          proxyConfig.password
        ) {
          const proxyUrl = `${proxyConfig.host}:${proxyConfig.port}`;
          options.addArguments(`--user-data-dir=${userDataDir}`);
          options.addArguments(`--proxy-server=${proxyUrl}`);

          try {
          } catch (error: any) {
            console.error(`Error creating proxy extension: ${error.message}`);
          }
        } else {
          console.warn("Invalid proxy configuration, continuing without proxy");
        }
      }

      const serviceBuilder = new chrome.ServiceBuilder();

      const driver = await new Builder()
        .forBrowser("chrome")
        .setChromeOptions(options)
        .withCapabilities(capabilities)
        .setChromeService(serviceBuilder)
        .build();

      await driver.manage().setTimeouts({
        script: CONFIG.BROWSER_TIMEOUT_MS,
        pageLoad: CONFIG.BROWSER_TIMEOUT_MS,
        implicit: 10000,
      });

      this.driverPool.set(driverKey, driver);
      this.driverCreationTimes.set(driverKey, Date.now());

      await this.addAntiDetectionMeasures(driver);

      return driver;
    } catch (error: any) {
      console.error(`Error creating driver: ${error.message}`);
      throw new Error(`Failed to create driver: ${error.message}`);
    }
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
}
