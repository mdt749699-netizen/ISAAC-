import React, { useState, useRef, useEffect, useCallback } from 'react';
import { GoogleGenAI, Chat, LiveServerMessage, Modality, Blob as GenAIBlob, Part } from '@google/genai';
import { Message } from './types';
import UserInput from './components/UserInput';
import ChatHistory from './components/ChatHistory';
import { setTimestamp } from './db';

const SYSTEM_INSTRUCTION = "You are Isaac, a helpful, knowledgeable, and friendly AI assistant running inside a Progressive Web App (PWA). You are optimized for mobile phones and desktop terminals. You engage in natural, polite, and detailed conversation. You are fluent in all languages. When provided with an image, identify the object or subject, explain what it is, and provide details on its utility, usage, and when it is typically used. Use markdown to format your responses clearly. If asked about installing the app, guide the user to click the 'INSTALL' button in the header.";

// --- Audio Utility Functions ---
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function createBlob(data: Float32Array): GenAIBlob {
    const l = data.length;
    const int16 = new Int16Array(l);
    for (let i = 0; i < l; i++) {
        int16[i] = data[i] * 32768;
    }
    return {
        data: encode(new Uint8Array(int16.buffer)),
        mimeType: 'audio/pcm;rate=16000',
    };
}

// --- Install Help Modal Component ---
const InstallHelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-95 p-4 backdrop-blur-sm">
    <div className="border-2 border-green-500 bg-gray-900 p-6 rounded-lg max-w-md w-full shadow-[0_0_30px_rgba(0,255,0,0.2)] animate-in fade-in zoom-in duration-200">
      <h2 className="text-xl font-bold text-green-400 mb-4 border-b border-green-700 pb-2 flex justify-between items-center">
        <span>INSTALLATION GUIDE</span>
        <button onClick={onClose} className="text-green-600 hover:text-green-400">✕</button>
      </h2>
      <div className="space-y-4 text-green-300 text-sm">
        <div className="p-3 bg-black bg-opacity-50 rounded border border-green-800">
          <h3 className="font-bold text-white mb-1 flex items-center gap-2">
            <span className="text-lg">🤖</span> Android (Chrome)
          </h3>
          <p>1. Tap the <span className="font-bold text-white">Three Dots Menu</span> (top right).</p>
          <p>2. Select <span className="font-bold text-white">Install App</span> or <span className="font-bold text-white">Add to Home Screen</span>.</p>
        </div>
        <div className="p-3 bg-black bg-opacity-50 rounded border border-green-800">
          <h3 className="font-bold text-white mb-1 flex items-center gap-2">
            <span className="text-lg">🍎</span> iOS (Safari)
          </h3>
          <p>1. Tap the <span className="font-bold text-white">Share Button</span> <span className="inline-block border border-current px-1 rounded text-xs">⎋</span> at the bottom.</p>
          <p>2. Scroll down and tap <span className="font-bold text-white">Add to Home Screen</span> <span className="inline-block border border-current px-1 rounded text-xs">+</span>.</p>
        </div>
      </div>
      <button 
        onClick={onClose}
        className="mt-6 w-full bg-green-700 hover:bg-green-600 text-black font-bold py-3 rounded transition-colors shadow-lg shadow-green-900/20"
      >
        UNDERSTOOD
      </button>
    </div>
  </div>
);


const App: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const [image, setImage] = useState<{ data: string; mimeType: string; previewUrl: string } | null>(null);
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [showInstallHelp, setShowInstallHelp] = useState(false);

  const chatRef = useRef<Chat | null>(null);
  const liveSessionRef = useRef<any>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const mediaStreamSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const outputSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef<number>(0);
  
  const currentInputTranscriptionRef = useRef('');
  const currentOutputTranscriptionRef = useRef('');

  useEffect(() => {
    const handleOnline = () => {
      setIsOffline(false);
      setMessages(prev => [...prev, { role: 'model', content: '[SYSTEM] CONNECTION RESTORED. ONLINE.' }]);
    };
    const handleOffline = () => {
      setIsOffline(true);
      setMessages(prev => [...prev, { role: 'error', content: '[SYSTEM] CONNECTION LOST. OFFLINE MODE.' }]);
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // PWA Install Prompt Listener
    const handleInstallPrompt = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleInstallPrompt);

    // Check Standalone Mode
    const checkStandalone = () => {
      const isStandaloneMode = window.matchMedia('(display-mode: standalone)').matches || (window.navigator as any).standalone === true;
      setIsStandalone(isStandaloneMode);
    };
    checkStandalone();
    window.matchMedia('(display-mode: standalone)').addEventListener('change', checkStandalone);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (installPrompt) {
      installPrompt.prompt();
      const { outcome } = await installPrompt.userChoice;
      if (outcome === 'accepted') {
        setInstallPrompt(null);
      }
    } else {
      // If no prompt available (e.g. iOS or already installed but undetected), show help
      setShowInstallHelp(true);
    }
  };

  useEffect(() => {
    // Startup sequence
    const startupSequence = [
      { delay: 500, text: 'BOOTING ISAAC v3.1 MOBILE...' },
      { delay: 1000, text: 'ACCESSING NEURAL CORE... [OK]' },
      { delay: 1200, text: 'CALIBRATING LOGIC MATRIX... [OK]' },
      { delay: 1500, text: 'LOADING DIRECTIVES... [OK]' },
      { delay: 2000, text: `
  [ I ]
      ` },
      { delay: 2500, text: 'STATUS: ONLINE.\nAWAITING DIRECTIVES.' },
    ];
    
    let currentTimeout: ReturnType<typeof setTimeout>;
    const runSequence = (index = 0) => {
      if (index < startupSequence.length) {
        currentTimeout = setTimeout(() => {
          setMessages(prev => [...prev, { role: 'model', content: startupSequence[index].text }]);
          if(index === startupSequence.length - 1) {
            setIsLoading(false);
            
            // Register Periodic Sync
            const registerSync = async () => {
                if ('serviceWorker' in navigator) {
                    const registration = await navigator.serviceWorker.ready;
                    if ('periodicSync' in registration) {
                        try {
                            await (registration as any).periodicSync.register('check-inactivity', {
                                minInterval: 12 * 60 * 60 * 1000, // 12 hours
                            });
                        } catch (error) {
                            console.error('Periodic sync could not be registered!', error);
                        }
                    }
                }
            };
            registerSync();
          }
          runSequence(index + 1);
        }, startupSequence[index].delay - (startupSequence[index-1]?.delay || 0));
      }
    };
    
    runSequence();

    return () => {
      clearTimeout(currentTimeout);
      stopListening();
      chatRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const initializeTextChat = useCallback(() => {
    if (chatRef.current) return;
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const chat = ai.chats.create({
        model: 'gemini-2.5-flash',
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
        },
      });
      chatRef.current = chat;
    } catch (error) {
      console.error("Failed to initialize Gemini AI:", error);
      setMessages(prev => [...prev, { role: 'error', content: 'CRITICAL ERROR: AI Core failed to initialize. Check API Key and network.' }]);
    }
  }, []);

  const handleImageSelect = useCallback((file: File) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = () => {
        const dataUrl = reader.result as string;
        const base64Data = dataUrl.split(',')[1];
        setImage({ data: base64Data, mimeType: file.type, previewUrl: dataUrl });
    };
    reader.readAsDataURL(file);
  }, []);

  const handleRemoveImage = useCallback(() => {
    setImage(null);
  }, []);

  const handleSend = useCallback(async (message: string) => {
    const trimmedMessage = message.trim();
    if (!trimmedMessage && !image) return;

    // Request notification permission on first interaction
    if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().then(permission => {
            if (permission === 'granted') {
                 // Optional: Feedback to user
            }
        });
    }

    setTimestamp('lastInteraction', Date.now()).catch(console.error);

    if(trimmedMessage){
      setCommandHistory(prev => (prev.length > 0 && prev[prev.length - 1] === trimmedMessage ? prev : [...prev, trimmedMessage]));
    }
    
    const userMessage: Message = { role: 'user', content: trimmedMessage, image: image?.previewUrl };
    setMessages(prev => [...prev, userMessage]);
    
    if (isOffline) {
        setMessages(prev => [...prev, { role: 'error', content: 'OFFLINE: Cannot send message.' }]);
        setImage(null);
        return;
    }

    if(!image) { // Only check client commands if no image is attached
      const lowerCaseMessage = trimmedMessage.toLowerCase();
      if (lowerCaseMessage === 'clear') {
          setMessages([{ role: 'model', content: 'SCREEN CLEARED.' }]);
          return;
      }
      
      // Client-side help for installation
      if (lowerCaseMessage.includes('how to download') || lowerCaseMessage.includes('install') || lowerCaseMessage === 'download') {
          const installText = `[ISAAC] To install this app on your device, tap the 'INSTALL' button in the top-left header.\n\nIf you don't see it:\n- **Android:** Tap the 3 dots menu -> Install App.\n- **iOS:** Tap Share -> Add to Home Screen.`;
          setMessages(prev => [...prev, { role: 'model', content: installText }]);
          handleInstallClick();
          return;
      }

      if (lowerCaseMessage === 'help') {
          const helpText = `[ISAAC] HELP PROTOCOL:\n\n- Type any command or question to interact with ISAAC.\n- Use the microphone button for voice commands.\n- Use the attachment button to upload an image.\n- Type 'install' for download instructions.\n- Use Up/Down arrows to navigate command history.`;
          setMessages(prev => [...prev, { role: 'model', content: helpText }]);
          return;
      }
    }

    initializeTextChat();
    if (!chatRef.current) {
      setMessages(prev => [...prev, { role: 'error', content: 'ERROR: Chat not initialized.' }]);
      return;
    }
    
    setIsLoading(true);

    try {
      const messageParts: (string | Part)[] = [];
      const textPrompt = trimmedMessage || (image ? "Identify what is in this image, explain what it is, and describe its uses and when it is helpful." : "");

      if(image) {
        messageParts.push({ inlineData: { data: image.data, mimeType: image.mimeType } });
      }
      if(textPrompt) {
        messageParts.push({ text: textPrompt });
      }

      const result = await chatRef.current.sendMessageStream({ message: messageParts });
      let text = '';
      setMessages(prev => [...prev, { role: 'model', content: '' }]);

      for await (const chunk of result) {
        text += chunk.text;
        setMessages(prevMessages => {
          const newMessages = [...prevMessages];
          newMessages[newMessages.length - 1] = { role: 'model', content: text };
          return newMessages;
        });
      }
    } catch (error) {
      console.error("Error sending message:", error);
      const errorMessage: Message = { role: 'error', content: `TRANSMISSION ERROR: ${error instanceof Error ? error.message : 'Unknown communication failure.'}` };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
      setImage(null);
    }
  }, [initializeTextChat, isOffline, image, installPrompt]);

  const stopListening = useCallback(() => {
    if (liveSessionRef.current) {
      liveSessionRef.current.close();
      liveSessionRef.current = null;
    }
    if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach(track => track.stop());
        mediaStreamRef.current = null;
    }
    if (scriptProcessorRef.current) {
        scriptProcessorRef.current.disconnect();
        scriptProcessorRef.current = null;
    }
    if (mediaStreamSourceRef.current) {
        mediaStreamSourceRef.current.disconnect();
        mediaStreamSourceRef.current = null;
    }
    if (inputAudioContextRef.current && inputAudioContextRef.current.state !== 'closed') {
        inputAudioContextRef.current.close();
    }
    if (outputAudioContextRef.current && outputAudioContextRef.current.state !== 'closed') {
        outputAudioContextRef.current.close();
    }
    outputSourcesRef.current.forEach(source => source.stop());
    outputSourcesRef.current.clear();
    setIsListening(false);
    setIsLoading(false);
  }, []);

  const startListening = useCallback(async () => {
    if (isOffline) {
        setMessages(prev => [...prev, { role: 'error', content: 'OFFLINE: Voice commands unavailable.' }]);
        return;
    }
    setTimestamp('lastInteraction', Date.now()).catch(console.error);
    setIsListening(true);
    setIsLoading(true);
    setMessages(prev => [...prev, { role: 'model', content: 'VOICE CHANNEL OPEN. LISTENING...' }]);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-09-2025',
        callbacks: {
          onopen: () => {
            setIsLoading(false);
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            mediaStreamSourceRef.current = source;
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            scriptProcessorRef.current = scriptProcessor;

            scriptProcessor.onaudioprocess = (audioProcessingEvent) => {
              const inputData = audioProcessingEvent.inputBuffer.getChannelData(0);
              const pcmBlob = createBlob(inputData);
              sessionPromise.then((session) => {
                session.sendRealtimeInput({ media: pcmBlob });
              });
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
             if (message.serverContent?.inputTranscription) {
                const text = message.serverContent.inputTranscription.text;
                currentInputTranscriptionRef.current += text;
                setMessages(prev => {
                    const lastMsgIndex = prev.map(m => m.role).lastIndexOf('user');
                    const lastModelMsgIndex = prev.map(m => m.role).lastIndexOf('model');
                    if(lastMsgIndex > lastModelMsgIndex) {
                        const newMessages = [...prev];
                        newMessages[lastMsgIndex] = { role: 'user', content: currentInputTranscriptionRef.current };
                        return newMessages;
                    } else {
                         return [...prev, {role: 'user', content: currentInputTranscriptionRef.current}]
                    }
                });
            }

            if (message.serverContent?.outputTranscription) {
                const text = message.serverContent.outputTranscription.text;
                currentOutputTranscriptionRef.current += text;
                 setMessages(prev => {
                    const lastMsgIndex = prev.map(m => m.role).lastIndexOf('model');
                    if (lastMsgIndex !== -1 && prev[lastMsgIndex].content.includes(currentOutputTranscriptionRef.current.slice(0, -text.length))) {
                        const newMessages = [...prev];
                        newMessages[lastMsgIndex] = { role: 'model', content: currentOutputTranscriptionRef.current };
                        return newMessages;
                    }
                    return [...prev, {role: 'model', content: currentOutputTranscriptionRef.current}]
                });
            }

            const base64Audio = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (base64Audio) {
                const outputAudioContext = outputAudioContextRef.current!;
                nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputAudioContext.currentTime);
                const audioBuffer = await decodeAudioData(decode(base64Audio), outputAudioContext, 24000, 1);
                const source = outputAudioContext.createBufferSource();
                source.buffer = audioBuffer;
                source.connect(outputAudioContext.destination);
                source.addEventListener('ended', () => {
                    outputSourcesRef.current.delete(source);
                });
                source.start(nextStartTimeRef.current);
                nextStartTimeRef.current += audioBuffer.duration;
                outputSourcesRef.current.add(source);
            }
            
            if (message.serverContent?.turnComplete) {
                currentInputTranscriptionRef.current = '';
                currentOutputTranscriptionRef.current = '';
            }

            if (message.serverContent?.interrupted) {
                for (const source of outputSourcesRef.current.values()) {
                    source.stop();
                }
                outputSourcesRef.current.clear();
                nextStartTimeRef.current = 0;
            }

          },
          onerror: (e: ErrorEvent) => {
            console.error("Live session error:", e);
            setMessages(prev => [...prev, { role: 'error', content: `LIVE_SESSION_ERROR: ${e.message}` }]);
            stopListening();
          },
          onclose: () => {
            if (isListening) {
              setMessages(prev => [...prev, { role: 'model', content: 'VOICE CHANNEL CLOSED.' }]);
              stopListening();
            }
          },
        },
        config: {
            responseModalities: [Modality.AUDIO],
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            systemInstruction: SYSTEM_INSTRUCTION,
        },
      });

      liveSessionRef.current = await sessionPromise;

    } catch (error) {
      console.error("Failed to start listening:", error);
      setMessages(prev => [...prev, { role: 'error', content: `MICROPHONE_ERROR: ${error instanceof Error ? error.message : 'Failed to access microphone.'}` }]);
      stopListening();
    }
  }, [stopListening, isListening, isOffline]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
      setMessages(prev => [...prev, { role: 'model', content: 'VOICE CHANNEL CLOSED.' }]);
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  const handleVideoFrame = useCallback((base64: string) => {
     if (liveSessionRef.current) {
         liveSessionRef.current.sendRealtimeInput({
             media: { mimeType: 'image/jpeg', data: base64 }
         });
     }
  }, []);


  return (
    <div className="flex flex-col h-dvh bg-black bg-opacity-95 font-mono text-green-400">
      {showInstallHelp && <InstallHelpModal onClose={() => setShowInstallHelp(false)} />}
      
      <header className="p-3 md:p-4 border-b border-green-900 text-center flex justify-between items-center select-none relative z-10">
        <div className="w-1/4 text-left">
           {!isStandalone && (
            <button 
              onClick={handleInstallClick}
              className={`flex items-center gap-2 text-xs md:text-sm border border-green-700 px-3 py-1 rounded hover:bg-green-900 hover:text-white transition-all group ${installPrompt ? 'animate-pulse bg-green-900 bg-opacity-40 border-green-400 text-green-300' : 'text-green-600'}`}
              title="Download / Install App"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 ${installPrompt ? 'animate-bounce' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4-4m0 0l-4 4m4-4v12" />
              </svg>
              <span className="font-bold">INSTALL</span>
            </button>
           )}
        </div>
        <h1 className="text-xl md:text-3xl font-bold text-green-400 relative glitch w-2/4 text-center" data-text="[ ISAAC ]">[ ISAAC ]</h1>
        <div className="w-1/4 text-right">
            {isOffline && <span className="text-red-500 font-bold animate-pulse text-xs md:text-base">[OFFLINE]</span>}
        </div>
      </header>
      <main className="flex-1 overflow-y-auto p-4">
        <ChatHistory messages={messages} isLoading={isLoading} />
      </main>
      <footer className="p-2 md:p-4 border-t border-green-900 bg-black pb-safe">
        <UserInput 
          onSend={handleSend} 
          isLoading={isLoading} 
          isListening={isListening} 
          onToggleListening={toggleListening}
          commandHistory={commandHistory}
          onImageSelect={handleImageSelect}
          onRemoveImage={handleRemoveImage}
          imagePreviewUrl={image?.previewUrl}
          onVideoFrame={handleVideoFrame}
        />
      </footer>
    </div>
  );
};

export default App;