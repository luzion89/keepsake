import { createBrowserRouter, Navigate, useParams } from 'react-router-dom';
import { Shell } from './Shell.js';
import { AuthGuard } from './AuthGuard.js';
import { HomePage } from '../pages/Home.js';
import { RoomPage } from '../pages/Room.js';
import { AreaPage } from '../pages/Area.js';
import { ItemPage } from '../pages/Item.js';
import { CapturePage } from '../pages/Capture.js';
import { TextInputPage } from '../pages/TextInput.js';
import { SearchPage } from '../pages/Search.js';
import { SettingsPage } from '../pages/Settings.js';
import { RemindersPage } from '../pages/Reminders.js';
import { PairPage } from '../pages/Pair.js';

/** Redirect /areas/:areaId/voice → /areas/:areaId/text to avoid 404s from old links. */
function VoiceRedirect() {
  const { areaId = '' } = useParams();
  return <Navigate to={`/areas/${areaId}/text`} replace />;
}

export const router = createBrowserRouter([
  // Public: pair page (no auth required)
  { path: '/pair', element: <PairPage /> },

  // Protected: everything else requires device_token
  {
    path: '/',
    element: (
      <AuthGuard>
        <Shell />
      </AuthGuard>
    ),
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
      { path: 'reminders', element: <RemindersPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
]);
