# three-voxel

A Three.js binding for [`voxelized-js`](https://www.npmjs.com/package/voxelized-js) that turns a large, streamed voxel world into a single `THREE.InstancedMesh` subclass. Drop it into a plain Three.js scene, or extend it with `@react-three/fiber` and use it as a reactive `<voxel />` JSX element.

```ts
import * as THREE from 'three'
import Voxel from 'three-voxel'
import Worker from './worker?worker'

const scene = new THREE.Scene()
scene.add(new Voxel({ worker: new Worker() }))
```

## Why three-voxel

`voxelized-js` already handles the hard parts of rendering a planet-scale voxel world: web-mercator region streaming, atlas image fetching, greedy meshing, priority scheduling, and slot allocation. What it does not do is talk to Three.js. Every Three.js project that wanted to consume the engine ended up re-writing the same glue code, which had three problems:

Duplication. Every consumer had to allocate a 4096 × 4096 × 16 `DataArrayTexture`, build a TSL shader with Morton-curve UV lookups, call `voxel.updates(...)` each frame, upload atlas slots through `copyTextureToTexture`, refresh uniform arrays, and rebuild instanced buffer attributes when the mesh overflowed. Minor drift between copies was unavoidable.

Coordinate bloat. `voxelized-js` anchors its world at the north-west corner of the Tokyo 23-ward region, so a default scene starts near `[22912, 800, 20096]`. Downstream code added `center` to every mesh, every uniform, and every network packet. Rendering was correct but numerically noisy, and multiplayer payloads were unnecessarily large.

Camera bridging. Some projects drive the engine from a Three camera (OrbitControls, r3f cameras, gamepad input). Others let the engine's own camera own the scroll / creative / survive modes and copy its state back into Three. Both directions were hand-rolled and subtly different across projects.

`three-voxel` collapses all of the above into a single class and two tiny helper functions, then re-centers the world at `[0, 0, 0]` without touching `voxelized-js` internals.

## What the package provides

### `Voxel` — a `THREE.InstancedMesh` subclass

The default export is a class that extends `THREE.InstancedMesh`. Construction wires up every resource the voxel pipeline needs:

A `DataArrayTexture` of size `4096 × 4096 × 16`, configured with `NearestFilter`, `ClampToEdgeWrapping`, no mipmaps, `SRGBColorSpace`, and exposed as `this.atlasNode`. A 16-element `uniformArray<'vec3'>` of slot offsets, exposed as `this.offsetNode`. A `MeshBasicNodeMaterial` whose `positionNode` evaluates `offset + pos + positionLocal * scl` and whose `colorNode` samples the atlas via a Morton-curve `atlas(ivec3)` TSL helper. A `BoxGeometry` with instanced `pos` (`vec3`), `scl` (`vec3`) and `aid` (`float`) attributes populated from the engine. A `voxelized-js` engine instance stored at `this.voxel`, plus its center coordinates at `this.center`.

The whole render loop runs inside `onBeforeRender`, which is Three.js's standard per-object hook. No `useFrame`, no manual `voxel.updates()` call, and no external texture upload — the class handles it all while Three walks the scene graph.

### `atlas(ivec3)`, `xyz2m(ivec3)`, `m2uv(int)` — shared TSL helpers

The package also exports the Morton-curve TSL helpers that translate 3D voxel coordinates into 2D atlas UVs. They are the same bit-interleaving sequences the core shader uses, and they are re-usable from any custom TSL fragment or compute shader. This is important because compute shaders that ray-march the atlas (for example, to find a ground height) need to sample the exact same slots the rendering pipeline samples.

```ts
import { atlas, xyz2m, m2uv } from 'three-voxel'
```

## Origin at `[0, 0, 0]`

The `voxelized-js` engine still operates on absolute mercator tile-space coordinates internally, because that is what region lookup and frustum culling need. `three-voxel` does not change any of that. What it changes is the offset uniforms it writes into `offsetNode`: instead of passing the raw `offset` returned by `voxel.updates(...)`, it writes `offset - center`. Because the TSL `positionNode` reads from that same uniform array, the rendered world ends up anchored at the local origin.

Two consequences follow. First, `this.position` is untouched by the library, so users are free to drive it reactively with `@react-three/fiber`: `<voxel position={[0, 1, 0]} rotation-z={Math.PI} />` just works, because r3f's reconciler already knows how to write into any `THREE.Object3D`. Second, network payloads shrink. A multiplayer demo only needs to ship `{ x, y, z }` values in the local coordinate space, not `{ x + 22912, y + 800, z + 20096 }`.

## Camera modes

A `Voxel` instance can be driven in two directions, selected by the `controls` option.

In `controls: 'three'` (the default), the Three camera is the source of truth. Each frame, the class reads `projectionMatrix` and `matrixWorldInverse`, composes them with a translation by `-center`, and writes the resulting matrix into `voxel.cam.mvp`. The camera position is copied into `voxel.cam.pos` with `center` added back, so the engine continues to see absolute mercator coordinates even though the user sees a world anchored at the origin. This is the mode to pick when using `OrbitControls`, `PointerLockControls`, or any user-facing Three camera.

In `controls: 'voxel'`, the `voxelized-js` camera is the source of truth. The class calls `voxel.cam.update(aspect)` first, then positions the Three camera at `voxel.cam.pos - center`, looks at `voxel.cam.eye - center`, and refreshes the Three camera's world and projection matrices. This is the mode to pick when the engine's built-in `'scroll'`, `'creative'`, or `'survive'` mode should drive the view — for example, in a top-down scroller or a first-person walk demo with built-in collision.

Because the translation is applied symmetrically on both sides, switching `controls` at runtime keeps the view consistent.

## Usage

### Plain Three.js

```ts
import * as THREE from 'three'
import Voxel from 'three-voxel'
import Worker from './worker?worker'

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
const renderer = new THREE.WebGLRenderer()
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setAnimationLoop(() => renderer.render(scene, camera))
document.body.appendChild(renderer.domElement)

scene.add(new Voxel({ worker: new Worker() }))
```

No hooks, no custom render callback, no manual texture upload. Add the mesh to the scene and Three will invoke `onBeforeRender` at the right time.

### React Three Fiber

```tsx
import { Voxel } from 'three-voxel'
import { Canvas, extend } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import Worker from './worker?worker'

extend({ Voxel })

const App = () => (
        <Canvas camera={{ position: [0, 0, 3] }}>
                <voxel position-y={-1} worker={new Worker()} />
                <OrbitControls />
        </Canvas>
)
```

`extend({ Voxel })` registers the class with r3f's reconciler. From that point on, `<voxel />` behaves like any other JSX element: `position`, `rotation`, `scale`, and event handlers all work natively. Props such as `worker`, `i`, `j`, and `camera` are forwarded to the constructor on first mount.

### Compute shaders that read the atlas

Because `this.atlasNode` and `this.offsetNode` are plain TSL nodes, user-authored compute shaders can reference them directly. This example finds the ground height at a world coordinate by walking the atlas slots from top to bottom:

<!-- prettier-ignore -->
```ts
import { Fn, textureLoad, ivec3, int, If, Loop, Break } from 'three/tsl'
import { atlas } from 'three-voxel'

const findGround = (voxel) =>
        Fn(([wx, wz]) => {
                const iAtlas = voxel.atlasNode
                const iOffset = voxel.offsetNode
                // ... walk iOffset to find the matching slot
                // ... then Loop over y and textureLoad(iAtlas, atlas(ivec3(lx, y, lz)), int(0))
        })
```

The key property is that both the rendering material and the compute shader read from the same `DataArrayTexture`, so there is zero redundant GPU memory.

## Constructor options

<!-- prettier-ignore -->
```ts
new Voxel({
        worker,        // required: a voxelized-js Web Worker
        i, j,          // optional: initial web-mercator tile coordinates
        camera,        // optional: full camera config forwarded to voxelized-js
        controls,      // 'three' (default) or 'voxel'
        debug,         // optional: voxelized-js Debug instance
        onReady,       // optional: called when the first mesh becomes visible
})
```

Any additional keys are forwarded to `voxelized-js`'s `createVoxel` factory, so advanced options such as `atlasUrl`, `atlasExt`, `slot`, `prebuild`, and `prefetch` are available without the package having to re-declare them.

## Exposed fields and methods

`voxel` holds the underlying `voxelized-js` engine. Call `voxel.cam.turn(...)`, `voxel.pick(x, y, z)`, read `voxel.map`, and so on, exactly as in the base library. `atlasNode` holds the `DataArrayTexture` that the material samples. `offsetNode` holds the `uniformArray<'vec3'>` of slot offsets, already pre-shifted by `-center`. `center` holds the original `[cx, cz]` center in absolute mercator space, so user code that still needs absolute coordinates (for example, to geocode a pin) can add it back.

## Compatibility and design notes

`voxelized-js` itself is completely untouched: region culling, slot management, the worker bridge, priority scheduling, and the debug hooks all behave exactly as documented in the core package. `three-voxel` sits strictly above the public API, so any project that wants to keep driving the engine by hand can continue to do so.

The default export and the named `Voxel` export are the same class, supporting both `import Voxel from 'three-voxel'` and `import { Voxel } from 'three-voxel'`. The `./src` subpath export is available for monorepo consumers that want to import directly from source without going through the tsup build, matching the convention used by `voxelized-js`.

## Requirements

Three.js `>= 0.180` with access to `three/webgpu` and `three/tsl`. A WebGPU-capable browser (or the `WebGPURenderer` fallback path) is required because the material is built on `MeshBasicNodeMaterial`. A `voxelized-js` Web Worker instance is required, typically created with `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` or a bundler-specific `?worker` import.

## License

MIT
