export type V4 = [number, number, number, number]
export type V3 = [number, number, number]
export type V2 = [number, number]
export type Tex = { w: number; h: number; dat: Uint8Array }
export type Mat = { base: V4; tex?: number }
export type Tri = {
        v0: V3
        v1: V3
        v2: V3
        uv0: V2
        uv1: V2
        uv2: V2
        mat: number
}

export type Parsed = {
        tris: Tri[]
        materials: Mat[]
        textures: Tex[]
        aabb: { min: V3; max: V3 }
}
