import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const path = resolve(root, "vectors.lock.json");
const lock = JSON.parse(await readFile(path, "utf8"));
const response = await fetch(`https://api.github.com/repos/${lock.repository}/commits/main`, {
  headers: { Accept: "application/vnd.github+json" },
});
if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`);
const commit = (await response.json()).sha;
const first = `https://raw.githubusercontent.com/${lock.repository}/${commit}/Vectors/${lock.files[0]}`;
const vectorResponse = await fetch(first);
if (!vectorResponse.ok) throw new Error(`failed to inspect vectors: HTTP ${vectorResponse.status}`);
const version = (await vectorResponse.json()).version;
await writeFile(path, `${JSON.stringify({ ...lock, commit, version }, null, 2)}\n`);
console.log(`locked Lattice vectors at ${commit} (version ${version})`);
