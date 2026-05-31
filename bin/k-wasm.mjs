#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdin, stdout } from "node:process";

import { decodeObject, loadLibrary } from "@fraczak/k/backend-api.mjs";
import { compileWasmArtifact, runWasmArtifact } from "../src/wasm.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-wasm.mjs";
  stream(`Usage: node ${prog} [ options ] ( k-expr | -k file ) [ input-file ]`);
  stream("Compile a k program to WebAssembly in memory and run it over a binary pattern+value stream.");
  stream("");
  stream("Options:");
  stream("  --lib file   Load a .klib dependency before compiling. May be repeated.");
  stream("  -h, --help   Show this help.");
}

function readAll(stream) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function main() {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    return;
  }

  const libraries = [];
  while (args.length > 0 && args[0] === "--lib") {
    args.shift();
    const libPath = args.shift();
    if (!libPath) throw new Error("--lib requires a file argument");
    libraries.push(loadLibrary(decodeObject(fs.readFileSync(libPath))));
  }

  const programArg = args.shift();
  if (programArg == null) throw new Error("Missing script argument");
  const source = programArg === "-k"
    ? fs.readFileSync(args.shift() || (() => { throw new Error("-k requires a file argument"); })(), "utf8")
    : programArg;
  const inputPath = args.shift();
  if (args.length > 0) throw new Error("Too many arguments");

  const input = await readAll(inputPath == null ? stdin : fs.createReadStream(inputPath));
  const artifact = await compileWasmArtifact(source, { libraries });
  stdout.write(await runWasmArtifact(artifact, input));
}

main().catch((error) => {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
});
