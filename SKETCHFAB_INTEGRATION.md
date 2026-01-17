# Sketchfab Integration Guide

## Overview

ArchDisc now includes comprehensive Sketchfab integration, allowing users to browse, preview, and embed 3D architectural models directly within the platform. This integration leverages the Sketchfab API v3 and Viewer API to provide a seamless experience for viewing and managing 3D content.

## Features

### 1. Model Browsing
- Search for architectural models using keywords
- Filter by categories (Architecture, Cultural Heritage, Places & Travel)
- Sort by relevance, likes, views, or date
- Grid and list view modes
- Infinite scroll pagination

### 2. 3D Model Viewer
- Interactive 3D model viewing with Sketchfab's official Viewer API
- Full viewer controls (rotate, zoom, pan)
- Fullscreen mode support
- VR mode support (when available)
- Annotations and hotspots
- Customizable viewer settings

### 3. Model Management
- Attach multiple Sketchfab models to discoveries
- Preview models before adding
- View model metadata (views, likes, author info)
- Remove models from discoveries
- Expand/collapse model viewers

### 4. OAuth Authentication (Optional)
- Connect your Sketchfab account
- Access your private models and collections
- View your uploaded models
- Manage your Sketchfab favorites

## Setup Instructions

### Important: Environment File Setup

**The `.env` file is not included in the repository for security reasons.** You must create it yourself:

```bash
cd backend
cp .env.example .env
```

Then edit `backend/.env` to add your API keys (both Gemini and Sketchfab). The `.env` file is in `.gitignore` to prevent accidentally committing your secrets to git.

### Prerequisites

1. **Sketchfab Account** (optional for basic features)
   - Create a free account at [sketchfab.com](https://sketchfab.com)
   - Basic browsing works without authentication

2. **API Credentials** (required to enable integration)
   - Option A: API Token (Simple, recommended for basic use)
   - Option B: OAuth Credentials (Required for user authentication)

### Getting API Credentials

#### Option A: API Token (Recommended)

1. Log in to your Sketchfab account
2. Go to Settings → Password: https://sketchfab.com/settings/password
3. Scroll to "API Token" section
4. Click "Generate Token" or copy existing token
5. Add to your `.env` file:
   ```
   SKETCHFAB_API_TOKEN=your_token_here
   SKETCHFAB_ENABLED=true
   ```

#### Option B: OAuth Credentials (For User Authentication)

1. Contact Sketchfab support to register your application
2. Provide:
   - Application name: "ArchDisc"
   - Redirect URI: `https://yourdomain.com/sketchfab/callback`
   - Description: Brief description of your app
3. Receive Client ID and Client Secret
4. Add to your `.env` file:
   ```
   SKETCHFAB_CLIENT_ID=your_client_id
   SKETCHFAB_CLIENT_SECRET=your_client_secret
   SKETCHFAB_ENABLED=true
   ```

### Backend Configuration

1. **Create the `.env` file** (if it doesn't exist):
   ```bash
   cd backend
   cp .env.example .env
   ```
   
   **Important**: The `.env` file is not tracked by git (it's in `.gitignore` for security). You must create it from `.env.example` and add your API keys.

2. **Environment Variables** (`backend/.env`):
   ```env
   # Sketchfab API Configuration
   SKETCHFAB_API_TOKEN=your_sketchfab_api_token_here
   SKETCHFAB_CLIENT_ID=your_client_id_here
   SKETCHFAB_CLIENT_SECRET=your_client_secret_here
   SKETCHFAB_ENABLED=true
   ```

2. **CORS Configuration**:
   - Sketchfab API requests are made from the backend
   - No additional CORS configuration needed for the frontend

### Frontend Configuration

No additional configuration needed for the frontend. The integration automatically detects if Sketchfab is enabled via the backend API.

## Usage

### For End Users

#### Browsing Models

1. Open the Sketchfab panel in the sidebar (if integrated) or access the model browser
2. Use the search bar to find architectural models
3. Apply filters:
   - **Category**: Filter by model category
   - **Sort**: Change sorting order (relevance, likes, views, recent)
   - **View Mode**: Toggle between grid and list views

#### Adding Models to Discoveries

1. Click "Add Model" or "Browse Sketchfab"
2. Search and select models from the browser
3. Click on a model to preview it
4. Select multiple models (checkmarks appear)
5. Click "Add to Discovery" to attach models
6. Models appear in the Sketchfab panel

#### Viewing Models

1. Click the expand button (+) on a model in the panel
2. Interactive 3D viewer loads
3. Use mouse controls:
   - **Left click + drag**: Rotate
   - **Right click + drag**: Pan
   - **Scroll**: Zoom
4. Click fullscreen icon for immersive view
5. View model metadata (views, likes, author)
6. Click "View on Sketchfab" to open the original model page

#### Removing Models

1. Click the remove button (×) on a model
2. Model is removed from the discovery

### For Developers

#### Using the Sketchfab API Service (Backend)

```javascript
const sketchfabService = require('./services/sketchfabService');

// Check if enabled
const isEnabled = sketchfabService.isEnabled();

// Search for models
const results = await sketchfabService.searchModels({
  q: 'modern architecture',
  categories: 'architecture',
  sort_by: 'likes',
  count: 24,
});

// Get model details
const model = await sketchfabService.getModel('model-uid-here');

// OAuth: Get authorization URL
const authUrl = sketchfabService.getAuthorizationUrl(redirectUri, state);

// OAuth: Exchange code for token
const tokens = await sketchfabService.exchangeCodeForToken(code, redirectUri);
```

#### Using the Sketchfab API Client (Frontend)

```javascript
import sketchfabApi from './services/sketchfabApi';

// Check status
const status = await sketchfabApi.checkStatus();

// Search models
const results = await sketchfabApi.searchModels({
  query: 'architecture',
  category: 'architecture',
  sortBy: 'relevance',
  count: 24,
});

// Get model details
const model = await sketchfabApi.getModel('model-uid');

// OAuth: Check authentication
const isAuthenticated = sketchfabApi.isAuthenticated();

// OAuth: Logout
sketchfabApi.logout();
```

#### Using Components

```jsx
import SketchfabViewer from './components/SketchfabViewer';
import ModelBrowser from './components/ModelBrowser';
import ModelPicker from './components/ModelPicker';
import SketchfabPanel from './components/SketchfabPanel';

// Viewer
<SketchfabViewer 
  modelUid="abc123"
  autostart={1}
  width="100%"
  height="480px"
  onReady={(api) => console.log('Viewer ready', api)}
/>

// Browser
<ModelBrowser 
  onModelSelect={(model) => console.log('Selected', model)}
  selectedModels={[]}
/>

// Picker Modal
<ModelPicker
  isOpen={true}
  onClose={() => setIsOpen(false)}
  onSelect={(models) => console.log('Selected', models)}
  allowMultiple={true}
/>

// Panel (Discovery Integration)
<SketchfabPanel
  models={sketchfabModels}
  onModelsChange={(models) => setSketchfabModels(models)}
/>
```

## API Endpoints

### Backend Routes (`/api/sketchfab`)

- `GET /status` - Check if Sketchfab is enabled
- `GET /search` - Search for models
- `GET /models/:uid` - Get model details
- `GET /users/:username/models` - Get user's models
- `GET /users/:username/collections` - Get user's collections
- `GET /collections/:uid/models` - Get collection models
- `GET /oauth/authorize` - Get OAuth authorization URL
- `POST /oauth/token` - Exchange code for token
- `POST /oauth/refresh` - Refresh access token
- `GET /me` - Get current user info (OAuth required)
- `POST /cache/clear` - Clear API cache

### Query Parameters

#### Search (`/search`)
- `q` - Search query (default: 'architecture')
- `categories` - Category filter
- `sort_by` - Sort option (relevance, likes, views, recent)
- `count` - Results per page (max: 100)
- `cursor` - Pagination cursor
- `licenses` - License filter

## Rate Limits

Sketchfab API has rate limits:
- **Anonymous**: 60 requests per minute
- **Authenticated**: 100 requests per minute

The integration includes:
- **Caching**: 5-minute cache for API responses
- **Rate limit handling**: Automatic retry with exponential backoff
- **Error handling**: Graceful degradation when limits are reached

## Best Practices

### Performance
1. **Enable caching**: Built-in 5-minute cache reduces API calls
2. **Lazy loading**: Models only load when expanded
3. **Thumbnail optimization**: Use Sketchfab's optimized thumbnails
4. **Pagination**: Load models in batches (24 per page)

### User Experience
1. **Loading states**: Show spinners while loading
2. **Error handling**: Display helpful error messages
3. **Responsive design**: Works on mobile, tablet, desktop
4. **Accessibility**: Keyboard navigation and ARIA labels

### API Usage
1. **Search optimization**: Use specific keywords
2. **Category filters**: Narrow results to relevant categories
3. **Authentication**: Use OAuth for private models
4. **Cache management**: Clear cache when needed

## Troubleshooting

### Integration Not Working

1. **Check Environment Variables**:
   ```bash
   # Backend
   cd backend
   cat .env | grep SKETCHFAB
   ```
   Ensure `SKETCHFAB_ENABLED=true` and token/credentials are set

2. **Check Status Endpoint**:
   ```bash
   curl http://localhost:5000/api/sketchfab/status
   ```
   Should return `{"success": true, "enabled": true}`

3. **Check Backend Logs**:
   Look for errors in the backend console

### Models Not Loading

1. **Check Network Tab**: Look for failed API requests
2. **Check CORS**: Ensure backend is accessible from frontend
3. **Check Rate Limits**: May need to wait or clear cache
4. **Check API Token**: Verify token is valid

### Viewer Not Working

1. **Check Console**: Look for Sketchfab Viewer API errors
2. **Check Model UID**: Ensure UID is correct
3. **Check Network**: Viewer requires internet connection
4. **Check Iframe**: Ensure iframes are not blocked

### OAuth Not Working

1. **Check Credentials**: Verify Client ID and Secret
2. **Check Redirect URI**: Must match registered URI exactly
3. **Check State Parameter**: Used for CSRF protection
4. **Check Token Storage**: Tokens stored in localStorage

## Sketchfab Branding Guidelines

Per Sketchfab's terms of service:
1. **Logo**: Display Sketchfab logo prominently
2. **Attribution**: Credit model authors
3. **Links**: Link back to Sketchfab model pages
4. **Watermark**: Keep Sketchfab watermark in viewer
5. **Terms**: Follow Sketchfab's terms of service

## Security Considerations

1. **API Credentials**: Store in environment variables, never commit
2. **CSRF Protection**: Use state parameter in OAuth flow
3. **Token Storage**: Tokens stored in localStorage (consider encryption)
4. **Rate Limiting**: Backend enforces rate limits
5. **Input Validation**: All user inputs validated

## Future Enhancements

- [ ] Download integration (link to Sketchfab downloader)
- [ ] Favorites/collections sync
- [ ] Model annotations editing
- [ ] AR mode support
- [ ] Batch operations
- [ ] Advanced search filters
- [ ] Model comparison view
- [ ] Embed code generation

## Support

For issues or questions:
1. Check the [Sketchfab API Documentation](https://docs.sketchfab.com/data-api)
2. Check the [Sketchfab Viewer API Documentation](https://sketchfab.com/developers/viewer)
3. Open an issue on GitHub
4. Contact Sketchfab support for API issues

## License

This integration follows Sketchfab's terms of service and API usage guidelines. Models on Sketchfab have their own licenses - always check model licenses before use.
