import type { Reference, ValidationSource, RetrievedReferenceData } from '../../types';
import { titleSimilarity } from '../utils/stringMatching';

const OPENALEX_API = 'https://api.openalex.org/works';
const POLITE_EMAIL = 'refchecker@example.com';

interface OpenAlexWork {
  id: string;
  doi?: string;
  title?: string;
  display_name?: string;
  authorships?: {
    author: {
      display_name: string;
    };
  }[];
  publication_year?: number;
  primary_location?: {
    source?: {
      display_name?: string;
    };
  };
}

/**
 * Validate a reference using OpenAlex API
 */
export async function validateWithOpenAlex(reference: Reference): Promise<ValidationSource> {
  const source: ValidationSource = {
    name: 'openalex',
    found: false,
    matchScore: 0,
    retrievedData: null,
    errors: [],
  };
  
  try {
    let work: OpenAlexWork | null = null;
    
    // If DOI is present, try direct lookup
    if (reference.doi) {
      console.log('OpenAlex: Looking up by DOI:', reference.doi);
      work = await lookupByDOI(reference.doi);
      if (work) {
        console.log('OpenAlex: Found by DOI');
      }
    }
    
    // Search by title
    if (!work && reference.title) {
      console.log('OpenAlex: Searching by title:', reference.title);
      work = await searchByTitle(reference.title);
    }
    
    if (!work) {
      source.errors.push('Reference not found in OpenAlex');
      return source;
    }
    
    const retrievedData = extractOpenAlexData(work);
    source.retrievedData = retrievedData;
    source.found = true;
    source.matchScore = calculateMatchScore(reference, retrievedData);
    console.log('OpenAlex: Match score:', source.matchScore);
    
  } catch (error) {
    console.error('OpenAlex API error:', error);
    source.errors.push(`OpenAlex API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  return source;
}

async function lookupByDOI(doi: string): Promise<OpenAlexWork | null> {
  const normalizedDOI = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
  const url = `${OPENALEX_API}/https://doi.org/${normalizedDOI}?mailto=${POLITE_EMAIL}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}`);
    }
    
    return response.json();
  } catch (e) {
    console.error('OpenAlex DOI lookup failed:', e);
    return null;
  }
}

async function searchByTitle(title: string): Promise<OpenAlexWork | null> {
  // Clean title for search
  const cleanTitle = title
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  const query = encodeURIComponent(cleanTitle);
  // Use search parameter instead of filter for better matching
  const url = `${OPENALEX_API}?search=${query}&per-page=5&mailto=${POLITE_EMAIL}`;
  
  try {
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const results = data.results || [];
    
    if (results.length === 0) {
      console.log('OpenAlex: No results found');
      return null;
    }
    
    console.log('OpenAlex: Found', results.length, 'candidates');
    
    // Find best match
    let bestMatch: OpenAlexWork | null = null;
    let bestScore = 0;
    
    for (const work of results) {
      const workTitle = work.display_name || work.title || '';
      const score = titleSimilarity(title, workTitle);
      
      console.log('OpenAlex candidate:', workTitle, 'score:', score);
      
      if (score > bestScore && score > 0.6) {
        bestScore = score;
        bestMatch = work;
      }
    }
    
    return bestMatch;
  } catch (e) {
    console.error('OpenAlex search failed:', e);
    return null;
  }
}

function extractOpenAlexData(work: OpenAlexWork): RetrievedReferenceData {
  const title = work.display_name || work.title || '';
  const authors = (work.authorships || []).map(a => a.author.display_name);
  const year = work.publication_year?.toString() || '';
  const venue = work.primary_location?.source?.display_name || '';
  
  let doi: string | null = null;
  if (work.doi) {
    doi = work.doi.replace('https://doi.org/', '');
  }
  
  return {
    title,
    authors,
    year,
    venue,
    doi,
    url: work.doi || null,
  };
}

function calculateMatchScore(reference: Reference, retrieved: RetrievedReferenceData): number {
  let score = 0;
  let weights = 0;
  
  if (reference.title && retrieved.title) {
    const titleScore = titleSimilarity(reference.title, retrieved.title);
    score += titleScore * 0.5;
    weights += 0.5;
  }
  
  if (reference.authors.length > 0 && retrieved.authors.length > 0) {
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
