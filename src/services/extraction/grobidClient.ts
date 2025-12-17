import type { Reference } from '../../types';
import type { AppSettings } from '../../types/settings';

interface GrobidProxyResponse {
  references: Reference[];
  method: 'grobid';
  elapsed_ms?: number;
  count?: number;
  error?: string;
  details?: string;
}

export async function extractReferencesWithGrobid(
  pdfFile: File,
  _settings: AppSettings
): Promise<Reference[]> {
  const form = new FormData();
  // Proxy expects field name "file"
  form.append('file', pdfFile, pdfFile.name || 'upload.pdf');

  const resp = await fetch('/api/extract/references', {
    method: 'POST',
    body: form,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`GROBID proxy error (${resp.status}): ${text.slice(0, 200)}`);
  }

  const data = (await resp.json()) as GrobidProxyResponse;
  if (!data || !Array.isArray(data.references)) {
    throw new Error('GROBID proxy returned invalid response');
  }

  return data.references;
}

