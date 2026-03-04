#!/usr/bin/env node

// Small shim to ensure a stable shebang regardless of TypeScript emit behavior.
import('../dist/index.js').catch((err) => {
  console.error(err);
  process.exit(1);
});
