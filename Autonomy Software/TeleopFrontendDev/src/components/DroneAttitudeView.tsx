// src/components/DroneAttitudeView.tsx
import React, { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useLoader } from "@react-three/fiber";
import { OrbitControls, Bounds, Html } from "@react-three/drei";
import * as THREE from "three";
import { STLLoader } from "three-stdlib";

type Attitude = {
  yawDeg: number;    // degrees (heading)
  pitchDeg: number;  // degrees (incoming value that should VISUALLY behave like ROLL)
  rollDeg: number;   // degrees (incoming value that should VISUALLY behave like PITCH)
  altitudeM: number; // meters (visual nudge only)
};

function toRad(d: number) { return (d * Math.PI) / 180; }

/**
 * Quaternion-based attitude driver (shortest-path):
 * - Aerospace composition: R = Rz(yaw) * Ry(pitch) * Rx(roll)  -> Euler order "ZYX"
 * - ***Requested mapping***:
 *     - yaw is inverted
 *     - pitch and roll are swapped:
 *         * visual ROLL (X)   <= pitchDeg
 *         * visual PITCH (Y)  <= rollDeg
 * - Model alignment quaternion adjusts STL's baked axes to Three's Y-up.
 */
function useAttitude(
  mesh: THREE.Object3D | null,
  { yawDeg, pitchDeg, rollDeg, altitudeM }: Attitude
) {
  const attEuler   = useMemo(() => new THREE.Euler(0, 0, 0, "ZYX"), []);
  const attQuat    = useMemo(() => new THREE.Quaternion(), []);
  const targetQuat = useMemo(() => new THREE.Quaternion(), []);
  const modelAlign = useMemo(() => {
    const q = new THREE.Quaternion();
    // If your STL is Z-up (common), rotate -90° about X to convert to Y-up
    q.setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    return q;
  }, []);
  const tmpPos = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, dt) => {
    if (!mesh) return;

    // ---- Requested mapping & inversion ----
    // Z (yaw)      <= -yawDeg   (inverted)
    // Y (pitch)    <=  rollDeg  (incoming "roll" should behave like PITCH)
    // X (roll)     <=  pitchDeg (incoming "pitch" should behave like ROLL)
    attEuler.set(
      toRad(-pitchDeg),   // X = visual roll
      toRad(-rollDeg),    // Y = visual pitch
      toRad(-yawDeg),    // Z = inverted yaw
      "ZYX"
    );

    attQuat.setFromEuler(attEuler);
    targetQuat.copy(modelAlign).multiply(attQuat);

    // Smooth, shortest-path rotation
    const k = Math.min(1, dt * 10);
    mesh.quaternion.slerp(targetQuat, k);

    // Subtle altitude rise (10 m => 1 unit up), clamped
    const yUp = THREE.MathUtils.clamp(altitudeM / 10, -2, 2);
    tmpPos.set(0, yUp, 0);
    mesh.position.lerp(tmpPos, k);
  });
}

/** Placeholder so Canvas renders even without a model. */
function PlaceholderMesh(props: Attitude) {
  const meshRef = useRef<THREE.Mesh>(null);
  const geom = useMemo(() => new THREE.BoxGeometry(1, 0.25, 0.6), []);
  useAttitude(meshRef.current, props);
  return (
    <mesh ref={meshRef} castShadow>
      <primitive attach="geometry" object={geom} />
      <meshStandardMaterial metalness={0.2} roughness={0.6} />
    </mesh>
  );
}

/** STL loader mesh: centers & uniformly scales the geometry. */
function StlMesh({ url, ...att }: { url: string } & Attitude) {
  const geom = useLoader(STLLoader, url) as THREE.BufferGeometry;
  const meshRef = useRef<THREE.Mesh>(null);

  useEffect(() => {
    if (!geom) return;
    geom.computeBoundingBox();
    const bbox = geom.boundingBox!;
    const size = new THREE.Vector3();
    bbox.getSize(size);
    const center = new THREE.Vector3();
    bbox.getCenter(center).multiplyScalar(-1);

    // Center geometry at origin
    geom.translate(center.x, center.y, center.z);

    // Uniform scale to ~1.2 units
    if (meshRef.current) {
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      meshRef.current.scale.setScalar(1.2 / maxDim);
    }

    return () => { try { geom.dispose(); } catch {} };
  }, [geom]);

  useAttitude(meshRef.current, att);

  return (
    <mesh ref={meshRef} castShadow>
      <bufferGeometry attach="geometry" {...(geom as any)} />
      <meshStandardMaterial color={"#a5b4fc"} metalness={0.4} roughness={0.5} />
    </mesh>
  );
}

export default function DroneAttitudeView({
  stlUrl,
  yawDeg,
  pitchDeg,
  rollDeg,
  altitudeM,
}: {
  stlUrl?: string | null;
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  altitudeM: number;
}) {
  const hasModel = !!stlUrl;

  return (
    <Canvas
      gl={{ antialias: true, alpha: true }}
      style={{ width: "100%", height: "100%", display: "block", background: "transparent" }}
      dpr={[1, 2]}
      camera={{ position: [0, 0.8, 3], fov: 100, near: 0.01, far: 100 }}
    >
      <ambientLight intensity={0.75} />
      <directionalLight position={[4, 6, 4]} intensity={0.9} />
      <hemisphereLight intensity={0.35} />

      <Bounds fit clip margin={1.1}>
        {hasModel ? (
          <Suspense fallback={<PlaceholderMesh yawDeg={yawDeg} pitchDeg={pitchDeg} rollDeg={rollDeg} altitudeM={altitudeM} />}>
            <StlMesh
              url={stlUrl as string}
              yawDeg={yawDeg}
              pitchDeg={pitchDeg}
              rollDeg={rollDeg}
              altitudeM={altitudeM}
            />
          </Suspense>
        ) : (
          <PlaceholderMesh yawDeg={yawDeg} pitchDeg={pitchDeg} rollDeg={rollDeg} altitudeM={altitudeM} />
        )}
      </Bounds>

      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        enablePan={false}
        minDistance={1}
        maxDistance={8}
        target={[0, 0, 0]}
      />

      <group position={[-1.6, 1.2, 0]}>
        <Html center style={{ pointerEvents: "none" }}>
          <div style={{ color: "#ccc", fontSize: 12, fontFamily: "monospace" }}>yaw/pitch/roll</div>
        </Html>
      </group>
    </Canvas>
  );
}
