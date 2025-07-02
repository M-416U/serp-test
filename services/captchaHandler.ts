import type { Page } from "playwright";
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

  public async detectAndHandleCaptcha(page: Page): Promise<CaptchaResult> {
    let solved = 0;
    let errors = 0;
    let shouldRetry = false;

    try {
      // Optional: Skip if recently solved
      // if (this.captchaSolvedRecently) {
      //   console.log("Captcha was solved recently, skipping additional solve attempts");
      //   return { solved, errors, shouldRetry: false };
      // }

      const captchaPresent = await this.detectCaptcha(page);

      if (!captchaPresent) {
        return { solved, errors, shouldRetry: false };
      }

      console.log(
        `CAPTCHA detected (Type: ${captchaPresent})! Attempting to solve...`
      );

      if (captchaPresent === "recaptcha") {
        const solveResult = await this.solveReCaptchaWith2Captcha(page);
        if (solveResult) {
          this.captchaSolvedRecently = true;
          setTimeout(() => {
            this.captchaSolvedRecently = false;
          }, 30000);
        }

        return {
          solved: solveResult ? 1 : 0,
          errors: solveResult ? 0 : 1,
          shouldRetry: !solveResult,
        };
      }

      if (captchaPresent === "image") {
        // Add image captcha solving logic here if needed
        console.log("Image captcha detected but not implemented");
        return { solved: 0, errors: 1, shouldRetry: false };
      }
    } catch (err: any) {
      console.error(`Error detecting CAPTCHA: ${err.message}`);
      errors++;
    }

    return { solved, errors, shouldRetry };
  }

  private async detectCaptcha(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        // Check for reCAPTCHA
        if (
          document.querySelector("#recaptcha") ||
          document.querySelector('iframe[src*="recaptcha"]') ||
          document.querySelector('iframe[src*="captcha"]') ||
          document.querySelector(".g-recaptcha") ||
          document.querySelector("div[data-sitekey]")
        ) {
          return "recaptcha";
        }

        // Check for image captcha
        if (
          document.querySelector("form#captcha-form") ||
          document.querySelector('img[src*="captcha"]') ||
          document.querySelector('input[name*="captcha"]')
        ) {
          return "image";
        }

        return null;
      });
    } catch (error: any) {
      console.warn(`Error detecting captcha: ${error.message}`);
      return null;
    }
  }

  private async solveReCaptchaWith2Captcha(page: Page): Promise<boolean> {
    try {
      console.log("Attempting to solve reCAPTCHA with 2Captcha...");

      const siteKey = await this.getCaptchaSiteKey(page);
      const dataS = await this.getCaptchaDataS(page);

      if (!siteKey) {
        console.log("Could not find reCAPTCHA site key");
        return false;
      }

      const pageUrl = page.url();
      console.log(
        `Found reCAPTCHA with site key: ${siteKey}, data-s: ${dataS?.slice(
          0,
          50
        )}`
      );

      // Solve with 2captcha
      const result = await this.solver.recaptcha(siteKey, pageUrl, {
        "data-s": dataS || "",
        enterprise: 1,
      });

      console.log("Received solution from 2Captcha");
      await this.injectCaptchaSolution(page, result.data);

      // Wait a bit for the solution to be processed
      await page.waitForTimeout(1000);

      // Try to submit the form if it exists
      try {
        await this.submitCaptchaForm(page);
      } catch (e) {
        console.log(
          "No form to submit or form submission failed, continuing..."
        );
      }

      // Check if captcha is still present
      await page.waitForTimeout(2000);
      const captchaStillPresent = await this.detectCaptcha(page);

      if (captchaStillPresent) {
        console.log("Captcha still present after submitting solution");
        return false;
      }

      await page.waitForTimeout(1000);
      return true;
    } catch (error: any) {
      console.error(`Error solving reCAPTCHA: ${error.message}`);
      return false;
    }
  }

  private async getCaptchaSiteKey(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        // Look for data-sitekey attribute
        const recaptchaDiv = document.querySelector(
          ".g-recaptcha[data-sitekey], div[data-sitekey]"
        );
        if (recaptchaDiv) {
          return recaptchaDiv.getAttribute("data-sitekey");
        }

        // Look for iframe and find closest div with data-sitekey
        const iframe = document.querySelector(
          'iframe[src*="google.com/recaptcha"]'
        );
        if (iframe) {
          const closestDiv = iframe.closest("div[data-sitekey]");
          if (closestDiv) {
            return closestDiv.getAttribute("data-sitekey");
          }
        }

        // Alternative search in all divs
        const allDivs = document.querySelectorAll("div[data-sitekey]");
        if (allDivs.length > 0) {
          return allDivs?.[0]?.getAttribute("data-sitekey") || null;
        }

        return null;
      });
    } catch (error: any) {
      console.warn(`Error getting site key: ${error.message}`);
      return null;
    }
  }

  private async getCaptchaDataS(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        // Look for data-s attribute
        const recaptchaDiv = document.querySelector(
          ".g-recaptcha[data-s], div[data-s]"
        );
        if (recaptchaDiv) {
          return recaptchaDiv.getAttribute("data-s");
        }

        // Look for iframe and find closest div with data-s
        const iframe = document.querySelector(
          'iframe[src*="google.com/recaptcha"]'
        );
        if (iframe) {
          const closestDiv = iframe.closest("div[data-s]");
          if (closestDiv) {
            return closestDiv.getAttribute("data-s");
          }
        }

        return null;
      });
    } catch (error: any) {
      console.warn(`Error getting data-s: ${error.message}`);
      return null;
    }
  }

  private async injectCaptchaSolution(
    page: Page,
    solution: string
  ): Promise<void> {
    try {
      await page.evaluate((sol) => {
        // Set the response in the main textarea
        const responseField = document.getElementById(
          "g-recaptcha-response"
        ) as HTMLTextAreaElement;
        if (responseField) {
          responseField.value = sol;
          responseField.innerHTML = sol;
          responseField.style.display = "block";

          // Trigger events
          responseField.dispatchEvent(new Event("input", { bubbles: true }));
          responseField.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // For invisible recaptcha (alternative ID)
        const invisibleField = document.getElementById(
          "g-recaptcha-response-100000"
        ) as HTMLTextAreaElement;
        if (invisibleField) {
          invisibleField.value = sol;
          invisibleField.innerHTML = sol;
        }

        // Try to find any other recaptcha response fields
        const allResponseFields = document.querySelectorAll(
          'textarea[name="g-recaptcha-response"]'
        );
        allResponseFields.forEach((field: any) => {
          field.value = sol;
          field.innerHTML = sol;
          field.dispatchEvent(new Event("input", { bubbles: true }));
          field.dispatchEvent(new Event("change", { bubbles: true }));
        });

        // Trigger callback if available
        if (
          (window as any).grecaptcha &&
          (window as any).grecaptcha.getResponse
        ) {
          try {
            (window as any).grecaptcha.execute();
          } catch (e) {
            console.log("Could not execute grecaptcha callback");
          }
        }
      }, solution);
    } catch (error: any) {
      console.warn(`Error injecting captcha solution: ${error.message}`);
    }
  }

  private async submitCaptchaForm(page: Page): Promise<boolean> {
    try {
      // Try to find and submit captcha form
      const captchaForm = page.locator("form#captcha-form").first();
      if (await captchaForm.isVisible({ timeout: 2000 })) {
        await captchaForm.evaluate((form) =>
          (form as HTMLFormElement).submit()
        );
        return true;
      }

      // Try to find submit button
      const submitSelectors = [
        'input[type="submit"]',
        'button[type="submit"]',
        'button:has-text("Submit")',
        'button:has-text("Verify")',
        'button:has-text("Continue")',
        ".captcha-submit",
        "#captcha-submit",
      ];

      for (const selector of submitSelectors) {
        try {
          const button = page.locator(selector).first();
          if (await button.isVisible({ timeout: 1000 })) {
            await button.click();
            return true;
          }
        } catch (e) {
          // Continue to next selector
        }
      }

      // Try to find any form and submit it
      const anyForm = page.locator("form").first();
      if (await anyForm.isVisible({ timeout: 2000 })) {
        await anyForm.evaluate((form) => (form as HTMLFormElement).submit());
        return true;
      }

      return false;
    } catch (error: any) {
      console.warn(`Error submitting captcha form: ${error.message}`);
      return false;
    }
  }

  // Utility method to wait for captcha to disappear
  public async waitForCaptchaToDisappear(
    page: Page,
    timeoutMs: number = 30000
  ): Promise<boolean> {
    try {
      const startTime = Date.now();

      while (Date.now() - startTime < timeoutMs) {
        const captchaPresent = await this.detectCaptcha(page);
        if (!captchaPresent) {
          return true;
        }
        await page.waitForTimeout(1000);
      }

      return false;
    } catch (error: any) {
      console.warn(`Error waiting for captcha to disappear: ${error.message}`);
      return false;
    }
  }

  // Method to handle multiple captcha attempts
  public async solveCaptchaWithRetries(
    page: Page,
    maxRetries: number = 3
  ): Promise<CaptchaResult> {
    let totalSolved = 0;
    let totalErrors = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.log(`Captcha solve attempt ${attempt}/${maxRetries}`);

      const result = await this.detectAndHandleCaptcha(page);
      totalSolved += result.solved;
      totalErrors += result.errors;

      if (result.solved > 0) {
        console.log(`Captcha solved successfully on attempt ${attempt}`);
        return { solved: totalSolved, errors: totalErrors, shouldRetry: false };
      }

      if (!result.shouldRetry) {
        break;
      }

      // Wait before retry
      if (attempt < maxRetries) {
        console.log(`Waiting before retry...`);
        await page.waitForTimeout(2000);
      }
    }

    return { solved: totalSolved, errors: totalErrors, shouldRetry: false };
  }
}
