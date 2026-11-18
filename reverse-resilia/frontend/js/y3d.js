import * as THREE from 'three';
import { o6 } from './ease.js';

// --- GLSL SHADERS FROM AUREN LIVE HELICAL SCULPTURE ---
const vertexShader = `
precision highp float;

attribute float aIndex;

uniform float u_activeSlats;
uniform float u_scrollPhase;
uniform float u_helixRadius;
uniform float u_heightStep;
uniform float u_twistRate;
uniform float u_slatLength;
uniform float u_slatWidth;
uniform float u_slatThickness;
uniform float u_slatGap;
uniform float u_taperProfile;
uniform float u_shapeType;
uniform float u_waveAmplitude;
uniform float u_waveFrequency;
uniform float u_waveSpeed;
uniform float u_waveTwistStrength;
uniform float u_breathIntensity;
uniform float u_motionMode;
uniform float u_time;
uniform float u_explodedOffset;
uniform float u_slatAnchorOffset;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;
varying float vNormIndex;
varying float vActive;
varying vec3 vLocalPosition;
varying float vEdgeVisibility;

#define PI 3.1415926535897932384626433832795
#define TWO_PI 6.2831853071795864769252867665590

mat3 rotationMatrix(vec3 axis, float angle) {
    axis = normalize(axis);
    float s = sin(angle);
    float c = cos(angle);
    float oc = 1.0 - c;
    return mat3(
        oc * axis.x * axis.x + c,           oc * axis.x * axis.y - axis.z * s,  oc * axis.z * axis.x + axis.y * s,
        oc * axis.x * axis.y + axis.z * s,  oc * axis.y * axis.y + c,           oc * axis.y * axis.z - axis.x * s,
        oc * axis.z * axis.x - axis.y * s,  oc * axis.y * axis.z + axis.x * s,  oc * axis.z * axis.z + c
    );
}

void getSculptureFrame(
    float t, 
    float shape, 
    out vec3 center, 
    out vec3 tangent, 
    out vec3 normal, 
    out vec3 binormal,
    out float localTwist
) {
    float angle = t * TWO_PI * u_twistRate;
    float wave = 0.0;
    float waveTwist = 0.0;
    float waveY = 0.0;
    
    if (u_motionMode < 0.5) {
        float wavePhase = t * u_waveFrequency * TWO_PI - u_time * u_waveSpeed;
        wave = sin(wavePhase) * u_waveAmplitude;
        waveTwist = cos(wavePhase) * (u_waveAmplitude * u_waveTwistStrength * 0.7);
        waveY = sin(wavePhase * 0.5) * (u_waveAmplitude * 0.25);
    } else if (u_motionMode < 1.5) {
        wave = sin(t * u_waveFrequency * TWO_PI + u_time * 0.3) * (u_waveAmplitude * 0.4);
        waveTwist = cos(t * u_waveFrequency * TWO_PI + u_time * 0.3) * (u_waveAmplitude * 0.3);
    } else if (u_motionMode < 2.5) {
        float breath = sin(u_time * u_waveSpeed * 0.6) * u_breathIntensity;
        wave = breath + sin(t * u_waveFrequency * TWO_PI) * (u_waveAmplitude * 0.3);
        waveTwist = sin(u_time * u_waveSpeed * 0.4) * (u_breathIntensity * 0.4);
        waveY = cos(u_time * u_waveSpeed * 0.3) * (u_breathIntensity * 0.15);
    } else {
        wave = sin(t * u_waveFrequency * TWO_PI + u_time * u_waveSpeed * 0.5) * (u_waveAmplitude * 0.5);
        waveTwist = cos(t * u_waveFrequency * TWO_PI + u_time * u_waveSpeed * 0.5) * (u_waveAmplitude * 0.3);
    }
    
    if (shape < 0.5) {
        float y = (t - 0.5) * u_heightStep + waveY;
        float rMod = 1.0 + 0.12 * sin(t * PI);
        float r = u_helixRadius * rMod + wave;
        center = vec3(cos(angle) * r, y, sin(angle) * r);
        tangent = normalize(vec3(-sin(angle) * r * u_twistRate * TWO_PI, u_heightStep, cos(angle) * r * u_twistRate * TWO_PI));
        vec3 radial = normalize(vec3(cos(angle), 0.0, sin(angle)));
        binormal = normalize(cross(tangent, radial));
        normal = normalize(cross(binormal, tangent));
        localTwist = waveTwist;
    } 
    else if (shape < 1.5) {
        float strand = mod(aIndex, 2.0);
        float strandOffset = strand * PI;
        float y = (t - 0.5) * u_heightStep + waveY;
        float r = u_helixRadius + wave;
        float currentAngle = angle + strandOffset;
        center = vec3(cos(currentAngle) * r, y, sin(currentAngle) * r);
        tangent = normalize(vec3(-sin(currentAngle) * r * u_twistRate * TWO_PI, u_heightStep, cos(currentAngle) * r * u_twistRate * TWO_PI));
        vec3 radial = normalize(vec3(cos(currentAngle), 0.0, sin(currentAngle)));
        binormal = normalize(cross(tangent, radial));
        normal = normalize(cross(binormal, tangent));
        localTwist = waveTwist;
    }
    else {
        float progress = clamp(t, 0.0, 1.0);
        float y = (progress - 0.5) * u_heightStep + waveY;
        float r = u_helixRadius * (0.25 + 0.85 * pow(progress, 1.3)) + wave;
        center = vec3(cos(angle) * r, y, sin(angle) * r);
        tangent = normalize(vec3(-sin(angle) * r * u_twistRate * TWO_PI, u_heightStep, cos(angle) * r * u_twistRate * TWO_PI));
        vec3 radial = normalize(vec3(cos(angle), 0.0, sin(angle)));
        binormal = normalize(cross(tangent, radial));
        normal = normalize(cross(binormal, tangent));
        localTwist = angle * 0.2 + waveTwist;
    }
}

void main() {
    vUv = uv;
    vLocalPosition = position;
    
    if (aIndex >= u_activeSlats) {
        vActive = 0.0;
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        return;
    }
    vActive = 1.0;

    float normIndex = aIndex / max(1.0, u_activeSlats - 1.0);
    vNormIndex = normIndex;

    float t = normIndex;
    if (u_motionMode > 2.5) {
        t = fract(normIndex + u_scrollPhase * 0.0015);
    }

    vec3 center, tangent, normal, binormal;
    float localTwist;
    getSculptureFrame(t, u_shapeType, center, tangent, normal, binormal, localTwist);

    float scaleLength = u_slatLength;
    float scaleThickness = u_slatThickness;
    float scaleWidth = u_slatWidth * (1.0 - u_slatGap * 0.5);

    if (u_taperProfile > 0.5 && u_taperProfile < 1.5) {
        float profile = sin(t * PI);
        scaleLength *= (0.35 + 0.65 * profile);
        scaleWidth *= (0.6 + 0.4 * profile);
    } else if (u_taperProfile > 1.5) {
        float profile = 1.0 - sin(t * PI);
        scaleLength *= (0.4 + 0.6 * profile);
    }

    mat3 twistMat = rotationMatrix(tangent, localTwist);
    vec3 orientedNormal = twistMat * normal;
    vec3 orientedBinormal = twistMat * binormal;

    vec3 localOffset = position.x * orientedBinormal * scaleLength
                     + position.y * tangent * scaleWidth
                     + position.z * orientedNormal * scaleThickness;

    localOffset += orientedBinormal * (u_slatAnchorOffset * scaleLength);

    if (u_explodedOffset > 0.001) {
        localOffset += orientedNormal * (u_explodedOffset * sin(t * TWO_PI * 4.0));
    }

    vec3 worldPos = center + localOffset;
    vWorldPosition = worldPos;

    mat3 basisMat = mat3(orientedBinormal, tangent, orientedNormal);
    vec3 transformedNormal = normalize(basisMat * normal);
    vNormal = normalize(normalMatrix * transformedNormal);

    vec4 mvPosition = modelViewMatrix * vec4(worldPos, 1.0);
    vViewPosition = -mvPosition.xyz;
    
    gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = `
precision highp float;

uniform vec3 u_baseColor;
uniform vec3 u_fresnelColor;
uniform float u_fresnelPower;
uniform float u_fresnelIntensity;
uniform float u_roughness;
uniform float u_metalness;
uniform float u_ambientOcclusionStrength;
uniform float u_bevelHighlightStrength;
uniform float u_surfaceFinish;
uniform float u_surfaceBumpStrength;
uniform float u_surfaceGrainScale;

uniform vec3 u_keyLightDirection;
uniform vec3 u_keyLightColor;
uniform float u_keyLightIntensity;
uniform float u_ambientIntensity;
uniform float uOpacity;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;
varying float vNormIndex;
varying float vActive;
varying vec3 vLocalPosition;

#define PI 3.1415926535897932384626433832795

float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(cos(0.5), sin(0.5), -sin(0.5), cos(0.5));
    for (int i = 0; i < 3; ++i) {
        v += a * noise(p);
        p = rot * p * 2.0 + vec2(100.0);
        a *= 0.5;
    }
    return v;
}

void main() {
    if (vActive < 0.5) discard;

    vec3 N = normalize(vNormal);
    vec3 V = normalize(vViewPosition);
    vec3 L = normalize(u_keyLightDirection);
    vec3 H = normalize(L + V);

    // Bevel highlighting calculation
    vec3 localAbs = abs(vLocalPosition);
    float edgeDistX = 0.5 - localAbs.x;
    float edgeDistY = 0.5 - localAbs.y;
    float edgeDistZ = 0.5 - localAbs.z;
    float minEdgeDist = min(min(edgeDistX, edgeDistY), edgeDistZ);
    float bevelEdge = 1.0 - smoothstep(0.01, 0.07, minEdgeDist);

    // Procedural surface grain
    vec2 uvGrain = (vWorldPosition.xy + vWorldPosition.yz) * u_surfaceGrainScale;
    float surfaceNoise = fbm(uvGrain);
    vec3 perturbedN = normalize(N + vec3((surfaceNoise - 0.5) * 0.12 * u_surfaceBumpStrength));

    float NdotL = max(dot(perturbedN, L), 0.0);
    float NdotV = max(dot(N, V), 0.001);
    float NdotH = max(dot(perturbedN, H), 0.0);

    vec3 ambient = u_baseColor * u_ambientIntensity;
    vec3 diffuse = u_baseColor * u_keyLightColor * (NdotL * u_keyLightIntensity);

    float specPower = mix(90.0, 10.0, u_roughness);
    float specTerm = pow(NdotH, specPower) * (1.0 - u_roughness * 0.75);
    vec3 specular = u_keyLightColor * specTerm * (u_metalness * 0.8 + 0.15);

    specular += vec3(0.9) * (bevelEdge * u_bevelHighlightStrength * (0.25 + 0.75 * NdotL));

    float fresnelFactor = pow(1.0 - NdotV, u_fresnelPower);
    vec3 fresnelSheen = u_fresnelColor * (fresnelFactor * u_fresnelIntensity * (1.0 - NdotL * 0.6));

    float lengthAO = mix(1.0, 0.82 + 0.18 * abs(vLocalPosition.x), u_ambientOcclusionStrength);
    float sideFaceAO = mix(1.0, 0.75, smoothstep(0.35, 0.49, localAbs.y) * u_ambientOcclusionStrength);

    vec3 finalColor = (ambient + diffuse + specular + fresnelSheen) * (lengthAO * sideFaceAO);

    gl_FragColor = vec4(finalColor, uOpacity);
}
`;

const MAX_SLATS = 600;

export function createYMaterial() {
  const uniforms = {
    u_activeSlats: { value: 220.0 },
    u_scrollPhase: { value: 0.0 },
    u_helixRadius: { value: 2.5 },
    u_heightStep: { value: 14.5 },
    u_twistRate: { value: 1.9 },
    u_slatLength: { value: 2.8 },
    u_slatWidth: { value: 0.16 },
    u_slatThickness: { value: 0.058 },
    u_slatGap: { value: 0.38 },
    u_slatAnchorOffset: { value: 0.35 },
    u_taperProfile: { value: 0.0 },
    u_shapeType: { value: 0.0 }, // Monolith
    u_motionMode: { value: 0.0 }, // smooth_wave
    u_waveAmplitude: { value: 0.10 },
    u_waveFrequency: { value: 3.2 },
    u_waveSpeed: { value: 0.28 },
    u_waveTwistStrength: { value: 0.8 },
    u_breathIntensity: { value: 0.15 },
    u_time: { value: 0.0 },
    u_explodedOffset: { value: 0.0 },
    u_surfaceFinish: { value: 1.0 },
    u_surfaceBumpStrength: { value: 0.45 },
    u_surfaceGrainScale: { value: 22.0 },
    u_baseColor: { value: new THREE.Color('#dcdcdc') },
    u_fresnelColor: { value: new THREE.Color('#ffffff') },
    u_fresnelPower: { value: 3.5 },
    u_fresnelIntensity: { value: 0.45 },
    u_roughness: { value: 0.65 },
    u_metalness: { value: 0.02 },
    u_ambientOcclusionStrength: { value: 0.8 },
    u_bevelHighlightStrength: { value: 1.25 },
    u_keyLightDirection: { value: new THREE.Vector3(0.45, 1.1, 0.75).normalize() },
    u_keyLightColor: { value: new THREE.Color('#ffffff') },
    u_keyLightIntensity: { value: 1.2 },
    u_ambientIntensity: { value: 0.55 },
    uOpacity: { value: 1.0 },
  };

  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    side: THREE.DoubleSide,
    transparent: true,
  });
}

export function applyY3D(material, lightTurn = 0) {
  if (material && material.uniforms && material.uniforms.u_keyLightDirection) {
    const angle = 0.45 + lightTurn;
    material.uniforms.u_keyLightDirection.value.set(Math.cos(angle), 1.1, Math.sin(angle)).normalize();
  }
}

function createSculptureMesh(material) {
  const boxGeo = new THREE.BoxGeometry(1, 1, 1, 1, 1, 1);
  const instancedGeo = new THREE.InstancedBufferGeometry();
  instancedGeo.index = boxGeo.index;
  instancedGeo.attributes.position = boxGeo.attributes.position;
  instancedGeo.attributes.normal = boxGeo.attributes.normal;
  instancedGeo.attributes.uv = boxGeo.attributes.uv;

  const count = 220;
  const indices = new Float32Array(count);
  for (let i = 0; i < count; i++) indices[i] = i;
  instancedGeo.setAttribute('aIndex', new THREE.InstancedBufferAttribute(indices, 1));
  instancedGeo.instanceCount = count;

  // Set explicit bounding box so orbit.js can auto-calculate scale
  instancedGeo.boundingBox = new THREE.Box3(
    new THREE.Vector3(-3.5, -7.25, -3.5),
    new THREE.Vector3(3.5, 7.25, 3.5),
  );

  const mesh = new THREE.Mesh(instancedGeo, material);
  mesh.frustumCulled = false;
  return mesh;
}

export class YModel {
  constructor(material) {
    this.material = material || createYMaterial();
    this.object = new THREE.Group();
    this.mesh = createSculptureMesh(this.material);
    this.object.add(this.mesh);
    this.initialized = false;
    this.startTime = performance.now();
    this.height = 14.5;
    this.radius = 3.2;
  }

  update() {
    const now = performance.now();
    const t = (now - this.startTime) / 1000;
    if (this.material.uniforms) {
      this.material.uniforms.u_time.value = t;
      this.material.uniforms.u_scrollPhase.value = t * 3.0;
    }
    this.mesh.rotation.y = t * 0.08;
    if (!this.initialized) {
      this.initialized = true;
      return true;
    }
    return false;
  }
}

export class Y3d {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = (this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
    }));
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping || 4;
    renderer.toneMappingExposure = 1.05;
    if (renderer.outputColorSpace) {
      renderer.outputColorSpace = THREE.SRGBColorSpace;
    }

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 200);

    this.baseCameraDir = new THREE.Vector3(7.5, 3.2, 14.0).normalize();
    this.cameraDistance = 18.0;

    this.material = createYMaterial();
    this.mesh = createSculptureMesh(this.material);

    this.group = new THREE.Group();
    this.group.add(this.mesh);
    this.scene.add(this.group);

    this.angle = 0;
    this.scrollPhase = 0;
    this.scroll = null;
    this.last = null;
    this.intro = { scale: 0, turn: 0 };

    this.mouse = { targetX: 0, targetY: 0, currentX: 0, currentY: 0 };
    this.onPointerMove = (e) => {
      const w = window.innerWidth || 1;
      const h = window.innerHeight || 1;
      this.mouse.targetX = (e.clientX / w - 0.5) * 2;
      this.mouse.targetY = (e.clientY / h - 0.5) * 2;
    };
    window.addEventListener('pointermove', this.onPointerMove, { passive: true });

    this.resize();
  }

  resize() {
    const { canvas, renderer, camera } = this;
    const w = canvas.clientWidth || 600;
    const h = canvas.clientHeight || 580;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  show(instant) {
    if (instant) {
      Object.assign(this.intro, { scale: 1, turn: 0 });
      return;
    }
    if (window.gsap) {
      window.gsap.fromTo(
        this.intro,
        { scale: 0, turn: 0 },
        {
          scale: 1,
          turn: Math.PI * 0.4,
          duration: 2.2,
          ease: o6 || 'power3.out',
          overwrite: true,
        },
      );
    } else {
      this.intro.scale = 1;
    }
  }

  update(now, scroll) {
    const dt = this.last === null ? 0 : Math.min(now - this.last, 100) / 1000;
    this.last = now;
    const scrollDelta = this.scroll === null ? 0 : scroll - this.scroll;
    this.scroll = scroll;

    // Calm architectural drift with 5x reduced scroll spin speed
    const baseSpinRate = 0.035; // gentle continuous rotation
    const scrollSpinKick = Math.min(Math.abs(scrollDelta) * 0.00006, 0.008); // 5x reduced & capped
    this.angle += dt * baseSpinRate + scrollSpinKick;
    this.mesh.rotation.y = this.angle + this.intro.turn;

    // Ultra-smooth continuous wave phase (5x reduced scroll influence)
    const scrollWaveKick = Math.min(Math.abs(scrollDelta) * 0.001, 0.05);
    this.scrollPhase += dt * 1.2 + scrollWaveKick;
    this.material.uniforms.u_scrollPhase.value = this.scrollPhase;
    this.material.uniforms.u_time.value = now / 1000;

    // Mouse parallax lerp
    this.mouse.currentX += (this.mouse.targetX - this.mouse.currentX) * 0.05;
    this.mouse.currentY += (this.mouse.targetY - this.mouse.currentY) * 0.05;

    const parallaxX = this.mouse.currentX * 0.45 * 0.5;
    const parallaxY = -this.mouse.currentY * 0.45 * 0.35;

    const camPos = this.baseCameraDir.clone().multiplyScalar(this.cameraDistance);
    this.camera.position.set(camPos.x + parallaxX, camPos.y + parallaxY, camPos.z);
    this.camera.lookAt(0, 0, 0);

    // Apply entrance scale
    this.group.scale.setScalar(this.intro.scale);

    // Pin with scroll
    this.canvas.style.transform = `translate3d(0, ${-scroll}px, 0)`;
    if (this.canvas.offsetTop + this.canvas.offsetHeight - scroll <= -200) return;

    this.renderer.render(this.scene, this.camera);
  }
}
