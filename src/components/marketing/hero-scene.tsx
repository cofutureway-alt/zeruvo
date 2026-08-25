'use client';

import { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Float, Icosahedron, MeshDistortMaterial } from '@react-three/drei';
import type { Mesh, Group } from 'three';

function Core() {
	const mesh = useRef<Mesh>(null);
	useFrame((state) => {
		if (mesh.current) {
			mesh.current.rotation.x = state.clock.elapsedTime * 0.15;
			mesh.current.rotation.y = state.clock.elapsedTime * 0.2;
		}
	});
	return (
		<Float speed={1.4} rotationIntensity={0.4} floatIntensity={0.9}>
			<Icosahedron ref={mesh} args={[1.35, 12]}>
				<MeshDistortMaterial
					color="#6366f1"
					distort={0.35}
					speed={1.6}
					roughness={0.15}
					metalness={0.85}
				/>
			</Icosahedron>
		</Float>
	);
}

function Ring({ radius, color, tilt }: { radius: number; color: string; tilt: number }) {
	const group = useRef<Group>(null);
	useFrame((state) => {
		if (group.current) group.current.rotation.z = state.clock.elapsedTime * 0.25;
	});
	return (
		<group ref={group} rotation={[tilt, 0.2, 0]}>
			<mesh>
				<torusGeometry args={[radius, 0.015, 8, 128]} />
				<meshBasicMaterial color={color} transparent opacity={0.5} />
			</mesh>
		</group>
	);
}

/** Hero 3D scene — mounted lazily, disabled under prefers-reduced-motion. */
export default function HeroScene() {
	return (
		<Canvas
			camera={{ position: [0, 0, 4.2], fov: 45 }}
			dpr={[1, 1.75]}
			gl={{ antialias: true, alpha: true }}
			style={{ background: 'transparent' }}
		>
			<ambientLight intensity={0.5} />
			<pointLight position={[4, 4, 4]} intensity={40} color="#a5b4fc" />
			<pointLight position={[-4, -2, -3]} intensity={22} color="#7c3aed" />
			<Core />
			<Ring radius={2.1} color="#818cf8" tilt={1.1} />
			<Ring radius={2.55} color="#c084fc" tilt={1.35} />
		</Canvas>
	);
}
