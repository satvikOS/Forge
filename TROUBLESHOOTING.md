# 3D Design Generation Troubleshooting Guide

## Overview
This guide helps troubleshoot issues with the 3D design generation and display pipeline in ArchDisc.

## Architecture

### Data Flow
1. **User Input** → User enters prompt in BottomPromptBar
2. **API Request** → App.jsx calls `apiService.generateDesign(prompt)`
3. **Job Creation** → Backend creates job at `/api/generate`
4. **Job Processing** → Backend processes through 4 stages:
   - Stage 1: Analyzing Prompt (Gemini AI extracts specifications)
   - Stage 2: Generating Geometry (Creates 3D model with parts)
   - Stage 3: Refining Model (Applies LOD and optimization)
   - Stage 4: Preparing Exports (Finalizes model data)
5. **Job Polling** → Frontend polls `/api/generate/:jobId` every 1 second
6. **Model Conversion** → `geometryConverter.js` converts backend format to SceneManager objects
7. **3D Rendering** → AdvancedWorkbench adds objects to Three.js scene

### Geometry Data Structure

#### Backend Format (from geometryGenerator.js)
```javascript
{
  type: 'composite',  // or 'object', 'scene'
  parts: [
    {
      type: 'box',
      dimensions: { x: 20000, y: 45000, z: 15000 },  // millimeters
      position: { x: 0, y: 22500, z: 0 },
      material: 'concrete',  // 'glass', 'metal', 'wood', etc.
      detail: 'main_structure'
    },
    // ... more parts
  ],
  subdivisions: 1,
  beveling: 0.05
}
```

#### Frontend Format (SceneManager objects)
```javascript
{
  id: 'AI_Model_part_0_...',
  type: 'box',
  geometry: {
    type: 'box',
    width: 2,      // meters (scaled from 20000mm)
    height: 4.5,   // meters (scaled from 45000mm)
    depth: 1.5     // meters (scaled from 15000mm)
  },
  position: { x: 0, y: 2.25, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  material: {
    color: '#CCCCCC',
    metalness: 0.1,
    roughness: 0.9
  },
  name: 'AI_Model_part_0',
  visible: true,
  userData: { aiGenerated: true, detail: 'main_structure' }
}
```

## Common Issues

### Issue 1: Models Not Appearing on Canvas

**Symptoms:**
- Generation completes successfully
- No 3D model visible in viewport
- Console shows "Converted X objects from model data"

**Possible Causes:**
1. Objects added but positioned outside camera view
2. Objects too small or too large
3. Materials not rendering (transparent/invisible)
4. SceneManager not updating

**Solutions:**
1. Check browser console for conversion messages
2. Try zooming out in the viewport (scroll wheel)
3. Check SceneManager object count in top-left overlay
4. Verify modelData is passed to AdvancedWorkbench:
   ```jsx
   <AdvancedWorkbench modelData={modelData} ... />
   ```

### Issue 2: Generation Times Out

**Symptoms:**
- Loading spinner appears
- Progress stuck at certain percentage
- Error: "Generation timeout - job did not complete in time"

**Possible Causes:**
1. Backend server not running
2. Gemini API key not configured
3. Complex prompt taking too long
4. Network issues

**Solutions:**
1. Check backend server is running: `npm run dev` in backend folder
2. Verify GEMINI_API_KEY in backend/.env
3. Try simpler prompt first: "Create a simple building"
4. Check backend logs for errors
5. Increase timeout in api.js (default: 120 seconds)

### Issue 3: Gemini API Errors

**Symptoms:**
- Error message: "Failed to generate design"
- Backend logs show "Gemini API error"
- Messages about API key or quota

**Solutions:**
1. Verify API key is valid:
   - Check backend/.env has `GEMINI_API_KEY=your_key_here`
   - Test key at: https://aistudio.google.com/apikey
2. Check API quota/rate limits
3. Switch to different model in .env:
   ```
   GEMINI_MODEL=gemini-2.5-pro
   ```
   or
   ```
   GEMINI_MODEL=gemini-1.5-pro
   ```

### Issue 4: Complex Prompts Not Working

**Symptoms:**
- Simple prompts work but complex ones fail
- Generated models missing details
- Unexpected geometry

**Possible Causes:**
1. Gemini not extracting details correctly
2. GeometryGenerator not handling all features
3. Conversion issues

**Solutions:**
1. Check backend logs for AI analysis output
2. Verify specifications include all requested features
3. Test with provided example prompts:
   - "Create a 15-story contemporary office tower with glass curtain walls, ground floor retail, rooftop garden, and underground parking"
4. Break complex requests into simpler parts

### Issue 5: Parts Not Converting Correctly

**Symptoms:**
- Objects appear but wrong size/position
- Materials not applied correctly
- Missing geometry

**Solutions:**
1. Check console for conversion warnings
2. Verify geometry type is supported:
   - Supported: box, sphere, cylinder, cone, plane, torus
3. Check dimensions are reasonable (not 0 or negative)
4. Verify material names match converter mappings

## Debug Mode

### Enable Detailed Logging

**Frontend (browser console):**
```javascript
localStorage.setItem('debug', 'true');
// Reload page
```

**Backend (terminal):**
Backend already logs all stages automatically.

### Check Job Status Manually

```bash
# Create job
curl -X POST http://localhost:5000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Create a simple building"}'

# Check status (replace JOB_ID)
curl http://localhost:5000/api/generate/JOB_ID

# Cancel job
curl -X DELETE http://localhost:5000/api/generate/JOB_ID
```

## Performance Optimization

### Large Models
- Complex buildings may generate 300+ parts
- Browser may slow down with many objects
- Consider simplifying prompts for better performance

### Geometry LOD
Backend automatically applies Level of Detail (LOD):
- objectCount > 100: low detail
- objectCount > 10: medium detail
- objectCount ≤ 10: high detail

## Testing Checklist

When reporting issues, please provide:
- [ ] Browser console errors/warnings
- [ ] Backend terminal output
- [ ] Exact prompt used
- [ ] Expected vs actual behavior
- [ ] Screenshots of UI
- [ ] Network tab (check API requests)

## Getting Help

1. Check this guide first
2. Review backend logs for detailed error messages
3. Test with simple prompts first
4. Check browser console for errors
5. Verify backend server is running
6. Confirm Gemini API key is configured

## Example Test Prompts

### Simple (should work quickly)
- "Create a simple building"
- "Generate a cube"
- "Make a small office building"

### Medium Complexity
- "Create a 5-story office building with windows"
- "Design a modern house with a flat roof"
- "Generate a warehouse with metal walls"

### High Complexity
- "Create a 15-story contemporary office tower with glass curtain walls, ground floor retail, rooftop garden, and underground parking"
- "Design a modern museum with curved glass facade, multiple exhibition halls, central atrium, and outdoor sculpture garden"
- "Generate a residential complex with 5 buildings, varying heights, shared courtyard, and underground parking"
