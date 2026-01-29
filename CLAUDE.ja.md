# voxelized-js 技術仕様書

## 概要: ボクセル空間をリアルタイム描画するためのストリーミングエンジン

voxelized-js は、大規模なボクセル空間を Web ブラウザ上でリアルタイム描画するためのライブラリである。
256³ ボクセル単位の「Region」を空間分割の基本単位とし、カメラ位置に応じて必要な Region だけを動的にロード・描画する仕組みを提供する。
Web Worker による非同期処理と優先度付きタスクキューにより、メインスレッドをブロックせずに Atlas 画像の取得・デコード・メッシュ生成を行う。

```ts
┌──────────────────────────────────────────────────────────────────────┐
│                      voxelized-js Architecture                       │
├──────────────────────────────────────────────────────────────────────┤
│ ┌─────────────┐    ┌──────────────┐    ┌─────────────┐               │
│ │   Camera    │───▶│    Scene     │───▶│    Mesh     │──▶ WebGL Draw │
│ │  (viewport) │    │ (coordinator)│    │  (vertices) │               │
│ └─────────────┘    └──────┬───────┘    └─────────────┘               │
│                           │                                          │
│        ┌──────────────────┼───────────────────┐                      │
│        ▼                  ▼                   ▼                      │
│ ┌─────────────┐    ┌──────────────┐    ┌─────────────┐               │
│ │    Store    │    │    Slots     │    │    Queue    │               │
│ │(Region ctrl)│    │(Texture ctrl)│    │ (Task ctrl) │               │
│ └──────┬──────┘    └──────────────┘    └──────┬──────┘               │
│        │                                      │                      │
│        ▼                                      ▼                      │
│ ┌─────────────┐                        ┌─────────────┐               │
│ │   Region    │◀──────────────────────▶│   Worker    │               │
│ │ (unit area) │                        │(off-thread) │               │
│ └─────────────┘                        └─────────────┘               │
│                                               │                      │
│                                               ▼                      │
│                                        CDN/R2 Storage                │
│                                       (Atlas delivery)               │
└──────────────────────────────────────────────────────────────────────┘
```

## 空間モデル: Web Mercator タイルとボクセル Region の対応関係

空間は Web Mercator 座標系のタイル (z=17) と 1 対 1 で対応する Region に分割される。
各 Region は 256×256×256 ボクセルを保持し、1 ボクセルは実世界で約 1m に相当する。
Region の識別子は Web Mercator の (i, j) 座標から一意に決定される。

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

| 定数名   | 値  | 説明                                       |
| -------- | --- | ------------------------------------------ |
| REGION   | 256 | 1 Region の一辺のボクセル数                |
| SLOT     | 16  | 同時に保持可能な Region テクスチャ数       |
| PREBUILD | 4   | カメラ外でメッシュを事前生成する Region 数 |
| PREFETCH | 4   | カメラ外で画像を事前取得する Region 数     |
| PREPURGE | 32  | メモリに保持する Region の最大数           |

## データフロー: Atlas 画像からメッシュ描画までの変換過程

Atlas 画像は 3D Morton 曲線を 2D Morton 曲線でマッピングした PNG である。
Worker スレッドで画像をデコードし、Greedy Meshing によりインスタンス描画用データを生成する。

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

## 優先度スケジューリング: カメラ位置に基づく動的タスク制御

Queue はタスクを high/low の 2 つのバケットで管理し、カメラ移動に応じて優先度を動的に変更する。
visible (カメラ内) > prebuild (カメラ外近距離) > prefetch (カメラ外遠距離) の順で処理される。

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

| 優先度 | 状態     | モード | 処理内容                           |
| ------ | -------- | ------ | ---------------------------------- |
| 3      | visible  | full   | 画像取得 + メッシュ生成 + 描画     |
| 2      | prebuild | full   | 画像取得 + メッシュ生成 (描画待ち) |
| 1      | prefetch | image  | 画像取得のみ                       |
| -1     | abort    | -      | 進行中タスクを中止                 |

## Region ライフサイクル: 生成から破棄までの状態管理

Region は level (処理完了度) と request (現在の要求) の 2 つの内部状態を持つ。
level は 'none' → 'image' → 'full' と進行し、カメラから離れると dispose により 'none' に戻る。

```ts
┌───────────────────────────────────────────────────────────────────────┐
│                    Region State Transition Diagram                    │
├───────────────────────────────────────────────────────────────────────┤
│                 tune('image', 1)                                      │
│      ┌───────────────────────────────────────────────┐                │
│      │                                               ▼                │
│ ┌────┴────┐     tune('full', 2)    ┌──────────┐    Worker   ┌───────┐ │
│ │  none   │ ─────────────────────▶ │ fetching │ ──────────▶ │ image │ │
│ └────┬────┘                        └────┬─────┘             └───┬───┘ │
│      ▲                                  │                       │     │
│      │ dispose()                        │ tune('full', 3)       │     │
│      │                                  ▼                       ▼     │
│ ┌────┴─────┐    tune('none', -1)   ┌──────────┐    Worker   ┌──────┐  │
│ │ purged   │ ◀──────────────────── │ building │ ──────────▶ │ full │  │
│ └──────────┘                       └──────────┘             └──────┘  │
│                                                                       │
│ Internal Variables:                                                   │
│   level   = 'none' | 'image' | 'full'  ← completion state             │
│   request = 'none' | 'image' | 'full'  ← current request              │
│   ticket  = number                     ← request ID (ignore stale)    │
└───────────────────────────────────────────────────────────────────────┘
```

## Slot 管理: テクスチャユニットの割り当てと再利用

Slot は WebGL の TextureUnit と Region を紐付ける。
SLOT 個 (デフォルト 16) のスロットを持ち、visible な Region に順次割り当てる。
カメラ外に出た Region のスロットは解放され、新しい Region に再割り当てされる。

```ts
┌────────────────────────────────────────────────────────────────────────┐
│                       Slot Allocation Structure                        │
├────────────────────────────────────────────────────────────────────────┤
│ Shader Uniforms              Slot Array                 Regions        │
│ ───────────────              ──────────                 ────────       │
│ iAtlas0  ─────────────────▶  slot[0] ◀───────────────▶  Region(i,j)    │
│ iOffset0                        │                                      │
│                              tex: WebGLTexture                         │
│ iAtlas1  ─────────────────▶  slot[1] ◀───────────────▶  Region(i,j)    │
│ iOffset1                        │                                      │
│ ...                            ...                                     │
│                                                                        │
│ iAtlas15 ─────────────────▶  slot[15] ◀──────────────▶  Region(i,j)    │
│ iOffset15                                                              │
│                                                                        │
│ Processing Flow (step function):                                       │
│ ┌────────────────────────────────────────────────────────────────────┐ │
│ │ 1. Iterate through pending array                                   │ │
│ │ 2. Skip fetching Regions (hasPending = true)                       │ │
│ │ 3. Find empty slot and assign Region                               │ │
│ │ 4. Upload bitmap via texImage2D                                    │ │
│ │ 5. Combine vertex data with mesh.merge                             │ │
│ │ 6. On all Regions complete: mesh.commit → reflect in render        │ │
│ └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

## Morton 曲線: 3D 座標と 2D テクスチャ座標の相互変換

Atlas 画像では 3D Morton 曲線で空間をシリアライズし、さらに 2D Morton 曲線で画像座標にマッピングする。
これにより空間的に近いボクセルが画像上でも近くに配置され、キャッシュ効率が向上する。

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

| 関数名    | 入力      | 出力       | 説明                   |
| --------- | --------- | ---------- | ---------------------- |
| xyz2m     | (x, y, z) | morton     | 3D 座標 → 3D Morton 値 |
| m2xyz     | morton    | [x, y, z]  | 3D Morton 値 → 3D 座標 |
| uv2m      | (u, v)    | morton     | 2D 座標 → 2D Morton 値 |
| m2uv      | morton    | [u, v]     | 2D Morton 値 → 2D 座標 |
| atlas2occ | ImageData | Uint8Array | Atlas 画像 → 占有配列  |

## カメラ制御: 3 つの視点モードと衝突判定

Camera は mode により動作が切り替わる。
mode=-1 は俯瞰スクロール、mode=0 は自由飛行、mode=1 は一人称歩行である。
mode=1 では Collider による AABB 衝突判定と重力が適用される。

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

| パラメータ | デフォルト      | 説明                    |
| ---------- | --------------- | ----------------------- |
| X, Y, Z    | 0, 0, 0         | 初期位置                |
| yaw, pitch | 0, 0            | 初期視線角度 (ラジアン) |
| MOVE       | 12              | 移動速度 (m/s)          |
| DASH       | 3               | ダッシュ倍率            |
| JUMP       | 12              | ジャンプ初速 (m/s)      |
| GRAVITY    | -50             | 重力加速度 (m/s²)       |
| SIZE       | [0.8, 1.8, 0.8] | 当たり判定サイズ        |
| TURN       | 1/250           | 視点回転感度            |

## Worker 処理: メインスレッドをブロックしない非同期実行

Worker は Store 内の Bridge を介して通信する。
各タスクには ID が割り振られ、AbortController により中断可能である。
Worker がクラッシュした場合は自動的に再生成される。

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

| メッセージ種別 | 方向        | フィールド                  | 説明       |
| -------------- | ----------- | --------------------------- | ---------- |
| 実行要求       | Main→Worker | id, i, j, mode              | タスク開始 |
| 中断要求       | Main→Worker | id, abort                   | タスク中断 |
| 完了応答       | Worker→Main | id, bitmap, mesh, occ, mode | 成功時     |
| エラー応答     | Worker→Main | id, mode='error', error     | 失敗時     |

## デバッグ機能: イベントベースの状態監視

Debug は listener パターンで実装されており、onDebug でハンドラを登録するとリアルタイムで状態変化を受信できる。
listener が 0 個の場合は何も計測しないため、本番環境への影響はない。

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
│  │ state      │ 'visible' | 'prebuild' | 'prefetch' | 'idle'            │ │
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

## 使用パターン: 基本的な初期化と描画ループ

```typescript
const cam = createCamera({ X: 0, Y: 100, Z: 0 })
const mesh = createMesh()
const scene = createScene(mesh, cam)

const render = (gl, program) => {
        cam.update(aspect)
        scene.render(gl, program)
        gl.instanceCount = mesh.draw(gl, program)
}
```

| ファクトリ関数 | 生成物 | 必要な引数           | 備考             |
| -------------- | ------ | -------------------- | ---------------- |
| createCamera   | Camera | 位置・角度パラメータ | 1 canvas に 1 個 |
| createMesh     | Mesh   | なし                 | 1 canvas に 1 個 |
| createScene    | Scene  | Mesh, Camera, Debug? | 1 canvas に 1 個 |
| createDebug    | Debug  | なし                 | 任意、監視用     |

## 座標変換ユーティリティ一覧

| 関数名                    | 入力                 | 出力         | 説明                            |
| ------------------------- | -------------------- | ------------ | ------------------------------- |
| offOf(i, j)               | タイル座標           | [x, 0, z]    | Region のワールド座標オフセット |
| posOf(x, z)               | ワールド座標         | [i, j]       | ワールド座標 → タイル座標       |
| localOf(wx, wy, wz, i, j) | ワールド座標, タイル | [lx, ly, lz] | Region 内ローカル座標           |
| local(x, y, z)            | ローカル座標         | index        | 256³ 配列へのインデックス       |
| regionId(i, j)            | タイル座標           | id           | Region の一意識別子             |
| scoped(i, j)              | タイル座標           | boolean      | 有効範囲内か判定                |
| inRegion(x, y, z)         | ローカル座標         | boolean      | Region 内か判定                 |
| culling(MVP, rx, ry, rz)  | 変換行列, 位置       | boolean      | 視錐台内か判定                  |
