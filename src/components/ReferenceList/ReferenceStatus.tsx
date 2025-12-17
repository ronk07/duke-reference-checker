import React from 'react';
import { Check, AlertTriangle, X, HelpCircle, Loader2 } from 'lucide-react';
import type { ValidationStatus } from '../../types';

interface ReferenceStatusProps {
  status: ValidationStatus;
  size?: 'sm' | 'md';
}

export const ReferenceStatus: React.FC<ReferenceStatusProps> = ({ status, size = 'md' }) => {
  const iconSize = size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  
  switch (status) {
    case 'verified':
      return (
        <div className={`${iconSize} text-success`} title="Verified">
          <Check className="w-full h-full" />
        </div>
      );
    case 'warning':
      return (
        <div className={`${iconSize} text-warning`} title="Warning - minor discrepancies">
          <AlertTriangle className="w-full h-full" />
        </div>
      );
    case 'error':
      return (
        <div className={`${iconSize} text-error`} title="Error - critical mismatch">
          <X className="w-full h-full" />
        </div>
      );
    case 'pending':
      return (
        <div className={`${iconSize} text-text-secondary animate-spin`} title="Validating...">
          <Loader2 className="w-full h-full" />
        </div>
      );
    case 'unverified':
    default:
      return (
        <div className={`${iconSize} text-text-secondary`} title="Unverified">
          <HelpCircle className="w-full h-full" />
        </div>
      );
  }
};

