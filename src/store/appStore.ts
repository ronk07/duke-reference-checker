import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Reference,
  ValidationResult,
  ValidationProgress,
  AppSettings,
} from '../types';
import { defaultSettings } from '../types';

interface AppState {
  // PDF State
  pdfFile: File | null;
  pdfUrl: string | null;
  currentPage: number;
  totalPages: number;
  zoomLevel: number;
  
  // References State
  references: Reference[];
  selectedReferenceId: string | null;
  bibliographyStartPage: number;
  bibliographyEndPage: number;
  extractionMethod: 'grobid' | 'llm' | null;
  extractionError: string | null;
  
  // Validation State
  validationResults: Map<string, ValidationResult>;
  validationProgress: ValidationProgress | null;
  isValidating: boolean;
  
  // Settings
  settings: AppSettings;
  
  // UI State
  isSettingsOpen: boolean;
  isExtracting: boolean;
  
  // Actions
  setPdfFile: (file: File | null) => void;
  setCurrentPage: (page: number) => void;
  setTotalPages: (pages: number) => void;
  setZoomLevel: (level: number) => void;
  setReferences: (refs: Reference[], startPage: number, endPage: number, method: 'grobid' | 'llm') => void;
  setExtractionError: (error: string | null) => void;
  selectReference: (id: string | null) => void;
  getSelectedReference: () => Reference | null;
  updateReference: (id: string, updates: Partial<Reference>) => void;
  setValidationResult: (result: ValidationResult) => void;
  setValidationProgress: (progress: ValidationProgress | null) => void;
  setIsValidating: (validating: boolean) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  setSettingsOpen: (open: boolean) => void;
  setIsExtracting: (extracting: boolean) => void;
  reset: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial State
      pdfFile: null,
      pdfUrl: null,
      currentPage: 1,
      totalPages: 0,
      zoomLevel: 1.0,
      
      references: [],
      selectedReferenceId: null,
      bibliographyStartPage: 1,
      bibliographyEndPage: 1,
      extractionMethod: null,
      extractionError: null,
      
      validationResults: new Map(),
      validationProgress: null,
      isValidating: false,
      
      settings: defaultSettings,
      
      isSettingsOpen: false,
      isExtracting: false,
      
      // Actions
      setPdfFile: (file) => {
        const oldUrl = get().pdfUrl;
        if (oldUrl) {
          URL.revokeObjectURL(oldUrl);
        }
        
        const newUrl = file ? URL.createObjectURL(file) : null;
        
        set({
          pdfFile: file,
          pdfUrl: newUrl,
          references: [],
          selectedReferenceId: null,
          validationResults: new Map(),
          extractionError: null,
          currentPage: 1,
        });
      },
      
      setCurrentPage: (page) => set({ currentPage: page }),
      setTotalPages: (pages) => set({ totalPages: pages }),
      setZoomLevel: (level) => set({ zoomLevel: level }),
      
      setReferences: (refs, startPage, endPage, method) => set({
        references: refs,
        bibliographyStartPage: startPage,
        bibliographyEndPage: endPage,
        extractionMethod: method,
        validationResults: new Map(),
      }),
      
      setExtractionError: (error) => set({ extractionError: error }),
      
      selectReference: (id) => set({ selectedReferenceId: id }),
      
      getSelectedReference: () => {
        const { references, selectedReferenceId } = get();
        return references.find(r => r.id === selectedReferenceId) || null;
      },
      
      updateReference: (id, updates) => {
        const { references, validationResults } = get();
        const updatedRefs = references.map(ref => 
          ref.id === id ? { ...ref, ...updates } : ref
        );
        // Clear validation result for the edited reference since data changed
        const newResults = new Map(validationResults);
        newResults.delete(id);
        set({ references: updatedRefs, validationResults: newResults });
      },
      
      setValidationResult: (result) => {
        const newResults = new Map(get().validationResults);
        newResults.set(result.referenceId, result);
        set({ validationResults: newResults });
      },
      
      setValidationProgress: (progress) => set({ validationProgress: progress }),
      setIsValidating: (validating) => set({ isValidating: validating }),
      
      updateSettings: (newSettings) => set({
        settings: { ...get().settings, ...newSettings },
      }),
      
      setSettingsOpen: (open) => set({ isSettingsOpen: open }),
      setIsExtracting: (extracting) => set({ isExtracting: extracting }),
      
      reset: () => {
        const oldUrl = get().pdfUrl;
        if (oldUrl) {
          URL.revokeObjectURL(oldUrl);
        }
        
        set({
          pdfFile: null,
          pdfUrl: null,
          currentPage: 1,
          totalPages: 0,
          references: [],
          selectedReferenceId: null,
          validationResults: new Map(),
          validationProgress: null,
          isValidating: false,
          extractionError: null,
          isExtracting: false,
        });
      },
    }),
    {
      name: 'refchecker-settings',
      partialize: (state) => ({
        settings: state.settings,
      }),
    }
  )
);

