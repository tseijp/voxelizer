use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use js_sys::{ Promise, Reflect, Function, Object, Set, Float32Array };
use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;
use crate::utils as U;
use crate::mesh::{ Mesh };
use crate::chunk::{ Chunk, create_chunk };
use wasm_bindgen::JsValue;
use web_sys::{ CanvasRenderingContext2d, HtmlImageElement };

struct RegionState {
    img: Option<HtmlImageElement>,
    pending: bool,
    chunks: HashMap<i32, Chunk>,
    queue: Vec<Chunk>,
    cursor: usize,
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
    mesh: Rc<RefCell<Mesh>>,
    queues: JsValue,
    st: Rc<RefCell<RegionState>>,
}

fn make_region(mesh: &JsValue, queues: &JsValue, i: i32, j: i32) -> Region {
    let (x, y, z) = U::off_of(i, j);
    let id = U::region_id(i, j);
    let mut chunks = HashMap::new();
    let mut queue = Vec::new();
    for k in 0..16 {
        for j2 in 0..16 {
            for i2 in 0..16 {
                let c = create_chunk(i2, j2, k);
                let c_id = c.id;
                queue.push(c.clone());
                chunks.insert(c_id, c);
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
                chunks,
                queue,
                cursor: 0,
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
        let budget_ms = budget as f64;
        let checker = || now() - start < budget_ms;
        loop {
            let mut st = self.st.borrow_mut();
            if st.cursor >= st.queue.len() {
                break;
            }
            let mut c = st.queue[st.cursor].clone();
            st.cursor += 1;
            if st.img.is_none() {
                return false;
            }
            drop(st);
            if !checker() {
                return false;
            }
            c.load(ctx);
            let merge = Reflect::get(&self.mesh, &"merge".into())
                .unwrap()
                .unchecked_into::<Function>();
            let _ = merge.call2(
                &self.mesh,
                &JsValue::from(c.clone()),
                &JsValue::from_f64(index as f64)
            );
        }
        true
    }
    pub fn get(&self, ci: i32, cj: i32, ck: i32) -> JsValue {
        let key = U::chunk_id(ci, cj, ck);
        let chunk_exists = self.st.borrow().chunks.contains_key(&key);
        if !chunk_exists {
            return JsValue::UNDEFINED;
        }
        let chunk_ref = {
            let st = self.st.borrow();
            st.chunks.get(&key).cloned()
        };
        if let Some(chunk) = chunk_ref {
            return JsValue::from(chunk);
        }
        JsValue::UNDEFINED
    }
    pub fn dispose(&mut self) -> bool {
        let mut st = self.st.borrow_mut();
        for (_, mut chunk) in st.chunks.drain() {
            chunk.dispose();
        }
        st.queue.clear();
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
        {
            let mut st = self.st.borrow_mut();
            st.pending = true;
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
                let _ = p.then(&then);
                then.forget();
                p
            }) as Box<dyn FnMut() -> Promise>
        );
        let start_js = start.as_ref().clone();
        let o: Object = Reflect::get(queues_obj, &"schedule".into())
            .unwrap()
            .unchecked_into::<Function>()
            .call2(&self.queues, &start_js, &JsValue::from_f64(priority as f64))
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
    mesh: Rc<RefCell<Mesh>>,
    cam: JsValue,
    queues: JsValue,
    regions: std::cell::RefCell<HashMap<i32, JsValue>>,
}

#[wasm_bindgen(js_name = createRegions)]
pub fn create_regions(mesh: JsValue, cam: JsValue, q: JsValue) -> Regions {
    let mesh_rc = Rc::new(RefCell::new(mesh.unchecked_into::<Mesh>()));
    Regions { mesh: mesh_rc, cam, queues: q, regions: std::cell::RefCell::new(HashMap::new()) }
}

#[wasm_bindgen]
impl Regions {
    pub fn vis(&self) -> Set {
        let mut list: Vec<(i32, i32, f32, i32)> = Vec::new();
        let pos_val = Reflect::get(&self.cam, &JsValue::from_str("pos")).unwrap();
        let pos = pos_val.unchecked_into::<Float32Array>();
        let p = [pos.get_index(0), pos.get_index(1), pos.get_index(2)];
        let (si, sj) = U::pos_of(&[p[0], p[1], p[2]]);
        let mut prefetch_near: Vec<JsValue> = Vec::new();
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
            let mvp_val = Reflect::get(&self.cam, &JsValue::from_str("MVP")).unwrap();
            let vp = mvp_val.unchecked_into::<Float32Array>();
            let is_ready_fn: Function = Reflect::get(&self.mesh, &JsValue::from_str("isReady"))
                .unwrap()
                .unchecked_into();
            let mesh_ready = is_ready_fn.call0(&self.mesh).unwrap().as_bool().unwrap_or(false);
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
                    let (x, y, z) = U::off_of(i, j);
                    if !U::culling(&vp, x, y, z) && d > (U::SLOT as f32) {
                        continue;
                    }
                    if !U::scoped(i, j) {
                        continue;
                    }
                    let id = ensure(&mut m, i, j);
                    let r = m.get(&id).unwrap();
                    if d <= (U::SLOT as f32) {
                        if mesh_ready {
                            prefetch_near.push(r.clone());
                        }
                    }
                    if !U::culling(&vp, x, y, z) {
                        continue;
                    }
                    list.push((i, j, d, id));
                }
            }
        }
        list.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));
        let mut keep = Vec::new();
        for (i, j, d, id) in list.into_iter() {
            if !U::scoped(i, j) {
                continue;
            }
            keep.push((i, j, d, id));
            if keep.len() >= (U::SLOT as usize) {
                break;
            }
        }
        let keep_set = Set::new(&JsValue::undefined());
        {
            let m = self.regions.borrow();
            for (_, _, _, id) in &keep {
                let r = m.get(id).unwrap();
                let pf: Function = Reflect::get(r, &JsValue::from_str("prefetch"))
                    .unwrap()
                    .unchecked_into();
                let _ = pf.call1(r, &JsValue::from_f64(2.0));
                let _ = keep_set.add(r);
            }
        }
        let active = Set::new(&JsValue::undefined());
        if let Ok(Some(iter)) = js_sys::try_iter(&keep_set) {
            for v in iter {
                let r = v.unwrap();
                let _ = active.add(&r);
            }
        }
        for r in prefetch_near.into_iter() {
            let _ = active.add(&r);
            let fetching: Function = Reflect::get(&r, &JsValue::from_str("fetching"))
                .unwrap()
                .unchecked_into();
            let is_fetching = fetching.call0(&r).unwrap().as_bool().unwrap_or(false);
            if is_fetching {
                continue;
            }
            let pf: Function = Reflect::get(&r, &JsValue::from_str("prefetch"))
                .unwrap()
                .unchecked_into();
            let _ = pf.call1(&r, &JsValue::from_f64(0.0));
        }
        if let Some((oi, oj, _, _)) = keep.get(0).cloned() {
            let current_size = self.regions.borrow().len();
            if current_size <= (U::CACHE as usize) {
                return keep_set;
            }
            let mut to_remove: Vec<(f32, i32)> = Vec::new();
            {
                let map = self.regions.borrow();
                for (id, r) in map.iter() {
                    if active.has(r) {
                        continue;
                    }
                    let ri = Reflect::get(r, &JsValue::from_str("i"))
                        .unwrap()
                        .as_f64()
                        .unwrap_or(0.0) as i32;
                    let rj = Reflect::get(r, &JsValue::from_str("j"))
                        .unwrap()
                        .as_f64()
                        .unwrap_or(0.0) as i32;
                    let da = ((ri - oi) as f32).hypot((rj - oj) as f32);
                    to_remove.push((da, *id));
                }
            }
            to_remove.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            let mut map = self.regions.borrow_mut();
            for (_, rid) in to_remove.into_iter() {
                if map.len() <= (U::CACHE as usize) {
                    break;
                }
                if let Some(r) = map.remove(&rid) {
                    let disp: Function = Reflect::get(&r, &JsValue::from_str("dispose"))
                        .unwrap()
                        .unchecked_into();
                    let _ = disp.call0(&r);
                }
            }
        }
        keep_set
    }
    pub fn pick(&self, wx: f32, wy: f32, wz: f32) -> i32 {
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
        let ly = wy - y;
        let lz = wz - z;
        let ci = (lx / (U::CHUNK as f32)).floor() as i32;
        let cj = (ly / (U::CHUNK as f32)).floor() as i32;
        let ck = (lz / (U::CHUNK as f32)).floor() as i32;
        if ci < 0 || ci > 15 || cj < 0 || cj > 15 || ck < 0 || ck > 15 {
            return 0;
        }
        let get_fn: Function = Reflect::get(r, &JsValue::from_str("get")).unwrap().unchecked_into();
        let chunk_js = get_fn
            .call3(
                r,
                &JsValue::from_f64(ci as f64),
                &JsValue::from_f64(cj as f64),
                &JsValue::from_f64(ck as f64)
            )
            .unwrap();
        if chunk_js.is_undefined() {
            return 0;
        }
        let vox_fn: Function = Reflect::get(&chunk_js, &JsValue::from_str("vox"))
            .unwrap()
            .unchecked_into();
        let mut vox_data = vox_fn.call0(&chunk_js).unwrap();
        if vox_data.is_undefined() {
            let ctx_fn = Reflect::get(r, &JsValue::from_str("ctx"))
                .unwrap()
                .unchecked_into::<Function>();
            let ctx = ctx_fn.call0(r).unwrap();
            if !ctx.is_undefined() {
                let load_fn: Function = Reflect::get(&chunk_js, &JsValue::from_str("load"))
                    .unwrap()
                    .unchecked_into();
                let _ = load_fn.call1(&chunk_js, &ctx);
                vox_data = vox_fn.call0(&chunk_js).unwrap();
            }
        }
        if vox_data.is_undefined() {
            return 0;
        }
        let vx = (lx - (ci as f32) * (U::CHUNK as f32)).floor() as i32;
        let vy = (ly - (cj as f32) * (U::CHUNK as f32)).floor() as i32;
        let vz = (lz - (ck as f32) * (U::CHUNK as f32)).floor() as i32;
        if vx < 0 || vx > 15 || vy < 0 || vy > 15 || vz < 0 || vz > 15 {
            return 0;
        }
        let idx = (vx + (vy + vz * U::CHUNK) * U::CHUNK) as u32;
        let arr = js_sys::Uint8Array::from(vox_data);
        arr.get_index(idx) as i32
    }
}

fn now() -> f64 {
    web_sys::window().unwrap().performance().unwrap().now()
}
