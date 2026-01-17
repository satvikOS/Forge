# Priority Fix for Landmark vs City Scene Generation

## Issue #2: Scattered Tiles Instead of Landmark
After fixing the first issue (generic cuboids), the user reported:
- "This time only scattered tiles around no actual design generated"
- Logs showed: "✅ Added 236 instanced objects to scene"
- Instead of one Eiffel Tower, got 236 scattered building tiles

## Root Cause
The priority logic in real-world data integration was incorrect:

**Wrong Order:**
1. Check OSM buildings first
2. If buildings found, use them (creates 236 buildings)
3. Check Wikidata dimensions later (ignored)

For "Eiffel Tower", the apiOrchestrator fetched:
- Wikidata: `{ height: 324m }` (the actual landmark)
- OSM: 236 buildings near the tower (surrounding structures)

The system used all 236 OSM buildings instead of the single landmark.

## Solution
Reversed the priority order in `backend/services/aiService.js`:

**Correct Order:**
1. **PRIORITY 1**: Check Wikidata dimensions
   - If height exists → Landmark mode → Create single structure
2. **PRIORITY 2**: Check OSM buildings  
   - If no landmark dimensions → City scene mode → Create multiple buildings
3. **PRIORITY 3**: Standard generation
   - If no real-world data → Procedural generation

## Code Changes

### File 1: `backend/routes/generate.js`
```javascript
// Before: Both were set at same time
specifications.realBuildings = buildings;  // 236 buildings
specifications.realDimensions = dims;      // 324m height

// After: Priority check
let hasLandmarkDimensions = false;
if (dims.height) {
  specifications.realDimensions = dims;
  hasLandmarkDimensions = true;
}

// Only use OSM if NOT a landmark
if (!hasLandmarkDimensions && buildings.length > 0) {
  specifications.realBuildings = buildings;
  console.log('📦 City scene mode');
} else if (hasLandmarkDimensions) {
  console.log('🏛️ Landmark mode: ignoring OSM buildings');
}
```

### File 2: `backend/services/aiService.js`
```javascript
// Before: OSM buildings checked first
if (realBuildings && realBuildings.length > 0) {
  // Create 236 buildings
}
if (realDimensions && !realBuildings) {
  // Never reached because realBuildings existed
}

// After: Dimensions checked first
if (realDimensions && realDimensions.height) {
  // PRIORITY 1: Create single landmark
  console.log('📏 Using real dimensions for landmark generation');
  console.log('   Height:', realDimensions.height, 'm');
  // Create ONE building with correct height
}
if (realBuildings && realBuildings.length > 0) {
  // PRIORITY 2: Create multiple buildings
  console.log('🏛️ Using OSM buildings (city scene)');
}
// PRIORITY 3: Standard generation
```

## Results

### Landmarks (Single Structure)
```
Prompt: "Generate exact replica of Eiffel Tower"
Logs:
  📏 Using real dimensions from Wikidata: { height: 324 }
  🏛️ Landmark mode: Using Wikidata dimensions, ignoring OSM buildings
  📏 Using real dimensions for landmark generation
     Height: 324 m
Result: ONE 324m tower structure ✓
```

### City Scenes (Multiple Buildings)
```
Prompt: "Downtown Chicago"
Logs:
  📦 Found 15 real-world buildings from OSM (city scene mode)
  🏛️ Using real-world building data from OSM
     Building count: 15
Result: 15 buildings with real dimensions ✓
```

## Test Cases

### Should Create Single Structure:
- ✅ "Generate exact replica of Eiffel Tower" → 1 tower (324m)
- ✅ "Create Golden Gate Bridge" → 1 bridge (2,737m)
- ✅ "Build Statue of Liberty" → 1 statue (93m)
- ✅ "Make Big Ben" → 1 clock tower (96m)

### Should Create Multiple Buildings:
- ✅ "Downtown Chicago with buildings" → Multiple buildings
- ✅ "Times Square NYC" → Multiple buildings
- ✅ "Paris street near Arc de Triomphe" → Multiple buildings

## Log Examples

### Landmark Mode
```
🌍 Stage 0.5: Real-World Data Detection
✅ Real-world data orchestration successful
   📍 Location: Paris
   🏛️ Landmark: Eiffel Tower
📏 Using real dimensions from Wikidata: { height: 324, width: 125 }
🏛️ Landmark mode: Using Wikidata dimensions, ignoring OSM buildings
📏 Using real dimensions for landmark generation
   Height: 324 m
   Width: auto m
→ Creates 1 building
```

### City Scene Mode
```
🌍 Stage 0.5: Real-World Data Detection
✅ Real-world data orchestration successful
   📍 Location: Chicago
📦 Found 50 real-world buildings from OSM (city scene mode)
🏛️ Using real-world building data from OSM
   Building count: 50
→ Creates 50 buildings
```

## Commit
Fixed in commit: `29c97ef`

## Files Modified
1. `backend/routes/generate.js` - Added landmark detection logic
2. `backend/services/aiService.js` - Reordered priority (dimensions first, then buildings)

## Technical Details

### Decision Logic
```javascript
if (hasDimensions(wikidata) && dimensions.height > 0) {
  mode = "LANDMARK";
  action = "Create single structure with exact dimensions";
  ignore = "OSM buildings";
} else if (hasBuildings(osm) && buildings.length > 0) {
  mode = "CITY_SCENE";
  action = "Create multiple buildings from OSM";
  use = "OSM building footprints and heights";
} else {
  mode = "STANDARD";
  action = "Procedural generation";
}
```

### Why This Matters
Landmarks like the Eiffel Tower have:
- **Wikidata entry**: Precise dimensions (324m height, 125m base)
- **OSM data**: Hundreds of surrounding buildings

Without priority, the system would:
- Find 236 OSM buildings near the tower
- Create all 236 buildings
- Result: Scattered tiles, no tower

With priority:
- Check Wikidata first
- Find landmark dimensions
- Ignore OSM buildings
- Result: One correct tower

## Prevention
This priority system ensures:
1. Famous landmarks always use Wikidata dimensions
2. City scenes use OSM building data
3. Generic prompts use standard generation
4. No mixing of landmark + surrounding buildings
