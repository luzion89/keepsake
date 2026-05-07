import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { Shell } from './Shell.js';
import { HomePage } from '../pages/Home.js';
import { RoomPage } from '../pages/Room.js';
import { AreaPage } from '../pages/Area.js';
import { ItemPage } from '../pages/Item.js';
import { CapturePage } from '../pages/Capture.js';
import { TextInputPage } from '../pages/TextInput.js';
import { SearchPage } from '../pages/Search.js';
import { SettingsPage } from '../pages/Settings.js';

/** Redirect /areas/:areaId/voice → /areas/:areaId/text to avoid 404s from old links. */
function VoiceRedirect() {
  const { areaId = '' } = useParams();
  return <Navigate to={`/areas/${areaId}/text`} replace />;
}

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Shell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'rooms/:roomId', element: <RoomPage /> },
      { path: 'areas/:areaId', element: <AreaPage /> },
      { path: 'areas/:areaId/capture', element: <CapturePage /> },
      { path: 'areas/:areaId/text', element: <TextInputPage /> },
      { path: 'areas/:areaId/voice', element: <VoiceRedirect /> },
      { path: 'items/:itemId', element: <ItemPage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
