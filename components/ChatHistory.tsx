import React, { useRef, useEffect, useState } from 'react';
import { Message } from '../types';

interface ChatHistoryProps {
  messages: Message[];
  isLoading: boolean;
}

const formatContent = (content: string) => {
    const codeBlockRegex = /```(\w+)?\n([\s\S]+?)```/g;
    const parts = [];
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={lastIndex}>{content.substring(lastIndex, match.index)}</span>);
      }
      const language = match[1] || 'plaintext';
      const code = match[2];
      parts.push(
        <div key={match.index} className="bg-gray-900 border border-green-700 rounded-md my-2 text-shadow-none selectable-text">
          <div className="text-xs text-cyan-400 px-3 py-1 border-b border-green-800">{language}</div>
          <pre className="p-3 text-sm overflow-x-auto"><code>{code}</code></pre>
        </div>
      );
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      parts.push(<span key={lastIndex}>{content.substring(lastIndex)}</span>);
    }

    return parts;
};

const useTypingEffect = (fullText: string, speed = 20) => {
    const [typedText, setTypedText] = useState('');

    useEffect(() => {
        if (typedText === fullText) return;

        const timer = setTimeout(() => {
            setTypedText(fullText.slice(0, typedText.length + 1));
        }, speed);

        return () => clearTimeout(timer);
    }, [fullText, typedText, speed]);

    return typedText;
};


const MessageBubble: React.FC<{ message: Message }> = ({ message }) => {
    const { role, content, image } = message;
    
    const baseClasses = 'mb-4 max-w-full md:max-w-3/4 lg:max-w-2/3 whitespace-pre-wrap selectable-text';
    const userClasses = 'ml-auto text-cyan-300';
    const modelClasses = 'mr-auto text-green-400';
    const errorClasses = 'mr-auto text-red-500';

    const prefix = {
      user: '[USER]> ',
      model: '[ISAAC]> ',
      error: '[SYSTEM_ERROR]> ',
    };
    
    let containerClass = '';
    switch (role) {
      case 'user':
        containerClass = userClasses;
        break;
      case 'model':
        containerClass = modelClasses;
        break;
      case 'error':
        containerClass = errorClasses;
        break;
    }

    return (
      <div className={`${baseClasses} ${containerClass}`}>
        <span className="font-bold select-none">{prefix[role]}</span>
        {image && (
          <div className="my-2 p-1 border border-cyan-700 rounded-md inline-block select-none">
            <img src={image} alt="User upload" className="max-w-xs max-h-48 rounded-md" />
          </div>
        )}
        {formatContent(content)}
      </div>
    );
};

const TypingMessageBubble: React.FC<{ message: Message }> = ({ message }) => {
    const typedContent = useTypingEffect(message.content);

    return (
        <div className="mr-auto text-green-400 mb-4 max-w-full md:max-w-3/4 lg:max-w-2/3 whitespace-pre-wrap selectable-text">
          <span className="font-bold select-none">[ISAAC]> </span>
          {formatContent(typedContent)}
          <span className="inline-block w-2 h-5 align-middle blinking-cursor"></span>
        </div>
      );
}


const ChatHistory: React.FC<ChatHistoryProps> = ({ messages, isLoading }) => {
  const endOfMessagesRef = useRef<HTMLDivElement | null>(null);

  const scrollToBottom = () => {
    endOfMessagesRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);


  return (
    <div className="space-y-4">
      {messages.map((msg, index) => {
        const isLastMessage = index === messages.length - 1;
        const isModelLoading = isLastMessage && msg.role === 'model' && isLoading;

        if (isModelLoading) {
            return <TypingMessageBubble key={index} message={msg} />;
        }
        return <MessageBubble key={index} message={msg} />;
      })}
      <div ref={endOfMessagesRef} />
    </div>
  );
};

export default ChatHistory;