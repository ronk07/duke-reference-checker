/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Normalize a string for comparison (lowercase, remove punctuation, collapse whitespace)
 */
export function normalizeString(str: string): string {
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * More aggressive normalization for title matching
 */
export function normalizeTitle(str: string): string {
  return str
    .toLowerCase()
    // Remove common prefixes/suffixes
    .replace(/^(the|a|an)\s+/i, '')
    // Remove punctuation
    .replace(/[^\w\s]/g, ' ')
    // Remove extra whitespace
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculate similarity score between two strings (0-1) using Levenshtein
 */
export function stringSimilarity(a: string, b: string): number {
  const normalizedA = normalizeString(a);
  const normalizedB = normalizeString(b);

  if (normalizedA === normalizedB) return 1;
  if (normalizedA.length === 0 || normalizedB.length === 0) return 0;

  const distance = levenshteinDistance(normalizedA, normalizedB);
  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  
  return 1 - distance / maxLength;
}

/**
 * Calculate token-based similarity (better for titles with word reordering)
 */
export function tokenSimilarity(a: string, b: string): number {
  const tokensA = normalizeString(a).split(' ').filter(t => t.length > 2);
  const tokensB = normalizeString(b).split(' ').filter(t => t.length > 2);
  
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  
  let matchCount = 0;
  for (const tokenA of tokensA) {
    for (const tokenB of tokensB) {
      // Check for exact match or fuzzy match for longer words
      if (tokenA === tokenB) {
        matchCount++;
        break;
      } else if (tokenA.length > 4 && tokenB.length > 4) {
        const sim = stringSimilarity(tokenA, tokenB);
        if (sim > 0.8) {
          matchCount += sim;
          break;
        }
      }
    }
  }
  
  // Return ratio of matched tokens to total unique tokens
  const totalTokens = new Set([...tokensA, ...tokensB]).size;
  return matchCount / totalTokens;
}

/**
 * Combined similarity score - uses both Levenshtein and token-based
 */
export function combinedSimilarity(a: string, b: string): number {
  const levenshteinSim = stringSimilarity(a, b);
  const tokenSim = tokenSimilarity(a, b);
  
  // Use the higher of the two scores
  return Math.max(levenshteinSim, tokenSim);
}

/**
 * Title-specific similarity with better handling of academic titles
 */
export function titleSimilarity(a: string, b: string): number {
  // Normalize titles
  const normA = normalizeTitle(a);
  const normB = normalizeTitle(b);
  
  if (normA === normB) return 1;
  if (normA.length === 0 || normB.length === 0) return 0;
  
  // Check if one contains the other (handles truncated titles)
  if (normA.includes(normB) || normB.includes(normA)) {
    const shorter = Math.min(normA.length, normB.length);
    const longer = Math.max(normA.length, normB.length);
    return shorter / longer;
  }
  
  // Use combined similarity
  return combinedSimilarity(a, b);
}

/**
 * Check if one string contains another (normalized)
 */
export function containsNormalized(haystack: string, needle: string): boolean {
  return normalizeString(haystack).includes(normalizeString(needle));
}

/**
 * Calculate Jaccard similarity for word sets
 */
export function wordSetSimilarity(a: string, b: string): number {
  const wordsA = new Set(normalizeString(a).split(' ').filter(w => w.length > 2));
  const wordsB = new Set(normalizeString(b).split(' ').filter(w => w.length > 2));

  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);

  return intersection.size / union.size;
}
