import express from 'express';
import multer from 'multer';
import { XMLParser } from 'fast-xml-parser';
import type { Reference } from '../src/types/reference';

const DEFAULT_PORT = 5174;
const DEFAULT_GROBID_URL = 'http://localhost:8070';

// Security: Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;
const requestCounts = new Map<string, { count: number; resetTime: number }>();

const app = express();

// Security: Parse JSON bodies with size limit
app.use(express.json({ limit: '1mb' }));

// Security: Basic rate limiting middleware
app.use((req, res, next) => {
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const clientData = requestCounts.get(clientIp);

  if (!clientData || now > clientData.resetTime) {
    requestCounts.set(clientIp, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    next();
  } else if (clientData.count >= RATE_LIMIT_MAX_REQUESTS) {
    res.status(429).json({ error: 'Too many requests. Please try again later.' });
    return;
  } else {
    clientData.count++;
    next();
  }
});

// Security: Set security headers
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// In-memory upload; do not write PDFs to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB
  },
});

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envString(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw && raw.trim().length > 0 ? raw.trim() : fallback;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function getText(node: unknown): string {
  if (!node) return '';
  if (typeof node === 'string') return node.trim();
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object') {
    const obj = node as Record<string, unknown>;
    const t = obj['#text'];
    if (typeof t === 'string') return t.trim();
  }
  return '';
}

function extractYearFromWhen(whenValue: string): string {
  const m = whenValue.match(/\b(19|20)\d{2}\b/);
  return m ? m[0] : '';
}

function normalizeDoi(raw: string): string {
  const trimmed = raw.trim();
  // Allow "10.xxxx/..." or a URL containing it.
  const m = trimmed.match(/(10\.\d{4,9}\/[-._;()/:a-z0-9]+)/i);
  return m ? m[1] : trimmed;
}

function pickVenueFromMonogrTitles(monogr: Record<string, unknown> | undefined): string {
  if (!monogr) return '';
  const titles = asArray(monogr['title'] as unknown);
  for (const t of titles) {
    if (typeof t === 'object' && t) {
      const level = (t as Record<string, unknown>)['@_level'];
      if (typeof level === 'string' && level.toLowerCase() === 'j') {
        const text = getText(t);
        if (text) return text;
      }
    }
  }
  // Fallback: any monogr title text.
  for (const t of titles) {
    const text = getText(t);
    if (text) return text;
  }
  return '';
}

function parseAuthorsFromAuthorNodes(authorNodes: unknown): string[] {
  const authors: string[] = [];
  for (const author of asArray(authorNodes as unknown)) {
    if (!author || typeof author !== 'object') continue;
    const a = author as Record<string, unknown>;
    const persName = a['persName'];
    if (!persName || typeof persName !== 'object') continue;
    const p = persName as Record<string, unknown>;
    const surname = getText(p['surname']);
    const forenames = asArray(p['forename'] as unknown)
      .map(fn => getText(fn))
      .filter(Boolean);

    const full = [forenames.join(' '), surname].map(s => s.trim()).filter(Boolean).join(' ').trim();
    if (full) authors.push(full);
  }
  return authors;
}

function extractRawReference(biblStruct: Record<string, unknown>): string {
  const notes = asArray(biblStruct['note'] as unknown);
  for (const note of notes) {
    if (!note || typeof note !== 'object') continue;
    const n = note as Record<string, unknown>;
    const type = n['@_type'];
    if (typeof type === 'string' && type.toLowerCase() === 'raw_reference') {
      const raw = getText(note);
      if (raw) return raw;
    }
  }
  return '';
}

function extractDoi(biblStruct: Record<string, unknown>): string | null {
  const idnos = asArray(biblStruct['idno'] as unknown);
  for (const idno of idnos) {
    if (!idno || typeof idno !== 'object') continue;
    const i = idno as Record<string, unknown>;
    const type = i['@_type'];
    if (typeof type === 'string' && type.toLowerCase() === 'doi') {
      const doi = normalizeDoi(getText(idno));
      return doi || null;
    }
  }
  return null;
}

function extractTitle(biblStruct: Record<string, unknown>): string {
  const analytic = biblStruct['analytic'];
  if (analytic && typeof analytic === 'object') {
    const a = analytic as Record<string, unknown>;
    const title = getText(a['title']);
    if (title) return title;
  }
  const monogr = biblStruct['monogr'];
  if (monogr && typeof monogr === 'object') {
    const m = monogr as Record<string, unknown>;
    const titles = asArray(m['title'] as unknown);
    for (const t of titles) {
      const text = getText(t);
      if (text) return text;
    }
  }
  return '';
}

function extractYear(biblStruct: Record<string, unknown>): string {
  // Most commonly: monogr.imprint.date[@_when]
  const monogr = biblStruct['monogr'];
  if (monogr && typeof monogr === 'object') {
    const m = monogr as Record<string, unknown>;
    const imprint = m['imprint'];
    if (imprint && typeof imprint === 'object') {
      const imp = imprint as Record<string, unknown>;
      const dates = asArray(imp['date'] as unknown);
      for (const d of dates) {
        if (typeof d === 'object' && d) {
          const when = (d as Record<string, unknown>)['@_when'];
          if (typeof when === 'string') {
            const y = extractYearFromWhen(when);
            if (y) return y;
          }
        }
        const y2 = extractYearFromWhen(getText(d));
        if (y2) return y2;
      }
    }
  }
  // Fallback: scan raw_reference for a year.
  const raw = extractRawReference(biblStruct);
  if (raw) {
    const m = raw.match(/\b(19|20)\d{2}\b/);
    if (m) return m[0];
  }
  return '';
}

function extractVenue(biblStruct: Record<string, unknown>): string {
  const monogr = biblStruct['monogr'];
  if (monogr && typeof monogr === 'object') {
    return pickVenueFromMonogrTitles(monogr as Record<string, unknown>);
  }
  return '';
}

function extractAuthors(biblStruct: Record<string, unknown>): string[] {
  const analytic = biblStruct['analytic'];
  if (analytic && typeof analytic === 'object') {
    const a = analytic as Record<string, unknown>;
    const authors = parseAuthorsFromAuthorNodes(a['author']);
    if (authors.length > 0) return authors;
  }
  const monogr = biblStruct['monogr'];
  if (monogr && typeof monogr === 'object') {
    const m = monogr as Record<string, unknown>;
    const authors = parseAuthorsFromAuthorNodes(m['author']);
    if (authors.length > 0) return authors;
  }
  return [];
}

function findAllBiblStructs(node: unknown): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  if (!node) return out;
  if (Array.isArray(node)) {
    for (const item of node) out.push(...findAllBiblStructs(item));
    return out;
  }
  if (typeof node !== 'object') return out;

  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'biblStruct') {
      for (const bs of asArray(value as unknown)) {
        if (bs && typeof bs === 'object') out.push(bs as Record<string, unknown>);
      }
    } else {
      out.push(...findAllBiblStructs(value));
    }
  }
  return out;
}

function teiXmlToReferences(teiXml: string): Reference[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    ignoreDeclaration: true,
    ignorePiTags: true,
    removeNSPrefix: true,
    trimValues: true,
  });

  const parsed = parser.parse(teiXml) as Record<string, unknown>;
  const biblStructs = findAllBiblStructs(parsed);

  return biblStructs.map((bs, idx) => {
    const title = extractTitle(bs);
    const authors = extractAuthors(bs);
    const year = extractYear(bs);
    const venue = extractVenue(bs);
    const doi = extractDoi(bs);
    const raw = extractRawReference(bs);
    const raw_text =
      raw ||
      [authors.join(', '), title, venue, year]
        .map(s => s.trim())
        .filter(Boolean)
        .join('. ');

    return {
      id: crypto.randomUUID(),
      raw_text,
      title,
      authors,
      year,
      venue,
      doi,
      urls: [],
      page_number: null,
      bounding_box: null,
      citation_number: idx + 1,
    };
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/api/extract/references', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'Missing file (field name must be "file")' });
      return;
    }

    const mime = (file.mimetype || '').toLowerCase();
    if (!mime.includes('pdf')) {
      res.status(400).json({ error: `Unsupported file type: ${file.mimetype}` });
      return;
    }

    const grobidUrl = envString('GROBID_URL', DEFAULT_GROBID_URL).replace(/\/+$/, '');
    const grobidEndpoint = `${grobidUrl}/api/processReferences`;
    const timeoutMs = envNumber('GROBID_TIMEOUT_MS', 120_000);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const form = new FormData();
    form.append('input', new Blob([file.buffer], { type: 'application/pdf' }), file.originalname || 'upload.pdf');
    form.append('includeRawCitations', '1');

    const started = Date.now();
    const resp = await fetch(grobidEndpoint, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      res.status(502).json({
        error: `GROBID error (${resp.status})`,
        details: text.slice(0, 2000),
        elapsed_ms: Date.now() - started,
      });
      return;
    }

    const teiXml = await resp.text();
    const references = teiXmlToReferences(teiXml);

    res.json({
      references,
      method: 'grobid',
      elapsed_ms: Date.now() - started,
      count: references.length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

// Security: Perplexity API proxy endpoint - keeps API key server-side
app.post('/api/perplexity/chat', async (req, res) => {
  try {
    const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
    if (!perplexityApiKey) {
      res.status(503).json({ error: 'Perplexity API not configured on server' });
      return;
    }

    const { messages, model = 'sonar-pro', temperature = 0.1, max_tokens = 1000 } = req.body;

    if (!messages || !Array.isArray(messages)) {
      res.status(400).json({ error: 'Invalid request: messages array required' });
      return;
    }

    // Validate message structure
    for (const msg of messages) {
      if (!msg.role || !msg.content) {
        res.status(400).json({ error: 'Invalid message format: role and content required' });
        return;
      }
      if (!['system', 'user', 'assistant'].includes(msg.role)) {
        res.status(400).json({ error: 'Invalid message role' });
        return;
      }
    }

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${perplexityApiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: Math.min(Math.max(temperature, 0), 1),
        max_tokens: Math.min(Math.max(max_tokens, 1), 4000),
      }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      res.status(response.status).json({
        error: `Perplexity API error: ${errorData.error?.message || `HTTP ${response.status}`}`,
      });
      return;
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ error: message });
  }
});

const port = envNumber('PORT', DEFAULT_PORT);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`API proxy listening on http://localhost:${port}`);
});

