import React from "react";
import "./SavedMasksPanel.css";

const downloadMask = (mask, index) => {
  const dataUrl = mask.maskData.startsWith("data:")
    ? mask.maskData
    : `data:image/png;base64,${mask.maskData}`;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `mask_${index + 1}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

const SavedMasksPanel = ({
  savedMasks,
  selectedId,
  occlusionId,
  onSelect,
  onDelete,
  show3DViewer,
}) => {
  if (!savedMasks || savedMasks.length === 0) return null;

  return (
    <div className="saved-masks-panel">
      <div className="saved-masks-label">
        Saved Masks
        {show3DViewer && (
          <span className="saved-masks-hint"> · click to toggle occlusion</span>
        )}
      </div>
      <div className="saved-masks-strip">
        {savedMasks.map((mask, index) => {
          const isSelected = selectedId === mask.id;
          const isOcclusion = occlusionId === mask.id;
          return (
            <div
              key={mask.id}
              className={`saved-mask-thumb ${isSelected ? "selected" : ""} ${isOcclusion ? "occlusion-active" : ""}`}
              onClick={() => onSelect(mask)}
              title={isOcclusion ? "Active occlusion layer – click to remove" : show3DViewer ? "Click to bring to front" : "Click to select for 3D"}
            >
              <img
                src={mask.visUrl}
                alt={`Mask ${index + 1}`}
                className="saved-mask-img"
              />
              {isOcclusion && (
                <div className="occlusion-badge">Front</div>
              )}
              {!show3DViewer && isSelected && !isOcclusion && (
                <div className="selected-badge">3D</div>
              )}
              <button
                className="download-mask-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  downloadMask(mask, index);
                }}
                title="Save mask as B&W PNG"
              >
                ↓
              </button>
              <button
                className="delete-mask-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(mask.id);
                }}
                title="Remove mask"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SavedMasksPanel;
