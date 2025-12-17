export type ValidationStatus = 'verified' | 'warning' | 'error' | 'unverified' | 'pending';

export interface ValidationSource {
  name: 'crossref' | 'semantic_scholar' | 'openalex' | 'arxiv' | 'web_search';
  found: boolean;
  matchScore: number;
  retrievedData: RetrievedReferenceData | null;
  errors: string[];
  confidence?: number; // Optional confidence score for web search results
  step?: 'api' | 'query_enhanced' | 'web_search'; // Which agentic step produced this source
}

export interface RetrievedReferenceData {
  title: string;
  authors: string[];
  year: string;
  venue: string;
  doi: string | null;
  url: string | null;
}

export type ExplanationKind = 'verified' | 'warn_or_error' | 'unverified';
export type ExplanationFieldKey = 'title' | 'authors' | 'year' | 'venue' | 'doi';

export interface ExplanationFieldDiff {
  field: ExplanationFieldKey;
  extracted: string;
  matched: string;
  note?: string;
  severity?: 'warning' | 'error';
}

export interface ExplanationFieldMatch {
  field: ExplanationFieldKey;
  summary: string;
}

export interface ValidationExplanation {
  kind: ExplanationKind;
  queryLabel: string; // e.g. "Original query"
  querySummary: string; // e.g. title/authors/year/doi
  triedSources?: string[]; // for unverified
  whatDiffers?: ExplanationFieldDiff[]; // for warning/error
  whatMatches?: ExplanationFieldMatch[]; // for warning/error
  table?: Array<{ field: ExplanationFieldKey; extracted: string; matched: string }>; // for warning/error
  nextSteps?: string[]; // for unverified
}

export interface ValidationResult {
  referenceId: string;
  status: ValidationStatus;
  sources: ValidationSource[];
  issues: ValidationIssue[];
  bestMatch: RetrievedReferenceData | null;
  /**
   * Human-readable explanation of how/why this status was reached.
   * Always present for completed validations.
   */
  explanation?: string;
  /**
   * Structured explanation for rendering product-friendly UI.
   */
  explanationData?: ValidationExplanation;
}

export interface ValidationIssue {
  type: 'title_mismatch' | 'author_mismatch' | 'year_mismatch' | 'doi_mismatch' | 'venue_mismatch' | 'not_found';
  severity: 'warning' | 'error';
  message: string;
  expected: string;
  found: string;
}

export interface ValidationProgress {
  total: number;
  completed: number;
  current: string | null;
}


