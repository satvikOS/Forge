import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// StrictMode disabled — causes Three.js double-mount/destroy issues
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
