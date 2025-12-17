import type { Reference, ValidationSource, RetrievedReferenceData } from '../../types';
import { stringSimilarity, normalizeString } from '../utils/stringMatching';

const ARXIV_API = 'https://export.arxiv.org/api/query';

/**
 * Validate a reference using ArXiv API
 */
export async function validateWithArxiv(reference: Reference): Promise<ValidationSource> {
  const source: ValidationSource = {
    name: 'arxiv',
    found: false,
    matchScore: 0,
    retrievedData: null,
    errors: [],
  };
  
  try {
    // Check if reference has an ArXiv URL or ID
    const arxivId = extractArxivId(reference);
    
    let entry: ArxivEntry | null = null;
    
    if (arxivId) {
      entry = await lookupById(arxivId);
    } else if (reference.title) {
      entry = await searchByTitle(reference.title);
    }
    
    if (!entry) {
      source.errors.push('Reference not found in ArXiv');
      return source;
    }
    
    const retrievedData = extractArxivData(entry);
    source.retrievedData = retrievedData;
    source.found = true;
    source.matchScore = calculateMatchScore(reference, retrievedData);
    
  } catch (error) {
    source.errors.push(`ArXiv API error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
  
  return source;
}

interface ArxivEntry {
  id: string;
  title: string;
  authors: string[];
  published: string;
  summary: string;
}

function extractArxivId(reference: Reference): string | null {
  // Check URLs for ArXiv
  for (const url of reference.urls) {
    const match = url.match(/arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})/);
    if (match) return match[1];
  }
  
  // Check raw text for ArXiv ID
  const match = reference.raw_text.match(/arxiv[:\s]*(\d{4}\.\d{4,5})/i);
  if (match) return match[1];
  
  return null;
}

async function lookupById(arxivId: string): Promise<ArxivEntry | null> {
  const url = `${ARXIV_API}?id_list=${arxivId}`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const xml = await response.text();
  const entries = parseArxivResponse(xml);
  
  return entries.length > 0 ? entries[0] : null;
}

async function searchByTitle(title: string): Promise<ArxivEntry | null> {
  const query = normalizeString(title).slice(0, 200);
  const url = `${ARXIV_API}?search_query=ti:${encodeURIComponent(query)}&max_results=3`;
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  
  const xml = await response.text();
  const entries = parseArxivResponse(xml);
  
  if (entries.length === 0) return null;
  
  // Find best match
  let bestMatch: ArxivEntry | null = null;
  let bestScore = 0;
  
  for (const entry of entries) {
    const score = stringSimilarity(title, entry.title);
    if (score > bestScore && score > 0.7) {
      bestScore = score;
      bestMatch = entry;
    }
  }
  
  return bestMatch;
}

function parseArxivResponse(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  
  // Simple XML parsing for ArXiv response
  const entryMatches = xml.match(/<entry>[\s\S]*?<\/entry>/g) || [];
  
  for (const entryXml of entryMatches) {
    const id = extractXmlValue(entryXml, 'id')?.replace('http://arxiv.org/abs/', '') || '';
    const title = extractXmlValue(entryXml, 'title')?.replace(/\s+/g, ' ').trim() || '';
    const published = extractXmlValue(entryXml, 'published') || '';
    const summary = extractXmlValue(entryXml, 'summary')?.replace(/\s+/g, ' ').trim() || '';
    
    // Extract authors
    const authorMatches = entryXml.match(/<author>[\s\S]*?<\/author>/g) || [];
    const authors = authorMatches.map(a => extractXmlValue(a, 'name') || '').filter(Boolean);
    
    if (id && title) {
      entries.push({ id, title, authors, published, summary });
    }
  }
  
  return entries;
}

function extractXmlValue(xml: string, tag: string): string | null {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : null;
}

function extractArxivData(entry: ArxivEntry): RetrievedReferenceData {
  const year = entry.published ? new Date(entry.published).getFullYear().toString() : '';
  
  return {
    title: entry.title,
    authors: entry.authors,
    year,
    venue: 'arXiv preprint',
    doi: null,
    url: `https://arxiv.org/abs/${entry.id}`,
  };
}

function calculateMatchScore(reference: Reference, retrieved: RetrievedReferenceData): number {
  let score = 0;
  let weights = 0;
  
  if (reference.title && retrieved.title) {
    score += stringSimilarity(reference.title, retrieved.title) * 0.4;
    weights += 0.4;
  }
  
  if (reference.authors.length > 0 && retrieved.authors.length > 0) {
    const refAuthors = new Set(reference.authors.map(a => a.toLowerCase().split(' ').pop()));
    const retAuthors = new Set(retrieved.authors.map(a => a.toLowerCase().split(' ').pop()));
    const intersection = [...refAuthors].filter(a => retAuthors.has(a));
    score += (intersection.length / Math.max(refAuthors.size, retAuthors.size)) * 0.3;
    weights += 0.3;
  }
  
  if (reference.year && retrieved.year) {
    const yearDiff = Math.abs(parseInt(reference.year) - parseInt(retrieved.year));
    score += (yearDiff === 0 ? 1 : yearDiff === 1 ? 0.8 : 0) * 0.2;
    weights += 0.2;
  }
  
  return weights > 0 ? score / weights : 0;
}

