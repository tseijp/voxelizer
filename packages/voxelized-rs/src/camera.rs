use wasm_bindgen::prelude::*;use js_sys::Float32Array;use crate::utils::*;

fn face_dir(yaw:f32,pitch:f32)->Vec3{let cy=yaw.cos();let sy=yaw.sin();let cp=pitch.cos();let sp=pitch.sin();[-cp*cy,sp,-cp*sy]}
fn clamp_to_face(p:f32,half:f32,sign:f32)->f32{let b=p.floor();if sign>0.0{p.min(b+1.0-half)}else{p.max(b+half)}}

#[wasm_bindgen]
pub struct Camera{pos:Vec3,eye:Vec3,vel:Vec3,yaw:f32,pitch:f32,mode:i32,mvp:Mat4,size:Vec3,move_sp:f32,dash:f32,gravity:f32,turn:f32,scroll:f32}

#[wasm_bindgen]
impl Camera{
    #[wasm_bindgen(constructor)]
    pub fn new()->Camera{Camera{pos:[0.0,0.0,0.0],eye:[-10.0,0.0,0.0],vel:[0.0,0.0,0.0],yaw:std::f32::consts::PI*0.5,pitch:-std::f32::consts::PI*0.45,mode:-1,mvp:mat4_identity(),size:[0.8,1.8,0.8],move_sp:12.0,dash:1.0,gravity:-50.0,turn:1.0/250.0,scroll:0.0}}
    pub fn configure(&mut self,x:f32,y:f32,z:f32){self.pos=[x,y,z];self.eye=[x-10.0,y,z];}
    pub fn mode(&mut self,m:i32){self.mode=m}
    pub fn turn(&mut self,dx:f32,dy:f32){let r=if self.mode==1{1.0}else{0.1};self.yaw+=dx*r*self.turn;self.pitch+=(dy*r*self.turn).clamp(-(std::f32::consts::FRAC_PI_2-0.01),(std::f32::consts::FRAC_PI_2-0.01));let f=face_dir(self.yaw,self.pitch);self.eye=[self.pos[0]+f[0]*10.0,self.pos[1]+f[1]*10.0,self.pos[2]+f[2]*10.0]}
    pub fn shift(&mut self,press:bool){if self.mode==1{self.dash=if press{3.0}else{1.0}}}
    pub fn space(&mut self,press:bool){if self.mode==1&&press{self.vel[1]=12.0}}
    pub fn tick(&mut self,dt:f32){if self.mode==-1{self.scroll-=dt*self.move_sp;self.pos[0]+=self.scroll;if self.pos[0]<0.0{self.pos[0]=(ROW as f32)*REGION}if self.pos[0]>(ROW as f32)*REGION{self.pos[0]=0.0}}if self.mode==1{self.vel[1]+=self.gravity*dt;self.pos[0]+=self.vel[0]*dt;self.pos[1]+=self.vel[1]*dt;self.pos[2]+=self.vel[2]*dt;if self.pos[1]<0.0{self.pos[1]=0.0;self.vel[1]=0.0}}let f=face_dir(self.yaw,self.pitch);self.eye=[self.pos[0]+f[0]*10.0,self.pos[1]+f[1]*10.0,self.pos[2]+f[2]*10.0]}
    pub fn update(&mut self,aspect:f32){let p=mat4_perspective(28.0f32.to_radians(),aspect,0.1,4000.0);let v=mat4_look_at([self.pos[0],self.pos[1]+self.size[1]*0.5,self.pos[2]],[self.eye[0],self.eye[1]+self.size[1]*0.5,self.eye[2]],[0.0,1.0,0.0]);self.mvp=mat4_mul(&p,&v)}
    pub fn mvp(&self)->Float32Array{Float32Array::from(self.mvp.as_slice())}
    pub fn position(&self)->Float32Array{Float32Array::from(self.pos.as_slice())}
    pub fn clamp_axis(&mut self,axis:u32,sign:f32){let h=if axis==1{self.size[1]*0.5}else{0.5};self.pos[axis as usize]=clamp_to_face(self.pos[axis as usize],h,sign);self.vel[axis as usize]=0.0}
}
