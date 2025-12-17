import { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Set up the worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

export const PDFViewer: React.FC = () => {
  const {
    pdfUrl,
    currentPage,
    totalPages,
    zoomLevel,
    bibliographyStartPage,
    selectedReferenceId,
    references,
    setCurrentPage,
    setTotalPages,
    setZoomLevel,
  } = useAppStore();
  
  const pageRef = useRef<HTMLDivElement>(null);
  const [isTextLayerReady, setIsTextLayerReady] = useState(false);
  
  // Get the selected reference
  const selectedReference = references.find(r => r.id === selectedReferenceId);

  // Reset text-layer readiness when page/zoom changes (react-pdf will re-render the layer)
  useEffect(() => {
    setIsTextLayerReady(false);
  }, [currentPage, zoomLevel]);

  const onRenderTextLayerSuccess = useCallback(() => {
    setIsTextLayerReady(true);
  }, []);
  
  // Highlight the selected reference in the PDF text layer
  useEffect(() => {
    // Resolve the *actual* current page container
    const pageContainer =
      (document.querySelector(`.react-pdf__Page[data-page-number="${currentPage}"]`) as HTMLElement | null) ??
      (pageRef.current as HTMLElement | null);

    if (!pageContainer) return;

    // Clear any previous highlights first
    pageContainer.querySelectorAll('span.mark-highlight').forEach(el => el.classList.remove('mark-highlight'));
    
    if (!selectedReference) return;
    
    // Check if we're on the correct page
    const targetPage = selectedReference.page_number || bibliographyStartPage;
    if (currentPage !== targetPage) return;
    
    // Simple normalization: lowercase, remove diacritics, keep only alphanumeric
    const normalize = (text: string): string => {
      return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    };

    const highlightReference = () => {
      const currentPageContainer =
        (document.querySelector(`.react-pdf__Page[data-page-number="${currentPage}"]`) as HTMLElement | null) ??
        (pageRef.current as HTMLElement | null);
      if (!currentPageContainer) return;

      const textLayer = currentPageContainer.querySelector('.react-pdf__Page__textContent') as HTMLElement | null;
      if (!textLayer) return;

      // Clear highlights
      currentPageContainer.querySelectorAll('span.mark-highlight').forEach(el => el.classList.remove('mark-highlight'));
      
      // Get all spans and build page text
      const spans = Array.from(textLayer.querySelectorAll('span')) as HTMLElement[];
      if (spans.length === 0) return;

      // Build normalized page string and map back to spans
      let pageStr = '';
      const spanMap: { span: HTMLElement; start: number; end: number }[] = [];

      spans.forEach(span => {
        const text = normalize(span.textContent || '');
        if (text.length > 0) {
          const start = pageStr.length;
          pageStr += text;
          spanMap.push({ span, start, end: pageStr.length });
        }
      });

      // Build search terms from reference data
      // Priority 1: raw_text (now returned by LLM with exact text)
      // Priority 2: title (most unique identifier)
      // Priority 3: first author last name + title fragment
      const searchTerms: string[] = [];

      if (selectedReference.raw_text && selectedReference.raw_text.length > 10) {
        searchTerms.push(normalize(selectedReference.raw_text));
      }

      if (selectedReference.title && selectedReference.title.length > 10) {
        searchTerms.push(normalize(selectedReference.title));
      }

      if (selectedReference.authors.length > 0 && selectedReference.title) {
        // Use first author + title for more unique matching
        const firstAuthor = selectedReference.authors[0].split(' ').pop() || selectedReference.authors[0];
        searchTerms.push(normalize(firstAuthor + ' ' + selectedReference.title));
      }

      if (searchTerms.length === 0) {
        console.warn('No search terms available for highlighting');
        return;
      }

      // Try each search term
      let matchStart = -1;
      let matchEnd = -1;

      for (const searchStr of searchTerms) {
        if (searchStr.length < 10) continue;

        // Try to find the search string in the page
        const idx = pageStr.indexOf(searchStr);
        if (idx !== -1) {
          matchStart = idx;
          matchEnd = idx + searchStr.length;
          break;
        }

        // Try head match (first 40 chars) for long strings
        if (searchStr.length > 40) {
          const head = searchStr.substring(0, 40);
          const headIdx = pageStr.indexOf(head);
          if (headIdx !== -1) {
            matchStart = headIdx;
            // Extend to full length or until we can't match anymore
            matchEnd = headIdx + Math.min(searchStr.length, pageStr.length - headIdx);
            break;
          }
        }

        // Try shorter head match (first 25 chars)
        if (searchStr.length > 25) {
          const head = searchStr.substring(0, 25);
          const headIdx = pageStr.indexOf(head);
          if (headIdx !== -1) {
            matchStart = headIdx;
            matchEnd = headIdx + Math.min(searchStr.length, pageStr.length - headIdx);
            break;
          }
        }
      }

      // Apply highlights
      if (matchStart !== -1 && matchEnd > matchStart) {
        let firstHighlight = true;
        
        spanMap.forEach(({ span, start, end }) => {
          if (start < matchEnd && end > matchStart) {
            span.classList.add('mark-highlight');
            
            if (firstHighlight) {
              setTimeout(() => span.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100);
              firstHighlight = false;
            }
          }
        });
      } else {
        console.warn('Could not find reference text on page', currentPage);
      }
    };
    
    if (!isTextLayerReady) return;

    const timer = setTimeout(highlightReference, 75);
    return () => clearTimeout(timer);
  }, [selectedReference, currentPage, bibliographyStartPage, zoomLevel, isTextLayerReady, references]);
  
  const onDocumentLoadSuccess = useCallback(({ numPages }: { numPages: number }) => {
    setTotalPages(numPages);
  }, [setTotalPages]);
  
  const goToPrevPage = useCallback(() => {
    setCurrentPage(Math.max(1, currentPage - 1));
  }, [currentPage, setCurrentPage]);
  
  const goToNextPage = useCallback(() => {
    setCurrentPage(Math.min(totalPages, currentPage + 1));
  }, [currentPage, totalPages, setCurrentPage]);
  
  const goToBibliography = useCallback(() => {
    setCurrentPage(bibliographyStartPage);
  }, [bibliographyStartPage, setCurrentPage]);
  
  const zoomIn = useCallback(() => {
    setZoomLevel(Math.min(2.5, zoomLevel + 0.25));
  }, [zoomLevel, setZoomLevel]);
  
  const zoomOut = useCallback(() => {
    setZoomLevel(Math.max(0.5, zoomLevel - 0.25));
  }, [zoomLevel, setZoomLevel]);
  
  if (!pdfUrl) {
    return (
      <div className="flex-1 flex items-center justify-center bg-primary">
        <p className="text-text-secondary">No PDF loaded</p>
      </div>
    );
  }
  
  return (
    <div className="flex flex-col h-full bg-primary">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 bg-secondary border-b border-gray-800">
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevPage}
            disabled={currentPage <= 1}
            className="p-2 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          
          <span className="text-sm text-text-secondary min-w-[100px] text-center">
            Page {currentPage} of {totalPages}
          </span>
          
          <button
            onClick={goToNextPage}
            disabled={currentPage >= totalPages}
            className="p-2 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
        
        <button
          onClick={goToBibliography}
          className="flex items-center gap-2 px-3 py-1.5 text-sm bg-accent/20 text-accent hover:bg-accent/30 rounded transition-colors"
        >
          <BookOpen className="w-4 h-4" />
          Go to References
        </button>
        
        <div className="flex items-center gap-2">
          <button
            onClick={zoomOut}
            disabled={zoomLevel <= 0.5}
            className="p-2 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ZoomOut className="w-5 h-5" />
          </button>
          
          <span className="text-sm text-text-secondary min-w-[60px] text-center">
            {Math.round(zoomLevel * 100)}%
          </span>
          
          <button
            onClick={zoomIn}
            disabled={zoomLevel >= 2.5}
            className="p-2 hover:bg-gray-700 rounded disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ZoomIn className="w-5 h-5" />
          </button>
        </div>
      </div>
      
      {/* PDF Content */}
      <div className="flex-1 overflow-auto flex justify-center p-4">
        <div ref={pageRef}>
          <Document
            file={pdfUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            loading={
              <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-accent"></div>
              </div>
            }
            error={
              <div className="text-error p-4">Failed to load PDF</div>
            }
          >
            <Page
              key={`page_${currentPage}_${zoomLevel}`}
              pageNumber={currentPage}
              scale={zoomLevel}
              className="shadow-2xl"
              renderTextLayer={true}
              renderAnnotationLayer={true}
              onRenderTextLayerSuccess={onRenderTextLayerSuccess}
            />
          </Document>
        </div>
      </div>
    </div>
  );
};
