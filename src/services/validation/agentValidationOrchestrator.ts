import type {
  Reference,
  ValidationResult,
  ValidationStatus,
  ValidationSource,
  ValidationIssue,
  ValidationExplanation,
  ExplanationFieldKey,
  AppSettings,
} from '../../types';
import { validateWithAPIAgent } from './agents/apiAgent';
import { retryAPIsWithEnhancedQueries } from './agents/queryEnhancementAgent';
import { searchWebForReference } from './agents/webSearchAgent';
import { generateExplanation } from './agents/explanationAgent';
import { titleSimilarity } from '../utils/stringMatching';
import { compareAuthorLists } from '../utils/authorNormalization';
import { createLogger } from '../utils/logger';

// Thresholds matching the user's requirements
const TITLE_MATCH_THRESHOLD = 0.70; // 70% for title
const AUTHOR_MATCH_THRESHOLD = 0.60; // 60% for authors
const YEAR_TOLERANCE = 1; // Allow 1 year difference
const WEB_SEARCH_CONFIDENCE_THRESHOLD = 0.70; // 70% confidence for web search

interface AttemptedQuery {
  description: string;
  title: string;
  authors: string[];
  year?: string;
}

/**
 * Validate a reference using the agent-based approach
 * Sequential flow: API Agent → Query Enhancement → Web Search → Explanation
 */
export async function validateReferenceWithAgents(
  reference: Reference,
  settings: AppSettings
): Promise<ValidationResult> {
  const log = createLogger('AgentValidation');
  const refLabel = `${reference.title || 'Untitled'} (${reference.id})`;
  log.groupCollapsed(`ValidateReference ${refLabel}`);
  log.time('total');
  
  const allSources: ValidationSource[] = [];
  const attemptedQueries: AttemptedQuery[] = [];
  
  // Track original query
  attemptedQueries.push({
    description: 'Original query',
    title: reference.title || '',
    authors: reference.authors,
    year: reference.year,
  });

  // Step 1: API Agent - Run parallel API calls
  log.groupCollapsed('Step1 APIAgent');
  log.time('apiAgent');
  const apiSources = await validateWithAPIAgent(reference, settings);
  log.timeEnd('apiAgent');
  allSources.push(...apiSources);
  log.info('API results', summarizeSources(apiSources));
  log.groupEnd();

  // Check if we found a good match
  const apiMatch = findBestMatch(apiSources);
  if (apiMatch && apiMatch.matchScore > 0.7) {
    log.info('Early exit: match from APIs', { source: apiMatch.name, score: apiMatch.matchScore });
    const { status, issues, bestMatch } = analyzeResults(reference, allSources);
    const explanation = await buildValidationExplanation({
      reference,
      status,
      issues,
      sources: allSources,
      bestMatch,
      attemptedQueries,
      webSearchResult: null,
      settings,
    });
    log.timeEnd('total');
    log.groupEnd();
    return {
      referenceId: reference.id,
      status,
      sources: allSources,
      issues,
      bestMatch,
      explanation: explanationDataToString(explanation),
      explanationData: explanation,
    };
  }

  // Step 2: Query Enhancement Agent - Generate enhanced queries and retry APIs
  log.groupCollapsed('Step2 QueryEnhancement');
  log.time('queryEnhancement');
  const enhancedSources = await retryAPIsWithEnhancedQueries(reference, settings);
  log.timeEnd('queryEnhancement');
  allSources.push(...enhancedSources);
  log.info('Enhanced query results', summarizeSources(enhancedSources));
  log.groupEnd();

  // Track enhanced queries (we'll use a simplified version for explanation)
  attemptedQueries.push({
    description: 'Enhanced queries (via LLM)',
    title: reference.title || '',
    authors: reference.authors,
    year: reference.year,
  });

  // Check if enhanced queries found a match
  const enhancedMatch = findBestMatch(enhancedSources);
  if (enhancedMatch && enhancedMatch.matchScore > 0.7) {
    log.info('Early exit: match from enhanced queries', { source: enhancedMatch.name, score: enhancedMatch.matchScore });
    const { status, issues, bestMatch } = analyzeResults(reference, allSources);
    const explanation = await buildValidationExplanation({
      reference,
      status,
      issues,
      sources: allSources,
      bestMatch,
      attemptedQueries,
      webSearchResult: null,
      settings,
    });
    log.timeEnd('total');
    log.groupEnd();
    return {
      referenceId: reference.id,
      status,
      sources: allSources,
      issues,
      bestMatch,
      explanation: explanationDataToString(explanation),
      explanationData: explanation,
    };
  }

  // Step 3: Web Search Agent - Search web using Perplexity
  log.groupCollapsed('Step3 WebSearch(Perplexity)');
  log.time('webSearch');
  let webSearchResult: ValidationSource | null = null;
  try {
    webSearchResult = await searchWebForReference(reference, settings);
    log.timeEnd('webSearch');
    log.info('Web search result', webSearchResult);
    if (webSearchResult.found) {
      allSources.push(webSearchResult);
      
      // If confidence is high enough, verify
      if (webSearchResult.confidence && webSearchResult.confidence >= WEB_SEARCH_CONFIDENCE_THRESHOLD) {
        log.info('Early exit: web search confidence threshold met', { confidence: webSearchResult.confidence });
        const { status, issues, bestMatch } = analyzeResults(reference, allSources);
        const explanation = await buildValidationExplanation({
          reference,
          status,
          issues,
          sources: allSources,
          bestMatch,
          attemptedQueries,
          webSearchResult,
          settings,
        });
        log.groupEnd();
        log.timeEnd('total');
        log.groupEnd();
        return {
          referenceId: reference.id,
          status,
          sources: allSources,
          issues,
          bestMatch,
          explanation: explanationDataToString(explanation),
          explanationData: explanation,
        };
      }
    }
  } catch (error) {
    log.timeEnd('webSearch');
    log.error('Web search failed', error);
  }
  log.groupEnd();

  // Final analysis
  const { status, issues, bestMatch } = analyzeResults(reference, allSources);
  const explanation = await buildValidationExplanation({
    reference,
    status,
    issues,
    sources: allSources,
    bestMatch,
    attemptedQueries,
    webSearchResult,
    settings,
  });

  log.info('Final status', { status, bestSource: findBestMatch(allSources)?.name ?? null });
  log.timeEnd('total');
  log.groupEnd();

  return {
    referenceId: reference.id,
    status: status === 'unverified' ? 'unverified' : status, // Ensure unverified if nothing found
    sources: allSources,
    issues,
    bestMatch,
    explanation: explanationDataToString(explanation),
    explanationData: explanation,
  };
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
  if (data.kind === 'verified') return `Query: ${data.querySummary}`;
  if (data.kind === 'unverified') {
    const tried = data.triedSources?.length ? data.triedSources.join(', ') : 'N/A';
    const steps = data.nextSteps?.length ? data.nextSteps.join(' ') : '';
    return `Not found. Tried: ${tried}. Query: ${data.querySummary}. ${steps}`.trim();
  }
  const differs = (data.whatDiffers || []).map((d) => `${d.field}: ${d.extracted} → ${d.matched}`).join('; ');
  return `Possible mismatch. Query: ${data.querySummary}. Differs: ${differs}`.trim();
}

async function buildValidationExplanation(args: {
  reference: Reference;
  status: ValidationStatus;
  issues: ValidationIssue[];
  sources: ValidationSource[];
  bestMatch: ValidationSource['retrievedData'];
  attemptedQueries: AttemptedQuery[];
  webSearchResult: ValidationSource | null;
  settings: AppSettings;
}): Promise<ValidationExplanation> {
  const { reference, status, issues, sources, bestMatch, attemptedQueries, webSearchResult, settings } = args;

  const queryLabel = 'Original query';
  const querySummary = buildQuerySummary(reference);

  const primarySource = sources
    .filter((s) => s.found && s.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)[0];

  const hasDifferences = issues.some((i) => i.type !== 'not_found');
  // Verified: show only the original query unless there were differences (e.g. year mismatch within tolerance)
  if (status === 'verified' && !hasDifferences) {
    return { kind: 'verified', queryLabel, querySummary };
  }

  // Warning/Error OR verified-with-differences: Option B + mini table
  if (status === 'warning' || status === 'error' || status === 'verified') {
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

    const triedSources = [
      ...(sources.some((s) => s.step === 'api') ? ['APIs'] : []),
      ...(sources.some((s) => s.step === 'query_enhanced') ? ['Query-enhanced APIs'] : []),
      ...(sources.some((s) => s.name === 'web_search') ? ['Web search'] : []),
    ];

    const srcLabel = primarySource?.name ? labelForSourceName(primarySource.name) : undefined;

    return {
      kind: 'warn_or_error',
      queryLabel,
      querySummary,
      triedSources: srcLabel ? [srcLabel, ...triedSources] : triedSources,
      whatDiffers: diffs,
      whatMatches: matches,
      table,
    };
  }

  // Unverified: keep the actionable product copy (Option E).
  // Still call the LLM explanation agent to enrich suggestions, but render our simple structure.
  const explanationIssue = await generateExplanation(
    reference,
    attemptedQueries,
    sources.filter((s) => s.name !== 'web_search'),
    webSearchResult,
    settings
  );

  const triedSources = Array.from(new Set(sources.map((s) => labelForSourceName(s.name))));
  const nextSteps = [
    'Check for OCR/typos in the title.',
    'Try removing venue/arXiv text and re-validate.',
    'If you have a DOI, verify via doi.org.',
  ];

  // If the LLM gave something short/useful, append it as the last suggestion.
  const llmHint = (explanationIssue.message || '').trim();
  if (llmHint && llmHint.length < 240) nextSteps.push(llmHint);

  return {
    kind: 'unverified',
    queryLabel,
    querySummary,
    triedSources,
    nextSteps,
  };
}

function summarizeSources(sources: ValidationSource[]) {
  const byName = sources.reduce<Record<string, { found: boolean; score: number; errors: number }>>((acc, s) => {
    acc[s.name] = { found: s.found, score: s.matchScore, errors: s.errors.length };
    return acc;
  }, {});
  const found = sources.filter((s) => s.found).length;
  const best = sources.reduce((m, s) => Math.max(m, s.matchScore), 0);
  return { found, best, byName };
}

function findBestMatch(sources: ValidationSource[]): ValidationSource | null {
  const foundSources = sources.filter((s) => s.found && s.matchScore > 0);
  if (foundSources.length === 0) return null;
  
  foundSources.sort((a, b) => b.matchScore - a.matchScore);
  return foundSources[0];
}

function analyzeResults(
  reference: Reference,
  sources: ValidationSource[]
): { status: ValidationStatus; issues: ValidationIssue[]; bestMatch: ValidationSource['retrievedData']; confidence: number } {
  const issues: ValidationIssue[] = [];

  // Find best source (highest match score among found sources)
  const foundSources = sources.filter((s) => s.found && s.matchScore > 0);

  if (foundSources.length === 0) {
    return {
      status: 'unverified',
      issues: [],
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

  // Special-case: low-confidence web search matches should not trigger strict mismatch issues.
  // If Perplexity found something but confidence is below the verification threshold,
  // treat it as a "possible match" warning and avoid misleading author/year mismatch warnings.
  if (
    bestSource.name === 'web_search' &&
    typeof bestSource.confidence === 'number' &&
    bestSource.confidence > 0 &&
    bestSource.confidence < WEB_SEARCH_CONFIDENCE_THRESHOLD
  ) {
    issues.push({
      type: 'not_found',
      severity: 'warning',
      message: `Web search found a possible match (${(bestSource.confidence * 100).toFixed(0)}% confidence). Treat this as unverified unless you confirm manually.`,
      expected: reference.title || '',
      found: bestMatch.title || '',
    });

    return {
      status: 'warning',
      issues,
      bestMatch,
      confidence: bestSource.confidence,
    };
  }

  // Calculate detailed similarity scores
  let titleScore = 0;
  let authorScore = 0;
  let yearMatch = true;

  // Check title match using improved similarity
  if (reference.title && bestMatch.title) {
    titleScore = titleSimilarity(reference.title, bestMatch.title);
    // (Logging is handled by the orchestrator logger)

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
    // (Logging is handled by the orchestrator logger)

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

