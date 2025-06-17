export const CONFIG = {
  BASE_DELAY_MS: 2000,
  MAX_PAGES_TO_CHECK: 1,
  RESULTS_PER_PAGE: 100,
  MAX_RETRIES: Infinity,
  USER_AGENTS: [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/119.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  ],
  BROWSER_TIMEOUT_MS: 600000, // 10 minutes
  RETRY_DELAY_MS: 5000,
  VIEWPORT_WIDTHS: [1366, 1440, 1536, 1920, 2560],
  VIEWPORT_HEIGHTS: [768, 900, 864, 1080, 1440],
};
