use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use js_sys::{ Set, Reflect, Function };
use crate::utils as U;
use web_sys::{
    CanvasRenderingContext2d,
    WebGl2RenderingContext,
    WebGlProgram,
    WebGlUniformLocation,
    WebGlTexture,
};

#[wasm_bindgen]
struct Slot {
    ctx: CanvasRenderingContext2d,
    tex: Option<WebGlTexture>,
    atlas: Option<WebGlUniformLocation>,
    offset: Option<WebGlUniformLocation>,
    region: Option<JsValue>,
    is_ready: bool,
    index: i32,
}
#[wasm_bindgen]
pub struct Slots {
    owner: Vec<Slot>,
    pending: Vec<JsValue>,
    cursor: usize,
    keep: Set,
}

#[wasm_bindgen(js_name = createSlots)]
pub fn create_slots(size: i32) -> Slots {
    let owner = (0..size)
        .map(|i| Slot {
            ctx: U::create_context(),
            tex: None,
            atlas: None,
            offset: None,
            region: None,
            is_ready: false,
            index: i,
        })
        .collect();
    Slots { owner, pending: Vec::new(), cursor: 0, keep: Set::new(&JsValue::undefined()) }
}

#[wasm_bindgen]
impl Slots {
    fn assign(
        &mut self,
        c: &WebGl2RenderingContext,
        pg: &WebGlProgram,
        r: JsValue,
        budget: i32
    ) -> bool {
        let mut index = Reflect::get(&r, &JsValue::from_str("slot"))
            .unwrap_or(JsValue::from_f64(-1.0))
            .as_f64()
            .unwrap_or(-1.0) as i32;
        let region_is_same = if index >= 0 {
            let this_id = Reflect::get(&r, &JsValue::from_str("id"))
                .unwrap()
                .as_f64()
                .unwrap_or(0.0) as i32;
            self.owner[index as usize].region
                .as_ref()
                .map(
                    |x|
                        Reflect::get(x, &JsValue::from_str("id"))
                            .unwrap()
                            .as_f64()
                            .unwrap_or(0.0) as i32
                ) == Some(this_id)
        } else {
            false
        };
        if index < 0 {
            if let Some(i) = self.owner.iter().position(|s| s.region.is_none()) {
                index = i as i32;
                {
                    let slot = &mut self.owner[i as usize];
                    slot.region = Some(r.clone());
                    slot.is_ready = false;
                }
                let _ = Reflect::set(
                    &r,
                    &JsValue::from_str("slot"),
                    &JsValue::from_f64(index as f64)
                );
            } else {
                return false;
            }
        } else {
            if !region_is_same {
                return false;
            }
        }
        let need_ready = {
            let s = &self.owner[index as usize];
            !s.is_ready
        };
        if need_ready {
            if !self.ready(c, pg, index) {
                return false;
            }
        }
        let chunk_fn: Function = Reflect::get(&r, &JsValue::from_str("chunk"))
            .unwrap()
            .unchecked_into();
        let ctx2 = { self.owner[index as usize].ctx.clone() };
        let ok = chunk_fn
            .call3(&r, &ctx2, &JsValue::from_f64(index as f64), &JsValue::from_f64(budget as f64))
            .unwrap()
            .as_bool()
            .unwrap_or(false);
        if !ok {
            return false;
        }
        true
    }
    fn ready(&mut self, c: &WebGl2RenderingContext, pg: &WebGlProgram, index: i32) -> bool {
        let slot = &mut self.owner[index as usize];
        let Some(r) = slot.region.as_ref() else {
            return true;
        };
        let peek: Function = Reflect::get(r, &JsValue::from_str("peek")).unwrap().unchecked_into();
        let prefetch: Function = Reflect::get(r, &JsValue::from_str("prefetch"))
            .unwrap()
            .unchecked_into();
        let img = peek.call0(r).unwrap();
        if img.is_undefined() {
            let _ = prefetch.call1(r, &JsValue::from_f64(2.0));
            return false;
        }
        let img: web_sys::HtmlImageElement = img.unchecked_into();
        if slot.atlas.is_none() {
            slot.atlas = c.get_uniform_location(pg, &format!("iAtlas{}", index));
        }
        if slot.offset.is_none() {
            slot.offset = c.get_uniform_location(pg, &format!("iOffset{}", index));
        }
        if slot.tex.is_none() {
            slot.tex = c.create_texture();
        }
        c.active_texture(WebGl2RenderingContext::TEXTURE0 + (index as u32));
        c.bind_texture(WebGl2RenderingContext::TEXTURE_2D, slot.tex.as_ref());
        c.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_MIN_FILTER,
            WebGl2RenderingContext::LINEAR as i32
        );
        c.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_MAG_FILTER,
            WebGl2RenderingContext::LINEAR as i32
        );
        c.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_WRAP_S,
            WebGl2RenderingContext::CLAMP_TO_EDGE as i32
        );
        c.tex_parameteri(
            WebGl2RenderingContext::TEXTURE_2D,
            WebGl2RenderingContext::TEXTURE_WRAP_T,
            WebGl2RenderingContext::CLAMP_TO_EDGE as i32
        );
        slot.ctx.clear_rect(0.0, 0.0, 4096.0, 4096.0);
        let _ = slot.ctx.draw_image_with_html_image_element_and_dw_and_dh(
            &img,
            0.0,
            0.0,
            4096.0,
            4096.0
        );
        let _ = c.tex_image_2d_with_u32_and_u32_and_html_image_element(
            WebGl2RenderingContext::TEXTURE_2D,
            0,
            WebGl2RenderingContext::RGBA as i32,
            WebGl2RenderingContext::RGBA,
            WebGl2RenderingContext::UNSIGNED_BYTE,
            &img
        );
        if let Some(a) = slot.atlas.as_ref() {
            c.uniform1i(Some(a), index as i32);
        }
        if let Some(of) = slot.offset.as_ref() {
            let off = [
                Reflect::get(r, &JsValue::from_str("x")).unwrap().as_f64().unwrap_or(0.0) as f32,
                Reflect::get(r, &JsValue::from_str("y")).unwrap().as_f64().unwrap_or(0.0) as f32,
                Reflect::get(r, &JsValue::from_str("z")).unwrap().as_f64().unwrap_or(0.0) as f32,
            ];
            c.uniform3fv_with_f32_array(Some(of), &off);
        }
        slot.is_ready = true;
        true
    }
    pub fn begin(&mut self, set: &Set) {
        let mut i = 0usize;
        while i < self.owner.len() {
            let (keep_this, region_js) = if let Some(r) = self.owner[i].region.as_ref() {
                (set.has(r), Some(r.clone()))
            } else {
                (false, None)
            };
            if !keep_this {
                if let Some(r) = region_js {
                    let _ = Reflect::set(&r, &JsValue::from_str("slot"), &JsValue::from_f64(-1.0));
                }
                self.owner[i].region = None;
                self.owner[i].is_ready = false;
            }
            i += 1;
        }
        self.keep = set.clone();
        self.cursor = 0;
        self.pending = vec![];
        let it = js_sys::try_iter(&set).unwrap().unwrap();
        for v in it {
            let r = v.unwrap();
            let cursor_fn: Function = Reflect::get(&r, &JsValue::from_str("cursor"))
                .unwrap()
                .unchecked_into();
            let _ = cursor_fn.call0(&r);
            self.pending.push(r);
        }
    }
    pub fn step(&mut self, c: &JsValue, pg: &JsValue, budget: i32) -> bool {
        let c: WebGl2RenderingContext = c.clone().unchecked_into();
        let pg: WebGlProgram = pg.clone().unchecked_into();
        let start = web_sys::window().unwrap().performance().unwrap().now();
        while self.cursor < self.pending.len() {
            let dt = ((budget as f64) -
                (web_sys::window().unwrap().performance().unwrap().now() - start)) as i32;
            if dt <= 0 {
                return false;
            }
            let r = self.pending[self.cursor].clone();
            if !self.assign(&c, &pg, r, dt) {
                return false;
            }
            self.cursor += 1;
        }
        true
    }
}
