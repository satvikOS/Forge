/**
 * Modifier System - Blender-style modifiers for non-destructive editing
 */

export class Modifier {
  constructor(id, name, type) {
    this.id = id;
    this.name = name;
    this.type = type;
    this.enabled = true;
    this.parameters = {};
  }

  apply(geometry, object) {
    // Override in subclasses
    return geometry;
  }

  getParameters() {
    return this.parameters;
  }

  setParameter(key, value) {
    this.parameters[key] = value;
  }
}

// Array Modifier - Duplicate objects in patterns
export class ArrayModifier extends Modifier {
  constructor() {
    super('array', 'Array', 'array');
    this.parameters = {
      count: 3,
      offsetX: 2,
      offsetY: 0,
      offsetZ: 0,
      relativeOffset: true,
    };
  }

  apply(geometry, object) {
    // Returns array of transformations to apply
    const instances = [];
    for (let i = 0; i < this.parameters.count; i++) {
      instances.push({
        position: {
          x: object.position.x + (this.parameters.offsetX * i),
          y: object.position.y + (this.parameters.offsetY * i),
          z: object.position.z + (this.parameters.offsetZ * i),
        },
        rotation: { ...object.rotation },
        scale: { ...object.scale },
      });
    }
    return { instances };
  }
}

// Mirror Modifier - Mirror geometry across an axis
export class MirrorModifier extends Modifier {
  constructor() {
    super('mirror', 'Mirror', 'mirror');
    this.parameters = {
      axis: 'x', // 'x', 'y', or 'z'
      merge: true,
      mergeThreshold: 0.001,
    };
  }

  apply(geometry, object) {
    return {
      mirrored: true,
      axis: this.parameters.axis,
      merge: this.parameters.merge,
    };
  }
}

// Boolean Modifier - Union, Intersect, Subtract operations
export class BooleanModifier extends Modifier {
  constructor() {
    super('boolean', 'Boolean', 'boolean');
    this.parameters = {
      operation: 'union', // 'union', 'subtract', 'intersect'
      targetObjectId: null,
    };
  }

  apply(geometry, object) {
    return {
      operation: this.parameters.operation,
      targetObjectId: this.parameters.targetObjectId,
    };
  }
}

// Subdivision Surface Modifier - Smooth subdivision
export class SubdivisionSurfaceModifier extends Modifier {
  constructor() {
    super('subdivision', 'Subdivision Surface', 'subdivision');
    this.parameters = {
      levels: 1,
      renderLevels: 2,
      subdivisionType: 'catmull-clark', // 'catmull-clark' or 'simple'
    };
  }

  apply(geometry, object) {
    return {
      subdivisions: this.parameters.levels,
      type: this.parameters.subdivisionType,
    };
  }
}

// Bevel Modifier - Bevel edges
export class BevelModifier extends Modifier {
  constructor() {
    super('bevel', 'Bevel', 'bevel');
    this.parameters = {
      amount: 0.1,
      segments: 2,
      limitMethod: 'none', // 'none', 'angle', 'weight'
      angle: 30,
    };
  }

  apply(geometry, object) {
    return {
      bevel: {
        amount: this.parameters.amount,
        segments: this.parameters.segments,
      },
    };
  }
}

// Solidify Modifier - Add thickness to surface
export class SolidifyModifier extends Modifier {
  constructor() {
    super('solidify', 'Solidify', 'solidify');
    this.parameters = {
      thickness: 0.1,
      offset: 0, // -1 to 1
      evenThickness: true,
    };
  }

  apply(geometry, object) {
    return {
      thickness: this.parameters.thickness,
      offset: this.parameters.offset,
    };
  }
}

// Displace Modifier - Displace vertices
export class DisplaceModifier extends Modifier {
  constructor() {
    super('displace', 'Displace', 'displace');
    this.parameters = {
      strength: 0.5,
      direction: 'normal', // 'normal', 'x', 'y', 'z'
      texture: null,
    };
  }

  apply(geometry, object) {
    return {
      displacement: {
        strength: this.parameters.strength,
        direction: this.parameters.direction,
      },
    };
  }
}

// Modifier Stack Manager
export class ModifierStack {
  constructor() {
    this.modifiers = [];
    this.idCounter = 0;
  }

  addModifier(modifierType) {
    let modifier;
    
    switch (modifierType) {
      case 'array':
        modifier = new ArrayModifier();
        break;
      case 'mirror':
        modifier = new MirrorModifier();
        break;
      case 'boolean':
        modifier = new BooleanModifier();
        break;
      case 'subdivision':
        modifier = new SubdivisionSurfaceModifier();
        break;
      case 'bevel':
        modifier = new BevelModifier();
        break;
      case 'solidify':
        modifier = new SolidifyModifier();
        break;
      case 'displace':
        modifier = new DisplaceModifier();
        break;
      default:
        return null;
    }
    
    modifier.id = `mod_${this.idCounter++}`;
    this.modifiers.push(modifier);
    return modifier;
  }

  removeModifier(modifierId) {
    const index = this.modifiers.findIndex(m => m.id === modifierId);
    if (index !== -1) {
      this.modifiers.splice(index, 1);
      return true;
    }
    return false;
  }

  moveModifier(modifierId, direction) {
    const index = this.modifiers.findIndex(m => m.id === modifierId);
    if (index === -1) return false;
    
    const newIndex = direction === 'up' ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= this.modifiers.length) return false;
    
    const temp = this.modifiers[index];
    this.modifiers[index] = this.modifiers[newIndex];
    this.modifiers[newIndex] = temp;
    return true;
  }

  applyStack(geometry, object) {
    let result = { ...geometry };
    
    for (const modifier of this.modifiers) {
      if (modifier.enabled) {
        result = modifier.apply(result, object);
      }
    }
    
    return result;
  }

  getModifiers() {
    return this.modifiers;
  }

  clear() {
    this.modifiers = [];
  }
}

export default {
  Modifier,
  ArrayModifier,
  MirrorModifier,
  BooleanModifier,
  SubdivisionSurfaceModifier,
  BevelModifier,
  SolidifyModifier,
  DisplaceModifier,
  ModifierStack,
};
