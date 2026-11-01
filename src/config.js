// Base URL of the Flask backend (server/image_generator.py).
// Override with REACT_APP_API_URL in a .env file at the repo root.
export const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:5000';
