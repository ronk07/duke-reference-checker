import React from 'react';
import { Settings, FileText, RotateCcw } from 'lucide-react';
import { useAppStore } from '../../store/appStore';

export const Header: React.FC = () => {
  const { pdfFile, setSettingsOpen, reset } = useAppStore();
  
  return (
    <header className="bg-secondary border-b border-gray-800 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileText className="w-8 h-8 text-accent" />
          <div>
            <h1 className="text-xl font-bold text-white">RefChecker</h1>
            <p className="text-sm text-text-secondary">Academic Reference Validator</p>
          </div>
        </div>
        
        <div className="flex items-center gap-2">
          {pdfFile && (
            <button
              onClick={reset}
              className="flex items-center gap-2 px-4 py-2 text-text-secondary hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
              Reset
            </button>
          )}
          
          <button
            onClick={() => setSettingsOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg transition-colors"
          >
            <Settings className="w-4 h-4" />
            Settings
          </button>
        </div>
      </div>
    </header>
  );
};


