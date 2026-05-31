/**
 * Handle adding geometric primitives to the scene
 * This function creates proper scene objects for Three.js primitives
 */
export function handleAddPrimitive(type, dimensions, sceneManager, setModelData) {
    if (!sceneManager) {
        console.error('SceneManager not initialized');
        return;
    }

    console.log(`➕ Adding primitive: ${type}`, dimensions);

    // Generate unique ID for this primitive
    const id = `primitive_${type}_${Date.now()}`;

    // Get type-specific geometry properties
    let geometry = {
        type: type,
        ...dimensions
    };

    // Create scene object
    const sceneObject = {
        id: id,
        name: `${type.charAt(0).toUpperCase() + type.slice(1)}`,
        type: 'primitive',
        position: { x: 0, y: 0, z: 0 }, // Place at origin
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
        userData: {
            geometry: geometry,
            material: {
                name: 'default',
                color: '#4a90e2',
                metalness: 0.2,
                roughness: 0.6
            },
            createdAt: Date.now(),
            primitive: true
        }
    };

    // Add to scene manager
    sceneManager.addObject(sceneObject);
    console.log(`✅ Added ${type} primitive to scene`);

    // Trigger scene refresh by setting dummy model data
    if (setModelData) {
        setModelData({
            type: 'primitive_added',
            primitiveId: id,
            timestamp: Date.now()
        });
    }

    return sceneObject;
}
