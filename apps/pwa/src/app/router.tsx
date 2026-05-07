import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Shell } from './Shell.js';
import { HomePage } from '../pages/Home.js';
import { RoomPage } from '../pages/Room.js';
import { AreaPage } from '../pages/Area.js';
import { ItemPage } from '../pages/Item.js';
import { CapturePage } from '../pages/Capture.js';
import { SearchPage } from '../pages/Search.js';
import { SettingsPage } from '../pages/Settings.js';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'rooms/:roomId', element: <RoomPage /> },
      { path: 'areas/:areaId', element: <AreaPage /> },
      { path: 'areas/:areaId/capture', element: <CapturePage /> },
      { path: 'items/:itemId', element: <ItemPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
