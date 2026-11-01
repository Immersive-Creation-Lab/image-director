import React, { useState, useRef, useEffect, useMemo,useCallback } from "react";
import SegmentationControls from "./SegmentationControls";
import SegmentationOverlay from "./SegmentationOverlay";
import ThreeDViewer from "./3Dviewer";
import StagePanel from "./StagePanel";
import StageModal from "./StageModal";
import SavedMasksPanel from "./SavedMasksPanel";
import "./ImageMessage.css";
import html2canvas from "html2canvas";
import { API_BASE_URL } from '../../config';

const ImageMessage = ({
  msg,
  segmentationData,
  setSegmentationData,
  loading,
  error,
  handleImageClick,
  clearSegmentation,
  setError,
  onRerenderComplete,
  onImageSaved,
  savedMasks,
  setSavedMasks,
  saveMask,
}) => {
  const [isGenerating3D, setIsGenerating3D] = useState(false);
  const [threeDModel, setThreeDModel] = useState(null);
  const [show3DViewer, setShow3DViewer] = useState(false);
  const [threeDTransform, setThreeDTransform] = useState(null);
  const [aiCommand, setAiCommand] = useState(null);
  const [inpaintedImage, setInpaintedImage] = useState(null);
  const [detailedPrompt, setDetailedPrompt] = useState(null);
  const [rerenderedImage, setRerenderedImage] = useState(null);
  const [rerenderOptions, setRerenderOptions] = useState([]);
  const [cachedBase64, setCachedBase64] = useState(null);
  const [cachedPrompt, setCachedPrompt] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const [isRerendering, setIsRerendering] = useState(false);
  const [rerenderError, setRerenderError] = useState(null);
  const hasAutoRerenderFiredRef = useRef(false);
const [finalMaskReference, setFinalMaskReference] = useState(null);
  // Pipeline stages state
  const [pipelineStages, setPipelineStages] = useState([]);
  const [selectedStageIndex, setSelectedStageIndex] = useState(null);
  const [showStageModal, setShowStageModal] = useState(false);
  //Stage that will capture the current state of the 3d object  before hiding the 3d viewver 
  const [currentTransform, setCurrentTransform] = useState(null)

  const imageContainerRef = useRef(null);
  const threeDContainerRef = useRef(null);
  const resetViewRef = useRef(null);
  const saveTransformRef = useRef(null); //This will store the current transform

  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const sceneRef = useRef(null);
  const [executionPhase, setExecutionPhase] = useState('idle'); 
  const [hasAppliedAiCommand, setHasAppliedAiCommand] = useState(false);
  const [saveNotification, setSaveNotification] = useState(false);
  const [selectedSavedMaskId, setSelectedSavedMaskId] = useState(null);
  const [occlusionMaskId, setOcclusionMaskId] = useState(null);
  const [occlusionTextureUrl, setOcclusionTextureUrl] = useState(null);
  const imageDisplaySize = useMemo(() => ({
    width: segmentationData.displayWidth,
    height: segmentationData.displayHeight,
    offsetX: segmentationData.offsetX,
    offsetY: segmentationData.offsetY,
  }), [segmentationData.displayWidth, segmentationData.displayHeight, segmentationData.offsetX, segmentationData.offsetY]);


  useEffect(() => {
    if (!show3DViewer) {
      resetViewRef.current = null;
    }
  }, [show3DViewer]);

  //modal handlers
 const handleStageClick = (index) => {
  const clickedStage = pipelineStages[index];
  setSelectedStageIndex(index);

  //Backtrack to Segmentation Mode
  if (clickedStage.name === "Segmentation Mask") {
    setShow3DViewer(false);           
    setRerenderedImage(null);       
    setPreviewImage(null);           
    setRerenderOptions([]);
  } 
  
  //Backtrack to 3D View Mode
  else if (clickedStage.name === "3D View") {
    if (threeDModel) {
      setShow3DViewer(true);
      setRerenderedImage(null);
      setPreviewImage(null);
      setRerenderOptions([]);
      setCachedBase64(null);
      setCachedPrompt(null);
    } else {
      setError("error in 3d model data");
    }
  }

  else if (clickedStage.name === "Refined Result") {
  setShow3DViewer(false);
  setRerenderedImage(clickedStage.imageUrl);
  if (clickedStage.options) {
    setRerenderOptions(clickedStage.options); 
  }
} 
 
};

  const closeModal = () => {
    setShowStageModal(false);
  };

  const navigateStage = (direction) => {
    if (direction === 'prev' && selectedStageIndex > 0) {
      setSelectedStageIndex(selectedStageIndex - 1);
    } else if (direction === 'next' && selectedStageIndex < pipelineStages.length - 1) {
      setSelectedStageIndex(selectedStageIndex + 1);
    }
  };
  
  useEffect(() => {
  if (msg.threeDModelData && segmentationData.imageUrl !== msg.content) {
    setSegmentationData(prev => ({
      ...prev,
      imageUrl: msg.content  
    }));
  }
}, [msg, segmentationData.imageUrl, setSegmentationData]);
//This is a loader, it is display wheen the user clicks generate 3d 
useEffect(() => {
  let animationFrameId;

  if (isGenerating3D && segmentationData.imageUrl === msg.content) {
    const startAnimation = () => {
      const container = document.getElementById("pulse-wave-container");
      const parent = imageContainerRef.current; 
      
      if (!container || !parent) return;

      const rect = parent.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      container.innerHTML = '';
      const canvas = document.createElement("canvas");
      
      canvas.width = width;
      canvas.height = height;
      container.appendChild(canvas);

      const ctx = canvas.getContext("2d");
      const centerX = width / 2;
      const centerY = height / 2;
      
      const baseScale = Math.min(width, height) / 180;

      const GLOBAL_SPEED = 0.0008;   
      const SCAN_FREQUENCY = 2;    
      const SCAN_HEIGHT = 140 * baseScale; 
      const SHARPNESS = 1.0;         

      const dotRings = [
        { radius: 15 * baseScale, count: 6 }, 
        { radius: 30 * baseScale, count: 12 },
        { radius: 45 * baseScale, count: 18 }, 
        { radius: 60 * baseScale, count: 24 },
        { radius: 75 * baseScale, count: 30 }
      ];

      const animate = (timestamp) => {
        const time = timestamp * GLOBAL_SPEED;
        ctx.clearRect(0, 0, width, height);

        const scanPhase = (Math.sin(time * SCAN_FREQUENCY) + 1) / 2;
        const easedPhase = (-(Math.cos(Math.PI * scanPhase) - 1) / 2);
        const scanY = centerY + (easedPhase * 2 - 1) * (centerY + SCAN_HEIGHT / 2);

        dotRings.forEach((ring) => {
          for (let i = 0; i < ring.count; i++) {
            const angle = (i / ring.count) * Math.PI * 2;
            const x = centerX + Math.cos(angle) * ring.radius;
            const y = centerY + Math.sin(angle) * ring.radius;

            const distFromScan = Math.abs(y - scanY);
            let opacity = 0;

            if (distFromScan < SCAN_HEIGHT / 2) {
              const normalizedDist = distFromScan / (SCAN_HEIGHT / 2);
              opacity = Math.pow(1 - normalizedDist, SHARPNESS);
            }

            if (opacity > 0.01) {
              ctx.beginPath();
              const dotSize = (1 + opacity * 1.5) * Math.max(1, baseScale);
              ctx.arc(x, y, dotSize, 0, Math.PI * 2);
            ctx.fillStyle = opacity > 0.6 
          ? `rgba(255, 255, 255, ${opacity})`     
          : `rgba(200, 200, 200, ${opacity * 0.4})`;
              ctx.fill();
            }
          }
        });
        animationFrameId = requestAnimationFrame(animate);
      };
      animationFrameId = requestAnimationFrame(animate);
    };

    const timer = setTimeout(startAnimation, 50);

    return () => {
      clearTimeout(timer);
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }
}, [isGenerating3D, segmentationData.imageUrl, msg.content]);
  
  
  useEffect(() => {
    if (!segmentationData.imageUrl || segmentationData.imageUrl !== msg.content) {
          setThreeDModel(null);
          setShow3DViewer(false);
          setAiCommand(null);
          setInpaintedImage(null);
          setIsGenerating3D(false);
          setIsRerendering(false);
          setRerenderError(null);
          setDetailedPrompt(null);
          setRerenderedImage(null);
          setRerenderOptions([]);
          setPreviewImage(null);
          setCachedBase64(null);
          setCachedPrompt(null);
          hasAutoRerenderFiredRef.current = false;
          setPipelineStages([]);
          setSelectedStageIndex(null);
          setShowStageModal(false);
    }
  }, [segmentationData.imageUrl, msg.content]);



  
useEffect(() => {
  if (msg.threeDModelData && !threeDModel) {
    try {

      const binaryString = window.atob(msg.threeDModelData);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      setThreeDModel(bytes.buffer.slice(0));
      setExecutionPhase('idle');
      setHasAppliedAiCommand(false);
      
      hasAutoRerenderFiredRef.current = false;
      
      // Set 3D transform data (rotation, translation, scale) - same as transform_to_3d pipeline
    
      


      // Set detailed prompt from keyboard edit (if available)
      if (msg.detailedPrompt) {
        setDetailedPrompt(msg.detailedPrompt);
      }

      // Set inpainted image from keyboard edit (if available)
      if (msg.inpaintedImage) {
        setInpaintedImage(msg.inpaintedImage);
      }

      if (msg.final_mask_url) {
        setFinalMaskReference(msg.final_mask_url); 
      } 

      // Set segmentation data (bbox) from keyboard edit (if available)
      if (msg.bbox) {
        setSegmentationData(prev => ({
          ...prev,
          bbox: msg.bbox,
          imageUrl: msg.content
        }));
      }

      setShow3DViewer(true);

    } catch (e) {
      console.error("Error parsing 3D model from message:", e);
      setError("Failed to load 3D model from edit");
    }
  }
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [
  msg.threeDModelData,
  msg.aiCommand,
  msg.detailedPrompt,
  msg.inpaintedImage,
  msg.bbox,
  msg.content,
  threeDModel,
  setError,
  setSegmentationData,
  msg.final_mask_url,
  msg.rotation,
  msg.translation,
  msg.scale
]);
  // Segmentation Mask (from manual click)
useEffect(() => {
    const hasMasks = segmentationData.masks && segmentationData.masks.length > 0;
    const thumbnailToUse = hasMasks ? segmentationData.masks[0].visUrl : segmentationData.mask;

    if (thumbnailToUse && segmentationData.imageUrl === msg.content) {
      setPipelineStages(prev => {
        const stageName = "Segmentation Mask";
        const newStage = {
          name: stageName,
          imageUrl: thumbnailToUse,
          timestamp: Date.now(),
          status: "completed"
        };

        const existingIndex = prev.findIndex(stage => stage.name === stageName);

        let newStages;

        if (existingIndex !== -1) {
          newStages = [...prev];
          newStages[existingIndex] = newStage;
          setTimeout(() => setSelectedStageIndex(existingIndex), 0);
          return newStages;
        } else {
          newStages = [...prev, newStage];
          setTimeout(() => setSelectedStageIndex(newStages.length - 1), 0);
          return newStages;
        }
      });
    }
  }, [segmentationData.masks, segmentationData.mask, segmentationData.imageUrl, msg.content]);

  // Capture Stage 1: Segmentation Mask (from keyboard edit)
  useEffect(() => {

    if (msg.segmentationMask && msg.threeDModelData) {
      setPipelineStages(prev => {
        // Check if segmentation stage already exists
        const hasSegmentation = prev.some(stage => stage.name === "Segmentation Mask");
        if (hasSegmentation) {
          return prev;
        }

        const stages = [{
          name: "Segmentation Mask",
          imageUrl: msg.segmentationMask,
          timestamp: Date.now(),
          status: "completed"
        }];


        return stages;
      });
    }
  }, [msg.segmentationMask, msg.threeDModelData, msg.inpaintedImage,msg.content]);

const capture3DAt1024 = async (transparent = false) => {
  if (!threeDContainerRef.current) {
    throw new Error("3D viewer container not found");
  }

  const canvasElement = threeDContainerRef.current.querySelector('canvas');
  if (!canvasElement) {
    throw new Error("3D canvas not found");
  }

  const renderer = rendererRef.current;
  const camera = cameraRef.current;
  const scene = sceneRef.current;

  if (!renderer || !camera || !scene) {
    console.warn("Renderer/camera/scene not accessible, using fallback capture");
    return canvasElement.toDataURL('image/png');
  }

  // Save current size
  const originalWidth = canvasElement.width;
  const originalHeight = canvasElement.height;
  const originalAspect = camera.aspect;
  const originalPixelRatio = renderer.getPixelRatio();
  // Temporarily hide the occlusion mesh so the hole-punch doesn't corrupt the capture
  let hiddenOcclusionMesh = null;
  scene.traverse(obj => {
    if (obj.renderOrder === 999 && !hiddenOcclusionMesh) {
      obj.visible = false;
      hiddenOcclusionMesh = obj;
    }
  });

  try {
    // Upscale to 1024x1024
    renderer.setPixelRatio(1);
    renderer.setSize(1024, 1024, false);
    camera.aspect = 1;
    camera.updateProjectionMatrix();
    renderer.setClearColor(transparent ? 0x000000 : 0xffffff, transparent ? 0 : 1);
    //  Force render at new size
    renderer.render(scene, camera);

    // Capture at 1024x1024
    const dataUrl = canvasElement.toDataURL('image/png');
    renderer.setClearColor(0x000000, 0);
    //  Restore original size
    renderer.setPixelRatio(originalPixelRatio);
    renderer.setSize(originalWidth, originalHeight, false);
    camera.aspect = originalAspect;
    camera.updateProjectionMatrix();
    // Restore occlusion mesh visibility before re-rendering
    if (hiddenOcclusionMesh) hiddenOcclusionMesh.visible = true;
    renderer.render(scene, camera);

    return dataUrl;

  } catch (error) {
    console.error("Error during 1024x1024 capture:", error);

    // Restore original size and occlusion mesh before fallback capture
    try {
      if (hiddenOcclusionMesh) hiddenOcclusionMesh.visible = true;
      renderer.setPixelRatio(originalPixelRatio);
      renderer.setSize(originalWidth, originalHeight, false);
      camera.aspect = originalAspect;
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
    } catch (restoreError) {
      console.error("Failed to restore:", restoreError);
    }

    return canvasElement.toDataURL('image/png');
  }
};



  // After refinement, composite the occlusion region (from the original image) on top of the rendered result
  const applyOcclusionComposite = useCallback(async (renderedDataUrl, occlusionMask) => {
    if (!occlusionMask) return renderedDataUrl;

    const originalSrc = msg.content.startsWith('data:image')
      ? msg.content
      : `${API_BASE_URL}${msg.content.startsWith('/') ? msg.content : `/${msg.content}`}`;

    const loadImage = (src) => new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });

    try {
      const maskSrc = occlusionMask.maskData.startsWith('data:')
        ? occlusionMask.maskData
        : `data:image/png;base64,${occlusionMask.maskData}`;

      const [renderedImg, originalImg, maskImg] = await Promise.all([
        loadImage(renderedDataUrl),
        loadImage(originalSrc),
        loadImage(maskSrc),
      ]);

      const canvas = document.createElement('canvas');
      canvas.width = renderedImg.naturalWidth;
      canvas.height = renderedImg.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(renderedImg, 0, 0, canvas.width, canvas.height);

      const maskCanvas = document.createElement('canvas');
      maskCanvas.width = canvas.width;
      maskCanvas.height = canvas.height;
      maskCanvas.getContext('2d').drawImage(maskImg, 0, 0, canvas.width, canvas.height);
      const maskPixels = maskCanvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);

      const origCanvas = document.createElement('canvas');
      origCanvas.width = canvas.width;
      origCanvas.height = canvas.height;
      origCanvas.getContext('2d').drawImage(originalImg, 0, 0, canvas.width, canvas.height);
      const origPixels = origCanvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);

      const resultPixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < maskPixels.data.length; i += 4) {
        if (maskPixels.data[i] > 128) {
          resultPixels.data[i]     = origPixels.data[i];
          resultPixels.data[i + 1] = origPixels.data[i + 1];
          resultPixels.data[i + 2] = origPixels.data[i + 2];
          resultPixels.data[i + 3] = origPixels.data[i + 3];
        }
      }
      ctx.putImageData(resultPixels, 0, 0);
      return canvas.toDataURL('image/png');
    } catch (e) {
      console.error('Failed to apply occlusion composite:', e);
      return renderedDataUrl;
    }
  }, [msg.content]);
  
//This takees the current div and merge the final selectionw ith the current background
//to create a unify div and display after selection
const mergeImageAndThreeCanvasHighRes = useCallback(async (explicitOverlay = null) => {
  let backgroundSource = inpaintedImage;
  if (!backgroundSource) {
    backgroundSource = msg.content.startsWith('data:image') 
      ? msg.content 
      : `${API_BASE_URL}${msg.content.startsWith("/") ? msg.content : `/${msg.content}`}`;
  }

  const overlaySource = explicitOverlay || previewImage || rerenderedImage || (rerenderOptions.length > 0 ? rerenderOptions[0] : null);
  
  if (!overlaySource) return null;

  const loadImage = (src) => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = src;
    });
  };

  try {
    const [bgImg, overlayImg] = await Promise.all([
      loadImage(backgroundSource),
      loadImage(overlaySource)
    ]);

    const canvas = document.createElement("canvas");
    canvas.width = bgImg.naturalWidth;
    canvas.height = bgImg.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bgImg, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(overlayImg, 0, 0, canvas.width, canvas.height);
    return canvas;
  } catch (e) {
    console.error("Error loading images for high-res merge:", e);
    return null;
  }
}, [inpaintedImage, msg.content, previewImage, rerenderedImage, rerenderOptions]);


// APPLY & FINISH: Saves and closes 
const handleApplyAndFinish = useCallback(async (selectedImgSrc) => {
  let imageToApply = selectedImgSrc || previewImage || rerenderedImage;
  if (!imageToApply && show3DViewer) {
    imageToApply = await capture3DAt1024(true);
  }
  if (!imageToApply) return;

  try {
    const finalCanvas = await mergeImageAndThreeCanvasHighRes(imageToApply);
    if (!finalCanvas) return;

    let dataUrl = finalCanvas.toDataURL("image/png");

    // Apply occlusion mask composite before saving (same as handleRerender)
    const activeOcclusionMask = occlusionMaskId ? savedMasks.find(m => m.id === occlusionMaskId) : null;
    if (activeOcclusionMask) {
      dataUrl = await applyOcclusionComposite(dataUrl, activeOcclusionMask);
    }

    const response = await fetch(`${API_BASE_URL}/save_final_merged_image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        image_base64: dataUrl,
        prompt: detailedPrompt || msg.prompt 
      }),
    });

    const result = await response.json();
    if (result.success) {
      onRerenderComplete(result.url, msg.prompt, false, true);
      if (onImageSaved) onImageSaved();
      clearSegmentation();
      setSegmentationData(prev => ({ ...prev, imageUrl: null }));
      setSavedMasks([]);
      setShow3DViewer(false);
      setRerenderedImage(null);
      setRerenderOptions([]);
      setPipelineStages([]);
    }
  } catch (e) {
    console.error("Failed to apply and finish", e);
  }
}, [
  previewImage,
  rerenderedImage,
  show3DViewer,
  capture3DAt1024,
  detailedPrompt,
  msg.prompt,
  onRerenderComplete,
  onImageSaved,
  clearSegmentation,
  setSegmentationData,
  setSavedMasks,
  setShow3DViewer,
  mergeImageAndThreeCanvasHighRes,
  occlusionMaskId,
  savedMasks,
  applyOcclusionComposite,
]);

  const handleRerender = useCallback(async () => {
  // Prevent multiple simultaneous rerenders
  if (isRerendering) {
    return;
  }

  // Capture the occlusion mask now — show3DViewer will be set false later, which clears occlusionMaskId
  const activeOcclusionMask = occlusionMaskId ? savedMasks.find(m => m.id === occlusionMaskId) : null;

  hasAutoRerenderFiredRef.current = true;
  setIsRerendering(true);
  setRerenderError(null);
  setRerenderOptions([]);
  setPreviewImage(null);
  
  try {
    let imageBase64;
    let promptToSend;

    if (cachedBase64 && cachedPrompt) {
      imageBase64 = cachedBase64;
      promptToSend = cachedPrompt;
      setShow3DViewer(false);
    } else {
      if (!threeDContainerRef.current) throw new Error("3D viewer container not found.");
      
      if (saveTransformRef.current) {
        saveTransformRef.current();
      }
      
      try {
        imageBase64 = await capture3DAt1024();
      } catch (captureError) {
        console.error("High-res capture failed:", captureError);
        const canvasElement = threeDContainerRef.current.querySelector('canvas');
        if (canvasElement) {
          imageBase64 = canvasElement.toDataURL('image/png');
        } else {
          const canvas = await html2canvas(threeDContainerRef.current, {
            useCORS: true, allowTaint: true, backgroundColor: null,
          });
          imageBase64 = canvas.toDataURL('image/png');
        }
      }
      //Updates the 3d modal thumbnail with the new 3d model transforamtion
      setPipelineStages(prev => {
        return prev.map(stage => {
          if (stage.name === "3D View") {
            return {
              ...stage,
              imageUrl: imageBase64 
            };
          }
          return stage;
        });
      });
      promptToSend = detailedPrompt || msg.prompt || "a new version of this";
      setCachedBase64(imageBase64);
      setCachedPrompt(promptToSend);
      setShow3DViewer(false);
    }

    const response = await fetch(`${API_BASE_URL}/refine_with_gemini`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: imageBase64, reference_image: finalMaskReference }),
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error);
    

    if (data.image_options && data.image_options.length > 0) {
      // Composite the occlusion region (original image pixels) on top of each refined option
      let finalOptions = data.image_options;
      if (activeOcclusionMask) {
        finalOptions = await Promise.all(
          data.image_options.map(opt => applyOcclusionComposite(opt, activeOcclusionMask))
        );
      }

      const firstOption = finalOptions[0];

    const isMagicEditMode = !!msg.threeDModelData || executionPhase === 'aiCommandApplied';

     if (isMagicEditMode) {

        setRerenderedImage(firstOption);
        setPreviewImage(firstOption);
        handleApplyAndFinish(firstOption); 
      } else {
        setRerenderedImage(firstOption);
        setRerenderOptions(finalOptions);
        setPipelineStages(prev => {
          const stageName = "Refined Result";
          const filtered = prev.filter(s => s.name !== stageName);
          const newStages = [...filtered, {
            name: stageName,
            imageUrl: firstOption,
            options: finalOptions,
            timestamp: Date.now(),
            status: "completed"
          }];
          setSelectedStageIndex(newStages.length - 1);
          return newStages;
        });
      }
    }

  } catch (err) {
    console.error("Rerender failed:", err);
    setRerenderError(err.message || "Failed to rerender.");
    setRerenderOptions([]);
  } finally {
    setIsRerendering(false);
  }
}, [detailedPrompt, msg.prompt, cachedBase64, cachedPrompt, finalMaskReference, isRerendering, occlusionMaskId, savedMasks, applyOcclusionComposite, handleApplyAndFinish, msg.threeDModelData, executionPhase]);


const handleHarmonize = useCallback(async () => {
  if (isRerendering) return;
  setIsRerendering(true);
  setRerenderError(null);
  setRerenderOptions([]);
  setPreviewImage(null);

  try {
    if (saveTransformRef.current) saveTransformRef.current();

    const backgroundSrc = inpaintedImage ||
      (msg.content.startsWith('data:image') ? msg.content : `${API_BASE_URL}${msg.content.startsWith('/') ? msg.content : `/${msg.content}`}`);
    const threeDTransparent = await capture3DAt1024(true);
    const loadImg = (src) => new Promise((resolve, reject) => {
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img); img.onerror = reject; img.src = src;
    });
    const [bgImg, fgImg] = await Promise.all([loadImg(backgroundSrc), loadImg(threeDTransparent)]);
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 1024;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bgImg, 0, 0, 1024, 1024);
    ctx.drawImage(fgImg, 0, 0, 1024, 1024);
    const compositeBase64 = canvas.toDataURL('image/png');
    setShow3DViewer(false);

    const response = await fetch(`${API_BASE_URL}/refine_with_gemini`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ composite_image: compositeBase64, image_base64: threeDTransparent, mode: 'harmonize' }),
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error);

    if (data.image_options && data.image_options.length > 0) {
      const firstOption = data.image_options[0];
      setRerenderedImage(firstOption);
      setRerenderOptions(data.image_options);
      setPipelineStages(prev => {
        const stageName = "Harmonize Result";
        const filtered = prev.filter(s => s.name !== stageName);
        return [...filtered, { name: stageName, imageUrl: firstOption, options: data.image_options }];
      });
    }
  } catch (err) {
    console.error("Harmonize failed:", err);
    setRerenderError(err.message || "Failed to harmonize.");
  } finally {
    setIsRerendering(false);
  }
}, [isRerendering, inpaintedImage, msg.content, capture3DAt1024]);


// Auto-rerender after 3D model loads and AI command completes
useEffect(() => {
  if (!threeDModel || !show3DViewer || !msg.threeDModelData || !finalMaskReference || hasAutoRerenderFiredRef.current) {
    return;
  }

  //Wait for initial 3D model to display
  if (executionPhase === 'idle') {
    const timer = setTimeout(() => {
      setExecutionPhase('loaded');
    }, 2000);
    return () => clearTimeout(timer);
  }

  // Apply AI command if exists
  if (executionPhase === 'loaded' && !hasAppliedAiCommand) {
    if (msg.aiCommand) {
      
      const commandWithCallback = {
        ...msg.aiCommand,
        onComplete: () => {
          setExecutionPhase('aiCommandApplied');
        }
      };
      
      setAiCommand(commandWithCallback);
      setHasAppliedAiCommand(true);
      return;
    } else {
      setHasAppliedAiCommand(true);
      setExecutionPhase('aiCommandApplied');
    }
  }

  // Wait a bit then trigger rerender
  if (executionPhase === 'aiCommandApplied' && !hasAutoRerenderFiredRef.current) {
    
    const waitForRender = async () => {
      // Wait 1.5 seconds for everything to settle
      await new Promise(resolve => setTimeout(resolve, 1500));

      const canvas = threeDContainerRef.current?.querySelector('canvas');
      if (canvas && !hasAutoRerenderFiredRef.current) {
        hasAutoRerenderFiredRef.current = true;
      
        await handleRerender();
        setExecutionPhase('rerenderTriggered');
      }
    };

    waitForRender();
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [threeDModel, show3DViewer, msg.threeDModelData, finalMaskReference, executionPhase, hasAppliedAiCommand, msg.aiCommand]);


useEffect(() => {
  return () => {
    // Cleanup when component unmounts or msg changes
    setExecutionPhase('idle');
    setHasAppliedAiCommand(false);
    hasAutoRerenderFiredRef.current = false;
  };
}, [msg.content]); // Reset when message changes

  // The 3D viewer uses a hole-punch shader so only the mask alpha is needed —
  // no compositing with the original image required.
  const buildOcclusionTexture = useCallback((mask) => {
    return mask.visUrl;
  }, []);

  const handleMaskSelect = useCallback((mask) => {
    if (show3DViewer) {
      // In 3D mode: toggle occlusion
      if (occlusionMaskId === mask.id) {
        setOcclusionMaskId(null);
        setOcclusionTextureUrl(null);
      } else {
        setOcclusionMaskId(mask.id);
        setOcclusionTextureUrl(buildOcclusionTexture(mask));
      }
    } else {
      // In segmentation mode: select for Generate 3D, show overlay on image, update stage panel
      const newSelectedId = selectedSavedMaskId === mask.id ? null : mask.id;
      setSelectedSavedMaskId(newSelectedId);

      // Show (or clear) the mask overlay directly on the image
      setSegmentationData(prev => ({
        ...prev,
        imageUrl: msg.content,
        masks: newSelectedId
          ? [{ visUrl: mask.visUrl, maskData: mask.maskData, bbox: mask.bbox }]
          : null,
      }));

      if (newSelectedId) {
        setPipelineStages(prev => {
          const stageName = "Segmentation Mask";
          const newStage = { name: stageName, imageUrl: mask.visUrl, timestamp: Date.now(), status: "completed" };
          const existingIndex = prev.findIndex(s => s.name === stageName);
          if (existingIndex !== -1) {
            const updated = [...prev];
            updated[existingIndex] = newStage;
            return updated;
          }
          return [newStage, ...prev];
        });
      }
    }
  }, [show3DViewer, occlusionMaskId, buildOcclusionTexture, selectedSavedMaskId, msg.content, setSegmentationData]);

  const handleClearSegmentation = useCallback(() => {
    clearSegmentation();
    setPipelineStages(prev => prev.filter(s => s.name !== "Segmentation Mask"));
    setSelectedSavedMaskId(null);
  }, [clearSegmentation]);

  const handleDeleteSavedMask = useCallback((maskId) => {
    setSavedMasks(prev => prev.filter(m => m.id !== maskId));
    if (selectedSavedMaskId === maskId) setSelectedSavedMaskId(null);
    if (occlusionMaskId === maskId) {
      setOcclusionMaskId(null);
      setOcclusionTextureUrl(null);
    }
  }, [setSavedMasks, selectedSavedMaskId, occlusionMaskId]);

  // Clear occlusion when leaving 3D view
  useEffect(() => {
    if (!show3DViewer) {
      setOcclusionMaskId(null);
      setOcclusionTextureUrl(null);
    }
  }, [show3DViewer]);

 const generate3DModel = async () => {
    // Always send exactly one mask so finalMaskReference stays clean for Refine Image.
    let maskDataToSend;
    if (selectedSavedMaskId) {
      const selectedMask = savedMasks.find(m => m.id === selectedSavedMaskId);
      if (selectedMask) maskDataToSend = selectedMask.maskData;
    }
    if (!maskDataToSend) {
      maskDataToSend = segmentationData.masks?.[0]?.maskData || segmentationData.maskData;
    }
    const masksToSend = [maskDataToSend];

    if (!masksToSend || masksToSend.length === 0 || !masksToSend[0]) {
      setError("No mask data available");
      return;
    }

    // Auto-save the mask if it hasn't been saved yet
    if (!selectedSavedMaskId && segmentationData.masks?.length > 0) {
      saveMask();
    }

    setShow3DViewer(false);
    setIsGenerating3D(true);
    try {
      const response = await fetch(`${API_BASE_URL}/transform_to_3d_alive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_url: segmentationData.imageUrl,
          mask_data: masksToSend, 
          simple_prompt: msg.prompt 
        })
      });
      const result = await response.json();
      if (result.error) throw new Error(result.error);

      if (result.inpainted_image) {
        setInpaintedImage(result.inpainted_image);
     
      }

      if (result.final_mask_url) {
        setFinalMaskReference(result.final_mask_url); 
    }
      else throw new Error('No inpainted image received from server');

      if (result.detailed_prompt) setDetailedPrompt(result.detailed_prompt);

      if (result.ply_data) {
        const binaryString = window.atob(result.ply_data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        setThreeDModel(bytes.buffer.slice(0));
        setThreeDTransform({
          rotation: result.rotation || null,
          translation: result.translation || null,
          scale: result.scale || null,
        });
        setShow3DViewer(true);
            }
    } catch (error) {
      console.error("3D generation error:", error);
      setError(error.message || 'Unknown error during 3D generation');
      setInpaintedImage(null);
    } finally {
      setIsGenerating3D(false);
    }
  };

const handleInitialView = (imageUrl) => {
    let targetIndex = -1;

    setPipelineStages(prev => {
      const stageName = "3D View";
      const newStage = {
        name: stageName,
        imageUrl: imageUrl,
        timestamp: Date.now(),
        status: "completed"
      };

      const existingIndex = prev.findIndex(stage => stage.name === stageName);

      if (existingIndex !== -1) {
        const updatedStages = [...prev];
        updatedStages[existingIndex] = newStage;
        targetIndex = existingIndex;
        return updatedStages;
      } else {
        targetIndex = prev.length; 
        return [...prev, newStage];
      }
    });


    setTimeout(() => {
      if (targetIndex !== -1) {
        setSelectedStageIndex(targetIndex);
      }
    }, 50);
  };





//SAVE VERSION: Merges and saves but stays in editor
const handleSaveVersion = async (selectedImgSrc) => {
  let imageToSave = selectedImgSrc || previewImage || rerenderedImage;
  if (!imageToSave && show3DViewer) {
    imageToSave = await capture3DAt1024(true);
  }
  if (!imageToSave) return;
  
  try {
    const finalCanvas = await mergeImageAndThreeCanvasHighRes(imageToSave);
    if (!finalCanvas) return;

    let dataUrl = finalCanvas.toDataURL("image/png");

    // Apply occlusion mask composite so the 3D object appears behind occluded regions
    const activeOcclusionMask = occlusionMaskId ? savedMasks.find(m => m.id === occlusionMaskId) : null;
    if (activeOcclusionMask) {
      dataUrl = await applyOcclusionComposite(dataUrl, activeOcclusionMask);
    }

    const response = await fetch(`${API_BASE_URL}/save_final_merged_image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_base64: dataUrl, prompt: msg.prompt }),
    });

    const result = await response.json();
    if (result.success) {
      setSaveNotification(true);
      setTimeout(() => setSaveNotification(false), 2500);
      if (onImageSaved) onImageSaved(); 
    }
  } catch (e) {
    console.error("Failed to save version", e);
  }
};

//  DISCARD: Resets state 
const handleDiscard = useCallback(() => {
  clearSegmentation();
  setSegmentationData(prev => ({ ...prev, imageUrl: null }));
  setSavedMasks([]);
  setShow3DViewer(false);
  setRerenderedImage(null);
  setRerenderOptions([]);
  setPipelineStages([]);
  setThreeDModel(null);
  setInpaintedImage(null);
  hasAutoRerenderFiredRef.current = false;
  setExecutionPhase('idle');
  if (onRerenderComplete) {
    onRerenderComplete(msg.content, msg.prompt, true);
  }
}, [clearSegmentation, setSegmentationData, setSavedMasks, msg.content, msg.prompt, onRerenderComplete]);

//OPTION SELECT: Map the click on a thumbnail to Apply & Finish
const handleOptionSelect = (imgSrc) => {
  setPreviewImage(imgSrc);
  setPipelineStages(prev => prev.map(s => 
    s.name === "Refined Result" ? { ...s, imageUrl: imgSrc } : s
  ));
};


const getCurrentImageSource = () => {
  if (inpaintedImage && (show3DViewer || rerenderedImage || previewImage || rerenderOptions.length > 0 || isRerendering)) {
    return inpaintedImage;
  }


  if (msg.content.startsWith('data:image')) return msg.content;
    return `${API_BASE_URL}${msg.content.startsWith("/") ? msg.content : `/${msg.content}`}`;
  };

  const isClickable = !show3DViewer && !rerenderedImage && rerenderOptions.length === 0 && !isRerendering;

  return (
        <div className={`image-message-wrapper ${pipelineStages.length > 0 ? 'has-panel' : ''}`} style={segmentationData.displayWidth ? {width: segmentationData.displayWidth} : {}}>      <div className="image-message">
        <div className="image-container" ref={imageContainerRef}>
        <img
          src={getCurrentImageSource()}
          alt={msg.prompt || "Generated"}
          crossOrigin="anonymous"
          onClick={isClickable ? (e) => handleImageClick(e, msg.content) : undefined}
          style={isClickable ? {} : { cursor: 'default' }}
          onLoad={!show3DViewer ? (e) => {
            const img = e.target;
            const rect = img.getBoundingClientRect();
            setSegmentationData((prev) => ({
              ...prev,
              displayWidth: rect.width,
              displayHeight: rect.height,
              naturalWidth: img.naturalWidth,
              naturalHeight: img.naturalHeight,
            }));
          } : undefined}

          
        />
        {saveNotification && (
          <div className="save-notification">
            Image Saved
          </div>
        )}
        {(rerenderedImage || previewImage) && !show3DViewer && (
          <img
            src={previewImage || rerenderedImage}
            alt="Refined result"
            crossOrigin="anonymous"
            className="rerendered-image-overlay"
          
          />
        )}

        <div className="three-d-wrapper" ref={threeDContainerRef} style={{
          position: "absolute", top: 0, left: 0, width: "100%", height: "100%",
          zIndex: 10, borderRadius: "8px", overflow: "hidden", display: show3DViewer ? "block" : "none",
        }}>
          {threeDModel && segmentationData.imageUrl && (
            <ThreeDViewer
              onInitialView={handleInitialView}
              threeDModel={threeDModel}
              currentTransform={currentTransform}
              onTransformUpdate={setCurrentTransform}
              bboxs={segmentationData.bbox}
              imageDisplaySize={imageDisplaySize}
              show3DViewer={show3DViewer}
              setShow3DViewer={setShow3DViewer}
              setError={setError}
              resetViewRef={resetViewRef}
              saveTransformRef={saveTransformRef}
              threeDTransform={threeDTransform}
              aiCommand={aiCommand}
              rendererRefParent={rendererRef}
              cameraRefParent={cameraRef}
              sceneRefParent={sceneRef}
              occlusionTextureUrl={occlusionTextureUrl}
            />
          )}
        </div>

        {segmentationData.imageUrl === msg.content && !show3DViewer && !rerenderedImage && !previewImage && rerenderOptions.length === 0 && !isRerendering && (
          <SegmentationOverlay
            msg={msg}
            segmentationData={segmentationData}
            error={error}
            loading={loading}
            show3DViewer={show3DViewer}
          />
        )}

      {isGenerating3D && segmentationData.imageUrl === msg.content && (
        <div className="generating-3d-overlay">
          <div className="loader-container">
            {/* Containerfor the new 3d generating loader */}
            <div id="pulse-wave-container" className="animation-container"></div>
          </div>
        </div>
      )}
        {rerenderOptions.length > 0 &&
         (pipelineStages[selectedStageIndex]?.name === "Refined Result" && !msg.threeDModelData ||
          pipelineStages[selectedStageIndex]?.name === "Harmonize Result") && (
          <div className="rerender-selection-overlay">
            <div className="rerender-selection-header">
              <p>Select your preferred image</p>
              <button className="reroll-btn" onClick={pipelineStages[selectedStageIndex]?.name === "Harmonize Result" ? handleHarmonize : handleRerender} disabled={isRerendering}>
                {isRerendering ? "..." : "Try Again"}
              </button>
            </div>
                <div className="rerender-options-container">
                {rerenderOptions.map((imgSrc, index) => (
                  <img
                    key={index}
                    src={imgSrc}
                    alt={`Option ${index + 1}`}
                    className={`rerender-option-image ${previewImage === imgSrc ? 'selected' : ''}`}
                    onClick={() => {
                      handleOptionSelect(imgSrc)
                    }}
                  />
                ))}
            </div>
          </div>
        )}
      </div>

      {isRerendering && rerenderOptions.length === 0 && (
        <div className="refinement-loading-container">
          <div className="refinement-text">Rerendering...</div>
          <div className="refinement-bar-background">
            <div className="refinement-loading-bar"></div>
          </div>
        </div>
      )}

      {segmentationData.imageUrl === msg.content && !rerenderedImage && rerenderOptions.length === 0 && !isRerendering && (
        <>
          <SavedMasksPanel
            savedMasks={savedMasks}
            selectedId={selectedSavedMaskId}
            occlusionId={occlusionMaskId}
            onSelect={handleMaskSelect}
            onDelete={handleDeleteSavedMask}
            show3DViewer={show3DViewer}
          />
          <SegmentationControls
            segmentationData={segmentationData}
            generate3DModel={generate3DModel}
            clearSegmentation={handleClearSegmentation}
            threeDModel={threeDModel}
            show3DViewer={show3DViewer}
            setShow3DViewer={setShow3DViewer}
            isGenerating3D={isGenerating3D}
            resetViewRef={resetViewRef}
            isRerendering={isRerendering}
            rerenderError={rerenderError}
            onSaveMask={saveMask}
            selectedSavedMaskId={selectedSavedMaskId}
            onHarmonize={handleHarmonize}
          />
        </>
      )}

        {msg.prompt && <div className="image-prompt">{msg.prompt}</div>}
        {msg.timestamp && <div className="image-timestamp">{new Date(msg.timestamp).toLocaleString()}</div>}
      </div>

      {pipelineStages.length > 0 && (
        <StagePanel
          stages={pipelineStages}
          onStageClick={handleStageClick}
         selectedStageIndex={selectedStageIndex}
          onSave={() => handleSaveVersion(previewImage || rerenderedImage)}
          onConfirm={() => handleApplyAndFinish(previewImage || rerenderedImage)}
          onDiscard={handleDiscard}
         showControls={(show3DViewer || rerenderOptions.length > 0 || !!rerenderedImage) && !msg.threeDModelData}
        />
      )}

      {showStageModal && (
        <StageModal
          stages={pipelineStages}
          selectedIndex={selectedStageIndex}
          onClose={closeModal}
          onNavigate={navigateStage}
        />
      )}
    </div>
  );
};

export default ImageMessage;