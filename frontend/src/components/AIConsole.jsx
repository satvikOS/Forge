import React, { useState, useRef, useEffect } from 'react';
import { MessageSquare, Code, Send, X, Minimize2, Maximize2, Layers, Zap } from 'lucide-react';
import './AIConsole.css';

/**
 * AI Console - Dual Chat/Code Terminal for Footer
 * Supports natural language CAD commands, code execution, and parametric design
 */
function AIConsole() {
    const [mode, setMode] = useState('chat'); // 'chat', 'code', or 'parametric'
    const [input, setInput] = useState('');
    const [messages, setMessages] = useState([
        { role: 'assistant', content: 'Hi! I can help you design in natural language or execute code. What would you like to create?' }
    ]);
    const [codeHistory, setCodeHistory] = useState([]);
    const [parametricHistory, setParametricHistory] = useState([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isExpanded, setIsExpanded] = useState(false);
    const [variants, setVariants] = useState([]);
    const messagesEndRef = useRef(null);
    const inputRef = useRef(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(() => {
        scrollToBottom();
    }, [messages, codeHistory, parametricHistory]);

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

    const handleParametricDesign = async () => {
        if (!input.trim() || isProcessing) return;

        const prompt = input.trim();
        setParametricHistory(prev => [...prev, { type: 'prompt', content: prompt }]);
        setInput('');
        setIsProcessing(true);

        try {
            // Call the new parametric design API
            const response = await fetch('/api/parametric/generate-variants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt,
                    numVariants: 4,
                    strategies: ['lightweight', 'costOptimized', 'highStrength', 'manufacturable']
                })
            });

            const data = await response.json();

            if (data.success) {
                setVariants(data.variants || []);
                setParametricHistory(prev => [...prev, {
                    type: 'result',
                    content: `Generated ${data.variants?.length || 0} design variants`,
                    variants: data.variants,
                    bestVariant: data.bestVariant,
                    comparison: data.comparison
                }]);

                // Also generate BOM for best variant
                if (data.bestVariant) {
                    const bomResponse = await fetch('/api/parametric/auto-bom', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            designData: data.bestVariant,
                            includeHardware: true,
                            quantity: 1
                        })
                    });
                    const bomData = await bomResponse.json();
                    if (bomData.success) {
                        setParametricHistory(prev => [...prev, {
                            type: 'bom',
                            content: `BOM: ${bomData.bom?.items?.length || 0} items, $${bomData.bom?.costs?.grandTotal?.toFixed(2) || '0'}`,
                            bom: bomData.bom
                        }]);
                    }
                }
            } else {
                setParametricHistory(prev => [...prev, {
                    type: 'error',
                    content: data.error || 'Failed to generate variants'
                }]);
            }
        } catch (error) {
            console.error('Parametric design error:', error);
            setParametricHistory(prev => [...prev, {
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
        // Integration with cadIntegrationService
    };

    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (mode === 'chat') {
                handleSendChat();
            } else if (mode === 'code') {
                handleExecuteCode();
            } else if (mode === 'parametric') {
                handleParametricDesign();
            }
        }
    };

    const clearHistory = () => {
        if (mode === 'chat') {
            setMessages([{
                role: 'assistant',
                content: 'Chat cleared. How can I help you?'
            }]);
        } else if (mode === 'code') {
            setCodeHistory([]);
        } else {
            setParametricHistory([]);
            setVariants([]);
        }
    };

    const getPlaceholder = () => {
        switch (mode) {
            case 'chat':
                return 'Describe what you want to create... (e.g., "Create a 50mm cube with filleted edges")';
            case 'code':
                return 'Enter JavaScript code... (e.g., "sketch.circle([0,0], 25)")';
            case 'parametric':
                return 'Describe a mechanical part... (e.g., "Create a mounting bracket with 4 M6 holes")';
            default:
                return 'Enter your command...';
        }
    };

    const handleAction = () => {
        if (mode === 'chat') {
            handleSendChat();
        } else if (mode === 'code') {
            handleExecuteCode();
        } else if (mode === 'parametric') {
            handleParametricDesign();
        }
    };

    return (
        <div className={`ai-console ${isExpanded ? 'expanded' : ''}`} style={{ height: isExpanded ? '300px' : '140px' }}>
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
                    <button
                        className={`mode-button ${mode === 'parametric' ? 'active' : ''}`}
                        onClick={() => setMode('parametric')}
                        title="Parametric Design Mode"
                    >
                        <Layers size={14} />
                        <span>Parametric</span>
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
            <div className="ai-console-content" style={{ height: isExpanded ? '200px' : '60px', overflow: 'auto' }}>
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
                ) : mode === 'code' ? (
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
                ) : (
                    <div className="parametric-terminal">
                        {parametricHistory.map((entry, idx) => (
                            <div key={idx} className={`parametric-entry ${entry.type}`}>
                                <div className="entry-prefix">
                                    {entry.type === 'prompt' ? '🎨' :
                                        entry.type === 'result' ? '✅' :
                                            entry.type === 'bom' ? '📋' : '❌'}
                                </div>
                                <div className="entry-content">
                                    {entry.content}
                                    {entry.variants && entry.variants.length > 0 && (
                                        <div className="variant-chips">
                                            {entry.variants.slice(0, 4).map((v, i) => (
                                                <span key={i} className="variant-chip" title={v.description}>
                                                    {v.name}: ${v.metrics?.totalCost?.toFixed(0) || '?'}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isProcessing && (
                            <div className="parametric-entry processing">
                                <div className="entry-prefix"><Zap size={14} /></div>
                                <div className="entry-content">Generating variants...</div>
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
                    placeholder={getPlaceholder()}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyPress={handleKeyPress}
                    disabled={isProcessing}
                    rows={1}
                    style={{ resize: 'none' }}
                />
                <button
                    className="send-button"
                    onClick={handleAction}
                    disabled={!input.trim() || isProcessing}
                    title={mode === 'chat' ? 'Send Message' : mode === 'code' ? 'Execute Code' : 'Generate Variants'}
                >
                    <Send size={16} />
                </button>
            </div>
        </div>
    );
}

export default AIConsole;

