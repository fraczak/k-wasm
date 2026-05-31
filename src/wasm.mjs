import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  annotate,
  decodeWire,
  encodeToWire,
  exportPatternGraph,
  lowerToKVM,
  NODE_KIND,
  patternToPropertyList,
  Product,
  propertyListToPattern,
  Variant
} from "@fraczak/k/backend-api.mjs";
import { lowerToWasm, getTagEntries, resetTagIds } from "./kvm2wasm.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runtimeWat = fs.readFileSync(path.join(__dirname, "../runtime.wat"), "utf8");
let wabtPromise;

const METADATA_SECTION = "k.metadata";
const ARTIFACT_FORMAT = "k-wasm";
const ARTIFACT_VERSION = 1;

const cleanName = (name) => "rel_" + name.replace(/[^a-zA-Z0-9_]/g, "_");

async function getWabt() {
  if (!wabtPromise) {
    wabtPromise = import("wabt").then(({ default: wabtFactory }) => wabtFactory());
  }
  return wabtPromise;
}

async function compileWat(watText) {
  const wabtInstance = await getWabt();
  const watModule = wabtInstance.parseWat("k_wasm.wat", watText, {
    mutable_globals: true,
    sat_float_to_int: true,
    sign_extension: true,
    multi_value: true,
    bulk_memory: true,
    reference_types: true
  });
  watModule.resolveNames();
  watModule.validate();
  return Buffer.from(watModule.toBinary({
    log: false,
    canonicalize_lebs: true,
    relocatable: false,
    write_debug_names: true
  }).buffer);
}

function scanCalls(insts, compiled, queue) {
  for (const inst of insts) {
    if (inst.op === "call" && !compiled.has(inst.func) && !queue.includes(inst.func)) {
      queue.push(inst.func);
    }
    if (inst.branches) {
      for (const branch of inst.branches) {
        scanCalls(branch.body, compiled, queue);
      }
    }
  }
}

function cleanCallNames(insts) {
  for (const inst of insts) {
    if (inst.op === "call") {
      inst.func = cleanName(inst.func);
    }
    if (inst.branches) {
      for (const branch of inst.branches) {
        cleanCallNames(branch.body);
      }
    }
  }
}

function compileModule(mainRelName, defs) {
  const compiled = new Set();
  const queue = [mainRelName];
  const wats = [];

  while (queue.length > 0) {
    const name = queue.shift();
    if (compiled.has(name)) continue;
    compiled.add(name);

    const relDef = defs.rels[name];
    if (!relDef) {
      throw new Error(`Relation ${name} not found`);
    }

    const kvmFunc = lowerToKVM(relDef, name);
    kvmFunc.typePatternGraph = relDef.typePatternGraph;
    scanCalls(kvmFunc.body, compiled, queue);

    kvmFunc.name = cleanName(name);
    cleanCallNames(kvmFunc.body);
    wats.push(lowerToWasm(kvmFunc, kvmFunc.name));
  }

  return wats.join("\n\n");
}

function getPatternPropertyList(graph, patternId) {
  const nodeId = graph.find(patternId);
  return patternToPropertyList(exportPatternGraph(graph, nodeId));
}

function encodeU32(value) {
  const bytes = [];
  do {
    let byte = value & 0x7f;
    value = Math.floor(value / 128);
    if (value > 0) byte |= 0x80;
    bytes.push(byte);
  } while (value > 0);
  return Buffer.from(bytes);
}

function appendCustomSection(wasmBuffer, name, data) {
  const nameBuffer = Buffer.from(name, "utf8");
  const dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const payload = Buffer.concat([
    encodeU32(nameBuffer.length),
    nameBuffer,
    dataBuffer
  ]);
  return Buffer.concat([
    Buffer.from(wasmBuffer),
    Buffer.from([0]),
    encodeU32(payload.length),
    payload
  ]);
}

function validateMetadata(metadata) {
  if (!metadata || metadata.format !== ARTIFACT_FORMAT || metadata.version !== ARTIFACT_VERSION) {
    throw new Error("Unsupported k WebAssembly artifact metadata");
  }
  if (typeof metadata.entry !== "string") {
    throw new Error("WebAssembly artifact metadata is missing its entry point");
  }
  if (!Array.isArray(metadata.inputPattern) || !Array.isArray(metadata.outputPattern)) {
    throw new Error("WebAssembly artifact metadata is missing its input/output patterns");
  }
  if (!Array.isArray(metadata.tags)) {
    throw new Error("WebAssembly artifact metadata is missing its tag table");
  }
  propertyListToPattern(metadata.inputPattern);
  propertyListToPattern(metadata.outputPattern);
  return metadata;
}

function metadataFromModule(module) {
  const sections = WebAssembly.Module.customSections(module, METADATA_SECTION);
  if (sections.length !== 1) {
    throw new Error(`Expected one '${METADATA_SECTION}' custom section, found ${sections.length}`);
  }
  return validateMetadata(JSON.parse(Buffer.from(sections[0]).toString("utf8")));
}

async function compileWasmArtifact(source, { libraries = [] } = {}) {
  resetTagIds();
  const defs = annotate(source, { libraries });
  const mainRel = defs.rels.__main__;
  if (!mainRel) {
    throw new Error("No main relation (__main__) defined in script");
  }

  const moduleWatBody = compileModule("__main__", defs);
  const fullWat = runtimeWat.trim().slice(0, -1) + "\n" + moduleWatBody + "\n)";
  const graph = mainRel.typePatternGraph;
  const metadata = {
    format: ARTIFACT_FORMAT,
    version: ARTIFACT_VERSION,
    abi: "arena-v1",
    entry: cleanName("__main__"),
    inputPattern: getPatternPropertyList(graph, mainRel.def.patterns[0]),
    outputPattern: getPatternPropertyList(graph, mainRel.def.patterns[1]),
    tags: getTagEntries()
  };
  return appendCustomSection(await compileWat(fullWat), METADATA_SECTION, JSON.stringify(metadata));
}

function createTagRegistry(entries) {
  const tagToId = new Map();
  const idToTag = new Map();
  let nextId = 1;

  for (const entry of entries) {
    if (!entry || typeof entry.tag !== "string" || !Number.isInteger(entry.id) || entry.id < 1) {
      throw new Error("WebAssembly artifact metadata contains an invalid tag entry");
    }
    if (tagToId.has(entry.tag) || idToTag.has(entry.id)) {
      throw new Error("WebAssembly artifact metadata contains a duplicate tag entry");
    }
    tagToId.set(entry.tag, entry.id);
    idToTag.set(entry.id, entry.tag);
    nextId = Math.max(nextId, entry.id + 1);
  }

  return {
    getId(tag) {
      if (!tagToId.has(tag)) {
        tagToId.set(tag, nextId);
        idToTag.set(nextId, tag);
        nextId++;
      }
      return tagToId.get(tag);
    },
    getTag(id) {
      return idToTag.get(id) ?? null;
    }
  };
}

function readArenaValue(exports, ptr, pattern, patternNodeId, patternPropertyList, arenaValues, tags) {
  const patternNode = pattern.nodes[patternNodeId];
  const view = new DataView(exports.memory.buffer);

  if (patternNode.kind === NODE_KIND.ANY) {
    const value = arenaValues.get(ptr);
    if (value === undefined) {
      throw new Error(`Cannot decode arena pointer ${ptr} through an unconstrained output pattern`);
    }
    return value;
  }

  if (patternNode.kind === NODE_KIND.OPEN_PRODUCT || patternNode.kind === NODE_KIND.CLOSED_PRODUCT) {
    const N = view.getUint32(ptr + 4, true);
    if (N !== patternNode.edges.length) {
      const value = arenaValues.get(ptr);
      if (value !== undefined) return value;
      throw new Error(`Cannot decode product pointer ${ptr}: arena field count ${N} does not match output pattern`);
    }
    const product = {};
    for (let i = 0; i < N; i++) {
      const edge = patternNode.edges[i];
      const offset = view.getUint32(ptr + 8 + 4 * i, true);
      const childPtr = view.getUint32(ptr + offset, true);
      product[edge.label] = readArenaValue(exports, childPtr, pattern, edge.target, patternPropertyList, arenaValues, tags);
    }
    return new Product(product, patternPropertyList);
  }

  if (patternNode.kind === NODE_KIND.OPEN_UNION || patternNode.kind === NODE_KIND.CLOSED_UNION) {
    const tag = tags.getTag(view.getUint32(ptr + 4, true));
    const edge = patternNode.edges.find((candidate) => candidate.label === tag);
    if (!edge) {
      const value = arenaValues.get(ptr);
      if (value !== undefined) return value;
      throw new Error(`Variant tag '${tag}' not found in output pattern edges`);
    }
    const payloadPtr = view.getUint32(ptr + 8, true);
    return new Variant(
      tag,
      readArenaValue(exports, payloadPtr, pattern, edge.target, patternPropertyList, arenaValues, tags),
      patternPropertyList
    );
  }

  throw new Error(`Unsupported pattern kind: ${patternNode.kind}`);
}

function writeValueToArena(exports, value, pattern, patternNodeId, arenaValues, tags) {
  const patternNode = pattern.nodes[patternNodeId];

  if (value instanceof Product) {
    const isAny = patternNode.kind === NODE_KIND.ANY;
    const keys = Object.keys(value.product).sort();
    const N = keys.length;
    const ptr = exports.alloc(8 + 8 * N);
    const childPtrs = [];

    for (const label of keys) {
      const edge = isAny ? null : patternNode.edges.find((candidate) => candidate.label === label);
      if (!isAny && !edge) {
        throw new Error(`Product field '${label}' is not present in input pattern node ${patternNodeId}`);
      }
      childPtrs.push(writeValueToArena(
        exports,
        value.product[label],
        pattern,
        isAny ? patternNodeId : edge.target,
        arenaValues,
        tags
      ));
    }

    const view = new DataView(exports.memory.buffer);
    view.setUint32(ptr, 8 + 8 * N, true);
    view.setUint32(ptr + 4, N, true);
    for (let i = 0; i < N; i++) {
      const offset = 8 + 4 * N + 4 * i;
      view.setUint32(ptr + 8 + 4 * i, offset, true);
      view.setUint32(ptr + offset, childPtrs[i], true);
    }
    arenaValues.set(ptr, value);
    return ptr;
  }

  if (value instanceof Variant) {
    const isAny = patternNode.kind === NODE_KIND.ANY;
    const edge = isAny ? null : patternNode.edges.find((candidate) => candidate.label === value.tag);
    if (!isAny && !edge) {
      throw new Error(`Variant tag '${value.tag}' is not present in input pattern node ${patternNodeId}`);
    }
    const childPtr = writeValueToArena(
      exports,
      value.value,
      pattern,
      isAny ? patternNodeId : edge.target,
      arenaValues,
      tags
    );
    const ptr = exports.alloc(12);
    const view = new DataView(exports.memory.buffer);
    view.setUint32(ptr, 12, true);
    view.setUint32(ptr + 4, tags.getId(value.tag), true);
    view.setUint32(ptr + 8, childPtr, true);
    arenaValues.set(ptr, value);
    return ptr;
  }

  throw new Error(`Unsupported value type: ${value}`);
}

async function runWasmArtifact(wasmBuffer, inputBuffer) {
  const module = await WebAssembly.compile(wasmBuffer);
  const metadata = metadataFromModule(module);
  const instance = await WebAssembly.instantiate(module);
  const exports = instance.exports;
  const tags = createTagRegistry(metadata.tags);
  const inputPattern = propertyListToPattern(metadata.inputPattern);
  const outputPattern = propertyListToPattern(metadata.outputPattern);
  const { value } = decodeWire(inputBuffer);
  const arenaValues = new Map();
  const ptrIn = writeValueToArena(exports, value, inputPattern, 0, arenaValues, tags);
  const result = exports[metadata.entry](ptrIn);
  if (result[1] !== 1) {
    throw new Error("Wasm relation execution failed (returned false)");
  }
  const output = readArenaValue(exports, result[0], outputPattern, 0, metadata.outputPattern, arenaValues, tags);
  return encodeToWire(output, output.pattern);
}

export {
  ARTIFACT_FORMAT,
  ARTIFACT_VERSION,
  METADATA_SECTION,
  appendCustomSection,
  compileWasmArtifact,
  metadataFromModule,
  runWasmArtifact
};

export default {
  ARTIFACT_FORMAT,
  ARTIFACT_VERSION,
  METADATA_SECTION,
  appendCustomSection,
  compileWasmArtifact,
  metadataFromModule,
  runWasmArtifact
};
