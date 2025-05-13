/**
 * Type definitions for the SEO Rank Tracker application
 */

/**
 * Data structure for rank checking jobs
 */
export interface RankJobData {
  /**
   * Keyword to check rank for
   */
  keyword: string;

  /**
   * Domain to find in search results
   */
  domain: string;

  /**
   * Location to target search results (country, city, etc.)
   */
  location?: string;

  /**
   * Language for search results
   */
  language?: string;

  /**
   * Device type to emulate
   */
  deviceType?: "desktop" | "mobile";
}

/**
 * Result of a rank checking operation
 */
export interface RankResult {
  /**
   * Keyword that was checked
   */
  keyword: string;

  /**
   * Domain that was searched for
   */
  domain: string;

  /**
   * Position in search results (null if not found)
   */
  rank: number | null;

  /**
   * URL that was found in search results
   */
  url: string | null;

  /**
   * Timestamp when check was performed
   */
  timestamp: Date;

  /**
   * Location that was targeted
   */
  location?: string;

  /**
   * Language that was used
   */
  language?: string;

  /**
   * Device type that was emulated
   */
  deviceType?: "desktop" | "mobile";

  /**
   * Error message if check failed
   */
  error: string | null;
}

/**
 * Keywords and domains to track
 */
export interface KeywordTarget {
  /**
   * Unique identifier
   */
  id: string;

  /**
   * Keyword to track
   */
  keyword: string;

  /**
   * Domain to track for this keyword
   */
  domain: string;

  /**
   * Priority level (higher numbers = higher priority)
   */
  priority?: number;

  /**
   * Location to target for this keyword
   */
  location?: string;

  /**
   * Language to use for this keyword
   */
  language?: string;

  /**
   * Device type to check on
   */
  deviceType?: "desktop" | "mobile";

  /**
   * Tags for organization
   */
  tags?: string[];

  /**
   * When this target was created
   */
  createdAt: Date;

  /**
   * When this target was last updated
   */
  updatedAt: Date;

  /**
   * Whether this target is active
   */
  isActive: boolean;
}

/**
 * Historical rank data for a keyword
 */
export interface RankHistory {
  /**
   * Keyword that was checked
   */
  keyword: string;

  /**
   * Domain that was searched for
   */
  domain: string;

  /**
   * Position in search results (null if not found)
   */
  rank: number | null;

  /**
   * URL that was found
   */
  url: string | null;

  /**
   * When the check was performed
   */
  checkedAt: Date;

  /**
   * Location that was targeted
   */
  location?: string;

  /**
   * Language that was used
   */
  language?: string;

  /**
   * Device type that was emulated
   */
  deviceType?: "desktop" | "mobile";
}

/**
 * Search volume data for a keyword
 */
export interface SearchVolumeData {
  /**
   * Keyword that volume data is for
   */
  keyword: string;

  /**
   * Monthly search volume
   */
  volume: number;

  /**
   * Keyword difficulty score (0-100)
   */
  difficulty?: number;

  /**
   * CPC (Cost Per Click) value
   */
  cpc?: number;

  /**
   * Competition level (0-1)
   */
  competition?: number;

  /**
   * When this data was last updated
   */
  updatedAt: Date;

  /**
   * Location this data applies to
   */
  location?: string;
}
