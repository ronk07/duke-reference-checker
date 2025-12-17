import type { Reference, ValidationSource, RetrievedReferenceData } from '../../types';
import { titleSimilarity } from '../utils/stringMatching';

const CROSSREF_API = 'https://api.crossref.org/works';
const POLITE_EMAIL = 'refchecker@example.com';

interface CrossRefWork {
  DOI: string;
  title: string[];
  author?: { given?: string; family: string }[];
  'published-print'?: { 'date-parts': number[][] };
  'published-online'?: { 'date-parts': number[][] };
  issued?: { 'date-parts': number[][] };
  'container-title'?: string[];
}

/**
 * Validate a reference using CrossRef API
 */
export async function validateWithCrossRef(reference: Reference): Promise<ValidationSource> {
  const source: ValidationSource = {
    name: 'crossref',
    found: false,
    matchScore: 0,
    retrievedData: null,
    errors: [],
  };
  
  try {
    let work: CrossRefWork | null = null;
    
    // If DOI is present, try direct lookup first (most reliable)
    if (reference.doi) {
      console.log('CrossRef: Looking up by DOI:', reference.doi);
      work = await lookupByDOI(reference.doi);
      if (work) {
        console.log('CrossRef: Found by DOI');
      }
    }
    
    // If no DOI or lookup failed, search by title
    if (!work && reference.title) {
      console.log('CrossRef: Searching by title:', reference.title);
      work = await searchByTitle(reference.title, reference.authors);
    }
    
    if (!work) {
      source.errors.push('Reference not found in CrossRef');
      return source;
    }
    
    // Extract data from CrossRef response
    const retrievedData = extractCrossRefData(work);
    source.retrievedData = retrievedData;
    source.found = true;
    
    // Calculate match score
    source.matchScore = calculateMatchScore(reference, retrievedData);
    console.log('CrossRef: Match score:', source.matchScore);
    
  } catch (error) {
    console.error('CrossRef API error:', error);
    source.errors.push(`CrossRef API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  return source;
}

async function lookupByDOI(doi: string): Promise<CrossRefWork | null> {
  const normalizedDOI = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
  const url = `${CROSSREF_API}/${encodeURIComponent(normalizedDOI)}?mailto=${POLITE_EMAIL}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    return data.message;
  } catch (e) {
    console.error('CrossRef DOI lookup failed:', e);
    return null;
  }
}

async function searchByTitle(title: string, authors: string[] = []): Promise<CrossRefWork | null> {
  // Build a more effective search query
  // Use bibliographic query which searches across title, author, etc.
  let query = title;
  
  // Add first author's last name to improve search accuracy
  if (authors.length > 0) {
    const firstAuthor = authors[0];
    const lastName = firstAuthor.split(' ').pop() || firstAuthor;
    query = `${title} ${lastName}`;
  }
  
  const encodedQuery = encodeURIComponent(query);
  const url = `${CROSSREF_API}?query.bibliographic=${encodedQuery}&rows=5&mailto=${POLITE_EMAIL}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const items = data.message?.items || [];
    
    if (items.length === 0) {
      console.log('CrossRef: No results found');
      return null;
    }
    
    console.log('CrossRef: Found', items.length, 'candidates');
    
    // Find best matching title
    let bestMatch: CrossRefWork | null = null;
    let bestScore = 0;
    
    for (const item of items) {
      const itemTitle = item.title?.[0] || '';
      const score = titleSimilarity(title, itemTitle);
      
      console.log('CrossRef candidate:', itemTitle, 'score:', score);
      
      // Accept matches above 60% (lower threshold for search)
      if (score > bestScore && score > 0.6) {
        bestScore = score;
        bestMatch = item;
      }
    }
    
    return bestMatch;
  } catch (e) {
    console.error('CrossRef search failed:', e);
    return null;
  }
}

function extractCrossRefData(work: CrossRefWork): RetrievedReferenceData {
  const title = work.title?.[0] || '';
  
  const authors = (work.author || []).map(a => {
    if (a.given) {
      return `${a.given} ${a.family}`;
    }
    return a.family;
  });
  
  const dateInfo = work['published-print'] || work['published-online'] || work.issued;
  const year = dateInfo?.['date-parts']?.[0]?.[0]?.toString() || '';
  
  const venue = work['container-title']?.[0] || '';
  
  return {
    title,
    authors,
    year,
    venue,
    doi: work.DOI || null,
    url: work.DOI ? `https://doi.org/${work.DOI}` : null,
  };
}

function calculateMatchScore(reference: Reference, retrieved: RetrievedReferenceData): number {
  let score = 0;
  let weights = 0;
  
  // Title similarity (weight: 0.5)
  if (reference.title && retrieved.title) {
    const titleScore = titleSimilarity(reference.title, retrieved.title);
    score += titleScore * 0.5;
    weights += 0.5;
  }
  
  // Author match (weight: 0.3)
  if (reference.authors.length > 0 && retrieved.authors.length > 0) {
    // Compare first author's last name
    const refLastNames = reference.authors.map(a => (a.split(' ').pop() || a).toLowerCase());
    const retLastNames = retrieved.authors.map(a => (a.split(' ').pop() || a).toLowerCase());
    
    let matchCount = 0;
    for (const name of refLastNames) {
      if (retLastNames.some(n => n.includes(name) || name.includes(n))) {
        matchCount++;
      }
    }
    
    const authorScore = matchCount / Math.max(refLastNames.length, retLastNames.length);
    score += authorScore * 0.3;
    weights += 0.3;
  }
  
  // Year match (weight: 0.2)
  if (reference.year && retrieved.year) {
    const refYear = parseInt(reference.year);
    const retYear = parseInt(retrieved.year);
    
    if (!isNaN(refYear) && !isNaN(retYear)) {
      const yearDiff = Math.abs(refYear - retYear);
      const yearScore = yearDiff === 0 ? 1 : yearDiff === 1 ? 0.9 : yearDiff === 2 ? 0.7 : 0.3;
      score += yearScore * 0.2;
      weights += 0.2;
    }
  }
  
  return weights > 0 ? score / weights : 0;
}
