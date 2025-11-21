import React, { useState, useRef, useEffect, KeyboardEvent } from 'react';

interface UserInputProps {
  onSend: (message: string) => void;
  isLoading: boolean;
  isListening: boolean;
  onToggleListening: () => void;
  commandHistory: string[];
  onImageSelect: (file: File) => void;
  onRemoveImage: () => void;
  imagePreviewUrl?: string | null;
  onVideoFrame?: (base64: string) => void;
}

// Helper to convert Data URI to File object
const dataURLtoFile = (dataurl: string, filename: string): File => {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/png';
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new File([u8arr], filename, { type: mime });
};

const UserInput: React.FC<UserInputProps> = ({ 
  onSend, 
  isLoading, 
  isListening, 
  onToggleListening, 
  commandHistory,
  onImageSelect,
  onRemoveImage,
  imagePreviewUrl,
  onVideoFrame
}) => {
  const [value, setValue] = useState('');
  const [historyIndex, setHistoryIndex] = useState(commandHistory.length);
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');
  
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    setHistoryIndex(commandHistory.length);
  }, [commandHistory.length]);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
    }
  }, [value]);

  useEffect(() => {
    if (!isLoading && !isListening && !isCameraOpen) {
      textareaRef.current?.focus();
    }
  }, [isLoading, isListening, isCameraOpen]);

  // --- Video Streaming Effect ---
  useEffect(() => {
    let interval: number;
    // Only stream if camera is open, we are listening (Live mode), and onVideoFrame is provided
    if (isCameraOpen && isListening && onVideoFrame) {
      interval = window.setInterval(() => {
        if (videoRef.current && canvasRef.current && videoRef.current.readyState === 4) { // 4 = HAVE_ENOUGH_DATA
           const video = videoRef.current;
           const canvas = canvasRef.current;
           // Downscale slightly for performance if needed, or keep full res
           canvas.width = video.videoWidth * 0.5; 
           canvas.height = video.videoHeight * 0.5;
           const ctx = canvas.getContext('2d');
           if (ctx) {
               ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
               // Send frame as JPEG
               const dataUrl = canvas.toDataURL('image/jpeg', 0.6);
               const base64 = dataUrl.split(',')[1];
               onVideoFrame(base64);
           }
        }
      }, 1000); // 1 FPS is sufficient for conversational context
    }
    return () => clearInterval(interval);
  }, [isCameraOpen, isListening, onVideoFrame]);


  // --- File Handler ---
  const handleFileClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onImageSelect(file);
    }
    if (e.target) {
      e.target.value = ''; // Allow selecting the same file again
    }
  };

  // --- Screen Share Handler ---
  const handleScreenShareClick = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ 
        video: { width: 1920, height: 1080 } 
      });
      
      const video = document.createElement('video');
      video.srcObject = stream;
      await video.play();

      // Create canvas to capture frame
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/png');
        const file = dataURLtoFile(dataUrl, 'screenshot.png');
        onImageSelect(file);
      }

      // Stop sharing immediately after capture
      stream.getTracks().forEach(track => track.stop());
      video.remove();
      canvas.remove();

    } catch (err) {
      console.error("Screen share cancelled or failed", err);
    }
  };

  // --- Camera Handler ---
  const startCamera = async (mode: 'user' | 'environment') => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          width: { ideal: 1280 }, 
          height: { ideal: 720 }, 
          facingMode: mode 
        } 
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        // Ensure video plays after metadata loads
        videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play().catch(e => console.error("Play error", e));
        };
      }
    } catch (err) {
      console.error("Camera access failed", err);
      setIsCameraOpen(false);
    }
  };

  const handleCameraClick = async () => {
    setIsCameraOpen(true);
    setFacingMode('user');
    await startCamera('user');
  };

  const handleSwitchCamera = async () => {
    const newMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(newMode);
    await startCamera(newMode);
  };

  const handleTakePhoto = () => {
    if (videoRef.current && canvasRef.current) {
      const width = videoRef.current.videoWidth;
      const height = videoRef.current.videoHeight;
      canvasRef.current.width = width;
      canvasRef.current.height = height;
      
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.drawImage(videoRef.current, 0, 0, width, height);
        const dataUrl = canvasRef.current.toDataURL('image/jpeg');
        const file = dataURLtoFile(dataUrl, 'camera_photo.jpg');
        onImageSelect(file);
        closeCamera();
      }
    }
  };

  const closeCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };


  const handleSubmit = () => {
    if ((value.trim() || imagePreviewUrl) && !isLoading) {
      onSend(value.trim());
      setValue('');
    }
  };

  const handleRunLastCommand = () => {
    if (commandHistory.length > 0 && !isLoading) {
      const lastCommand = commandHistory[commandHistory.length - 1];
      onSend(lastCommand);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const hasHistory = commandHistory.length > 0;

    if (e.key === 'ArrowUp' && hasHistory) {
      e.preventDefault();
      const newIndex = Math.max(0, historyIndex - 1);
      setHistoryIndex(newIndex);
      setValue(commandHistory[newIndex] || '');
    } else if (e.key === 'ArrowDown' && hasHistory) {
      e.preventDefault();
      const newIndex = Math.min(commandHistory.length, historyIndex + 1);
      setHistoryIndex(newIndex);
      setValue(commandHistory[newIndex] || '');
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };
  
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    setHistoryIndex(commandHistory.length);
  };


  return (
    <div className="flex flex-col relative">
      
      {/* Camera Modal */}
      {isCameraOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90 p-4">
          <div className="relative border-2 border-green-500 p-2 rounded-lg shadow-[0_0_20px_rgba(0,255,0,0.3)] bg-black w-full max-w-3xl flex flex-col">
            <div className="flex justify-between items-center bg-green-900 bg-opacity-20 px-2 py-1 mb-2">
                 <span className="text-green-400 text-xs font-bold">CAMERA_FEED {isListening ? '[LIVE TRANSMISSION ACTIVE]' : ''}</span>
                 <button 
                    onClick={onToggleListening}
                    className={`p-1 rounded border ${isListening ? 'bg-red-600 border-red-500 text-white animate-pulse' : 'bg-green-700 border-green-500 text-black'}`}
                    title="Toggle Voice for Live Vision"
                 >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                    </svg>
                 </button>
            </div>
            
            <video ref={videoRef} className="w-full h-auto rounded border border-green-900 bg-black" autoPlay playsInline muted></video>
            <canvas ref={canvasRef} className="hidden"></canvas>
            
            <div className="flex justify-between items-center mt-4 space-x-2">
              <button 
                onClick={closeCamera}
                className="px-4 py-2 border border-red-500 text-red-500 hover:bg-red-500 hover:text-black transition-colors rounded font-bold text-sm md:text-base"
              >
                CANCEL
              </button>
              
               <button 
                onClick={handleSwitchCamera}
                className="px-4 py-2 border border-green-500 text-green-500 hover:bg-green-900 hover:text-white transition-colors rounded font-bold text-sm md:text-base flex items-center"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                   <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                SWITCH
              </button>

              <button 
                onClick={handleTakePhoto}
                className="px-6 py-2 bg-green-600 text-black hover:bg-green-400 transition-colors rounded font-bold animate-pulse text-sm md:text-base"
              >
                SNAP
              </button>
            </div>
          </div>
        </div>
      )}

      {imagePreviewUrl && (
        <div className="relative self-start mb-2 p-1 border border-green-700 rounded-md bg-black bg-opacity-50">
          <img src={imagePreviewUrl} alt="Preview" className="max-h-32 rounded-md" />
          <button 
            onClick={onRemoveImage}
            className="absolute -top-2 -right-2 bg-red-600 text-white rounded-full h-6 w-6 flex items-center justify-center hover:bg-red-500 transition-colors border border-black"
            aria-label="Remove image"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
      
      <div className="flex items-end space-x-2">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={isListening ? 'Listening... (Camera active = Live Vision)' : isLoading ? 'Processing...' : 'Enter command...'}
          disabled={isLoading || isListening}
          rows={1}
          className="flex-1 bg-gray-900 text-green-400 border border-green-700 rounded-md p-2 resize-none focus:outline-none focus:ring-2 focus:ring-green-500 placeholder-green-700 disabled:opacity-50 max-h-32"
          style={{textShadow: 'none'}}
        />
        
        <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            accept="image/*"
            className="hidden"
        />

        {/* Camera Button */}
        <button
          onClick={handleCameraClick}
          disabled={isLoading}
          className="bg-gray-800 text-green-400 font-bold p-2 rounded-md hover:bg-gray-700 disabled:opacity-50 border border-green-900"
          title="Take Photo / Live Vision"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {/* Screen Share Button */}
        <button
          onClick={handleScreenShareClick}
          disabled={isLoading}
          className="bg-gray-800 text-green-400 font-bold p-2 rounded-md hover:bg-gray-700 disabled:opacity-50 border border-green-900"
          title="Capture Screen"
        >
           <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
             <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
           </svg>
        </button>

        {/* Upload Button */}
        <button
          onClick={handleFileClick}
          disabled={isLoading}
          className="bg-gray-800 text-green-400 font-bold p-2 rounded-md hover:bg-gray-700 disabled:opacity-50 border border-green-900"
          title="Upload Image"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </button>

        {/* Mic Button */}
        <button
          onClick={onToggleListening}
          disabled={isLoading && !isListening}
          className={`font-bold p-2 rounded-md transition-colors duration-200 border ${isListening ? 'bg-red-600 border-red-400 hover:bg-red-500 text-white animate-pulse' : 'bg-green-700 border-green-500 hover:bg-green-500 text-black'} disabled:opacity-50`}
          aria-label={isListening ? 'Stop listening' : 'Start listening'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        </button>
        
        {/* Run Last Command Button */}
        <button
            onClick={handleRunLastCommand}
            disabled={isLoading || commandHistory.length === 0 || isListening}
            className="bg-gray-800 text-green-400 font-bold p-2 rounded-md hover:bg-gray-700 disabled:opacity-50 border border-green-900"
            title="Run last command"
          >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 11l7-7 7 7M5 19l7-7 7 7" />
          </svg>
        </button>

        <button
          onClick={handleSubmit}
          disabled={isLoading || (!value.trim() && !imagePreviewUrl) || isListening}
          className="bg-green-700 text-black font-bold p-2 rounded-md hover:bg-green-500 disabled:bg-gray-700 disabled:cursor-not-allowed disabled:text-gray-400 transition-colors duration-200 border border-green-500"
          aria-label="Send command"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 10h6m-3-3l3 3-3 3" />
          </svg>
        </button>
      </div>
    </div>
  );
};

export default UserInput;