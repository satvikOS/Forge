import React, { useEffect } from 'react';
import './ToastContainer.css';

/**
 * Toast Notification System
 * Renders stacked toast messages with auto-dismiss
 */
function ToastContainer({ toasts = [], onRemove }) {
    return (
        <div className="toast-container">
            {toasts.map(toast => (
                <Toast key={toast.id} toast={toast} onRemove={onRemove} />
            ))}
        </div>
    );
}

function Toast({ toast, onRemove }) {
    useEffect(() => {
        const timer = setTimeout(() => {
            onRemove(toast.id);
        }, toast.duration || 3000);

        return () => clearTimeout(timer);
    }, [toast.id, toast.duration, onRemove]);

    const icons = {
        success: '✓',
        error: '✕',
        warning: '!',
        info: 'i',
    };

    return (
        <div className={`toast toast-${toast.type || 'info'}`}>
            <span className="toast-icon">{icons[toast.type] || icons.info}</span>
            <span className="toast-message">{toast.message}</span>
            <button className="toast-close" onClick={() => onRemove(toast.id)}>×</button>
        </div>
    );
}

export default ToastContainer;
