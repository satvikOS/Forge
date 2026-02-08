import React, { useState, useEffect, useRef } from 'react';
import './CommandPalette.css';

/**
 * Command Palette - Searchable action finder (Ctrl+K)
 * Inspired by VS Code, Figma, Linear
 */
function CommandPalette({ actions = [], onClose }) {
    const [query, setQuery] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef(null);
    const listRef = useRef(null);

    // Focus input on mount
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    // Filter actions by query
    const filtered = actions.filter(action => {
        const search = query.toLowerCase();
        return (
            action.label.toLowerCase().includes(search) ||
            action.category.toLowerCase().includes(search)
        );
    });

    // Group by category
    const grouped = filtered.reduce((acc, action) => {
        if (!acc[action.category]) acc[action.category] = [];
        acc[action.category].push(action);
        return acc;
    }, {});

    // Flatten for keyboard navigation
    const flatList = Object.values(grouped).flat();

    // Reset selection when query changes
    useEffect(() => {
        setSelectedIndex(0);
    }, [query]);

    // Keyboard navigation
    useEffect(() => {
        const handleKeyDown = (e) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault();
                    setSelectedIndex(prev => Math.min(prev + 1, flatList.length - 1));
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex(prev => Math.max(prev - 1, 0));
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (flatList[selectedIndex]) {
                        flatList[selectedIndex].action();
                        onClose();
                    }
                    break;
                case 'Escape':
                    onClose();
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [flatList, selectedIndex, onClose]);

    // Scroll selected item into view
    useEffect(() => {
        if (listRef.current) {
            const selected = listRef.current.querySelector('.cp-item.selected');
            if (selected) {
                selected.scrollIntoView({ block: 'nearest' });
            }
        }
    }, [selectedIndex]);

    let flatIndex = 0;

    return (
        <div className="cp-overlay" onClick={onClose}>
            <div className="cp-modal" onClick={e => e.stopPropagation()}>
                <div className="cp-input-wrapper">
                    <span className="cp-search-icon">&#x2315;</span>
                    <input
                        ref={inputRef}
                        type="text"
                        className="cp-input"
                        placeholder="Type a command..."
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                    />
                    <kbd className="cp-esc">Esc</kbd>
                </div>

                <div className="cp-list" ref={listRef}>
                    {Object.keys(grouped).length === 0 ? (
                        <div className="cp-empty">No matching commands</div>
                    ) : (
                        Object.entries(grouped).map(([category, items]) => (
                            <div key={category} className="cp-group">
                                <div className="cp-category">{category}</div>
                                {items.map(item => {
                                    const idx = flatIndex++;
                                    return (
                                        <button
                                            key={item.id}
                                            className={`cp-item ${idx === selectedIndex ? 'selected' : ''}`}
                                            onClick={() => {
                                                item.action();
                                                onClose();
                                            }}
                                            onMouseEnter={() => setSelectedIndex(idx)}
                                        >
                                            <span className="cp-item-label">{item.label}</span>
                                            {item.shortcut && (
                                                <kbd className="cp-item-shortcut">{item.shortcut}</kbd>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        ))
                    )}
                </div>

                <div className="cp-footer">
                    <span className="cp-hint">
                        <kbd>↑↓</kbd> navigate
                        <kbd>↵</kbd> select
                        <kbd>esc</kbd> close
                    </span>
                </div>
            </div>
        </div>
    );
}

export default CommandPalette;
