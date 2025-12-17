import React from 'react';
import { X } from 'lucide-react';
import { useAppStore } from '../../store/appStore';
import { APIKeyInput } from './APIKeyInput';

export const SettingsPanel: React.FC = () => {
  const { settings, updateSettings, isSettingsOpen, setSettingsOpen } = useAppStore();
  
  if (!isSettingsOpen) return null;
  
  const handleUpdateApiKey = (key: keyof typeof settings.apiKeys, value: string) => {
    updateSettings({
      apiKeys: { ...settings.apiKeys, [key]: value },
    });
  };
  
  const handleUpdateExtraction = (key: keyof typeof settings.extraction, value: any) => {
    updateSettings({
      extraction: { ...settings.extraction, [key]: value },
    });
  };
  
  const handleUpdateValidation = (key: keyof typeof settings.validation, value: any) => {
    updateSettings({
      validation: { ...settings.validation, [key]: value },
    });
  };
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-full max-w-2xl max-h-[90vh] bg-secondary rounded-xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
          <h2 className="text-xl font-semibold text-white">Settings</h2>
          <button
            onClick={() => setSettingsOpen(false)}
            className="p-2 hover:bg-gray-800 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-80px)] space-y-8">
          {/* API Keys Section */}
          <section>
            <h3 className="text-lg font-medium text-white mb-4">API Keys</h3>
            <p className="text-sm text-text-secondary mb-4">
              API keys are stored locally in your browser and never sent to any server except the respective API providers.
            </p>
            
            <div className="space-y-4">
              <APIKeyInput
                label="OpenAI API Key"
                value={settings.apiKeys.openai}
                onChange={(value) => handleUpdateApiKey('openai', value)}
                placeholder="sk-..."
              />
              
              <APIKeyInput
                label="Anthropic API Key"
                value={settings.apiKeys.anthropic}
                onChange={(value) => handleUpdateApiKey('anthropic', value)}
                placeholder="sk-ant-..."
              />
              
              <APIKeyInput
                label="Google Gemini API Key"
                value={settings.apiKeys.gemini}
                onChange={(value) => handleUpdateApiKey('gemini', value)}
              />
              
              <APIKeyInput
                label="Semantic Scholar API Key (optional)"
                value={settings.apiKeys.semanticScholar}
                onChange={(value) => handleUpdateApiKey('semanticScholar', value)}
                placeholder="Optional - for higher rate limits"
              />
            </div>
          </section>
          
          {/* Extraction Settings */}
          <section>
            <h3 className="text-lg font-medium text-white mb-4">Reference Extraction</h3>
            
            <div className="space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.extraction.useLLM}
                  onChange={(e) => handleUpdateExtraction('useLLM', e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent focus:ring-offset-0"
                />
                <div>
                  <span className="text-white">Use LLM for extraction</span>
                  <p className="text-sm text-text-secondary">
                    More accurate but requires an API key
                  </p>
                </div>
              </label>
              
              {settings.extraction.useLLM && (
                <div>
                  <label className="block text-sm font-medium text-text-secondary mb-2">
                    Preferred LLM
                  </label>
                  <select
                    value={settings.extraction.preferredLLM}
                    onChange={(e) => handleUpdateExtraction('preferredLLM', e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-accent"
                  >
                    <option value="openai">OpenAI (GPT-5.2)</option>
                    <option value="anthropic">Anthropic (Claude Haiku 4.5)</option>
                    <option value="gemini">Google Gemini (Gemini 2.5 Flash)</option>
                  </select>
                </div>
              )}
            </div>
          </section>
          
          {/* Validation Settings */}
          <section>
            <h3 className="text-lg font-medium text-white mb-4">Reference Validation</h3>
            
            {/* Validation Mode Selector */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Validation Mode
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-gray-700 hover:bg-gray-800/50 transition-colors">
                  <input
                    type="radio"
                    name="validationMode"
                    value="api-only"
                    checked={settings.validation.mode === 'api-only'}
                    onChange={(e) => handleUpdateValidation('mode', e.target.value)}
                    className="w-4 h-4 text-accent focus:ring-accent focus:ring-offset-0"
                  />
                  <div className="flex-1">
                    <span className="text-white font-medium">API Only (Fast)</span>
                    <p className="text-xs text-text-secondary">
                      Quick validation using structured APIs only. No LLM or web search.
                    </p>
                  </div>
                </label>
                
                <label className="flex items-center gap-3 cursor-pointer p-3 rounded-lg border border-gray-700 hover:bg-gray-800/50 transition-colors">
                  <input
                    type="radio"
                    name="validationMode"
                    value="agent-based"
                    checked={settings.validation.mode === 'agent-based'}
                    onChange={(e) => handleUpdateValidation('mode', e.target.value)}
                    className="w-4 h-4 text-accent focus:ring-accent focus:ring-offset-0"
                  />
                  <div className="flex-1">
                    <span className="text-white font-medium">Agent-Based (Comprehensive)</span>
                    <p className="text-xs text-text-secondary">
                      Uses LLM query enhancement, web search (Perplexity), and detailed explanations. More thorough but cost-intensive.
                    </p>
                  </div>
                </label>
              </div>
              
              
            </div>
            
            <h4 className="text-md font-medium text-white mb-3 mt-6">Validation Sources</h4>
            
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.validation.enableCrossRef}
                  onChange={(e) => handleUpdateValidation('enableCrossRef', e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent focus:ring-offset-0"
                />
                <div>
                  <span className="text-white">CrossRef</span>
                  <p className="text-xs text-text-secondary">Best for DOI resolution</p>
                </div>
              </label>
              
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.validation.enableSemanticScholar}
                  onChange={(e) => handleUpdateValidation('enableSemanticScholar', e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent focus:ring-offset-0"
                />
                <div>
                  <span className="text-white">Semantic Scholar</span>
                  <p className="text-xs text-text-secondary">Good for CS/ML papers</p>
                </div>
              </label>
              
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.validation.enableOpenAlex}
                  onChange={(e) => handleUpdateValidation('enableOpenAlex', e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent focus:ring-offset-0"
                />
                <div>
                  <span className="text-white">OpenAlex</span>
                  <p className="text-xs text-text-secondary">Open database, reliable fallback</p>
                </div>
              </label>
              
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.validation.enableArxiv}
                  onChange={(e) => handleUpdateValidation('enableArxiv', e.target.checked)}
                  className="w-5 h-5 rounded border-gray-600 bg-gray-800 text-accent focus:ring-accent focus:ring-offset-0"
                />
                <div>
                  <span className="text-white">ArXiv</span>
                  <p className="text-xs text-text-secondary">For preprints with ArXiv IDs</p>
                </div>
              </label>
            </div>
            
            <div className="mt-6">
              <label className="block text-sm font-medium text-text-secondary mb-2">
                Rate Limit Delay (ms)
              </label>
              <input
                type="number"
                min="100"
                max="5000"
                step="100"
                value={settings.validation.rateLimitDelay}
                onChange={(e) => handleUpdateValidation('rateLimitDelay', parseInt(e.target.value) || 500)}
                className="w-32 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-accent"
              />
              <p className="text-xs text-text-secondary mt-1">
                Delay between API requests to avoid rate limiting
              </p>
            </div>
          </section>
        </div>
        
        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-800 flex justify-end">
          <button
            onClick={() => setSettingsOpen(false)}
            className="px-6 py-2 bg-accent hover:bg-accent/80 text-black font-medium rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

