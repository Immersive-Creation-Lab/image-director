import React from "react";
import './SegmentationOverlay.css';

const SegmentationOverlay = ({
  msg,
  segmentationData,
  error,
  loading,
  show3DViewer
}) => {
  const allPoints = segmentationData.points ? segmentationData.points.flat() : [];

  return (
    <>
      {/* Loading */}
      {loading && segmentationData.imageUrl === msg.content && (
        <div className="segmentation-loading">Processing segmentation...</div>
      )}

      {/* Error */}
      {error && segmentationData.imageUrl === msg.content && (
        <div className="segmentation-error">{error}</div>
      )}

      {/* Multiple Segmentation Masks */}
      {segmentationData.masks && !show3DViewer && (
        segmentationData.masks.map((maskObj, index) => (
          <img
            key={`mask-${index}`}
            src={maskObj.visUrl}
            alt={`Segmentation result ${index + 1}`}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              height: "100%",
              pointerEvents: "none",
              opacity: 1,
            }}
          />
        ))
      )}

      {segmentationData.mask && !segmentationData.masks && !show3DViewer && (
        <img
          src={segmentationData.mask}
          alt="Segmentation result"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: "100%",
            height: "100%",
            pointerEvents: "none",
            opacity:1,
          }}
        />
      )}

      {/* Segmentation Points */}
      {segmentationData.imageUrl === msg.content && !show3DViewer && (
        allPoints.map((point, i) => (
          <div
            key={`point-${i}`}
            className="segmentation-point"
            style={{
              left: `${point.x * 100}%`,
              top: `${point.y * 100}%`,
            }}
          />
        ))
      )}
    </>
  );
};

export default SegmentationOverlay;