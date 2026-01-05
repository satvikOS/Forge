import React, { useState, useEffect } from 'react';
import {
    Layers, Box, FileText, Settings, ChevronDown, ChevronRight,
    Download, Zap, BarChart3, Package, DollarSign, RefreshCw
} from 'lucide-react';
import './ParametricDesignPanel.css';

/**
 * Parametric Design Panel
 * Displays design variants, BOM, and simulation prep controls
 * Uses FIXED dimensions to prevent UI auto-resizing
 */
function ParametricDesignPanel({ variants = [], bom = null, onSelectVariant, onExportBOM }) {
    const [selectedVariantId, setSelectedVariantId] = useState(null);
    const [expandedSections, setExpandedSections] = useState({
        variants: true,
        bom: false,
        simulation: false
    });
    const [bomFormat, setBomFormat] = useState('csv');

    useEffect(() => {
        if (variants.length > 0 && !selectedVariantId) {
            setSelectedVariantId(variants[0].id);
        }
    }, [variants, selectedVariantId]);

    const toggleSection = (section) => {
        setExpandedSections(prev => ({
            ...prev,
            [section]: !prev[section]
        }));
    };

    const handleVariantSelect = (variantId) => {
        setSelectedVariantId(variantId);
        if (onSelectVariant) {
            const variant = variants.find(v => v.id === variantId);
            onSelectVariant(variant);
        }
    };

    const handleExportBOM = () => {
        if (onExportBOM && bom) {
            onExportBOM(bom, bomFormat);
        }
    };

    const selectedVariant = variants.find(v => v.id === selectedVariantId);

    return (
        <div className="parametric-design-panel">
            {/* Header */}
            <div className="pdp-header">
                <div className="pdp-title">
                    <Layers size={14} />
                    <span>Parametric Design</span>
                </div>
                <button className="pdp-action-btn" title="Refresh">
                    <RefreshCw size={12} />
                </button>
            </div>

            {/* Variants Section */}
            <div className="pdp-section">
                <div
                    className="pdp-section-header"
                    onClick={() => toggleSection('variants')}
                >
                    {expandedSections.variants ?
                        <ChevronDown size={12} /> :
                        <ChevronRight size={12} />
                    }
                    <Box size={12} />
                    <span>Design Variants ({variants.length})</span>
                </div>

                {expandedSections.variants && (
                    <div className="pdp-section-content">
                        {variants.length === 0 ? (
                            <div className="pdp-empty">
                                No variants generated yet
                            </div>
                        ) : (
                            <div className="variant-list">
                                {variants.map(variant => (
                                    <div
                                        key={variant.id}
                                        className={`variant-item ${selectedVariantId === variant.id ? 'selected' : ''}`}
                                        onClick={() => handleVariantSelect(variant.id)}
                                    >
                                        <div className="variant-name">{variant.name}</div>
                                        <div className="variant-metrics">
                                            <span title="Weight">
                                                <Package size={10} />
                                                {variant.metrics?.weight?.toFixed(0) || '?'}g
                                            </span>
                                            <span title="Cost">
                                                <DollarSign size={10} />
                                                {variant.metrics?.totalCost?.toFixed(0) || '?'}
                                            </span>
                                            <span title="Score">
                                                <BarChart3 size={10} />
                                                {variant.score?.toFixed(1) || '?'}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Selected Variant Details */}
            {selectedVariant && (
                <div className="pdp-section">
                    <div className="pdp-section-header">
                        <Settings size={12} />
                        <span>Details: {selectedVariant.name}</span>
                    </div>
                    <div className="pdp-section-content">
                        <div className="variant-details">
                            <p className="variant-description">{selectedVariant.description}</p>
                            <div className="variant-tradeoffs">
                                <div className="tradeoff-pros">
                                    <strong>Pros:</strong>
                                    <ul>
                                        {selectedVariant.tradeoffs?.pros?.map((pro, i) => (
                                            <li key={i}>{pro}</li>
                                        )) || <li>No data</li>}
                                    </ul>
                                </div>
                                <div className="tradeoff-cons">
                                    <strong>Cons:</strong>
                                    <ul>
                                        {selectedVariant.tradeoffs?.cons?.map((con, i) => (
                                            <li key={i}>{con}</li>
                                        )) || <li>No data</li>}
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* BOM Section */}
            <div className="pdp-section">
                <div
                    className="pdp-section-header"
                    onClick={() => toggleSection('bom')}
                >
                    {expandedSections.bom ?
                        <ChevronDown size={12} /> :
                        <ChevronRight size={12} />
                    }
                    <FileText size={12} />
                    <span>Bill of Materials</span>
                </div>

                {expandedSections.bom && (
                    <div className="pdp-section-content">
                        {!bom ? (
                            <div className="pdp-empty">
                                No BOM generated
                            </div>
                        ) : (
                            <div className="bom-preview">
                                <div className="bom-summary">
                                    <div className="bom-stat">
                                        <span className="stat-label">Items</span>
                                        <span className="stat-value">{bom.items?.length || 0}</span>
                                    </div>
                                    <div className="bom-stat">
                                        <span className="stat-label">Material</span>
                                        <span className="stat-value">
                                            ${bom.costs?.materialTotal?.toFixed(2) || '0'}
                                        </span>
                                    </div>
                                    <div className="bom-stat">
                                        <span className="stat-label">Total</span>
                                        <span className="stat-value total">
                                            ${bom.costs?.grandTotal?.toFixed(2) || '0'}
                                        </span>
                                    </div>
                                </div>
                                <div className="bom-export">
                                    <select
                                        value={bomFormat}
                                        onChange={(e) => setBomFormat(e.target.value)}
                                        className="bom-format-select"
                                    >
                                        <option value="csv">CSV</option>
                                        <option value="json">JSON</option>
                                        <option value="excel">Excel</option>
                                    </select>
                                    <button
                                        className="bom-export-btn"
                                        onClick={handleExportBOM}
                                    >
                                        <Download size={12} />
                                        Export
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Simulation Section */}
            <div className="pdp-section">
                <div
                    className="pdp-section-header"
                    onClick={() => toggleSection('simulation')}
                >
                    {expandedSections.simulation ?
                        <ChevronDown size={12} /> :
                        <ChevronRight size={12} />
                    }
                    <Zap size={12} />
                    <span>Simulation Prep</span>
                </div>

                {expandedSections.simulation && (
                    <div className="pdp-section-content">
                        <div className="simulation-options">
                            <button className="sim-btn">
                                <Zap size={12} />
                                Static FEA
                            </button>
                            <button className="sim-btn">
                                <BarChart3 size={12} />
                                Modal Analysis
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ParametricDesignPanel;
