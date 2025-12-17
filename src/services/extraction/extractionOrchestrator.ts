import type { Reference, AppSettings } from '../../types';
import type { PDFDocument } from '../pdf/pdfExtractor';
import { getPageForIndex } from '../pdf/pdfExtractor';
import { detectBibliography } from '../pdf/bibliographyDetector';
import { extractReferencesWithLLM } from './llmExtractor';
import { extractReferencesWithGrobid } from './grobidClient';

export interface ExtractionResult {
  references: Reference[];
  bibliographyStartPage: number;
  bibliographyEndPage: number;
  method: 'grobid' | 'llm';
  error?: string;
}

/**
 * Helper to determine page numbers for references by searching in PDF text.
 * GROBID doesn't provide page numbers, so we need to find them.
 */
function assignPageNumbersToReferences(
  references: Reference[],
  pdfDoc: PDFDocument,
  bibliography: { text: string; startIndex: number; startPage: number } | null,
  fallbackPage: number
): void {
  if (references.length === 0) return;
  
  const normalize = (text: string): string => {
    return text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  };
  
  const searchContext = bibliography?.text || pdfDoc.fullText;
  const offset = bibliography?.startIndex || 0;
  
  references.forEach(ref => {
    if (ref.page_number !== null) return; // Already has page number
    
    // Use raw_text or title to find the reference in the PDF
    const searchTerms: string[] = [];
    
    if (ref.raw_text && ref.raw_text.length > 15) {
      searchTerms.push(ref.raw_text);
    }
    if (ref.title && ref.title.length > 15) {
      searchTerms.push(ref.title);
    }
    if (ref.authors.length > 0 && ref.title) {
      searchTerms.push(`${ref.authors[0]} ${ref.title}`);
    }
    
    for (const term of searchTerms) {
      // Try exact search first
      const lowerContext = searchContext.toLowerCase();
      const lowerTerm = term.toLowerCase();
      let idx = lowerContext.indexOf(lowerTerm);
      
      // If not found, try normalized search
      if (idx === -1) {
        const normalizedContext = normalize(searchContext);
        const normalizedTerm = normalize(term);
        if (normalizedTerm.length >= 15) {
          const normIdx = normalizedContext.indexOf(normalizedTerm);
          if (normIdx !== -1) {
            // Map normalized index back to original (approximate)
            idx = Math.floor((normIdx / normalizedContext.length) * searchContext.length);
          }
        }
      }
      
      if (idx !== -1) {
        const absoluteIndex = offset + idx;
        ref.page_number = getPageForIndex(pdfDoc.pages, absoluteIndex);
        break;
      }
    }
    
    // Fallback if not found
    if (ref.page_number === null) {
      ref.page_number = fallbackPage;
    }
  });
}

/**
 * Main extraction orchestrator - handles the full extraction pipeline
 */
export async function extractReferences(
  pdfDoc: PDFDocument,
  settings: AppSettings,
  pdfFile?: File
): Promise<ExtractionResult> {
  // Detect bibliography section (used for page info and for improving LLM results)
  const bibliography = detectBibliography(pdfDoc);
  
  // If LLM extraction is enabled and we have the file, use LLM first
  if (settings.extraction.useLLM && pdfFile) {
    try {
      const startPage = bibliography?.startPage || Math.max(1, pdfDoc.numPages - 3);
      
      // Pass bibliography text if available for faster extraction
      const bibliographyText = bibliography?.text;
      const references = await extractReferencesWithLLM(
        pdfFile, 
        settings, 
        startPage,
        bibliographyText
      );
      
      // If LLM returned empty results, fall back to GROBID (when available)
      if (references.length === 0) {
        console.warn('LLM returned no references, falling back to GROBID extraction');
        const grobidRefs = await extractReferencesWithGrobid(pdfFile, settings);
        if (grobidRefs.length > 0) {
          // GROBID doesn't provide page numbers, so find them
          assignPageNumbersToReferences(
            grobidRefs,
            pdfDoc,
            bibliography,
            bibliography?.startPage || startPage
          );
          return {
            references: grobidRefs,
            bibliographyStartPage: bibliography?.startPage || startPage,
            bibliographyEndPage: bibliography?.endPage || pdfDoc.numPages,
            method: 'grobid',
            error: 'LLM extraction returned no results. Using GROBID fallback.',
          };
        }
      }
      
      // Try to improve page numbers and raw_text for LLM results if we detected bibliography
      if (references.length > 0) {
        // Better approach: Search for reference content in the PDF text to find exact page and raw_text
        // Use bibliography text if available (faster/more accurate), otherwise full text
        const searchContext = bibliography ? bibliography.text : pdfDoc.fullText;
        const offset = bibliography ? bibliography.startIndex : 0;
        
        // Normalize function for fuzzy matching
        const normalize = (text: string): string => {
          return text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
            .toLowerCase()
            .replace(/[^a-z0-9]/g, ''); // Alphanumeric only
        };
        
        references.forEach(ref => {
          // Build search terms from available reference data
          const searchTerms: Array<{ text: string; priority: number }> = [];
          
          // Priority 1: Full reconstructed reference (most reliable)
          if (ref.title && ref.authors.length > 0 && ref.year) {
            const reconstructed = `${ref.authors.join(' ')} ${ref.title} ${ref.year}`;
            if (reconstructed.length > 20) {
              searchTerms.push({ text: reconstructed, priority: 1 });
            }
          }
          
          // Priority 2: Title + first author + year
          if (ref.title && ref.authors.length > 0 && ref.year) {
            const titleAuthorYear = `${ref.authors[0]} ${ref.title} ${ref.year}`;
            if (titleAuthorYear.length > 20) {
              searchTerms.push({ text: titleAuthorYear, priority: 2 });
            }
          }
          
          // Priority 3: Title alone (if long enough)
          if (ref.title && ref.title.length > 15) {
            searchTerms.push({ text: ref.title, priority: 3 });
          }
          
          // Priority 4: First author + year
          if (ref.authors.length > 0 && ref.year) {
            const authorYear = `${ref.authors[0]} ${ref.year}`;
            if (authorYear.length > 10) {
              searchTerms.push({ text: authorYear, priority: 4 });
            }
          }
          
          // Priority 5: Existing raw_text if available
          if (ref.raw_text && ref.raw_text.length > 10) {
            searchTerms.push({ text: ref.raw_text, priority: 5 });
          }
          
          // Sort by priority (lower is better)
          searchTerms.sort((a, b) => a.priority - b.priority);
          
          let foundIndex = -1;
          let foundText = '';
          let matchLength = 0;
          
          // Try exact search first (case-insensitive)
          for (const { text: term } of searchTerms) {
            const lowerContext = searchContext.toLowerCase();
            const lowerTerm = term.toLowerCase();
            const idx = lowerContext.indexOf(lowerTerm);
            if (idx !== -1) {
              foundIndex = idx;
              foundText = searchContext.substring(idx, idx + term.length);
              matchLength = term.length;
              break;
            }
          }
          
          // If not found, try normalized search (remove whitespace/punctuation)
          if (foundIndex === -1) {
            const normalizedContext = normalize(searchContext);
            for (const { text: term } of searchTerms) {
              const normalizedTerm = normalize(term);
              if (normalizedTerm.length < 10) continue; // Skip too short terms
              
              // Try full match
              let idx = normalizedContext.indexOf(normalizedTerm);
              if (idx !== -1) {
                // Map back to original index (approximate)
                // Find the position in original text by counting characters
                let charCount = 0;
                let originalIdx = 0;
                for (let i = 0; i < searchContext.length && charCount < idx; i++) {
                  const char = searchContext[i];
                  const normalizedChar = normalize(char);
                  if (normalizedChar.length > 0) {
                    charCount++;
                  }
                  originalIdx = i;
                }
                foundIndex = originalIdx;
                // Extract surrounding text as raw_text
                const start = Math.max(0, originalIdx - 10);
                const end = Math.min(searchContext.length, originalIdx + normalizedTerm.length + 50);
                foundText = searchContext.substring(start, end).trim();
                matchLength = normalizedTerm.length;
                break;
              }
              
              // Try partial match (first 20 chars)
              if (normalizedTerm.length > 20) {
                const head = normalizedTerm.substring(0, 20);
                idx = normalizedContext.indexOf(head);
                if (idx !== -1) {
                  let charCount = 0;
                  let originalIdx = 0;
                  for (let i = 0; i < searchContext.length && charCount < idx; i++) {
                    const char = searchContext[i];
                    const normalizedChar = normalize(char);
                    if (normalizedChar.length > 0) {
                      charCount++;
                    }
                    originalIdx = i;
                  }
                  foundIndex = originalIdx;
                  // Extract more text for partial matches
                  const start = Math.max(0, originalIdx - 10);
                  const end = Math.min(searchContext.length, originalIdx + 200);
                  foundText = searchContext.substring(start, end).trim();
                  matchLength = 20;
                  break;
                }
              }
            }
          }
          
          if (foundIndex !== -1) {
            const absoluteIndex = offset + foundIndex;
            ref.page_number = getPageForIndex(pdfDoc.pages, absoluteIndex);
            
            // Store the found raw_text if we don't have one or if it's better
            if (!ref.raw_text || foundText.length > ref.raw_text.length) {
              // Try to extract a complete reference entry
              // Look for boundaries (new reference patterns, end of line patterns)
              const contextStart = Math.max(0, foundIndex - 50);
              const contextEnd = Math.min(searchContext.length, foundIndex + matchLength + 300);
              let extractedText = searchContext.substring(contextStart, contextEnd);
              
              // Try to find the start of this reference (look backwards for reference markers)
              const beforeText = searchContext.substring(Math.max(0, foundIndex - 200), foundIndex);
              const refStartPatterns = [
                /\n\s*\[\d+\]\s+/,
                /\n\s*\d+\.\s+/,
                /\n\s*\d+\s+[A-Z]/,
                /\n\s*[A-Z][a-z]+,\s+[A-Z]/,
              ];
              
              let actualStart = contextStart;
              for (const pattern of refStartPatterns) {
                const matches = [...beforeText.matchAll(new RegExp(pattern.source, 'g'))];
                if (matches.length > 0) {
                  const lastMatch = matches[matches.length - 1];
                  const matchPos = foundIndex - 200 + lastMatch.index! + lastMatch[0].length;
                  if (matchPos > actualStart && matchPos < foundIndex) {
                    actualStart = matchPos;
                    break;
                  }
                }
              }
              
              // Try to find the end of this reference (look for next reference or end of line)
              const afterText = searchContext.substring(foundIndex + matchLength, Math.min(searchContext.length, foundIndex + matchLength + 200));
              const refEndPatterns = [
                /\n\s*\[\d+\]/,
                /\n\s*\d+\.\s+/,
                /\n\s*\d+\s+[A-Z]/,
              ];
              
              let actualEnd = contextEnd;
              for (const pattern of refEndPatterns) {
                const match = afterText.match(pattern);
                if (match && match.index !== undefined) {
                  const matchPos = foundIndex + matchLength + match.index;
                  if (matchPos < actualEnd) {
                    actualEnd = matchPos;
                    break;
                  }
                }
              }
              
              extractedText = searchContext.substring(actualStart, actualEnd).trim();
              
              // Clean up the extracted text
              extractedText = extractedText.replace(/\s+/g, ' ').trim();
              
              if (extractedText.length > 20) {
                ref.raw_text = extractedText;
              } else if (foundText.length > 20) {
                ref.raw_text = foundText;
              }
            }
          } else if (bibliography) {
            // Fallback: if we can't find it, at least try to reconstruct raw_text
            if (!ref.raw_text) {
              const parts: string[] = [];
              if (ref.authors.length > 0) {
                parts.push(ref.authors.join(', '));
              }
              if (ref.title) {
                parts.push(ref.title);
              }
              if (ref.venue) {
                parts.push(ref.venue);
              }
              if (ref.year) {
                parts.push(ref.year);
              }
              if (parts.length > 0) {
                ref.raw_text = parts.join('. ');
              }
            }
            // ref.page_number is already set to startPage from llmExtractor
          }
        });
      }
      
      return {
        references,
        bibliographyStartPage: bibliography?.startPage || startPage,
        bibliographyEndPage: bibliography?.endPage || pdfDoc.numPages,
        method: 'llm',
      };
    } catch (err) {
      console.warn('LLM extraction failed:', err);

      // Fall back to GROBID if we still have the PDF file
      if (pdfFile) {
        try {
          const grobidRefs = await extractReferencesWithGrobid(pdfFile, settings);
          // GROBID doesn't provide page numbers, so find them
          const fallbackPage = bibliography?.startPage || Math.max(1, pdfDoc.numPages - 3);
          assignPageNumbersToReferences(grobidRefs, pdfDoc, bibliography, fallbackPage);
          return {
            references: grobidRefs,
            bibliographyStartPage: fallbackPage,
            bibliographyEndPage: bibliography?.endPage || pdfDoc.numPages,
            method: 'grobid',
            error: `LLM extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}. Using GROBID fallback.`,
          };
        } catch (gerr) {
          return {
            references: [],
            bibliographyStartPage: bibliography?.startPage || pdfDoc.numPages,
            bibliographyEndPage: bibliography?.endPage || pdfDoc.numPages,
            method: 'llm',
            error: `LLM extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}. GROBID fallback also failed: ${gerr instanceof Error ? gerr.message : 'Unknown error'}.`,
          };
        }
      }

      return {
        references: [],
        bibliographyStartPage: bibliography?.startPage || pdfDoc.numPages,
        bibliographyEndPage: bibliography?.endPage || pdfDoc.numPages,
        method: 'llm',
        error: `LLM extraction failed: ${err instanceof Error ? err.message : 'Unknown error'}.`,
      };
    }
  }
  
  // Default (when LLM disabled): Use GROBID extraction (requires original PDF file)
  if (!pdfFile) {
    return {
      references: [],
      bibliographyStartPage: bibliography?.startPage || pdfDoc.numPages,
      bibliographyEndPage: bibliography?.endPage || pdfDoc.numPages,
      method: 'grobid',
      error: 'GROBID extraction requires the original PDF file. Please re-upload the PDF.',
    };
  }

  const references = await extractReferencesWithGrobid(pdfFile, settings);
  
  // GROBID doesn't provide page numbers, so we need to find them by searching in the PDF
  const fallbackPage = bibliography?.startPage || Math.max(1, pdfDoc.numPages - 3);
  assignPageNumbersToReferences(references, pdfDoc, bibliography, fallbackPage);
  
  return {
    references,
    bibliographyStartPage: bibliography?.startPage || 1,
    bibliographyEndPage: bibliography?.endPage || pdfDoc.numPages,
    method: 'grobid',
  };
}
