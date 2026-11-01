import React, { useState } from 'react';
import './ImageGen.css';
import { API_BASE_URL } from '../../config';

const ImageGen = ({ isGenerating, currentImage }) => {
  const [error, setError] = useState(null);

  return (
    <div className="image-gen-container">
      {isGenerating && (
        <div className="mb-4 p-3 bg-blue-100 border border-blue-400 text-blue-700 rounded">
          <p>Generating image...</p>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          <p>Error: {error}</p>
        </div>
      )}

      {currentImage && (
        <div className="image-display-container">
          <div className="image-wrapper">
         <img
            src={`${API_BASE_URL}${currentImage.url}`}
            alt={currentImage.prompt}
            className="generated-image" 
            onError={() => setError('Failed to load image')}
          />
            <div className="image-caption">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Your Creation</h3>
              <div className="prompt-text w-full box-border py-3 px-4 bg-gray-50 rounded-lg mb-4 text-gray-700  leading-relaxed break-words">
              {currentImage.prompt}
              </div>
              <div className="timestamp">
                Created at {new Date(currentImage.timestamp).toLocaleString()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ImageGen;