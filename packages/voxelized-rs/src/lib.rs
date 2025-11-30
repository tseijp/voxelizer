use wasm_bindgen::prelude::*;
pub mod utils;pub mod camera;pub mod chunk;pub mod mesh;pub mod queue;pub mod region;pub mod slot;

#[wasm_bindgen]
pub fn constants()->js_sys::Array{let a=js_sys::Array::new();a.push(&JsValue::from(utils::ROW));a.push(&JsValue::from(utils::SLOT as i32));a.push(&JsValue::from(utils::CHUNK as i32));a.push(&JsValue::from(utils::CACHE as i32));a.push(&JsValue::from(utils::REGION));a.push(&JsValue::from(utils::PREFETCH as i32));a}
