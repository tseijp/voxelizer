use wasm_bindgen::prelude::*;use js_sys::{Uint8Array,Float32Array};use crate::utils::*;

#[wasm_bindgen]
pub fn region_id_of(i:i32,j:i32)->i32{region_id(i,j)}

#[wasm_bindgen]
pub fn chunk_id_of(i:usize,j:usize,k:usize)->usize{chunk_id(i,j,k)}

#[wasm_bindgen]
pub fn world_to_region(wx:f32,wy:f32,wz:f32)->js_sys::Array{let rxi=SCOPE_X0+((wx/REGION).floor() as i32);let ryj=SCOPE_Y1-((wz/REGION).floor() as i32);let a=js_sys::Array::new();a.push(&JsValue::from(rxi));a.push(&JsValue::from(ryj));a}

#[wasm_bindgen]
pub fn region_offset(i:i32,j:i32)->Float32Array{let o=off_of(i,j);Float32Array::from(o.as_slice())}

#[wasm_bindgen]
pub fn sample_chunk_alpha(tile:Uint8Array,ci:usize,cj:usize,ck:usize,vx:usize,vy:usize,vz:usize)->u8{let mut rgba=vec![0u8;4096*4096*4];tile.copy_to(&mut rgba[..]);let ox=(ck&3)*1024+ci*64;let oy=(ck>>2)*1024+cj*64;let px=(vz&3)*16+vx;let py=(vz>>2)*16+vy;let si=((oy+py)*4096+(ox+px))*4;rgba[si+3]}
