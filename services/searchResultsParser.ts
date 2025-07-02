import type { Page } from "playwright";

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  position?: number;
}

export class SearchResultsParser {
  private readonly defaultTimeout = 30000;

  public async extractSearchResults(page: Page): Promise<Array<SearchResult>> {
    try {
      await this.waitForSearchResults(page);

      const results = await page.evaluate(() => {
        const results: Array<{
          title: string;
          url: string;
          snippet?: string;
          position?: number;
        }> = [];

        const searchResultSelectors = [
          "div.g",
          "div.srKDX",
          "div[data-sokoban-feature]",
          "div.MjjYud div.A6K0A div.wHYlTd",
          "div.yuRUbf",
          "div.tF2Cxc",
          "div.kvH3mc",
          "div.hlcw0c",
          "div.IsZvec",
        ];

        const combinedSelector = searchResultSelectors.join(", ");
        const searchResultElements = Array.from(
          document.querySelectorAll(combinedSelector)
        );

        for (let i = 0; i < searchResultElements.length; i++) {
          const resultElement = searchResultElements[i];
          if (!resultElement) {
            continue;
          }

          const linkElement =
            resultElement.querySelector("a[jsname='UWckNb']") ||
            resultElement.querySelector("a[data-ved]") ||
            resultElement.querySelector("h3 a") ||
            resultElement.querySelector("a[href]") ||
            resultElement.querySelector("a");

          const titleElement =
            resultElement.querySelector("h3.LC20lb") ||
            resultElement.querySelector("h3.DKV0Md") ||
            resultElement.querySelector("h3") ||
            resultElement.querySelector(".DKV0Md") ||
            resultElement.querySelector("[role='heading']") ||
            linkElement?.querySelector("h3");

          const snippetElement =
            resultElement.querySelector(".VwiC3b") ||
            resultElement.querySelector(".s3v9rd") ||
            resultElement.querySelector(".st") ||
            resultElement.querySelector(".IsZvec .VwiC3b") ||
            resultElement.querySelector("span[data-ved]");

          if (linkElement && titleElement) {
            const url = (linkElement as HTMLAnchorElement).href;
            const title = titleElement.textContent?.trim() || "";
            const snippet = snippetElement?.textContent?.trim() || "";

            if (
              url &&
              title &&
              !url.startsWith("https://webcache.googleusercontent.com") &&
              !url.startsWith("https://translate.google.com") &&
              !url.startsWith("javascript:") &&
              !url.includes("/search?") &&
              !results.some((r) => r.url === url)
            ) {
              results.push({
                title,
                url,
                snippet: snippet || undefined,
                position: results.length + 1,
              });
            }
          }
        }

        return results.filter(
          (result, index, self) =>
            index === self.findIndex((r) => r.url === result.url)
        );
      });

      console.log(`Extracted ${results.length} search results`);
      return results;
    } catch (error: any) {
      console.error(`Error extracting search results: ${error.message}`);
      return [];
    }
  }

  private async waitForSearchResults(page: Page): Promise<void> {
    try {
      await page.waitForSelector(
        "div.g, div.yuRUbf, div.tF2Cxc, div.MjjYud, div.kvH3mc",
        {
          timeout: this.defaultTimeout,
          state: "visible",
        }
      );
    } catch (error) {
      const hasResults = await page.evaluate(() => {
        return (
          document.querySelector("#search") !== null ||
          document.querySelector("#rso") !== null ||
          document.querySelector(".srKDX") !== null
        );
      });

      if (!hasResults) {
        throw new Error("Search results page not detected");
      }
    }
  }

  public async extractSearchResultsWithOptions(
    page: Page,
    options: {
      maxResults?: number;
      includeDomains?: string[];
      excludeDomains?: string[];
      minTitleLength?: number;
    } = {}
  ): Promise<Array<SearchResult>> {
    const allResults = await this.extractSearchResults(page);
    let filteredResults = allResults;

    if (options.includeDomains?.length) {
      filteredResults = filteredResults.filter((result) =>
        options.includeDomains!.some((domain) => result.url.includes(domain))
      );
    }

    if (options.excludeDomains?.length) {
      filteredResults = filteredResults.filter(
        (result) =>
          !options.excludeDomains!.some((domain) => result.url.includes(domain))
      );
    }

    if (options.minTitleLength) {
      filteredResults = filteredResults.filter(
        (result) => result.title.length >= options.minTitleLength!
      );
    }

    if (options.maxResults) {
      filteredResults = filteredResults.slice(0, options.maxResults);
    }

    return filteredResults;
  }

  public async isOnSearchResultsPage(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const isGoogle = window.location.hostname.includes("google");
        const hasSearchParam = window.location.search.includes("q=");
        const hasResultsContainer =
          document.querySelector("#search, #rso, .srKDX") !== null;

        return isGoogle && hasSearchParam && hasResultsContainer;
      });
    } catch (error) {
      return false;
    }
  }

  public async getCurrentSearchQuery(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const query = urlParams.get("q");
        if (query) return query;

        const searchInput = document.querySelector(
          'input[name="q"]'
        ) as HTMLInputElement;
        return searchInput?.value || null;
      });
    } catch (error) {
      return null;
    }
  }

  public async getResultCount(page: Page): Promise<string | null> {
    try {
      return await page.evaluate(() => {
        const resultStats = document.querySelector("#result-stats");
        return resultStats?.textContent?.trim() || null;
      });
    } catch (error) {
      return null;
    }
  }

  public async hasNextPage(page: Page): Promise<boolean> {
    try {
      return await page.evaluate(() => {
        const nextButton = document.querySelector(
          'a#pnnext, a[aria-label="Next page"]'
        );
        return nextButton !== null;
      });
    } catch (error) {
      return false;
    }
  }

  public async goToNextPage(page: Page): Promise<boolean> {
    try {
      const nextButton = page
        .locator('a#pnnext, a[aria-label="Next page"]')
        .first();

      if (await nextButton.isVisible({ timeout: 5000 })) {
        await nextButton.click();
        await this.waitForSearchResults(page);
        return true;
      }

      return false;
    } catch (error: any) {
      console.warn(`Error going to next page: ${error.message}`);
      return false;
    }
  }

  public async extractAllPagesResults(
    page: Page,
    maxPages: number = 3
  ): Promise<Array<SearchResult>> {
    const allResults: SearchResult[] = [];
    let currentPage = 1;

    try {
      while (currentPage <= maxPages) {
        console.log(`Extracting results from page ${currentPage}`);

        const pageResults = await this.extractSearchResults(page);

        const resultsWithPage = pageResults.map((result) => ({
          ...result,
          position: allResults.length + (result.position || 1),
        }));

        allResults.push(...resultsWithPage);

        if (currentPage >= maxPages) break;

        const hasNext = await this.goToNextPage(page);
        if (!hasNext) {
          console.log("No more pages available");
          break;
        }

        currentPage++;

        await page.waitForTimeout(2000);
      }
    } catch (error: any) {
      console.error(`Error extracting multi-page results: ${error.message}`);
    }

    return allResults;
  }
}
