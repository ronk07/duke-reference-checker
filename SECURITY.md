# Security Policy

## Security Audit Summary

This document outlines the security measures implemented in RefChecker and provides guidance for secure deployment.

### Last Audit Date: December 2024

## Implemented Security Measures

### 1. API Key Protection

**Server-Side Proxy for External APIs**
- Perplexity API calls are proxied through the Node.js backend server
- API keys are stored as server-side environment variables (`PERPLEXITY_API_KEY`)
- Client-side code never has direct access to server API keys

**Client-Side API Keys (User-Provided)**
- LLM API keys (OpenAI, Anthropic, Gemini) are entered by users in the Settings panel
- These keys are stored in browser `localStorage` using Zustand's persist middleware
- Keys are sent directly to their respective API providers (not through our server)
- Users are informed that keys are stored locally in the browser

### 2. Server Security

**Rate Limiting**
- Basic rate limiting: 100 requests per minute per IP
- Prevents DoS attacks and API abuse

**Security Headers**
- `X-Content-Type-Options: nosniff` - Prevents MIME type sniffing
- `X-Frame-Options: DENY` - Prevents clickjacking
- `X-XSS-Protection: 1; mode=block` - XSS protection
- `Referrer-Policy: strict-origin-when-cross-origin` - Controls referrer information

**Input Validation**
- File uploads limited to 50MB
- Only PDF files accepted
- JSON request body size limited to 1MB
- Message structure validation for API proxy endpoints

### 3. Dependency Security

All dependencies should be regularly audited:

```bash
# Check for known vulnerabilities
npm audit

# Update dependencies
npm update

# Fix vulnerabilities automatically where possible
npm audit fix
```

## Environment Variables

### Server-Side (Secure)
These are never exposed to the client:

```env
# Server port
PORT=5174

# GROBID service URL
GROBID_URL=http://localhost:8070

# Perplexity API key (for web search agent)
PERPLEXITY_API_KEY=your-key-here
```

### Client-Side (User-Provided)
These are entered by users in the UI and stored in their browser:
- OpenAI API Key
- Anthropic API Key
- Google Gemini API Key
- Semantic Scholar API Key (optional)

## Deployment Recommendations

### Production Checklist

1. **Environment Variables**
   - Never commit `.env` files
   - Use secure secret management (AWS Secrets Manager, HashiCorp Vault, etc.)
   - Rotate API keys regularly

2. **HTTPS**
   - Always deploy behind HTTPS in production
   - Use a reverse proxy (nginx, Caddy) with TLS certificates

3. **CORS Configuration**
   - For production, configure explicit CORS origins
   - Example for Express:
   ```javascript
   app.use(cors({
     origin: 'https://your-domain.com',
     methods: ['GET', 'POST'],
     credentials: true
   }));
   ```

4. **Logging**
   - Remove or disable `console.log` statements in production
   - Use a proper logging library with log levels
   - Never log sensitive data (API keys, user data)

5. **Updates**
   - Keep dependencies updated
   - Monitor security advisories for used packages
   - Run `npm audit` regularly

### Docker Deployment

```dockerfile
# Example secure Dockerfile
FROM node:20-alpine

# Run as non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S refchecker -u 1001

WORKDIR /app
COPY --chown=refchecker:nodejs . .

RUN npm ci --only=production

USER refchecker
EXPOSE 5174

CMD ["node", "dist/server/index.js"]
```

## Known Limitations

1. **Client-Side API Keys**: User-provided LLM API keys are stored in browser localStorage. While this is standard practice for client-side applications, users should be aware that:
   - Keys are visible to anyone with access to the browser's developer tools
   - Keys are not encrypted at rest in localStorage
   - Users should use API keys with appropriate rate limits/budgets

2. **Gemini API Key in URL**: Google's Gemini API requires the API key as a URL query parameter, which may appear in network logs.

3. **External API Dependencies**: The application relies on external APIs (CrossRef, Semantic Scholar, OpenAlex, ArXiv) that may have their own security policies.

## Reporting Security Issues

If you discover a security vulnerability, please:

1. **Do not** open a public GitHub issue
2. Email the maintainers directly
3. Provide details about the vulnerability
4. Allow reasonable time for a fix before public disclosure

## Security Updates

| Date | Update |
|------|--------|
| Dec 2024 | Initial security audit and hardening |
| Dec 2024 | Moved Perplexity API to server-side proxy |
| Dec 2024 | Added rate limiting and security headers |
