// forge-desktop/src/update/Sha256.hpp
//
// SHA-256, implemented here rather than linked.
//
// WHY NOT CommonCrypto. macOS ships CC_SHA256 in the SDK, so this is not about
// availability. It is about what the GATE can assert. A hash the updater imports
// can only be tested against itself; a hash that lives in this tree is tested in
// update_gate.cpp against the PUBLISHED NIST FIPS 180-4 known-answer vectors, so
// "the digest function is correct" is a measured claim and not an assumption.
// The second reason is smaller but real: this keeps libforge_updater free of
// every link-time dependency, which is what lets the gate build with one c++
// invocation and no kernel, no OCCT, no SDL and no Vulkan.
//
// This is a digest, NOT a signature. It proves the bytes that arrived are the
// bytes the manifest named. It does not prove who wrote the manifest -- see the
// trust-model note at the top of Updater.hpp.
#pragma once

#include <cstddef>
#include <cstdint>
#include <string>

namespace forge::update {

// Lowercase hex, 64 characters.
std::string sha256Hex(const void* data, std::size_t len);
std::string sha256Hex(const std::string& s);

// Streams the file so a 200 MB payload does not have to be resident. Returns an
// empty string and sets `err` if the file cannot be read; an empty return is
// NEVER a valid digest, so a read failure can never be mistaken for a match.
std::string sha256File(const std::string& path, std::string& err);

// Case-insensitive, length-checked comparison of two hex digests, in time that
// does not depend on WHERE they first differ. A digest comparison that exits on
// the first differing character is a textbook oracle; this is cheap enough that
// there is no reason to leave one.
bool hexDigestEquals(const std::string& a, const std::string& b);

}  // namespace forge::update
