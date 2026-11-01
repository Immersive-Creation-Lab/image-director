import React from 'react';
import './StagePanel.css';

const StagePanel = ({ 
  stages, 
  onStageClick, 
  onSave, 
  onConfirm, 
  onDiscard, 
  showControls,
  selectedStageIndex
}) => {
  return (
    <div className="stage-panel">
      <div className="stage-list">
        {stages.map((stage, index) => (
          <div 
            key={`${stage.name}-${index}`} 
           className={`stage-item ${selectedStageIndex === index ? 'active-stage' : ''}`} 
           onClick={() => onStageClick(index)}
          >
             <img src={stage.imageUrl} className="stage-thumbnail" alt={stage.name} />
             <div className="stage-info">
               <div className="stage-name">{stage.name}</div>
               <div className="stage-status-completed">
                 <span className="status-icon">✓</span> Completed
               </div>
             </div>
          </div>
        ))}
      </div>

      {showControls && (
        <div className="stage-controls-footer">
          <button className="btn-save" onClick={onSave} title="Save this version but keep editing">
            Save Version
          </button>
          <button className="btn-apply" onClick={onConfirm} title="Apply this change and update chat">
            Apply & Finish
          </button>
          <button className="btn-discard" onClick={onDiscard} title="Discard all changes">
            Discard
          </button>
        </div>
      )}
    </div>
  );
};

export default StagePanel;