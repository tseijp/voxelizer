use wasm_bindgen::prelude::*;

pub const SCOPE_X0:i32=28;pub const SCOPE_X1:i32=123;pub const SCOPE_Y0:i32=75;pub const SCOPE_Y1:i32=79;
pub const ROW:i32=SCOPE_X1-SCOPE_X0+1;pub const SLOT:usize=16;pub const CHUNK:usize=16;pub const CACHE:usize=32;pub const REGION:f32=256.0;pub const PREFETCH:usize=16;
pub type Vec3=[f32;3];pub type Mat4=[f32;16];

#[wasm_bindgen]
pub fn row()->i32{ROW}
#[wasm_bindgen]
pub fn region()->f32{REGION}
#[wasm_bindgen]
pub fn scope()->js_sys::Array{let a=js_sys::Array::new();a.push(&JsValue::from(SCOPE_X0));a.push(&JsValue::from(SCOPE_X1));a.push(&JsValue::from(SCOPE_Y0));a.push(&JsValue::from(SCOPE_Y1));a}

pub fn chunk_id(i:usize,j:usize,k:usize)->usize{i+j*CHUNK+k*CHUNK*CHUNK}
pub fn region_id(i:i32,j:i32)->i32{i+ROW*j}
pub fn off_of(i:i32,j:i32)->Vec3{[(REGION*((i-SCOPE_X0)as i32)as f32),0.0,(REGION*((SCOPE_Y1-j)as i32)as f32)]}

pub fn mat4_identity()->Mat4{[1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0]}
pub fn mat4_mul(a:&Mat4,b:&Mat4)->Mat4{let(m00,m01,m02,m03)=(a[0],a[1],a[2],a[3]);let(m10,m11,m12,m13)=(a[4],a[5],a[6],a[7]);let(m20,m21,m22,m23)=(a[8],a[9],a[10],a[11]);let(m30,m31,m32,m33)=(a[12],a[13],a[14],a[15]);[
 m00*b[0]+m01*b[4]+m02*b[8]+m03*b[12],m00*b[1]+m01*b[5]+m02*b[9]+m03*b[13],m00*b[2]+m01*b[6]+m02*b[10]+m03*b[14],m00*b[3]+m01*b[7]+m02*b[11]+m03*b[15],
 m10*b[0]+m11*b[4]+m12*b[8]+m13*b[12],m10*b[1]+m11*b[5]+m12*b[9]+m13*b[13],m10*b[2]+m11*b[6]+m12*b[10]+m13*b[14],m10*b[3]+m11*b[7]+m12*b[11]+m13*b[15],
 m20*b[0]+m21*b[4]+m22*b[8]+m23*b[12],m20*b[1]+m21*b[5]+m22*b[9]+m23*b[13],m20*b[2]+m21*b[6]+m22*b[10]+m23*b[14],m20*b[3]+m21*b[7]+m22*b[11]+m23*b[15],
 m30*b[0]+m31*b[4]+m32*b[8]+m33*b[12],m30*b[1]+m31*b[5]+m32*b[9]+m33*b[13],m30*b[2]+m31*b[6]+m32*b[10]+m33*b[14],m30*b[3]+m31*b[7]+m32*b[11]+m33*b[15]]}

pub fn mat4_perspective(fovy:f32,aspect:f32,near:f32,far:f32)->Mat4{let f=1.0/(0.5*fovy).tan();let nf=1.0/(near-far);[f/aspect,0.0,0.0,0.0,0.0,f,0.0,0.0,0.0,0.0,(far+near)*nf,-1.0,0.0,0.0,(2.0*far*near)*nf,0.0]}
pub fn vec3_sub(a:Vec3,b:Vec3)->Vec3{[a[0]-b[0],a[1]-b[1],a[2]-b[2]]}
pub fn vec3_cross(a:Vec3,b:Vec3)->Vec3{[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
pub fn vec3_norm(a:Vec3)->Vec3{let l=(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]).sqrt();if l==0.0{return[0.0,0.0,0.0]}[a[0]/l,a[1]/l,a[2]/l]}
pub fn mat4_look_at(eye:Vec3,center:Vec3,up:Vec3)->Mat4{let f=vec3_norm(vec3_sub(center,eye));let s=vec3_norm(vec3_cross(f,up));let u=vec3_cross(s,f);[
 s[0],u[0],-f[0],0.0,s[1],u[1],-f[1],0.0,s[2],u[2],-f[2],0.0,-(s[0]*eye[0]+s[1]*eye[1]+s[2]*eye[2]),-(u[0]*eye[0]+u[1]*eye[1]+u[2]*eye[2]),f[0]*eye[0]+f[1]*eye[1]+f[2]*eye[2],1.0]}

#[wasm_bindgen]
pub fn vis_sphere(m:&js_sys::Float32Array,cx:f32,cy:f32,cz:f32,r:f32)->bool{let mut a=[0.0;16];m.copy_to(&mut a);let t=|ax:f32,ay:f32,az:f32,aw:f32|{let d=(ax*ax+ay*ay+az*az).sqrt();let d=if d==0.0{1.0}else{d};(ax*cx+ay*cy+az*cz+aw)/d+r<0.0};if t(a[3]+a[0],a[7]+a[4],a[11]+a[8],a[15]+a[12]){return false}if t(a[3]-a[0],a[7]-a[4],a[11]-a[8],a[15]-a[12]){return false}if t(a[3]+a[1],a[7]+a[5],a[11]+a[9],a[15]+a[13]){return false}if t(a[3]-a[1],a[7]-a[5],a[11]-a[9],a[15]-a[13]){return false}if t(a[3]+a[2],a[7]+a[6],a[11]+a[10],a[15]+a[14]){return false}if t(a[3]-a[2],a[7]-a[6],a[11]-a[10],a[15]-a[14]){return false}true}
