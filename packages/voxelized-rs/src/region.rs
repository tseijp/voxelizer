use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use js_sys::{ Promise, Reflect, Function, Object, Set, Float32Array };
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use crate::utils as U;
use wasm_bindgen::JsValue;
use web_sys::{
    CanvasRenderingContext2d,
    HtmlImageElement,
    WebGl2RenderingContext,
    WebGlProgram,
    WebGlTexture,
    WebGlUniformLocation,
};

struct ChunkVox {
    vox: Vec<u8>,
}
struct RegionState {
    img: Option<HtmlImageElement>,
    pending: bool,
    chunks: Vec<(i32, i32, i32)>,
    cursor: usize,
    vox: HashMap<i32, ChunkVox>,
    ctx: Option<CanvasRenderingContext2d>,
    slot: i32,
}

#[wasm_bindgen]
pub struct Region {
    pub id: i32,
    pub i: i32,
    pub j: i32,
    pub x: f32,
    pub y: f32,
    pub z: f32,
    mesh: JsValue,
    queues: JsValue,
    st: Rc<RefCell<RegionState>>,
}

fn make_region(mesh: &JsValue, queues: &JsValue, i: i32, j: i32) -> Region {
    let (x, y, z) = U::off_of(i, j);
    let id = U::region_id(i, j);
    let mut q = Vec::new();
    for k in 0..U::CHUNK {
        for j2 in 0..U::CHUNK {
            for i2 in 0..U::CHUNK {
                q.push((i2, j2, k));
            }
        }
    }
    Region {
        id,
        i,
        j,
        x,
        y,
        z,
        mesh: mesh.clone(),
        queues: queues.clone(),
        st: Rc::new(
            RefCell::new(RegionState {
                img: None,
                pending: false,
                chunks: q,
                cursor: 0,
                vox: HashMap::new(),
                ctx: None,
                slot: -1,
            })
        ),
    }
}

#[wasm_bindgen]
impl Region {
    #[wasm_bindgen(getter)]
    pub fn slot(&self) -> i32 {
        self.st.borrow().slot
    }
    #[wasm_bindgen(setter)]
    pub fn set_slot(&mut self, v: i32) {
        self.st.borrow_mut().slot = v;
    }
    pub fn image(&self, _p: i32) -> Promise {
        self.prefetch(0)
    }
    pub fn chunk(&mut self, ctx: &CanvasRenderingContext2d, index: i32, budget: i32) -> bool {
        self.st.borrow_mut().ctx = Some(ctx.clone());
        let start = now();
        loop {
            let mut st = self.st.borrow_mut();
            if st.cursor >= st.chunks.len() {
                break;
            }
            if now() - start > (budget as f64) {
                return false;
            }
            let (ci, cj, ck) = st.chunks[st.cursor];
            st.cursor += 1;
            let key = chunk_key(ci, cj, ck);
            if st.vox.contains_key(&key) {
                continue;
            }
            if st.img.is_none() {
                return false;
            }
            let (ox, oy) = (
                ((ck & 3) * 1024 + ci * 64) as i32,
                ((ck >> 2) * 1024 + cj * 64) as i32,
            );
            let imgd = ctx.get_image_data(ox as f64, oy as f64, 64.0, 64.0).unwrap();
            let data = imgd.data();
            drop(st);
            let mut vox = vec![0u8;(U::CHUNK*U::CHUNK*U::CHUNK) as usize];
            let mut p = 0usize;
            for z in 0..U::CHUNK {
                for y in 0..U::CHUNK {
                    for x in 0..U::CHUNK {
                        let px = ((z & 3) * 16 + x) as i32;
                        let py = ((z >> 2) * 16 + y) as i32;
                        let si = ((py * 64 + px) * 4) as u32 as usize;
                        let a = data.get(si + 3).unwrap_or(&0);
                        vox[p] = if *a > 0 { 1 } else { 0 };
                        p += 1;
                    }
                }
            }
            let gm = crate::chunk::greedy_mesh(
                &js_sys::Uint8Array::from(vox.as_slice()),
                U::CHUNK as u32
            );
            let pos: Float32Array = Reflect::get(&gm, &"pos".into()).unwrap().unchecked_into();
            let scl: Float32Array = Reflect::get(&gm, &"scl".into()).unwrap().unchecked_into();
            let cnt = Reflect::get(&gm, &"count".into()).unwrap().as_f64().unwrap_or(0.0) as i32;
            offset_pos(
                &pos,
                ((ci * 16) as f32) + self.x,
                ((cj * 16) as f32) + self.y,
                ((ck * 16) as f32) + self.z
            );
            let obj = Object::new();
            let _ = Reflect::set(&obj, &"pos".into(), &pos);
            let _ = Reflect::set(&obj, &"scl".into(), &scl);
            let _ = Reflect::set(&obj, &"count".into(), &JsValue::from_f64(cnt as f64));
            let merge = Reflect::get(&self.mesh, &"merge".into())
                .unwrap()
                .unchecked_into::<Function>();
            let _ = merge.call2(&self.mesh, &obj, &JsValue::from_f64(index as f64));
            self.st.borrow_mut().vox.insert(key, ChunkVox { vox });
        }
        true
    }
    pub fn get(&self, ci: i32, cj: i32, ck: i32) -> JsValue {
        let key = chunk_key(ci, cj, ck);
        if let Some(v) = self.st.borrow().vox.get(&key) {
            let a = js_sys::Uint8Array::from(v.vox.as_slice());
            return a.into();
        }
        JsValue::UNDEFINED
    }
    pub fn dispose(&mut self) -> bool {
        let mut st = self.st.borrow_mut();
        st.chunks.clear();
        st.vox.clear();
        st.ctx = None;
        st.img = None;
        st.pending = false;
        st.cursor = 0;
        true
    }
    pub fn prefetch(&self, priority: i32) -> Promise {
        if self.st.borrow().img.is_some() {
            let v = self.st.borrow();
            return Promise::resolve(&JsValue::from(v.img.as_ref().unwrap()));
        }
        let url = format!("{}/{}_{}.png", U::ATLAS_URL, self.i, self.j);
        let queues_obj: &Object = self.queues.unchecked_ref();
        let st = self.st.clone();
        let start = Closure::wrap(
            Box::new(move || {
                let p = U::create_image(&url);
                let st2 = st.clone();
                let then = Closure::wrap(
                    Box::new(move |v: JsValue| {
                        let img: HtmlImageElement = v.unchecked_into();
                        let mut s = st2.borrow_mut();
                        s.img = Some(img.clone());
                        s.pending = false;
                    }) as Box<dyn FnMut(JsValue)>
                );
                let f: &Function = then.as_ref().unchecked_ref();
                let _ = p.then(f);
                then.forget();
                p
            }) as Box<dyn FnMut() -> Promise>
        );
        let o: Object = Reflect::get(queues_obj, &"schedule".into())
            .unwrap()
            .unchecked_into::<Function>()
            .call2(&self.queues, &start.into_js_value(), &JsValue::from_f64(priority as f64))
            .unwrap()
            .unchecked_into();
        start.forget();
        Reflect::get(&o, &"promise".into()).unwrap().unchecked_into()
    }
    pub fn ctx(&self) -> JsValue {
        self.st
            .borrow()
            .ctx.as_ref()
            .map(|c| JsValue::from(c))
            .unwrap_or(JsValue::UNDEFINED)
    }
    pub fn cursor(&mut self) -> i32 {
        self.st.borrow_mut().cursor = 0;
        0
    }
    pub fn peek(&self) -> JsValue {
        self.st
            .borrow()
            .img.as_ref()
            .map(|i| JsValue::from(i))
            .unwrap_or(JsValue::UNDEFINED)
    }
    pub fn fetching(&self) -> bool {
        let st = self.st.borrow();
        st.img.is_none() && st.pending
    }
}

#[wasm_bindgen]
pub struct Regions {
    mesh: JsValue,
    cam: JsValue,
    queues: JsValue,
    regions: std::cell::RefCell<HashMap<i32, JsValue>>,
}

#[wasm_bindgen(js_name = createRegions)]
pub fn create_regions(mesh: JsValue, cam: JsValue, q: JsValue) -> Regions {
    Regions { mesh, cam, queues: q, regions: std::cell::RefCell::new(HashMap::new()) }
}

#[wasm_bindgen]
impl Regions {
    pub fn vis(&self) -> Set {
        let mut list: Vec<(i32, i32, f32, i32)> = Vec::new();
        let pos_val = Reflect::get(&self.cam, &JsValue::from_str("pos")).unwrap();
        let pos = pos_val.unchecked_into::<Float32Array>();
        let p = [pos.get_index(0), pos.get_index(1), pos.get_index(2)];
        let (si, sj) = U::pos_of(&[p[0], p[1], p[2]]);
        {
            let mut m = self.regions.borrow_mut();
            let mesh = self.mesh.clone();
            let queues = self.queues.clone();
            let ensure = |m: &mut std::collections::HashMap<i32, JsValue>, rx: i32, ry: i32| {
                let id = U::region_id(rx, ry);
                if !m.contains_key(&id) {
                    let r = make_region(&mesh, &queues, rx, ry);
                    m.insert(id, JsValue::from(r));
                }
                id
            };
            for di in 0..U::PREFETCH * 2 {
                for dj in 0..U::PREFETCH * 2 {
                    let mut i = di - U::PREFETCH;
                    let mut j = dj - U::PREFETCH;
                    if i == 0 && j == 0 {
                        let id = ensure(&mut m, si, sj);
                        list.push((si, sj, -1.0, id));
                        continue;
                    }
                    let d = ((i * i + j * j) as f32).sqrt();
                    i += si;
                    j += sj;
                    if !U::scoped(i, j) {
                        continue;
                    }
                    let id = ensure(&mut m, i, j);
                    let r = m.get(&id).unwrap();
                    let x = Reflect::get(r, &JsValue::from_str("x"))
                        .unwrap()
                        .as_f64()
                        .unwrap_or(0.0) as f32;
                    let y = Reflect::get(r, &JsValue::from_str("y"))
                        .unwrap()
                        .as_f64()
                        .unwrap_or(0.0) as f32;
                    let z = Reflect::get(r, &JsValue::from_str("z"))
                        .unwrap()
                        .as_f64()
                        .unwrap_or(0.0) as f32;
                    let mvp_val = Reflect::get(&self.cam, &JsValue::from_str("MVP")).unwrap();
                    let vp = mvp_val.unchecked_into::<Float32Array>();
                    if !U::culling(&vp, x, y, z) && d > (U::SLOT as f32) {
                        continue;
                    }
                    if !U::culling(&vp, x, y, z) {
                        continue;
                    }
                    list.push((i, j, d, id));
                }
            }
        }
        list.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap());
        let mut set = Set::new(&JsValue::undefined());
        let m = self.regions.borrow();
        for (_, _, _, id) in list.into_iter().take(U::SLOT as usize) {
            let r = m.get(&id).unwrap();
            let _ = set.add(r);
        }
        set
    }
    pub fn pick(&self, wx: f32, _wy: f32, wz: f32) -> i32 {
        let (rxi, ryj) = (
            U::SCOPE_X0 + ((wx / (U::REGION as f32)).floor() as i32),
            U::SCOPE_Y1 - ((wz / (U::REGION as f32)).floor() as i32),
        );
        if rxi < U::SCOPE_X0 || rxi > U::SCOPE_X1 || ryj < U::SCOPE_Y0 || ryj > U::SCOPE_Y1 {
            return 0;
        }
        let id = U::region_id(rxi, ryj);
        let m = self.regions.borrow();
        let r = m.get(&id);
        if r.is_none() {
            return 0;
        }
        let r = r.unwrap();
        let x = Reflect::get(r, &JsValue::from_str("x")).unwrap().as_f64().unwrap_or(0.0) as f32;
        let y = Reflect::get(r, &JsValue::from_str("y")).unwrap().as_f64().unwrap_or(0.0) as f32;
        let z = Reflect::get(r, &JsValue::from_str("z")).unwrap().as_f64().unwrap_or(0.0) as f32;
        let lx = wx - x;
        let ly = 0.0 - y;
        let lz = wz - z;
        let ci = (lx / (U::CHUNK as f32)).floor() as i32;
        let cj = (ly / (U::CHUNK as f32)).floor() as i32;
        let ck = (lz / (U::CHUNK as f32)).floor() as i32;
        if ci < 0 || ci > 15 || cj < 0 || cj > 15 || ck < 0 || ck > 15 {
            return 0;
        }
        let get_fn: Function = Reflect::get(r, &JsValue::from_str("get")).unwrap().unchecked_into();
        let vox_js = get_fn
            .call3(
                r,
                &JsValue::from_f64(ci as f64),
                &JsValue::from_f64(cj as f64),
                &JsValue::from_f64(ck as f64)
            )
            .unwrap();
        if vox_js.is_undefined() {
            return 0;
        }
        let vx = ((lx - (ci as f32) * (U::CHUNK as f32)).floor() as i32).clamp(0, 15);
        let vy = ((ly - (cj as f32) * (U::CHUNK as f32)).floor() as i32).clamp(0, 15);
        let vz = ((lz - (ck as f32) * (U::CHUNK as f32)).floor() as i32).clamp(0, 15);
        let idx = (vx + (vy + vz * U::CHUNK) * U::CHUNK) as u32;
        let arr = js_sys::Uint8Array::from(vox_js);
        arr.get_index(idx) as i32
    }
}

fn chunk_key(i: i32, j: i32, k: i32) -> i32 {
    U::chunk_id(i, j, k)
}
fn offset_pos(a: &Float32Array, ox: f32, oy: f32, oz: f32) {
    let mut v = vec![0.0f32;a.length() as usize];
    a.copy_to(&mut v[..]);
    for i in (0..v.len()).step_by(3) {
        v[i] += ox;
        v[i + 1] += oy;
        v[i + 2] += oz;
    }
    a.copy_from(&v[..])
}
fn now() -> f64 {
    web_sys::window().unwrap().performance().unwrap().now()
}
