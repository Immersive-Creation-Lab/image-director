import { API_BASE_URL } from '../../config';

/**
 * Classifies user intent as GENERATE or EDIT
 * @param {string} prompt - User's text input
 * @returns {Promise<string>} - 'GENERATE' or 'EDIT'
 */
export const checkIntent = async (prompt) => {
  try {
    
    const response = await fetch(`${API_BASE_URL}/classify_intent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt })
    });
    
    if (!response.ok) {
      console.warn(`[Intent Check] Server error (${response.status}), defaulting to GENERATE`);
      return 'GENERATE';
    }
    
    const data = await response.json();
    const intent = data.intent || 'GENERATE';
    
    return intent;
    
  } catch (error) {
    console.error('[Intent Check] Network error:', error);
    return 'GENERATE';
  }
};

/**
 * Executes the Magic Edit pipeline SEQUENTIALLY with progress updates
 * @param {string} imageUrl 
 * @param {string} prompt 
 * @param {Function} onProgress Callback to update React state progressively
 * @returns {Promise<Object>} 
 */
export const executeMagicEdit = async (imageUrl, prompt, onProgress) => {
  try {
    
    //  Prepare (Segment & Parse Command)
    if (onProgress) onProgress({ step: 'segmenting', message: 'Stage 1/3: Analyzing and segmenting object...' });
    
    const prepResponse = await fetch(`${API_BASE_URL}/api/edit/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: imageUrl, prompt })
    });
    
    if (!prepResponse.ok) throw new Error(`Stage 1 failed: ${prepResponse.status}`);
    const prepData = await prepResponse.json();
    
    // Send  data back to the UI immediately
    if (onProgress) onProgress({ 
        step: 'segmented', 
        message: 'Stage 2/3: Removing background (Inpainting)...',
        partialData: {
            bbox: prepData.bbox,
            segmentation_mask: prepData.segmentation_mask,
            ai_command: prepData.ai_command
        }
    });

    const requestPayload = { image_url: imageUrl, mask_data: prepData.mask_data };

    // Inpaint Background 
    const inpaintResponse = await fetch(`${API_BASE_URL}/api/edit/inpaint`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload)
    });

    if (!inpaintResponse.ok) throw new Error(`Stage 2 failed: ${inpaintResponse.status}`);
    const inpaintData = await inpaintResponse.json();
    
    if (onProgress) onProgress({ 
        step: 'inpainted', 
        message: 'Stage 3/3: Generating 3D Model...',
        partialData: { inpainted_image: inpaintData.inpainted_image }
    });

    // Generate 3D Model 
    const threeDResponse = await fetch(`${API_BASE_URL}/api/edit/generate_3d`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestPayload)
    });

    if (!threeDResponse.ok) throw new Error(`Stage 3 failed: ${threeDResponse.status}`);
    const threeDData = await threeDResponse.json();
    if (threeDData.error) throw new Error(threeDData.error);
    
    if (onProgress) onProgress({ step: 'complete', message: 'Pipeline complete! Triggering rerender...' });


    return {
      status: 'success',
      bbox: prepData.bbox,
      segmentation_mask: prepData.segmentation_mask,
      ai_command: prepData.ai_command,
      inpainted_image: inpaintData.inpainted_image,
      ply_data: threeDData.ply_data,
      rotation: threeDData.rotation,
      translation: threeDData.translation,
      scale: threeDData.scale,
      final_mask_url: threeDData.final_mask_url
    };
    
  } catch (error) {
    console.error('Natural Language Pipeline Failed:', error);
    throw error;
  }
};