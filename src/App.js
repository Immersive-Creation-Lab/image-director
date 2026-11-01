import React, { useState, useEffect, useRef } from 'react';
import { CSSTransition } from 'react-transition-group';
import { io } from "socket.io-client";

// Components
import ImageGenerator from './components/ImageGen_Input/ImageGen_Input';
import Thumbnails from './components/Thumbnails/Thumbnails';
import { handleGeneration } from './components/GenerateHandler/GenerateHandler'
// Assets
import ImagenLogo from './assets/gemini_logo.png';
import openailogo from './assets/chatgpt-logo-chat-gpt-icon-on-white-background-free-vector.jpg';
import new_chatlogo from './assets/new_chatlogo.png';
import { ReactComponent as CaretIcon } from './assets/download.svg';
import { ReactComponent as ArrowIcon } from './assets/arrow.svg';
import { ReactComponent as Right_arrow } from './assets/right_arrow.svg';

// Styles
import './Animation.css';
import './App.css';
import { API_BASE_URL } from './config';

function App() {
  const [images, setImages] = useState([]);//Stores images that will go in the history grid
  const [loading, setLoading] = useState(false);//tracks loading states for thumnails 
  const [isGenerating, setIsGenerating] = useState(false);//Tracks image generation status
  const [currentImage, setCurrentImage] = useState(null);//Currently selected/main image
  const [showTitle, setShowTitle] = useState(true);// Controls visibility of the welcome title
  const [isAnimating, setIsAnimating] = useState(false);//Tracks the history of prompts and results
  const [conversation, setConversation] = useState([]); //This will Track the whole conversation
  const [selectedModel, setSelectedModel] = useState({//Currently selected AI model
    provider: 'Imagen',
    model: 'gemini-2.5-flash-image'
  });
  const [forceReset, setForceReset] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const handleGlobalDragEnd = () => {
    setIsDragging(false);
    setIsOverDropZone(false);
  };
  const reloadGallery = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/Thumbnails`);
      const data = await res.json();
      setImages(data);
    } catch (error) {
      console.error("Failed to reload gallery images:", error);
    }
  };
  const [isOverDropZone, setIsOverDropZone] = useState(false);
  

const handleDrop = (e) => {
  e.preventDefault();
  handleGlobalDragEnd();
  setIsOverDropZone(false);
  
  const rawData = e.dataTransfer.getData("application/react-image-data");
  if (rawData) {
    const droppedImg = JSON.parse(rawData);
    setCurrentImage({
      ...droppedImg,
      isFromDrop: true 
    });
    setShowTitle(false); 
  }
};

useEffect(() => {
  if (currentImage?.isFromDrop) {
    const timer = setTimeout(() => {
    
    }, 5000);

    return () => clearTimeout(timer);
  }
}, [currentImage?.isFromDrop]);

  useEffect(() => {
  let isMounted = true;//isMounted as a guard so it won’t set state if the component is already unmounted.
  const newSocket = io(API_BASE_URL);//connects to the backend

  const loadImages = async () => {
    if (!isMounted) return;
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/Thumbnails`);
      const data = await res.json();
      if (isMounted) setImages(data);
    } finally {
      if (isMounted) setLoading(false);
    }
  };
  
  loadImages();
  //This is real-time UI Updated without needing to refresh
 newSocket.on('new_image', (newImage) => {
  
  setImages(prev => {
    const updatedImages = [newImage, ...prev];
    setConversation(prevConv => [
      ...prevConv.filter(item => item.id !== newImage.id),
      {
        prompt: newImage.prompt,
        url: newImage.url,
        description: newImage.description,
        id: newImage.id,
        model: newImage.model,
        timestamp: newImage.timestamp
      }
    ]);
    return updatedImages;
  });
  
  setCurrentImage(newImage);
  setIsGenerating(false);
});
  return () => {
    isMounted = false;
    newSocket.off('new_image');
    newSocket.disconnect();
  };
}, []);


const handleGenerate = async (prompt, referenceImageUrl = null) => {
  try {
    const result = await handleGeneration({
      prompt,
      referenceImageUrl,
      selectedModel,
      conversation,
      setShowTitle,
      setIsGenerating,
      setIsAnimating,
      setCurrentImage,
      setImages,
      setConversation
    });

    // Handle any additional state updates if needed
    if (result) {
      setConversation(prevConv => [
        ...prevConv,
        {
          prompt: result.prompt,
          url: result.url,
          description: result.description,
          id: result.id,
          model: result.model,
          timestamp: result.timestamp
        }
      ]);
    }
  } catch (error) {
    alert(`Error: ${error.message}`);
  }
};
 

  const handleModelSelect = (provider, model) => {
    setSelectedModel({ provider, model });
  };


const renderSelectedModelDisplay = (currentModel) => {    
  if (!currentModel) return null;
    if (selectedModel.provider === 'openai') {
      return (
        <>
          <img src={openailogo} alt="OpenAI" className="icon-image small" />
            {selectedModel.model === 'gpt-image-2' ? 'GPT IMAGE 2' : selectedModel.model === 'gpt-image-1' ? 'GPT IMAGE 1' : selectedModel.model}        </>
      );
    }
    if (selectedModel.provider === 'Imagen') {
      const labels = {
        'gemini-2.5-flash-image': 'Nano Banana (legacy)',
        'gemini-3.1-flash-lite-image': 'Nano Banana 2 Lite',
        'gemini-3.1-flash-image': 'Nano Banana 2',
        'gemini-3-pro-image': 'Nano Banana Pro'
      };
      return (
        <>
          <img src={ImagenLogo} alt="Nano Banana" className="icon-image small" />
          {labels[selectedModel.model] || selectedModel.model}
        </>
      );
    }
    return null;
  };
return (
    <>
    <Navbar 
      selectedModel={selectedModel} 
      onNewChat={() => {
        setConversation([]);
        setCurrentImage(null);
        setShowTitle(true);
        setForceReset(prev => prev + 1);  
      }}
    >
      <NavItem 
      icon={<CaretIcon />} 
      content={renderSelectedModelDisplay(selectedModel)} >
       
        <DropdownMenu 
          onModelSelect={handleModelSelect} 
          selectedModel={selectedModel}
        />
      </NavItem>
    </Navbar>

    {/* Scrollable content */}
          <div className="chat-wrapper">
        <div className="scrollable-chat">
          {showTitle && (
            <CSSTransition in={showTitle} timeout={300} classNames="fade" unmountOnExit>
              <div className="title-container">
                <h1 className="main-title">ImageDirector</h1>
              </div>
            </CSSTransition>
          )}
       <div 
          className={`drag-and-dropped-container ${isDragging ? 'visible' : ''} ${isOverDropZone ? 'drag-active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsOverDropZone(true); }}
          onDragLeave={() => setIsOverDropZone(false)}
          onDrop={handleDrop}
        >
          </div>
          <div 
            className={`content-container ${!showTitle ? 'content-expand' : ''}`}
            >

  
          {currentImage?.isFromDrop && (
            <div className="drop-instruction-message">
              <p>
                Selected image for editing: <strong>"{currentImage.prompt || 'Previous Generation'}"</strong>. 
                You can now type instructions (e.g., 'rotate left') or click the image. To start fresh, click the New Chat button.
              </p>
            </div>
          )}


            <ImageGenerator 
              key={forceReset}  
              onGenerate={handleGenerate}
              onImageSaved={reloadGallery}
              selectedModel={selectedModel}
              setCurrentImage={setCurrentImage}
              currentImage={currentImage}
              currentDescription={conversation.find(item => item.url === currentImage?.url)?.description}
              isGenerating={isGenerating}
            />
          </div>
        </div>
        <div className="fixed-thumbnails">
        <Thumbnails
          images={[...new Map(images.map(item => [item.id, item])).values()]}
          loading={loading}
          isGallery={false}
          onDragStateChange={setIsDragging}
          onReloadImages={reloadGallery}
          descriptions={conversation.reduce((acc, item) => {
            if (item.url && item.description) {
              acc[item.url] = item.description;
            }
            return acc;
          }, {})}
        />      
        </div>
      </div>
  </>
);

}

function Navbar({ selectedModel, children, onNewChat }) {
  return (
    <nav className="navbar">
      <ul className="navbar-nav">
        <li className="nav-item">
          <button className="new-chat-btn" onClick={onNewChat}>
            <img src={new_chatlogo} alt="App Logo" className="nav-logo" />
             <span style={{position: 'relative', top: '-2px'}}>New Chat</span>
          </button>
        </li>
        <div className="nav-spacer"></div>

        {children}
      </ul>
    </nav>
  );
}

function NavItem(props) {
  const [open, setOpen] = useState(false);

  return (
    <li className="nav-item model-dropdown-container">
      <a href="#" className="model-selector-btn" onClick={(e) => { e.preventDefault(); setOpen(!open); }}>
        <div className="model-text">
          {props.content}
        </div>
        <span className="caret-container">{props.icon}</span>
      </a>
      {open && React.cloneElement(props.children, {
        closeMenu: () => setOpen(false)
      })}
    </li>
  );
}

function DropdownMenu({ onModelSelect, selectedModel, closeMenu  }) {
  const [activeMenu, setActiveMenu] = useState('main');
  const [menuHeight, setMenuHeight] = useState(null);
  const dropdownRef = useRef(null);
  const menuPrimaryRef = useRef(null);
  const menuImagenRef = useRef(null);
  const menuOpenAIRef = useRef(null);

  useEffect(() => {
    setMenuHeight(dropdownRef.current?.firstChild.offsetHeight);
  }, []);

  function calcHeight(el) {
    const height = el.offsetHeight;
    setMenuHeight(height);
  }

  function DropdownItem(props) {
    return (
      <a 
        href="#" 
        className="menu-item" 
        onClick={() => {
          if (props.onClick) props.onClick();
          if (props.goToMenu) setActiveMenu(props.goToMenu);
        }}
      >
        <span className="icon-button">{props.leftIcon}</span>
        {props.children}
        <span className="icon-right">{props.rightIcon}</span>
      </a>
    );
  }

   const handleModelClick = (provider, model) => {
    onModelSelect(provider, model);
    closeMenu(); 
  };

  return (
    <div className="dropdown" style={{ height: menuHeight }} ref={dropdownRef}>
      <CSSTransition
        in={activeMenu === 'main'}
        timeout={500}
        classNames="menu-primary"
        unmountOnExit
        onEnter={calcHeight}
        nodeRef={menuPrimaryRef}
      >
        <div className="menu" ref={menuPrimaryRef}>
          <DropdownItem
            leftIcon={<img src={openailogo} alt="OpenAI" className="icon-image" />}
            rightIcon={<Right_arrow />}
            goToMenu="OpenAI"
          >
            OpenAI
          </DropdownItem>

          <DropdownItem
            leftIcon={<img src={ImagenLogo} alt="Nano Banana" className="icon-image" />}
            rightIcon={<Right_arrow />}
            goToMenu="Google Imagen"
          >
            Nano Banana
          </DropdownItem>

        </div>
      </CSSTransition>

      <CSSTransition
        in={activeMenu === 'Google Imagen'}
        timeout={500}
        classNames="menu-secondary"
        unmountOnExit
        onEnter={calcHeight}
        nodeRef={menuImagenRef}
      >
        <div className="menu" ref={menuImagenRef}>
          <DropdownItem goToMenu="main" leftIcon={<ArrowIcon />}>
            <h2>Nano Banana</h2>
          </DropdownItem>
          <DropdownItem 
            leftIcon={<img src={ImagenLogo} alt="Nano Banana" className="icon-image" />}
            onClick={() => handleModelClick('Imagen', 'gemini-2.5-flash-image')}
            active={selectedModel.model === 'gemini-2.5-flash-image'}
          >
            Nano Banana (legacy)
          </DropdownItem>

          <DropdownItem 
            leftIcon={<img src={ImagenLogo} alt="Nano Banana" className="icon-image" />}
            onClick={() => handleModelClick('Imagen', 'gemini-3-pro-image')}
            active={selectedModel.model === 'gemini-3-pro-image'}
          >
            Nano Banana Pro
          </DropdownItem>
          <DropdownItem 
            leftIcon={<img src={ImagenLogo} alt="Nano Banana" className="icon-image" />}
            onClick={() => handleModelClick('Imagen', 'gemini-3.1-flash-image')}
            active={selectedModel.model === 'gemini-3.1-flash-image'}
          >
            Nano Banana 2
          </DropdownItem>
          <DropdownItem 
            leftIcon={<img src={ImagenLogo} alt="Nano Banana" className="icon-image" />}
            onClick={() => handleModelClick('Imagen', 'gemini-3.1-flash-lite-image')}
            active={selectedModel.model === 'gemini-3.1-flash-lite-image'}
          >
            Nano Banana 2 Lite
          </DropdownItem>
        </div>
      </CSSTransition>

      <CSSTransition
        in={activeMenu === 'OpenAI'}
        timeout={500}
        classNames="menu-secondary"
        unmountOnExit
        onEnter={calcHeight}
        nodeRef={menuOpenAIRef}
      >
      <div className="menu" ref={menuOpenAIRef}>
          <DropdownItem goToMenu="main" leftIcon={<ArrowIcon />}>
            <h2>OpenAI</h2>
          </DropdownItem>
          
          <DropdownItem 
            leftIcon={<img src={openailogo} alt="OpenAI" className="icon-image" />}
            onClick={() => handleModelClick('openai', 'gpt-image-2')}
            active={selectedModel.model === 'gpt-image-2'}
          >
            GPT IMAGE 2
          </DropdownItem>

          <DropdownItem 
            leftIcon={<img src={openailogo} alt="OpenAI" className="icon-image" />}
            onClick={() => handleModelClick('openai', 'gpt-image-1')}
            active={selectedModel.model === 'gpt-image-1'}
          >
            GPT IMAGE 1
          </DropdownItem>

        </div>
      </CSSTransition>

    </div>
  );
}

export default App;