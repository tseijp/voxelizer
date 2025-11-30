use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct Task{priority:i32,started:bool}

#[wasm_bindgen]
pub struct Queues{high:i32,low:i32}

#[wasm_bindgen]
impl Queues{
    #[wasm_bindgen(constructor)]
    pub fn new()->Queues{Queues{high:0,low:0}}
    pub fn schedule(&mut self,priority:i32)->Task{if priority>0{self.high+=1}else{self.low+=1}Task{priority,started:false}}
    pub fn bump(&mut self,_task:&Task,_prio:i32){}
}
