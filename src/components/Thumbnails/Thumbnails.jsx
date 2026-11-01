import React, { useState, useEffect } from 'react';
import './Thumnails.css';
import BiggerImage  from '../Bigger_Image/Bigger_Image';
import { API_BASE_URL } from '../../config';

const Thumbnails = ({ images, loading, isGallery, onDragStateChange, onReloadImages }) => {
  const [selectedImage, setSelectedImage] = useState(null);

  const handleStar = (newUrl) => {
    setSelectedImage(prev => prev ? { ...prev, url: newUrl } : null);
    if (onReloadImages) onReloadImages();
  };

  

  useEffect(() => {
    setSelectedImage(null);
  }, [images]);

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    );
  }


  return (
    <div className="p-4 w-full bg-white"> { }
      <h2 className="text-lg font-bold" style={{paddingLeft: '1rem', margin: '10px 0 8px 0'}}>
        {isGallery ? 'Gallery History' : 'Generation History'}
      </h2>

      {images.length === 0 ? (
        <p className="text-gray-500">
          {isGallery ? 'No images in gallery yet.' : 'No images generated yet.'}
        </p>
      ) : (
        <div className="slider-container w-full bg-white"> {}
          <div className="slider-track bg-white"> {}
            {images.map((img, index) => (
              <div
                key={`${img.id}-${index}`}
                className={`thumbnail-card ${img.url.includes('__starred_') ? 'thumbnail-starred' : ''}`}
                onClick={() => setSelectedImage(img)}
              >
                {img.url.includes('__starred_') && <span className="thumbnail-star-badge">★</span>}
                <div className="thumbnail-image-container">
                  <img
                    src={`${API_BASE_URL}${img.url}`}
                    alt={img.prompt}
                    className="thumbnail-image"
                    loading="lazy"
                    draggable="true" 
                    onDragStart={(e) => {
                      if (onDragStateChange) onDragStateChange(true);
                      const dragData = JSON.stringify({
                        url: img.url,
                        prompt: img.prompt,
                        timestamp: img.timestamp
                      });
                      e.dataTransfer.setData("application/react-image-data", dragData);
                      e.dataTransfer.effectAllowed = "copy";
                    }}
                    onDragEnd={() => {
                    if (onDragStateChange) onDragStateChange(false);
                  }}
                  />
                </div>
                <div className="thumbnail-info">
                  <p className="thumbnail-prompt truncate" title={img.prompt}>
                    {img.prompt}
                  </p>
                  <p className="thumbnail-timestamp">
                    {new Date(img.timestamp || Date.now()).toLocaleString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <BiggerImage image={selectedImage} onClose={() => setSelectedImage(null)} onStar={handleStar} />


    </div>
  );
};

export default Thumbnails;