import { WebDriver, By, until } from "selenium-webdriver";
import { Solver } from "2captcha";

export interface CaptchaResult {
  solved: number;
  errors: number;
  shouldRetry: boolean;
}

export class CaptchaHandler {
  private solver: Solver;
  private apiKey: string;
  private timeout: number;
  private captchaSolvedRecently: boolean = false;

  constructor(apiKey: string, timeout: number = 120000) {
    this.apiKey = apiKey;
    this.timeout = timeout;
    this.solver = new Solver(this.apiKey);
  }

  public async detectAndHandleCaptcha(
    driver: WebDriver
  ): Promise<CaptchaResult> {
    let solved = 0;
    let errors = 0;
    let shouldRetry = false;

    try {
      // if (this.captchaSolvedRecently) {
      //   console.log("Captcha was solved recently, skipping additional solve attempts");
      //   return { solved, errors, shouldRetry: false };
      // }

      const captchaPresent = await this.detectCaptcha(driver);

      if (!captchaPresent) {
        return { solved, errors, shouldRetry: false };
      }

      console.log(
        `CAPTCHA detected (Type: ${captchaPresent})! Attempting to solve...`
      );

      if (captchaPresent === "recaptcha") {
        const solved = await this.solveReCaptchaWith2Captcha(driver);
        if (solved) {
          this.captchaSolvedRecently = true;
          setTimeout(() => {
            this.captchaSolvedRecently = false;
          }, 30000);
        }

        return {
          solved: solved ? 1 : 0,
          errors: solved ? 0 : 1,
          shouldRetry: !solved,
        };
      }
    } catch (err) {
      console.error(`Error detecting CAPTCHA: ${err}`);
      errors++;
    }

    return { solved, errors, shouldRetry };
  }

  private async detectCaptcha(driver: WebDriver): Promise<string | null> {
    return await driver.executeScript(() => {
      if (
        document.querySelector("#recaptcha") ||
        document.querySelector('iframe[src*="recaptcha"]') ||
        document.querySelector('iframe[src*="captcha"]')
      ) {
        return "recaptcha";
      }

      if (
        document.querySelector("form#captcha-form") ||
        document.querySelector('img[src*="captcha"]')
      ) {
        return "image";
      }

      return null;
    });
  }

  private async solveReCaptchaWith2Captcha(
    driver: WebDriver
  ): Promise<boolean> {
    try {
      console.log("Attempting to solve reCAPTCHA with 2Captcha...");

      const siteKey = await this.getCaptchaSiteKey(driver);
      const dataS = await this.getCaptchaDataS(driver);

      if (!siteKey) {
        console.log("Could not find reCAPTCHA site key");
        return false;
      }

      const pageUrl = await driver.getCurrentUrl();
      console.log(
        `Found reCAPTCHA with site key: ${siteKey}, data-s: ${dataS?.slice(
          0,
          50
        )}`
      );

      const result = await this.solver.recaptcha(siteKey, pageUrl, {
        "data-s": dataS || "",
        enterprise: 1,
      });

      console.log(`Received solution from 2Captcha`);
      await this.injectCaptchaSolution(driver, result.data);

      await driver.sleep(1000);
      try {
        await this.submitCaptchaForm(driver);
      } catch (e) {
        console.log("No form to submit, continuing...");
      }
      const captchaPresent = await this.detectCaptcha(driver);
      if (captchaPresent) {
        console.log("Captcha still present after submitting solution");
        return false;
      }
      await driver.sleep(3000);
      return true;
    } catch (error) {
      console.error(`Error solving reCAPTCHA: ${error}`);
      return false;
    }
  }

  private async getCaptchaSiteKey(driver: WebDriver): Promise<string | null> {
    return await driver.executeScript<string | null>(() => {
      const recaptchaDiv = document.querySelector(
        ".g-recaptcha[data-sitekey], div[data-sitekey]"
      );
      if (recaptchaDiv) return recaptchaDiv.getAttribute("data-sitekey");

      const iframe = document.querySelector(
        'iframe[src*="google.com/recaptcha"]'
      );
      if (iframe) {
        const closestDiv = iframe.closest("div[data-sitekey]");
        return closestDiv ? closestDiv.getAttribute("data-sitekey") : null;
      }

      return null;
    });
  }

  private async getCaptchaDataS(driver: WebDriver): Promise<string | null> {
    return await driver.executeScript<string | null>(() => {
      const recaptchaDiv = document.querySelector(
        ".g-recaptcha[data-s], div[data-s]"
      );
      if (recaptchaDiv) return recaptchaDiv.getAttribute("data-s");

      const iframe = document.querySelector(
        'iframe[src*="google.com/recaptcha"]'
      );
      if (iframe) {
        const closestDiv = iframe.closest("div[data-s]");
        return closestDiv ? closestDiv.getAttribute("data-s") : null;
      }

      return null;
    });
  }

  private async injectCaptchaSolution(
    driver: WebDriver,
    solution: string
  ): Promise<void> {
    await driver.executeScript(`
      // Set the response in the textarea
      const responseField = document.getElementById('g-recaptcha-response');
      if (responseField) {
        responseField.innerHTML = "${solution}";
        responseField.style.display = 'block'; // Make sure it's visible
        responseField.dispatchEvent(new Event('change', { bubbles: true }));
      }
      
      // For invisible recaptcha
      const invisibleField = document.getElementById('g-recaptcha-response-100000');
      if (invisibleField) {
        invisibleField.innerHTML = "${solution}";
      }
    `);
  }

  private async submitCaptchaForm(driver: WebDriver): Promise<boolean> {
    try {
      const formLocator = By.css("form#captcha-form");
      const form = await driver.wait(until.elementLocated(formLocator), 5000);
      form.submit();
      return true;
    } catch (error) {
      console.error(`Error submitting captcha form: ${error}`);
      return false;
    }
  }
}
