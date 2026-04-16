# voxel-three

[`voxelized-js`](https://www.npmjs.com/package/voxelized-js) を Three.js に橋渡しするバインディング。ストリーミングで読み込まれる巨大なボクセルワールドを、単一の `THREE.InstancedMesh` のサブクラスとして扱えるようにする。素の Three.js シーンに追加することも、`@react-three/fiber` で `extend` してリアクティブな `<voxel />` JSX 要素として利用することも可能。

```ts
import * as THREE from 'three'
import Voxel from 'three-voxel'
import Worker from './worker?worker'

const scene = new THREE.Scene()
scene.add(new Voxel({ worker: new Worker() }))
```

## なぜ three-voxel か

`voxelized-js` はすでに、惑星規模のボクセルワールドを描画するための難所を引き受けている。Web メルカトルに基づくリージョンのストリーミング、アトラス画像のフェッチ、グリーディメッシュ化、優先度スケジューリング、スロット割り当てなど。いっぽうで、そのエンジンを Three.js に接続する部分は提供されていない。結果として、`voxelized-js` を利用する Three.js プロジェクトはどれも同じグルーコードを書き直すことになり、以下の 3 つの問題が発生していた。

重複。各プロジェクトが `4096 × 4096 × 16` の `DataArrayTexture` を確保し、Morton 曲線で UV を求める TSL シェーダを組み立て、毎フレーム `voxel.updates(...)` を呼び、`copyTextureToTexture` でアトラススロットをアップロードし、ユニフォーム配列を更新し、メッシュがオーバーフローしたときに instanced buffer attribute を作り直していた。コピー間の微妙な差異は避けがたかった。

座標の肥大化。`voxelized-js` は東京 23 区の北西端をワールド原点としているので、既定のシーンは `[22912, 800, 20096]` 付近から始まる。利用側はメッシュ、ユニフォーム、通信パケットのすべてに `center` を加算しており、描画結果は正しくても数値的にはノイジーで、マルチプレイヤーのペイロードも必要以上に大きかった。

カメラの橋渡し。あるプロジェクトでは Three のカメラ（`OrbitControls`、r3f のカメラ、ゲームパッド入力など）からエンジンを駆動し、別のプロジェクトではエンジン側の `scroll` / `creative` / `survive` モードが主導権を握ってその状態を Three に書き戻していた。双方向ともに手書きで、プロジェクトごとに挙動が微妙に違っていた。

`three-voxel` は、これらすべてを単一のクラスと 2 つの小さなヘルパー関数に集約する。そして `voxelized-js` の内部には一切触れずに、ワールドを `[0, 0, 0]` に再センタリングする。

## パッケージが提供するもの

### `Voxel` — `THREE.InstancedMesh` のサブクラス

デフォルトエクスポートは `THREE.InstancedMesh` を継承したクラス。コンストラクタで、ボクセルパイプラインに必要なリソースをすべて配線する。

`NearestFilter`、`ClampToEdgeWrapping`、mipmap 無効、`SRGBColorSpace` で構成された `4096 × 4096 × 16` の `DataArrayTexture`。これは `this.atlasNode` として公開される。スロットごとのオフセットを保持する 16 要素の `uniformArray<'vec3'>`。これは `this.offsetNode` として公開される。`positionNode` が `offset + pos + positionLocal * scl` を返し、`colorNode` が Morton 曲線の `atlas(ivec3)` TSL ヘルパーを経由してアトラスをサンプリングする `MeshBasicNodeMaterial`。`pos`（`vec3`）、`scl`（`vec3`）、`aid`（`float`）の各 instanced attribute がエンジンから供給される `BoxGeometry`。そして `this.voxel` に格納された `voxelized-js` エンジン本体と、`this.center` に格納されたその中心座標。

描画ループ全体は `onBeforeRender` の中で動く。これは Three.js が各オブジェクトに対して標準で呼び出すフック。`useFrame` も `voxel.updates()` の手動呼び出しも、外部からのテクスチャアップロードも不要で、Three がシーングラフを辿る過程でクラスがすべてを処理する。

### `atlas(ivec3)`、`xyz2m(ivec3)`、`m2uv(int)` — 共有 TSL ヘルパー

パッケージは、3D ボクセル座標を 2D アトラス UV に変換する Morton 曲線の TSL ヘルパーも公開している。これはコア側のシェーダが使っているビットインタリーブ処理と同じもので、任意の TSL フラグメントシェーダや compute シェーダから再利用できる。これはアトラスをレイマーチングする compute シェーダ（たとえば地面の高さを探す処理）が、レンダリング側と同じスロットを正しく参照するために重要。

```ts
import { atlas, xyz2m, m2uv } from 'three-voxel'
```

## 原点を `[0, 0, 0]` にする仕組み

`voxelized-js` のエンジン本体は、リージョンの検索やフラスタムカリングに必要なため、内部では依然として絶対メルカトル座標で動く。`three-voxel` はその部分を変更しない。変更するのは `offsetNode` に書き込むユニフォームだけで、`voxel.updates(...)` が返す生の `offset` ではなく `offset - center` を書き込む。TSL の `positionNode` が同じユニフォーム配列を読むため、描画結果のワールドはローカル原点にアンカーされる。

ここから 2 つの利点が派生する。1 つめは `this.position` がライブラリ側で触られないこと。利用者は `@react-three/fiber` からリアクティブに駆動できる。`<voxel position={[0, 1, 0]} rotation-z={Math.PI} />` がそのまま動くのは、r3f のレコンサイラが任意の `THREE.Object3D` への書き込み方を既に知っているため。2 つめはネットワークペイロードが小さくなること。マルチプレイヤーのデモでは `{ x + 22912, y + 800, z + 20096 }` ではなく、ローカル座標空間上の `{ x, y, z }` を送るだけで済む。

## カメラモード

`Voxel` インスタンスは `controls` オプションで 2 方向に駆動できる。

`controls: 'three'`（既定値）では、Three カメラが真実の源になる。フレームごとにクラスが `projectionMatrix` と `matrixWorldInverse` を読み取り、`-center` の平行移動と合成し、得られた行列を `voxel.cam.mvp` に書き込む。カメラ位置は `center` を加算し直したうえで `voxel.cam.pos` にコピーされ、ユーザには原点アンカーのワールドが見えている一方で、エンジンは引き続き絶対メルカトル座標を見ることになる。`OrbitControls`、`PointerLockControls`、その他ユーザ向けの Three カメラを使う場合はこちら。

`controls: 'voxel'` では、`voxelized-js` のカメラが真実の源になる。クラスはまず `voxel.cam.update(aspect)` を呼び、次に Three カメラを `voxel.cam.pos - center` に配置し、`voxel.cam.eye - center` を注視させ、Three カメラのワールド行列と射影行列を更新する。エンジン内蔵の `scroll` / `creative` / `survive` モードに視点を主導させたい場合（トップダウンのスクローラや、組み込みコリジョンを持つ一人称歩行デモなど）はこちら。

平行移動は両側で対称に適用されるので、`controls` を実行時に切り替えてもビューは整合する。

## 使い方

### 素の Three.js

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

フックも、カスタム描画コールバックも、手動のテクスチャアップロードも不要。シーンに追加するだけで、Three が適切なタイミングで `onBeforeRender` を呼んでくれる。

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

`extend({ Voxel })` によりクラスが r3f のレコンサイラに登録される。これ以降 `<voxel />` は通常の JSX 要素として振る舞い、`position`、`rotation`、`scale`、イベントハンドラがそのまま使える。`worker`、`i`、`j`、`camera` などの props は初回マウント時にコンストラクタへ渡される。

### アトラスを読む compute シェーダ

`this.atlasNode` と `this.offsetNode` はそのまま TSL ノードなので、ユーザ定義の compute シェーダから直接参照できる。以下の例は、ワールド座標における地面の高さを求めるため、アトラスのスロットを上から下へ走査している。

<!-- prettier-ignore -->
```ts
import { Fn, textureLoad, ivec3, int, If, Loop, Break } from 'three/tsl'
import { atlas } from 'three-voxel'

const findGround = (voxel) =>
        Fn(([wx, wz]) => {
                const iAtlas = voxel.atlasNode
                const iOffset = voxel.offsetNode
                // ... iOffset を走査して一致するスロットを探す
                // ... そのうえで y を Loop し、textureLoad(iAtlas, atlas(ivec3(lx, y, lz)), int(0)) を呼ぶ
        })
```

本質的に重要なのは、描画用マテリアルと compute シェーダが同一の `DataArrayTexture` を参照すること。GPU メモリの重複がゼロになる。

## コンストラクタのオプション

<!-- prettier-ignore -->
```ts
new Voxel({
        worker,        // 必須: voxelized-js の Web Worker
        i, j,          // 任意: 初期 Web メルカトルタイル座標
        camera,        // 任意: voxelized-js に転送する完全なカメラ設定
        controls,      // 'three'（既定）または 'voxel'
        debug,         // 任意: voxelized-js の Debug インスタンス
        onReady,       // 任意: 最初のメッシュが可視になったときに呼ばれる
})
```

それ以外のキーは `voxelized-js` の `createVoxel` ファクトリにそのまま転送される。`atlasUrl`、`atlasExt`、`slot`、`prebuild`、`prefetch` のような上級オプションも、パッケージ側で再定義せずに利用可能。

## 公開フィールドとメソッド

`voxel` は `voxelized-js` のエンジン本体を保持する。`voxel.cam.turn(...)`、`voxel.pick(x, y, z)`、`voxel.map` など、コアライブラリとまったく同じ API がそのまま使える。`atlasNode` はマテリアルがサンプリングする `DataArrayTexture` を保持する。`offsetNode` は `-center` で事前にシフト済みのスロットオフセットを持つ `uniformArray<'vec3'>` を保持する。`center` は絶対メルカトル空間における元の `[cx, cz]` 中心値を保持しており、絶対座標が依然として必要なユーザ側コード（たとえばピンのジオコーディング）はこの値を加算し直すことで得られる。

## 互換性と設計メモ

`voxelized-js` 本体には一切手を入れていない。リージョンカリング、スロット管理、ワーカブリッジ、優先度スケジューリング、デバッグフックは、コアパッケージのドキュメント通りに動き続ける。`three-voxel` は厳密に公開 API の上に立っているだけなので、エンジンを手書きで駆動し続けたいプロジェクトは今までどおり利用できる。

デフォルトエクスポートと名前付きエクスポート `Voxel` は同一のクラスを指し、`import Voxel from 'three-voxel'` と `import { Voxel } from 'three-voxel'` の双方で動く。`./src` サブパスエクスポートは、モノレポ内から tsup ビルドを経由せずソースを直接 import したい利用者向けで、`voxelized-js` と同じ規約に揃えている。

## 動作要件

Three.js `>= 0.180`、かつ `three/webgpu` と `three/tsl` が利用可能なこと。マテリアルが `MeshBasicNodeMaterial` の上に構築されているため、WebGPU 対応ブラウザ（または `WebGPURenderer` のフォールバック経路）が必要。`voxelized-js` の Web Worker インスタンスも必要で、通常は `new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })` か、バンドラ固有の `?worker` import で生成する。

## ライセンス

MIT
