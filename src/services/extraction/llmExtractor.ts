import { v4 as uuidv4 } from 'uuid';
import type { Reference } from '../../types';
import type { AppSettings } from '../../types/settings';

const EXTRACTION_PROMPT_PDF = `Analyze this PDF document and extract ALL references from the bibliography/references section. 

Return a JSON array where each element has these fields:
- raw_text: The EXACT verbatim text of the reference as it appears in the PDF, including the citation number (e.g. "[1]" or "1."), authors, title, venue, year - everything exactly as written (string)
- title: The paper/book title (string)
- authors: Array of author names (string[])
- year: Publication year (string)
- venue: Journal or conference name (string)
- doi: DOI if present (string or null)
- urls: Array of any URLs found (string[])

IMPORTANT: The raw_text field must contain the complete, exact text of each reference entry as it appears in the document. This is critical for highlighting.

Return ONLY valid JSON array, no explanation or markdown formatting. Example format:
[{"raw_text": "[1] John Smith, Jane Doe. Example Paper Title. In Proceedings of Conference 2023, pages 1-10, 2023.", "title": "Example Paper Title", "authors": ["John Smith", "Jane Doe"], "year": "2023", "venue": "Proceedings of Conference 2023", "doi": null, "urls": []}]`;

const EXTRACTION_PROMPT_TEXT = `Extract ALL bibliographic references from the following text. This text is from the references/bibliography section of an academic paper.

Return a JSON array where each element has these fields:
- raw_text: The EXACT verbatim text of the reference as it appears in the input, including the citation number (e.g. "[1]" or "1."), authors, title, venue, year - everything exactly as written (string)
- title: The paper/book title (string)
- authors: Array of author names (string[])
- year: Publication year (string)
- venue: Journal or conference name (string)
- doi: DOI if present (string or null)
- urls: Array of any URLs found (string[])

IMPORTANT: 
1. Extract every single reference entry. Do not skip any. Each numbered or bulleted reference should become one array element.
2. The raw_text field must contain the complete, exact text of each reference entry as it appears in the input. This is critical for highlighting.

Return ONLY valid JSON array, no explanation or markdown formatting. Example format:
[{"raw_text": "[1] John Smith, Jane Doe. Example Paper Title. In Proceedings of Conference 2023, pages 1-10, 2023.", "title": "Example Paper Title", "authors": ["John Smith", "Jane Doe"], "year": "2023", "venue": "Proceedings of Conference 2023", "doi": null, "urls": []}]

Bibliography text:
`;

interface LLMExtractedReference {
  raw_text?: string;
  title: string;
  authors: string[];
  year: string;
  venue: string;
  doi: string | null;
  urls: string[];
}

/**
 * Convert a File to base64 string
 */
async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
      const result = reader.result as string;
      // Remove the data URL prefix (e.g., "data:application/pdf;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = (error) => reject(error);
  });
}

/**
 * Extract references using LLM - optimized to use bibliography text when available
 */
export async function extractReferencesWithLLM(
  pdfFile: File,
  settings: AppSettings,
  startPage: number,
  bibliographyText?: string
): Promise<Reference[]> {
  const { preferredLLM } = settings.extraction;
  const { apiKeys } = settings;
  
  let extractedData: LLMExtractedReference[] = [];
  
  try {
    // If we have bibliography text, prefer text-mode extraction (faster + cheaper).
    if (bibliographyText && bibliographyText.trim().length > 0) {
      console.log('Using bibliography text for LLM extraction');
      switch (preferredLLM) {
        case 'openai':
          if (!apiKeys.openai) throw new Error('OpenAI API key not configured');
          extractedData = await extractWithOpenAIText(bibliographyText, apiKeys.openai);
          break;
        case 'anthropic':
          if (!apiKeys.anthropic) throw new Error('Anthropic API key not configured');
          extractedData = await extractWithAnthropicText(bibliographyText, apiKeys.anthropic);
          break;
        case 'gemini':
          if (!apiKeys.gemini) throw new Error('Gemini API key not configured');
          extractedData = await extractWithGeminiText(bibliographyText, apiKeys.gemini);
          break;
      }
    } else {
      // Fallback: use full PDF extraction
      console.log('Using full PDF for LLM extraction');
      const pdfBase64 = await fileToBase64(pdfFile);

      switch (preferredLLM) {
        case 'openai':
          if (!apiKeys.openai) throw new Error('OpenAI API key not configured');
          extractedData = await extractWithOpenAI(pdfBase64, apiKeys.openai);
          break;
        case 'anthropic':
          if (!apiKeys.anthropic) throw new Error('Anthropic API key not configured');
          extractedData = await extractWithAnthropic(pdfBase64, apiKeys.anthropic);
          break;
        case 'gemini':
          if (!apiKeys.gemini) throw new Error('Gemini API key not configured');
          extractedData = await extractWithGemini(pdfBase64, apiKeys.gemini);
          break;
      }
    }
  } catch (error) {
    console.error('LLM extraction failed:', error);
    throw error;
  }
  
  if (extractedData.length === 0) {
    console.warn('LLM returned empty array. This might indicate the bibliography was not found or parsed correctly.');
  }
  
  return extractedData.map((ref, index) => {
    // Use raw_text from LLM if available, otherwise reconstruct as fallback
    let rawText = ref.raw_text || '';
    
    if (!rawText) {
      // Fallback: reconstruct from components
      const parts: string[] = [];
      if (ref.authors.length > 0) {
        parts.push(ref.authors.join(', '));
      }
      if (ref.title) {
        parts.push(ref.title);
      }
      if (ref.venue) {
        parts.push(ref.venue);
      }
      if (ref.year) {
        parts.push(ref.year);
      }
      rawText = parts.length > 0 ? parts.join('. ') : '';
    }
    
    return {
      id: uuidv4(),
      raw_text: rawText,
      title: ref.title || '',
      authors: ref.authors || [],
      year: ref.year || '',
      venue: ref.venue || '',
      doi: ref.doi || null,
      urls: ref.urls || [],
      page_number: startPage,
      bounding_box: null,
      citation_number: index + 1,
    };
  });
}

async function extractWithOpenAIText(
  bibliographyText: string,
  apiKey: string
): Promise<LLMExtractedReference[]> {
  // Use text input for faster processing
  // Using gpt-5.2 (Dec 2025)
  const model = 'gpt-5.2';
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model, // Using detected or default model for text extraction
      messages: [
        {
          role: 'system',
          content: 'You are a reference extraction assistant. Extract all bibliographic references from the provided text and return them as a JSON array.',
        },
        {
          role: 'user',
          content: EXTRACTION_PROMPT_TEXT + bibliographyText,
        },
      ],
      max_completion_tokens: 16384,
      temperature: 0.1,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
  }
  
  const data = await response.json();
  const content = data.choices[0]?.message?.content || '[]';
  
  return parseJSONResponse(content);
}


async function extractWithOpenAI(
  pdfBase64: string,
  apiKey: string
): Promise<LLMExtractedReference[]> {
  // OpenAI supports PDF files via the file content type
  // Using gpt-5.2 (Dec 2025)
  const model = 'gpt-5.2';
  
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model, // Using detected or default model
      messages: [
        {
          role: 'system',
          content: 'You are a reference extraction assistant. Extract all bibliographic references from the PDF and return them as a JSON array.',
        },
        {
          role: 'user',
          content: [
            {
              type: 'file',
              file: {
                filename: 'document.pdf',
                file_data: `data:application/pdf;base64,${pdfBase64}`,
              },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT_PDF,
            },
          ],
        },
      ],
      max_completion_tokens: 16384,
      temperature: 0.1,
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`OpenAI API error: ${error.error?.message || 'Unknown error'}`);
  }
  
  const data = await response.json();
  const content = data.choices[0]?.message?.content || '[]';
  
  return parseJSONResponse(content);
}

async function extractWithAnthropicText(
  bibliographyText: string,
  apiKey: string
): Promise<LLMExtractedReference[]> {
  // Use text input for faster processing
  // Using claude-haiku-4-5 (Dec 2025)
  const model = 'claude-haiku-4-5';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 16384,
      messages: [
        {
          role: 'user',
          content: EXTRACTION_PROMPT_TEXT + bibliographyText,
        },
      ],
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || 'Unknown error'}`);
  }
  
  const data = await response.json();
  const content = data.content[0]?.text || '[]';
  
  return parseJSONResponse(content);
}

async function extractWithAnthropic(
  pdfBase64: string,
  apiKey: string
): Promise<LLMExtractedReference[]> {
  // Anthropic Claude supports PDF files directly via base64
  // Using claude-haiku-4-5 (Dec 2025)
  const model = 'claude-haiku-4-5';
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 16384,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'application/pdf',
                data: pdfBase64,
              },
            },
            {
              type: 'text',
              text: EXTRACTION_PROMPT_PDF,
            },
          ],
        },
      ],
    }),
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Anthropic API error: ${error.error?.message || 'Unknown error'}`);
  }
  
  const data = await response.json();
  const content = data.content[0]?.text || '[]';
  
  return parseJSONResponse(content);
}

async function extractWithGeminiText(
  bibliographyText: string,
  apiKey: string
): Promise<LLMExtractedReference[]> {
  // Use text input for faster processing
  // Using gemini-2.5-flash (Dec 2025)
  const model = 'gemini-2.5-flash';
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
                text: EXTRACTION_PROMPT_TEXT + bibliographyText,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
        },
      }),
    }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${error.error?.message || 'Unknown error'}`);
  }
  
  const data = await response.json();
  const content = data.candidates[0]?.content?.parts[0]?.text || '[]';
  
  return parseJSONResponse(content);
}

async function extractWithGemini(
  pdfBase64: string,
  apiKey: string
): Promise<LLMExtractedReference[]> {
  // Gemini supports PDF files via inline_data
  // Using gemini-2.5-flash (Dec 2025)
  const model = 'gemini-2.5-flash';
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
                inline_data: {
                  mime_type: 'application/pdf',
                  data: pdfBase64,
                },
              },
              {
                text: EXTRACTION_PROMPT_PDF,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 16384,
        },
      }),
    }
  );
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Gemini API error: ${error.error?.message || 'Unknown error'}`);
  }
  
  const data = await response.json();
  const content = data.candidates[0]?.content?.parts[0]?.text || '[]';
  
  return parseJSONResponse(content);
}

function parseJSONResponse(content: string): LLMExtractedReference[] {
  // Try to extract JSON from the response
  let jsonStr = content.trim();
  
  // Remove markdown code blocks if present
  jsonStr = jsonStr.replace(/```json\n?/g, '').replace(/```\n?/g, '');
  
  // Find the JSON array
  const startIndex = jsonStr.indexOf('[');
  const endIndex = jsonStr.lastIndexOf(']');
  
  if (startIndex !== -1 && endIndex !== -1) {
    jsonStr = jsonStr.substring(startIndex, endIndex + 1);
  }
  
  try {
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    return [];
  } catch (e) {
    console.error('Failed to parse LLM response as JSON:', e);
    return [];
  }
}
