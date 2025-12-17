import type { PDFDocument, PDFPage } from './pdfExtractor';

export interface BibliographySection {
  text: string;
  startPage: number;
  endPage: number;
  startIndex: number;
}

// Patterns to detect the start of bibliography section (more flexible)
const BIBLIOGRAPHY_HEADERS = [
  // Standard headers with newlines (most common)
  /\n\s*references\s*\n/i,
  /\n\s*reference\s*\n/i,  // Singular "REFERENCE" (common in two-column LaTeX)
  /\n\s*bibliography\s*\n/i,
  /\n\s*works\s+cited\s*\n/i,
  /\n\s*literature\s+cited\s*\n/i,
  /\n\s*cited\s+literature\s*\n/i,
  // Headers at end of line
  /\n\s*references\s*$/im,
  /\n\s*reference\s*$/im,  // Singular at end of line
  /^references\s*\n/im,
  /^reference\s*\n/im,  // Singular at start
  // More flexible patterns - just the word followed by content
  /\breferences\s*\n/i,
  /\breference\s*\n/i,  // Singular
  /\bbibliography\s*\n/i,
  // Roman numeral sections (e.g., "VII. REFERENCES")
  /\b[IVX]+\.\s*references\b/i,
  /\b[IVX]+\.\s*reference\b/i,  // Singular
  // Numbered sections (e.g., "7. References" or "7 References")
  /\b\d+\.?\s*references\b/i,
  /\b\d+\.?\s*reference\b/i,  // Singular
  // All caps variations (standalone word)
  /\bREFERENCES\b/,
  /\bREFERENCE\b/,  // Singular all caps (common in two-column LaTeX)
  /\bBIBLIOGRAPHY\b/,
  // References with colon
  /\breferences\s*:/i,
  /\breference\s*:/i,  // Singular with colon
  // More flexible: references followed by newline or end of text (for end of document)
  /\breferences\s*(?:\n|$)/i,
  /\breference\s*(?:\n|$)/i,
  // Case variations with optional punctuation
  /\breferences[\.:]?\s*(?:\n|$)/i,
  /\breference[\.:]?\s*(?:\n|$)/i,
];

// Patterns to detect the end of bibliography section
const SECTION_END_MARKERS = [
  /\n\s*appendix/i,
  /\n\s*acknowledgment/i,
  /\n\s*acknowledgement/i,
  /\n\s*supplementary/i,
  /\n\s*author\s+contributions/i,
  /\n\s*competing\s+interests/i,
  /\n\s*data\s+availability/i,
  /\n\s*code\s+availability/i,
];

/**
 * Find the bibliography section in PDF text
 */
export function detectBibliography(pdfDoc: PDFDocument): BibliographySection | null {
  const fullText = pdfDoc.fullText;
  
  console.log('Full text length:', fullText.length);
  console.log('Looking for bibliography section...');
  
  // Find the start of bibliography
  let startIndex = -1;
  let matchedPattern = '';
  
  for (const pattern of BIBLIOGRAPHY_HEADERS) {
    const lastMatch = findLastMatch(fullText, pattern);
    if (lastMatch && lastMatch.index > startIndex) {
      startIndex = lastMatch.index + lastMatch[0].length;
      matchedPattern = pattern.toString();
      console.log('Found match with pattern:', pattern.toString(), 'at index:', lastMatch.index);
    }
  }
  
  if (startIndex === -1) {
    // No bibliography header found, try to detect numbered references at end
    // Try multiple patterns for numbered references
    // Include patterns for two-column style: "1J." (no space) and "1 J." (with space)
    const numberedPatterns = [
      /\n\s*\[1\]\s+/,
      /\n\s*1\.\s+[A-Z]/,
      /\n\s*\(1\)\s+/,
      /\n\s*1(?=\S)/,  // "1J." style (no space, followed by non-whitespace)
      /\n\s*1\s+[A-Z]/,  // "1 J." style (with space)
      /\n\s*1\s+[A-Z][a-z]/,  // "1 Author" style
      /\n\s*\[1\]/,  // "[1]" without space
      /\n\s*1\.\s*[A-Z]/,  // "1. Author" with optional space
    ];
    
    // Search in last 40% of document for numbered references
    const searchStartIndex = Math.floor(fullText.length * 0.6);
    const lastPortion = fullText.substring(searchStartIndex);
    
    for (const pattern of numberedPatterns) {
      const match = findLastMatch(lastPortion, pattern);
      if (match) {
        startIndex = searchStartIndex + match.index;
        matchedPattern = 'numbered fallback: ' + pattern.toString();
        console.log('Found numbered reference fallback at index:', startIndex);
        break;
      }
    }
  }
  
  // Last resort: if still not found, check if document ends with what looks like references
  // (multiple lines starting with numbers, brackets, or author names)
  if (startIndex === -1) {
    const lastPortion = fullText.substring(Math.floor(fullText.length * 0.7));
    const lines = lastPortion.split('\n').filter(line => line.trim().length > 0);
    
    // Check if last portion has many lines that look like references
    // (contain author names, years, or citation patterns)
    let referenceLikeLines = 0;
    const referenceIndicators = [
      /\d{4}/,  // Year
      /[A-Z][a-z]+\s+[A-Z]/,  // Author name pattern
      /doi:/i,
      /http/,
      /\[.*\]/,  // Brackets
      /\d+\.\s+[A-Z]/,  // Numbered list
    ];
    
    for (const line of lines.slice(0, 20)) { // Check first 20 lines of last portion
      if (referenceIndicators.some(pattern => pattern.test(line))) {
        referenceLikeLines++;
      }
    }
    
    // If more than 30% of lines look like references, assume this is the bibliography
    if (referenceLikeLines > lines.length * 0.3 && lines.length > 5) {
      startIndex = Math.floor(fullText.length * 0.7);
      matchedPattern = 'heuristic fallback: reference-like content detected';
      console.log('Found bibliography using heuristic fallback at index:', startIndex);
    }
  }
  
  if (startIndex === -1) {
    console.log('No bibliography section detected');
    console.log('Text sample (last 2000 chars):', fullText.slice(-2000));
    return null;
  }
  
  console.log('Bibliography starts at index:', startIndex, 'with pattern:', matchedPattern);

  // Find the end of bibliography
  let endIndex = fullText.length;
  let bibliographyText = fullText.substring(startIndex);
  
  for (const pattern of SECTION_END_MARKERS) {
    const match = pattern.exec(bibliographyText);
    if (match && match.index < endIndex - startIndex) {
      endIndex = startIndex + match.index;
    }
  }
  
  bibliographyText = fullText.substring(startIndex, endIndex).trim();
  
  // Find which pages the bibliography spans
  const { startPage, endPage } = findPageRange(pdfDoc.pages, startIndex, endIndex, fullText);

  return {
    text: bibliographyText,
    startPage,
    endPage,
    startIndex,
  };
}

/**
 * Find the last match of a pattern in text
 */
function findLastMatch(text: string, pattern: RegExp): RegExpExecArray | null {
  const globalPattern = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : pattern.flags + 'g');
  let lastMatch: RegExpExecArray | null = null;
  let match;
  
  while ((match = globalPattern.exec(text)) !== null) {
    lastMatch = match;
  }
  
  return lastMatch;
}

/**
 * Find which pages contain the given text range
 */
function findPageRange(
  pages: PDFPage[],
  startIndex: number,
  endIndex: number,
  _fullText: string
): { startPage: number; endPage: number } {
  let currentIndex = 0;
  let startPage = 1;
  let endPage = pages.length;
  
  for (const page of pages) {
    const pageEndIndex = currentIndex + page.text.length + 2; // +2 for \n\n
    
    if (currentIndex <= startIndex && startIndex < pageEndIndex) {
      startPage = page.pageNumber;
    }
    
    if (currentIndex <= endIndex && endIndex <= pageEndIndex) {
      endPage = page.pageNumber;
      break;
    }
    
    currentIndex = pageEndIndex;
  }
  
  return { startPage, endPage };
}

