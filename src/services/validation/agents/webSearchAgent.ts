import type { Reference, ValidationSource, RetrievedReferenceData, AppSettings } from '../../../types';
import { titleSimilarity } from '../../utils/stringMatching';
import { compareAuthorLists } from '../../utils/authorNormalization';
import { createLogger } from '../../utils/logger';

/**
 * Web Search Agent: Uses Perplexity API to search the web for academic references
 * Security: API calls are proxied through the server to keep API keys secure
 */
export async function searchWebForReference(
  reference: Reference,
  settings: AppSettings
): Promise<ValidationSource> {
  const log = createLogger('WebSearch(Perplexity)');
  const source: ValidationSource = {
    name: 'web_search',
    step: 'web_search',
    found: false,
    matchScore: 0,
    retrievedData: null,
    errors: [],
    confidence: 0,
  };

  try {
    // Build search query
    const searchQuery = buildSearchQuery(reference);
    log.groupCollapsed('Search');
    log.info('Query', searchQuery);

    // Call Perplexity API through server proxy (API key is server-side)
    log.time('perplexityCall');
    const perplexityResponse = await callPerplexityAPI('', searchQuery);
    log.timeEnd('perplexityCall');
    
    // Extract structured data from Perplexity response
    log.time('extractStructured');
    const extractedData = await extractStructuredDataFromPerplexity(
      perplexityResponse,
      reference,
      settings
    );
    log.timeEnd('extractStructured');

    if (!extractedData) {
      source.errors.push('Could not extract structured data from Perplexity response');
      log.warn('No structured data extracted');
      log.groupEnd();
      return source;
    }

    // Calculate confidence score
    const confidence = calculateConfidence(reference, extractedData);
    
    source.retrievedData = extractedData;
    source.found = confidence > 0;
    source.matchScore = confidence;
    source.confidence = confidence;

    log.info('Result', { confidence, extractedTitle: extractedData.title, extractedYear: extractedData.year, extractedVenue: extractedData.venue });
    log.groupEnd();

    return source;
  } catch (error) {
    log.error('Error', error);
    source.errors.push(
      `Perplexity API error: ${error instanceof Error ? error.message : 'Unknown error'}`
    );
    try { log.groupEnd(); } catch { /* ignore */ }
    return source;
  }
}

function buildSearchQuery(reference: Reference): string {
  const parts: string[] = [];
  
  if (reference.title) {
    parts.push(`"${reference.title}"`);
  }
  
  if (reference.authors.length > 0) {
    parts.push(`by ${reference.authors[0]}`);
  }
  
  if (reference.year) {
    parts.push(`published ${reference.year}`);
  }
  
  return `Find this academic paper: ${parts.join(' ')}. Return structured reference data including title, authors, year, venue, DOI, and URL in JSON format.`;
}

/**
 * Call Perplexity API through the server-side proxy
 * Security: API key is kept server-side, never exposed to the client
 */
async function callPerplexityAPI(_unusedApiKey: string, query: string): Promise<string> {
  const response = await fetch('/api/perplexity/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        {
          role: 'system',
          content: 'You are an academic reference finder. Search the web for academic papers and return structured reference data in JSON format. Focus on scholarly sources like arXiv, Google Scholar, academic journals, and conference proceedings.',
        },
        {
          role: 'user',
          content: query,
        },
      ],
      temperature: 0.1,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    throw new Error(`Perplexity API error: ${error.error?.message || error.error || `HTTP ${response.status}`}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

async function extractStructuredDataFromPerplexity(
  perplexityResponse: string,
  reference: Reference,
  settings: AppSettings
): Promise<RetrievedReferenceData | null> {
  // Try to parse JSON from Perplexity response
  let parsed: any = null;
  
  // Look for JSON in the response
  const jsonMatch = perplexityResponse.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      // JSON parsing failed, try LLM extraction
    }
  }

  // If we have structured data, use it
  if (parsed && parsed.title) {
    return {
      title: parsed.title || '',
      authors: Array.isArray(parsed.authors) ? parsed.authors : (parsed.authors ? [parsed.authors] : []),
      year: parsed.year?.toString() || '',
      venue: parsed.venue || parsed.journal || parsed.conference || '',
      doi: parsed.doi || null,
      url: parsed.url || parsed.link || null,
    };
  }

  // If no JSON found, use LLM to extract structured data
  return await extractWithLLM(perplexityResponse, reference, settings);
}

async function extractWithLLM(
  text: string,
  _reference: Reference,
  settings: AppSettings
): Promise<RetrievedReferenceData | null> {
  const { preferredLLM } = settings.extraction;
  const { apiKeys } = settings;

  const prompt = `Extract structured reference data from this text about an academic paper. Return ONLY valid JSON with: title, authors (array), year, venue, doi (or null), url (or null).

Text: ${text.substring(0, 2000)}

Return JSON only, no explanation.`;

  try {
    let responseText = '';
    
    switch (preferredLLM) {
      case 'openai':
        if (!apiKeys.openai) return null;
        responseText = await callOpenAIForExtraction(apiKeys.openai, prompt);
        break;
      case 'anthropic':
        if (!apiKeys.anthropic) return null;
        responseText = await callAnthropicForExtraction(apiKeys.anthropic, prompt);
        break;
      case 'gemini':
        if (!apiKeys.gemini) return null;
        responseText = await callGeminiForExtraction(apiKeys.gemini, prompt);
        break;
    }

    const parsed = JSON.parse(responseText.trim());
    return {
      title: parsed.title || '',
      authors: Array.isArray(parsed.authors) ? parsed.authors : [],
      year: parsed.year?.toString() || '',
      venue: parsed.venue || '',
      doi: parsed.doi || null,
      url: parsed.url || null,
    };
  } catch (error) {
    console.error('LLM extraction from Perplexity response failed:', error);
    return null;
  }
}

async function callOpenAIForExtraction(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Extract structured reference data. Return ONLY valid JSON.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.1,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '{}';
}

async function callAnthropicForExtraction(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-haiku-20240307',
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: prompt,
        },
      ],
      system: 'Extract structured reference data. Return ONLY valid JSON.',
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0]?.text || '{}';
}

async function callGeminiForExtraction(apiKey: string, prompt: string): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
                text: `Extract structured reference data. Return ONLY valid JSON.\n\n${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 500,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0]?.content?.parts[0]?.text || '{}';
}

function calculateConfidence(
  reference: Reference,
  retrieved: RetrievedReferenceData
): number {
  let confidence = 0;
  let weights = 0;

  // Title similarity (50% weight)
  if (reference.title && retrieved.title) {
    const titleScore = titleSimilarity(reference.title, retrieved.title);
    confidence += titleScore * 0.5;
    weights += 0.5;
  }

  // Author overlap (30% weight)
  if (reference.authors.length > 0 && retrieved.authors.length > 0) {
    const authorScore = compareAuthorLists(reference.authors, retrieved.authors);
    confidence += authorScore * 0.3;
    weights += 0.3;
  }

  // Year match (20% weight)
  if (reference.year && retrieved.year) {
    const refYear = parseInt(reference.year);
    const retYear = parseInt(retrieved.year);
    if (!isNaN(refYear) && !isNaN(retYear)) {
      const yearDiff = Math.abs(refYear - retYear);
      const yearScore = yearDiff === 0 ? 1 : yearDiff === 1 ? 0.9 : yearDiff === 2 ? 0.7 : 0.3;
      confidence += yearScore * 0.2;
      weights += 0.2;
    }
  }

  // Normalize by weights
  return weights > 0 ? confidence / weights : 0;
}

