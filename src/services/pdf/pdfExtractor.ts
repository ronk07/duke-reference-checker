import * as pdfjsLib from 'pdfjs-dist';

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

export interface PDFPage {
  pageNumber: number;
  text: string;
  width: number;
  height: number;
  startIndex: number; // Start index in fullText
  endIndex: number;   // End index in fullText
}

export interface PDFDocument {
  numPages: number;
  pages: PDFPage[];
  fullText: string;
}

/**
 * Extract text from a PDF file with better line break detection
 */
export async function extractTextFromPDF(file: File): Promise<PDFDocument> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  const pages: PDFPage[] = [];
  let fullText = '';
  let currentIndex = 0;

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    
    // Better text extraction that preserves line breaks
    let pageText = '';
    let lastY: number | null = null;
    
    for (const item of textContent.items as any[]) {
      if (!item.str) continue;
      
      // Detect line breaks based on Y position changes
      if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
        pageText += '\n';
      } else if (pageText.length > 0 && !pageText.endsWith(' ') && !pageText.endsWith('\n')) {
        pageText += ' ';
      }
      
      pageText += item.str;
      lastY = item.transform[5];
    }
    
    const startIndex = currentIndex;
    const endIndex = currentIndex + pageText.length;
    
    pages.push({
      pageNumber: i,
      text: pageText,
      width: viewport.width,
      height: viewport.height,
      startIndex,
      endIndex,
    });
    
    fullText += pageText + '\n\n';
    currentIndex += pageText.length + 2; // +2 for \n\n
  }

  return {
    numPages: pdf.numPages,
    pages,
    fullText,
  };
}

/**
 * Get PDF document for rendering
 */
export async function loadPDFDocument(file: File): Promise<pdfjsLib.PDFDocumentProxy> {
  const arrayBuffer = await file.arrayBuffer();
  return pdfjsLib.getDocument({ data: arrayBuffer }).promise;
}

/**
 * Find which page contains the given text index
 */
export function getPageForIndex(pages: PDFPage[], index: number): number {
  for (const page of pages) {
    if (index >= page.startIndex && index < page.endIndex + 2) { // +2 for the \n\n buffer
      return page.pageNumber;
    }
  }
  return pages.length > 0 ? pages[pages.length - 1].pageNumber : 1;
}
