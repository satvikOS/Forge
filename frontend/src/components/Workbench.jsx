import React, { useState } from 'react';
import './styles/workbench.css';

/**
 * Main Workbench Component
 * Implements the complete workbench-based architecture
 * Layout: center viewport, left tools, right properties, bottom prompt console
 */
function Workbench() {
    const [prompt, setPrompt] = useState('');
    const [activeTab, setActiveTab] = useState('prompt');

    const handleGenerate = async () => {
        if (!prompt.trim()) return;

        try {
            const response = await fetch('/api/generate/design', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt })
            });

            const data = await response.json();
            console.log('Generated design:', data);
            // Handle 3D model rendering here
        } catch (error) {
            console.error('Generation error:', error);
        }
    };

    return (
        <div className="workbench-container">
            {/* Header */}
            <header className="workbench-header">
                <h1 className="workbench-title">ArchDisc</h1>
                <div className="header-actions">
                    <button className="header-button">File</button>
                    <button className="header-button">Edit</button>
                    <button className="header-button">View</button>
                </div>
            </header>

            {/* Left Sidebar - Tools */}
            <aside className="workbench-tools">
                <div className="tool-section">
                    <h3 className="tool-section-title">Create</h3>
                    <button className="tool-button">Box</button>
                    <button className="tool-button">Cylinder</button>
                    <button className="tool-button">Sphere</button>
                    <button className="tool-button">Custom Shape</button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Modify</h3>
                    <button className="tool-button">Extrude</button>
                    <button className="tool-button">Boolean</button>
                    <button className="tool-button">Array</button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">AI Tools</h3>
                    <button className="tool-button">Text-to-3D</button>
                    <button className="tool-button">Image-to-3D</button>
                    <button className="tool-button">Sketch-to-3D</button>
                </div>
            </aside>

            {/* Center - 3D Viewport */}
            <main className="workbench-viewport">
                <canvas id="render-canvas"></canvas>
            </main>

            {/* Right Sidebar - Properties */}
            <aside className="workbench-properties">
                <div className="property-group">
                    <h3 className="property-label">Transform</h3>
                    <label>
                        <span className="property-label">Position X</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </label>
                    <label>
                        <span className="property-label">Position Y</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </label>
                    <label>
                        <span className="property-label">Position Z</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Material</h3>
                    <select className="property-input">
                        <option>Default</option>
                        <option>Glass</option>
                        <option>Metal</option>
                        <option>Wood</option>
                    </select>
                </div>
            </aside>

            {/* Bottom - Console/Prompt */}
            <footer className="workbench-console">
                <div className="console-tabs">
                    <button
                        className={`console-tab ${activeTab === 'prompt' ? 'active' : ''}`}
                        onClick={() => setActiveTab('prompt')}
                    >
                        AI Prompt
                    </button>
                    <button
                        className={`console-tab ${activeTab === 'console' ? 'active' : ''}`}
                        onClick={() => setActiveTab('console')}
                    >
                        Console
                    </button>
                    <button
                        className={`console-tab ${activeTab === 'history' ? 'active' : ''}`}
                        onClick={() => setActiveTab('history')}
                    >
                        History
                    </button>
                </div>

                {activeTab === 'prompt' && (
                    <div className="prompt-input-container">
                        <textarea
                            className="prompt-input"
                            placeholder="Describe your design... (e.g., 'Create a modern office building with glass facade')"
                            value={prompt}
                            onChange={(e) => setPrompt(e.target.value)}
                            rows={3}
                        />
                        <button className="generate-button" onClick={handleGenerate}>
                            Generate
                        </button>
                    </div>
                )}
            </footer>
        </div>
    );
}

export default Workbench;
