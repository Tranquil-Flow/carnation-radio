// Self-contained ffmpeg.wasm worker — bypasses webpack bundling.
// This is a module worker that uses native import() for blob URLs.
// Based on @ffmpeg/ffmpeg worker.js with inlined constants.

const FFMessageType = {
  LOAD: "LOAD", EXEC: "EXEC", FFPROBE: "FFPROBE",
  WRITE_FILE: "WRITE_FILE", READ_FILE: "READ_FILE",
  DELETE_FILE: "DELETE_FILE", RENAME: "RENAME",
  CREATE_DIR: "CREATE_DIR", LIST_DIR: "LIST_DIR",
  DELETE_DIR: "DELETE_DIR", ERROR: "ERROR",
  DOWNLOAD: "DOWNLOAD", PROGRESS: "PROGRESS",
  LOG: "LOG", MOUNT: "MOUNT", UNMOUNT: "UNMOUNT",
};

const CORE_URL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm/ffmpeg-core.js";

let ffmpeg;

const load = async ({ coreURL: _coreURL, wasmURL: _wasmURL, workerURL: _workerURL }) => {
  const first = !ffmpeg;
  if (!_coreURL) _coreURL = CORE_URL;

  // Native import() — NOT processed by webpack
  self.createFFmpegCore = (await import(_coreURL)).default;
  if (!self.createFFmpegCore) {
    throw new Error("failed to import ffmpeg-core.js");
  }

  const coreURL = _coreURL;
  const wasmURL = _wasmURL ? _wasmURL : _coreURL.replace(/.js$/g, ".wasm");
  const workerURL = _workerURL ? _workerURL : _coreURL.replace(/.js$/g, ".worker.js");

  ffmpeg = await self.createFFmpegCore({
    mainScriptUrlOrBlob: `${coreURL}#${btoa(JSON.stringify({ wasmURL, workerURL }))}`,
  });
  ffmpeg.setLogger((data) => self.postMessage({ type: FFMessageType.LOG, data }));
  ffmpeg.setProgress((data) => self.postMessage({ type: FFMessageType.PROGRESS, data }));
  return first;
};

const runExec = ({ args, timeout = -1 }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.exec(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const runFfprobe = ({ args, timeout = -1 }) => {
  ffmpeg.setTimeout(timeout);
  ffmpeg.ffprobe(...args);
  const ret = ffmpeg.ret;
  ffmpeg.reset();
  return ret;
};

const writeFile = ({ path, data }) => { ffmpeg.FS.writeFile(path, data); return true; };
const readFile = ({ path, encoding }) => ffmpeg.FS.readFile(path, { encoding });
const deleteFile = ({ path }) => { ffmpeg.FS.unlink(path); return true; };
const rename = ({ oldPath, newPath }) => { ffmpeg.FS.rename(oldPath, newPath); return true; };
const createDir = ({ path }) => { ffmpeg.FS.mkdir(path); return true; };
const listDir = ({ path }) => {
  const names = ffmpeg.FS.readdir(path);
  const nodes = [];
  for (const name of names) {
    const stat = ffmpeg.FS.stat(`${path}/${name}`);
    nodes.push({ name, isDir: ffmpeg.FS.isDir(stat.mode) });
  }
  return nodes;
};
const deleteDir = ({ path }) => { ffmpeg.FS.rmdir(path); return true; };
const mount = ({ fsType, options, mountPoint }) => {
  const fs = ffmpeg.FS.filesystems[fsType];
  if (!fs) return false;
  ffmpeg.FS.mount(fs, options, mountPoint);
  return true;
};
const unmount = ({ mountPoint }) => { ffmpeg.FS.unmount(mountPoint); return true; };

self.onmessage = async ({ data: { id, type, data: _data } }) => {
  const trans = [];
  let data;
  try {
    if (type !== FFMessageType.LOAD && !ffmpeg)
      throw new Error("ffmpeg is not loaded, call `await ffmpeg.load()` first");
    switch (type) {
      case FFMessageType.LOAD:      data = await load(_data); break;
      case FFMessageType.EXEC:      data = runExec(_data); break;
      case FFMessageType.FFPROBE:   data = runFfprobe(_data); break;
      case FFMessageType.WRITE_FILE: data = writeFile(_data); break;
      case FFMessageType.READ_FILE:  data = readFile(_data); break;
      case FFMessageType.DELETE_FILE: data = deleteFile(_data); break;
      case FFMessageType.RENAME:    data = rename(_data); break;
      case FFMessageType.CREATE_DIR: data = createDir(_data); break;
      case FFMessageType.LIST_DIR:  data = listDir(_data); break;
      case FFMessageType.DELETE_DIR: data = deleteDir(_data); break;
      case FFMessageType.MOUNT:     data = mount(_data); break;
      case FFMessageType.UNMOUNT:   data = unmount(_data); break;
      default: throw new Error("unknown message type");
    }
  } catch (e) {
    self.postMessage({ id, type: FFMessageType.ERROR, data: e.toString() });
    return;
  }
  if (data instanceof Uint8Array) trans.push(data.buffer);
  self.postMessage({ id, type, data }, trans);
};
