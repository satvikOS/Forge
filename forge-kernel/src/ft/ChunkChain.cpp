// ============================================================================
// forge::ft — chunked emission with a cryptographic hash/count chain (s0.11),
// and the CHUNK-CORRUPTION detector Appendix B requires.
//
// Pure std C++: no kernel symbol, no OCCT, no third-party dependency. That is
// deliberate — the chain has to be verifiable in any process that can read the
// stream, including one that cannot link the modelling kernel.
// ============================================================================

#include "forge/ft/ChunkChain.hpp"

#include <cstddef>
#include <cstdint>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

#include "forge/ft/FeatureTree.hpp"

namespace forge {
namespace ft {
namespace {

// ------------------------------------------------------------------ SHA-256
// FIPS 180-4. Checked against the standard vectors in the acceptance test.
struct Sha256 {
    std::uint32_t h[8] = {0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
                          0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u};
    std::uint64_t bitLen = 0;
    unsigned char buf[64] = {0};
    std::size_t   bufLen = 0;

    static std::uint32_t rotr(std::uint32_t x, unsigned n) {
        return (x >> n) | (x << (32 - n));
    }

    void block(const unsigned char* p) {
        static const std::uint32_t K[64] = {
            0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u, 0x3956c25bu, 0x59f111f1u,
            0x923f82a4u, 0xab1c5ed5u, 0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
            0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u, 0xe49b69c1u, 0xefbe4786u,
            0x0fc19dc6u, 0x240ca1ccu, 0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
            0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u, 0xc6e00bf3u, 0xd5a79147u,
            0x06ca6351u, 0x14292967u, 0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
            0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u, 0xa2bfe8a1u, 0xa81a664bu,
            0xc24b8b70u, 0xc76c51a3u, 0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
            0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u, 0x391c0cb3u, 0x4ed8aa4au,
            0x5b9cca4fu, 0x682e6ff3u, 0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
            0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u};

        std::uint32_t w[64];
        for (int i = 0; i < 16; ++i)
            w[i] = (static_cast<std::uint32_t>(p[i * 4]) << 24) |
                   (static_cast<std::uint32_t>(p[i * 4 + 1]) << 16) |
                   (static_cast<std::uint32_t>(p[i * 4 + 2]) << 8) |
                   (static_cast<std::uint32_t>(p[i * 4 + 3]));
        for (int i = 16; i < 64; ++i) {
            const std::uint32_t s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >> 3);
            const std::uint32_t s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16] + s0 + w[i - 7] + s1;
        }
        std::uint32_t a = h[0], b = h[1], c = h[2], d = h[3];
        std::uint32_t e = h[4], f = h[5], g = h[6], hh = h[7];
        for (int i = 0; i < 64; ++i) {
            const std::uint32_t S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
            const std::uint32_t ch = (e & f) ^ ((~e) & g);
            const std::uint32_t t1 = hh + S1 + ch + K[i] + w[i];
            const std::uint32_t S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
            const std::uint32_t mj = (a & b) ^ (a & c) ^ (b & c);
            const std::uint32_t t2 = S0 + mj;
            hh = g; g = f; f = e; e = d + t1;
            d = c; c = b; b = a; a = t1 + t2;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d;
        h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
    }

    void update(const std::string& s) {
        for (unsigned char ch : s) {
            buf[bufLen++] = ch;
            bitLen += 8;
            if (bufLen == 64) { block(buf); bufLen = 0; }
        }
    }

    std::string hex() {
        const std::uint64_t total = bitLen;
        buf[bufLen++] = 0x80;
        if (bufLen > 56) {
            while (bufLen < 64) buf[bufLen++] = 0;
            block(buf);
            bufLen = 0;
        }
        while (bufLen < 56) buf[bufLen++] = 0;
        for (int i = 7; i >= 0; --i)
            buf[bufLen++] = static_cast<unsigned char>((total >> (i * 8)) & 0xff);
        block(buf);

        static const char* kHex = "0123456789abcdef";
        std::string out;
        out.reserve(64);
        for (int i = 0; i < 8; ++i)
            for (int b = 3; b >= 0; --b) {
                const unsigned byte = (h[i] >> (b * 8)) & 0xffu;
                out += kHex[byte >> 4];
                out += kHex[byte & 0xf];
            }
        return out;
    }
};

// Length-prefixed field joining. Plain concatenation would let two different
// field splits hash identically ("ab"+"c" == "a"+"bc"), which is a real forgery
// path for a chain whose whole job is to be unforgeable.
void field(std::string& acc, const std::string& v) {
    acc += std::to_string(v.size());
    acc += ':';
    acc += v;
    acc += '|';
}
void field(std::string& acc, std::size_t v) { field(acc, std::to_string(v)); }

}  // namespace

std::string sha256Hex(const std::string& message) {
    Sha256 s;
    s.update(message);
    return s.hex();
}

const char* toString(ChainFault f) {
    switch (f) {
        case ChainFault::None:              return "None";
        case ChainFault::HeaderAltered:     return "HeaderAltered";
        case ChainFault::ChunkAltered:      return "ChunkAltered";
        case ChainFault::LinkBroken:        return "LinkBroken";
        case ChainFault::SequenceGap:       return "SequenceGap";
        case ChainFault::DuplicateSequence: return "DuplicateSequence";
        case ChainFault::OutOfOrder:        return "OutOfOrder";
        case ChainFault::CountDrift:        return "CountDrift";
        case ChainFault::RootMismatch:      return "RootMismatch";
        case ChainFault::NotComplete:       return "NotComplete";
    }
    return "Unknown";
}

std::string GraphHeader::hash() const {
    std::string acc = "forge.ft.header|";
    field(acc, schemaVersion);
    field(acc, projectId);
    field(acc, normalizedSpecHash);
    field(acc, modelPackageHash);
    field(acc, compilerVersion);
    field(acc, plannedChunkCount);
    field(acc, declaredLineCount);
    return sha256Hex(acc);
}

std::string FeatureChunk::computeHash() const {
    std::string acc = "forge.ft.chunk|";
    field(acc, sequenceNumber);
    field(acc, previousChunkHash);
    field(acc, lines.size());
    for (const std::string& l : lines) field(acc, l);
    field(acc, runningCount);
    field(acc, unresolvedForwardDeclarations.size());
    for (const std::string& u : unresolvedForwardDeclarations) field(acc, u);
    return sha256Hex(acc);
}

ChunkStream emitChunked(const std::string& irText, std::size_t linesPerChunk,
                        const GraphHeader& proto) {
    if (linesPerChunk == 0) throw std::runtime_error("emitChunked: linesPerChunk must be >= 1");

    std::vector<std::string> lines;
    {
        std::istringstream in(irText);
        std::string l;
        while (std::getline(in, l)) lines.push_back(l);
    }

    ChunkStream s;
    s.header = proto;
    s.header.declaredLineCount = lines.size();
    s.header.plannedChunkCount = (lines.size() + linesPerChunk - 1) / linesPerChunk;

    std::string prev = s.header.hash();
    std::size_t running = 0;
    std::size_t seq = 0;
    for (std::size_t i = 0; i < lines.size(); i += linesPerChunk) {
        FeatureChunk c;
        c.sequenceNumber = ++seq;
        c.previousChunkHash = prev;
        for (std::size_t j = i; j < lines.size() && j < i + linesPerChunk; ++j)
            c.lines.push_back(lines[j]);
        running += c.lines.size();
        c.runningCount = running;
        c.chunkHash = c.computeHash();
        prev = c.chunkHash;
        s.chunks.push_back(std::move(c));
    }

    s.footer.finalCount = running;
    s.footer.unresolvedReferences = 0;
    s.footer.requirementCoverage = 1.0;
    s.footer.completionStatus = "COMPLETE";
    {
        std::string acc = "forge.ft.footer|";
        field(acc, prev);                       // last chunk hash
        field(acc, s.footer.finalCount);
        field(acc, s.chunks.size());
        s.footer.graphRootHash = sha256Hex(acc);
    }
    s.footer.replayFingerprint = sha256Hex(reassemble(s));
    return s;
}

std::string reassemble(const ChunkStream& s) {
    std::string out;
    for (const FeatureChunk& c : s.chunks)
        for (const std::string& l : c.lines) { out += l; out += '\n'; }
    return out;
}

ChainVerdict verifyChain(const ChunkStream& s) {
    ChainVerdict v;
    auto fail = [&v](ChainFault f, std::size_t at, const std::string& detail) {
        v.accepted = false;
        v.fault = f;
        v.atChunk = at;
        v.detail = detail;
        return v;
    };

    if (s.chunks.empty())
        return fail(ChainFault::CountDrift, 0, "stream carries no chunks");

    if (s.footer.completionStatus != "COMPLETE")
        return fail(ChainFault::NotComplete, 0,
                    "completion_status=" + s.footer.completionStatus +
                        " — a stream that did not finish is never accepted");

    const std::string headerHash = s.header.hash();

    std::string prev = headerHash;
    std::size_t running = 0;
    for (std::size_t i = 0; i < s.chunks.size(); ++i) {
        const FeatureChunk& c = s.chunks[i];
        const std::size_t expectedSeq = i + 1;

        // ---- REORDER / REMOVE / DUPLICATE, from the sequence numbers alone ---
        // The three are distinguished exactly, because the repair differs: a
        // duplicate is dropped, a reorder is re-sorted, a removal must be
        // re-requested from the emitter. Deciding by ">" alone mislabels a swap
        // as a removal, so ask what the whole stream actually contains.
        if (c.sequenceNumber != expectedSeq) {
            std::size_t occurrences = 0, expectedFound = 0;
            for (const FeatureChunk& o : s.chunks) {
                if (o.sequenceNumber == c.sequenceNumber) ++occurrences;
                if (o.sequenceNumber == expectedSeq) ++expectedFound;
            }
            ChainFault  f    = ChainFault::SequenceGap;
            std::string what = "chunk " + std::to_string(expectedSeq) + " was removed";
            if (occurrences > 1) {
                f = ChainFault::DuplicateSequence;
                what = "chunk " + std::to_string(c.sequenceNumber) + " appears " +
                       std::to_string(occurrences) + " times";
            } else if (expectedFound > 0) {
                f = ChainFault::OutOfOrder;
                what = "chunk " + std::to_string(expectedSeq) + " is present but later";
            }
            return fail(f, i + 1,
                        "sequence_number=" + std::to_string(c.sequenceNumber) +
                            " at position " + std::to_string(expectedSeq) + " (" + what + ")");
        }

        // ---- ALTER: the stored digest must match the content ----------------
        const std::string recomputed = c.computeHash();
        if (recomputed != c.chunkHash)
            return fail(ChainFault::ChunkAltered, c.sequenceNumber,
                        "chunk_hash=" + c.chunkHash.substr(0, 16) +
                            "... but its content hashes to " + recomputed.substr(0, 16) +
                            "... — the chunk body was altered");

        // ---- LINK: the back-pointer must match the predecessor ---------------
        if (c.previousChunkHash != prev) {
            const ChainFault f =
                (i == 0) ? ChainFault::HeaderAltered : ChainFault::LinkBroken;
            return fail(f, c.sequenceNumber,
                        "previous_chunk_hash=" + c.previousChunkHash.substr(0, 16) +
                            "... expected " + prev.substr(0, 16) +
                            (i == 0 ? "... (header anchor)" : "... (predecessor digest)"));
        }

        // ---- COUNT: the running count must match the payload -----------------
        running += c.lines.size();
        if (c.runningCount != running)
            return fail(ChainFault::CountDrift, c.sequenceNumber,
                        "running_count=" + std::to_string(c.runningCount) + " but " +
                            std::to_string(running) + " lines have been carried");

        prev = c.chunkHash;
    }

    // ---- FOOTER: final counts, root hash, replay fingerprint ------------------
    if (s.footer.finalCount != running)
        return fail(ChainFault::CountDrift, 0,
                    "final_count=" + std::to_string(s.footer.finalCount) + " but " +
                        std::to_string(running) + " lines were carried");
    if (s.header.declaredLineCount != running)
        return fail(ChainFault::CountDrift, 0,
                    "header declared_count=" + std::to_string(s.header.declaredLineCount) +
                        " but " + std::to_string(running) + " lines were carried");
    if (s.footer.unresolvedReferences != 0)
        return fail(ChainFault::CountDrift, 0,
                    "unresolved_references=" + std::to_string(s.footer.unresolvedReferences) +
                        " — s0.4 requires zero");

    std::string acc = "forge.ft.footer|";
    field(acc, prev);
    field(acc, s.footer.finalCount);
    field(acc, s.chunks.size());
    const std::string root = sha256Hex(acc);
    if (root != s.footer.graphRootHash)
        return fail(ChainFault::RootMismatch, 0,
                    "graph_root_hash=" + s.footer.graphRootHash.substr(0, 16) +
                        "... recomputed " + root.substr(0, 16) + "...");
    const std::string replay = sha256Hex(reassemble(s));
    if (replay != s.footer.replayFingerprint)
        return fail(ChainFault::RootMismatch, 0,
                    "replay_fingerprint=" + s.footer.replayFingerprint.substr(0, 16) +
                        "... recomputed " + replay.substr(0, 16) + "...");

    v.accepted = true;
    v.fault = ChainFault::None;
    v.atChunk = 0;
    v.detail = "chain verified: " + std::to_string(s.chunks.size()) + " chunks, " +
               std::to_string(running) + " lines, root " + root.substr(0, 16) + "...";
    return v;
}

FeatureTree accept(const ChunkStream& s) {
    const ChainVerdict v = verifyChain(s);
    if (!v.accepted)
        throw std::runtime_error(std::string("chunk chain REJECTED before acceptance: ") +
                                 toString(v.fault) +
                                 (v.atChunk ? " at chunk " + std::to_string(v.atChunk) : "") +
                                 " — " + v.detail);
    return parse(reassemble(s));
}

}  // namespace ft
}  // namespace forge
