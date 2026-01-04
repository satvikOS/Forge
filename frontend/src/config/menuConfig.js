// Menu configuration for 3D modeling features
// No software branding - generic 3D modeling terminology only

export const menuConfig = {
  file: {
    label: 'File',
    items: [
      { id: 'new', label: 'New', shortcut: 'Ctrl+N' },
      { id: 'open', label: 'Open', shortcut: 'Ctrl+O' },
      { id: 'save', label: 'Save', shortcut: 'Ctrl+S' },
      { id: 'save-as', label: 'Save As', shortcut: 'Ctrl+Shift+S' },
      { type: 'separator' },
      { id: 'import', label: 'Import', submenu: [
        { id: 'import-obj', label: 'OBJ' },
        { id: 'import-fbx', label: 'FBX' },
        { id: 'import-stl', label: 'STL' },
        { id: 'import-gltf', label: 'glTF/GLB' },
      ]},
      { id: 'export', label: 'Export', submenu: [
        { id: 'export-obj', label: 'OBJ' },
        { id: 'export-fbx', label: 'FBX' },
        { id: 'export-stl', label: 'STL' },
        { id: 'export-gltf', label: 'glTF/GLB' },
      ]},
      { type: 'separator' },
      { id: 'recent', label: 'Recent Files' },
    ]
  },
  
  add: {
    label: 'Add',
    items: [
      { id: 'add-primitives', label: 'Primitives', submenu: [
        { id: 'add-cube', label: 'Cube' },
        { id: 'add-plane', label: 'Plane' },
        { id: 'add-sphere', label: 'Sphere' },
        { id: 'add-icosphere', label: 'Icosphere' },
        { id: 'add-cylinder', label: 'Cylinder' },
        { id: 'add-cone', label: 'Cone' },
        { id: 'add-torus', label: 'Torus' },
        { id: 'add-grid', label: 'Grid' },
        { id: 'add-monkey', label: 'Monkey Head' },
      ]},
      { id: 'add-shapes', label: '2D Shapes', submenu: [
        { id: 'add-rectangle', label: 'Rectangle' },
        { id: 'add-circle', label: 'Circle' },
        { id: 'add-arc', label: 'Arc' },
        { id: 'add-2point-arc', label: '2-Point Arc' },
        { id: 'add-pie', label: 'Pie' },
        { id: 'add-polygon', label: 'Polygon' },
      ]},
      { type: 'separator' },
      { id: 'add-camera', label: 'Camera' },
      { id: 'add-light', label: 'Light' },
      { id: 'add-empty', label: 'Empty' },
    ]
  },
  
  select: {
    label: 'Select',
    items: [
      { id: 'select-box', label: 'Box Select', shortcut: 'B' },
      { id: 'select-circle', label: 'Circle Select', shortcut: 'C' },
      { id: 'select-lasso', label: 'Lasso Select' },
      { type: 'separator' },
      { id: 'select-all', label: 'Select All', shortcut: 'A' },
      { id: 'deselect-all', label: 'Deselect All', shortcut: 'Alt+A' },
      { id: 'invert-selection', label: 'Invert Selection', shortcut: 'Ctrl+I' },
      { type: 'separator' },
      { id: 'select-more', label: 'Select More', shortcut: 'Ctrl++' },
      { id: 'select-less', label: 'Select Less', shortcut: 'Ctrl+-' },
    ]
  },
  
  edit: {
    label: 'Edit',
    items: [
      { id: 'undo', label: 'Undo', shortcut: 'Ctrl+Z' },
      { id: 'redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z' },
      { type: 'separator' },
      { id: 'mesh-ops', label: 'Mesh Operations', submenu: [
        { id: 'extrude', label: 'Extrude', shortcut: 'E' },
        { id: 'inset', label: 'Inset', shortcut: 'I' },
        { id: 'bevel', label: 'Bevel', shortcut: 'Ctrl+B' },
        { id: 'loop-cut', label: 'Loop Cut', shortcut: 'Ctrl+R' },
        { id: 'knife', label: 'Knife', shortcut: 'K' },
        { id: 'subdivide', label: 'Subdivide' },
      ]},
      { id: 'modifiers', label: 'Modifiers', submenu: [
        { id: 'join', label: 'Join', shortcut: 'Ctrl+J' },
        { id: 'separate', label: 'Separate', shortcut: 'P' },
        { id: 'rip', label: 'Rip', shortcut: 'V' },
        { id: 'slide', label: 'Slide', shortcut: 'Shift+V' },
        { id: 'merge', label: 'Merge', shortcut: 'M' },
        { id: 'delete', label: 'Delete', shortcut: 'X' },
        { id: 'dissolve', label: 'Dissolve', shortcut: 'Ctrl+X' },
      ]},
      { id: 'transform', label: 'Transform', submenu: [
        { id: 'move', label: 'Move', shortcut: 'G' },
        { id: 'rotate', label: 'Rotate', shortcut: 'R' },
        { id: 'scale', label: 'Scale', shortcut: 'S' },
        { id: 'mirror', label: 'Mirror' },
        { id: 'array', label: 'Array' },
      ]},
    ]
  },
  
  modeling: {
    label: 'Modeling',
    items: [
      { id: 'modifiers', label: 'Add Modifier', submenu: [
        { id: 'mod-array', label: 'Array' },
        { id: 'mod-boolean', label: 'Boolean' },
        { id: 'mod-mirror', label: 'Mirror' },
        { id: 'mod-subdivision', label: 'Subdivision Surface' },
        { id: 'mod-solidify', label: 'Solidify' },
        { id: 'mod-skin', label: 'Skin' },
        { id: 'mod-displace', label: 'Displace' },
        { id: 'mod-decimate', label: 'Decimate' },
      ]},
      { id: 'tools', label: 'Tools', submenu: [
        { id: 'tool-spin', label: 'Spin' },
        { id: 'tool-screw', label: 'Screw' },
        { id: 'tool-wireframe', label: 'Wireframe' },
        { id: 'tool-voxel-remesh', label: 'Voxel Remesh' },
        { id: 'tool-quadriflow', label: 'QuadriFlow Remesh' },
        { id: 'tool-dyntopo', label: 'Dynamic Topology' },
        { id: 'tool-multiresolution', label: 'Multiresolution' },
      ]},
    ]
  },
  
  materials: {
    label: 'Materials',
    items: [
      { id: 'shaders', label: 'Shader Types', submenu: [
        { id: 'shader-principled', label: 'Principled BSDF' },
        { id: 'shader-glass', label: 'Glass BSDF' },
        { id: 'shader-emission', label: 'Emission' },
        { id: 'shader-subsurface', label: 'Subsurface Scattering' },
      ]},
      { id: 'textures', label: 'Textures', submenu: [
        { id: 'tex-image', label: 'Image Texture' },
        { id: 'tex-noise', label: 'Noise' },
        { id: 'tex-voronoi', label: 'Voronoi' },
        { id: 'tex-musgrave', label: 'Musgrave' },
      ]},
      { id: 'mapping', label: 'UV Mapping', submenu: [
        { id: 'uv-unwrap', label: 'UV Unwrap', shortcut: 'U' },
        { id: 'uv-mark-seam', label: 'Mark Seam' },
        { id: 'uv-smart-project', label: 'Smart UV Project' },
        { id: 'uv-normal-map', label: 'Normal Map' },
        { id: 'uv-bump-map', label: 'Bump Map' },
      ]},
    ]
  },
  
  animation: {
    label: 'Animation',
    items: [
      { id: 'keyframe', label: 'Keyframe', submenu: [
        { id: 'insert-keyframe', label: 'Insert Keyframe', shortcut: 'I' },
        { id: 'auto-keying', label: 'Auto-Keying' },
        { id: 'motion-paths', label: 'Motion Paths' },
      ]},
      { id: 'rigging', label: 'Rigging', submenu: [
        { id: 'add-armature', label: 'Add Armature' },
        { id: 'add-bones', label: 'Add Bones' },
        { id: 'ik-fk', label: 'IK/FK' },
        { id: 'weight-painting', label: 'Weight Painting' },
        { id: 'shape-keys', label: 'Shape Keys' },
      ]},
    ]
  },
  
  render: {
    label: 'Render',
    items: [
      { id: 'engine', label: 'Render Engine', submenu: [
        { id: 'engine-cycles', label: 'Cycles' },
        { id: 'engine-eevee', label: 'Eevee' },
        { id: 'engine-workbench', label: 'Workbench' },
      ]},
      { id: 'settings', label: 'Settings', submenu: [
        { id: 'render-animation', label: 'Render Animation' },
        { id: 'render-volumetrics', label: 'Volumetrics' },
        { id: 'render-motion-blur', label: 'Motion Blur' },
        { id: 'render-bloom', label: 'Bloom' },
        { id: 'render-denoising', label: 'Denoising' },
      ]},
      { id: 'passes', label: 'Passes', submenu: [
        { id: 'render-passes', label: 'Render Passes' },
        { id: 'cryptomatte', label: 'Cryptomatte' },
      ]},
      { type: 'separator' },
      { id: 'render-image', label: 'Render Image', shortcut: 'F12' },
    ]
  },
  
  physics: {
    label: 'Physics',
    items: [
      { id: 'simulations', label: 'Simulations', submenu: [
        { id: 'rigid-body', label: 'Rigid Body' },
        { id: 'cloth', label: 'Cloth' },
        { id: 'soft-body', label: 'Soft Body' },
        { id: 'fluid', label: 'Fluid (Mantaflow)' },
        { id: 'smoke', label: 'Smoke' },
        { id: 'fire', label: 'Fire' },
      ]},
      { id: 'particles', label: 'Particles', submenu: [
        { id: 'particle-emitter', label: 'Emitter' },
        { id: 'particle-hair', label: 'Hair' },
        { id: 'particle-edit', label: 'Particle Edit' },
      ]},
      { id: 'effects', label: 'Effects', submenu: [
        { id: 'dynamic-paint', label: 'Dynamic Paint' },
        { id: 'ocean', label: 'Ocean' },
      ]},
    ]
  },
  
  view: {
    label: 'View',
    items: [
      { id: 'camera-views', label: 'Camera Views', submenu: [
        { id: 'view-top', label: 'Top', shortcut: 'Numpad 7' },
        { id: 'view-bottom', label: 'Bottom', shortcut: 'Ctrl+Numpad 7' },
        { id: 'view-front', label: 'Front', shortcut: 'Numpad 1' },
        { id: 'view-back', label: 'Back', shortcut: 'Ctrl+Numpad 1' },
        { id: 'view-left', label: 'Left', shortcut: 'Ctrl+Numpad 3' },
        { id: 'view-right', label: 'Right', shortcut: 'Numpad 3' },
      ]},
      { id: 'projection', label: 'Projection', submenu: [
        { id: 'proj-parallel', label: 'Parallel', shortcut: 'Numpad 5' },
        { id: 'proj-perspective', label: 'Perspective', shortcut: 'Numpad 5' },
      ]},
      { id: 'viewport-modes', label: 'Viewport Shading', submenu: [
        { id: 'viewport-wireframe', label: 'Wireframe', shortcut: 'Z' },
        { id: 'viewport-solid', label: 'Solid', shortcut: 'Z' },
        { id: 'viewport-material', label: 'Material Preview', shortcut: 'Z' },
        { id: 'viewport-rendered', label: 'Rendered', shortcut: 'Z' },
      ]},
      { type: 'separator' },
      { id: 'toggle-grid', label: 'Toggle Grid' },
      { id: 'toggle-axes', label: 'Toggle Axes' },
      { id: 'frame-selected', label: 'Frame Selected', shortcut: 'Numpad .' },
    ]
  },
};

export const modes = [
  { id: 'object', label: 'Object Mode', icon: '⬡', shortcut: 'Tab' },
  { id: 'edit', label: 'Edit Mode', icon: '▽', shortcut: 'Tab' },
  { id: 'sculpt', label: 'Sculpt Mode', icon: '✋', shortcut: 'Ctrl+Tab' },
  { id: 'vertex-paint', label: 'Vertex Paint', icon: '🎨' },
  { id: 'weight-paint', label: 'Weight Paint', icon: '⚖' },
  { id: 'texture-paint', label: 'Texture Paint', icon: '🖌' },
  { id: 'pose', label: 'Pose Mode', icon: '🦴' },
];

export const tools = {
  object: [
    { id: 'select', label: 'Select', icon: '⬚', shortcut: 'W' },
    { id: 'move', label: 'Move', icon: '✥', shortcut: 'G' },
    { id: 'rotate', label: 'Rotate', icon: '↻', shortcut: 'R' },
    { id: 'scale', label: 'Scale', icon: '⊞', shortcut: 'S' },
  ],
  edit: [
    { id: 'select', label: 'Select', icon: '⬚', shortcut: 'W' },
    { id: 'move', label: 'Move', icon: '✥', shortcut: 'G' },
    { id: 'rotate', label: 'Rotate', icon: '↻', shortcut: 'R' },
    { id: 'scale', label: 'Scale', icon: '⊞', shortcut: 'S' },
    { id: 'extrude', label: 'Extrude', icon: '⇈', shortcut: 'E' },
  ],
  sculpt: [
    { id: 'draw', label: 'Draw', icon: '✏' },
    { id: 'clay', label: 'Clay', icon: '🏺' },
    { id: 'grab', label: 'Grab', icon: '✋' },
    { id: 'smooth', label: 'Smooth', icon: '≈' },
    { id: 'inflate', label: 'Inflate', icon: '◉' },
    { id: 'pinch', label: 'Pinch', icon: '⊲⊳' },
    { id: 'scrape', label: 'Scrape', icon: '▭' },
    { id: 'mask', label: 'Mask', icon: '◐' },
    { id: 'cloth', label: 'Cloth', icon: '〰' },
  ],
};

export const contextMenus = {
  object: [
    { id: 'add', label: 'Add', icon: '+', hasSubmenu: true },
    { type: 'separator' },
    { id: 'delete', label: 'Delete', icon: '×', shortcut: 'X' },
    { id: 'duplicate', label: 'Duplicate', icon: '⧉', shortcut: 'Shift+D' },
    { type: 'separator' },
    { id: 'join', label: 'Join', shortcut: 'Ctrl+J' },
    { id: 'separate', label: 'Separate', shortcut: 'P' },
    { type: 'separator' },
    { id: 'set-origin', label: 'Set Origin', hasSubmenu: true },
    { id: 'shade-smooth', label: 'Shade Smooth' },
    { id: 'shade-flat', label: 'Shade Flat' },
    { type: 'separator' },
    { id: 'convert-to', label: 'Convert To', hasSubmenu: true },
  ],
  edit: [
    { id: 'extrude', label: 'Extrude', icon: '⇈', shortcut: 'E' },
    { id: 'inset', label: 'Inset', icon: '⊟', shortcut: 'I' },
    { id: 'bevel', label: 'Bevel', icon: '◱', shortcut: 'Ctrl+B' },
    { type: 'separator' },
    { id: 'subdivide', label: 'Subdivide' },
    { id: 'loop-cut', label: 'Loop Cut', shortcut: 'Ctrl+R' },
    { type: 'separator' },
    { id: 'merge', label: 'Merge', shortcut: 'M' },
    { id: 'dissolve', label: 'Dissolve', shortcut: 'Ctrl+X' },
    { type: 'separator' },
    { id: 'select-more', label: 'Select More', shortcut: 'Ctrl++' },
    { id: 'select-less', label: 'Select Less', shortcut: 'Ctrl+-' },
    { type: 'separator' },
    { id: 'face-ops', label: 'Face', hasSubmenu: true },
    { id: 'edge-ops', label: 'Edge', hasSubmenu: true },
    { id: 'vertex-ops', label: 'Vertex', hasSubmenu: true },
  ],
  viewport: [
    { id: 'add-object', label: 'Add', icon: '+' },
    { type: 'separator' },
    { id: 'view-options', label: 'View Options', hasSubmenu: true },
    { id: 'camera-settings', label: 'Camera Settings', hasSubmenu: true },
  ],
};
