// ─────────────────────────────────────────────────────────────────────────────
// Digest.hpp — SHA-256 for the durable workflow checkpoint chain.
//
// WHY A SECOND COPY. forge::ft::sha256Hex already exists in
// forge-kernel/src/ft/ChunkChain.cpp, and reusing it would be the right thing if
// it were linkable on its own. It is not: ChunkChain.cpp calls forge::ft::parse,
// which lives in FeatureTreeCompiler.cpp and drags in the whole feature-tree
// compiler and the kernel behind it. This module is deliberately pure C++20 +
// libc so its gate runs headless with the network denied and without a kernel
// build, so the primitive is implemented here instead of taking that dependency.
// (Measured, not assumed: linking ChunkChain.o alone fails with
//  "Undefined symbols ... forge::ft::parse(std::string const&)".)
//
// It is checked against the FIPS 180-4 vectors in the gate, for the same reason
// ChunkChain's copy is: a chain built on an untested hash is not a chain.
// ─────────────────────────────────────────────────────────────────────────────
#pragma once

#include <string>

namespace forge::orch {

// Lowercase 64-character hex digest of `message`.
std::string sha256Hex(const std::string& message);

}  // namespace forge::orch
