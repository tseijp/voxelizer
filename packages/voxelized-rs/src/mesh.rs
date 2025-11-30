use wasm_bindgen::prelude::*;use js_sys::Float32Array;

#[wasm_bindgen]
pub struct Mesh{pos:Vec<f32>,scl:Vec<f32>,aid:Vec<f32>,count:u32,is_ready:bool}

#[wasm_bindgen]
impl Mesh{
    #[wasm_bindgen(constructor)]
    pub fn new()->Mesh{Mesh{pos:vec![0.0,0.0,0.0],scl:vec![1.0,1.0,1.0],aid:vec![0.0],count:1,is_ready:false}}
    pub fn merge(&mut self,p:&Float32Array,s:&Float32Array,index:u32){let mut a=vec![0.0;p.length() as usize];p.copy_to(&mut a[..]);let mut b=vec![0.0;s.length() as usize];s.copy_to(&mut b[..]);let c=(a.len()/3) as u32;self.count+=c;self.pos.extend(a);self.scl.extend(b);for _ in 0..c{self.aid.push(index as f32)}self.is_ready=false}
    pub fn commit(&mut self)->bool{if self.count==0{return false}self.is_ready=true;true}
    pub fn count(&self)->u32{self.count}
    pub fn ready(&self)->bool{self.is_ready}
    pub fn pos_array(&self)->Float32Array{Float32Array::from(self.pos.as_slice())}
    pub fn scl_array(&self)->Float32Array{Float32Array::from(self.scl.as_slice())}
    pub fn aid_array(&self)->Float32Array{Float32Array::from(self.aid.as_slice())}
    pub fn reset(&mut self){self.pos.clear();self.scl.clear();self.aid.clear();self.count=0;self.is_ready=false}
}
