// DOI pattern: 10.xxxx/xxxxx
const DOI_PATTERN = /10\.\d{4,}\/[^\s"'<>\]]+/gi;

// ArXiv pattern
const ARXIV_PATTERN = /arxiv[:\s]*(\d{4}\.\d{4,5}(?:v\d+)?)/gi;

// URL patterns
const URL_PATTERN = /https?:\/\/[^\s"'<>\]]+/gi;

/**
 * Extract DOI from text
 */
export function extractDOI(text: string): string | null {
  const matches = text.match(DOI_PATTERN);
  if (matches && matches.length > 0) {
    // Clean up the DOI (remove trailing punctuation)
    return matches[0].replace(/[.,;:)\]]+$/, '');
  }
  return null;
}

/**
 * Extract ArXiv ID from text
 */
export function extractArxivId(text: string): string | null {
  const match = ARXIV_PATTERN.exec(text);
  if (match) {
    return match[1];
  }
  return null;
}

/**
 * Extract all URLs from text
 */
export function extractURLs(text: string): string[] {
  const matches = text.match(URL_PATTERN);
  if (matches) {
    return matches.map(url => url.replace(/[.,;:)\]]+$/, ''));
  }
  return [];
}

/**
 * Normalize a DOI for comparison
 */
export function normalizeDOI(doi: string): string {
  return doi.toLowerCase().replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
}

/**
 * Check if two DOIs match
 */
export function doiMatch(doi1: string | null, doi2: string | null): boolean {
  if (!doi1 || !doi2) return false;
  return normalizeDOI(doi1) === normalizeDOI(doi2);
}

/**
 * Build a DOI URL from a DOI
 */
export function buildDOIUrl(doi: string): string {
  const normalized = normalizeDOI(doi);
  return `https://doi.org/${normalized}`;
}


