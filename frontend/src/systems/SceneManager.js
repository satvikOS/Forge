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
    
    // Create default layer
    this.createLayer('default', 'Default Layer');
  }

  // Object Management
  addObject(object) {
    this.objects.set(object.id, object);
    this.saveState();
    return object;
  }

  removeObject(objectId) {
    const object = this.objects.get(objectId);
    if (object) {
      // Remove from parent if it has one
      if (object.parent) {
        object.parent.removeChild(object);
      }
      // Remove all children
      object.children.forEach(child => this.removeObject(child.id));
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
}

export default SceneManager;
