# Testing Guide for 3D Design Generation Pipeline

## Overview
This guide provides manual testing steps to verify the complete 3D design generation and display pipeline.

## Prerequisites

1. **Backend Setup**
   ```bash
   cd backend
   npm install
   # Create .env file with GEMINI_API_KEY
   echo "GEMINI_API_KEY=your_gemini_api_key_here" > .env
   npm start
   ```
   Backend should be running on http://localhost:5000

2. **Frontend Setup**
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Frontend should be running on http://localhost:5173

## Test Cases

### Test 1: Simple Building Generation

**Objective:** Verify basic generation flow works end-to-end

**Steps:**
1. Open browser to http://localhost:5173
2. In the bottom prompt bar, enter: `Create a simple office building`
3. Click Generate or press Enter

**Expected Results:**
- Loading spinner appears immediately
- Progress bar shows with stages: analyzing → generating → refining → exporting
- Progress updates smoothly (0% → 100%)
- After completion (10-30 seconds):
  - 3D model appears in viewport
  - Can rotate/zoom the model with mouse
  - Model has basic structure (walls, floors)
  - Top-left info shows "Objects: X" count increased

**Screenshot Points:**
- Initial state (before generation)
- During generation (progress at ~50%)
- Final result (3D model visible)

### Test 2: Complex Building with Details

**Objective:** Verify enhanced architectural details are generated

**Prompt:**
```
Create a 15-story contemporary office tower with glass curtain walls, ground floor retail, rooftop garden, and underground parking
```

**Expected Results:**
- Generation takes 15-45 seconds
- Generated model includes:
  - Main building structure
  - Glass curtain wall panels (300+)
  - Floor slabs (14 layers)
  - Window frames/mullions
  - Entrance canopy and pillars
  - Rooftop parapet and mechanical penthouse
  - Structural columns (16)
  - Underground parking indicator
- Total parts: ~350 objects
- Different materials visible (glass is blue-tinted, concrete is gray, metal is darker)

**Verification:**
- Check browser console for: "Adding X objects to scene"
- Top-left overlay shows large object count
- Model has visible detail when zoomed in

### Test 3: Museum with Curved Features

**Prompt:**
```
Design a modern museum with curved glass facade, multiple exhibition halls, central atrium, and outdoor sculpture garden
```

**Expected Results:**
- AI understands complex architectural terms
- Model includes:
  - Large main structure
  - Glass facade panels
  - Multiple internal spaces indicated by floor divisions
  - Entrance features
- Renders successfully on canvas

### Test 4: Progress Tracking and Cancellation

**Objective:** Verify UI feedback works correctly

**Steps:**
1. Enter a complex prompt
2. Click Generate
3. Observe progress bar updating
4. Watch stage indicators change color:
   - Gray = pending
   - Orange = in progress
   - Green = completed
5. (Optional) Click "Cancel" button before completion

**Expected Results:**
- Progress bar animates smoothly
- Stage names display correctly
- Cancel button works (if clicked):
  - Generation stops
  - Error message: "Generation cancelled"
  - No model appears

### Test 5: Multiple Generations

**Objective:** Verify previous AI models are cleared

**Steps:**
1. Generate first model: `Create a 5-story building`
2. Wait for completion and verify it appears
3. Generate second model: `Create a 10-story tower`
4. Wait for completion

**Expected Results:**
- First model is removed from scene
- Second model replaces it
- Object count resets appropriately
- No duplicate objects

### Test 6: Error Handling

**Test 6a: No Backend**
1. Stop backend server
2. Try to generate a design

**Expected:** Error message displayed, no infinite loading

**Test 6b: Invalid API Key**
1. Set invalid GEMINI_API_KEY in backend/.env
2. Restart backend
3. Try to generate a design

**Expected:** Error message about API failure

**Test 6c: Complex Prompt Timeout**
1. Enter very complex prompt: `Create an entire city with 50 skyscrapers, parks, roads, and infrastructure`
2. Wait

**Expected:** Either completes (may take longer) or shows timeout error after 2 minutes

## Performance Testing

### Test P1: Generation Speed

**Simple Building (3-5 floors):**
- Expected: 10-20 seconds
- Stages breakdown:
  - Analyzing: 2-5 seconds
  - Generating: 3-8 seconds
  - Refining: 2-4 seconds
  - Exporting: 1-2 seconds

**Complex Building (10-20 floors):**
- Expected: 20-45 seconds
- More time in generating stage due to detail

### Test P2: Rendering Performance

**Metrics to Check:**
- Browser console: Check for "X objects converted"
- Frame rate: Should stay above 30 FPS
- Interaction: Smooth rotation/zoom even with 300+ objects

**If Performance Issues:**
- Check console for errors
- Verify GPU acceleration is enabled
- Try simpler prompts first

## Browser Console Checks

### During Generation:
```
Starting generation job with prompt: ...
Generation job started, jobId: ...
Generation progress: { status: 'analyzing', progress: 10, ... }
Job completed successfully: ...
```

### During Conversion:
```
Received model data in AdvancedWorkbench: ...
Converting composite model with X parts
Adding X objects to scene
AI model added to scene successfully
```

### Look For:
- No JavaScript errors
- Progress updates logging
- Successful conversion messages

## Network Tab Verification

1. Open browser DevTools → Network tab
2. Start generation
3. Verify requests:
   - POST `/api/generate` → Returns jobId
   - Multiple GET `/api/generate/:jobId` → Returns progress
   - Final GET returns completed job with model data

## Visual Regression Testing

Compare screenshots with expected results:

1. **Simple Building**: Box-like structure with basic detail
2. **Complex Tower**: Tall structure with visible glass panels, columns
3. **Museum**: Wide, lower structure with detailed facade

## Known Limitations

1. **Scaling**: Very complex prompts (>50 buildings) may timeout
2. **Detail Level**: Some fine details may not be visible at default zoom
3. **Materials**: All materials use standard colors, no textures
4. **Performance**: 500+ objects may cause slowdown on lower-end devices

## Reporting Issues

When reporting bugs, include:
1. Exact prompt used
2. Browser console output
3. Backend terminal output
4. Screenshots of UI state
5. Expected vs actual behavior
6. Browser version and OS

## Success Criteria

The pipeline is working correctly if:
- ✅ Simple prompts generate in <30 seconds
- ✅ Models appear on canvas immediately after generation
- ✅ Progress bar updates smoothly
- ✅ Complex architectural prompts generate detailed models
- ✅ Object counts match expectations (300+ for complex buildings)
- ✅ Models can be rotated and zoomed
- ✅ No console errors during normal operation
- ✅ Previous models are cleared when generating new ones

## Automated Testing (Future)

To add automated tests:
1. Use Jest for unit tests of converter functions
2. Use Playwright for E2E tests of generation flow
3. Mock API responses for consistent testing
4. Add visual regression tests with screenshots
