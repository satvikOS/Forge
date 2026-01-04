import React, { useState, useEffect, useRef } from 'react';
import { Send, Code, MessageSquare } from 'lucide-react';
import './ChatConsole.css';

/**
 * ChatConsole - AI chat interface for natural language CAD commands
 * Supports both conversational mode and code mode (Python-like syntax)
 */
function ChatConsole({ onCommandExecute }) {
    const [messages, setMessages] = useState([]);
    const [inputValue, setInputValue] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [mode, setMode] = useState('chat'); // 'chat' or 'code'
    const messagesEndRef = useRef(null);

    // Auto-scroll to bottom
    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    useEffect(scrollToBottom, [messages]);

    // Handle send message
    const handleSend = async () => {
        if (!inputValue.trim()) return;

        const userMessage = {
            id: Date.now(),
            role: 'user',
            content: inputValue,
            timestamp: new Date()
        };

        setMessages(prev => [...prev, userMessage]);
        setInputValue('');
        setIsTyping(true);

        try {
            // Call backend chat API
            const response = await fetch('/api/mechanical/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: inputValue,
                    conversationContext: messages.slice(-5) // Last 5 messages for context
                })
            });

            const data = await response.json();

            // Add AI response
            const aiMessage = {
                id: Date.now() + 1,
                role: 'assistant',
                content: data.conversationalResponse || 'Command processed.',
                timestamp: new Date(),
                intent: data.intent,
                endpoint: data.endpoint,
                suggestedFollowUps: data.suggestedFollowUps || []
            };

            setMessages(prev => [...prev, aiMessage]);

            // Execute command if there's an endpoint
            if (data.endpoint && onCommandExecute) {
                const result = await onCommandExecute(data.endpoint, data.method, data.params);

                // Add execution result as system message
                const resultMessage = {
                    id: Date.now() + 2,
                    role: 'system',
                    content: result.success ?
                        `✅ Command executed successfully` :
                        `❌ Error: ${result.error}`,
                    timestamp: new Date()
                };
                setMessages(prev => [...prev, resultMessage]);
            }

        } catch (error) {
            const errorMessage = {
                id: Date.now() + 1,
                role: 'system',
                content: `❌ Error: ${error.message}`,
                timestamp: new Date()
            };
            setMessages(prev => [...prev, errorMessage]);
        } finally {
            setIsTyping(false);
        }
    };

    // Handle keyboard shortcuts
    const handleKeyPress = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    // Handle follow-up click
    const handleFollowUp = (followUp) => {
        setInputValue(followUp);
    };

    return (
        <div className="chat-console">
            {/* Mode Toggle */}
            <div className="chat-header">
                <button
                    className={`mode-toggle ${mode === 'chat' ? 'active' : ''}`}
                    onClick={() => setMode('chat')}
                    title="Chat Mode"
                >
                    <MessageSquare size={14} /> Chat
                </button>
                <button
                    className={`mode-toggle ${mode === 'code' ? 'active' : ''}`}
                    onClick={() => setMode('code')}
                    title="Code Mode"
                >
                    <Code size={14} /> Code
                </button>
            </div>

            {/* Messages Area */}
            <div className="chat-messages">
                {messages.length === 0 && (
                    <div className="chat-welcome">
                        <h3>AI CAD Assistant</h3>
                        <p>Try commands like:</p>
                        <ul>
                            <li>"Create a 50mm cube"</li>
                            <li>"Run FEA analysis"</li>
                            <li>"Generate BOM"</li>
                            <li>"Estimate manufacturing cost"</li>
                        </ul>
                    </div>
                )}

                {messages.map(msg => (
                    <div key={msg.id} className={`chat-message ${msg.role}`}>
                        <div className="message-bubble">
                            <div className="message-content">{msg.content}</div>
                            {msg.suggestedFollowUps && msg.suggestedFollowUps.length > 0 && (
                                <div className="follow-ups">
                                    {msg.suggestedFollowUps.map((followUp, idx) => (
                                        <button
                                            key={idx}
                                            className="follow-up-btn"
                                            onClick={() => handleFollowUp(followUp)}
                                        >
                                            {followUp}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="message-time">
                            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    </div>
                ))}

                {isTyping && (
                    <div className="chat-message assistant">
                        <div className="message-bubble typing">
                            <span></span><span></span><span></span>
                        </div>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            {/* Input Area */}
            <div className="chat-input-area">
                <textarea
                    className={`chat-input ${mode}`}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyPress={handleKeyPress}
                    placeholder={mode === 'chat' ?
                        'Type a command or question...' :
                        '# Python-like CAD scripting\npart = create_cube(50)\nanalysis = run_fea(part)'}
                    rows={mode === 'code' ? 3 : 1}
                />
                <button
                    className="send-button"
                    onClick={handleSend}
                    disabled={!inputValue.trim() || isTyping}
                >
                    <Send size={18} />
                </button>
            </div>
        </div>
    );
}

export default ChatConsole;
