use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use web_sys::{ WebGl2RenderingContext, WebGlBuffer, WebGlProgram };

#[wasm_bindgen]
pub struct Mesh {
    pos: Vec<f32>,
    scl: Vec<f32>,
    aid: Vec<f32>,
    count: u32,
    _pos: Vec<f32>,
    _scl: Vec<f32>,
    _aid: Vec<f32>,
    _count: u32,
    is_ready: bool,
    buf_pos: Option<WebGlBuffer>,
    buf_scl: Option<WebGlBuffer>,
    buf_aid: Option<WebGlBuffer>,
    len_pos: u32,
    len_scl: u32,
    len_aid: u32,
}

#[wasm_bindgen(js_name = createMesh)]
pub fn create_mesh() -> Mesh {
    Mesh {
        pos: vec![0.0, 0.0, 0.0],
        scl: vec![1.0, 1.0, 1.0],
        aid: vec![0.0],
        count: 1,
        _pos: Vec::new(),
        _scl: Vec::new(),
        _aid: Vec::new(),
        _count: 0,
        is_ready: false,
        buf_pos: None,
        buf_scl: None,
        buf_aid: None,
        len_pos: 0,
        len_scl: 0,
        len_aid: 0,
    }
}

#[wasm_bindgen]
impl Mesh {
    pub fn merge(&mut self, chunk: &JsValue, index: u32) {
        let p = js_sys::Reflect::get(chunk, &"pos".into()).ok();
        let s = js_sys::Reflect::get(chunk, &"scl".into()).ok();
        let c = js_sys::Reflect::get(chunk, &"count".into()).ok();
        if let (Some(p), Some(s), Some(c)) = (p, s, c) {
            let pa = js_sys::Float32Array::new(&p);
            let sa = js_sys::Float32Array::new(&s);
            let cnt = c.as_f64().unwrap_or(0.0) as u32;
            let mut tmp = vec![0.0f32;pa.length() as usize];
            pa.copy_to(&mut tmp[..]);
            self._pos.extend_from_slice(&tmp);
            let mut tmp2 = vec![0.0f32;sa.length() as usize];
            sa.copy_to(&mut tmp2[..]);
            self._scl.extend_from_slice(&tmp2);
            for _ in 0..cnt {
                self._aid.push(index as f32);
            }
            self._count += cnt;
        }
    }
    pub fn reset(&mut self) {
        self._pos.clear();
        self._scl.clear();
        self._aid.clear();
        self._count = 0;
    }
    pub fn commit(&mut self) -> bool {
        if self._count == 0 {
            return false;
        }
        self.pos.swap_with_slice(&mut self._pos);
        self.scl.swap_with_slice(&mut self._scl);
        self.aid.swap_with_slice(&mut self._aid);
        self.count = self._count;
        self.reset();
        self.is_ready = true;
        true
    }
    pub fn draw(&mut self, c: &JsValue, pg: &JsValue) -> u32 {
        let c: WebGl2RenderingContext = c.clone().unchecked_into();
        let pg: WebGlProgram = pg.clone().unchecked_into();
        if self.count == 0 {
            self.pos = vec![0.0, 0.0, 0.0];
            self.scl = vec![1.0, 1.0, 1.0];
            self.aid = vec![0.0];
            self.count = 1;
        }
        let scl = self.scl.clone();
        let pos = self.pos.clone();
        let aid = self.aid.clone();
        self.attr(&c, &pg, &scl, "scl", 3);
        self.attr(&c, &pg, &pos, "pos", 3);
        self.attr(&c, &pg, &aid, "aid", 1);
        self.count
    }
    pub fn count(&self) -> u32 {
        self.count
    }
    pub fn isReady(&self) -> bool {
        self.is_ready
    }
    fn attr(
        &mut self,
        c: &WebGl2RenderingContext,
        pg: &WebGlProgram,
        data: &[f32],
        key: &str,
        size: i32
    ) {
        let loc = c.get_attrib_location(pg, key) as u32;
        let array = js_sys::Float32Array::from(data);
        let (buf, len_slot) = match key {
            "pos" => (&mut self.buf_pos, &mut self.len_pos),
            "scl" => (&mut self.buf_scl, &mut self.len_scl),
            _ => (&mut self.buf_aid, &mut self.len_aid),
        };
        if buf.is_none() {
            *buf = c.create_buffer();
        }
        c.bind_buffer(WebGl2RenderingContext::ARRAY_BUFFER, buf.as_ref());
        if *len_slot != array.length() {
            c.buffer_data_with_array_buffer_view(
                WebGl2RenderingContext::ARRAY_BUFFER,
                &array,
                WebGl2RenderingContext::DYNAMIC_DRAW
            );
            *len_slot = array.length();
            c.enable_vertex_attrib_array(loc);
            c.vertex_attrib_pointer_with_i32(loc, size, WebGl2RenderingContext::FLOAT, false, 0, 0);
            c.vertex_attrib_divisor(loc, 1);
        } else {
            c.buffer_sub_data_with_i32_and_array_buffer_view(
                WebGl2RenderingContext::ARRAY_BUFFER,
                0,
                &array
            );
        }
    }
}
