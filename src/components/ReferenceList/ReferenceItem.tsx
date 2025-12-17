import React, { useState, useEffect } from 'react';
import { ExternalLink, Pencil, Check, X } from 'lucide-react';
import type { Reference, ValidationResult } from '../../types';
import { ReferenceStatus } from './ReferenceStatus';

interface ReferenceItemProps {
  reference: Reference;
  validationResult?: ValidationResult;
  isSelected: boolean;
  onClick: () => void;
  onEdit: (updates: Partial<Reference>) => void;
}

export const ReferenceItem: React.FC<ReferenceItemProps> = ({
  reference,
  validationResult,
  isSelected,
  onClick,
  onEdit,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(reference.title);
  const [editAuthors, setEditAuthors] = useState(reference.authors.join(', '));
  const [editYear, setEditYear] = useState(reference.year);
  const [editVenue, setEditVenue] = useState(reference.venue);

  // Reset form when reference changes
  useEffect(() => {
    setEditTitle(reference.title);
    setEditAuthors(reference.authors.join(', '));
    setEditYear(reference.year);
    setEditVenue(reference.venue);
  }, [reference]);

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    const authorsArray = editAuthors
      .split(/[,;]/)
      .map(a => a.trim())
      .filter(a => a.length > 0);

    // Update raw_text to reflect the new values
    const parts: string[] = [];
    if (authorsArray.length > 0) parts.push(authorsArray.join(', '));
    if (editTitle) parts.push(editTitle);
    if (editVenue) parts.push(editVenue);
    if (editYear) parts.push(editYear);

    onEdit({
      title: editTitle,
      authors: authorsArray,
      year: editYear,
      venue: editVenue,
      raw_text: parts.join('. '),
    });
    setIsEditing(false);
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditTitle(reference.title);
    setEditAuthors(reference.authors.join(', '));
    setEditYear(reference.year);
    setEditVenue(reference.venue);
    setIsEditing(false);
  };

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
  };
  const status = validationResult?.status || 'unverified';
  const primarySource = validationResult?.sources
    ?.filter((s) => s.found && s.matchScore > 0)
    ?.sort((a, b) => b.matchScore - a.matchScore)?.[0];

  const verificationLabel = (() => {
    if (!validationResult || !primarySource) return null;
    const sourceName =
      primarySource.name === 'semantic_scholar'
        ? 'Semantic Scholar'
        : primarySource.name === 'openalex'
          ? 'OpenAlex'
          : primarySource.name === 'crossref'
            ? 'CrossRef'
            : primarySource.name === 'arxiv'
              ? 'arXiv'
              : 'Web search';

    const stepLabel =
      primarySource.step === 'query_enhanced'
        ? 'Query-enhanced API'
        : primarySource.step === 'web_search'
          ? 'Web search'
          : primarySource.step === 'api'
            ? 'API'
            : null;

    if (primarySource.name === 'web_search' && primarySource.confidence != null) {
      const verb = status === 'verified' ? 'Verified' : status === 'warning' ? 'Possible match' : 'Matched';
      return `${verb} via Web search (${(primarySource.confidence * 100).toFixed(0)}% confidence)`;
    }

    const verb = status === 'verified' ? 'Verified' : status === 'warning' ? 'Matched' : 'Matched';
    return `${verb} via ${sourceName}${stepLabel ? ` (${stepLabel})` : ''}`;
  })();

  const renderIssue = (issue: NonNullable<ValidationResult>['issues'][number], idx: number) => {
    const colorClass = issue.severity === 'error' ? 'text-error' : 'text-warning';
    return (
      <p key={idx} className={`text-xs ${colorClass}`}>
        {issue.message}
      </p>
    );
  };

  const explanation = validationResult?.explanation?.trim() || '';
  const explanationData = validationResult?.explanationData;

  const renderKeyValue = (label: string, value: string) => (
    <div className="flex flex-col gap-0.5">
      <div className="text-[11px] uppercase tracking-wide text-text-secondary/70">{label}</div>
      <div className="text-xs text-text-secondary whitespace-pre-wrap wrap-break-word">{value || '—'}</div>
    </div>
  );

  const renderExplanationContent = () => {
    if (explanationData) {
      if (explanationData.kind === 'verified') {
        return (
          <div className="space-y-3">
            {renderKeyValue(explanationData.queryLabel || 'Query', explanationData.querySummary)}
          </div>
        );
      }

      if (explanationData.kind === 'unverified') {
        return (
          <div className="space-y-3">
            <div className="text-xs font-medium text-white">Not found</div>
            {renderKeyValue(explanationData.queryLabel || 'Query', explanationData.querySummary)}
            {explanationData.triedSources && explanationData.triedSources.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-text-secondary/70">Tried</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {explanationData.triedSources.map((s) => (
                    <span
                      key={s}
                      className="text-[11px] px-2 py-0.5 bg-gray-800/70 border border-gray-700 rounded text-text-secondary"
                    >
                      {s}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {explanationData.nextSteps && explanationData.nextSteps.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-text-secondary/70">Next steps</div>
                <ul className="mt-1 list-disc pl-5 space-y-1 text-xs text-text-secondary">
                  {explanationData.nextSteps.map((s, idx) => (
                    <li key={idx} className="leading-relaxed">
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        );
      }

      // warn_or_error: Option B + table
      const differs = explanationData.whatDiffers || [];
      const matches = explanationData.whatMatches || [];
      const table = explanationData.table || [];

      return (
        <div className="space-y-3">
          {renderKeyValue(explanationData.queryLabel || 'Query', explanationData.querySummary)}

          {differs.length > 0 && (
            <div>
              <div className="text-xs font-medium text-white">What differs</div>
              <ul className="mt-1 list-disc pl-5 space-y-1 text-xs text-text-secondary">
                {differs.map((d, idx) => (
                  <li key={idx} className="leading-relaxed">
                    <span className="font-medium text-white/90">{d.field}</span>: {d.extracted || '—'} →{' '}
                    {d.matched || '—'}
                    {d.note ? <span className="text-text-secondary/80"> ({d.note})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {matches.length > 0 && (
            <div>
              <div className="text-xs font-medium text-white">What matches</div>
              <ul className="mt-1 list-disc pl-5 space-y-1 text-xs text-text-secondary">
                {matches.map((m, idx) => (
                  <li key={idx} className="leading-relaxed">
                    <span className="font-medium text-white/90">{m.field}</span>: {m.summary}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {table.length > 0 && (
            <div>
              <div className="text-xs font-medium text-white">Fields</div>
              <div className="mt-2 border border-gray-800 rounded-lg overflow-hidden">
                <div className="grid grid-cols-12 bg-gray-900/30 text-[11px] uppercase tracking-wide text-text-secondary/70">
                  <div className="col-span-2 px-3 py-2 border-r border-gray-800">Field</div>
                  <div className="col-span-5 px-3 py-2 border-r border-gray-800">Extracted</div>
                  <div className="col-span-5 px-3 py-2">Matched</div>
                </div>
                {table.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 text-xs">
                    <div className="col-span-2 px-3 py-2 border-t border-r border-gray-800 text-text-secondary">
                      {row.field}
                    </div>
                    <div className="col-span-5 px-3 py-2 border-t border-r border-gray-800 text-text-secondary wrap-break-word">
                      {row.extracted || '—'}
                    </div>
                    <div className="col-span-5 px-3 py-2 border-t border-gray-800 text-text-secondary wrap-break-word">
                      {row.matched || '—'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      );
    }

    // Fallback (older results in memory)
    if (!explanation) return null;
    return <div className="text-xs text-text-secondary whitespace-pre-wrap">{explanation}</div>;
  };
  
  // Inline editing mode
  if (isEditing) {
    return (
      <div
        className={`p-3 border-b border-gray-800 ${
          isSelected ? 'bg-accent/10 border-l-2 border-l-accent' : 'bg-gray-800/30'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-2">
          <ReferenceStatus status={status} />
          {reference.citation_number && (
            <span className="text-xs text-accent font-mono">[{reference.citation_number}]</span>
          )}
          <span className="text-xs text-text-secondary">Editing...</span>
          <div className="flex-1" />
          <button
            onClick={handleSave}
            className="p-1 text-success hover:bg-gray-700 rounded"
            title="Save"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            onClick={handleCancel}
            className="p-1 text-text-secondary hover:text-white hover:bg-gray-700 rounded"
            title="Cancel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-2">
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="Title"
            className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-sm text-white focus:outline-none focus:border-accent"
            onClick={(e) => e.stopPropagation()}
          />
          <input
            type="text"
            value={editAuthors}
            onChange={(e) => setEditAuthors(e.target.value)}
            placeholder="Authors (comma-separated)"
            className="w-full px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-white focus:outline-none focus:border-accent"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={editYear}
              onChange={(e) => setEditYear(e.target.value)}
              placeholder="Year"
              className="w-20 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-white focus:outline-none focus:border-accent"
              onClick={(e) => e.stopPropagation()}
            />
            <input
              type="text"
              value={editVenue}
              onChange={(e) => setEditVenue(e.target.value)}
              placeholder="Venue"
              className="flex-1 px-2 py-1.5 bg-gray-900 border border-gray-700 rounded text-xs text-white focus:outline-none focus:border-accent"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      onClick={onClick}
      className={`p-4 border-b border-gray-800 cursor-pointer transition-colors ${
        isSelected
          ? 'bg-accent/10 border-l-2 border-l-accent'
          : 'hover:bg-gray-800/50'
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-1">
          <ReferenceStatus status={status} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              {reference.citation_number && (
                <span className="text-xs text-accent font-mono mr-2">
                  [{reference.citation_number}]
                </span>
              )}
              
              <h3 className="text-sm font-medium text-white line-clamp-2 mb-1 inline">
                {reference.title || 'Unknown Title'}
              </h3>
            </div>
            
            <button
              onClick={startEditing}
              className="shrink-0 p-1.5 text-text-secondary hover:text-white hover:bg-gray-700 rounded transition-colors"
              title="Edit reference"
            >
              <Pencil className="w-3.5 h-3.5" />
            </button>
          </div>
          
          {reference.authors.length > 0 && (
            <p className="text-xs text-text-secondary line-clamp-1 mb-1">
              {reference.authors.slice(0, 3).join(', ')}
              {reference.authors.length > 3 && ' et al.'}
            </p>
          )}
          
          <div className="flex items-center gap-2 text-xs text-text-secondary">
            {reference.year && <span>{reference.year}</span>}
            {reference.venue && (
              <>
                <span>•</span>
                <span className="truncate">{reference.venue}</span>
              </>
            )}
          </div>

          {/* How it was verified (agentic step) */}
          {verificationLabel && status !== 'unverified' && (
            <div className="mt-1">
              <span className="text-xs text-text-secondary">
                {verificationLabel}
              </span>
            </div>
          )}

          {/* Explanation (always for validated references) */}
          {validationResult && (explanationData || explanation) && (
            <div className="mt-2">
              <details
                className="text-xs border border-gray-800 rounded-lg bg-gray-900/20"
                onClick={(e) => e.stopPropagation()}
              >
                <summary className="cursor-pointer select-none px-3 py-2 text-text-secondary hover:text-white">
                  <span className="font-medium">Explanation</span>
                </summary>
                <div className="px-3 pb-3 pt-2">
                  {renderExplanationContent()}
                </div>
              </details>
            </div>
          )}
          
          {reference.doi && (
            <a
              href={`https://doi.org/${reference.doi}`}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-accent hover:underline mt-1"
            >
              <ExternalLink className="w-3 h-3" />
              DOI
            </a>
          )}
          
          {/* Web search confidence */}
          {validationResult && validationResult.sources.some(s => s.name === 'web_search' && s.confidence) && (
            <div className="mt-1">
              {validationResult.sources
                .filter(s => s.name === 'web_search' && s.confidence)
                .map((source, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-0.5 bg-blue-900/30 border border-blue-700/50 rounded text-blue-200"
                  >
                    Web Search: {(source.confidence! * 100).toFixed(0)}% confidence
                  </span>
                ))}
            </div>
          )}

          {/* Validation issues */}
          {validationResult && validationResult.issues.length > 0 && (
            <div className="mt-2 space-y-1">
              {validationResult.issues.map(renderIssue)}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

