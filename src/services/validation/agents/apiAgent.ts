import type { Reference, ValidationSource, AppSettings } from '../../../types';
import { validateWithCrossRef } from '../crossrefValidator';
import { validateWithSemanticScholar } from '../semanticScholarValidator';
import { validateWithOpenAlex } from '../openAlexValidator';
import { validateWithArxiv } from '../arxivValidator';
import { createLogger } from '../../utils/logger';

/**
 * API Agent: Runs all enabled API validators in parallel
 * Returns immediately if any API finds a match
 */
export async function validateWithAPIAgent(
  reference: Reference,
  settings: AppSettings
): Promise<ValidationSource[]> {
  const log = createLogger('APIAgent');
  log.info('Starting', { title: reference.title, id: reference.id });
  const sources: ValidationSource[] = [];
  const promises: Promise<ValidationSource>[] = [];

  // Build parallel promises for all enabled APIs
  if (settings.validation.enableCrossRef) {
    promises.push(
      validateWithCrossRef(reference).catch((error) => {
        console.error('CrossRef error in API Agent:', error);
        return {
          name: 'crossref' as const,
          found: false,
          matchScore: 0,
          retrievedData: null,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        };
      })
    );
  }

  if (settings.validation.enableSemanticScholar) {
    promises.push(
      validateWithSemanticScholar(
        reference,
        settings.apiKeys.semanticScholar || undefined
      ).catch((error) => {
        console.error('Semantic Scholar error in API Agent:', error);
        return {
          name: 'semantic_scholar' as const,
          found: false,
          matchScore: 0,
          retrievedData: null,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        };
      })
    );
  }

  if (settings.validation.enableOpenAlex) {
    promises.push(
      validateWithOpenAlex(reference).catch((error) => {
        console.error('OpenAlex error in API Agent:', error);
        return {
          name: 'openalex' as const,
          found: false,
          matchScore: 0,
          retrievedData: null,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        };
      })
    );
  }

  if (settings.validation.enableArxiv) {
    promises.push(
      validateWithArxiv(reference).catch((error) => {
        console.error('ArXiv error in API Agent:', error);
        return {
          name: 'arxiv' as const,
          found: false,
          matchScore: 0,
          retrievedData: null,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
        };
      })
    );
  }

  // Run all validators in parallel
  log.time('parallelAPIs');
  const results = await Promise.all(promises);
  log.timeEnd('parallelAPIs');
  sources.push(...results.map((r) => ({ ...r, step: 'api' as const })));

  log.info('Results', {
    total: sources.length,
    found: sources.filter((s) => s.found).length,
    bestScore: Math.max(...sources.map((s) => s.matchScore), 0),
  });

  return sources;
}

