import type { Reference, ValidationSource, RetrievedReferenceData } from '../../types';
import { titleSimilarity } from '../utils/stringMatching';

const S2_API = 'https://api.semanticscholar.org/graph/v1/paper';
const SEARCH_API = 'https://api.semanticscholar.org/graph/v1/paper/search';

interface S2Paper {
  paperId: string;
  title: string;
  authors?: { name: string }[];
  year?: number;
  venue?: string;
  externalIds?: {
    DOI?: string;
    ArXiv?: string;
  };
  url?: string;
}

/**
 * Validate a reference using Semantic Scholar API
 */
export async function validateWithSemanticScholar(
  reference: Reference,
  apiKey?: string
): Promise<ValidationSource> {
  const source: ValidationSource = {
    name: 'semantic_scholar',
    found: false,
    matchScore: 0,
    retrievedData: null,
    errors: [],
  };
  
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  
  try {
    let paper: S2Paper | null = null;
    
    // If DOI is present, try direct lookup
    if (reference.doi) {
      console.log('S2: Looking up by DOI:', reference.doi);
      paper = await lookupByDOI(reference.doi, headers);
      if (paper) {
        console.log('S2: Found by DOI');
      }
    }
    
    // If ArXiv ID is present, try that
    if (!paper) {
      const arxivId = extractArxivId(reference);
      if (arxivId) {
        console.log('S2: Looking up by ArXiv:', arxivId);
        paper = await lookupByArxiv(arxivId, headers);
        if (paper) {
          console.log('S2: Found by ArXiv');
        }
      }
    }
    
    // Search by title
    if (!paper && reference.title) {
      console.log('S2: Searching by title:', reference.title);
      paper = await searchByTitle(reference.title, headers);
    }
    
    if (!paper) {
      source.errors.push('Reference not found in Semantic Scholar');
      return source;
    }
    
    // Extract data
    const retrievedData = extractS2Data(paper);
    source.retrievedData = retrievedData;
    source.found = true;
    source.matchScore = calculateMatchScore(reference, retrievedData);
    console.log('S2: Match score:', source.matchScore);
    
  } catch (error) {
    console.error('Semantic Scholar API error:', error);
    source.errors.push(`Semantic Scholar API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  return source;
}

function extractArxivId(reference: Reference): string | null {
  // Check URLs for ArXiv
  for (const url of reference.urls) {
    const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
    if (match) return match[1];
  }
  
  // Check raw text
  const match = reference.raw_text.match(/arxiv[:\s]*(\d{4}\.\d{4,5})/i);
  if (match) return match[1];
  
  return null;
}

async function lookupByDOI(doi: string, headers: HeadersInit): Promise<S2Paper | null> {
  const normalizedDOI = doi.replace(/^https?:\/\/(?:dx\.)?doi\.org\//, '');
  const url = `${S2_API}/DOI:${encodeURIComponent(normalizedDOI)}?fields=title,authors,year,venue,externalIds,url`;
  
  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      if (response.status === 404) return null;
      if (response.status === 429) {
        console.warn('S2: Rate limited');
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    
    return response.json();
  } catch (e) {
    console.error('S2 DOI lookup failed:', e);
    return null;
  }
}

async function lookupByArxiv(arxivId: string, headers: HeadersInit): Promise<S2Paper | null> {
  const url = `${S2_API}/ARXIV:${arxivId}?fields=title,authors,year,venue,externalIds,url`;
  
  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      if (response.status === 404) return null;
      return null;
    }
    
    return response.json();
  } catch (e) {
    console.error('S2 ArXiv lookup failed:', e);
    return null;
  }
}

async function searchByTitle(title: string, headers: HeadersInit): Promise<S2Paper | null> {
  // Clean title for search - remove special characters, limit length
  const cleanTitle = title
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
  
  const query = encodeURIComponent(cleanTitle);
  const url = `${SEARCH_API}?query=${query}&limit=5&fields=title,authors,year,venue,externalIds,url`;
  
  try {
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      if (response.status === 429) {
        console.warn('S2: Rate limited');
        return null;
      }
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    const papers = data.data || [];
    
    if (papers.length === 0) {
      console.log('S2: No results found');
      return null;
    }
    
    console.log('S2: Found', papers.length, 'candidates');
    
    // Find best match
    let bestMatch: S2Paper | null = null;
    let bestScore = 0;
    
    for (const paper of papers) {
      const score = titleSimilarity(title, paper.title || '');
      console.log('S2 candidate:', paper.title, 'score:', score);
      
      if (score > bestScore && score > 0.6) {
        bestScore = score;
        bestMatch = paper;
      }
    }
    
    return bestMatch;
  } catch (e) {
    console.error('S2 search failed:', e);
    return null;
  }
}

function extractS2Data(paper: S2Paper): RetrievedReferenceData {
  return {
    title: paper.title || '',
    authors: (paper.authors || []).map(a => a.name),
    year: paper.year?.toString() || '',
    venue: paper.venue || '',
    doi: paper.externalIds?.DOI || null,
    url: paper.url || null,
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
