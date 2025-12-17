import type {
  Reference,
  ValidationResult,
  ValidationStatus,
  ValidationSource,
  ValidationIssue,
  ValidationExplanation,
  ExplanationFieldKey,
  ValidationProgress,
  AppSettings,
} from '../../types';
import { validateWithCrossRef } from './crossrefValidator';
import { validateWithSemanticScholar } from './semanticScholarValidator';
import { validateWithOpenAlex } from './openAlexValidator';
import { validateWithArxiv } from './arxivValidator';
import { titleSimilarity } from '../utils/stringMatching';
import { compareAuthorLists } from '../utils/authorNormalization';
import { validateReferenceWithAgents } from './agentValidationOrchestrator';

// Thresholds matching the user's requirements
const TITLE_MATCH_THRESHOLD = 0.70;  // 70% for title
const AUTHOR_MATCH_THRESHOLD = 0.60; // 60% for authors
const YEAR_TOLERANCE = 1; // Allow 1 year difference

/**
 * Validate a single reference against all enabled sources
 * Routes to agent-based or api-only mode based on settings
 */
export async function validateReference(
  reference: Reference,
  settings: AppSettings
): Promise<ValidationResult> {
  // Route based on validation mode
  if (settings.validation.mode === 'agent-based') {
    console.log('Using agent-based validation mode');
    return await validateReferenceWithAgents(reference, settings);
  }

  // Default to api-only mode (existing behavior)
  console.log('Using api-only validation mode');
  const sources: ValidationSource[] = [];
  const delay = settings.validation.rateLimitDelay;
  
  console.log('Validating reference:', reference.title);
  
  // Run validations sequentially to respect rate limits
  if (settings.validation.enableCrossRef) {
    try {
      const result = await validateWithCrossRef(reference);
      sources.push({ ...result, step: 'api' });
      console.log('CrossRef result:', result.found, result.matchScore);
    } catch (e) {
      console.error('CrossRef error:', e);
    }
    await sleep(delay);
  }
  
  if (settings.validation.enableSemanticScholar) {
    try {
      const result = await validateWithSemanticScholar(
        reference,
        settings.apiKeys.semanticScholar || undefined
      );
      sources.push({ ...result, step: 'api' });
      console.log('Semantic Scholar result:', result.found, result.matchScore);
    } catch (e) {
      console.error('Semantic Scholar error:', e);
    }
    await sleep(delay);
  }
  
  if (settings.validation.enableOpenAlex) {
    try {
      const result = await validateWithOpenAlex(reference);
      sources.push({ ...result, step: 'api' });
      console.log('OpenAlex result:', result.found, result.matchScore);
    } catch (e) {
      console.error('OpenAlex error:', e);
    }
    await sleep(delay);
  }
  
  if (settings.validation.enableArxiv) {
    try {
      const result = await validateWithArxiv(reference);
      sources.push({ ...result, step: 'api' });
      console.log('ArXiv result:', result.found, result.matchScore);
    } catch (e) {
      console.error('ArXiv error:', e);
    }
    await sleep(delay);
  }
  
  // Determine overall status and issues
  const { status, issues, bestMatch, confidence } = analyzeResults(reference, sources);
  
  console.log('Final status:', status, 'confidence:', confidence);

  const explanationData = buildApiOnlyExplanationData(reference, status, issues, sources, bestMatch);
  const explanation = explanationDataToString(explanationData);
  
  return {
    referenceId: reference.id,
    status,
    sources,
    issues,
    bestMatch,
    explanation,
    explanationData,
  };
}

/**
 * Validate all references with progress callback
 */
export async function validateAllReferences(
  references: Reference[],
  settings: AppSettings,
  onProgress: (progress: ValidationProgress) => void,
  onResult: (result: ValidationResult) => void
): Promise<ValidationResult[]> {
  const results: ValidationResult[] = [];
  
  for (let i = 0; i < references.length; i++) {
    const reference = references[i];
    
    onProgress({
      total: references.length,
      completed: i,
      current: reference.title || `Reference ${i + 1}`,
    });
    
    try {
      const result = await validateReference(reference, settings);
      results.push(result);
      onResult(result);
    } catch (error) {
      console.error('Validation error for reference:', reference.title, error);
      // Create error result
      const errorResult: ValidationResult = {
        referenceId: reference.id,
        status: 'unverified',
        sources: [],
        issues: [{
          type: 'not_found',
          severity: 'error',
          message: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
          expected: '',
          found: '',
        }],
        bestMatch: null,
        explanation: `Validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        explanationData: {
          kind: 'unverified',
          queryLabel: 'Original query',
          querySummary: buildQuerySummary(reference),
          triedSources: [],
          nextSteps: ['Try validating again later.'],
        },
      };
      results.push(errorResult);
      onResult(errorResult);
    }
  }
  
  onProgress({
    total: references.length,
    completed: references.length,
    current: null,
  });
  
  return results;
}

function buildQuerySummary(reference: Reference): string {
  const parts: string[] = [];
  if (reference.title) parts.push(`title="${reference.title}"`);
  if (reference.authors.length > 0)
    parts.push(
      `authors="${reference.authors.slice(0, 3).join(', ')}${reference.authors.length > 3 ? ', …' : ''}"`
    );
  if (reference.year) parts.push(`year=${reference.year}`);
  if (reference.doi) parts.push(`doi=${reference.doi}`);
  return parts.join(' | ') || 'N/A';
}

function labelForSourceName(name: ValidationSource['name']): string {
  switch (name) {
    case 'semantic_scholar':
      return 'Semantic Scholar';
    case 'openalex':
      return 'OpenAlex';
    case 'crossref':
      return 'CrossRef';
    case 'arxiv':
      return 'arXiv';
    case 'web_search':
      return 'Web search';
    default:
      return name;
  }
}

function normalizeForCompare(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

function explanationDataToString(data: ValidationExplanation): string {
  // Keep CSV export useful, but UI should use explanationData.
  if (data.kind === 'verified') return `Query: ${data.querySummary}`;
  if (data.kind === 'unverified') {
    const tried = data.triedSources?.length ? data.triedSources.join(', ') : 'N/A';
    const steps = data.nextSteps?.length ? data.nextSteps.join(' ') : '';
    return `Not found. Tried: ${tried}. Query: ${data.querySummary}. ${steps}`.trim();
  }
  const differs = (data.whatDiffers || []).map((d) => `${d.field}: ${d.extracted} → ${d.matched}`).join('; ');
  return `Possible mismatch. Query: ${data.querySummary}. Differs: ${differs}`.trim();
}

function buildApiOnlyExplanationData(
  reference: Reference,
  status: ValidationStatus,
  issues: ValidationIssue[],
  sources: ValidationSource[],
  bestMatch: ValidationSource['retrievedData']
): ValidationExplanation {
  const primarySource = sources
    .filter((s) => s.found && s.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)[0];

  const sourceLabel = primarySource?.name ? labelForSourceName(primarySource.name) : 'Unknown source';
  const querySummary = buildQuerySummary(reference);

  if (status === 'unverified') {
    const tried = sources.map((s) => labelForSourceName(s.name));
    return {
      kind: 'unverified',
      queryLabel: 'Original query',
      querySummary,
      triedSources: tried,
      nextSteps: [
        'Check for OCR/typos in the title.',
        'Try removing venue/arXiv text and re-validate.',
        'If you have a DOI, verify via doi.org.',
      ],
    };
  }

  const hasDifferences = issues.some((i) => i.type !== 'not_found');
  if (status === 'verified' && !hasDifferences) {
    return {
      kind: 'verified',
      queryLabel: 'Original query',
      querySummary,
    };
  }

  // warning / error OR verified-with-differences: Option B + mini table
  const diffs: ValidationExplanation['whatDiffers'] = [];
  const matches: ValidationExplanation['whatMatches'] = [];

  const issueTypes = new Set(issues.map((i) => i.type));

  // Title
  if (reference.title && bestMatch?.title) {
    const score = titleSimilarity(reference.title, bestMatch.title);
    const differs = issueTypes.has('title_mismatch');
    if (differs) {
      diffs.push({
        field: 'title',
        extracted: reference.title,
        matched: bestMatch.title,
        note: `${(score * 100).toFixed(0)}% similarity`,
        severity: issues.find((i) => i.type === 'title_mismatch')?.severity,
      });
    } else {
      matches.push({ field: 'title', summary: `Title ${(score * 100).toFixed(0)}%` });
    }
  }

  // Authors
  if (reference.authors.length > 0 && (bestMatch?.authors?.length ?? 0) > 0) {
    const score = compareAuthorLists(reference.authors, bestMatch!.authors);
    const differs = issueTypes.has('author_mismatch');
    const extracted = reference.authors.join(', ');
    const matched = bestMatch!.authors.join(', ');
    if (differs) {
      diffs.push({
        field: 'authors',
        extracted,
        matched,
        note: `${(score * 100).toFixed(0)}% overlap`,
        severity: issues.find((i) => i.type === 'author_mismatch')?.severity,
      });
    } else {
      matches.push({ field: 'authors', summary: `Authors ${(score * 100).toFixed(0)}%` });
    }
  }

  // Year
  if (reference.year && bestMatch?.year) {
    const refYear = parseInt(reference.year);
    const matchYear = parseInt(bestMatch.year);
    const differs = issueTypes.has('year_mismatch') || reference.year !== bestMatch.year;
    if (!isNaN(refYear) && !isNaN(matchYear)) {
      const diff = Math.abs(refYear - matchYear);
      if (differs && diff > 0) {
        diffs.push({
          field: 'year',
          extracted: reference.year,
          matched: bestMatch.year,
          note: `Δ ${diff}`,
          severity: issues.find((i) => i.type === 'year_mismatch')?.severity,
        });
      } else {
        matches.push({ field: 'year', summary: 'Year matches' });
      }
    } else if (differs) {
      diffs.push({ field: 'year', extracted: reference.year, matched: bestMatch.year });
    }
  }

  // DOI
  if (reference.doi || bestMatch?.doi) {
    const extracted = reference.doi || 'N/A';
    const matched = bestMatch?.doi || 'N/A';
    const differs = normalizeForCompare(extracted) !== normalizeForCompare(matched);
    if (differs) diffs.push({ field: 'doi', extracted, matched });
    else matches.push({ field: 'doi', summary: 'DOI matches' });
  }

  // Venue
  if (reference.venue || bestMatch?.venue) {
    const extracted = reference.venue || 'N/A';
    const matched = bestMatch?.venue || 'N/A';
    const differs = normalizeForCompare(extracted) !== normalizeForCompare(matched);
    if (differs) diffs.push({ field: 'venue', extracted, matched });
    else matches.push({ field: 'venue', summary: 'Venue matches' });
  }

  const order: ExplanationFieldKey[] = ['year', 'title', 'authors', 'doi', 'venue'];
  diffs.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));
  matches.sort((a, b) => order.indexOf(a.field) - order.indexOf(b.field));

  const tableFields: ExplanationFieldKey[] = ['title', 'authors', 'year', 'venue', 'doi'];
  const table = tableFields.map((field) => {
    const extracted =
      field === 'title'
        ? reference.title || ''
        : field === 'authors'
          ? reference.authors.join(', ')
          : field === 'year'
            ? reference.year || ''
            : field === 'venue'
              ? reference.venue || ''
              : reference.doi || '';
    const matched =
      field === 'title'
        ? bestMatch?.title || ''
        : field === 'authors'
          ? bestMatch?.authors?.join(', ') || ''
          : field === 'year'
            ? bestMatch?.year || ''
            : field === 'venue'
              ? bestMatch?.venue || ''
              : bestMatch?.doi || '';
    return { field, extracted, matched };
  });

  return {
    kind: 'warn_or_error',
    queryLabel: 'Original query',
    querySummary,
    triedSources: primarySource?.name ? [sourceLabel] : undefined,
    whatDiffers: diffs,
    whatMatches: matches,
    table,
  };
}

function analyzeResults(
  reference: Reference,
  sources: ValidationSource[]
): { status: ValidationStatus; issues: ValidationIssue[]; bestMatch: ValidationSource['retrievedData']; confidence: number } {
  const issues: ValidationIssue[] = [];
  
  // Find best source (highest match score among found sources)
  const foundSources = sources.filter(s => s.found && s.matchScore > 0);
  
  if (foundSources.length === 0) {
    return {
      status: 'unverified',
      issues: [{
        type: 'not_found',
        severity: 'warning', // Changed to warning instead of error
        message: 'Reference not found in any database',
        expected: reference.title || '',
        found: '',
      }],
      bestMatch: null,
      confidence: 0,
    };
  }
  
  // Sort by match score and get best
  foundSources.sort((a, b) => b.matchScore - a.matchScore);
  const bestSource = foundSources[0];
  const bestMatch = bestSource.retrievedData;
  
  if (!bestMatch) {
    return { status: 'unverified', issues: [], bestMatch: null, confidence: 0 };
  }
  
  // Calculate detailed similarity scores
  let titleScore = 0;
  let authorScore = 0;
  let yearMatch = true;
  
  // Check title match using improved similarity
  if (reference.title && bestMatch.title) {
    titleScore = titleSimilarity(reference.title, bestMatch.title);
    console.log('Title similarity:', titleScore, reference.title, 'vs', bestMatch.title);
    
    if (titleScore < TITLE_MATCH_THRESHOLD) {
      issues.push({
        type: 'title_mismatch',
        severity: titleScore < 0.5 ? 'error' : 'warning',
        message: `Title similarity: ${(titleScore * 100).toFixed(0)}%`,
        expected: reference.title,
        found: bestMatch.title,
      });
    }
  } else if (reference.title && !bestMatch.title) {
    titleScore = 0;
  } else {
    // No title to compare, assume match
    titleScore = 1;
  }
  
  // Check author match
  if (reference.authors.length > 0 && bestMatch.authors.length > 0) {
    authorScore = compareAuthorLists(reference.authors, bestMatch.authors);
    console.log('Author similarity:', authorScore);
    
    if (authorScore < AUTHOR_MATCH_THRESHOLD) {
      issues.push({
        type: 'author_mismatch',
        severity: authorScore < 0.4 ? 'error' : 'warning',
        message: `Author overlap: ${(authorScore * 100).toFixed(0)}%`,
        expected: reference.authors.join(', '),
        found: bestMatch.authors.join(', '),
      });
    }
  } else {
    // No authors to compare, assume match
    authorScore = 1;
  }
  
  // Check year match
  if (reference.year && bestMatch.year) {
    const refYear = parseInt(reference.year);
    const matchYear = parseInt(bestMatch.year);
    
    if (!isNaN(refYear) && !isNaN(matchYear)) {
      const yearDiff = Math.abs(refYear - matchYear);
      yearMatch = yearDiff <= YEAR_TOLERANCE;
      
      if (yearDiff > 0) {
        issues.push({
          type: 'year_mismatch',
          severity: yearDiff > YEAR_TOLERANCE ? 'warning' : 'warning',
          message: `Year difference: ${yearDiff} year(s)`,
          expected: reference.year,
          found: bestMatch.year,
        });
      }
    }
  }
  
  // Calculate overall confidence score
  const confidence = (titleScore * 0.5) + (authorScore * 0.3) + (yearMatch ? 0.2 : 0);
  
  // Determine overall status based on confidence and matches
  let status: ValidationStatus;
  
  if (titleScore >= TITLE_MATCH_THRESHOLD && authorScore >= AUTHOR_MATCH_THRESHOLD && yearMatch) {
    // All checks pass - VERIFIED
    status = 'verified';
  } else if (titleScore >= TITLE_MATCH_THRESHOLD || authorScore >= AUTHOR_MATCH_THRESHOLD) {
    // Partial match - could be the same paper with different metadata
    if (titleScore >= 0.5 || authorScore >= 0.5) {
      status = 'warning'; // Partial match / needs review
    } else {
      status = 'error'; // Low confidence match
    }
  } else if (bestSource.matchScore > 0.5) {
    // Source found something but scores are low
    status = 'warning';
  } else {
    status = 'error';
  }
  
  return { status, issues, bestMatch, confidence };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
