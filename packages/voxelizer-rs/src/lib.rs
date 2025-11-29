use js_sys::{Uint8Array, Array, Object, Reflect};
use once_cell::sync::Lazy;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
        #[wasm_bindgen(js_namespace = console)]
        pub fn log(s: &str);
        #[wasm_bindgen(js_namespace = console)]
        pub fn error(s: &str);
}

#[allow(unused_macros)]
macro_rules! console_log {
        ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[allow(unused_macros)]
macro_rules! console_error {
        ($($t:tt)*) => (error(&format_args!($($t)*).to_string()))
}

static CANCEL: Lazy<AtomicBool> = Lazy::new(|| AtomicBool::new(false));
const BIAS: f32 = 1e-4; // to prevent RangeError when a voxel's position exceeds the voxel size

type V2 = [f32; 2];
type V3 = [f32; 3];
type V4 = [f32; 4];

#[derive(Deserialize, Clone)]
struct Tex { w: u32, h: u32, dat: Vec<u8> }

#[derive(Deserialize, Clone)]
struct Mat { base: V4, #[serde(default)] tex: Option<usize> }

#[derive(Deserialize, Clone)]
struct Tri { v0: V3, v1: V3, v2: V3, uv0: V2, uv1: V2, uv2: V2, mat: usize }

#[derive(Deserialize)]
struct AABB { min: V3, #[serde(rename = "max")] _max: V3 }

#[derive(Deserialize, Clone, Copy)]
struct Model { extent: V3, #[serde(rename = "center")] _center: V3 }

#[derive(Deserialize)]
struct Parsed { tris: Vec<Tri>, materials: Vec<Mat>, textures: Vec<Tex>, aabb: AABB, model: Model }

#[wasm_bindgen(start)]
pub fn wasm_start() {}

#[wasm_bindgen]
pub fn greet(_name: &str) {}

#[wasm_bindgen]
pub fn cancel() { CANCEL.store(true, Ordering::Relaxed) }

#[inline]
fn clamp_u8(x: f32) -> u8 { if x <= 0.0 { 0 } else if x >= 1.0 { 255 } else { (x * 255.0) as u8 } }

#[inline]
fn sub(a: V3, b: V3) -> V3 { [a[0]-b[0], a[1]-b[1], a[2]-b[2]] }

#[inline]
fn dot(a: V3, b: V3) -> f32 { a[0]*b[0] + a[1]*b[1] + a[2]*b[2] }

#[inline]
fn cross(a: V3, b: V3) -> V3 { [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]] }

#[derive(Clone, Copy)]
struct Hit { t: f32, u: f32, v: f32 }

fn ray_tri(orig: V3, dir: V3, v0: V3, v1: V3, v2: V3) -> Option<Hit> {
        let eps = 1e-7;
        let e1 = sub(v1, v0);
        let e2 = sub(v2, v0);
        let h = cross(dir, e2);
        let a = dot(e1, h);
        if a > -eps && a < eps { return None }
        let f = 1.0 / a;
        let s = sub(orig, v0);
        let u = f * dot(s, h);
        if u < 0.0 || u > 1.0 { return None }
        let q = cross(s, e1);
        let v = f * dot(dir, q);
        if v < 0.0 || u + v > 1.0 { return None }
        let t = f * dot(e2, q);
        if t <= eps { return None }
        Some(Hit { t, u, v })
}

#[inline]
fn barycenter(h: Hit) -> V3 { [1.0 - h.u - h.v, h.u, h.v] }

#[inline]
fn bary_uv(tri: &Tri, b: V3) -> V2 {
        [
                tri.uv0[0]*b[0] + tri.uv1[0]*b[1] + tri.uv2[0]*b[2],
                tri.uv0[1]*b[0] + tri.uv1[1]*b[1] + tri.uv2[1]*b[2]
        ]
}

#[inline]
fn sample(tex: &Tex, uv: V2) -> V4 {
        let mut u = uv[0] % 1.0; if u < 0.0 { u += 1.0 }
        let mut v = uv[1] % 1.0; if v < 0.0 { v += 1.0 }
        let x = (u * tex.w as f32).floor() as u32;
        let y = ((1.0 - v) * tex.h as f32).floor() as u32;
        let i = ((y * tex.w + x) * 4) as usize;
        if i + 3 < tex.dat.len() {
                [
                        tex.dat[i] as f32 / 255.0,
                        tex.dat[i+1] as f32 / 255.0,
                        tex.dat[i+2] as f32 / 255.0,
                        tex.dat[i+3] as f32 / 255.0
                ]
        } else { [0.0, 0.0, 0.0, 1.0] }
}

#[inline]
fn shade(mat: &Mat, textures: &Vec<Tex>, uv: V2) -> V4 {
        if let Some(ti) = mat.tex { if let Some(tex) = textures.get(ti) { return sample(tex, uv) } }
        mat.base
}

fn tri_bounds(t: &Tri) -> (V3, V3) {
        let mut bmin = [0.0; 3];
        let mut bmax = [0.0; 3];
        for axis in 0..3 {
                let a0 = t.v0[axis].min(t.v1[axis]).min(t.v2[axis]);
                let a1 = t.v0[axis].max(t.v1[axis]).max(t.v2[axis]);
                bmin[axis] = a0.floor();
                bmax[axis] = a1.ceil();
        }
        (bmin, bmax)
}

fn to_vox(p: V3, aabb_min: V3, size: V3) -> V3 {
        let mut out = [0.0;3];
        for axis in 0..3 { out[axis] = (p[axis] - aabb_min[axis]) * size[axis]; }
        out
}

#[wasm_bindgen]
pub fn voxelize_glb(glb: JsValue, chunk_w: u32, chunk_h: u32, chunk_d: u32) -> JsValue {
        CANCEL.store(false, Ordering::Relaxed);
        let parsed: Parsed = match serde_wasm_bindgen::from_value(glb) {
                Ok(p) => p,
                Err(e) => {
                        console_error!("Failed to parse GLB data: {:?}", e);
                        return JsValue::from(js_sys::Array::new())
                }
        };

        let chunk = 16u32;
        let grid = [ (chunk * chunk_w) as f32, (chunk * chunk_h) as f32, (chunk * chunk_d) as f32 ];
        let width = parsed.model.extent[0];
        let depth = parsed.model.extent[1];
        let height = parsed.model.extent[2];
        let size = [
                (grid[0]-1.0)/width.max(1e-6),
                (grid[1]-1.0)/depth.max(1e-6),
                (grid[2]-1.0)/height.max(1e-6)
        ];

        let mut tris: Vec<Tri> = parsed.tris.clone();
        for t in &mut tris {
                t.v0 = to_vox(t.v0, parsed.aabb.min, size);
                t.v1 = to_vox(t.v1, parsed.aabb.min, size);
                t.v2 = to_vox(t.v2, parsed.aabb.min, size);
        }

        let to_c = |v: f32| -> i32 {
                let vf = v.floor();
                let vi = vf as i32;
                vi.div_euclid(chunk as i32)
        };
        let mut bins: HashMap<(i32,i32,i32), Vec<usize>> = HashMap::new();
        for (i, t) in tris.iter().enumerate() {
                let (bmin, bmax) = tri_bounds(t);
                let x0 = to_c(bmin[0]); let x1 = to_c(bmax[0]);
                let y0 = to_c(bmin[1]); let y1 = to_c(bmax[1]);
                let z0 = to_c(bmin[2]); let z1 = to_c(bmax[2]);
                let x_min = 0; let x_max = chunk_w as i32 - 1;
                let y_min = 0; let y_max = chunk_h as i32 - 1;
                let z_min = 0; let z_max = chunk_d as i32 - 1;
                let xi0 = if x0 < x_min { x_min } else { x0 }; let xi1 = if x1 > x_max { x_max } else { x1 };
                let yi0 = if y0 < y_min { y_min } else { y0 }; let yi1 = if y1 > y_max { y_max } else { y1 };
                let zi0 = if z0 < z_min { z_min } else { z0 }; let zi1 = if z1 > z_max { z_max } else { z1 };
                if xi0 <= xi1 && yi0 <= yi1 && zi0 <= zi1 {
                        let mut ci = xi0; while ci <= xi1 { let mut cj = zi0; while cj <= zi1 { let mut ck = yi0; while ck <= yi1 {
                                bins.entry((ci,cj,ck)).or_default().push(i);
                                ck += 1;
                        } cj += 1; } ci += 1; }
                }
                if CANCEL.load(Ordering::Relaxed) { break }
        }

        let img = (chunk as f32 * (chunk as f32).sqrt()) as usize; // 64 when chunk=16
        let mut out: Array = Array::new();

        for ((ci,cj,ck), ids) in bins.into_iter() {
                if CANCEL.load(Ordering::Relaxed) { break }
                let px0 = (ci * chunk as i32) as i32;
                let py0 = (ck * chunk as i32) as i32;
                let pz0 = (cj * chunk as i32) as i32;
                let mut rgba = vec![0u8; img * img * 4];
                let mut used = false;

                let write = |x: i32, y: i32, z: i32, c: V4, buf: &mut [u8], used_flag: &mut bool| {
                        let lx = x - px0; if lx < 0 || lx >= 16 { return }
                        let ly = y - py0; if ly < 0 || ly >= 16 { return }
                        let lz = z - pz0; if lz < 0 || lz >= 16 { return }
                        let ox = (lz & 3) * 16;
                        let oy = (lz >> 2) * 16;
                        let u = (ox + lx) as usize;
                        let v = (oy + ly) as usize;
                        let idx = (v * 64 + u) * 4;
                        buf[idx] = clamp_u8(c[0]);
                        buf[idx+1] = clamp_u8(c[1]);
                        buf[idx+2] = clamp_u8(c[2]);
                        let a = clamp_u8(c[3]);
                        buf[idx+3] = a;
                        if a != 0 { *used_flag = true }
                };

                for &ti in &ids {
                        if CANCEL.load(Ordering::Relaxed) { break }
                        let t = &tris[ti];
                        let (bmin, bmax) = tri_bounds(t);
                        let min = [px0 as f32, py0 as f32, pz0 as f32];
                        let max = [px0 as f32 + 15.0, py0 as f32 + 15.0, pz0 as f32 + 15.0];
                        let mut ranges = [[0i32;2];3];
                        for axis in 0..3 {
                                let a0 = bmin[axis].max(min[axis]) as i32 - 1;
                                let a1 = bmax[axis].min(max[axis]) as i32 + 1;
                                ranges[axis] = [a0, a1];
                        }

                        let mats = &parsed.materials; let texs = &parsed.textures;
                        for axis in 0..3 {
                                let dir = match axis { 0 => [1.0,0.0,0.0], 1 => [0.0,1.0,0.0], _ => [0.0,0.0,1.0] };
                                let others = match axis { 0 => [1,2], 1 => [0,2], _ => [0,1] };
                                let mut a = ranges[others[0]][0];
                                while a <= ranges[others[0]][1] {
                                        let mut b = ranges[others[1]][0];
                                        while b <= ranges[others[1]][1] {
                                                let mut o = [0.0f32;3];
                                                o[axis] = min[axis] + BIAS;
                                                o[others[0]] = a as f32;
                                                o[others[1]] = b as f32;
                                                if let Some(h) = ray_tri(o, dir, t.v0, t.v1, t.v2) {
                                                        let mut p = [o[0], o[1], o[2]];
                                                        let q = min[axis] + BIAS + h.t;
                                                        p[axis] = q.floor();
                                                        let bcc = barycenter(h);
                                                        let uv = bary_uv(t, bcc);
                                                        let c = shade(&mats[t.mat], texs, uv);
                                                        write(p[0] as i32, p[1] as i32, p[2] as i32, c, &mut rgba, &mut used);
                                                }
                                                b += 1;
                                        }
                                        a += 1;
                                        if CANCEL.load(Ordering::Relaxed) { break }
                                }
                                if CANCEL.load(Ordering::Relaxed) { break }
                        }
                }
                if used {
                        let arr = &mut out;
                        let obj = Object::new();
                        let key = format!("{}.{}.{}", ci, cj, ck);
                        let _ = Reflect::set(&obj, &JsValue::from_str("key"), &JsValue::from_str(&key));
                        let u8 = Uint8Array::from(rgba.as_slice());
                        let _ = Reflect::set(&obj, &JsValue::from_str("rgba"), &u8.into());
                        arr.push(&obj);
                }
        }

        out.into()
}
