import { WebDriver, By, until } from "selenium-webdriver";

export interface SearchResult {
  title: string;
  url: string;
}

export class SearchResultsParser {
  public async extractSearchResults(
    driver: WebDriver
  ): Promise<Array<SearchResult>> {
    // Wait for search results to load
    await driver.wait(
      until.elementLocated(By.css("div.g, div.yuRUbf, div.tF2Cxc")),
      30000,
      "Search results not found"
    );

    // Extract results using JavaScript
    return driver.executeScript(() => {
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
    });
  }
}
