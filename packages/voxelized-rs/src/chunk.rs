use wasm_bindgen::prelude::*;use js_sys::{Float32Array,Uint8Array};use crate::utils::CHUNK;

#[wasm_bindgen]
pub struct MeshOut{pos:Float32Array,scl:Float32Array,count:u32}
#[wasm_bindgen]
impl MeshOut{pub fn pos(&self)->Float32Array{self.pos.clone()}pub fn scl(&self)->Float32Array{self.scl.clone()}pub fn count(&self)->u32{self.count}}

fn idx(x:usize,y:usize,z:usize,n:usize)->usize{x+(y+z*n)*n}

#[wasm_bindgen]
pub fn greedy_mesh(data:Uint8Array,size:u32)->MeshOut{let n=size as usize;let mut vox=vec![0u8;n*n*n];data.copy_to(&mut vox[..]);let mut pos:Vec<f32>=Vec::new();let mut scl:Vec<f32>=Vec::new();let mut count=0u32;let mut mark=vox.clone();let mut x=0;let mut y;let mut z=0;while z<n{y=0;while y<n{x=0;while x<n{let id=idx(x,y,z,n);if mark[id]==0{ x+=1;continue }let mut w=1;while x+w<n && mark[idx(x+w,y,z,n)]!=0{w+=1}let mut h=1; 'h:while y+h<n{for i in 0..w{if mark[idx(x+i,y+h,z,n)]==0{break 'h}}h+=1}
            let mut d=1; 'd:while z+d<n{for j in 0..h{for i in 0..w{if mark[idx(x+i,y+j,z+d,n)]==0{break 'd}}}d+=1}
            for k in 0..d{for j in 0..h{for i in 0..w{mark[idx(x+i,y+j,z+k,n)]=0}}}
            pos.push(x as f32+w as f32*0.5);pos.push(y as f32+h as f32*0.5);pos.push(z as f32+d as f32*0.5);
            scl.push(w as f32);scl.push(h as f32);scl.push(d as f32);count+=1;x+=w}
        y+=1}
        z+=1}
let p=Float32Array::from(pos.as_slice());let s=Float32Array::from(scl.as_slice());MeshOut{pos:p,scl:s,count}}

#[wasm_bindgen]
pub fn decode_chunk_from_tile(tile:Uint8Array)->Uint8Array{let mut out=vec![0u8;CHUNK*CHUNK*CHUNK];let mut rgba=vec![0u8;64*64*4];tile.copy_to(&mut rgba[..]);let mut p=0usize;for kz in 0..CHUNK{for y in 0..CHUNK{for x in 0..CHUNK{let px=(kz&3)*16+x;let py=(kz>>2)*16+y;let si=((py*64+px)*4) as usize;out[p]=if rgba[si+3]>0{1}else{0};p+=1}}}Uint8Array::from(out.as_slice())}
