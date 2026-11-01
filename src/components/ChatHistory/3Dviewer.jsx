import { useEffect, useRef, useState, useCallback } from "react";
import './3Dviewer.css';
// Cache dynamic imports so we don't re-import on every render
let cachedLibsPromise = null;
async function loadThreeAndPlugins() {
  if (cachedLibsPromise) return cachedLibsPromise;
  cachedLibsPromise = (async () => {
    const threeModule = await import('three');
    const sparkModule = await import('@sparkjsdev/spark');
    const controlsModule = await import('three/examples/jsm/controls/OrbitControls.js');
    return {
      THREE: threeModule,
      SplatMesh: sparkModule.SplatMesh,
      SparkRenderer: sparkModule.SparkRenderer,
      OrbitControls: controlsModule.OrbitControls,

    };
  })();
  return cachedLibsPromise;
}

const ThreeDViewer = ({
  threeDModel,
  bboxs,
  imageDisplaySize,
  show3DViewer,
  setShow3DViewer,
  setError,
  resetViewRef,
  saveTransformRef,
  aiCommand,
  onInitialView,
  threeDTransform,
  onTransformUpdate,
  currentTransform,
  rendererRefParent,
  cameraRefParent,
  sceneRefParent,
  occlusionTextureUrl,
 }) => {

  // threeDModel → the binary data of the 3D model.
  // bboxs → bounding box coordinates (minX, maxX, etc.).
  // imageDisplaySize → { width, height } of the image the 3D model aligns with.
  // show3DViewer → whether the viewer should be displayed.
  // setShow3DViewer → toggles visibility.
  // setError → sets an error message if something fails.
  // resetViewRef → a React ref that will later hold a function to reset the camera view.
  // saveTransformRef → a React ref that will hold a function to save current transform on demand.
  //onTransformUpdate -> When called with { rotation, position, scale }, it updates the currentTransform state in ImageMessage
  //currentTransform - > When you navigate back to the 3D view, this is used to restore the object to its last position/rotation/scale.
  // rendererRefParent-> store the WebGL renderer
  // cameraRefParent->  store the PerspectiveCamera
  // sceneRefParent  ->  store the 3D Scene
  const [isLoadingLibraries, setIsLoadingLibraries] = useState(false);
  const isLoadingLibrariesRef = useRef(false);
  const isMountedRef = useRef(true);

  const threeRef = useRef(null);
  const occlusionMeshRef = useRef(null);

  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const animationIdRef = useRef(null);
  const controlsRef = useRef(null);
  const splatMeshRef = useRef(null);

  const pivotGroupRef = useRef(null);

  // const parentGroupRef = useRef(null);
  const cameraRef = useRef(null);
  const sparkRef = useRef(null);
  const isCleaningUpRef = useRef(false);
  const loadPromiseRef = useRef(null);
  const resizeTimeoutRef = useRef(null);
  const containerRef = useRef(null);
  const resizeObserverRef = useRef(null);

  const lastCommandIdRef = useRef(null);
  const hasCapturedInitialViewRef = useRef(false);

  const onTransformUpdateRef = useRef(onTransformUpdate);
    useEffect(() => {
      //Keep the ref updated whenever the prop changes
      onTransformUpdateRef.current = onTransformUpdate;
    }, [onTransformUpdate]);
  //This acts as "save changes" function it captures current transformations 
  useEffect(() => {
    if (saveTransformRef) {
      saveTransformRef.current = () => {
        if (pivotGroupRef.current && onTransformUpdateRef.current) {
          onTransformUpdateRef.current({
            rotation: pivotGroupRef.current.rotation.clone(),
            position: pivotGroupRef.current.position.clone(),
            scale: pivotGroupRef.current.scale.clone()
          });
        }
      };
    }
  }, [saveTransformRef]);

  const applyOcclusionMesh = useCallback((THREE, scene, url) => {
    // Remove existing occlusion mesh
    if (occlusionMeshRef.current) {
      scene.remove(occlusionMeshRef.current);
      occlusionMeshRef.current.geometry.dispose();
      if (occlusionMeshRef.current.material.map) {
        occlusionMeshRef.current.material.map.dispose();
      }
      occlusionMeshRef.current.material.dispose();
      occlusionMeshRef.current = null;
    }

    if (!url) return;

    const camera = cameraRef.current;
    const container = containerRef.current;
    if (!camera || !container) return;

    // Size the plane to exactly fill the viewport at Z=0
    // Camera is at (0,0,-2) looking at (0,0,0), so distance to Z=0 plane is 2
    const dist = Math.abs(camera.position.z);
    const vFovRad = (camera.fov * Math.PI) / 180;
    const planeH = 2 * dist * Math.tan(vFovRad / 2);
    const aspect = container.clientWidth / container.clientHeight;
    const planeW = planeH * aspect;

    const texture = new THREE.TextureLoader().load(url);

    const geometry = new THREE.PlaneGeometry(planeW, planeH);

    // Punch a transparent hole in the Three.js canvas where the mask is opaque.
    // The CSS background image then shows through at full fidelity — no compositing,
    // no double-rendering, no brightness shift.
    // UV x is flipped in the shader because the camera's local +X = world -X.
    const material = new THREE.ShaderMaterial({
      uniforms: { maskMap: { value: texture } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D maskMap;
        varying vec2 vUv;
        void main() {
          vec2 uv = vec2(1.0 - vUv.x, vUv.y);
          vec4 mask = texture2D(maskMap, uv);
          if (mask.a < 0.1) discard;
          gl_FragColor = vec4(0.0, 0.0, 0.0, 0.0);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.ZeroFactor,
      blendDst: THREE.ZeroFactor,
      blendEquationAlpha: THREE.AddEquation,
      blendSrcAlpha: THREE.ZeroFactor,
      blendDstAlpha: THREE.ZeroFactor,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 999;
    mesh.position.set(0, 0, 0);

    scene.add(mesh);
    occlusionMeshRef.current = mesh;
  }, []);

  const handleResize = useCallback(() => {
    if (resizeTimeoutRef.current) {
      clearTimeout(resizeTimeoutRef.current);
    }
    resizeTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current || isCleaningUpRef.current) return;
      const container = containerRef.current;
      const renderer = rendererRef.current;
      const camera = cameraRef.current;
      if (container && renderer && camera) {
        try {
          renderer.setSize(container.clientWidth, container.clientHeight, false);
          camera.aspect = container.clientWidth / container.clientHeight;
          camera.updateProjectionMatrix();
        } catch (e) {
          console.warn("Error in handleResize:", e);
        }
      }
    }, 100);
  }, []);

  useEffect(() => {
    isLoadingLibrariesRef.current = isLoadingLibraries;
  }, [isLoadingLibraries]);

  useEffect(() => {
    isMountedRef.current = true;
    isCleaningUpRef.current = false;
    lastCommandIdRef.current = null;

    const cleanup = () => {
      isCleaningUpRef.current = true;
      isMountedRef.current = false;

      if (resizeTimeoutRef.current) {
        clearTimeout(resizeTimeoutRef.current);
        resizeTimeoutRef.current = null;
      }
      if (animationIdRef.current) {
        cancelAnimationFrame(animationIdRef.current);
        animationIdRef.current = null;
      }
      loadPromiseRef.current = null;
      if (resizeObserverRef.current && containerRef.current) {
        try { resizeObserverRef.current.disconnect(); } catch (e) {}
        resizeObserverRef.current = null;
      }
      window.removeEventListener("resize", handleResize);

      if (controlsRef.current) {
        controlsRef.current.dispose();
        controlsRef.current = null;
      }
      if (pivotGroupRef.current && sceneRef.current) {
        try {
          sceneRef.current.remove(pivotGroupRef.current);
        } catch (e) {}
        pivotGroupRef.current = null;
      }
      if (splatMeshRef.current) {
        try {
          if (typeof splatMeshRef.current.dispose === "function") {
            splatMeshRef.current.dispose();
          }
        } catch (e) {}
        splatMeshRef.current = null;
      }
      if (occlusionMeshRef.current && sceneRef.current) {
        try {
          sceneRef.current.remove(occlusionMeshRef.current);
          occlusionMeshRef.current.geometry.dispose();
          if (occlusionMeshRef.current.material.map) {
            occlusionMeshRef.current.material.map.dispose();
          }
          occlusionMeshRef.current.material.dispose();
        } catch (e) {}
        occlusionMeshRef.current = null;
      }
      if (sparkRef.current && sceneRef.current) {
        try {
          sceneRef.current.remove(sparkRef.current);
          sparkRef.current.renderer = null;
        } catch (e) {}
        sparkRef.current = null;
      }
      if (sceneRef.current) {
        try {
          sceneRef.current.clear();
        } catch (e) {}
        sceneRef.current = null;
      }
      if (rendererRef.current) {
        try {
          rendererRef.current.dispose();
          const canvas = rendererRef.current.domElement;
          if (canvas && canvas.parentNode) {
            canvas.parentNode.removeChild(canvas);
          }
        } catch (e) {}
        rendererRef.current = null;
      }
      cameraRef.current = null;
      const container = containerRef.current || document.getElementById("three-container");
      if (container) container.innerHTML = "";
    };

    if (threeDModel && show3DViewer && !isLoadingLibrariesRef.current) {
      const loadAndRender = async () => {
        const currentLoadId = Symbol("loadPromise");
        loadPromiseRef.current = currentLoadId;
        try {
          setIsLoadingLibraries(true);
          setError(null);
          const { THREE, SplatMesh, SparkRenderer } = await loadThreeAndPlugins();
          threeRef.current = THREE;

          // Quick WebGL check
          const canvasCheck = document.createElement("canvas");
          const gl = canvasCheck.getContext("webgl") || canvasCheck.getContext("experimental-webgl");
          if (!gl) throw new Error("WebGL not supported");

          // Get the container element
          const container = containerRef.current || document.getElementById("three-container");
          if (!container) return;

          // Scene, Camera, & Light Setup 
          const scene = new THREE.Scene();
          const camera = new THREE.PerspectiveCamera(
            40, // Field of View
            container.clientWidth / container.clientHeight, // Aspect Ratio
            0.1, // Near clipping plane
            70   // Far clipping plane
          );
          cameraRef.current = camera;

          camera.position.set(0, 0, -2);
          camera.lookAt(0, 0, 0);
          camera.up.set(0, 1, 0); 

          // Initialize SparkRenderer (for Gaussian Splatting)
          let spark;
          try {
            spark = new SparkRenderer({ renderer: null });
            scene.add(spark);
            sparkRef.current = spark;
          } catch (err) {
            throw new Error("SparkRenderer initialization failed");
          }

          // Add basic lighting
          scene.add(new THREE.AmbientLight(0x404040));
          const dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
          dirLight.position.set(1, 1, 1);
          scene.add(dirLight);

          let url = null;
          //Loads the binary 3d data into the mesh
          let splatMesh;
          try {
            const blob = new Blob([threeDModel], { type: "application/octet-stream" });
            url = URL.createObjectURL(blob);
            splatMesh = new SplatMesh({ url });
            splatMeshRef.current = splatMesh;
          } finally {
            if (url) URL.revokeObjectURL(url);
          }

          splatMesh.scale.set(10, 10, 10);
          // Create pivot group for proper rotation around mesh center
          const pivotGroup = new THREE.Group();
          pivotGroupRef.current = pivotGroup;
          pivotGroup.add(splatMesh);
          scene.add(pivotGroup);
          // Center the mesh within the pivot, then move pivot to original position
          const transform = threeDTransform || {};
          if (transform.translation && transform.translation.length === 3) {
            const [tx, ty, tz] = transform.translation;
            const scale = 10; // same as splatMesh.scale
            // Offset mesh so its center is at pivot origin
            splatMesh.position.set(-tx * scale, -ty * scale, -tz * scale);
            // Move pivot to where mesh center originally was (keeps visual position)
            pivotGroup.position.set(tx * scale, ty * scale, tz * scale);
          }
          // If we decide to backtrack and edit the position or rotation of the object we apply the following 
          //transformations we always center the splatMesh inside the pivot using threeDTransform 
          //then if currentTransform exists, apply the saved rotation/position/scale to the pivotGroup 
          if (currentTransform) {
            pivotGroup.rotation.copy(currentTransform.rotation);
            pivotGroup.position.copy(currentTransform.position);
            pivotGroup.scale.copy(currentTransform.scale);
          }

          // Renderer (cap pixel ratio for performance)
          const renderer = new THREE.WebGLRenderer({
            alpha: true,
            antialias: false,
            preserveDrawingBuffer: true,
          });
          const pixelRatio = Math.min(window.devicePixelRatio || 1, 1);
          renderer.setPixelRatio(pixelRatio);
          renderer.setSize(container.clientWidth, container.clientHeight, false);
          renderer.setClearColor(0x000000, 0);
          // renderer.setClearColor(0xffffff, 1);
          container.innerHTML = "";
          container.appendChild(renderer.domElement);

          if (spark) {
            spark.renderer = renderer;
          }

          // Custom object-manipulation handlers (rotate/pan/scale via pivotGroup)
          const raycaster = new THREE.Raycaster();
          const ndc = new THREE.Vector2();
          const dragPlane = new THREE.Plane();
          const dragStartPoint = new THREE.Vector3();
          const initialPivotPos = new THREE.Vector3();
          const prevPointer = { x: 0, y: 0 };
          const dragStartPointer = { x: 0, y: 0 };
          let activePointerId = null;
          let pointerAction = null; // 'rotate' | 'pan' | null
          let rotateAxis = null;    // 'x' | 'y' | null — locked once dominant axis detected
          const AXIS_LOCK_THRESHOLD = 8; // pixels of travel before locking axis

          // Sensitivity settings (tweakable)
          const rotateSensitivity = 0.005; // radians per pixel
          const scaleSensitivity = 0.001; // wheel delta multiplier for scaling
          const panPlaneNormal = new THREE.Vector3();

          const getNDC = (event) => {
            const rect = renderer.domElement.getBoundingClientRect();
            ndc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            ndc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
            return ndc;
          };

          const onPointerDown = (event) => {
            // Only react to primary (0) and secondary (2) buttons
            if (event.button !== 0 && event.button !== 2) return;
            activePointerId = event.pointerId;
            renderer.domElement.setPointerCapture(activePointerId);
            prevPointer.x = event.clientX;
            prevPointer.y = event.clientY;

            if (event.button === 0) {
              pointerAction = 'rotate';
              rotateAxis = null;
              dragStartPointer.x = event.clientX;
              dragStartPointer.y = event.clientY;
            } else if (event.button === 2) {
              pointerAction = 'pan';
              // Setup a plane that faces the camera and goes through the pivot's position
              camera.getWorldDirection(panPlaneNormal);
              // plane normal should point towards the camera
              panPlaneNormal.negate();
              dragPlane.setFromNormalAndCoplanarPoint(panPlaneNormal, pivotGroup.position);

              // compute starting intersection point
              getNDC(event);
              raycaster.setFromCamera(ndc, camera);
              raycaster.ray.intersectPlane(dragPlane, dragStartPoint);
              initialPivotPos.copy(pivotGroup.position);
            }
          };

          const onPointerMove = (event) => {
            if (activePointerId === null || event.pointerId !== activePointerId) return;
            if (!pointerAction) return;
            event.preventDefault();
            if (pointerAction === 'rotate') {
              const dx = event.clientX - prevPointer.x;
              const dy = event.clientY - prevPointer.y;
              prevPointer.x = event.clientX;
              prevPointer.y = event.clientY;

              // Lock to dominant axis once travel exceeds threshold
              if (!rotateAxis) {
                const totalDx = event.clientX - dragStartPointer.x;
                const totalDy = event.clientY - dragStartPointer.y;
                if (Math.abs(totalDx) > AXIS_LOCK_THRESHOLD || Math.abs(totalDy) > AXIS_LOCK_THRESHOLD) {
                  rotateAxis = Math.abs(totalDx) >= Math.abs(totalDy) ? 'y' : 'x';
                }
              }

              if (rotateAxis === 'y') {
                // Horizontal drag → yaw around world Y
                const qY = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * rotateSensitivity);
                pivotGroup.quaternion.premultiply(qY);
              } else if (rotateAxis === 'x') {
                // Vertical drag → pitch around world X
                const qX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -dy * rotateSensitivity);
                pivotGroup.quaternion.premultiply(qX);
              }
            } else if (pointerAction === 'pan') {
              getNDC(event);
              raycaster.setFromCamera(ndc, camera);
              const intersect = new THREE.Vector3();
              if (raycaster.ray.intersectPlane(dragPlane, intersect)) {
                const delta = intersect.clone().sub(dragStartPoint);
                const newPos = initialPivotPos.clone().add(delta);
                pivotGroup.position.copy(newPos);
              }
            }
          };

          const onPointerUp = (event) => {
            if (activePointerId === null || event.pointerId !== activePointerId) return;
            try { renderer.domElement.releasePointerCapture(activePointerId); } catch (e) {}
            activePointerId = null;
            pointerAction = null;
            rotateAxis = null;
          };


          const onContextMenu = (e) => { e.preventDefault(); };

          const onWheel = (e) => {
            e.preventDefault();
            // scale pivotGroup based on wheel delta (smaller factor for smoother control)
            const delta = -e.deltaY; // wheel up should enlarge
            const scaleFactor = 1 + (delta * scaleSensitivity);
            const newScaleX = THREE.MathUtils.clamp(pivotGroup.scale.x * scaleFactor, 0.01, 100);
            const newScaleY = THREE.MathUtils.clamp(pivotGroup.scale.y * scaleFactor, 0.01, 100);
            const newScaleZ = THREE.MathUtils.clamp(pivotGroup.scale.z * scaleFactor, 0.01, 100);
            pivotGroup.scale.set(newScaleX, newScaleY, newScaleZ);
          };

          // Listener management helpers
          const addManipulationListeners = () => {
            renderer.domElement.addEventListener('pointerdown', onPointerDown);
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', onPointerUp);
            renderer.domElement.addEventListener('contextmenu', onContextMenu);
            renderer.domElement.addEventListener('wheel', onWheel, { passive: false });
          };

          const removeManipulationListeners = () => {
            try { renderer.domElement.removeEventListener('pointerdown', onPointerDown); } catch (e) {}
            try { window.removeEventListener('pointermove', onPointerMove); } catch (e) {}
            try { window.removeEventListener('pointerup', onPointerUp); } catch (e) {}
            try { renderer.domElement.removeEventListener('contextmenu', onContextMenu); } catch (e) {}
            try { renderer.domElement.removeEventListener('wheel', onWheel); } catch (e) {}
          };

          addManipulationListeners();

          // Save references so we can clean up later
          controlsRef.current = {
            dispose: removeManipulationListeners
          };

          // Reset function: restore camera and pivot transforms
          const initialCameraPosition = camera.position.clone();
          const initialPivotPosition = pivotGroup.position.clone();
          const initialPivotRotation = pivotGroup.rotation.clone();
          const initialPivotScale = pivotGroup.scale.clone();

          resetViewRef.current = () => {
            if (!cameraRef.current) return;
            cameraRef.current.position.copy(initialCameraPosition);
            if (pivotGroupRef.current) {
              pivotGroupRef.current.position.copy(initialPivotPosition);
              pivotGroupRef.current.rotation.copy(initialPivotRotation);
              pivotGroupRef.current.scale.copy(initialPivotScale);
            }
          };

          sceneRef.current = scene;
          rendererRef.current = renderer;

          // Apply occlusion plane if already set when scene loads
          if (occlusionTextureUrl) {
            applyOcclusionMesh(THREE, scene, occlusionTextureUrl);
          }

// This allows ImageMessage.jsx to "reach in" and control the renderer directly.
          if (rendererRefParent) {
            rendererRefParent.current = renderer;
          }
          if (cameraRefParent) {
            cameraRefParent.current = camera;
          }
          if (sceneRefParent) {
            sceneRefParent.current = scene;
          }
          renderer.domElement.__THREE_RENDERER__ = renderer;


          // animate loop
          const animate = () => {
            if (isCleaningUpRef.current || !isMountedRef.current) return;
            if (!show3DViewer || !rendererRef.current || !sceneRef.current || !cameraRef.current) return;
            try {
              rendererRef.current.render(sceneRef.current, cameraRef.current);
              animationIdRef.current = requestAnimationFrame(animate);
             if (onInitialView && !hasCapturedInitialViewRef.current) {
              hasCapturedInitialViewRef.current = true;

              setTimeout(() => {
                if (rendererRef.current && sceneRef.current && cameraRef.current) {
                  const dataUrl = rendererRef.current.domElement.toDataURL();
                  onInitialView(dataUrl);
                }
              }, 800);
            }

            } catch (err) {
              console.error("Render loop error:", err);
              cancelAnimationFrame(animationIdRef.current);
              setError("Render error");
              setShow3DViewer(false);
            }
          };

          animationIdRef.current = requestAnimationFrame(animate);

          // Resize handling: prefer ResizeObserver, fallback to window resize
          if (typeof ResizeObserver !== 'undefined') {
            resizeObserverRef.current = new ResizeObserver(handleResize);
            try { resizeObserverRef.current.observe(container); } catch (e) {}
          } else {
            window.addEventListener('resize', handleResize);
          }
        } catch (err) {
          console.error("Error loading viewer:", err);
          setError(err.message);
          setShow3DViewer(false);
        } finally {
          setIsLoadingLibraries(false);
        } 
      };
      loadAndRender();
    }

    return () => {
      cleanup();
      if (rendererRefParent) rendererRefParent.current = null;
      if (cameraRefParent) cameraRefParent.current = null;
      if (sceneRefParent) sceneRefParent.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    threeDModel, 
    // bboxs, 
    // imageDisplaySize, 
    // setError, 
    // setShow3DViewer, 
    // resetViewRef, 
    show3DViewer, 
    // onInitialView,
    // currentTransform,
    // threeDTransform, 
    // handleResize,
    // rendererRefParent,
    // cameraRefParent,
    // sceneRefParent

  ]);

// Update occlusion mesh whenever occlusionTextureUrl changes (scene already running)
useEffect(() => {
  if (!threeRef.current || !sceneRef.current) return;
  applyOcclusionMesh(threeRef.current, sceneRef.current, occlusionTextureUrl);
}, [occlusionTextureUrl, applyOcclusionMesh]);

useEffect(() => {
    if (!aiCommand) return;

    const commandData = aiCommand.data || aiCommand;
    const commandId = aiCommand.id || JSON.stringify(commandData);

    if (lastCommandIdRef.current === commandId) {
      return;
    }
    lastCommandIdRef.current = commandId;

    // Support both new format ({ transformations: [...] }) and old format (single command object)
    const transformations = Array.isArray(commandData.transformations)
      ? commandData.transformations
      : [commandData];

    let cancelled = false;
    let activeInterval = null;
    let activeTimeout = null;

    const executeAt = (index) => {
      if (cancelled) return;

      if (index >= transformations.length) {
        // Add a tiny buffer so the final frame is rendered before taking the screenshot
        if (aiCommand.onComplete) setTimeout(() => aiCommand.onComplete(), 200);
        return;
      }

      const t = transformations[index];
      const { action, axis, uniform, value, relative } = t;

      const tryExecute = () => {
        const group = pivotGroupRef.current;
        if (!group) {
          return false;
        }


        if (action === "reset") {
          if (resetViewRef.current) resetViewRef.current();
          executeAt(index + 1);
          return true;
        }

        // 1. Capture Start State
        const startRot = group.rotation.clone();
        const startPos = group.position.clone();
        const startScale = group.scale.clone();

        // 2. Calculate Target State
        const targetRot = startRot.clone();
        const targetPos = startPos.clone();
        const targetScale = startScale.clone();

        if (action === "rotate") {
          const rad = (value * Math.PI) / 180;
          if (axis === "x") targetRot.x = relative ? startRot.x + rad : rad;
          if (axis === "y") targetRot.y = relative ? startRot.y + rad : rad;
          if (axis === "z") targetRot.z = relative ? startRot.z + rad : rad;
        } else if (action === "pan") {
          // Scale pan proportionally to the visible world extent at the pivot's depth.
          // value=1.0 (neutral) → 20% of the visible width/height; value=0.25 → 5%, etc.
          let scaledValue = value;
          const container = containerRef.current;
          const cam = cameraRef.current;
          if (container && cam) {
            const dist = Math.max(group.position.distanceTo(cam.position), 0.1);
            const vFovRad = (cam.fov * Math.PI) / 180;
            const visibleHeight = 2 * dist * Math.tan(vFovRad / 2);
            const visibleWidth = visibleHeight * (container.clientWidth / container.clientHeight);
            scaledValue = value * (axis === "y" ? visibleHeight : visibleWidth) * 0.2;
          }
          if (axis === "x") targetPos.x = relative ? startPos.x - scaledValue : -scaledValue;
          if (axis === "y") targetPos.y = relative ? startPos.y + scaledValue : scaledValue;
          if (axis === "z") targetPos.z = relative ? startPos.z + scaledValue : scaledValue;
        } else if (action === "scale") {
          if (uniform !== false) {
            // uniform scale: apply to all axes
            if (relative) targetScale.multiplyScalar(value);
            else targetScale.set(value, value, value);
          } else {
            // per-axis scale
            if (axis === "x") targetScale.x = relative ? startScale.x * value : value;
            if (axis === "y") targetScale.y = relative ? startScale.y * value : value;
            if (axis === "z") targetScale.z = relative ? startScale.z * value : value;
          }
        }

        // 3. Smooth Animation Loop
        const duration = 1200; // 1.2 seconds per transformation
        const startTime = performance.now();

        const animateStep = (currentTime) => {
          if (cancelled || !isMountedRef.current || isCleaningUpRef.current) return;

          const elapsed = currentTime - startTime;
          const progress = Math.min(elapsed / duration, 1);

          // Ease-in-out
          const ease = progress < 0.5
            ? 2 * progress * progress
            : -1 + (4 - 2 * progress) * progress;

          group.rotation.set(
            startRot.x + (targetRot.x - startRot.x) * ease,
            startRot.y + (targetRot.y - startRot.y) * ease,
            startRot.z + (targetRot.z - startRot.z) * ease
          );
          group.position.set(
            startPos.x + (targetPos.x - startPos.x) * ease,
            startPos.y + (targetPos.y - startPos.y) * ease,
            startPos.z + (targetPos.z - startPos.z) * ease
          );
          group.scale.set(
            startScale.x + (targetScale.x - startScale.x) * ease,
            startScale.y + (targetScale.y - startScale.y) * ease,
            startScale.z + (targetScale.z - startScale.z) * ease
          );

          if (progress < 1) {
            requestAnimationFrame(animateStep);
          } else {
            executeAt(index + 1);
          }
        };

        requestAnimationFrame(animateStep);
        return true;
      };

      if (tryExecute()) return;

      activeInterval = setInterval(() => {
        if (tryExecute()) {
          clearInterval(activeInterval);
          clearTimeout(activeTimeout);
          activeInterval = null;
          activeTimeout = null;
        }
      }, 200);

      activeTimeout = setTimeout(() => {
        clearInterval(activeInterval);
        activeInterval = null;
      }, 10000);
    };

    executeAt(0);

    return () => {
      cancelled = true;
      if (activeInterval) clearInterval(activeInterval);
      if (activeTimeout) clearTimeout(activeTimeout);
    };
  }, [aiCommand, resetViewRef]);


  return (
    <div
      id="three-container"
      ref={containerRef}
    ></div>
  );
};

export default ThreeDViewer;