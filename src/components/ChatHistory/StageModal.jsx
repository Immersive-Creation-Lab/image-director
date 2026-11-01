import React, { useEffect } from 'react';
import './StageModal.css';

const StageModal = ({ stages, selectedIndex, onClose, onNavigate }) => {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        onNavigate('prev');
      } else if (e.key === 'ArrowRight') {
        onNavigate('next');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose, onNavigate]);

  if (selectedIndex === null || !stages[selectedIndex]) return null;

  const currentStage = stages[selectedIndex];
  const hasPrev = selectedIndex > 0;
  const hasNext = selectedIndex < stages.length - 1;

  return (
    <div className="stage-modal-backdrop" onClick={onClose}>
      <div className="stage-modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="stage-modal-header">
          <div className="stage-modal-title">{currentStage.name}</div>
          <button className="stage-modal-close" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="stage-modal-image-container">
          <img
            src={currentStage.imageUrl}
            alt={currentStage.name}
            className="stage-modal-image"
          />
        </div>
        {hasPrev && (
          <button
            className="stage-modal-nav prev"
            onClick={() => onNavigate('prev')}
          >
            ‹
          </button>
        )}
        {hasNext && (
          <button
            className="stage-modal-nav next"
            onClick={() => onNavigate('next')}
          >
            ›
          </button>
        )}
      </div>
    </div>
  );
};

export default StageModal;
