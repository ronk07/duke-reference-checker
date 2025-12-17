import React, { useCallback } from 'react';
import { Upload, FileText } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { extractTextFromPDF } from '../../services/pdf/pdfExtractor';
import { extractReferences } from '../../services/extraction/extractionOrchestrator';

export const FileUpload: React.FC = () => {
  const { setPdfFile, setReferences, setExtractionError, setIsExtracting, setTotalPages, settings } = useAppStore();
  
  const handleFile = useCallback(async (file: File) => {
    if (!file.type.includes('pdf')) {
      setExtractionError('Please upload a PDF file');
      return;
    }
    
    setPdfFile(file);
    setIsExtracting(true);
    setExtractionError(null);
    
    try {
      // Extract text from PDF
      const pdfDoc = await extractTextFromPDF(file);
      setTotalPages(pdfDoc.numPages);
      
      // Extract references (pass file for LLM extraction)
      const result = await extractReferences(pdfDoc, settings, file);
      
      if (result.error) {
        setExtractionError(result.error);
      }
      
      // Only show "No references found" error if we're not using LLM or if LLM failed without fallback
      if (result.references.length === 0 && !result.error) {
        if (settings.extraction.useLLM) {
          setExtractionError('No references found in the PDF. The LLM extraction may have failed to parse the bibliography. Try disabling LLM to use GROBID extraction, or check if the document has a bibliography section.');
        } else {
          setExtractionError('No references found in the PDF. Make sure the document has a bibliography section.');
        }
      }
      
      setReferences(
        result.references,
        result.bibliographyStartPage,
        result.bibliographyEndPage,
        result.method
      );
    } catch (error) {
      console.error('Extraction error:', error);
      setExtractionError(
        `Failed to process PDF: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    } finally {
      setIsExtracting(false);
    }
  }, [setPdfFile, setReferences, setExtractionError, setIsExtracting, setTotalPages, settings]);
  
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);
  
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);
  
  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);
  
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <label
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="w-full max-w-xl aspect-video border-2 border-dashed border-gray-700 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-accent hover:bg-accent/5 transition-colors"
      >
        <input
          type="file"
          accept=".pdf"
          onChange={handleChange}
          className="hidden"
        />
        <Upload className="w-16 h-16 text-gray-600 mb-4" />
        <p className="text-lg text-white mb-2">Drop your PDF here</p>
        <p className="text-sm text-text-secondary">or click to browse</p>
        <div className="mt-6 flex items-center gap-2 text-text-secondary">
          <FileText className="w-4 h-4" />
          <span className="text-sm">Supports academic papers with bibliography sections</span>
        </div>
      </label>
    </div>
  );
};

