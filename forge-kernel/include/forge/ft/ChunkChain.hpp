#pragma once

// ============================================================================
// forge::ft — chunked emission with a cryptographic hash/count chain.
//
// SACROSANCT 3.1 s0.11 ("Chunked generation and unlimited logical length"):
// large graphs are emitted and compiled as a cryptographically chained stream of
//   GraphHeader { schema_version, project_id, normalized_spec_hash,
//                 model_package_hash, compiler_version,
//                 planned_chunk_count_or_unknown, declared_count_ranges }
//   FeatureChunk { sequence_number, previous_chunk_hash, nodes[],
//                  running_counts, unresolved_forward_declarations[], chunk_hash }
//   GraphFooter { final_counts, unresolved_references, requirement_coverage,
//                 graph_root_hash, replay_fingerprint, completion_status }
//
// and Appendix B's CHUNK-CORRUPTION row requires that removing, duplicating,
// reordering or altering one chunk is detected by that hash/count chain BEFORE
// acceptance.
//
// "BEFORE acceptance" is enforced structurally, not by convention: accept() is
// the only way to get a FeatureTree out of a ChunkStream, and it verifies the
// whole chain before it reassembles a single line of IR. A caller cannot parse a
// corrupted stream by forgetting to check first.
//
// This file is pure std C++ — no kernel, no OCCT, no third-party hash library.
// The digest is a full SHA-256 implemented in ChunkChain.cpp and checked against
// the FIPS 180-4 test vectors in the acceptance test, because a chain built on a
// non-cryptographic hash is a chain an adversary can forge, and calling one
// "cryptographic" without testing it is exactly the sort of unverified claim the
// constitution forbids.
// ============================================================================

#include <cstddef>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"

namespace forge {
namespace ft {

// --------------------------------------------------------------- SHA-256
// Lowercase hex digest of the message. Deterministic, no allocation surprises.
std::string sha256Hex(const std::string& message);

// ---------------------------------------------------------- stream records
struct GraphHeader {
    std::string schemaVersion      = "forge.ft/1";
    std::string projectId;
    std::string normalizedSpecHash;    // hash of the normalized task spec
    std::string modelPackageHash;      // hash of the emitting model package
    std::string compilerVersion;
    std::size_t plannedChunkCount = 0; // 0 == unknown, per s0.11
    std::size_t declaredLineCount = 0; // declared_count_ranges, exact here

    // Deterministic digest of every field above. It anchors the chain: chunk 1's
    // previousChunkHash is this value, so altering the header breaks the chain.
    std::string hash() const;
};

struct FeatureChunk {
    std::size_t              sequenceNumber = 0;   // 1-based, contiguous
    std::string              previousChunkHash;    // header hash for seq 1
    std::vector<std::string> lines;                // nodes[]: raw IR source lines
    std::size_t              runningCount = 0;     // cumulative lines through here
    std::vector<std::string> unresolvedForwardDeclarations;
    std::string              chunkHash;            // digest of everything above

    // Recompute the digest from the chunk's own content. A chunk whose stored
    // chunkHash differs from this has been ALTERED.
    std::string computeHash() const;
};

struct GraphFooter {
    std::size_t finalCount           = 0;
    std::size_t unresolvedReferences = 0;
    double      requirementCoverage  = 1.0;
    std::string graphRootHash;                  // digest of the last chunk + counts
    std::string replayFingerprint;              // digest of the reassembled IR
    std::string completionStatus     = "COMPLETE";
};

struct ChunkStream {
    GraphHeader              header;
    std::vector<FeatureChunk> chunks;
    GraphFooter              footer;
};

// ------------------------------------------------------------ chain faults
enum class ChainFault {
    None,
    HeaderAltered,       // header hash does not anchor chunk 1
    ChunkAltered,        // stored chunkHash != recomputed digest (content changed)
    LinkBroken,          // previousChunkHash does not match the predecessor
    SequenceGap,         // a chunk was REMOVED (sequence numbers skip)
    DuplicateSequence,   // a chunk was DUPLICATED (sequence number repeats)
    OutOfOrder,          // chunks REORDERED (sequence number goes backwards)
    CountDrift,          // running/final counts do not match the payload
    RootMismatch,        // footer graph_root_hash / replay fingerprint disagree
    NotComplete,         // completion_status is not COMPLETE
};

const char* toString(ChainFault f);

struct ChainVerdict {
    bool        accepted = false;
    ChainFault  fault    = ChainFault::None;
    std::size_t atChunk  = 0;      // 1-based chunk the fault was found at, 0 = n/a
    std::string detail;            // what was expected vs what was found
};

// ------------------------------------------------------------------- API
// Split IR source text into chunks of at most `linesPerChunk` source lines and
// build the full chained stream (header hash -> chunk hashes -> footer root).
// `proto` supplies the header identity fields; counts and hashes are computed.
ChunkStream emitChunked(const std::string& irText, std::size_t linesPerChunk,
                        const GraphHeader& proto = GraphHeader());

// Verify the chain: header anchor, per-chunk digest, back-links, sequence
// contiguity, running/final counts, footer root and replay fingerprint, and
// completion status. Pure function, no side effects.
ChainVerdict verifyChain(const ChunkStream& s);

// The reassembled IR text. Exposed for diagnostics; it does NOT verify.
std::string reassemble(const ChunkStream& s);

// THE ONLY accepted path from a stream to a graph: verify, then parse. Throws
// std::runtime_error naming the fault and the chunk if the chain does not
// verify, so corruption is always detected BEFORE any IR is accepted.
FeatureTree accept(const ChunkStream& s);

}  // namespace ft
}  // namespace forge
