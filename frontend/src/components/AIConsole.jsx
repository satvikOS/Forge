import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Code, Send, X, Minimize2, Maximize2 } from 'lucide-react';
import './AIConsole.css';

/**
 * AI Console - Dual Chat/Code Terminal for Footer
 * Supports natural language CAD commands and code execution
 */
function AIConsole() {
    const [mode, setMode] = useState('chat'); // 'chat' or 'code'
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([
        { role: 'assistant', content: 'Hi! I can help you design in natural language or execute code. What would you like to create?' }
    ]);
    const [codeHistory, setCodeHistory] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, codeHistory]);

    const handleSendChat = async () => {
        if (!input.trim() || isProcessing) return;

        const userMessage = input.trim();
        setMessages(prev => [...prev, { role: 'user', content: userMessage }]);
        setInput('');
        setIsProcessing(true);

        try {
            const response = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: userMessage })
            });

            const data = await response.json();

            if (data.success) {
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: data.response,
                    actions: data.actions // CAD operations to execute
                }]);

                // Execute any CAD actions returned
                if (data.actions && data.actions.length > 0) {
                    executeCADActions(data.actions);
                }
            } else {
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: 'Sorry, I encountered an error. Please try again.'
                }]);
            }
        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: 'Connection error. Please check your network.'
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleExecuteCode = async () => {
        if (!input.trim() || isProcessing) return;

        const code = input.trim();
        setCodeHistory(prev => [...prev, { type: 'input', content: code }]);
        setInput('');
        setIsProcessing(true);

        try {
            const response = await fetch('/api/ai/execute-code', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code })
            });

            const data = await response.json();

            if (data.success) {
                setCodeHistory(prev => [...prev, {
                    type: 'output',
                    content: data.output || 'Code executed successfully',
                    result: data.result
                }]);
            } else {
                setCodeHistory(prev => [...prev, {
                    type: 'error',
                    content: data.error || 'Execution failed'
                }]);
            }
        } catch (error) {
            console.error('Code execution error:', error);
            setCodeHistory(prev => [...prev, {
                type: 'error',
                content: 'Connection error. Please try again.'
            }]);
        } finally {
            setIsProcessing(false);
        }
    };

    const executeCADActions = (actions) => {
        // This would trigger actual CAD operations in the viewport
        console.log('Executing CAD actions:', actions);
        // TODO: Integrate with CAD engine
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (mode === 'chat') {
                handleSendChat();
            } else {
                handleExecuteCode();
            }
        }
    };

    const clearHistory = () => {
        if (mode === 'chat') {
            setMessages([{
                role: 'assistant',
                content: 'Chat cleared. How can I help you?'
            }]);
        } else {
            setCodeHistory([]);
        }
    };

    return (
        <div className={`ai-console ${isExpanded ? 'expanded' : ''}`}>
            {/* Header */}
            <div className="ai-console-header">
                <div className="mode-switcher">
                    <button
                        className={`mode-button ${mode === 'chat' ? 'active' : ''}`}
                        onClick={() => setMode('chat')}
                        title="Chat Mode"
                    >
                        <MessageSquare size={14} />
                        <span>Chat</span>
                    </button>
                    <button
                        className={`mode-button ${mode === 'code' ? 'active' : ''}`}
                        onClick={() => setMode('code')}
                        title="Code Mode"
                    >
                        <Code size={14} />
                        <span>Code</span>
                    </button>
                </div>

                <div className="console-actions">
                    <button className="action-button" onClick={clearHistory} title="Clear">
                        <X size={14} />
                    </button>
                    <button
                        className="action-button"
                        onClick={() => setIsExpanded(!isExpanded)}
                        title={isExpanded ? 'Minimize' : 'Maximize'}
                    >
                        {isExpanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="ai-console-content">
                {mode === 'chat' ? (
                    <div className="chat-messages">
                        {messages.map((msg, idx) => (
                            <div key={idx} className={`message ${msg.role}`}>
                                <div className="message-content">
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {isProcessing && (
                            <div className="message assistant">
                                <div className="message-content typing">
                                    <span></span><span></span><span></span>
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                ) : (
                    <div className="code-terminal">
                        {codeHistory.map((entry, idx) => (
                            <div key={idx} className={`terminal-entry ${entry.type}`}>
                                <div className="entry-prefix">
                                    {entry.type === 'input' ? '>' : entry.type === 'error' ? '✗' : '✓'}
                                </div>
                                <div className="entry-content">{entry.content}</div>
                            </div>
                        ))}
                        {isProcessing && (
                            <div className="terminal-entry processing">
                                <div className="entry-prefix">⟳</div>
                                <div className="entry-content">Processing...</div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>
                )}
            </div>

            {/* Input Area */}
            <div className="ai-console-input">
                <textarea
                    ref={inputRef}
                    className="console-textarea"
                    placeholder={
                        mode === 'chat'
                            ? 'Describe what you want to create... (e.g., "Create a 50mm cube with filleted edges")'
                            : 'Enter JavaScript code... (e.g., "sketch.circle([0,0], 25)")'
                    }
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isProcessing}
                    rows={isExpanded ? 3 : 1}
                />
                <button
                    className="send-button"
                    onClick={mode === 'chat' ? handleSendChat : handleExecuteCode}
                    disabled={!input.trim() || isProcessing}
                    title={mode === 'chat' ? 'Send Message' : 'Execute Code'}
                >
                    <Send size={16} />
                </button>
            </div>
        </div>
    );
}

export default AIConsole;
