import React from "react";
import './SegmentationControls.css';

const SegmentationControls = ({
  segmentationData,
  generate3DModel,
  clearSegmentation,
  threeDModel,
  show3DViewer,
  setShow3DViewer,
  isGenerating3D,
  resetViewRef,
  isRerendering,
  rerenderError,
  onSaveMask,
  selectedSavedMaskId,
  onHarmonize,
}) => {
  // The controls switch between a segmentation mode and a 3D view mode
  const is3DMode = show3DViewer && threeDModel;
  const isSegmentationMode = !show3DViewer; 

  return (
    <div className="segmentation-controls">
      {/*SEGMENTATION MODE CONTROLS */}
      {isSegmentationMode && (
        <>
          {segmentationData.masks && segmentationData.masks.length > 0 && (
            <button className="save-mask-btn" onClick={onSaveMask}>
              Save Mask
            </button>
          )}

          <button
            className="generate-3d-btn"
            onClick={generate3DModel}
            disabled={isGenerating3D || (!selectedSavedMaskId && !segmentationData.mask && (!segmentationData.masks || segmentationData.masks.length === 0))}
          >
            {isGenerating3D ? "Generating 3D..." : (threeDModel ? "Regenerate 3D" : "Generate 3D")}
          </button>


          {!isGenerating3D && (
          <button onClick={clearSegmentation} className="clear-segmentation-btn">
            Clear Segments
          </button>
          )}
        </>
      )}

      {/*3D VIEW MODE CONTROLS*/}
      {is3DMode && (
        <>
          <button
            className="reset-view-btn"
            onClick={() => {
              if (resetViewRef && resetViewRef.current) {
                resetViewRef.current();
              } else {
                console.warn("Reset view ref not ready yet");
              }
            }}
          >
            Reset Position
          </button>

       

          <button
            className="harmonize-btn"
            onClick={onHarmonize}
            disabled={isRerendering}
          >
            {isRerendering ? "Harmonizing..." : "Harmonize"}
          </button>
        </>
      )}

      {rerenderError && <div className="rerender-error">{rerenderError}</div>}




    </div>
  );
};

export default SegmentationControls;