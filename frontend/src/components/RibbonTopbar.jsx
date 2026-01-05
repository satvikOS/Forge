import React, { useState } from 'react';
import {
    File, FolderOpen, Save, Download, Upload, Printer,
    Box, Circle, Square, Pencil, Move, RotateCw,
    Link2, Package, Grid3x3,
    Sheet, Zap, Factory, Wrench,
    BarChart3, Waves, Activity, Play,
    FileText, Ruler, CheckCircle, Eye,
    Palette, Settings, Users, Cloud, HelpCircle
} from 'lucide-react';
import './RibbonTopbar.css';

/**
 * Industry-Standard Ribbon Topbar (SolidWorks/Fusion 360 style)
 * Organizes all CAD features into logical tabs
 */
function RibbonTopbar({ onCommand }) {
    const [activeTab, setActiveTab] = useState('features');

    const executeCommand = (command, data = {}) => {
        if (onCommand) {
            onCommand(command, data);
        }
    };

    return (
        <div className="ribbon-topbar">
            {/* Ribbon Tabs */}
            <div className="ribbon-tabs">
                <div
                    className={`ribbon-tab ${activeTab === 'file' ? 'active' : ''}`}
                    onClick={() => setActiveTab('file')}
                >
                    File
                </div>
                <div
                    className={`ribbon-tab ${activeTab === 'features' ? 'active' : ''}`}
                    onClick={() => setActiveTab('features')}
                >
                    Features
                </div>
                <div
                    className={`ribbon-tab ${activeTab === 'assembly' ? 'active' : ''}`}
                    onClick={() => setActiveTab('assembly')}
                >
                    Assembly
                </div>
                <div
                    className={`ribbon-tab ${activeTab === 'manufacturing' ? 'active' : ''}`}
                    onClick={() => setActiveTab('manufacturing')}
                >
                    Manufacturing
                </div>
                <div
                    className={`ribbon-tab ${activeTab === 'simulate' ? 'active' : ''}`}
                    onClick={() => setActiveTab('simulate')}
                >
                    Simulate
                </div>
                <div
                    className={`ribbon-tab ${activeTab === 'evaluate' ? 'active' : ''}`}
                    onClick={() => setActiveTab('evaluate')}
                >
                    Evaluate
                </div>
                <div
                    className={`ribbon-tab ${activeTab === 'tools' ? 'active' : ''}`}
                    onClick={() => setActiveTab('tools')}
                >
                    Tools
                </div>
            </div>

            {/* Ribbon Panels */}
            <div className="ribbon-panels">
                {activeTab === 'file' && (
                    <>
                        <div className="ribbon-group">
                            <div className="group-label">Document</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('new')} title="New"><File size={20} /><span>New</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('open')} title="Open"><FolderOpen size={20} /><span>Open</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('save')} title="Save"><Save size={20} /><span>Save</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Import/Export</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('import')} title="Import"><Upload size={20} /><span>Import</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('export')} title="Export"><Download size={20} /><span>Export</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Print</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('print')} title="Print"><Printer size={20} /><span>Print</span></button>
                        </div>
                    </>
                )}

                {activeTab === 'features' && (
                    <>
                        <div className="ribbon-group">
                            <div className="group-label">Sketch</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('line')} title="Line"><Pencil size={20} /><span>Line</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('circle')} title="Circle"><Circle size={20} /><span>Circle</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('rectangle')} title="Rectangle"><Square size={20} /><span>Rectangle</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Features</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('extrude')} title="Extrude"><Box size={20} /><span>Extrude</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('revolve')} title="Revolve"><RotateCw size={20} /><span>Revolve</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('loft')} title="Loft"><Move size={20} /><span>Loft</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Pattern</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('pattern-linear')} title="Linear Pattern"><Grid3x3 size={20} /><span>Linear</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('pattern-circular')} title="Circular Pattern"><Circle size={20} /><span>Circular</span></button>
                        </div>
                    </>
                )}

                {activeTab === 'assembly' && (
                    <>
                        <div className="ribbon-group">
                            <div className="group-label">Insert</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('insert-component')} title="Insert Component"><Package size={20} /><span>Component</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Mates</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('mate-coincident')} title="Coincident"><Link2 size={20} /><span>Coincident</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('mate-concentric')} title="Concentric"><Circle size={20} /><span>Concentric</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Visualize</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('exploded-view')} title="Exploded View"><Package size={20} /><span>Explode</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('motion-study')} title="Motion Study"><Play size={20} /><span>Motion</span></button>
                        </div>
                    </>
                )}

                {activeTab === 'manufacturing' && (
                    <>
                        <div className="ribbon-group">
                            <div className="group-label">Sheet Metal</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('base-flange')} title="Base Flange"><Sheet size={20} /><span>Base Flange</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('edge-flange')} title="Edge Flange"><Sheet size={20} /><span>Edge Flange</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('flat-pattern')} title="Flat Pattern"><Sheet size={20} /><span>Flatten</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Weldments</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('structural-frame')} title="Structural Frame"><Zap size={20} /><span>Frame</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('fillet-weld')} title="Fillet Weld"><Zap size={20} /><span>Weld</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('cut-list')} title="Cut List"><FileText size={20} /><span>Cut List</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Mold Design</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('parting-line')} title="Parting Line"><Factory size={20} /><span>Parting</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('core-cavity')} title="Core & Cavity"><Factory size={20} /><span>Core/Cavity</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">CAM</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('cam-setup')} title="CAM Setup"><Wrench size={20} /><span>Setup</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('toolpath')} title="Toolpath"><Wrench size={20} /><span>Toolpath</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('post-process')} title="Post Process"><FileText size={20} /><span>G-Code</span></button>
                        </div>
                    </>
                )}

                {activeTab === 'simulate' && (
                    <>
                        <div className="ribbon-group">
                            <div className="group-label">FEA</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('fea-linear')} title="Linear Static"><BarChart3 size={20} /><span>Static</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('fea-modal')} title="Modal"><Activity size={20} /><span>Modal</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">CFD</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('cfd-internal')} title="Internal Flow"><Waves size={20} /><span>Internal</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('cfd-external')} title="External Flow"><Waves size={20} /><span>External</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Motion</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('motion-kinematic')} title="Kinematic"><Play size={20} /><span>Kinematic</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('motion-dynamic')} title="Dynamic"><Activity size={20} /><span>Dynamic</span></button>
                        </div>
                    </>
                )}

                {activeTab === 'evaluate' && (
                    <>
                        <div className="ribbon-group">
                            <div className="group-label">Drawings</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('new-drawing')} title="New Drawing"><FileText size={20} /><span>Drawing</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('auto-dimension')} title="Auto Dimension"><Ruler size={20} /><span>Dimension</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Inspect</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('measure')} title="Measure"><Ruler size={20} /><span>Measure</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('interference')} title="Interference"><Eye size={20} /><span>Interference</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Compliance</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('dfm-check')} title="DFM Check"><CheckCircle size={20} /><span>DFM</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('dfa-check')} title="DFA Check"><CheckCircle size={20} /><span>DFA</span></button>
                        </div>
                    </>
                )}

                {activeTab === 'tools' && (
                    <>
                        <div className="ribbon-group">
                            <div className="group-label">Materials</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('apply-material')} title="Apply Material"><Palette size={20} /><span>Material</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('appearance')} title="Appearance"><Palette size={20} /><span>Appearance</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Configurations</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('new-config')} title="New Configuration"><Settings size={20} /><span>Config</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('design-table')} title="Design Table"><Grid3x3 size={20} /><span>Table</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">3D Print</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('print-prep')} title="Print Prep"><Printer size={20} /><span>Prepare</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('export-stl')} title="Export STL"><Download size={20} /><span>STL</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Collaborate</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('share')} title="Share"><Users size={20} /><span>Share</span></button>
                            <button className="ribbon-btn" onClick={() => executeCommand('comment')} title="Comment"><Cloud size={20} /><span>Comment</span></button>
                        </div>
                        <div className="ribbon-group">
                            <div className="group-label">Help</div>
                            <button className="ribbon-btn" onClick={() => executeCommand('help')} title="Help"><HelpCircle size={20} /><span>Help</span></button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

export default RibbonTopbar;
