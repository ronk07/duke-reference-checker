import React, { useCallback, useMemo, useState } from 'react';
import { Play, FileJson, FileSpreadsheet, Loader2 } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { ReferenceItem } from './ReferenceItem';
import { validateAllReferences } from '../../services/validation/validationOrchestrator';

export const ReferenceList: React.FC = () => {
  const {
    references,
    selectedReferenceId,
    validationResults,
    validationProgress,
    isValidating,
    extractionMethod,
    extractionError,
    isExtracting,
    settings,
    bibliographyStartPage,
    setCurrentPage,
    selectReference,
    updateReference,
    setValidationResult,
    setValidationProgress,
    setIsValidating,
  } = useAppStore();

  type StatusFilter = 'all' | 'verified' | 'warning' | 'error';
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  
  const handleSelectReference = useCallback((ref: typeof references[0]) => {
    // First navigate to the page, then select the reference
    // This ensures the page is loaded before highlighting attempts
    const targetPage = ref.page_number || bibliographyStartPage;
    setCurrentPage(targetPage);
    
    // Small delay to ensure page navigation starts, then select reference
    // The highlighting effect will wait for the page to load
    setTimeout(() => {
      selectReference(ref.id);
    }, 50);
  }, [selectReference, setCurrentPage, bibliographyStartPage]);
  
  const handleValidateAll = useCallback(async () => {
    if (references.length === 0 || isValidating) return;
    
    setIsValidating(true);
    
    await validateAllReferences(
      references,
      settings,
      setValidationProgress,
      setValidationResult
    );
    
    setIsValidating(false);
    setValidationProgress(null);
  }, [references, settings, isValidating, setIsValidating, setValidationProgress, setValidationResult]);
  
  const exportAsJSON = useCallback(() => {
    const data = references.map(ref => ({
      ...ref,
      validation: validationResults.get(ref.id) || null,
    }));
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'references.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [references, validationResults]);
  
  const exportAsCSV = useCallback(() => {
    const headers = ['#', 'Title', 'Authors', 'Year', 'Venue', 'DOI', 'Status', 'Issues', 'Explanation'];
    
    const rows = references.map(ref => {
      const validation = validationResults.get(ref.id);
      return [
        ref.citation_number || '',
        `"${(ref.title || '').replace(/"/g, '""')}"`,
        `"${ref.authors.join('; ').replace(/"/g, '""')}"`,
        ref.year || '',
        `"${(ref.venue || '').replace(/"/g, '""')}"`,
        ref.doi || '',
        validation?.status || 'unverified',
        `"${(validation?.issues.map(i => i.message).join('; ') || '').replace(/"/g, '""')}"`,
        `"${(validation?.explanation || '').replace(/"/g, '""')}"`,
      ].join(',');
    });
    
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'references.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [references, validationResults]);
  
  // Calculate stats
  const verifiedCount = [...validationResults.values()].filter(r => r.status === 'verified').length;
  const warningCount = [...validationResults.values()].filter(r => r.status === 'warning').length;
  const errorCount = [...validationResults.values()].filter(r => r.status === 'error').length;

  const filteredReferences = useMemo(() => {
    if (statusFilter === 'all') return references;
    return references.filter((ref) => validationResults.get(ref.id)?.status === statusFilter);
  }, [references, validationResults, statusFilter]);
  
  return (
    <div className="flex flex-col h-full bg-secondary">
      {/* Header */}
      <div className="p-4 border-b border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-white">
            References ({references.length})
          </h2>
          
          <div className="flex items-center gap-2">
            {extractionMethod && (
              <span className="text-xs px-2 py-1 bg-gray-800 rounded text-text-secondary">
                {extractionMethod === 'llm' ? 'LLM' : 'GROBID'}
              </span>
            )}
            {settings.validation.mode === 'agent-based' && (
              <span className="text-xs px-2 py-1 bg-purple-900/50 border border-purple-700/50 rounded text-purple-200">
                Agent Mode
              </span>
            )}
          </div>
        </div>
        
        {/* Action buttons */}
        <div className="flex gap-2">
          <button
            onClick={handleValidateAll}
            disabled={references.length === 0 || isValidating || isExtracting}
            className="flex-1 flex items-center justify-center gap-2 px-4 py-2 bg-accent hover:bg-accent/80 text-black font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isValidating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Validating...
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Validate All
              </>
            )}
          </button>
          
          <button
            onClick={exportAsJSON}
            disabled={references.length === 0}
            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50 transition-colors"
            title="Export as JSON"
          >
            <FileJson className="w-5 h-5" />
          </button>
          
          <button
            onClick={exportAsCSV}
            disabled={references.length === 0}
            className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg disabled:opacity-50 transition-colors"
            title="Export as CSV"
          >
            <FileSpreadsheet className="w-5 h-5" />
          </button>
        </div>
        
        {/* Progress bar */}
        {validationProgress && (
          <div className="mt-3">
            <div className="flex justify-between text-xs text-text-secondary mb-1">
              <span>Validating: {validationProgress.current}</span>
              <span>{validationProgress.completed}/{validationProgress.total}</span>
            </div>
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{
                  width: `${(validationProgress.completed / validationProgress.total) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
        
        {/* Stats */}
        {validationResults.size > 0 && !isValidating && (
          <div className="flex flex-wrap gap-2 mt-3 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              aria-pressed={statusFilter === 'all'}
              className={`px-2 py-1 rounded border transition-colors ${
                statusFilter === 'all'
                  ? 'bg-gray-700/60 border-gray-600 text-white'
                  : 'bg-gray-900/20 border-gray-800 text-text-secondary hover:bg-gray-800/40'
              }`}
            >
              All ({references.length})
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('verified')}
              aria-pressed={statusFilter === 'verified'}
              className={`px-2 py-1 rounded border transition-colors ${
                statusFilter === 'verified'
                  ? 'bg-green-900/30 border-green-700/60 text-green-200'
                  : 'bg-gray-900/20 border-gray-800 text-success hover:bg-gray-800/40'
              }`}
            >
              ✓ {verifiedCount} verified
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('warning')}
              aria-pressed={statusFilter === 'warning'}
              className={`px-2 py-1 rounded border transition-colors ${
                statusFilter === 'warning'
                  ? 'bg-yellow-900/30 border-yellow-700/60 text-yellow-200'
                  : 'bg-gray-900/20 border-gray-800 text-warning hover:bg-gray-800/40'
              }`}
            >
              ⚠ {warningCount} warnings
            </button>

            <button
              type="button"
              onClick={() => setStatusFilter('error')}
              aria-pressed={statusFilter === 'error'}
              className={`px-2 py-1 rounded border transition-colors ${
                statusFilter === 'error'
                  ? 'bg-red-900/30 border-red-700/60 text-red-200'
                  : 'bg-gray-900/20 border-gray-800 text-error hover:bg-gray-800/40'
              }`}
            >
              ✗ {errorCount} errors
            </button>
          </div>
        )}
      </div>
      
      {/* Error message */}
      {extractionError && (
        <div className="mx-4 mt-4 p-3 bg-error/10 border border-error/30 rounded-lg">
          <p className="text-sm text-error">{extractionError}</p>
        </div>
      )}
      
      {/* Loading state */}
      {isExtracting && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <Loader2 className="w-8 h-8 animate-spin text-accent mx-auto mb-3" />
            <p className="text-text-secondary">Extracting references...</p>
          </div>
        </div>
      )}
      
      {/* Reference list */}
      {!isExtracting && (
        <div className="flex-1 overflow-y-auto">
          {references.length === 0 ? (
            <div className="p-8 text-center text-text-secondary">
              <p>No references found</p>
              <p className="text-sm mt-1">Upload a PDF to extract references</p>
            </div>
          ) : (
            filteredReferences.length === 0 ? (
              <div className="p-8 text-center text-text-secondary">
                <p>No references in this filter</p>
                <p className="text-sm mt-1">Try a different status filter</p>
              </div>
            ) : (
              filteredReferences.map(ref => (
                <ReferenceItem
                  key={ref.id}
                  reference={ref}
                  validationResult={validationResults.get(ref.id)}
                  isSelected={selectedReferenceId === ref.id}
                  onClick={() => handleSelectReference(ref)}
                  onEdit={(updates) => updateReference(ref.id, updates)}
                />
              ))
            )
          )}
        </div>
      )}
    </div>
  );
};

