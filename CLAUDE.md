# voxelized-js Technical Specification

## Overview: Streaming Engine for Real-time Voxel Space Rendering

voxelized-js is a library for real-time rendering of large-scale voxel spaces in web browsers.
It uses "Region" as the fundamental spatial subdivision unit, where each Region contains 256³ voxels,
and dynamically loads and renders only the necessary Regions based on camera position.
Through Web Worker asynchronous processing and priority-based task queuing,
it performs Atlas image fetching, decoding, and mesh generation without blocking the main thread.

```ts
┌────────────────────────────────────────────────────────────┐
│                 voxelized-js Architecture                  │
├────────────────────────────────────────────────────────────┤
│         ┌─────────────┐                                    │
│         │   Camera    │                                    │
│         │  (viewport) │                                    │
│         └──────┬──────┘                                    │
│                ▼                                           │
│  ┌─────────────────────────────────────────┐               │
│  │              Scene                      │               │
│  │  ┌──────────┐ ┌──────┐ ┌──────────┐    │               │
│  │  │   Vis    │ │ Mesh │ │  Slots   │    │               │
│  │  │(culling) │ │(vtx) │ │(tex ctrl)│    │               │
│  │  └──────────┘ └──────┘ └──────────┘    │               │
│  │  ┌──────────┐                          │               │
│  │  │  Store   │                          │               │
│  │  │(Rgn ctrl)│                          │               │
│  │  └────┬─────┘                          │               │
│  └───────┼────────────────────────────────┘               │
│     ┌────┴────┐                                           │
│     ▼         ▼                                           │
│ ┌────────┐ ┌─────────┐                                    │
│ │ Queue  │ │ Worker  │──▶ CDN/R2 Storage                  │
│ │(Task)  │ │(off-thr)│    (Atlas delivery)                │
│ └────┬───┘ └─────────┘                                    │
│      ▼                                                    │
│ ┌─────────┐                                               │
│ │ Region  │                                               │
│ │(unit)   │                                               │
│ └─────────┘                                               │
└────────────────────────────────────────────────────────────┘
```

## Spatial Model: Correspondence Between Web Mercator Tiles and Voxel Regions

Space is divided into Regions that correspond 1:1 with Web Mercator coordinate tiles (z=17).
Each Region holds 256×256×256 voxels, where 1 voxel corresponds to approximately 1m in the real world.
Region identifiers are uniquely determined from Web Mercator (i, j) coordinates.

```ts
Web Mercator Tile Coordinates (z=17)
┌────────────────────────────────────────────────────────┐
│ (116358, 51619) ─────────────── (116467, 51619)        │
│       │                               │                │
│       │   ┌─────┬─────┬─────┐         │                │
│       │   │  R  │  R  │  R  │         │  ← Each cell   │
│       │   ├─────┼─────┼─────┤         │    is 1 Region │
│       │   │  R  │ cam │  R  │         │    (256³)      │
│       │   ├─────┼─────┼─────┤         │                │
│       │   │  R  │  R  │  R  │         │                │
│       │   └─────┴─────┴─────┘         │                │
│       │                               │                │
│ (116358, 51626) ─────────────── (116467, 51626)        │
└────────────────────────────────────────────────────────┘
```

| Constant  | Value | Description                                   |
| --------- | ----- | --------------------------------------------- |
| REGION    | 256   | Voxel count per Region edge                   |
| SLOT      | 16    | Maximum concurrent Region textures            |
| PREBUILD  | 4     | Regions to pre-generate meshes outside camera |
| PREFETCH  | 4     | Regions to pre-fetch images outside camera    |
| PREPURGE  | 32    | Maximum Regions to keep in memory             |
| MAX_RETRY | 3     | Retries before permanent error state          |

## Data Flow: Transformation Process from Atlas Image to Mesh Rendering

Atlas images are PNGs where 3D Morton curves are mapped using 2D Morton curves.
The Worker thread decodes images and generates instance rendering data through Greedy Meshing.

```ts
┌────────────────────────────────────────────────────────────────────────────┐
│                        Data Transformation Pipeline                        │
├────────────────────────────────────────────────────────────────────────────┤
│ CDN/R2           Worker Thread                     Main Thread             │
│ ──────           ─────────────                     ───────────             │
│ ┌─────────┐      ┌──────────────────────────┐      ┌─────────────────────┐ │
│ │ Atlas   │ ───▶ │ 1. fetch (get PNG)       │      │ 6. merge (combine)  │ │
│ │  PNG    │      │ 2. createImageBitmap     │      │ 7. commit (finalize)│ │
│ │4096×4096│      │ 3. getImageData          │ ───▶ │ 8. draw (render)    │ │
│ └─────────┘      │ 4. atlas2occ (Morton inv)│      └─────────────────────┘ │
│                  │ 5. greedyMesh (WASM)     │                              │
│                  └──────────────────────────┘                              │
│ Output Format:                                                             │
│ ┌────────────────────────────────────────────────────────────────────┐     │
│ │ bitmap: ImageBitmap (for texture)                                  │     │
│ │ occ: Uint8Array[256³] (for collision detection)                    │     │
│ │ mesh: { pos: Float32Array, scl: Float32Array, cnt: number }        │     │
│ └────────────────────────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────────────────────┘
```

## Priority Scheduling: Dynamic Task Control Based on Camera Position

Queue manages tasks in two buckets (high/low) and dynamically changes priority based on camera movement.
Processing order is: visible (in camera) > prebuild (near, outside camera) > prefetch (far, outside camera).

```ts
┌───────────────────────────────────────────────────────────────────────┐
│                    Priority and State Transitions                     │
├───────────────────────────────────────────────────────────────────────┤
│ Priority                                                              │
│   3  ┌─────────────────────────────────────┐                          │
│      │  visible (in camera)                │ ← full mode, immediate   │
│   2  ├─────────────────────────────────────┤                          │
│      │  prebuild (pre-generate mesh)       │ ← full mode, up to 4     │
│   1  ├─────────────────────────────────────┤                          │
│      │  prefetch (pre-fetch image)         │ ← image mode, up to 4    │
│   0  ├─────────────────────────────────────┤                          │
│      │  (no task)                          │                          │
│  -1  ├─────────────────────────────────────┤                          │
│      │  abort (cancel task)                │ ← moved away from camera │
│      └─────────────────────────────────────┘                          │
│                                                                       │
│ Concurrency Limits:                                                   │
│   high (priority > 0): max 4 concurrent tasks                         │
│   low  (priority ≤ 0): max 1 concurrent task                          │
└───────────────────────────────────────────────────────────────────────┘
```

| Priority | State    | Mode  | Processing                                 |
| -------- | -------- | ----- | ------------------------------------------ |
| 3        | visible  | full  | fetch image + generate mesh + render       |
| 2        | prebuild | full  | fetch image + generate mesh (await render) |
| 1        | prefetch | image | fetch image only                           |
| -1       | abort    | -     | cancel in-progress task                    |

## Region Lifecycle: State Management from Creation to Disposal

Region has internal states: level (completion degree), request (current request), and isError (permanent failure).
Level progresses 'none' → 'image' → 'full', or 'none' → 'error' after MAX_RETRY (3) failures.
Returns to 'none' via dispose when moving away from camera.

```ts
┌───────────────────────────────────────────────────────────────────────┐
│                    Region State Transition Diagram                    │
├───────────────────────────────────────────────────────────────────────┤
│                 tune('image', 1)                                      │
│      ┌───────────────────────────────────────────────┐                │
│      │                                               ▼                │
│ ┌────┴──┐       tune('full', 2)    ┌──────────┐    Worker   ┌───────┐ │
│ │  none │ ───────────────────────▶ │ fetching │ ──────────▶ │ image │ │
│ └───────┘                          └────┬─────┘             └───┬───┘ │
│      ▲ dispose()                        │ tune('full', 3)       │     │
│      │                                  ▼                       ▼     │
│ ┌────┴───┐      tune('none', -1)   ┌──────────┐    Worker   ┌──────┐  │
│ │ purged │ ◀────────────────────── │ building │ ──────────▶ │ full │  │
│ └────────┘                         └────┬─────┘             └──────┘  │
│      ▲                                  │ fail 3x                     │
│      │ dispose()                        ▼                             │
│      │                             ┌───────┐                          │
│      └─────────────────────────────│ error │ ← skip render            │
│                                    └───────┘                          │
│ Internal Variables:                                                   │
│   level   = 'none' | 'image' | 'full' | 'error' ← completion state    │
│   request = 'none' | 'image' | 'full'  ← current request              │
│   ticket  = number                     ← request ID (ignore stale)    │
│   isError = boolean                    ← permanent error flag         │
│   retry   = number                     ← failures before error        │
└───────────────────────────────────────────────────────────────────────┘
```

## Slot Management: Texture Unit Allocation and Reuse

Slot manages the mapping between Regions and texture slots (default 16).
It assigns slots sequentially to visible Regions and produces SlotUpdate objects
that the consumer (glre, THREE.js, etc.) uses to perform actual texture uploads.
Slots from Regions outside camera are released and reassigned to new Regions.

```ts
┌────────────────────────────────────────────────────────────────────────┐
│                       Slot Allocation Structure                        │
├────────────────────────────────────────────────────────────────────────┤
│ Slot Array                         Regions                             │
│ ──────────                         ────────                           │
│ slot[0]  ◀───────────────────────▶  Region(i,j)                       │
│ slot[1]  ◀───────────────────────▶  Region(i,j)                       │
│ ...                                                                    │
│ slot[15] ◀───────────────────────▶  Region(i,j)                       │
│                                                                        │
│ SlotUpdate Output: { at: number, atlas: ImageBitmap, offset: vec3 }    │
│                                                                        │
│ Processing Flow (step function):                                       │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ 1. Iterate through pending array                                   │ │
│ │ 2. Skip fetching Regions (hasPending = true)                       │ │
│ │ 3. Skip error Regions (if isError() is true)                       │ │
│ │ 4. Find empty slot and assign Region                               │ │
│ │ 5. Produce SlotUpdate { at, atlas, offset } for consumer           │ │
│ │ 6. Combine vertex data with mesh.merge                             │ │
│ │ 7. On all Regions complete: mesh.commit → reflect in render        │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

## Morton Curve: Bidirectional Conversion Between 3D and 2D Texture Coordinates

Atlas images serialize space using 3D Morton curves, then map to image coordinates using 2D Morton curves.
This places spatially adjacent voxels close together in the image, improving cache efficiency.

```ts
┌─────────────────────────────────────────────────────────────────────────┐
│                 Morton Curve Coordinate Transformation                  │
├─────────────────────────────────────────────────────────────────────────┤
│ 3D Space (x, y, z)      3D Morton        2D Morton        2D Image      │
│ ──────────────────      ─────────        ─────────        ────────      │
│     z                                                     ┌──────┐      │
│     │   ┌────┐          xyz2m()          m2uv()           │      │      │
│     │  /    /│     ───────────────▶  ───────────────▶     │ PNG  │      │
│     │ ┌────┐ │          24bit            16bit × 2        │4096² │      │
│     │ │    │/                                             │      │      │
│     └─┴────┴─── x                                         └──────┘      │
│    /                                                                    │
│   y                                                                     │
│ Inverse Transform (decoding):                                           │
│     uv2m()              m2xyz()                                         │
│   2D coord ─────────▶ Morton val ─────────▶ 3D coord ─────────▶ occ arr │
│                                                                         │
│ Calculation (bit operations):                                           │
│   3D Morton: m = x | (y << 1) | (z << 2)  (bit interleaving)            │
│   2D Morton: m = x | (y << 1)                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

| Function  | Input     | Output     | Description                   |
| --------- | --------- | ---------- | ----------------------------- |
| xyz2m     | (x, y, z) | morton     | 3D coord → 3D Morton value    |
| m2xyz     | morton    | [x, y, z]  | 3D Morton value → 3D coord    |
| uv2m      | (u, v)    | morton     | 2D coord → 2D Morton value    |
| m2uv      | morton    | [u, v]     | 2D Morton value → 2D coord    |
| atlas2occ | ImageData | Uint8Array | Atlas image → occupancy array |

## Camera Control: Three View Modes and Collision Detection

Camera behavior switches based on mode.
mode=-1 is overhead scroll, mode=0 is free flight, mode=1 is first-person walk.
In mode=1, Collider applies AABB collision detection and gravity.

```ts
┌──────────────────────────────────────────────────────────────────┐
│                      Camera Mode Comparison                      │
├──────────────────────────────────────────────────────────────────┤
│ mode = -1 (overhead)     mode = 0 (flight)       mode = 1 (walk) │
│ ────────────────────     ─────────────────       ─────────────── │
│      ▽ camera                 ● camera               ● camera    │
│     /│\                      /│\                    /│\          │
│    / │ \                    / │ \                  / │ \         │
│   ───┼───                  free move              ───┼───        │
│      │ scroll              360° rotate       gravity + collision │
│ ═════╪═════                                     ═════╪═════      │
│   ground fixed                                    ground walk    │
│                                                                  │
│ Input Controls:                                                  │
│   WASD: forward/back/left/right movement                         │
│   Space: mode=0 ascend, mode=1 jump                              │
│   Shift: mode=0 descend, mode=1 dash                             │
│   Mouse: mode=0,1 view rotation                                  │
└──────────────────────────────────────────────────────────────────┘
```

| Parameter  | Default         | Description                  |
| ---------- | --------------- | ---------------------------- |
| X, Y, Z    | 0, 0, 0         | Initial position             |
| yaw, pitch | 0, 0            | Initial view angle (radians) |
| MOVE       | 12              | Movement speed (m/s)         |
| DASH       | 3               | Dash multiplier              |
| JUMP       | 12              | Jump initial velocity (m/s)  |
| GRAVITY    | -50             | Gravity acceleration (m/s²)  |
| SIZE       | [0.8, 1.8, 0.8] | Collision box size           |
| TURN       | 1/250           | View rotation sensitivity    |

## Worker Processing: Asynchronous Execution Without Blocking Main Thread

Worker communicates through Bridge inside Store.
Each task is assigned an ID and can be aborted via AbortController.
If Worker crashes, it automatically respawns.

```ts
┌──────────────────────────────────────────────────────────┐
│       Main Thread ⇔ Worker Communication Protocol        │
├──────────────────────────────────────────────────────────┤
│ Main Thread                              Worker Thread   │
│ ───────────                              ─────────────   │
│ ┌─────────────┐   postMessage            ┌─────────────┐ │
│ │   Bridge    │ ────────────────────────▶│  onmessage  │ │
│ │             │   { id, i, j, mode }     │             │ │
│ │ pending Map │                          │ controllers │ │
│ │  id → {     │                          │   Map       │ │
│ │   resolve,  │                          │             │ │
│ │   reject,   │   postMessage            │             │ │
│ │   timeout   │ ◀────────────────────────│   post()    │ │
│ │  }          │   { id, bitmap,          │             │ │
│ └─────────────┘     mesh, occ, mode }    └─────────────┘ │
│                                                          │
│ Abort Sequence:                                          │
│ 1. abort() called → signal.aborted = true                │
│ 2. postMessage({ id, abort: true }) notifies Worker      │
│ 3. Worker side: controllers.get(id).abort()              │
│ 4. fetch terminates with AbortError                      │
│                                                          │
│ Timeout: auto-reject after 8000ms                        │
│ On crash: worker.terminate() → spawn new Worker          │
└──────────────────────────────────────────────────────────┘
```

| Message Type     | Direction   | Fields                      | Description |
| ---------------- | ----------- | --------------------------- | ----------- |
| Execute request  | Main→Worker | id, i, j, mode              | Start task  |
| Abort request    | Main→Worker | id, abort                   | Cancel task |
| Success response | Worker→Main | id, bitmap, mesh, occ, mode | On success  |
| Error response   | Worker→Main | id, mode='error', error     | On failure  |

## Debug Feature: Event-based State Monitoring

Debug is implemented using listener pattern.
Register handlers with onDebug to receive real-time state changes.
When there are 0 listeners, no measurements are taken, ensuring no impact on production environments.

```ts
┌───────────────────────────────────────────────────────────────────────────┐
│                           Debug Event Structure                           │
├───────────────────────────────────────────────────────────────────────────┤
│  const debug = createDebug()                                              │
│  debug.onDebug((event) => {                                               │
│    event.ts       // timestamp                                            │
│    event.anchor   // [i, j] Region coord of camera position               │
│    event.cells    // DebugCell[] state array of all Regions               │
│  })                                                                       │
│                                                                           │
│  DebugCell Structure:                                                     │
│  ┌────────────┬─────────────────────────────────────────────────────────┐ │
│  │ Field      │ Type and Description                                    │ │
│  ├────────────┼─────────────────────────────────────────────────────────┤ │
│  │ i, j       │ number: Region's Web Mercator tile coordinates          │ │
│  │ state      │ 'visible' | 'prebuild' | 'prefetch' | 'idle' | 'error'  │ │
│  │ cache      │ 'empty' | 'fetching' | 'building' | 'cached' | 'purged' │ │
│  │ prefetchMs │ number?: time taken for image fetch (ms)                │ │
│  │ prebuildMs │ number?: time taken for mesh generation (ms)            │ │
│  └────────────┴─────────────────────────────────────────────────────────┘ │
│                                                                           │
│  Event Trigger Timing:                                                    │
│    setAnchor  → on camera move                                            │
│    setState   → on Region state change                                    │
│    setCache   → on cache state change                                     │
│    taskStart  → on Worker task start                                      │
│    taskDone   → on Worker task complete                                   │
│    taskAbort  → on Worker task abort                                      │
│    prune      → on unnecessary Region removal                             │
└───────────────────────────────────────────────────────────────────────────┘
```

## Usage Pattern: Basic Initialization and Render Loop

```ts
const cam = createCamera({ X: 0, Y: 100, Z: 0 })
const scene = createScene(cam, worker, debug?)

const render = () => {
        cam.update(aspect)
        scene.render()
        scene.updates(({ at, atlas, offset }) => {
                // consumer handles texture upload (glre, THREE.js, etc.)
        })
        if (scene.updated) {
                // scene.pos, scene.scl, scene.aid, scene.count
        }
}
```

| Factory Function | Creates | Required Args              | Notes                    |
| ---------------- | ------- | -------------------------- | ------------------------ |
| createCamera     | Camera  | position/angle params      | 1 per canvas             |
| createScene      | Scene   | Camera, Worker, Debug?     | 1 per canvas             |
| createDebug      | Debug   | none                       | optional, for monitoring |

## Coordinate Transformation Utility Reference

| Function                  | Input                 | Output       | Description                      |
| ------------------------- | --------------------- | ------------ | -------------------------------- |
| offOf(i, j)               | tile coord            | [x, 0, z]    | Region's world coordinate offset |
| posOf(x, z)               | world coord           | [i, j]       | world coord → tile coord         |
| localOf(wx, wy, wz, i, j) | world coord, tile     | [lx, ly, lz] | local coord within Region        |
| local(x, y, z)            | local coord           | index        | index into 256³ array            |
| regionId(i, j)            | tile coord            | id           | Region's unique identifier       |
| scoped(i, j)              | tile coord            | boolean      | check if within valid range      |
| inRegion(x, y, z)         | local coord           | boolean      | check if within Region           |
| culling(MVP, rx, ry, rz)  | transform matrix, pos | boolean      | check if within view frustum     |
