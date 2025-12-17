import { v4 as uuidv4 } from 'uuid';
import type { Reference } from '../../types';
import { extractArxivId, extractURLs } from '../utils/doiParser';
import { parseAuthors } from '../utils/authorNormalization';

// Pattern for bracketed numbered references: [1], [2], etc.
const BRACKETED_REF_PATTERN = /\[(\d+)\]\s*([^[\n]+(?:\n(?!\s*\[\d+\])[^[\n]+)*)/g;

// Year pattern - improved to find all years and pick the last plausible one
const YEAR_PATTERN = /\b(19|20)\d{2}[a-z]?\b/g;

// DOI pattern (handles doi:10.xxx and https://doi.org/10.xxx formats)
const DOI_PATTERN = /(?:doi[:\s]*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,}\/[^\s,;]+)/gi;

// Improved DOI pattern for two-column style (handles trailing punctuation better)
const DOI_PATTERN_IMPROVED = /(?:doi[:\s]*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/gi;

// Quoted title pattern - improved to handle both straight and curly quotes
const QUOTED_TITLE_PATTERN = /["""]([^"""]+)["""]|[''']([^''']+)[''']/;

// URL pattern
const URL_PATTERN = /https?:\/\/[^\s)\].,;]+/gi;

// Venue patterns - enhanced for two-column LaTeX style
const VENUE_PATTERNS = [
  // arXiv
  /arxiv\s+preprint\s+arxiv:([^\s,]+)/i,
  // Proceedings
  /(?:In|in|Proceedings of|Proc\.)\s+([A-Z][^,.\d]+(?:Conference|Symposium|Workshop|Meeting)[^,]*)/i,
  // Journal patterns
  /(?:journal of|trans\.|transactions on|letters|review)\s+([^,.\d]+)/i,
  /,\s*([A-Z][A-Za-z\s]+(?:Conference|Journal|Symposium|Workshop|Transactions|Letters|Review)[^,]*)/,
  /\.\s+([A-Z][A-Za-z\s&]+(?:Med|Pract|Health|Sci|Res|Int|J\b)[^.]*)\./,  // Medical journals
];

export interface ExtractedReferenceWithIndex extends Reference {
  relativeIndex: number; // Index in the bibliography text
}

/**
 * Normalize text before parsing - critical for two-column LaTeX papers
 */
function normalizeBibliographyText(text: string): string {
  // Step 1: De-hyphenate line breaks (e.g., "pro-\nposal" -> "proposal")
  // Match hyphen at end of line followed by newline and lowercase letter
  text = text.replace(/([a-z])-\s*\n\s*([a-z])/gi, '$1$2');
  
  // Step 2: Normalize whitespace (multiple spaces/newlines to single space)
  text = text.replace(/\s+/g, ' ');
  
  // Step 3: Normalize weird spaces and ligatures
  text = text.replace(/[\u2000-\u200B\u2028\u2029]/g, ' '); // Various unicode spaces
  text = text.replace(/[\u2013\u2014]/g, '-'); // En/em dashes to hyphen
  text = text.replace(/[\u201C\u201D]/g, '"'); // Curly quotes to straight
  text = text.replace(/[\u2018\u2019]/g, "'"); // Curly single quotes
  
  // Step 4: Clean up multiple spaces again
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Extract references from bibliography text using regex patterns
 */
export function extractReferencesWithRegex(
  bibliographyText: string,
  startPage: number // Used as fallback if we can't map exactly
): ExtractedReferenceWithIndex[] {
  console.log('Extracting references from text length:', bibliographyText.length);
  
  // Normalize text first (critical for two-column LaTeX)
  const normalizedText = normalizeBibliographyText(bibliographyText);
  console.log('Normalized text length:', normalizedText.length);
  console.log('First 500 chars of normalized text:', normalizedText.substring(0, 500));
  
  // Try bracketed numbered references first [1], [2]
  const bracketedRefs = extractBracketedReferences(normalizedText, startPage);
  if (bracketedRefs.length >= 3) {
    console.log('Found', bracketedRefs.length, 'bracketed references');
    return bracketedRefs;
  }
  
  // Try two-column LaTeX style: 1J. or 1 J. (no space or with space)
  // This should be tried before period-numbered since two-column style is common
  const twoColumnRefs = extractTwoColumnReferences(normalizedText, startPage);
  if (twoColumnRefs.length >= 3) {
    console.log('Found', twoColumnRefs.length, 'two-column style references');
    return twoColumnRefs;
  }
  
  // Try period-numbered references: 1. Author, 2. Author
  const periodRefs = extractPeriodNumberedReferences(normalizedText, startPage);
  if (periodRefs.length >= 3) {
    console.log('Found', periodRefs.length, 'period-numbered references');
    return periodRefs;
  }
  
  // Try author-year style
  const authorYearRefs = extractAuthorYearReferences(normalizedText, startPage);
  if (authorYearRefs.length >= 3) {
    console.log('Found', authorYearRefs.length, 'author-year references');
    return authorYearRefs;
  }
  
  // Fallback: split by double newlines or numbered patterns
  const fallbackRefs = extractFallbackReferences(normalizedText, startPage);
  console.log('Fallback found', fallbackRefs.length, 'references');
  return fallbackRefs;
}

/**
 * Extract bracketed numbered references like [1] Author, "Title", Venue, Year
 */
function extractBracketedReferences(text: string, startPage: number): ExtractedReferenceWithIndex[] {
  const results: ExtractedReferenceWithIndex[] = [];
  const pattern = new RegExp(BRACKETED_REF_PATTERN.source, 'g');
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    const citationNumber = parseInt(match[1], 10);
    const refText = match[2].trim();
    const index = match.index;
    
    const reference = parseReferenceText(refText, citationNumber, startPage, index);
    results.push(reference);
  }
  
  return results;
}

/**
 * Extract period-numbered references like "1. Wong A, et al. Title. Journal. 2021"
 * Note: text is normalized (no newlines), so we work with space-separated text
 */
function extractPeriodNumberedReferences(text: string, startPage: number): ExtractedReferenceWithIndex[] {
  const results: ExtractedReferenceWithIndex[] = [];
  
  // Pattern for normalized text: number followed by period and space, then content
  // Look for: start or space, then number, period, space, then capital letter
  // Stop when we see another number-period-space-capital pattern
  const pattern = /(?:^|\s)(\d+)\.\s+([A-Z][^]*?)(?=\s+\d+\.\s+[A-Z]|$)/g;
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    const citationNumber = parseInt(match[1], 10);
    let refText = match[2].trim();
    const index = match.index;
    
    // Skip if too short (likely not a real reference)
    if (refText.length < 20) continue;
    
    // Only consider reasonable reference numbers
    if (citationNumber >= 1 && citationNumber <= 1000) {
      const reference = parseReferenceText(refText, citationNumber, startPage, index);
      // Only add if we extracted meaningful content
      if (reference.title || reference.authors.length > 0) {
        results.push(reference);
      }
    }
  }
  
  return results;
}

/**
 * Extract two-column LaTeX style references: "1J." or "1 J." (no space or with space)
 * This handles the common case where reference numbers are glued to author initials
 * Note: text is already normalized (no newlines), so we work with space-separated text
 */
function extractTwoColumnReferences(text: string, startPage: number): ExtractedReferenceWithIndex[] {
  const results: ExtractedReferenceWithIndex[] = [];
  
  // Pattern to detect start of entry: number followed by author initial or name
  // Very permissive pattern - just number followed by any letter
  // We rely on sequential filtering to remove false positives
  const pattern = /(?:^|\s)(\d+)\s*(?=[A-Za-z])/g;
  const matches: Array<{ number: number; index: number; fullMatch: string; context: string }> = [];
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    const num = parseInt(match[1], 10);
    // Only consider if it's a reasonable reference number (1-100)
    if (num >= 1 && num <= 100) {
      const matchStart = match.index;
      const matchEnd = matchStart + match[0].length;
      
      // Get context for debugging
      const context = text.substring(matchStart, Math.min(matchStart + 30, text.length));
      
      // The match includes the leading space (if any), so the actual number starts after that
      // Check if this number is part of a larger number by looking at what's IMMEDIATELY before/after the digits
      const matchText = match[0]; // e.g., " 15" or "15"
      const numberStartInMatch = matchText.search(/\d/);
      const actualNumberStart = matchStart + numberStartInMatch;
      
      // Character immediately before the number (not before the space)
      const charBeforeNumber = actualNumberStart > 0 ? text[actualNumberStart - 1] : ' ';
      // Character immediately after the number
      const charAfterNumber = matchEnd < text.length ? text[matchEnd] : ' ';
      
      // Skip if digits are immediately adjacent (no space) - means it's part of a larger number
      // "2021" -> the "1" has "202" before it with no space = reject
      // "9 15" -> the "15" has " " before it = accept (space separates them)
      const isPartOfLargerNumber = /\d/.test(charBeforeNumber) || /\d/.test(charAfterNumber);
      
      if (!isPartOfLargerNumber) {
        matches.push({ 
          number: num, 
          index: matchStart,
          fullMatch: match[0],
          context
        });
      }
    }
  }
  
  // Sort matches by index to ensure correct order
  matches.sort((a, b) => a.index - b.index);
  
  // Log all detected numbers for debugging
  console.log('All detected numbers:', matches.map(m => `${m.number} at ${m.index}`).join(', '));
  
  // Debug: Check for missing numbers in sequence
  const detectedNums = new Set(matches.map(m => m.number));
  for (let i = 1; i <= 50; i++) {
    if (!detectedNums.has(i)) {
      // Find the surrounding context where this number should be
      const prevMatch = matches.find(m => m.number === i - 1);
      const nextMatch = matches.find(m => m.number === i + 1);
      if (prevMatch && nextMatch) {
        const gapText = text.substring(prevMatch.index, nextMatch.index);
        console.log(`Missing number ${i}. Text between ${i-1} and ${i+1}:`, gapText.substring(0, 200));
        // Also check if the number appears in a different format
        const numRegex = new RegExp(`\\b${i}\\b`, 'g');
        const numMatches = [...gapText.matchAll(numRegex)];
        if (numMatches.length > 0) {
          numMatches.forEach(nm => {
            const ctx = gapText.substring(Math.max(0, nm.index! - 20), Math.min(gapText.length, nm.index! + 30));
            console.log(`Found "${i}" in gap at position ${nm.index}: "${ctx}"`);
          });
        }
      }
    }
  }
  
  
  // Filter matches: keep sequential or near-sequential numbers starting from 1
  // Allow small gaps (missing 1-2 numbers) but filter out obvious outliers
  const filteredMatches: typeof matches = [];
  let lastAcceptedNumber = 0;
  
  for (const match of matches) {
    // Accept if it's the next expected number or within a small gap (allows for missed detections)
    if (match.number >= lastAcceptedNumber + 1 && match.number <= lastAcceptedNumber + 3) {
      filteredMatches.push(match);
      lastAcceptedNumber = match.number;
    } else {
      console.log(`Skipped number ${match.number} (expected ${lastAcceptedNumber + 1} to ${lastAcceptedNumber + 3}), context: "${match.context}"`);
    }
  }
  
  console.log(`Two-column extraction: Found ${matches.length} potential matches, filtered to ${filteredMatches.length} sequential references`);
  console.log('Filtered numbers:', filteredMatches.map(m => m.number).join(', '));
  
  // Validate that we have enough sequential numbers
  if (filteredMatches.length >= 3) {
    // Split text by these matches
    for (let i = 0; i < filteredMatches.length; i++) {
      const startIdx = filteredMatches[i].index;
      const endIdx = i < filteredMatches.length - 1 ? filteredMatches[i + 1].index : text.length;
      let refText = text.substring(startIdx, endIdx).trim();
      
      // Remove the leading number and any following space
      // Handle both "1J." and "1 J." cases - remove number and optional space
      refText = refText.replace(/^\d+\s*/, '').trim();
      
      // Skip if too short (likely not a real reference)
      if (refText.length >= 20) {
        // Use sequential numbering (i+1) instead of detected number
        // This ensures we get [1], [2], [3]... even if detection missed some numbers
        const reference = parseReferenceText(
          refText,
          i + 1,  // Sequential citation number
          startPage,
          startIdx
        );
        // Only add if we extracted meaningful content
        if (reference.title || reference.authors.length > 0) {
          results.push(reference);
        }
      }
    }
  }
  
  // Re-number all references sequentially to ensure proper ordering
  results.forEach((ref, index) => {
    ref.citation_number = index + 1;
  });
  
  return results;
}

/**
 * Extract author-year style references
 */
function extractAuthorYearReferences(text: string, startPage: number): ExtractedReferenceWithIndex[] {
  const results: ExtractedReferenceWithIndex[] = [];
  let currentIndex = 0;
  
  const entries = text.split(/\n\n+/);
  
  entries.forEach((entry, index) => {
    const trimmed = entry.trim();
    if (trimmed.length > 50) {
      // Approximate index finding
      const entryIndex = text.indexOf(trimmed, currentIndex);
      if (entryIndex !== -1) {
        currentIndex = entryIndex + trimmed.length;
        const reference = parseReferenceText(trimmed, index + 1, startPage, entryIndex);
        if (reference.title || reference.authors.length > 0) {
          results.push(reference);
        }
      }
    }
  });
  
  return results;
}

/**
 * Fallback extraction by splitting on common patterns
 * Note: text is normalized (no newlines), so we work with space-separated text
 */
function extractFallbackReferences(text: string, startPage: number): ExtractedReferenceWithIndex[] {
  const references: ExtractedReferenceWithIndex[] = [];
  
  // Try to split by patterns that indicate new references
  // Look for: number followed by period/paren and space, or bracketed numbers
  const pattern = /(?:^|\s)(\d+)[\.\)]\s+([A-Z])|(?:^|\s)\[(\d+)\]\s+/g;
  const matches: Array<{ number: number; index: number }> = [];
  let match;
  
  while ((match = pattern.exec(text)) !== null) {
    const num = match[1] ? parseInt(match[1], 10) : parseInt(match[3], 10);
    if (num >= 1 && num <= 1000) {
      matches.push({ number: num, index: match.index });
    }
  }
  
  if (matches.length >= 3) {
    // Sort by index
    matches.sort((a, b) => a.index - b.index);
    
    for (let i = 0; i < matches.length; i++) {
      const startIdx = matches[i].index;
      const endIdx = i < matches.length - 1 ? matches[i + 1].index : text.length;
      let refText = text.substring(startIdx, endIdx).trim();
      
      // Remove leading number and punctuation
      refText = refText.replace(/^(\d+[\.\)]|\[\d+\])\s*/, '').trim();
      
      if (refText.length >= 20) {
        const reference = parseReferenceText(
          refText,
          matches[i].number,
          startPage,
          startIdx
        );
        if (reference.title || reference.authors.length > 0) {
          references.push(reference);
        }
      }
    }
  } else {
    // Last resort: try splitting by looking for sequential numbers
    // This is less reliable but might catch some cases
    const sequentialPattern = /\s(\d+)(?=\s*[A-Z])/g;
    const seqMatches: Array<{ number: number; index: number }> = [];
    let seqMatch;
    
    while ((seqMatch = sequentialPattern.exec(text)) !== null) {
      const num = parseInt(seqMatch[1], 10);
      if (num >= 1 && num <= 100) { // Limit to first 100 for sequential detection
        seqMatches.push({ number: num, index: seqMatch.index + 1 }); // +1 to skip the space
      }
    }
    
    if (seqMatches.length >= 3) {
      seqMatches.sort((a, b) => a.index - b.index);
      
      for (let i = 0; i < seqMatches.length; i++) {
        const startIdx = seqMatches[i].index;
        const endIdx = i < seqMatches.length - 1 ? seqMatches[i + 1].index : text.length;
        let refText = text.substring(startIdx, endIdx).trim();
        
        refText = refText.replace(/^\d+\s*/, '').trim();
        
        if (refText.length >= 20) {
          const reference = parseReferenceText(
            refText,
            seqMatches[i].number,
            startPage,
            startIdx
          );
          if (reference.title || reference.authors.length > 0) {
            references.push(reference);
          }
        }
      }
    }
  }
  
  return references;
}

/**
 * Parse a single reference text into structured data
 */
function parseReferenceText(
  text: string,
  citationNumber: number,
  pageNumber: number,
  relativeIndex: number
): ExtractedReferenceWithIndex {
  // Normalize whitespace but keep structure
  const cleanText = text.replace(/\s+/g, ' ').trim();
  
  // Extract DOI (improved pattern for two-column style)
  let doi: string | null = null;
  const doiMatches = [...cleanText.matchAll(DOI_PATTERN_IMPROVED)];
  if (doiMatches.length > 0) {
    // Take the last match (often more reliable)
    const lastMatch = doiMatches[doiMatches.length - 1];
    let doiPart = lastMatch[1] || lastMatch[0];
    // Remove trailing punctuation
    doiPart = doiPart.replace(/[.,;)\]]+$/, '');
    // Validate it looks like a DOI
    if (/^10\.\d{4,9}\//.test(doiPart)) {
      doi = doiPart;
    }
  }
  
  // Fallback to original pattern if improved pattern didn't work
  if (!doi) {
    const doiMatch = cleanText.match(DOI_PATTERN);
    if (doiMatch) {
      const fullMatch = doiMatch[0];
      const doiPart = fullMatch.replace(/^(?:doi[:\s]*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '');
      doi = doiPart.replace(/[.,;)\]]+$/, '');
    }
  }
  
  // Extract ArXiv ID
  const arxivId = extractArxivId(cleanText);
  
  // Extract URLs (improved)
  const urls = extractURLs(cleanText);
  // Also try direct URL pattern matching
  const urlMatches = [...cleanText.matchAll(URL_PATTERN)];
  urlMatches.forEach(match => {
    const url = match[0].replace(/[.,;)\]]+$/, ''); // Remove trailing punctuation
    if (!urls.includes(url)) {
      urls.push(url);
    }
  });
  if (arxivId && !urls.some(u => u.includes('arxiv'))) {
    urls.push(`https://arxiv.org/abs/${arxivId}`);
  }
  
  // Extract year (pick the last plausible year if multiple)
  const yearMatches = [...cleanText.matchAll(YEAR_PATTERN)];
  let year = '';
  if (yearMatches.length > 0) {
    // Filter to plausible years (1900-2099) and take the last one
    const plausibleYears = yearMatches
      .map(m => m[0])
      .filter(y => {
        const num = parseInt(y.replace(/[a-z]$/, ''), 10);
        return num >= 1900 && num <= 2099;
      });
    if (plausibleYears.length > 0) {
      year = plausibleYears[plausibleYears.length - 1];
    }
  }
  
  // Extract title (improved for two-column style)
  let title = extractTitle(cleanText);
  
  // Extract venue (improved for two-column style)
  let venue = extractVenue(cleanText, arxivId);
  
  // Extract authors - typically everything before the title or year
  const authors = extractAuthorsFromReference(cleanText, title, year);
  
  return {
    id: uuidv4(),
    raw_text: cleanText,
    title,
    authors,
    year,
    venue,
    doi,
    urls,
    page_number: pageNumber,
    bounding_box: null,
    citation_number: citationNumber,
    relativeIndex,
  };
}

/**
 * Extract title from reference text (improved for two-column style)
 */
function extractTitle(text: string): string {
  // Try quoted title first (handles both straight and curly quotes)
  const quotedMatch = text.match(QUOTED_TITLE_PATTERN);
  if (quotedMatch) {
    const title = quotedMatch[1] || quotedMatch[2] || quotedMatch[3] || '';
    if (title.length > 5) {
      return title.trim();
    }
  }
  
  // For two-column LaTeX style: title often appears after authors, before venue/year
  // Pattern: "Author A, Author B. Title of the paper. Journal..."
  const sentences = text.split(/\.\s+/);
  
  if (sentences.length >= 2) {
    // First "sentence" is usually authors, second is often title
    const potentialTitle = sentences[1];
    
    // Validate it looks like a title (starts with capital, has multiple words, not too short)
    if (potentialTitle && 
        potentialTitle.length > 10 && 
        potentialTitle.length < 300 &&
        /^[A-Z]/.test(potentialTitle) &&
        !potentialTitle.match(/^\d+/) &&
        !potentialTitle.match(/^Accessed\s/i) &&
        !potentialTitle.match(/^https?:/) &&
        !potentialTitle.match(/^arXiv/) &&
        !potentialTitle.match(/^In\s+/i) &&
        !potentialTitle.match(/^Proceedings/i)) {
      return potentialTitle.trim();
    }
  }
  
  // Try to find title between authors and venue/year
  // Look for capitalized segment that's not author names or venue
  const titleMatch = text.match(/[A-Z][^.!?]*(?::|[.!?])/);
  if (titleMatch) {
    const potentialTitle = titleMatch[0];
    // Skip if it looks like author names (e.g., "Smith, J.") or venue
    if (!potentialTitle.match(/^[A-Z][a-z]+,\s*[A-Z][A-Z]?\./) &&
        !potentialTitle.match(/^In\s+/i) &&
        !potentialTitle.match(/^Proceedings/i) &&
        !potentialTitle.match(/^arXiv/i) &&
        potentialTitle.length > 10 &&
        potentialTitle.length < 300) {
      return potentialTitle.replace(/[.!?:]$/, '').trim();
    }
  }
  
  return '';
}

/**
 * Extract venue from reference text (improved for two-column style)
 */
function extractVenue(text: string, arxivId: string | null): string {
  // Check for arXiv first
  if (arxivId || /arxiv\s+preprint/i.test(text)) {
    return 'arXiv';
  }
  
  // Try venue patterns
  for (const pattern of VENUE_PATTERNS) {
    const venueMatch = text.match(pattern);
    if (venueMatch && venueMatch[1]) {
      let venue = venueMatch[1].trim();
      // Clean up venue (remove trailing punctuation, normalize)
      venue = venue.replace(/[.,;)\]]+$/, '').trim();
      if (venue.length > 2 && venue.length < 200) {
        return venue;
      }
    }
  }
  
  // Fallback: look for common journal/conference patterns
  const journalPatterns = [
    /([A-Z][A-Za-z\s]+(?:Journal|Conference|Symposium|Workshop|Proceedings|Transactions|Letters|Review|Magazine)[^,.]*)/,
    /([A-Z][A-Za-z\s&]+(?:Med|Pract|Health|Sci|Res|Int|J\b)[^.]*)/,
  ];
  
  for (const pattern of journalPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const venue = match[1].trim().replace(/[.,;)\]]+$/, '');
      if (venue.length > 2 && venue.length < 200) {
        return venue;
      }
    }
  }
  
  return '';
}

/**
 * Extract authors from reference text (improved for two-column style)
 */
function extractAuthorsFromReference(text: string, title: string, year: string): string[] {
  // Authors are typically at the start, before the title
  let authorText = text;
  
  // If we found a title, get text before it
  if (title && text.includes(title)) {
    const titleIndex = text.indexOf(title);
    authorText = text.substring(0, titleIndex);
  } else if (year) {
    // Otherwise, get text before the year
    const yearIndex = text.indexOf(year);
    if (yearIndex > 0) {
      authorText = text.substring(0, yearIndex);
    }
  }
  
  // For two-column style, authors might be before the first quote
  const firstQuoteIndex = text.indexOf('"');
  if (firstQuoteIndex > 0 && firstQuoteIndex < text.length / 2) {
    const beforeQuote = text.substring(0, firstQuoteIndex);
    // If this looks like author text (has commas, "and", etc.), use it
    if (beforeQuote.match(/[,\s]and\s/i) || beforeQuote.split(',').length > 1) {
      authorText = beforeQuote;
    }
  }
  
  // Clean up author text
  authorText = authorText
    .replace(QUOTED_TITLE_PATTERN, '')
    .replace(/["\""]/g, '')
    .replace(/\.\s*$/, '') // Remove trailing period
    .replace(/^\d+\s*/, '') // Remove leading number if still present
    .trim();
  
  // Parse authors (handles comma/and separators, et al.)
  const authors = parseAuthors(authorText).slice(0, 10); // Limit to 10 authors
  
  return authors;
}
