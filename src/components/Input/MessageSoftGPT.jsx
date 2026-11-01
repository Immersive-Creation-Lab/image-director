import React from "react";
import "./Input.css";

export const InputCase = ({ value, onChange, onKeyDown, onSubmit }) => {
  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(e);        
  };

  return (
    <div className="input-case">
      <form className="content" onSubmit={handleSubmit}>  {}
          <input
            type="text"
            className="input-field"
            placeholder="Describe your image..."
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
          />
          <button 
            className="send-button" 
            type="submit" 
          >
            Send
        </button>
      </form>
    </div>
  );
};