import React, { useState, useCallback } from 'react';

interface SplitPaneProps {
  left: React.ReactNode;
  right: React.ReactNode;
  defaultLeftWidth?: number;
  minLeftWidth?: number;
  maxLeftWidth?: number;
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  left,
  right,
  defaultLeftWidth = 400,
  minLeftWidth = 300,
  maxLeftWidth = 600,
}) => {
  const [leftWidth, setLeftWidth] = useState(defaultLeftWidth);
  const [isDragging, setIsDragging] = useState(false);
  
  const handleMouseDown = useCallback(() => {
    setIsDragging(true);
  }, []);
  
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    
    const newWidth = Math.max(minLeftWidth, Math.min(maxLeftWidth, e.clientX));
    setLeftWidth(newWidth);
  }, [isDragging, minLeftWidth, maxLeftWidth]);
  
  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);
  
  return (
    <div
      className="flex flex-1 overflow-hidden"
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      <div
        className="flex-shrink-0 overflow-hidden"
        style={{ width: leftWidth }}
      >
        {left}
      </div>
      
      <div
        className="w-1 bg-gray-800 hover:bg-accent cursor-col-resize flex-shrink-0 transition-colors"
        onMouseDown={handleMouseDown}
      />
      
      <div className="flex-1 overflow-hidden">
        {right}
      </div>
    </div>
  );
};


