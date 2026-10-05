# Contributing

Requires Node.js 22 or newer.

```sh
npm install
npm test
npm run format:check
```

Protocol changes must identify their authoritative change in `Lattice` or
`lattice-node`. Do not update a copied fixture to make a failing conformance
test pass: update `vectors.lock.json` to a reviewed Lattice commit and run the
entire vector suite.
