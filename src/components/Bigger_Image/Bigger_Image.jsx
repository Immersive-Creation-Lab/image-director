import React, { useState } from 'react';
import './Bigger_Image.css'
import { API_BASE_URL } from '../../config';

const Bigger_Image = ({ image, onClose, onStar }) => {
  const [starring, setStarring] = useState(false);
  const [starred, setStarred] = useState(false);

  if (!image) return null;

  const isAlreadyStarred = image.url.includes('__starred_');

  const handleStar = async (e) => {
    e.stopPropagation();
    if (starring || starred || isAlreadyStarred) return;
    setStarring(true);
    try {
      const res = await fetch(`${API_BASE_URL}/star_image`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_url: image.url }),
      });
      const data = await res.json();
      if (data.url) {
        setStarred(true);
        if (onStar) onStar(data.url);
      }
    } catch (err) {
      console.error('Star failed:', err);
    } finally {
      setStarring(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <img
          src={`${API_BASE_URL}${image.url}`}
          alt={image.prompt}
          className="modal-image"
        />
        <p className="modal-prompt">{image.prompt}</p>
        <button
          className={`modal-star-button ${isAlreadyStarred || starred ? 'starred' : ''}`}
          onClick={handleStar}
          disabled={starring || starred || isAlreadyStarred}
          title={isAlreadyStarred || starred ? 'Already starred' : 'Star this image'}
        >
          {starring ? '…' : '★'}
        </button>
        <button className="modal-close-button" onClick={onClose}>✕</button>
      </div>
    </div>
  );
};

export default Bigger_Image;
