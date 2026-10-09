import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyVectorDigest } from "./vector-integrity.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(await readFile(resolve(root, "vectors.lock.json"), "utf8"));
const output = resolve(root, ".cache/lattice-vectors");

await mkdir(output, { recursive: true });
for (const file of lock.files) {
  const url = `https://raw.githubusercontent.com/${lock.repository}/${lock.commit}/Vectors/${file}`;
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok) throw new Error(`failed to fetch ${url}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  verifyVectorDigest(bytes, lock.sha256?.[file]);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const parsed = JSON.parse(text);
  if (parsed.version !== lock.version) {
    throw new Error(`${file}: expected vector version ${lock.version}, got ${parsed.version}`);
  }
  await writeFile(resolve(output, file), bytes);
}
