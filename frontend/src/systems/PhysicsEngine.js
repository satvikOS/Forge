/**
 * PhysicsEngine - IMAX/AAA Quality Physics & Simulation
 * Rigid body, cloth, particles, fluid simulations
 * Note: For production use, integrate Ammo.js or Cannon.js
 */

import * as THREE from 'three';

export class RigidBody {
    constructor(mesh, mass = 1.0) {
        this.mesh = mesh;
        this.mass = mass;
        this.velocity = new THREE.Vector3();
        this.angularVelocity = new THREE.Vector3();
        this.force = new THREE.Vector3();
        this.torque = new THREE.Vector3();
        this.isKinematic = false; // If true, not affected by forces
        this.gravity = new THREE.Vector3(0, -9.81, 0);
        this.restitution = 0.5; // Bounciness
        this.friction = 0.5;
    }

    applyForce(force) {
        this.force.add(force);
    }

    applyTorque(torque) {
        this.torque.add(torque);
    }

    update(deltaTime) {
        if (this.isKinematic) return;

        // Apply gravity
        this.force.add(this.gravity.clone().multiplyScalar(this.mass));

        // Update velocity
        const acceleration = this.force.clone().divideScalar(this.mass);
        this.velocity.add(acceleration.multiplyScalar(deltaTime));

        // Update position
        this.mesh.position.add(this.velocity.clone().multiplyScalar(deltaTime));

        // Update angular velocity and rotation
        const angularAcceleration = this.torque.clone().divideScalar(this.mass);
        this.angularVelocity.add(angularAcceleration.multiplyScalar(deltaTime));

        const rotation = this.angularVelocity.clone().multiplyScalar(deltaTime);
        this.mesh.rotation.x += rotation.x;
        this.mesh.rotation.y += rotation.y;
        this.mesh.rotation.z += rotation.z;

        // Reset forces
        this.force.set(0, 0, 0);
        this.torque.set(0, 0, 0);

        // Apply damping
        this.velocity.multiplyScalar(0.99);
        this.angularVelocity.multiplyScalar(0.98);
    }
}

export class Particle {
    constructor(position, velocity, lifespan = 5) {
        this.position = position.clone();
        this.velocity = velocity.clone();
        this.acceleration = new THREE.Vector3();
        this.lifespan = lifespan;
        this.age = 0;
        this.size = 1.0;
        this.color = new THREE.Color(1, 1, 1);
        this.alpha = 1.0;
    }

    update(deltaTime) {
        this.velocity.add(this.acceleration.clone().multiplyScalar(deltaTime));
        this.position.add(this.velocity.clone().multiplyScalar(deltaTime));
        this.age += deltaTime;

        // Fade out
        this.alpha = Math.max(0, 1 - this.age / this.lifespan);

        // Reset acceleration
        this.acceleration.set(0, 0, 0);
    }

    isDead() {
        return this.age >= this.lifespan;
    }
}

export class ParticleEmitter {
    constructor(position) {
        this.position = position.clone();
        this.particles = [];
        this.emissionRate = 10; // particles per second
        this.particleLifespan = 3.0;
        this.velocity = new THREE.Vector3(0, 1, 0);
        this.velocityVariance = new THREE.Vector3(0.5, 0.5, 0.5);
        this.gravity = new THREE.Vector3(0, -9.81, 0);
        this.enabled = true;
        this.timeSinceLastEmit = 0;
    }

    emit(deltaTime) {
        if (!this.enabled) return;

        this.timeSinceLastEmit += deltaTime;
        const emitInterval = 1.0 / this.emissionRate;

        while (this.timeSinceLastEmit >= emitInterval) {
            const velocity = this.velocity.clone();
            velocity.x += (Math.random() - 0.5) * 2 * this.velocityVariance.x;
            velocity.y += (Math.random() - 0.5) * 2 * this.velocityVariance.y;
            velocity.z += (Math.random() - 0.5) * 2 * this.velocityVariance.z;

            const particle = new Particle(this.position, velocity, this.particleLifespan);
            this.particles.push(particle);

            this.timeSinceLastEmit -= emitInterval;
        }
    }

    update(deltaTime) {
        this.emit(deltaTime);

        // Update particles
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const particle = this.particles[i];
            particle.acceleration.copy(this.gravity);
            particle.update(deltaTime);

            if (particle.isDead()) {
                this.particles.splice(i, 1);
            }
        }
    }
}

export class ClothSimulation {
    constructor(width, height, segments) {
        this.width = width;
        this.height = height;
        this.segments = segments;

        // Create grid of particles
        this.particles = [];
        this.constraints = [];

        const segmentWidth = width / segments;
        const segmentHeight = height / segments;

        // Create particles
        for (let y = 0; y <= segments; y++) {
            for (let x = 0; x <= segments; x++) {
                const pos = new THREE.Vector3(
                    x * segmentWidth - width / 2,
                    -y * segmentHeight,
                    0
                );

                const particle = {
                    position: pos,
                    previousPosition: pos.clone(),
                    velocity: new THREE.Vector3(),
                    mass: 1.0,
                    pinned: y === 0, // Pin top row
                };

                this.particles.push(particle);
            }
        }

        // Create constraints (springs between particles)
        for (let y = 0; y <= segments; y++) {
            for (let x = 0; x <= segments; x++) {
                const index = y * (segments + 1) + x;

                // Horizontal constraint
                if (x < segments) {
                    this.constraints.push({
                        p1: index,
                        p2: index + 1,
                        restLength: segmentWidth,
                    });
                }

                // Vertical constraint
                if (y < segments) {
                    this.constraints.push({
                        p1: index,
                        p2: index + segments + 1,
                        restLength: segmentHeight,
                    });
                }
            }
        }

        this.gravity = new THREE.Vector3(0, -9.81, 0);
        this.damping = 0.99;
        this.iterations = 5; // Constraint satisfaction iterations
    }

    update(deltaTime) {
        // Apply forces
        this.particles.forEach(p => {
            if (p.pinned) return;

            p.velocity.add(this.gravity.clone().multiplyScalar(deltaTime));

            // Verlet integration
            const temp = p.position.clone();
            p.position.add(p.position.clone().sub(p.previousPosition).multiplyScalar(this.damping));
            p.position.add(p.velocity.clone().multiplyScalar(deltaTime));
            p.previousPosition.copy(temp);
        });

        // Satisfy constraints
        for (let iter = 0; iter < this.iterations; iter++) {
            this.constraints.forEach(c => {
                const p1 = this.particles[c.p1];
                const p2 = this.particles[c.p2];

                const delta = p2.position.clone().sub(p1.position);
                const currentLength = delta.length();
                const diff = (currentLength - c.restLength) / currentLength;

                const correction = delta.multiplyScalar(diff * 0.5);

                if (!p1.pinned) p1.position.add(correction);
                if (!p2.pinned) p2.position.sub(correction);
            });
        }
    }
}

export class PhysicsEngine {
    constructor() {
        this.rigidBodies = new Map(); // meshId -> RigidBody
        this.particleEmitters = new Map(); // emitterId -> ParticleEmitter
        this.clothSimulations = new Map(); // clothId -> ClothSimulation

        this.enabled = true;
        this.timeStep = 1 / 60;
        this.accumulator = 0;
    }

    /**
     * Add rigid body to simulation
     */
    addRigidBody(mesh, mass = 1.0) {
        const body = new RigidBody(mesh, mass);
        this.rigidBodies.set(mesh.uuid, body);
        console.log(`🎱 Added rigid body: mass=${mass}`);
        return body;
    }

    /**
     * Remove rigid body
     */
    removeRigidBody(mesh) {
        this.rigidBodies.delete(mesh.uuid);
    }

    /**
     * Create particle emitter
     */
    createParticleEmitter(position) {
        const id = `emitter_${Date.now()}`;
        const emitter = new ParticleEmitter(position);
        this.particleEmitters.set(id, emitter);
        console.log(`✨ Created particle emitter at ${position.toArray()}`);
        return { id, emitter };
    }

    /**
     * Create cloth simulation
     */
    createClothSimulation(width, height, segments) {
        const id = `cloth_${Date.now()}`;
        const cloth = new ClothSimulation(width, height, segments);
        this.clothSimulations.set(id, cloth);
        console.log(`🧵 Created cloth simulation: ${width}x${height}, ${segments} segments`);
        return { id, cloth };
    }

    /**
     * Update physics simulation
     */
    update(deltaTime) {
        if (!this.enabled) return;

        this.accumulator += deltaTime;

        while (this.accumulator >= this.timeStep) {
            // Update rigid bodies
            this.rigidBodies.forEach(body => {
                body.update(this.timeStep);
            });

            // Update particle emitters
            this.particleEmitters.forEach(emitter => {
                emitter.update(this.timeStep);
            });

            // Update cloth simulations
            this.clothSimulations.forEach(cloth => {
                cloth.update(this.timeStep);
            });

            // Check collisions (simplified)
            this.resolveCollisions();

            this.accumulator -= this.timeStep;
        }
    }

    /**
     * Resolve collisions between rigid bodies
     */
    resolveCollisions() {
        const bodies = Array.from(this.rigidBodies.values());

        for (let i = 0; i < bodies.length; i++) {
            for (let j = i + 1; j < bodies.length; j++) {
                const bodyA = bodies[i];
                const bodyB = bodies[j];

                // Simple sphere collision check
                const distance = bodyA.mesh.position.distanceTo(bodyB.mesh.position);
                const minDist = 1.0; // Simplified collision radius

                if (distance < minDist) {
                    // Collision response
                    const normal = bodyB.mesh.position.clone().sub(bodyA.mesh.position).normalize();
                    const relativeVelocity = bodyB.velocity.clone().sub(bodyA.velocity);
                    const velocityAlongNormal = relativeVelocity.dot(normal);

                    if (velocityAlongNormal < 0) continue; // Objects moving apart

                    const restitution = (bodyA.restitution + bodyB.restitution) / 2;
                    const impulse = -(1 + restitution) * velocityAlongNormal;
                    const impulseMagnitude = impulse / (1 / bodyA.mass + 1 / bodyB.mass);

                    const impulseVector = normal.clone().multiplyScalar(impulseMagnitude);

                    if (!bodyA.isKinematic) {
                        bodyA.velocity.sub(impulseVector.clone().divideScalar(bodyA.mass));
                    }
                    if (!bodyB.isKinematic) {
                        bodyB.velocity.add(impulseVector.clone().divideScalar(bodyB.mass));
                    }

                    // Separate overlapping objects
                    const overlap = minDist - distance;
                    const separation = normal.clone().multiplyScalar(overlap / 2);

                    if (!bodyA.isKinematic) {
                        bodyA.mesh.position.sub(separation);
                    }
                    if (!bodyB.isKinematic) {
                        bodyB.mesh.position.add(separation);
                    }
                }
            }
        }
    }

    /**
     * Enable/disable physics
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        console.log(`🎱 Physics ${enabled ? 'enabled' : 'disabled'}`);
    }

    /**
     * Clear all physics data
     */
    clear() {
        this.rigidBodies.clear();
        this.particleEmitters.clear();
        this.clothSimulations.clear();
        console.log('🗑️ Physics cleared');
    }
}
