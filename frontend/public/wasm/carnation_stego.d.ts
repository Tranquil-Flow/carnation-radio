/* tslint:disable */
/* eslint-disable */

export class FrameDecoder {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Feed one frame of FRAME_SIZE samples. Returns payload bytes when sync found.
     */
    feed_frame(samples: Float64Array): Uint8Array | undefined;
    /**
     * key = embed_key (SHA-256("carnation-embed:" + passphrase)).
     * Constructor hashes it again to get key_hash, matching Python's double-hash chain.
     */
    constructor(key: Uint8Array, total_frames: number);
    progress(): number;
}

export function wasm_decode(samples: Float64Array, key: Uint8Array): Uint8Array;

export function wasm_encode(samples: Float64Array, message: Uint8Array, key: Uint8Array): Float64Array;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_framedecoder_free: (a: number, b: number) => void;
    readonly framedecoder_feed_frame: (a: number, b: number, c: number) => [number, number];
    readonly framedecoder_new: (a: number, b: number, c: number) => number;
    readonly framedecoder_progress: (a: number) => number;
    readonly wasm_decode: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly wasm_encode: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
