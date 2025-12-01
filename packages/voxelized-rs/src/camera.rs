use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use js_sys::{ Array, Function };
use crate::utils as U;

#[wasm_bindgen]
pub struct Camera {
    pos: [f32; 3],
    eye: [f32; 3],
    mvp: [f32; 16],
    yaw: f32,
    pitch: f32,
    mode: i32,
    dir: [f32; 3],
    vel: [f32; 3],
    dash: f32,
    turn: f32,
    move_speed: f32,
    jump: f32,
    grav: f32,
    ground: f32,
    size: [f32; 3],
    x0: f32,
    y0: f32,
    is_ground: bool,
    scroll: f32,
}

fn face_dir(yaw: f32, pitch: f32) -> [f32; 3] {
    let mut r = [0.0f32; 16];
    let mut t = [0.0f32; 16];
    U::look_at(&mut r, [0.0,0.0,0.0], [0.0,0.0,-1.0], [0.0,1.0,0.0]);
    // reuse identity pattern via perspective with aspect=1 to avoid new helper; then overwrite to identity
    for i in 0..16 { r[i] = 0.0; }
    r[0]=1.0; r[5]=1.0; r[10]=1.0; r[15]=1.0;
    U::rotate_y(&mut t, &r, yaw);
    U::rotate_x(&mut r, &t, pitch);
    let f = [0.0, 0.0, -1.0];
    let mut out = [0.0f32;3];
    U::transform_vec3(&mut out, &f, &r);
    out
}
fn look_target(pos: [f32; 3], face: [f32; 3]) -> [f32; 3] {
    [pos[0] + face[0] * 10.0, pos[1] + face[1] * 10.0, pos[2] + face[2] * 10.0]
}
fn clamp_to_face(pos: f32, half: f32, sign: f32, base: i32) -> f32 {
    if sign > 0.0 { pos.min((base as f32) + 1.0 - half) } else { pos.max((base as f32) + half) }
}
fn move_dir(face: [f32; 3], dir: [f32; 3], speed: f32, planar: bool) -> [f32; 3] {
    let f = face;
    let up = [0.0, 1.0, 0.0];
    let mut t1 = f;
    t1[1] = 0.0;
    let l = t1[0] * t1[0] + t1[2] * t1[2];
    if l < 1e-8 {
        t1 = [0.0, 0.0, -1.0];
    }
    let n = (t1[0] * t1[0] + t1[1] * t1[1] + t1[2] * t1[2]).sqrt();
    t1 = [t1[0] / n, t1[1] / n, t1[2] / n];
    let t0 = [
        up[1] * t1[2] - up[2] * t1[1],
        up[2] * t1[0] - up[0] * t1[2],
        up[0] * t1[1] - up[1] * t1[0],
    ];
    let nl = (t0[0] * t0[0] + t0[1] * t0[1] + t0[2] * t0[2]).sqrt();
    let t0 = [t0[0] / nl, t0[1] / nl, t0[2] / nl];
    let fwd = if planar { t1 } else { f };
    let x = [t0[0] * dir[0], t0[1] * dir[0], t0[2] * dir[0]];
    let z = [fwd[0] * dir[2], fwd[1] * dir[2], fwd[2] * dir[2]];
    [(x[0] + z[0]) * speed, (x[1] + z[1]) * speed, (x[2] + z[2]) * speed]
}

#[wasm_bindgen(js_name = createCamera)]
pub fn create_camera(opts: &JsValue) -> Camera {
    let yaw = std::f32::consts::PI * 0.5;
    let pitch = -std::f32::consts::PI * 0.45;
    let mode = -1;
    let x = U::get_f32(opts, "X", 0.0);
    let y = U::get_f32(opts, "Y", 0.0);
    let z = U::get_f32(opts, "Z", 0.0);
    let pos = [x, y, z];
    let face = face_dir(yaw, pitch);
    let eye = look_target(pos, face);
    let mvp = [0.0; 16];
    let size = [0.8, 1.8, 0.8];
    Camera {
        pos,
        eye,
        mvp,
        yaw,
        pitch,
        mode,
        dir: [0.0, 0.0, 0.0],
        vel: [0.0, 0.0, 0.0],
        dash: 1.0,
        turn: 1.0 / 250.0,
        move_speed: 12.0,
        jump: 12.0,
        grav: -50.0,
        ground: 0.0,
        size,
        x0: x,
        y0: y,
        is_ground: false,
        scroll: 0.0,
    }
}

#[wasm_bindgen]
impl Camera {
    #[wasm_bindgen(getter, js_name = pos)]
    pub fn pos(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.pos[..])
    }
    #[wasm_bindgen(getter, js_name = MVP)]
    pub fn mvp(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(&self.mvp[..])
    }
    pub fn asdw(&mut self, axis: i32, delta: f32) {
        if axis == 0 {
            self.dir[1] = delta;
            return;
        }
        if axis == 1 {
            self.dir[2] = delta;
            return;
        }
        if axis == 2 {
            self.dir[0] = delta;
            return;
        }
    }
    pub fn shift(&mut self, is_press: bool) {
        if self.mode == 0 {
            self.asdw(0, if is_press { -1.0 } else { 0.0 });
            return;
        }
        if self.mode == 1 {
            self.dash = if is_press { 3.0 } else { 1.0 };
        }
    }
    pub fn space(&mut self, is_press: bool) {
        if self.mode == 0 {
            self.asdw(0, if is_press { 1.0 } else { 0.0 });
            return;
        }
        if self.mode == 1 && self.is_ground && is_press { self.vel[1] = self.jump; }
    }
    pub fn mode(&mut self, x: i32) {
        self.mode = x;
    }
    pub fn turn(&mut self, delta: &JsValue) {
        let (dx, dy) = if let Some(arr) = delta.dyn_ref::<Array>() {
            (
                arr.get(0).as_f64().unwrap_or(0.0) as f32,
                arr.get(1).as_f64().unwrap_or(0.0) as f32,
            )
        } else {
            (delta.as_f64().unwrap_or(0.0) as f32, 0.0)
        };
        let r = if self.mode == 1 { 1.0 } else { 0.1 };
        self.yaw += dx * r * self.turn;
        self.pitch += dy * r * self.turn;
        let half = std::f32::consts::FRAC_PI_2 - 0.01;
        self.pitch = self.pitch.min(half).max(-half);
        let f = face_dir(self.yaw, self.pitch);
        self.eye = look_target(self.pos, f);
    }
    pub fn update(&mut self, aspect: f32) {
        let mut p = [0.0; 16];
        let mut v = [0.0; 16];
        U::perspective(&mut p, (28.0_f32).to_radians(), aspect, 0.1, 4000.0);
        let off = self.size[1] * 0.5;
        U::look_at(
            &mut v,
            [self.pos[0], self.pos[1] + off, self.pos[2]],
            [self.eye[0], self.eye[1] + off, self.eye[2]],
            [0.0, 1.0, 0.0]
        );
        U::mul(&mut self.mvp, &p, &v)
    }
    pub fn tick(&mut self, dt: f32, pick: &JsValue) {
        if self.mode == 2 {
            return;
        }
        if self.mode == -1 {
            self.scroll -= dt * self.move_speed;
            self.pos[0] = self.x0 + self.scroll;
            if self.pos[0] < 0.0 { self.pos[0] = (U::ROW * U::REGION) as f32; }
            if self.pos[0] > (U::ROW * U::REGION) as f32 { self.pos[0] = 0.0; }
            let f = face_dir(self.yaw, self.pitch);
            self.eye = look_target(self.pos, f);
            return;
        }
        let speed = self.move_speed * self.dash * (if self.mode == 0 { 20.0 } else { 1.0 });
        let f = face_dir(self.yaw, self.pitch);
        let m = move_dir(f, self.dir, speed, self.mode == 1);
        self.vel[0] = m[0];
        self.vel[2] = m[2];
        if self.mode == 0 {
            self.pos[0] += self.vel[0] * dt;
            self.pos[1] += self.dir[1] * dt * speed;
            self.pos[2] += self.vel[2] * dt;
            let f = face_dir(self.yaw, self.pitch);
            self.eye = look_target(self.pos, f);
            return;
        }
        if self.mode == 1 {
            self.vel[1] += self.grav * dt;
            let vmax = self.vel[0].abs().max(self.vel[1].abs().max(self.vel[2].abs()));
            let mut steps = ((vmax * dt) / 0.25).ceil() as i32;
            if steps < 1 {
                steps = 1;
            }
            let sdt = dt / (steps as f32);
            self.is_ground = false;
            let pf: Function = pick.clone().unchecked_into();
            for _ in 0..steps {
                self.pos[1] += self.vel[1] * sdt;
                self.collide(1, &pf);
                self.pos[0] += self.vel[0] * sdt;
                self.collide(0, &pf);
                self.pos[2] += self.vel[2] * sdt;
                self.collide(2, &pf);
            }
            if self.pos[1] < self.ground {
                self.pos[1] = self.y0 / 4.0;
                self.vel[1] = 0.0;
            }
            let f = face_dir(self.yaw, self.pitch);
            self.eye = look_target(self.pos, f);
        }
    }
}

impl Camera {
    fn collide(&mut self, axis: i32, pick: &Function) {
        let v = self.vel[axis as usize];
        if v == 0.0 {
            return;
        }
        let s = v.signum();
        let mut xyz = self.pos;
        xyz[axis as usize] += s;
        let floor_xyz = [xyz[0].floor(), xyz[1].floor(), xyz[2].floor()];
        let hit = pick
            .call3(
                &JsValue::NULL,
                &JsValue::from_f64(floor_xyz[0] as f64),
                &JsValue::from_f64(floor_xyz[1] as f64),
                &JsValue::from_f64(floor_xyz[2] as f64)
            )
            .unwrap_or(JsValue::from_f64(0.0))
            .as_f64()
            .unwrap_or(0.0) as i32;
        if hit == 0 {
            return;
        }
        if axis == 1 && s < 0.0 {
            self.is_ground = true;
        }
        let half = self.size[axis as usize] * 0.5;
        let base = self.pos[axis as usize].floor() as i32;
        self.pos[axis as usize] = clamp_to_face(self.pos[axis as usize], half, s, base);
        self.vel[axis as usize] = 0.0;
    }
}
