/**
 * Atmospheric Generator - Procedural generation for atmospheric and weather effects
 * Creates sky, clouds, weather phenomena, lighting effects
 */

import * as THREE from 'three';

export class AtmosphericGenerator {
  constructor(materialSystem) {
    this.materialSystem = materialSystem;
  }

  generateSky(options = {}) {
    const {
      radius = 500,
      color = 0x87ceeb,
      gradient = true
    } = options;

    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    
    let material;
    if (gradient) {
      // Create gradient sky
      material = new THREE.ShaderMaterial({
        uniforms: {
          topColor: { value: new THREE.Color(0x0077ff) },
          bottomColor: { value: new THREE.Color(0xffffff) },
          offset: { value: 33 },
          exponent: { value: 0.6 }
        },
        vertexShader: `
          varying vec3 vWorldPosition;
          void main() {
            vec4 worldPosition = modelMatrix * vec4(position, 1.0);
            vWorldPosition = worldPosition.xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform vec3 topColor;
          uniform vec3 bottomColor;
          uniform float offset;
          uniform float exponent;
          varying vec3 vWorldPosition;
          void main() {
            float h = normalize(vWorldPosition + offset).y;
            gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
          }
        `,
        side: THREE.BackSide
      });
    } else {
      material = new THREE.MeshBasicMaterial({
        color: color,
        side: THREE.BackSide
      });
    }

    return new THREE.Mesh(geometry, material);
  }

  generateCloud(options = {}) {
    const {
      size = 5,
      puffCount = 5
    } = options;

    const group = new THREE.Group();
    const material = this.materialSystem.getMaterial('cloud');

    for (let i = 0; i < puffCount; i++) {
      const puffSize = size * (0.7 + Math.random() * 0.3);
      const geometry = new THREE.SphereGeometry(puffSize, 8, 8);
      const puff = new THREE.Mesh(geometry, material);
      
      puff.position.set(
        (Math.random() - 0.5) * size * 2,
        (Math.random() - 0.5) * size * 0.5,
        (Math.random() - 0.5) * size * 2
      );
      
      puff.scale.set(
        1,
        0.6 + Math.random() * 0.2,
        1
      );
      
      group.add(puff);
    }

    return group;
  }

  generateCloudLayer(options = {}) {
    const {
      area = 200,
      cloudCount = 20,
      height = 50
    } = options;

    const group = new THREE.Group();

    for (let i = 0; i < cloudCount; i++) {
      const cloud = this.generateCloud({ size: 5 + Math.random() * 5 });
      cloud.position.set(
        (Math.random() - 0.5) * area,
        height + (Math.random() - 0.5) * 10,
        (Math.random() - 0.5) * area
      );
      group.add(cloud);
    }

    return group;
  }

  generateSun(options = {}) {
    const {
      radius = 20,
      intensity = 1,
      color = 0xffff00
    } = options;

    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      fog: false
    });
    const sun = new THREE.Mesh(geometry, material);

    // Add sun light
    const sunLight = new THREE.DirectionalLight(color, intensity);
    sunLight.position.copy(sun.position);
    sun.add(sunLight);

    return sun;
  }

  generateMoon(options = {}) {
    const {
      radius = 15,
      color = 0xe0e0e0
    } = options;

    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    const material = new THREE.MeshBasicMaterial({
      color: color,
      fog: false
    });
    const moon = new THREE.Mesh(geometry, material);

    // Add moon light
    const moonLight = new THREE.DirectionalLight(0xffffff, 0.3);
    moonLight.position.copy(moon.position);
    moon.add(moonLight);

    return moon;
  }

  generateStars(options = {}) {
    const {
      count = 1000,
      radius = 400
    } = options;

    const geometry = new THREE.BufferGeometry();
    const vertices = [];

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos((Math.random() * 2) - 1);
      
      const x = radius * Math.sin(phi) * Math.cos(theta);
      const y = radius * Math.sin(phi) * Math.sin(theta);
      const z = radius * Math.cos(phi);
      
      vertices.push(x, y, z);
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 2,
      sizeAttenuation: false
    });

    return new THREE.Points(geometry, material);
  }

  generateRain(options = {}) {
    const {
      area = 100,
      dropCount = 1000,
      height = 50
    } = options;

    const geometry = new THREE.BufferGeometry();
    const vertices = [];

    for (let i = 0; i < dropCount; i++) {
      vertices.push(
        (Math.random() - 0.5) * area,
        Math.random() * height,
        (Math.random() - 0.5) * area
      );
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const material = new THREE.PointsMaterial({
      color: 0x8888ff,
      size: 0.1,
      transparent: true,
      opacity: 0.6
    });

    const rain = new THREE.Points(geometry, material);
    
    // Store for animation
    rain.userData.isRain = true;
    rain.userData.area = area;
    rain.userData.height = height;

    return rain;
  }

  generateSnow(options = {}) {
    const {
      area = 100,
      flakeCount = 500,
      height = 50
    } = options;

    const geometry = new THREE.BufferGeometry();
    const vertices = [];

    for (let i = 0; i < flakeCount; i++) {
      vertices.push(
        (Math.random() - 0.5) * area,
        Math.random() * height,
        (Math.random() - 0.5) * area
      );
    }

    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));

    const material = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.3,
      transparent: true,
      opacity: 0.8
    });

    const snow = new THREE.Points(geometry, material);
    
    // Store for animation
    snow.userData.isSnow = true;
    snow.userData.area = area;
    snow.userData.height = height;

    return snow;
  }

  generateFog(options = {}) {
    const {
      color = 0xcccccc,
      near = 10,
      far = 100
    } = options;

    return new THREE.Fog(color, near, far);
  }

  generateRainbow(options = {}) {
    const {
      radius = 50,
      thickness = 2,
      angle = Math.PI
    } = options;

    const group = new THREE.Group();
    const colors = [
      0xff0000, // Red
      0xff7f00, // Orange
      0xffff00, // Yellow
      0x00ff00, // Green
      0x0000ff, // Blue
      0x4b0082, // Indigo
      0x9400d3  // Violet
    ];

    for (let i = 0; i < colors.length; i++) {
      const arcRadius = radius - i * thickness;
      const geometry = new THREE.TorusGeometry(arcRadius, thickness / 2, 16, 50, angle);
      const material = new THREE.MeshBasicMaterial({
        color: colors[i],
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide
      });
      const arc = new THREE.Mesh(geometry, material);
      arc.rotation.x = Math.PI / 2;
      group.add(arc);
    }

    return group;
  }

  generateLightning(options = {}) {
    const {
      segments = 10,
      length = 30,
      jaggedness = 3
    } = options;

    const points = [];
    let currentY = length;
    let currentX = 0;
    let currentZ = 0;

    points.push(new THREE.Vector3(currentX, currentY, currentZ));

    for (let i = 0; i < segments; i++) {
      currentY -= length / segments;
      currentX += (Math.random() - 0.5) * jaggedness;
      currentZ += (Math.random() - 0.5) * jaggedness;
      points.push(new THREE.Vector3(currentX, currentY, currentZ));
    }

    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: 0xffffff,
      linewidth: 3
    });

    return new THREE.Line(geometry, material);
  }

  generateAurora(options = {}) {
    const {
      width = 100,
      height = 30,
      altitude = 50
    } = options;

    const geometry = new THREE.PlaneGeometry(width, height, 20, 10);
    const positions = geometry.attributes.position.array;

    // Add wave pattern
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      positions[i + 2] = Math.sin(x * 0.1) * Math.cos(y * 0.2) * 5;
    }

    geometry.computeVertexNormals();

    const material = new THREE.MeshBasicMaterial({
      color: 0x00ff88,
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending
    });

    const aurora = new THREE.Mesh(geometry, material);
    aurora.position.y = altitude;
    aurora.rotation.x = -Math.PI / 4;

    return aurora;
  }

  generateSunrise(options = {}) {
    const {
      radius = 500
    } = options;

    const skyMaterial = new THREE.ShaderMaterial({
      uniforms: {
        topColor: { value: new THREE.Color(0x0077ff) },
        middleColor: { value: new THREE.Color(0xff6347) },
        bottomColor: { value: new THREE.Color(0xff8c00) }
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 middleColor;
        uniform vec3 bottomColor;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition).y;
          vec3 color;
          if (h > 0.0) {
            color = mix(middleColor, topColor, h);
          } else {
            color = mix(bottomColor, middleColor, h + 1.0);
          }
          gl_FragColor = vec4(color, 1.0);
        }
      `,
      side: THREE.BackSide
    });

    const geometry = new THREE.SphereGeometry(radius, 32, 32);
    return new THREE.Mesh(geometry, skyMaterial);
  }
}

export default AtmosphericGenerator;
