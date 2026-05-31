#!/usr/bin/env node

import fs from "node:fs";
import { argv, exit, stdout } from "node:process";

import { decodeObject, loadLibrary } from "@fraczak/k/backend-api.mjs";
import { compileWasmArtifact } from "../src/wasm.mjs";

function usage(stream = console.error) {
  const prog = argv[1] || "k-wasm-compile.mjs";
  stream(`Usage: node ${prog} [ options ] ( k-expr | -k file ) [ wasm-file ]`);
  stream("Compile a k program into a standalone WebAssembly artifact.");
  stream("");
  stream("Arguments:");
  stream("  k-expr      Compile a k expression.");
  stream("  -k file     Compile a k source file.");
  stream("  wasm-file   Output .wasm path. Writes the binary artifact to stdout when omitted.");
  stream("");
  stream("Options:");
  stream("  --lib file  Load a .klib dependency before compiling. May be repeated.");
  stream("  -h, --help  Show this help.");
}

function readSource(args) {
  const programArg = args.shift();
  if (programArg == null) throw new Error("Missing script argument");
  if (programArg !== "-k") return programArg;
  const sourcePath = args.shift();
  if (!sourcePath) throw new Error("-k requires a file argument");
  return fs.readFileSync(sourcePath, "utf8");
}

try {
  const args = argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    usage(console.log);
    exit(0);
  }

  const libraries = [];
  while (args.length > 0 && args[0] === "--lib") {
    args.shift();
    const libPath = args.shift();
    if (!libPath) throw new Error("--lib requires a file argument");
    libraries.push(loadLibrary(decodeObject(fs.readFileSync(libPath))));
  }

  const source = readSource(args);
  const outputPath = args.shift();
  if (args.length > 0) throw new Error("Too many arguments");
  const artifact = await compileWasmArtifact(source, { libraries });
  if (outputPath == null) {
    stdout.write(artifact);
  } else {
    fs.writeFileSync(outputPath, artifact);
  }
} catch (error) {
  console.error(error.stack || error.message || String(error));
  usage();
  exit(1);
}
