// forge/native/util/Sha256.hpp
//
// SHA-256 (FIPS 180-4). Pure C++20, no external dependency.
//
// WHY THIS FILE EXISTS
//   This implementation was written for forge::ft's s0.11 chunk chain and is
//   checked against the standard NIST vectors by
//   forge-kernel/test/ft/s0_acceptance_test.cpp. The native storage governor
//   (s21.3) needs the same primitive to make its dry-run plan receipts
//   tamper-evident.
//
//   A second copy of a hash function is not an option: two implementations
//   drift, and the one that drifts is the one nobody is testing. So the single
//   FIPS-checked implementation was lifted out of ChunkChain.cpp into this
//   low-level utility, and forge::ft::sha256Hex now delegates to it. There is
//   exactly ONE SHA-256 in the tree, and the existing ft acceptance vectors
//   still test it.
//
//   It lives under forge/native/util rather than forge/ft because the
//   dependency must point DOWNWARD. forge::native is the dependency-free
//   in-house layer; having it reach up into forge::ft for a hash would invert
//   the layering.

#ifndef FORGE_NATIVE_UTIL_SHA256_HPP
#define FORGE_NATIVE_UTIL_SHA256_HPP

#include <string>

namespace forge::native::util {

// Lowercase hex digest (64 chars) of `message`.
std::string sha256Hex(const std::string& message);

}  // namespace forge::native::util

#endif  // FORGE_NATIVE_UTIL_SHA256_HPP
