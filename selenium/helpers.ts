import { CONFIG } from "./config";

export async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function randomDelay(): Promise<void> {
  const mean = CONFIG.BASE_DELAY_MS;
  const stdDev = CONFIG.BASE_DELAY_MS * 0.3;
  const u1 = Math.random();
  const u2 = Math.random();
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  const delayTime = Math.max(200, mean + z0 * stdDev);
  await delay(delayTime);
}

export function buildGoogleSearchUrl(
  keyword: string,
  location: string,
  language: string
): string {
  const encodedKeyword = encodeURIComponent(keyword);
  let url = `https://www.google.com/search?q=${encodedKeyword}&hl=ar&num=${CONFIG.RESULTS_PER_PAGE}`;
  if (location) {
    url += `&gl=sa`;
  }
  return url;
}
