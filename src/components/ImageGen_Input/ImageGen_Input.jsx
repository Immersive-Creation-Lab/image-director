import React, { useState, useEffect, useRef } from "react";
import { InputCase } from "../Input/MessageSoftGPT";
import ChatHistory from "../ChatHistory/Chathistory";
import { checkIntent, executeMagicEdit } from "../TextHandler/TextHandler"; 
import "./ImageGen_Input.css";

const ImageGenerator = ({ onGenerate, isGenerating, currentImage, onImageSaved, setCurrentImage }) => {  
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [actionType, setActionType] = useState('generate'); // 'generate' | 'edit'
  const chatHistoryRef = useRef(null);
  // const [isOverDropZone, setIsOverDropZone] = useState(false);
  // Clear messages on mount
  useEffect(() => {
    sessionStorage.removeItem("chatMessages");
    setMessages([]);
  }, []);

  // Add newly generated images to chat
 useEffect(() => {
  if (currentImage) {
    setMessages((prev) => [...prev, {
      role: "assistant",
      type: "image",
      content: currentImage.url,
      prompt: currentImage.prompt,
      timestamp: currentImage.timestamp,
      threeDModelData: null,
    }]);
    setCurrentImage(null); 
  }
}, [currentImage, setCurrentImage]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!prompt.trim()) return;

    const userText = prompt.trim();
    setPrompt("");
    
    // Add user message to chat
    setMessages((prev) => [...prev, { 
      role: "user", 
      type: "text", 
      content: userText 
    }]);
    
    setIsProcessing(true);

    try {
        let targetImage = null;

        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].type === 'image') {
            targetImage = {
              url: messages[i].content,
              prompt: messages[i].prompt,
              timestamp: messages[i].timestamp
            };
            break;
          }
        }

        let intent = 'GENERATE';
        if (targetImage) {
          intent = await checkIntent(userText);
        }

        const isEditAction = intent === 'EDIT' && targetImage;
        setActionType(isEditAction ? 'edit' : 'generate');

        if (isEditAction) {

        setMessages(prev => [...prev, {
          role: 'assistant',
          type: 'text',
          content: ` Edit: Processing "${userText}"...`
        }]);

        try {
        const result = await executeMagicEdit(targetImage.url, userText, (progress) => {
            setMessages(prev => {
              const updated = [...prev];
              
              //  Update the loading text bubble so the user sees what stage we are on
              const processMsgIndex = updated.findIndex(msg => msg.type === 'text' && msg.content.includes('Edit:'));
              if (processMsgIndex !== -1) {
                updated[processMsgIndex] = { ...updated[processMsgIndex], content: ` Edit: ${progress.message}` };
              }

              // Progressively inject the images into the target image message so the UI updates
              if (progress.partialData) {
                const targetImgIndex = updated.findIndex(msg => msg.type === 'image' && msg.content === targetImage.url);
                if (targetImgIndex !== -1) {
                  updated[targetImgIndex] = {
                    ...updated[targetImgIndex],
                    segmentationMask: progress.partialData.segmentation_mask || updated[targetImgIndex].segmentationMask,
                    bbox: progress.partialData.bbox || updated[targetImgIndex].bbox,
                    aiCommand: progress.partialData.ai_command || updated[targetImgIndex].aiCommand,
                    inpaintedImage: progress.partialData.inpainted_image || updated[targetImgIndex].inpaintedImage
                  };
                }
              }
              return updated;
            });
          });

          // inject the heavy 3D data and trigger the final rerender
          // also clear isFromDrop so subsequent prompts use normal intent classification
          setMessages(prev => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].type === 'image' && updated[i].content === targetImage.url) {
                updated[i] = {
                  ...updated[i],
                  threeDModelData: result.ply_data,
                  final_mask_url: result.final_mask_url,
                  rotation: result.rotation,
                  translation: result.translation,
                  scale: result.scale,
                };
                break;
              }
            }
            return updated.filter(msg => !(msg.type === 'text' && msg.content.includes('Edit:')));
          });

        } catch (editError) {
          console.error(" Edit failed:", editError);
          setMessages(prev => {
            const filtered = prev.filter(msg => !(msg.type === 'text' && msg.content.includes('Edit:')));
            return [...filtered, {
              role: 'assistant', type: 'text',
              content: ` Edit failed: ${editError.message}. Try describing the object more clearly.`
            }];
          });
        }

      } else {
        //Create New Image
        await onGenerate(userText, targetImage?.url || null);
      }

    } catch (err) {
      console.error(" Processing error:", err);
      setMessages((prev) => [...prev, { 
        role: "assistant", 
        type: "text", 
        content: ` Error: ${err.message || 'Something went wrong. Please try again.'}` 
      }]);
    } finally {
      setIsProcessing(false);
    }
  };

const handleRerenderComplete = (newUrl, origPrompt, isDiscard = false, isFinal = false) => {
  if (isDiscard) {
    setMessages(prev => prev.map(msg => {
      if (msg.type === 'image' && msg.content === currentImage?.url) {
        const { 
          threeDModelData, segmentationMask, inpaintedImage, 
          bbox, final_mask_url, aiCommand, ...cleanMsg 
        } = msg;
        return cleanMsg;
      }
      return msg;
    }));
    return;
  }

  if (isFinal) {
    // Clear the active editing state of the PREVIOUS bubble
    setMessages(prev => prev.map(msg => {
      const { 
        threeDModelData, segmentationMask, inpaintedImage, 
        bbox, final_mask_url, aiCommand, ...cleanMsg 
      } = msg;
      return cleanMsg;
    }));

    // Add a BRAND NEW bubble with the edited result
    setMessages(prev => [...prev, {
      role: "assistant",
      type: "image",
      content: newUrl,
      prompt: origPrompt, 
      timestamp: Date.now(),
      threeDModelData: null 
    }]);

    // setCurrentImage({ url: newUrl, prompt: origPrompt, timestamp: Date.now() });
  }
};

  // Dynamic placeholder based on context
  const getPlaceholder = () => {
    if (currentImage) {
      return "Type 'rotate left' to edit, or describe a new image...";
    }
    if (messages.some(m => m.type === 'image')) {
      return "Edit the last image (e.g., 'move right') or generate new...";
    }
    return "Describe an image to generate...";
  };

return (
  <div className="chat-container"> 
    
      <div className="chat-history-container" ref={chatHistoryRef}>

      <ChatHistory 
        messages={messages} 
        onRerenderComplete={handleRerenderComplete}
        onImageSaved={onImageSaved}
      />
      
      {(isGenerating || isProcessing) && (
        <div className="generating-indicator">
          {actionType === 'edit' ? "Processing Edit..." : "Generating image..."}
        </div>
      )}
    </div>

      {/* Input Area */}
      <div className="input-area">
        <InputCase
          value={prompt}
          placeholder={getPlaceholder()}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSubmit(e)}
          onSubmit={handleSubmit}
          disabled={isGenerating || isProcessing}
        />
      </div>
    </div>
  );
};

export default ImageGenerator;