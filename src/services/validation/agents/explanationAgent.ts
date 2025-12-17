import type { Reference, ValidationIssue, ValidationSource, AppSettings } from '../../../types';

interface AttemptedQuery {
  description: string;
  title: string;
  authors: string[];
  year?: string;
}

/**
 * Explanation Agent: Generates detailed explanation when reference cannot be found
 */
export async function generateExplanation(
  reference: Reference,
  attemptedQueries: AttemptedQuery[],
  apiResults: ValidationSource[],
  webSearchResults: ValidationSource | null,
  settings: AppSettings
): Promise<ValidationIssue> {
  const { preferredLLM } = settings.extraction;
  const { apiKeys } = settings;

  // Build context for explanation
  const context = buildExplanationContext(
    reference,
    attemptedQueries,
    apiResults,
    webSearchResults
  );

  const prompt = `You are an academic reference validation expert. A reference could not be found after trying multiple strategies. Generate a helpful explanation.

${context}

Provide:
1. Summary of what was tried (queries, APIs, web search)
2. Potential reasons why the reference wasn't found:
   - Typo in extracted reference
   - Reference is very new/obscure
   - Reference is from non-indexed source
   - Abbreviation/formatting issues
   - Reference might not exist
3. Suggestions for manual verification

Keep the explanation concise but informative. Format as a clear paragraph.`;

  let explanation = '';

  try {
    switch (preferredLLM) {
      case 'openai':
        if (!apiKeys.openai) {
          explanation = generateFallbackExplanation(reference, attemptedQueries, apiResults);
          break;
        }
        explanation = await callOpenAI(apiKeys.openai, prompt);
        break;
      case 'anthropic':
        if (!apiKeys.anthropic) {
          explanation = generateFallbackExplanation(reference, attemptedQueries, apiResults);
          break;
        }
        explanation = await callAnthropic(apiKeys.anthropic, prompt);
        break;
      case 'gemini':
        if (!apiKeys.gemini) {
          explanation = generateFallbackExplanation(reference, attemptedQueries, apiResults);
          break;
        }
        explanation = await callGemini(apiKeys.gemini, prompt);
        break;
    }
  } catch (error) {
    console.error('Explanation Agent LLM call failed:', error);
    explanation = generateFallbackExplanation(reference, attemptedQueries, apiResults);
  }

  return {
    type: 'not_found',
    severity: 'warning',
    message: explanation,
    expected: reference.title || '',
    found: '',
  };
}

function buildExplanationContext(
  reference: Reference,
  attemptedQueries: AttemptedQuery[],
  apiResults: ValidationSource[],
  webSearchResults: ValidationSource | null
): string {
  const lines: string[] = [];

  lines.push(`Reference to find:`);
  lines.push(`- Title: ${reference.title || 'N/A'}`);
  lines.push(`- Authors: ${reference.authors.join(', ') || 'N/A'}`);
  lines.push(`- Year: ${reference.year || 'N/A'}`);
  lines.push(`- Venue: ${reference.venue || 'N/A'}`);

  lines.push(`\nQueries attempted (${attemptedQueries.length}):`);
  attemptedQueries.forEach((q, i) => {
    lines.push(`${i + 1}. ${q.description}: "${q.title}" by ${q.authors.join(', ')}${q.year ? ` (${q.year})` : ''}`);
  });

  lines.push(`\nAPI Results:`);
  apiResults.forEach((result) => {
    lines.push(`- ${result.name}: ${result.found ? 'Found (score: ' + result.matchScore.toFixed(2) + ')' : 'Not found'}`);
    if (result.errors.length > 0) {
      lines.push(`  Errors: ${result.errors.join(', ')}`);
    }
  });

  if (webSearchResults) {
    lines.push(`\nWeb Search Results:`);
    lines.push(`- Found: ${webSearchResults.found ? 'Yes' : 'No'}`);
    lines.push(`- Confidence: ${webSearchResults.confidence ? (webSearchResults.confidence * 100).toFixed(0) + '%' : 'N/A'}`);
    if (webSearchResults.errors.length > 0) {
      lines.push(`  Errors: ${webSearchResults.errors.join(', ')}`);
    }
  } else {
    lines.push(`\nWeb Search: Not attempted or failed`);
  }

  return lines.join('\n');
}

function generateFallbackExplanation(
  _reference: Reference,
  attemptedQueries: AttemptedQuery[],
  apiResults: ValidationSource[]
): string {
  const triedAPIs = apiResults.map((r) => r.name).join(', ');
  const foundCount = apiResults.filter((r) => r.found).length;

  return `Reference not found after trying ${attemptedQueries.length} query variations across ${apiResults.length} APIs (${triedAPIs}). ${foundCount > 0 ? 'Some APIs returned results but with low confidence scores.' : 'No APIs found matching results.'} Possible reasons: typo in extracted reference, very new/obscure paper, non-indexed source, or formatting issues. Please verify the reference manually.`;
}

async function callOpenAI(apiKey: string, prompt: string): Promise<string> {
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
          content: 'You are an academic reference validation expert. Provide clear, concise explanations.',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

async function callAnthropic(apiKey: string, prompt: string): Promise<string> {
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
      system: 'You are an academic reference validation expert. Provide clear, concise explanations.',
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = await response.json();
  return data.content[0]?.text || '';
}

async function callGemini(apiKey: string, prompt: string): Promise<string> {
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
                text: `You are an academic reference validation expert. Provide clear, concise explanations.\n\n${prompt}`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
        },
      }),
    }
  );

  if (!response.ok) {
    throw new Error(`Gemini API error: ${response.status}`);
  }

  const data = await response.json();
  return data.candidates[0]?.content?.parts[0]?.text || '';
}

