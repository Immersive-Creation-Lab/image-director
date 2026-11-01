import React, { useState, useEffect, useRef } from 'react';
import './ChatHistory.css';
import TextMessage from "./TextMessage";
import ImageMessage from "./ImageMessage";
import { API_BASE_URL } from '../../config';

const ChatHistory = ({ messages,onRerenderComplete, onImageSaved}) => {
  const chatEndRef = useRef(null);
  const [segmentationData, setSegmentationData] = useState({
    imageUrl: null,
    points: [],
    mask: null,
    maskData: null,
    bbox:null
  });
  const [savedMasks, setSavedMasks] = useState([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const prevMsgCount = useRef(messages.length);
  useEffect(() => {
    if (messages.length === 0) {
      setSegmentationData({
        imageUrl: null,
        points: [],
        mask: null,
        maskData: null,
        bbox: null
      });
      setSavedMasks([]);
    }
  }, [messages.length]);

useEffect(() => {
  if (messages.length > prevMsgCount.current) {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }
  
  prevMsgCount.current = messages.length;
}, [messages.length]);
  const handleImageClick = async (e, imageUrl) => {
    const img = e.target;
    const rect = img.getBoundingClientRect();

    // Calculate coordinates relative to the displayed image
    const displayWidth = rect.width;
    const displayHeight = rect.height;

    const naturalWidth = img.naturalWidth;
    const naturalHeight = img.naturalHeight;

    const scaleX = naturalWidth / displayWidth;
    const scaleY = naturalHeight / displayHeight;

    const clickX = (e.clientX - rect.left) * scaleX;
    const clickY = (e.clientY - rect.top) * scaleY;

    const normalizedX = clickX / naturalWidth;
    const normalizedY = clickY / naturalHeight;

    const currentPoint = { x: normalizedX, y: normalizedY };

    let newPoints = [];

   if (segmentationData.imageUrl !== imageUrl || segmentationData.points.length === 0) {
      // Create the first object group
      newPoints = [[currentPoint]];
    } else {
      // Continuing on the same image
      newPoints = [...segmentationData.points];
      
      if (e.shiftKey) {
        // SHIFT + CLICK: Start a brand new object group
        newPoints.push([currentPoint]);
      } else {
        // NORMAL CLICK: Add point to the LAST object group to refine it
        const lastIndex = newPoints.length - 1;
        newPoints[lastIndex] = [...newPoints[lastIndex], currentPoint];
      }
    }

    setSegmentationData(prev => ({
      ...prev,
      imageUrl,
      displayWidth,  
      displayHeight,
      naturalWidth,  
      naturalHeight,
      points: newPoints,
      mask: null,
      bbox:null
    }));

 let formattedPoints;
    let formattedLabels;

    if (newPoints.length === 1) {
      // SINGLE OBJECT MODE (Flat 2D Array)
      // Example: [[0.5, 0.5], [0.6, 0.6]]
      formattedPoints = newPoints[0].map(p => [p.x, p.y]);
      formattedLabels = Array(newPoints[0].length).fill(1);
    } else {
      // MULTI OBJECT MODE (Nested 3D Array)
      // Example: [ [[0.5, 0.5], [0.6, 0.6]], [[0.8, 0.8]] ]
      formattedPoints = newPoints.map(objGroup => objGroup.map(p => [p.x, p.y]));
      formattedLabels = newPoints.map(objGroup => Array(objGroup.length).fill(1));
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`${API_BASE_URL}/segment_with_sam`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: `${API_BASE_URL}${imageUrl.startsWith('/') ? imageUrl : `/${imageUrl}`}`,
          input_points: formattedPoints,
          input_labels: formattedLabels
        })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (!data.masks || data.masks.length === 0) throw new Error('No masks received in response');
      const allMasks = data.masks.map(maskObj => ({
        visUrl: `data:image/png;base64,${maskObj.visualization}`,
        maskData: maskObj.mask,
        bbox: maskObj.bbox,
        score: maskObj.score
      }));

      
      setSegmentationData(prev => ({
        ...prev,
        masks: allMasks 
      }));

    } catch (error) {
      console.error("Error:", error);
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }

  const saveMask = () => {
    if (!segmentationData.masks || segmentationData.masks.length === 0) return;
    const newMasks = segmentationData.masks.map(m => ({
      id: `mask-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      visUrl: m.visUrl,
      maskData: m.maskData,
      bbox: m.bbox,
      imageUrl: segmentationData.imageUrl,
    }));
    setSavedMasks(prev => [...prev, ...newMasks]);
    // Reset working segmentation so the next click starts fresh on a new object,
    // but keep imageUrl so the image stays active for further clicks.
    setSegmentationData(prev => ({
      ...prev,
      points: [],
      masks: null,
      mask: null,
      maskData: null,
      bbox: null,
    }));
    setError(null);
  };

  const clearSegmentation = () => {
    setSegmentationData(prev => ({
      ...prev,
      points: [],
      masks: null,
      mask: null,
      maskData: null,
      bbox: null,
    }));
    setError(null);
  };

  return (
    <div className="chat-history">
      {messages.map((msg, index) => (
        <div 
        key={`${index}-${msg.timestamp}`} 
        className={`bubble ${msg.role} bubble-fade-in`} 
      >
          {msg.type === 'text' ? (
            <TextMessage content={msg.content} />
          ) : (
            <ImageMessage
              msg={msg}
              segmentationData={segmentationData}
              setSegmentationData={setSegmentationData}
              loading={loading}
              error={error}
              onRerenderComplete={onRerenderComplete}
              handleImageClick={handleImageClick}
              clearSegmentation={clearSegmentation}
              setError={setError}
              onImageSaved={onImageSaved}
              savedMasks={savedMasks}
              setSavedMasks={setSavedMasks}
              saveMask={saveMask}
            />
          )}
        </div>
      ))}
      <div ref={chatEndRef} />
    </div>
  );
};

export default ChatHistory;