import React, { useState } from 'react';
import Viewport3D from '../../components/Viewport3D';

/**
 * Mechanical CAD Workbench - Minimalistic Blender Layout
 * Industry Standard: SolidWorks, Siemens NX, CATIA
 */
function WorkbenchMechanical() {
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [showAiPanel, setShowAiPanel] = useState(false);

    // AI Design Generation
    const handleGenerateDesign = async () => {
        if (!aiPrompt.trim()) return;

        setIsGenerating(true);

        try {
            const response = await fetch('/api/mechanical/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: aiPrompt, preferences: { variantCount: 3 } })
            });

            const data = await response.json();

            if (data.success) {
                pollJobStatus(data.jobId);
            }
        } catch (error) {
            console.error('Error generating design:', error);
            setIsGenerating(false);
        }
    };

    const pollJobStatus = async (jobId) => {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/api/mechanical/generate/${jobId}`);
                const job = await response.json();

                if (job.status === 'completed') {
                    clearInterval(interval);
                    console.log('Design generated:', job.result);
                    setIsGenerating(false);
                    setAiPrompt('');
                } else if (job.status === 'failed') {
                    clearInterval(interval);
                    console.error('Design generation failed:', job.error);
                    setIsGenerating(false);
                }
            } catch (error) {
                clearInterval(interval);
                console.error('Error polling job:', error);
                setIsGenerating(false);
            }
        }, 1000);
    };

    return (
        <>
            {/* LEFT TOOLBAR - ICON ONLY */}
            <aside className="workbench-tools">
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button" title="Move">✥</button>
                <button className="tool-icon-button active" title="Sketch">✎</button>
                <button className="tool-icon-button" title="Extrude">⬆</button>
                <button className="tool-icon-button" title="Revolve">⟳</button>
                <button className="tool-icon-button" title="Fillet">⌒</button>
                <button className="tool-icon-button" title="Chamfer">⌐</button>
                <button className="tool-icon-button" title="Hole">⊙</button>
                <button className="tool-icon-button" title="Pattern">▦</button>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main className="workbench-viewport">
                <Viewport3D canvasId="render-canvas-mechanical" domain="mechanical" />
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                {/* AI Design Assistant Toggle */}
                <div className="property-section">
                    <h3 className="property-header">AI Design Assistant</h3>
                    <button
                        className="property-button"
                        onClick={() => setShowAiPanel(!showAiPanel)}
                    >
                        {showAiPanel ? '✕ Close AI Panel' : '🤖 Open AI Panel'}
                    </button>
                </div>

                {/* AI Panel (Expandable) */}
                {showAiPanel && (
                    <div className="property-section ai-design-section">
                        <textarea
                            className="ai-prompt-input"
                            value={aiPrompt}
                            onChange={(e) => setAiPrompt(e.target.value)}
                            placeholder="Example: Design a planetary gear assembly for EV motors with 0.005mm tolerances"
                            rows={3}
                            disabled={isGenerating}
                        />
                        <button
                            className="property-button"
                            onClick={handleGenerateDesign}
                            disabled={isGenerating || !aiPrompt.trim()}
                        >
                            {isGenerating ? '⏳ Generating...' : '✨ Generate Design'}
                        </button>
                        <small className="ai-hint">
                            AI will create 3 design variants with BOM and cost analysis
                        </small>
                    </div>
                )}

                {/* Feature Properties */}
                <div className="property-section">
                    <h3 className="property-header">Feature</h3>
                    <div className="property-row">
                        <span className="property-label">Distance</span>
                        <input type="number" className="property-input" placeholder="10.0" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Draft Angle</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Radius</span>
                        <input type="number" className="property-input" placeholder="2.0" />
                    </div>
                </div>

                {/* Material */}
                <div className="property-section">
                    <h3 className="property-header">Material</h3>
                    <select className="property-input">
                        <option>Aluminum 6061</option>
                        <option>Steel 1045</option>
                        <option>Stainless Steel 304</option>
                        <option>Titanium Ti-6Al-4V</option>
                        <option>ABS Plastic</option>
                    </select>
                </div>

                {/* Actions */}
                <div className="property-section">
                    <h3 className="property-header">Analysis</h3>
                    <button className="property-button">Run FEA Analysis</button>
                    <button className="property-button">Motion Simulation</button>
                    <button className="property-button">Generate Toolpaths</button>
                </div>

                {/* Export */}
                <div className="property-section">
                    <h3 className="property-header">Export</h3>
                    <button className="property-button">Export STEP</button>
                    <button className="property-button">Export STL</button>
                    <button className="property-button">Generate Drawing</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchMechanical;
