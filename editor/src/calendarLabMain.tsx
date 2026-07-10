import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import CalendarLab from './pages/CalendarLab.tsx';

const root: HTMLElement = document.querySelector('#root')!;

createRoot(root).render(
  <StrictMode>
    <CalendarLab />
  </StrictMode>,
);
