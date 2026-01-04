/**
 * Core Tool System - Base architecture for all 3D design tools
 * Provides base classes and interfaces for implementing Blender/SketchUp-style tools
 */

export class Tool {
  constructor(id, name, icon, description, category, shortcut = null) {
    this.id = id;
    this.name = name;
    this.icon = icon;
    this.description = description;
    this.category = category;
    this.shortcut = shortcut;
    this.isActive = false;
  }

  // Lifecycle methods
  onActivate(context) {
    this.isActive = true;
  }

  onDeactivate(context) {
    this.isActive = false;
  }

  // Event handlers
  onMouseDown(event, context) {}
  onMouseMove(event, context) {}
  onMouseUp(event, context) {}
  onClick(event, context) {}
  onKeyDown(event, context) {}
  onKeyUp(event, context) {}

  // Rendering
  render(context) {}

  // Tool-specific settings
  getSettings() {
    return {};
  }

  updateSettings(settings) {}
}

export class SelectionTool extends Tool {
  constructor(id, name, icon, description, shortcut = null) {
    super(id, name, icon, description, 'selection', shortcut);
    this.selectedObjects = new Set();
    this.selectionMode = 'replace'; // 'replace', 'add', 'subtract'
  }

  selectObject(object, mode = 'replace') {
    if (mode === 'replace') {
      this.selectedObjects.clear();
      this.selectedObjects.add(object);
    } else if (mode === 'add') {
      this.selectedObjects.add(object);
    } else if (mode === 'subtract') {
      this.selectedObjects.delete(object);
    }
  }

  selectMultiple(objects, mode = 'replace') {
    if (mode === 'replace') {
      this.selectedObjects.clear();
    }
    objects.forEach(obj => {
      if (mode === 'subtract') {
        this.selectedObjects.delete(obj);
      } else {
        this.selectedObjects.add(obj);
      }
    });
  }

  deselectAll() {
    this.selectedObjects.clear();
  }

  getSelected() {
    return Array.from(this.selectedObjects);
  }

  isSelected(object) {
    return this.selectedObjects.has(object);
  }
}

export class TransformTool extends Tool {
  constructor(id, name, icon, description, shortcut = null) {
    super(id, name, icon, description, 'transform', shortcut);
    this.transformMode = 'global'; // 'global', 'local'
    this.axisLock = null; // null, 'x', 'y', 'z'
    this.snapEnabled = false;
    this.snapValue = 1.0;
  }

  setAxisLock(axis) {
    this.axisLock = axis;
  }

  toggleSnap() {
    this.snapEnabled = !this.snapEnabled;
  }

  snapToGrid(value) {
    if (!this.snapEnabled) return value;
    return Math.round(value / this.snapValue) * this.snapValue;
  }
}

export class ModelingTool extends Tool {
  constructor(id, name, icon, description, shortcut = null) {
    super(id, name, icon, description, 'modeling', shortcut);
  }
}

export class ToolManager {
  constructor() {
    this.tools = new Map();
    this.activeTool = null;
    this.defaultTool = null;
    this.context = null;
  }

  registerTool(tool) {
    this.tools.set(tool.id, tool);
  }

  setDefaultTool(toolId) {
    this.defaultTool = toolId;
  }

  activateTool(toolId, context) {
    // Deactivate current tool
    if (this.activeTool) {
      const currentTool = this.tools.get(this.activeTool);
      if (currentTool) {
        currentTool.onDeactivate(context);
      }
    }

    // Activate new tool
    const newTool = this.tools.get(toolId);
    if (newTool) {
      this.activeTool = toolId;
      this.context = context;
      newTool.onActivate(context);
      return true;
    }
    return false;
  }

  deactivateTool(context) {
    if (this.activeTool) {
      const tool = this.tools.get(this.activeTool);
      if (tool) {
        tool.onDeactivate(context);
      }
      this.activeTool = null;
    }
  }

  getActiveTool() {
    return this.activeTool ? this.tools.get(this.activeTool) : null;
  }

  getTool(toolId) {
    return this.tools.get(toolId);
  }

  getToolsByCategory(category) {
    return Array.from(this.tools.values()).filter(tool => tool.category === category);
  }

  getAllTools() {
    return Array.from(this.tools.values());
  }

  handleEvent(eventType, event, context) {
    const tool = this.getActiveTool();
    if (!tool) return;

    switch (eventType) {
      case 'mousedown':
        tool.onMouseDown(event, context);
        break;
      case 'mousemove':
        tool.onMouseMove(event, context);
        break;
      case 'mouseup':
        tool.onMouseUp(event, context);
        break;
      case 'click':
        tool.onClick(event, context);
        break;
      case 'keydown':
        tool.onKeyDown(event, context);
        break;
      case 'keyup':
        tool.onKeyUp(event, context);
        break;
    }
  }
}

export default ToolManager;
