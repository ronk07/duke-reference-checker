import type { Reference, ValidationSource, AppSettings } from '../../../types';
import { validateWithCrossRef } from '../crossrefValidator';
import { validateWithSemanticScholar } from '../semanticScholarValidator';
import { validateWithOpenAlex } from '../openAlexValidator';
import { validateWithArxiv } from '../arxivValidator';
import { createLogger } from '../../utils/logger';

interface EnhancedQuery {
  title: string;
  authors: string[];
  year?: string;
  description: string;
}

/**
 * Generate enhanced query variations using LLM
 */
async function enhanceQueriesWithLLM(
  reference: Reference,
  settings: AppSettings
): Promise<EnhancedQuery[]> {
  const { preferredLLM } = settings.extraction;
  const { apiKeys } = settings;

  const prompt = `Given this academic reference, generate 3-5 optimized search query variations that might help find it in academic databases. Handle:
- Abbreviations (e.g., "NIPS" → "Neural Information Processing Systems")
- Author name variations (full name, last name only, initials)
- Title variations (with/without punctuation, normalized)
- Combined queries (title + author, title + year)

Reference:
Title: ${reference.title || 'N/A'}
Authors: ${reference.authors.join(', ') || 'N/A'}
Year: ${reference.year || 'N/A'}
Venue: ${reference.venue || 'N/A'}

Return ONLY a JSON array of query objects, each with: { "title": string, "authors": string[], "year": string (optional), "description": string }
Example: [{"title": "Neural GPUs", "authors": ["Kaiser"], "year": "2016", "description": "Original query"}, {"title": "NeuralGPUs", "authors": ["Kaiser, L"], "description": "No spaces variant"}]
`;

  let responseText = '';

  try {
    switch (preferredLLM) {
      case 'openai':
        if (!apiKeys.openai) throw new Error('OpenAI API key not configured');
        responseText = await callOpenAI(apiKeys.openai, prompt);
        break;
      case 'anthropic':
        if (!apiKeys.anthropic) throw new Error('Anthropic API key not configured');
        responseText = await callAnthropic(apiKeys.anthropic, prompt);
        break;
      case 'gemini':
        if (!apiKeys.gemini) throw new Error('Gemini API key not configured');
        responseText = await callGemini(apiKeys.gemini, prompt);
        break;
    }
  } catch (error) {
    console.error('Query enhancement LLM call failed:', error);
    // Return original query as fallback
    return [
      {
        title: reference.title || '',
        authors: reference.authors,
        year: reference.year,
        description: 'Original query (fallback)',
      },
    ];
  }

  // Parse JSON response
  try {
    const parsed = JSON.parse(responseText.trim());
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
  } catch (e) {
    console.error('Failed to parse enhanced queries:', e);
  }

  // Fallback to original query
  return [
    {
      title: reference.title || '',
      authors: reference.authors,
      year: reference.year,
      description: 'Original query (fallback)',
    },
  ];
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
  const model = 'gpt-4o-mini'; // Cost-efficient model
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a query optimization assistant. Generate optimized search queries for academic databases. Return ONLY valid JSON array.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '[]';
}

async function callAnthropic(apiKey: string, prompt: string): Promise<string> {
  const model = 'claude-3-haiku-20240307'; // Cost-efficient model
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      system: 'You are a query optimization assistant. Generate optimized search queries for academic databases. Return ONLY valid JSON array.',
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return data.content[0]?.text || '[]';
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
  const model = 'gemini-1.5-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You are a query optimization assistant. Generate optimized search queries for academic databases. Return ONLY valid JSON array.\n\n${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 1000,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${error.error?.message || 'Unknown error'}`);
  }

  const data = await response.json();
  return data.candidates[0]?.content?.parts[0]?.text || '[]';
}

/**
 * Retry APIs with enhanced queries
 */
export async function retryAPIsWithEnhancedQueries(
  reference: Reference,
  settings: AppSettings
): Promise<ValidationSource[]> {
  const log = createLogger('QueryEnhancement');
  log.groupCollapsed('Start');
  
  // Generate enhanced queries
  log.time('llmGenerateQueries');
  const enhancedQueries = await enhanceQueriesWithLLM(reference, settings);
  log.timeEnd('llmGenerateQueries');
  log.info('Generated queries', enhancedQueries.map(q => ({ description: q.description, title: q.title, year: q.year, authors: q.authors.slice(0, 2) })));

  const allSources: ValidationSource[] = [];

  // Try each enhanced query
  for (const enhancedQuery of enhancedQueries) {
    // Create a modified reference with enhanced query data
    const enhancedReference: Reference = {
      ...reference,
      title: enhancedQuery.title || reference.title,
      authors: enhancedQuery.authors.length > 0 ? enhancedQuery.authors : reference.authors,
      year: enhancedQuery.year || reference.year,
    };

    log.groupCollapsed(`TryQuery ${enhancedQuery.description}`);
    log.time('parallelAPIs');

    // Run all APIs in parallel for this enhanced query
    const promises: Promise<ValidationSource>[] = [];

    if (settings.validation.enableCrossRef) {
      promises.push(
        validateWithCrossRef(enhancedReference).catch((error) => ({
          name: 'crossref' as const,
          found: false,
          matchScore: 0,
          retrievedData: null,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          step: 'query_enhanced' as const,
        }))
      );
    }

    if (settings.validation.enableSemanticScholar) {
      promises.push(
        validateWithSemanticScholar(
          enhancedReference,
          settings.apiKeys.semanticScholar || undefined
        ).catch((error) => ({
          name: 'semantic_scholar' as const,
          found: false,
          matchScore: 0,
          retrievedData: null,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          step: 'query_enhanced' as const,
        }))
      );
    }

    if (settings.validation.enableOpenAlex) {
      promises.push(
        validateWithOpenAlex(enhancedReference).catch((error) => ({
          name: 'openalex' as const,
          found: false,
          matchScore: 0,
          retrievedData: null,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          step: 'query_enhanced' as const,
        }))
      );
    }

    if (settings.validation.enableArxiv) {
      promises.push(
        validateWithArxiv(enhancedReference).catch((error) => ({
          name: 'arxiv' as const,
          found: false,
          matchScore: 0,
          retrievedData: null,
          errors: [error instanceof Error ? error.message : 'Unknown error'],
          step: 'query_enhanced' as const,
        }))
      );
    }

    const results = (await Promise.all(promises)).map((r) => ({ ...r, step: 'query_enhanced' as const }));
    log.timeEnd('parallelAPIs');
    allSources.push(...results);
    log.info('Results', results.map(r => ({ name: r.name, found: r.found, score: r.matchScore, errors: r.errors.length })));

    // If we found a good match, we can stop early (optional optimization)
    const foundMatch = results.some((r) => r.found && r.matchScore > 0.7);
    if (foundMatch) {
      log.info('Found strong match; stopping early');
      log.groupEnd();
      break;
    }
    log.groupEnd();
  }

  log.info('Summary', { total: allSources.length, found: allSources.filter(s => s.found).length });
  log.groupEnd();
  return allSources;
}

