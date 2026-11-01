import { API_BASE_URL } from '../../config';
export const handleGeneration = async ({
  prompt,
  referenceImageUrl = null,
  selectedModel,
  conversation,
  setShowTitle,
  setIsGenerating,
  setIsAnimating,
  setCurrentImage,
  setImages,
  setConversation
}) => {
  setShowTitle(false);
  setIsGenerating(true);
  setIsAnimating(true);
  setCurrentImage(null);

  try {
    let result;
    let imageFilename = null;

    if (referenceImageUrl) {
      imageFilename = referenceImageUrl.split('/').pop();
    } else if (conversation.length > 0) {
      const lastImage = conversation[conversation.length - 1];
      imageFilename = lastImage.url.split('/').pop();
    }

    switch (selectedModel.provider) {

      case 'openai':
        const openaiResponse = await fetch(`${API_BASE_URL}/openai`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            prompt: prompt, 
            model: selectedModel.model,
            image_url: result?.url 
          })
        });

        if (!openaiResponse.ok) {
          const errorData = await openaiResponse.json();
          throw new Error(errorData.error || 'OpenAI generation failed');
        }

        result = await openaiResponse.json();
  
        
        return result;

      case 'Imagen':
        const geminiResponse = await fetch(`${API_BASE_URL}/gemini`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: prompt,
            image_filename: imageFilename || null,
            model: selectedModel.model
          }),
        });

        if (!geminiResponse.ok) {
          const errorData = await geminiResponse.json();
          throw new Error(errorData.error || 'Gemini generation failed');
        }

        result = await geminiResponse.json();
        return result;

      default:
        throw new Error(`Unhandled provider: ${selectedModel.provider}`);
    }
  } catch (error) {
    console.error("Generation failed:", error);
    alert(`Error: ${error.message}`);
  } finally {
    setIsGenerating(false);
  }
};