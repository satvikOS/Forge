# ArchDisc 3D Editor - Feature Documentation

## Overview

ArchDisc now includes a comprehensive 3D editor with professional-grade tools for architectural design. This document provides an overview of all available tools and features.

## Getting Started

### Mode Toggle

Switch between two modes using the toggle in the header:
- **AI Mode**: Generate designs from natural language prompts
- **3D Editor**: Manual 3D modeling with professional tools

### Interface Layout

When in 3D Editor mode, the interface consists of:
- **Left Sidebar**: Tool categories (collapsible)
- **Top Toolbar**: Quick actions and view controls
- **Center Viewport**: 3D scene with interactive controls
- **Left Panel**: Scene hierarchy (objects tree)
- **Right Panel**: Properties and analysis
- **File Menu**: Save, load, and export options

## Tool Categories

### Selection Tools

Select and manipulate objects in the scene:

- **Select (S)**: Click to select individual objects
- **Box Select (B)**: Drag to select multiple objects in a rectangular area
- **Circle Select (C)**: Select objects within a circular area
- **Select All (A)**: Select all objects in the scene
- **Invert Selection (I)**: Invert the current selection

**Multi-selection:**
- Hold **Shift** + Click: Add to selection
- Hold **Ctrl** + Click: Remove from selection

### Transform Tools

Move, rotate, and scale objects:

- **Move/Grab (G)**: Move selected objects
  - Press **X**, **Y**, or **Z** to lock to an axis
  - Press **Shift** to enable snapping
- **Rotate (R)**: Rotate selected objects
  - Press **X**, **Y**, or **Z** to lock to an axis
- **Scale (S)**: Scale selected objects uniformly or per-axis
  - Press **X**, **Y**, or **Z** to scale on one axis only

**Tips:**
- Press **Escape** to cancel any transform operation
- Press **Enter** to confirm the operation
- Mouse movement controls the amount of transformation

### Mesh Primitives

Add basic 3D shapes to your scene:

- **Cube**: Standard box primitive
- **Sphere**: UV sphere with configurable segments
- **Cylinder**: Cylindrical shape
- **Cone**: Conical shape
- **Plane**: Flat surface
- **Torus**: Donut shape
- **Ico Sphere**: Icosahedron-based sphere
- **Circle**: Circular flat shape
- **Grid**: Grid mesh for terrain

### Modeling Tools

Edit and modify 3D geometry:

- **Extrude (E)**: Extend faces outward
- **Push/Pull (P)**: SketchUp-style face manipulation
- **Bevel (Ctrl+B)**: Round edges and corners
  - Use **+/-** keys to adjust bevel amount
- **Subdivide**: Add more geometry detail
- **Duplicate (Shift+D)**: Copy selected objects
- **Mirror (Ctrl+M)**: Create mirrored copies
  - Press **X**, **Y**, or **Z** to choose mirror axis
- **Delete (Del)**: Remove selected objects

### Drawing Tools

Create 2D shapes that can be extruded:

- **Line (L)**: Draw straight lines between points
  - Click to place first point
  - Click again to place second point
- **Rectangle (Shift+R)**: Draw rectangles
  - Click and drag to define the rectangle
- **Circle (Shift+C)**: Draw circles
  - Click to set center
  - Drag to set radius
- **Polygon (Shift+P)**: Draw custom polygons
  - Click to add points
  - Press **Enter** or **Right-click** to finish
  - Press **Escape** to cancel

All drawing tools snap to the ground plane (Y=0) by default.

### Measurement Tools

Measure distances, angles, areas, and volumes:

- **Tape Measure (M)**: Measure distance between two points
  - Click first point, then click second point
  - Measurement appears as a line with distance label
  - Press **C** to clear all measurements
- **Protractor**: Measure angles
  - Click three points: first arm, vertex, second arm
  - Angle is displayed in degrees
- **Dimension**: Add permanent dimension annotations
  - Similar to Tape Measure but creates persistent objects
- **Area Calculator**: Calculate surface area of selected objects
- **Volume Calculator**: Calculate volume of selected objects

### Camera Tools

Control the view and camera:

- **Top View**: View from directly above
- **Front View**: View from the front
- **Side View**: View from the side
- **Perspective**: Default 3D perspective view
- **Focus (F)**: Center camera on selected objects
- **Frame All (Home)**: Fit all objects in view

**Navigation:**
- **Middle Mouse + Drag**: Orbit camera
- **Right Mouse + Drag**: Pan view
- **Mouse Wheel**: Zoom in/out
- **Shift + Middle Mouse**: Pan (alternative)

### Lights

Add lighting to your scene:

- **Point Light**: Omnidirectional light source
- **Directional Light**: Sunlight-like directional lighting
- **Spot Light**: Focused cone of light
- **Area Light**: Rectangular area light

### Camera Objects

- **Add Camera**: Add a camera object to the scene
  - Can be used for rendering from specific viewpoints

## Scene Management

### Scene Hierarchy Panel

The left panel shows all objects in your scene:

- **Search**: Filter objects by name
- **Visibility Toggle (👁️)**: Show/hide objects
- **Lock Toggle (🔒)**: Lock objects to prevent editing
- **Tree Structure**: Parent-child relationships

Click any object to select it. Selected objects are highlighted in orange.

### Undo/Redo

- **Ctrl+Z**: Undo last action
- **Ctrl+Shift+Z**: Redo
- Up to 50 levels of undo history

## File Operations

### Save Project

Click **💾 Save** to save your project as a `.archdisc` file (JSON format).

### Load Project

Click **📁 Load** to open a saved project file.

### Export

Click **📤 Export** to export your scene to various formats:

- **OBJ**: Wavefront OBJ format (widely compatible)
- **STL**: STL format (for 3D printing)
- **GLTF**: glTF 2.0 format (modern web standard)
- **GLB**: Binary glTF format (single file)

## Material System

The material system allows you to customize the appearance of objects:

### Material Library

- 10+ built-in material presets
- Categories: Architectural, Automotive, Furniture
- Examples: Glass, Metal, Wood, Concrete, Plastic

### Material Editor

Access via the **Materials** tab in the right panel:

1. **Library Tab**: Browse and select materials
2. **Properties Tab**: Customize material properties
   - Base Color
   - Metalness
   - Roughness
   - Opacity
   - And more...

3. **Apply to Selection**: Click to apply material to selected objects

## Modifier System

Modifiers allow non-destructive editing:

- **Array**: Create patterns of duplicated objects
- **Mirror**: Mirror geometry across an axis
- **Boolean**: Union, subtract, or intersect objects
- **Subdivision Surface**: Smooth subdivision
- **Bevel**: Round edges
- **Solidify**: Add thickness to surfaces
- **Displace**: Displace vertices
- **Solidify**: Add thickness

Modifiers are applied in stack order and can be reordered.

## Keyboard Shortcuts Reference

### Selection
- `S` - Select tool
- `B` - Box select
- `C` - Circle select
- `A` or `Ctrl+A` - Select all
- `I` - Invert selection

### Transform
- `G` - Move/Grab
- `R` - Rotate
- `S` - Scale
- `X/Y/Z` - Lock to axis (after G/R/S)
- `Shift+D` - Duplicate
- `Ctrl+M` - Mirror
- `Delete` - Delete selected

### Modeling
- `E` - Extrude
- `P` - Push/Pull
- `Ctrl+B` - Bevel
- `+/-` - Adjust parameter

### Drawing
- `L` - Line tool
- `Shift+R` - Rectangle tool
- `Shift+C` - Circle tool
- `Shift+P` - Polygon tool
- `Enter` - Finish drawing
- `Right Click` - Finish drawing

### Measurement
- `M` - Tape measure
- `C` - Clear measurements (in tool)

### Camera
- `F` - Focus on selection
- `Home` - Frame all objects

### Editing
- `Ctrl+Z` - Undo
- `Ctrl+Shift+Z` - Redo
- `Escape` - Cancel operation

### Help
- `F1` or Click **❓ Help** - Open help panel

## Tips & Best Practices

1. **Use keyboard shortcuts** for faster workflow
2. **Save frequently** to avoid losing work
3. **Organize objects** using meaningful names
4. **Use layers** to manage complex scenes
5. **Lock objects** you don't want to accidentally modify
6. **Use Focus (F)** to quickly navigate to selected objects
7. **Hold Shift** when transforming to enable snapping
8. **Press Escape** to cancel any operation
9. **Use Box Select (B)** for quickly selecting multiple objects
10. **Check measurements** before exporting for fabrication

## Troubleshooting

### Objects not visible
- Check visibility (👁️) in scene hierarchy
- Objects may be outside camera view - use Frame All (Home)

### Can't select objects
- Check if objects are locked (🔒)
- Make sure you're in Select mode (S)

### Transform not working
- Ensure objects are selected
- Check if axis lock is active (press X/Y/Z again to unlock)

### Export issues
- Ensure all objects are visible
- Complex scenes may take time to export
- Try different export formats if one doesn't work

## Support

For issues or feature requests, please open an issue on the GitHub repository.

## Version

This documentation is for ArchDisc 3D Editor v1.0.0

---

**Enjoy creating amazing 3D architectural designs with ArchDisc!** 🎨🏗️
