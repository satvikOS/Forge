/**
 * Scene Manager - Handles 3D scene objects, hierarchy, and state
 */

export class SceneObject {
  constructor(id, name, type, geometry, material) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.geometry = geometry;
    this.material = material;
    this.position = { x: 0, y: 0, z: 0 };
    this.rotation = { x: 0, y: 0, z: 0 };
    this.scale = { x: 1, y: 1, z: 1 };
    this.visible = true;
    this.locked = false;
    this.parent = null;
    this.children = [];
    this.userData = {};
  }

  setPosition(x, y, z) {
    this.position = { x, y, z };
  }

  setRotation(x, y, z) {
    this.rotation = { x, y, z };
  }

  setScale(x, y, z) {
    this.scale = { x, y, z };
  }

  addChild(child) {
    child.parent = this;
    this.children.push(child);
  }

  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index !== -1) {
      this.children.splice(index, 1);
      child.parent = null;
    }
  }

  clone() {
    const cloned = new SceneObject(
      `${this.id}_clone`,
      `${this.name} (Copy)`,
      this.type,
      { ...this.geometry },
      { ...this.material }
    );
    cloned.position = { ...this.position };
    cloned.rotation = { ...this.rotation };
    cloned.scale = { ...this.scale };
    cloned.visible = this.visible;
    cloned.userData = { ...this.userData };
    return cloned;
  }
}

export class SceneManager {
  constructor() {
    this.objects = new Map();
    this.objectIdCounter = 0;
    this.selectedObjects = new Set();
    this.layers = new Map();
    this.activeLayer = 'default';
    this.historyStack = [];
    this.historyIndex = -1;
    this.maxHistory = 50;

    // Design group tracking for multiple designs (Issue #27)
    this.designGroups = new Map(); // designId -> { objects: [], bounds: {}, metadata: {} }
    this.designIdCounter = 0;

    // Create default layer
    this.createLayer('default', 'Default Layer');
  }

  // Object Management
  addObject(object, skipStateRecording = false) {
    this.objects.set(object.id, object);
    if (!skipStateRecording) {
      this.saveState();
    }
    return object;
  }

  removeObject(objectId) {
    const object = this.objects.get(objectId);
    if (object) {
      // Remove from parent if it has one
      if (object.parent && typeof object.parent.removeChild === 'function') {
        object.parent.removeChild(object);
      }
      // Remove all children (only if children array exists)
      if (object.children && Array.isArray(object.children)) {
        object.children.forEach(child => this.removeObject(child.id));
      }
      // Remove from scene
      this.objects.delete(objectId);
      this.selectedObjects.delete(objectId);
      this.saveState();
      return true;
    }
    return false;
  }

  getObject(objectId) {
    return this.objects.get(objectId);
  }

  getAllObjects() {
    return Array.from(this.objects.values());
  }

  getObjectsByType(type) {
    return this.getAllObjects().filter(obj => obj.type === type);
  }

  createObject(name, type, geometry, material = null) {
    const id = `obj_${this.objectIdCounter++}`;
    const defaultMaterial = material || {
      color: '#4a90e2',
      metalness: 0.3,
      roughness: 0.7,
    };
    const object = new SceneObject(id, name, type, geometry, defaultMaterial);
    return this.addObject(object);
  }

  // Selection Management
  selectObject(objectId, mode = 'replace') {
    if (mode === 'replace') {
      this.selectedObjects.clear();
    }

    if (mode === 'toggle') {
      if (this.selectedObjects.has(objectId)) {
        this.selectedObjects.delete(objectId);
      } else {
        this.selectedObjects.add(objectId);
      }
    } else {
      this.selectedObjects.add(objectId);
    }
  }

  deselectObject(objectId) {
    this.selectedObjects.delete(objectId);
  }

  deselectAll() {
    this.selectedObjects.clear();
  }

  getSelectedObjects() {
    return Array.from(this.selectedObjects).map(id => this.getObject(id)).filter(Boolean);
  }

  isSelected(objectId) {
    return this.selectedObjects.has(objectId);
  }

  selectAll() {
    this.objects.forEach((obj, id) => {
      if (!obj.locked) {
        this.selectedObjects.add(id);
      }
    });
  }

  invertSelection() {
    const allIds = Array.from(this.objects.keys());
    const newSelection = new Set();
    allIds.forEach(id => {
      const obj = this.objects.get(id);
      if (!obj.locked && !this.selectedObjects.has(id)) {
        newSelection.add(id);
      }
    });
    this.selectedObjects = newSelection;
  }

  // Layer Management
  createLayer(id, name) {
    this.layers.set(id, {
      id,
      name,
      visible: true,
      locked: false,
      objects: new Set(),
    });
  }

  deleteLayer(id) {
    if (id === 'default') return false; // Can't delete default layer
    const layer = this.layers.get(id);
    if (layer) {
      // Move objects to default layer
      layer.objects.forEach(objId => {
        const defaultLayer = this.layers.get('default');
        defaultLayer.objects.add(objId);
      });
      this.layers.delete(id);
      if (this.activeLayer === id) {
        this.activeLayer = 'default';
      }
      return true;
    }
    return false;
  }

  setActiveLayer(id) {
    if (this.layers.has(id)) {
      this.activeLayer = id;
      return true;
    }
    return false;
  }

  addObjectToLayer(objectId, layerId) {
    const layer = this.layers.get(layerId);
    if (layer) {
      layer.objects.add(objectId);
    }
  }

  // History Management (Undo/Redo)
  saveState() {
    const state = {
      objects: new Map(this.objects),
      selectedObjects: new Set(this.selectedObjects),
    };

    // Remove future states if we're not at the end
    if (this.historyIndex < this.historyStack.length - 1) {
      this.historyStack = this.historyStack.slice(0, this.historyIndex + 1);
    }

    this.historyStack.push(state);

    // Limit history size
    if (this.historyStack.length > this.maxHistory) {
      this.historyStack.shift();
    } else {
      this.historyIndex++;
    }
  }

  undo() {
    if (this.historyIndex > 0) {
      this.historyIndex--;
      const state = this.historyStack[this.historyIndex];
      this.objects = new Map(state.objects);
      this.selectedObjects = new Set(state.selectedObjects);
      return true;
    }
    return false;
  }

  redo() {
    if (this.historyIndex < this.historyStack.length - 1) {
      this.historyIndex++;
      const state = this.historyStack[this.historyIndex];
      this.objects = new Map(state.objects);
      this.selectedObjects = new Set(state.selectedObjects);
      return true;
    }
    return false;
  }

  canUndo() {
    return this.historyIndex > 0;
  }

  canRedo() {
    return this.historyIndex < this.historyStack.length - 1;
  }

  // Utility Methods
  duplicateSelected() {
    const duplicates = [];
    this.getSelectedObjects().forEach(obj => {
      const clone = obj.clone();
      clone.position.x += 0.5; // Offset slightly
      this.addObject(clone);
      duplicates.push(clone);
    });

    // Select the duplicates
    this.deselectAll();
    duplicates.forEach(obj => this.selectObject(obj.id, 'add'));

    return duplicates;
  }

  deleteSelected() {
    const toDelete = Array.from(this.selectedObjects);
    toDelete.forEach(id => this.removeObject(id));
  }

  clear() {
    this.objects.clear();
    this.selectedObjects.clear();
    this.objectIdCounter = 0;
    this.historyStack = [];
    this.historyIndex = -1;
  }

  // Design Group Management (Issue #27)
  /**
   * Add a design group to the scene
   * @param {string} designId - Unique identifier for the design
   * @param {Array} objects - Array of scene objects belonging to this design
   * @param {Object} position - Position offset {x, y, z}
   * @param {Object} metadata - Design metadata (prompt, timestamp, etc.)
   * @returns {Object} Design group info
   */
  addDesignGroup(designId, objects, position = { x: 0, y: 0, z: 0 }, metadata = {}) {
    // Apply position offset to all objects
    objects.forEach(obj => {
      obj.position.x += position.x;
      obj.position.y += position.y;
      obj.position.z += position.z;

      // Mark object as part of this design group
      obj.userData = obj.userData || {};
      obj.userData.designId = designId;

      // Add to scene without recording state for each object (performance optimization)
      this.addObject(obj, true);
    });

    // Calculate bounds
    const bounds = this.calculateDesignBounds(objects);

    // Store design group
    const designGroup = {
      id: designId,
      objects: objects.map(obj => obj.id),
      position,
      bounds,
      metadata: {
        ...metadata,
        timestamp: Date.now(),
      },
    };

    this.designGroups.set(designId, designGroup);

    console.log(`Added design group ${designId} with ${objects.length} objects`);

    // Save state once after all objects are added
    this.saveState();

    return designGroup;
  }

  /**
   * Get bounding box for a design group
   * @param {Array} objects - Array of scene objects
   * @returns {Object} Bounds {min, max, center, size}
   */
  calculateDesignBounds(objects) {
    if (!objects || objects.length === 0) {
      return {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 0, y: 0, z: 0 },
        center: { x: 0, y: 0, z: 0 },
        size: { x: 0, y: 0, z: 0 },
      };
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

    objects.forEach(obj => {
      if (!obj.position) return;

      const { x, y, z } = obj.position;
      const geom = obj.geometry || {};

      // Estimate object bounds based on geometry
      const halfWidth = (geom.width || 1) / 2;
      const halfHeight = (geom.height || 1) / 2;
      const halfDepth = (geom.depth || 1) / 2;

      minX = Math.min(minX, x - halfWidth);
      minY = Math.min(minY, y - halfHeight);
      minZ = Math.min(minZ, z - halfDepth);

      maxX = Math.max(maxX, x + halfWidth);
      maxY = Math.max(maxY, y + halfHeight);
      maxZ = Math.max(maxZ, z + halfDepth);
    });

    const min = { x: minX, y: minY, z: minZ };
    const max = { x: maxX, y: maxY, z: maxZ };
    const center = {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    };
    const size = {
      x: maxX - minX,
      y: maxY - minY,
      z: maxZ - minZ,
    };

    return { min, max, center, size };
  }

  /**
   * Get all design groups
   * @returns {Array} Array of design groups
   */
  getAllDesigns() {
    return Array.from(this.designGroups.values());
  }

  /**
   * Get a specific design group
   * @param {string} designId - Design identifier
   * @returns {Object|null} Design group or null if not found
   */
  getDesignGroup(designId) {
    return this.designGroups.get(designId);
  }

  /**
   * Remove a design group and all its objects
   * @param {string} designId - Design identifier
   * @returns {boolean} True if removed successfully
   */
  removeDesignGroup(designId) {
    const design = this.designGroups.get(designId);
    if (!design) return false;

    // Remove all objects in this design
    design.objects.forEach(objId => {
      this.removeObject(objId);
    });

    // Remove design group
    this.designGroups.delete(designId);

    console.log(`Removed design group ${designId}`);
    return true;
  }

  /**
   * Generate a unique design ID
   * @returns {string} Unique design ID
   */
  generateDesignId() {
    return `design_${this.designIdCounter++}_${Date.now()}`;
  }
}

export default SceneManager;
