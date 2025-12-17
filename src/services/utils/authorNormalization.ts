/**
 * Normalize an author name for comparison
 */
export function normalizeAuthorName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract last name from a full name
 */
export function extractLastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '';
  
  // Handle "Last, First" format
  if (parts[0].endsWith(',')) {
    return parts[0].replace(',', '').toLowerCase();
  }
  
  // Handle "LastName Initial" format like "Gutowska A" or "Gutowska A."
  // In this case, the *last* token is an initial, not a last name.
  const last = parts[parts.length - 1].replace(/\./g, '');
  const looksLikeInitial = last.length <= 2 && /^[a-zA-Z]+$/.test(last);
  if (looksLikeInitial && parts.length >= 2) {
    return parts[0].toLowerCase();
  }

  // Handle "First Initial LastName" like "A Gutowska" or "A. Gutowska"
  const first = parts[0].replace(/\./g, '');
  const firstLooksLikeInitial = first.length <= 2 && /^[a-zA-Z]+$/.test(first);
  if (firstLooksLikeInitial && parts.length >= 2) {
    return parts[parts.length - 1].toLowerCase();
  }

  // Default: assume last word is last name
  return parts[parts.length - 1].toLowerCase();
}

/**
 * Compare two author lists and return overlap score (0-1)
 */
export function compareAuthorLists(authors1: string[], authors2: string[]): number {
  if (authors1.length === 0 || authors2.length === 0) return 0;

  const lastNames1 = new Set(authors1.map(extractLastName));
  const lastNames2 = new Set(authors2.map(extractLastName));

  const intersection = [...lastNames1].filter(name => lastNames2.has(name));
  const minSize = Math.min(lastNames1.size, lastNames2.size);

  return intersection.length / minSize;
}

/**
 * Parse author string into array of author names
 */
export function parseAuthors(authorString: string): string[] {
  // Handle various separators
  const separators = ['; ', ', and ', ' and ', ', ', ';'];
  
  let authors = [authorString];
  
  for (const sep of separators) {
    authors = authors.flatMap(a => a.split(sep));
  }

  return authors
    .map(a => a.trim())
    .filter(a => a.length > 0 && !a.match(/^et\s*al\.?$/i));
}


