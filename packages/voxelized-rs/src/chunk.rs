use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use js_sys::Reflect;
use crate::utils as U;
use web_sys::CanvasRenderingContext2d;
use std::rc::Rc;
use std::cell::RefCell;

fn idx(x: usize, y: usize, z: usize, n: usize) -> usize {
    x + (y + z * n) * n
}

struct ChunkState {
    is_meshed: bool,
    count: u32,
    vox: Option<Vec<u8>>,
    pos: Vec<f32>,
    scl: Vec<f32>,
}

#[wasm_bindgen]
#[derive(Clone)]
pub struct Chunk {
    pub id: i32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    i: i32,
    j: i32,
    k: i32,
    state: Rc<RefCell<ChunkState>>,
}

#[wasm_bindgen(js_name = greedyMesh)]
pub fn greedy_mesh(src: &js_sys::Uint8Array, size: u32) -> js_sys::Object {
    let n = size as usize;
    let mut data = src.to_vec();
    let mut pos: Vec<f32> = Vec::new();
    let mut scl: Vec<f32> = Vec::new();
    let mut count = 0u32;
    let mut i = 0usize;
    while i < n * n * n {
        let xi = i % n;
        let yi = (i / n) % n;
        let zi = i / (n * n);
        if data[i] > 0 {
            let mut w = 1usize;
            while xi + w < n && data[idx(xi + w, yi, zi, n)] > 0 {
                w += 1;
            }
            let mut h = 1usize;
            let mut ok = true;
            while yi + h < n && ok {
                for a in 0..w {
                    if data[idx(xi + a, yi + h, zi, n)] == 0 {
                        ok = false;
                        break;
                    }
                }
                if ok {
                    h += 1;
                }
            }
            let mut d = 1usize;
            let mut ok2 = true;
            while zi + d < n && ok2 {
                for b in 0..h {
                    for a in 0..w {
                        if data[idx(xi + a, yi + b, zi + d, n)] == 0 {
                            ok2 = false;
                            break;
                        }
                    }
                    if !ok2 {
                        break;
                    }
                }
                if ok2 {
                    d += 1;
                }
            }
            for k in 0..d {
                for j in 0..h {
                    for i2 in 0..w {
                        data[idx(xi + i2, yi + j, zi + k, n)] = 0;
                    }
                }
            }
            pos.push((w as f32) * 0.5 + (xi as f32));
            pos.push((h as f32) * 0.5 + (yi as f32));
            pos.push((d as f32) * 0.5 + (zi as f32));
            scl.push(w as f32);
            scl.push(h as f32);
            scl.push(d as f32);
            count += 1;
        }
        i += 1;
    }
    let o = js_sys::Object::new();
    let _ = js_sys::Reflect::set(&o, &"pos".into(), &js_sys::Float32Array::from(pos.as_slice()));
    let _ = js_sys::Reflect::set(&o, &"scl".into(), &js_sys::Float32Array::from(scl.as_slice()));
    let _ = js_sys::Reflect::set(&o, &"count".into(), &JsValue::from_f64(count as f64));
    o
}

#[wasm_bindgen(js_name = createChunk)]
pub fn create_chunk(i: i32, j: i32, k: i32) -> Chunk {
    let id = U::chunk_id(i, j, k);
    let x = (i * 16) as f32;
    let y = (j * 16) as f32;
    let z = (k * 16) as f32;
    Chunk {
        id,
        x,
        y,
        z,
        i,
        j,
        k,
        state: Rc::new(
            RefCell::new(ChunkState {
                is_meshed: false,
                count: 0,
                vox: None,
                pos: Vec::new(),
                scl: Vec::new(),
            })
        ),
    }
}

#[wasm_bindgen]
impl Chunk {
    #[wasm_bindgen(getter)]
    pub fn pos(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(self.state.borrow().pos.as_slice())
    }
    #[wasm_bindgen(getter)]
    pub fn scl(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(self.state.borrow().scl.as_slice())
    }
    pub fn load(&mut self, ctx: &CanvasRenderingContext2d) {
        let mut state = self.state.borrow_mut();
        if state.is_meshed {
            return;
        }
        let ox = ((self.k & 3) * 1024 + self.i * 64) as f64;
        let oy = ((self.k >> 2) * 1024 + self.j * 64) as f64;
        let tile = ctx.get_image_data(ox, oy, 64.0, 64.0).unwrap();
        let data = tile.data();
        let chunk_size = U::CHUNK as usize;
        let mut vox = vec![0u8; chunk_size * chunk_size * chunk_size];
        let mut p = 0;
        for z in 0..chunk_size {
            for y in 0..chunk_size {
                for x in 0..chunk_size {
                    let px = ((z & 3) * 16 + x) as usize;
                    let py = ((z >> 2) * 16 + y) as usize;
                    let si = (py * 64 + px) * 4;
                    let alpha = data.get(si + 3).unwrap_or(&0);
                    vox[p] = if *alpha > 128 { 1 } else { 0 };
                    p += 1;
                }
            }
        }
        let mesh_result = greedy_mesh(&js_sys::Uint8Array::from(vox.as_slice()), U::CHUNK as u32);
        let pos_array: js_sys::Float32Array = Reflect::get(&mesh_result, &"pos".into())
            .unwrap()
            .unchecked_into();
        let scl_array: js_sys::Float32Array = Reflect::get(&mesh_result, &"scl".into())
            .unwrap()
            .unchecked_into();
        let count = Reflect::get(&mesh_result, &"count".into())
            .unwrap()
            .as_f64()
            .unwrap_or(0.0) as u32;
        let mut pos = vec![0.0f32; pos_array.length() as usize];
        let mut scl = vec![0.0f32; scl_array.length() as usize];
        pos_array.copy_to(&mut pos);
        scl_array.copy_to(&mut scl);
        for i in 0..count as usize {
            let j = i * 3;
            pos[j] += self.x;
            pos[j + 1] += self.y;
            pos[j + 2] += self.z;
        }
        state.count = count;
        state.vox = Some(vox);
        state.pos = pos;
        state.scl = scl;
        state.is_meshed = true;
    }
    pub fn dispose(&mut self) {
        let mut state = self.state.borrow_mut();
        state.is_meshed = false;
        state.vox = None;
        state.pos.clear();
        state.scl.clear();
        state.count = 0;
    }
    pub fn count(&self) -> u32 {
        self.state.borrow().count
    }
    pub fn vox(&self) -> JsValue {
        if let Some(ref vox) = self.state.borrow().vox {
            js_sys::Uint8Array::from(vox.as_slice()).into()
        } else {
            JsValue::UNDEFINED
        }
    }
}
