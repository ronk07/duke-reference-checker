import React, { useState } from 'react';
import { Eye, EyeOff, Check, X, Loader2 } from 'lucide-react';

interface APIKeyInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testConnection?: () => Promise<boolean>;
}

export const APIKeyInput: React.FC<APIKeyInputProps> = ({
  label,
  value,
  onChange,
  placeholder = 'Enter API key...',
  testConnection,
}) => {
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  
  const handleTest = async () => {
    if (!testConnection || !value) return;
    
    setTesting(true);
    setTestResult(null);
    
    try {
      const result = await testConnection();
      setTestResult(result);
    } catch {
      setTestResult(false);
    } finally {
      setTesting(false);
    }
  };
  
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-text-secondary">
        {label}
      </label>
      
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={showKey ? 'text' : 'password'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="w-full px-3 py-2 pr-10 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-accent"
          />
          
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-white"
          >
            {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
        
        {testConnection && (
          <button
            onClick={handleTest}
            disabled={!value || testing}
            className="px-3 py-2 bg-gray-800 hover:bg-gray-700 border border-gray-700 rounded-lg disabled:opacity-50 transition-colors"
          >
            {testing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : testResult === true ? (
              <Check className="w-4 h-4 text-success" />
            ) : testResult === false ? (
              <X className="w-4 h-4 text-error" />
            ) : (
              <span className="text-sm">Test</span>
            )}
          </button>
        )}
      </div>
    </div>
  );
};


