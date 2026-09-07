import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './stil.css';
import { App } from './App.js';

createRoot(document.getElementById('wurzel')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
